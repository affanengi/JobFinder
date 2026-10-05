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
    """Extract authoritative user identity from Firebase Auth token or safe dev fallback."""
    if authorization and authorization.startswith("Bearer "):
        token = authorization.split("Bearer ")[1].strip()
        if token:
            try:
                decoded_token = firebase_auth.verify_id_token(token)
                uid = decoded_token.get("uid")
                if uid:
                    if x_user_id and x_user_id != uid:
                        raise HTTPException(
                            status_code=status.HTTP_403_FORBIDDEN,
                            detail="Client-supplied user ID conflicts with authenticated identity.",
                        )
                    return uid
            except HTTPException:
                raise
            except Exception as e:
                logger.debug(f"Firebase token verification failed: {e}")
                if settings.ENVIRONMENT != "development":
                    raise HTTPException(
                        status_code=status.HTTP_401_UNAUTHORIZED,
                        detail="Invalid or expired authentication token.",
                    ) from e

    # In local development mode, allow fallback to verified user or header
    if settings.ENVIRONMENT == "development":
        return x_user_id or "Sf0isG4mUuXwTQTWWwG1Wf4aIM82"

    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Missing or invalid authentication credentials.",
    )
