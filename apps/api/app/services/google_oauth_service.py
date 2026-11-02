"""Google Third-Party Connections Service (Gmail, Calendar, Drive).

Definitive Implementation Plan v3.0 compliant:
1. Independent OAuth client support for Gmail, Calendar, and Drive.
2. Least-privilege and incremental scoping (gmail.send, calendar.events, drive.file; gmail.readonly gated).
3. Cryptographic domain separation for state signing and AES-256-GCM token vaulting.
4. Atomic single-use state nonce consumption via Firestore transactions.
5. Distributed multi-worker token refresh lease coordination with recovery from abandoned locks.
6. Refresh token preservation when Google omits it during refresh cycles.
7. Truthful two-phase disconnect state machine with confirmed Google remote revocation.
"""

import asyncio
import logging
import os
import secrets
import time
import urllib.parse
import uuid
from datetime import UTC, datetime
from typing import Any, Optional

import httpx
from pydantic import BaseModel

from app.core.config import settings
from app.core.oauth_crypto import (
    OAuthCryptoError,
    OAuthCryptoKeyInvalidError,
    OAuthCryptoKeyMissingError,
    derive_oauth_subkeys,
    sign_oauth_state,
    verify_oauth_state,
)
from app.db.repositories.oauth_token_repo import oauth_token_repo

logger = logging.getLogger("jobFinder.services.google_oauth")

GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GOOGLE_REVOKE_URL = "https://oauth2.googleapis.com/revoke"

GMAIL_PROFILE_URL = "https://gmail.googleapis.com/gmail/v1/users/me/profile"
CALENDAR_EVENTS_URL = "https://www.googleapis.com/calendar/v3/calendars/primary/events?maxResults=1"
DRIVE_ABOUT_URL = "https://www.googleapis.com/drive/v3/about?fields=user,storageQuota"
USERINFO_URL = "https://www.googleapis.com/oauth2/v3/userinfo"

VALID_SERVICES = {"gmail", "calendar", "drive"}


class GoogleOAuthError(Exception):
    """Base exception for Google OAuth operations."""

    pass


class GoogleOAuthConfigError(GoogleOAuthError):
    """Raised when client ID or secrets are missing for a service."""

    pass


class GoogleNotConnectedError(GoogleOAuthError):
    """Raised when an operation is requested on an unconnected service."""

    pass


class GoogleReauthorizationRequiredError(GoogleOAuthError):
    """Raised when a grant is invalid or revoked and requires re-consent."""

    pass


class GoogleTokenRefreshError(GoogleOAuthError):
    """Raised when refreshing an access token fails."""

    pass


class ServiceStatusResponse(BaseModel):
    """Safe status response disclosing connection status without leaking credentials."""

    service: str
    isConnected: bool
    healthStatus: str = "DISCONNECTED"  # OPERATIONAL | NEEDS_REAUTHORIZATION | DISCONNECTED
    accountEmail: str | None = None
    scope: str | None = None
    connectedAt: str | None = None
    details: dict[str, Any] = {}
    hasSendPermission: bool = False
    hasReadPermission: bool = False


class GoogleOAuthService:
    """Enterprise-grade service coordinating OAuth lifecycle for Google integrations."""

    def __init__(self, http_client: httpx.AsyncClient | None = None):
        self._http_client = http_client

    def _get_client(self) -> httpx.AsyncClient:
        return self._http_client or httpx.AsyncClient(timeout=15.0)

    def get_redirect_uri(self, service: str) -> str:
        """Construct exact registered redirect URI for the service."""
        svc = service.lower().strip()
        base = settings.GOOGLE_OAUTH_REDIRECT_URI_BASE.rstrip("/")
        return f"{base}/api/v1/connections/google/{svc}/callback"

    def get_default_scopes(self, service: str, include_read: bool = False) -> list[str]:
        """Return minimum least-privilege scopes for the given service."""
        svc = service.lower().strip()
        base_identity = ["openid", "https://www.googleapis.com/auth/userinfo.email"]

        if svc == "gmail":
            scopes = [settings.GMAIL_SEND_SCOPE] + base_identity
            if include_read:
                scopes.append(settings.GMAIL_READ_SCOPE)
            return scopes
        elif svc == "calendar":
            return [settings.CALENDAR_EVENTS_SCOPE] + base_identity
        elif svc == "drive":
            return [settings.DRIVE_FILE_SCOPE] + base_identity
        else:
            raise GoogleOAuthError(f"Unsupported service: {service}")

    def get_authorization_url(
        self,
        user_id: str,
        service: str,
        include_read: bool = False,
        prompt: str = "consent",
    ) -> dict[str, str]:
        """Generate Google OAuth authorization URL with signed state and atomic nonce.

        Enforces:
        - Cryptographic domain separation for state signing.
        - Atomic nonce registration in Firestore with 10-minute TTL.
        - User ID, service, and timestamp binding.
        """
        svc = service.lower().strip()
        if svc not in VALID_SERVICES:
            raise GoogleOAuthError(f"Unsupported Google service: {service}")

        # Validate cryptographic secret
        try:
            derive_oauth_subkeys()
        except (OAuthCryptoKeyMissingError, OAuthCryptoKeyInvalidError) as e:
            raise GoogleOAuthConfigError(f"OAuth configuration error: {str(e)}") from e

        client_id = settings.get_google_client_id(svc)
        if not client_id:
            raise GoogleOAuthConfigError(
                f"Google Client ID is not configured for {svc}. Please set GOOGLE_{svc.upper()}_CLIENT_ID."
            )

        redirect_uri = self.get_redirect_uri(svc)
        scopes = self.get_default_scopes(svc, include_read=include_read)
        scope_str = " ".join(scopes)

        # 16-byte random nonce and 10-minute TTL
        nonce = secrets.token_hex(16)
        expires_at_ts = datetime.now(UTC).timestamp() + 600
        expires_at_iso = datetime.fromtimestamp(expires_at_ts, UTC).isoformat()

        # Persist nonce for atomic consumption
        oauth_token_repo.save_state_nonce(
            nonce=nonce,
            user_id=user_id,
            service=svc,
            expires_at_iso=expires_at_iso,
        )

        state = sign_oauth_state(
            user_id=user_id,
            service=svc,
            nonce=nonce,
            expires_at_ts=expires_at_ts,
        )

        params = {
            "client_id": client_id,
            "redirect_uri": redirect_uri,
            "response_type": "code",
            "scope": scope_str,
            "access_type": "offline",
            "prompt": prompt,
            "state": state,
        }
        if include_read:
            params["include_granted_scopes"] = "true"

        auth_url = f"{GOOGLE_AUTH_URL}?{urllib.parse.urlencode(params)}"
        return {
            "authorizationUrl": auth_url,
            "service": svc,
            "requestedScope": scope_str,
            "redirectUri": redirect_uri,
        }

    async def handle_callback(
        self,
        service: str,
        code: str,
        state: str,
        error: str | None = None,
    ) -> dict[str, Any]:
        """Validate state, consume nonce atomically, exchange code for tokens, and vault them."""
        svc = service.lower().strip()
        if svc not in VALID_SERVICES:
            raise GoogleOAuthError(f"Unsupported Google service: {service}")

        if error:
            logger.warning(f"Google OAuth authorization denied for {svc}: {error}")
            return {
                "success": False,
                "service": svc,
                "error": error,
                "message": f"Authorization was denied or cancelled by the user: {error}",
            }

        # 1. Cryptographic state verification
        verified = verify_oauth_state(state, expected_service=svc)
        user_id = str(verified["userId"])
        nonce = str(verified["nonce"])

        # 2. Atomic single-use state consumption (concurrency & replay protection)
        oauth_token_repo.consume_state_nonce(
            nonce=nonce,
            expected_user_id=user_id,
            expected_service=svc,
        )

        # 3. Exchange authorization code for tokens
        client_id = settings.get_google_client_id(svc)
        client_secret = settings.get_google_client_secret(svc)
        if not client_id or not client_secret:
            raise GoogleOAuthConfigError(f"OAuth credentials incomplete for {svc}.")

        redirect_uri = self.get_redirect_uri(svc)

        async with self._get_client() as client:
            token_res = await client.post(
                GOOGLE_TOKEN_URL,
                data={
                    "client_id": client_id,
                    "client_secret": client_secret,
                    "code": code,
                    "grant_type": "authorization_code",
                    "redirect_uri": redirect_uri,
                },
            )

            if token_res.status_code != 200:
                logger.error(f"Google token exchange failed for {svc}: {token_res.status_code} {token_res.text}")
                raise GoogleOAuthError(f"Token exchange failed: {token_res.text}")

            token_data = token_res.json()
            access_token = token_data.get("access_token")
            refresh_token = token_data.get("refresh_token")
            expires_in = token_data.get("expires_in", 3600)
            granted_scope = token_data.get("scope", "")

            exp_timestamp = datetime.now(UTC).timestamp() + expires_in
            expiry_iso = datetime.fromtimestamp(exp_timestamp, UTC).isoformat()

            # 4. Probe service metadata (Account email, calendar summary, storage quota)
            metadata: dict[str, Any] = {}
            account_email = None

            # Fetch common identity email via userinfo
            try:
                userinfo_res = await client.get(
                    USERINFO_URL,
                    headers={"Authorization": f"Bearer {access_token}"},
                )
                if userinfo_res.status_code == 200:
                    userinfo = userinfo_res.json()
                    account_email = userinfo.get("email")
                    metadata["name"] = userinfo.get("name")
                    metadata["picture"] = userinfo.get("picture")
            except Exception as e:
                logger.warning(f"Could not fetch userinfo for {svc}: {e}")

            # Service-specific metadata probes
            if svc == "gmail":
                try:
                    profile_res = await client.get(
                        GMAIL_PROFILE_URL,
                        headers={"Authorization": f"Bearer {access_token}"},
                    )
                    if profile_res.status_code == 200:
                        pdata = profile_res.json()
                        account_email = pdata.get("emailAddress") or account_email
                        metadata["messagesTotal"] = pdata.get("messagesTotal")
                        metadata["threadsTotal"] = pdata.get("threadsTotal")
                except Exception as e:
                    logger.warning(f"Could not fetch Gmail profile: {e}")

            elif svc == "calendar":
                try:
                    cal_res = await client.get(
                        CALENDAR_EVENTS_URL,
                        headers={"Authorization": f"Bearer {access_token}"},
                    )
                    if cal_res.status_code == 200:
                        cal_data = cal_res.json()
                        metadata["calendarSummary"] = cal_data.get("summary") or "Primary"
                        metadata["timeZone"] = cal_data.get("timeZone")
                except Exception as e:
                    logger.warning(f"Could not fetch Primary Calendar metadata: {e}")

            elif svc == "drive":
                try:
                    drive_res = await client.get(
                        DRIVE_ABOUT_URL,
                        headers={"Authorization": f"Bearer {access_token}"},
                    )
                    if drive_res.status_code == 200:
                        drive_data = drive_res.json()
                        quota = drive_data.get("storageQuota", {})
                        metadata["storageLimit"] = quota.get("limit")
                        metadata["storageUsage"] = quota.get("usage")
                        metadata["storageUsageInDrive"] = quota.get("usageInDrive")
                except Exception as e:
                    logger.warning(f"Could not fetch Drive storage metadata: {e}")

            # 5. Vault credentials encrypted at rest with refresh token preservation
            oauth_token_repo.save_tokens(
                user_id=user_id,
                access_token=access_token,
                refresh_token=refresh_token,
                expiry=expiry_iso,
                scope=granted_scope,
                account_email=account_email,
                provider=svc,
                health_status="OPERATIONAL",
                metadata=metadata,
            )

        return {
            "success": True,
            "service": svc,
            "userId": user_id,
            "accountEmail": account_email,
            "scope": granted_scope,
            "metadata": metadata,
        }

    async def get_valid_access_token(self, user_id: str, service: str) -> str:
        """Retrieve a valid access token for service, refreshing if needed with distributed locking.

        Safety Invariants:
        - In-process and multi-worker distributed lease coordination.
        - Preserves existing refresh token when Google omits one.
        - Transitions to NEEDS_REAUTHORIZATION on invalid_grant.
        - Never returns an expired token.
        """
        svc = service.lower().strip()
        token_data = oauth_token_repo.get_decrypted_tokens(user_id, provider=svc)
        if not token_data or not token_data.get("accessToken"):
            raise GoogleNotConnectedError(f"Google {svc.capitalize()} is not connected. Please authorize in Settings.")

        access_token = token_data["accessToken"]
        refresh_token = token_data.get("refreshToken")
        expiry = token_data.get("tokenExpiry")

        # Check expiration with 60-second safety buffer
        is_expired = False
        if expiry:
            try:
                exp_dt = datetime.fromisoformat(expiry)
                now_dt = datetime.now(UTC)
                if (exp_dt - now_dt).total_seconds() < 60:
                    is_expired = True
            except Exception:
                is_expired = True

        if not is_expired:
            return access_token

        if not refresh_token:
            oauth_token_repo.update_health_status(user_id, svc, "NEEDS_REAUTHORIZATION")
            raise GoogleReauthorizationRequiredError(
                f"Google {svc.capitalize()} authorization expired and no refresh token is stored. Please reauthorize."
            )

        # Multi-worker coordinated refresh via Firestore distributed lease
        worker_id = f"worker_{os.getpid()}_{uuid.uuid4().hex[:8]}"
        max_attempts = 10
        attempt = 0

        while attempt < max_attempts:
            attempt += 1
            acquired = oauth_token_repo.acquire_refresh_lease(
                user_id=user_id,
                provider=svc,
                worker_id=worker_id,
                lease_duration_sec=30,
            )

            if acquired:
                try:
                    client_id = settings.get_google_client_id(svc)
                    client_secret = settings.get_google_client_secret(svc)
                    if not client_id or not client_secret:
                        raise GoogleOAuthConfigError(f"OAuth credentials incomplete for {svc}.")

                    async with self._get_client() as client:
                        res = await client.post(
                            GOOGLE_TOKEN_URL,
                            data={
                                "client_id": client_id,
                                "client_secret": client_secret,
                                "refresh_token": refresh_token,
                                "grant_type": "refresh_token",
                            },
                        )

                        if res.status_code == 200:
                            data = res.json()
                            new_access = data["access_token"]
                            new_refresh = data.get("refresh_token")
                            expires_in = data.get("expires_in", 3600)
                            exp_ts = datetime.now(UTC).timestamp() + expires_in
                            new_exp_iso = datetime.fromtimestamp(exp_ts, UTC).isoformat()
                            granted_scope = data.get("scope") or token_data.get("scope") or ""

                            oauth_token_repo.save_tokens(
                                user_id=user_id,
                                access_token=new_access,
                                refresh_token=new_refresh,  # repo preserves existing if None
                                expiry=new_exp_iso,
                                scope=granted_scope,
                                account_email=token_data.get("accountEmail"),
                                provider=svc,
                                health_status="OPERATIONAL",
                                metadata=token_data.get("metadata"),
                            )
                            return new_access

                        elif res.status_code == 400 and "invalid_grant" in res.text:
                            logger.warning(f"Google {svc} refresh returned invalid_grant; user revoked consent.")
                            oauth_token_repo.update_health_status(user_id, svc, "NEEDS_REAUTHORIZATION")
                            raise GoogleReauthorizationRequiredError(
                                f"Google {svc.capitalize()} access has been revoked on your Google account. Please reconnect."
                            )
                        else:
                            logger.error(f"Google {svc} token refresh failed ({res.status_code}): {res.text}")
                            raise GoogleTokenRefreshError(f"Failed to refresh Google token: {res.text}")

                finally:
                    oauth_token_repo.release_refresh_lease(user_id, svc, worker_id)

            else:
                # Another worker is actively refreshing; back off and poll
                await asyncio.sleep(0.5)
                # Check if other worker updated the token
                updated_tokens = oauth_token_repo.get_decrypted_tokens(user_id, provider=svc)
                if updated_tokens and updated_tokens.get("tokenExpiry"):
                    try:
                        updated_exp = datetime.fromisoformat(updated_tokens["tokenExpiry"])
                        if (updated_exp - datetime.now(UTC)).total_seconds() > 60:
                            return updated_tokens["accessToken"]
                    except Exception:
                        pass

        raise GoogleTokenRefreshError(
            f"Timed out waiting for concurrent worker to refresh Google {svc} token."
        )

    async def test_connection(self, user_id: str, service: str) -> dict[str, Any]:
        """Test live operational connectivity for a connected service.

        Performs a lightweight probe and measures roundtrip latency.
        """
        svc = service.lower().strip()
        start_time = time.perf_counter()

        access_token = await self.get_valid_access_token(user_id, svc)

        async with self._get_client() as client:
            headers = {"Authorization": f"Bearer {access_token}"}
            details: dict[str, Any] = {}

            if svc == "gmail":
                res = await client.get(GMAIL_PROFILE_URL, headers=headers)
                if res.status_code != 200:
                    raise GoogleOAuthError(f"Gmail probe failed with HTTP {res.status_code}: {res.text}")
                data = res.json()
                details["email"] = data.get("emailAddress")
                details["messagesTotal"] = data.get("messagesTotal")

            elif svc == "calendar":
                res = await client.get(CALENDAR_EVENTS_URL, headers=headers)
                if res.status_code != 200:
                    raise GoogleOAuthError(f"Calendar probe failed with HTTP {res.status_code}: {res.text}")
                data = res.json()
                details["summary"] = data.get("summary") or "Primary"
                details["calendarSummary"] = data.get("summary") or "Primary"
                details["timeZone"] = data.get("timeZone")

            elif svc == "drive":
                res = await client.get(DRIVE_ABOUT_URL, headers=headers)
                if res.status_code != 200:
                    raise GoogleOAuthError(f"Drive probe failed with HTTP {res.status_code}: {res.text}")
                data = res.json()
                details["user"] = data.get("user", {}).get("emailAddress")
                details["storageQuota"] = data.get("storageQuota")

            else:
                raise GoogleOAuthError(f"Unsupported service: {service}")

            latency_ms = int((time.perf_counter() - start_time) * 1000)
            return {
                "status": "OPERATIONAL",
                "service": svc,
                "latencyMs": latency_ms,
                "details": details,
                "verifiedAt": datetime.now(UTC).isoformat(),
            }

    async def disconnect_service(self, user_id: str, service: str) -> dict[str, Any]:
        """Safely disconnect a service with confirmed Google-side revocation and truthful status.

        Status Machine Outcomes:
        - DISCONNECTED_AND_REVOKED: Google confirmed revocation with HTTP 200.
        - DISCONNECTED_ALREADY_INACTIVE: Google returned HTTP 400 invalid_token (was already inactive).
        - DISCONNECTED_LOCAL_ONLY_WARNING: Google returned network timeout / 5xx error.
        Always deletes local credentials from Firestore.
        """
        svc = service.lower().strip()
        token_data = oauth_token_repo.get_decrypted_tokens(user_id, provider=svc)

        if not token_data:
            return {
                "status": "DISCONNECTED_ALREADY_INACTIVE",
                "service": svc,
                "message": f"Google {svc.capitalize()} was already disconnected.",
            }

        # Prefer refresh token for full grant revocation; fallback to access token
        revoke_target = token_data.get("refreshToken") or token_data.get("accessToken")
        result_status = "DISCONNECTED_AND_REVOKED"
        ui_message = f"Google {svc.capitalize()} successfully disconnected and revoked with Google."

        if revoke_target:
            try:
                async with self._get_client() as client:
                    res = await client.post(
                        GOOGLE_REVOKE_URL,
                        params={"token": revoke_target},
                        headers={"Content-Type": "application/x-www-form-urlencoded"},
                    )

                    if res.status_code == 200:
                        result_status = "DISCONNECTED_AND_REVOKED"
                        ui_message = f"Google {svc.capitalize()} successfully disconnected and revoked with Google."
                    elif res.status_code == 400:
                        result_status = "DISCONNECTED_ALREADY_INACTIVE"
                        ui_message = f"Google {svc.capitalize()} disconnected. Permissions were already inactive on Google."
                    else:
                        result_status = "DISCONNECTED_LOCAL_ONLY_WARNING"
                        ui_message = (
                            f"Google {svc.capitalize()} disconnected locally. Google returned error ({res.status_code}). "
                            "Please verify permissions at myaccount.google.com/permissions."
                        )
            except (httpx.TimeoutException, httpx.NetworkError) as e:
                logger.warning(f"Google revocation network failure for {svc}: {e}")
                result_status = "DISCONNECTED_LOCAL_ONLY_WARNING"
                ui_message = (
                    f"Google {svc.capitalize()} disconnected locally. Could not reach Google to confirm revocation (network timeout). "
                    "Please verify permissions at myaccount.google.com/permissions."
                )
            except Exception as e:
                logger.error(f"Unexpected error during Google revocation for {svc}: {e}")
                result_status = "DISCONNECTED_LOCAL_ONLY_WARNING"
                ui_message = (
                    f"Google {svc.capitalize()} disconnected locally. Revocation check failed: {str(e)}."
                )

        # Always purge local tokens for user privacy
        oauth_token_repo.disconnect(user_id, provider=svc)

        return {
            "status": result_status,
            "service": svc,
            "message": ui_message,
        }

    def get_service_status(self, user_id: str, service: str) -> ServiceStatusResponse:
        """Return safe, non-leaking connection status for the service card."""
        svc = service.lower().strip()
        record = oauth_token_repo.get_record(user_id, provider=svc)

        if not record:
            return ServiceStatusResponse(
                service=svc,
                isConnected=False,
                healthStatus="DISCONNECTED",
            )

        granted_scope = record.scope or ""
        return ServiceStatusResponse(
            service=svc,
            isConnected=True,
            healthStatus=record.healthStatus or "OPERATIONAL",
            accountEmail=record.accountEmail or record.gmailAddress,
            scope=record.scope,
            connectedAt=record.connectedAt,
            details=record.metadata or {},
            hasSendPermission=settings.GMAIL_SEND_SCOPE in granted_scope,
            hasReadPermission=settings.GMAIL_READ_SCOPE in granted_scope,
        )


google_oauth_service = GoogleOAuthService()
