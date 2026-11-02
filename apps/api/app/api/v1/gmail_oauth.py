"""Gmail OAuth 2.0 Authorization & Management Endpoints (Phase 4).

Follows official Google OAuth 2.0 flow using least-privilege scope:
https://www.googleapis.com/auth/gmail.send
Tokens are encrypted at rest using OAUTH_ENCRYPTION_SECRET and NEVER exposed in responses.
"""

import hashlib
import hmac
import logging
import urllib.parse
from datetime import UTC, datetime

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import RedirectResponse
from pydantic import BaseModel

from app.core.auth import get_authenticated_user_id
from app.core.config import settings
from app.core.oauth_crypto import (
    OAuthCryptoError,
    OAuthCryptoKeyInvalidError,
    OAuthCryptoKeyMissingError,
    get_oauth_master_key_bytes,
)
from app.db.repositories.oauth_token_repo import oauth_token_repo

logger = logging.getLogger("jobFinder.api.gmail_oauth")
router = APIRouter(prefix="/auth/gmail", tags=["Gmail Integration & OAuth"])

GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GMAIL_PROFILE_URL = "https://gmail.googleapis.com/gmail/v1/users/me/profile"


class GmailStatusResponse(BaseModel):
    """Safe status response disclosing integration status without leaking tokens."""

    isConnected: bool
    gmailAddress: str | None = None
    scope: str | None = None
    connectedAt: str | None = None
    hasSendPermission: bool = False
    hasReadPermission: bool = False


def _sign_oauth_state(user_id: str) -> str:
    """Generate signed tamper-evident OAuth state parameter."""
    key = get_oauth_master_key_bytes()
    nonce = datetime.now(UTC).isoformat()
    raw = f"{user_id}:{nonce}"
    sig = hmac.new(key, raw.encode("utf-8"), hashlib.sha256).hexdigest()
    return f"{user_id}:{nonce}:{sig}"


def _verify_oauth_state(state: str) -> str:
    """Verify state parameter and return validated user_id."""
    parts = state.split(":")
    if len(parts) != 3:
        raise ValueError("Malformed OAuth state parameter.")

    user_id, nonce, sig = parts
    key = get_oauth_master_key_bytes()
    expected_sig = hmac.new(key, f"{user_id}:{nonce}".encode("utf-8"), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(sig, expected_sig):
        raise ValueError("Invalid OAuth state signature.")

    return user_id


@router.get("/authorize")
async def get_authorization_url(
    include_read: bool = Query(default=False, description="Request incremental gmail.readonly permission for reply tracking"),
    user_id: str = Depends(get_authenticated_user_id),
):
    """Generate Google OAuth 2.0 authorization URL with signed state parameter.
    
    Supports incremental authorization: when include_read=True, requests
    https://www.googleapis.com/auth/gmail.readonly alongside gmail.send with include_granted_scopes=true.
    """
    # 1. Validate dedicated OAuth secret
    try:
        get_oauth_master_key_bytes()
    except (OAuthCryptoKeyMissingError, OAuthCryptoKeyInvalidError) as e:
        logger.error(f"Cannot initiate Gmail OAuth: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"OAuth configuration error: {str(e)}",
        ) from e

    if not settings.GOOGLE_CLIENT_ID:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="GOOGLE_CLIENT_ID is not configured.",
        )

    scope = (
        f"{settings.GMAIL_SEND_SCOPE} {settings.GMAIL_READ_SCOPE}"
        if include_read
        else settings.GMAIL_SEND_SCOPE
    )

    state = _sign_oauth_state(user_id)
    params = {
        "client_id": settings.GOOGLE_CLIENT_ID,
        "redirect_uri": settings.GOOGLE_OAUTH_REDIRECT_URI,
        "response_type": "code",
        "scope": scope,
        "access_type": "offline",
        "prompt": "consent",
        "state": state,
    }
    if include_read:
        params["include_granted_scopes"] = "true"

    auth_url = f"{GOOGLE_AUTH_URL}?{urllib.parse.urlencode(params)}"
    return {"authorizationUrl": auth_url, "requestedScope": scope}


@router.get("/callback")
async def oauth_callback(
    code: str = Query(...),
    state: str = Query(...),
    error: str | None = Query(default=None),
):
    """Handle OAuth 2.0 callback, exchange code for tokens, and persist encrypted credentials."""
    if error:
        logger.warning(f"Google OAuth authorization denied by user: {error}")
        return RedirectResponse(url="/preferences?gmail_error=" + urllib.parse.quote(error))

    # 1. Validate state
    try:
        user_id = _verify_oauth_state(state)
    except Exception as e:
        logger.error(f"OAuth state validation failed: {e}")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid or expired OAuth state parameter: {str(e)}",
        ) from e

    # 2. Exchange authorization code for tokens
    async with httpx.AsyncClient(timeout=15.0) as client:
        token_res = await client.post(
            GOOGLE_TOKEN_URL,
            data={
                "client_id": settings.GOOGLE_CLIENT_ID,
                "client_secret": settings.GOOGLE_CLIENT_SECRET,
                "code": code,
                "grant_type": "authorization_code",
                "redirect_uri": settings.GOOGLE_OAUTH_REDIRECT_URI,
            },
        )

        if token_res.status_code != 200:
            logger.error(f"Google token exchange failed: {token_res.status_code} {token_res.text}")
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Token exchange failed: {token_res.text}",
            )

        token_data = token_res.json()
        access_token = token_data.get("access_token")
        refresh_token = token_data.get("refresh_token")
        expires_in = token_data.get("expires_in", 3600)
        granted_scope = token_data.get("scope", settings.GMAIL_SEND_SCOPE)

        exp_timestamp = datetime.now(UTC).timestamp() + expires_in
        expiry_iso = datetime.fromtimestamp(exp_timestamp, UTC).isoformat()

        # 3. Retrieve user's email address from Gmail profile
        gmail_address = None
        try:
            profile_res = await client.get(
                GMAIL_PROFILE_URL,
                headers={"Authorization": f"Bearer {access_token}"},
            )
            if profile_res.status_code == 200:
                gmail_address = profile_res.json().get("emailAddress")
        except Exception as e:
            logger.warning(f"Could not fetch Gmail profile: {e}")

        # 4. Encrypt and persist tokens in user's tenant-scoped vault
        oauth_token_repo.save_tokens(
            user_id=user_id,
            access_token=access_token,
            refresh_token=refresh_token,
            expiry=expiry_iso,
            scope=granted_scope,
            gmail_address=gmail_address,
        )

    # Redirect to frontend settings with success query param
    return RedirectResponse(url="/preferences?gmail_connected=true")


@router.get("/status", response_model=GmailStatusResponse)
async def get_gmail_status(
    user_id: str = Depends(get_authenticated_user_id),
):
    """Check whether the authenticated user has an active Gmail integration."""
    record = oauth_token_repo.get_record(user_id=user_id)
    if not record:
        return GmailStatusResponse(
            isConnected=False,
            hasSendPermission=False,
            hasReadPermission=False,
        )

    granted_scope = record.scope or ""
    return GmailStatusResponse(
        isConnected=True,
        gmailAddress=record.gmailAddress,
        scope=record.scope,
        connectedAt=record.connectedAt,
        hasSendPermission=settings.GMAIL_SEND_SCOPE in granted_scope,
        hasReadPermission=settings.GMAIL_READ_SCOPE in granted_scope,
    )


@router.post("/disconnect")
async def disconnect_gmail(
    user_id: str = Depends(get_authenticated_user_id),
):
    """Safely disconnect Gmail integration and purge encrypted credentials."""
    oauth_token_repo.disconnect(user_id=user_id)
    return {"status": "disconnected", "message": "Gmail integration successfully removed."}
