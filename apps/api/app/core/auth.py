"""Authoritative Authentication Dependencies for JobFinder API."""

import logging

from fastapi import Header, HTTPException, status
from firebase_admin import auth as firebase_auth

from app.core.config import settings

logger = logging.getLogger("jobFinder.core.auth")


async def get_authenticated_user_id(
    authorization: str | None = Header(default=None),
    x_user_id: str | None = Header(default=None, alias="X-User-Id"),
) -> str:
    """Extract authoritative user identity from Firebase Auth Bearer token."""
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing or invalid authentication credentials.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    token = authorization.split("Bearer ")[1].strip()
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing or invalid authentication credentials.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    try:
        decoded_token = firebase_auth.verify_id_token(token)
        uid = decoded_token.get("uid")
        if not uid:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid token payload: missing user ID.",
            )
        if x_user_id and x_user_id != uid:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Client-supplied user ID conflicts with authenticated identity.",
            )
        return uid
    except HTTPException:
        raise
    except Exception as e:
        logger.warning(f"Firebase token verification failed: {e}")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired authentication token.",
            headers={"WWW-Authenticate": "Bearer"},
        ) from e


async def get_optional_authenticated_user_id(
    authorization: str | None = Header(default=None),
    x_user_id: str | None = Header(default=None, alias="X-User-Id"),
) -> str | None:
    """Extract authenticated user identity if credentials are provided.

    Returns:
        - None: If no Authorization header is provided (and no X-User-Id spoofing attempted).
        - str (UID): If a valid Firebase ID token is provided and matches any supplied X-User-Id.

    Raises:
        - HTTPException(401): If an Authorization header is provided but is malformed, invalid,
          expired, forged, or unverifiable. Never silently falls back to guest access.
        - HTTPException(403): If client-supplied X-User-Id conflicts with the authenticated identity,
          or if X-User-Id is supplied without an Authorization header (unverifiable identity claim).
    """
    if authorization is None:
        if x_user_id is not None:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Unauthenticated client cannot specify X-User-Id header.",
            )
        return None

    # If Authorization header was supplied, it MUST be valid.
    # Strictly delegate to get_authenticated_user_id to ensure identical verification logic.
    return await get_authenticated_user_id(authorization=authorization, x_user_id=x_user_id)

