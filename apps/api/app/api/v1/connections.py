"""Google Third-Party Connections API Endpoints (Gmail, Calendar, Drive).

Provides unified management for Google Workspace connections:
- GET  /api/v1/connections/google/{service}/authorize
- GET  /api/v1/connections/google/{service}/callback
- GET  /api/v1/connections/google/{service}/status
- POST /api/v1/connections/google/{service}/test
- POST /api/v1/connections/google/{service}/disconnect
- GET  /api/v1/connections/google/gmail/upgrade-tracking
"""

import logging
import urllib.parse

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import RedirectResponse

from app.core.auth import get_authenticated_user_id
from app.core.config import settings
from app.services.google_oauth_service import (
    GoogleOAuthConfigError,
    GoogleOAuthError,
    GoogleReauthorizationRequiredError,
    ServiceStatusResponse,
    google_oauth_service,
)

logger = logging.getLogger("jobFinder.api.connections")
router = APIRouter(prefix="/connections", tags=["Third-Party Connections"])


def _get_frontend_base_url() -> str:
    """Return the frontend URL from CORS origins or standard dev port."""
    if settings.CORS_ORIGINS:
        first = settings.CORS_ORIGINS[0].rstrip("/")
        if first.startswith("http"):
            return first
    return "http://localhost:5173"


@router.get("/google/{service}/authorize")
async def get_google_authorization_url(
    service: str,
    include_read: bool = Query(
        default=False,
        description="Request incremental gmail.readonly permission for reply tracking",
    ),
    user_id: str = Depends(get_authenticated_user_id),
):
    """Generate Google OAuth 2.0 authorization URL with signed state and atomic nonce."""
    try:
        result = google_oauth_service.get_authorization_url(
            user_id=user_id,
            service=service,
            include_read=include_read,
        )
        return result
    except GoogleOAuthConfigError as e:
        logger.error(f"Google OAuth config error for {service}: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(e),
        ) from e
    except GoogleOAuthError as e:
        logger.error(f"Google OAuth error for {service}: {e}")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        ) from e


@router.get("/google/gmail/upgrade-tracking")
async def upgrade_gmail_tracking(
    user_id: str = Depends(get_authenticated_user_id),
):
    """Convenience endpoint to request incremental gmail.readonly scope for reply tracking."""
    return await get_google_authorization_url(
        service="gmail",
        include_read=True,
        user_id=user_id,
    )


@router.get("/google/{service}/callback")
async def google_oauth_callback(
    service: str,
    code: str = Query(default=""),
    state: str = Query(default=""),
    error: str | None = Query(default=None),
):
    """Handle Google OAuth 2.0 callback, exchange code, vault tokens, and redirect to frontend."""
    frontend_base = _get_frontend_base_url()
    svc = service.lower().strip()

    if error:
        logger.warning(f"Google OAuth authorization denied for {svc}: {error}")
        target = f"{frontend_base}/#settings?tab=connections&service={svc}&status=error&error={urllib.parse.quote(error)}"
        return RedirectResponse(url=target)

    if not code or not state:
        logger.error(f"Missing code or state in Google OAuth callback for {svc}")
        target = f"{frontend_base}/#settings?tab=connections&service={svc}&status=error&error={urllib.parse.quote('Missing authorization code or state parameter')}"
        return RedirectResponse(url=target)

    try:
        await google_oauth_service.handle_callback(
            service=svc,
            code=code,
            state=state,
            error=error,
        )
        target = f"{frontend_base}/#settings?tab=connections&service={svc}&status=success"
        return RedirectResponse(url=target)

    except Exception as e:
        logger.error(f"Callback handling failed for {svc}: {e}")
        error_msg = str(e)
        target = f"{frontend_base}/#settings?tab=connections&service={svc}&status=error&error={urllib.parse.quote(error_msg)}"
        return RedirectResponse(url=target)


@router.get("/google/{service}/status", response_model=ServiceStatusResponse)
async def get_service_status(
    service: str,
    user_id: str = Depends(get_authenticated_user_id),
):
    """Check connection status, health status, and metadata for a Google integration."""
    return google_oauth_service.get_service_status(user_id=user_id, service=service)


@router.post("/google/{service}/test")
async def test_service_connection(
    service: str,
    user_id: str = Depends(get_authenticated_user_id),
):
    """Perform a live probe to verify operational health and measure latency."""
    try:
        result = await google_oauth_service.test_connection(user_id=user_id, service=service)
        return result
    except GoogleReauthorizationRequiredError as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=str(e),
        ) from e
    except Exception as e:
        logger.error(f"Connection test failed for {service}: {e}")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Connection test failed: {str(e)}",
        ) from e


@router.post("/google/{service}/disconnect")
async def disconnect_service(
    service: str,
    user_id: str = Depends(get_authenticated_user_id),
):
    """Safely disconnect integration, revoke permissions with Google, and purge local credentials."""
    return await google_oauth_service.disconnect_service(user_id=user_id, service=service)
