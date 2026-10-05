"""AI Settings & Credential Management REST API Router."""

import logging
from typing import Any

from fastapi import APIRouter, Depends, status

from app.core.auth import get_authenticated_user_id
from app.schemas.ai_settings import (
    AISettingsResponse,
    AISettingsUpdateRequest,
    CredentialCreateRequest,
    CredentialResponse,
    CredentialStatusUpdateRequest,
    CredentialUpdateRequest,
)
from app.schemas.ai_telemetry import (
    AIHealthResponse,
    ModelCatalogItemDTO,
    ProbeRequest,
    ProbeResponse,
    TelemetryResponse,
)
from app.services.ai_settings_service import ai_settings_service

logger = logging.getLogger("jobFinder.api.v1.ai_settings")

router = APIRouter(prefix="/ai", tags=["AI Settings & Credentials"])


@router.get(
    "/credentials",
    response_model=list[CredentialResponse],
    summary="List user credentials",
    description="Retrieve all AI provider credentials registered by the authenticated user with masked API keys.",
)
async def list_credentials(
    user_id: str = Depends(get_authenticated_user_id),
) -> list[CredentialResponse]:
    return ai_settings_service.list_credentials(user_id)


@router.post(
    "/credentials",
    response_model=CredentialResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Register a new provider credential",
    description="Securely encrypts and stores an API key using AES-256-GCM. Raw key is never stored or returned.",
)
async def create_credential(
    request: CredentialCreateRequest,
    user_id: str = Depends(get_authenticated_user_id),
) -> CredentialResponse:
    return ai_settings_service.create_credential(user_id, request)


@router.get(
    "/credentials/{credential_id}",
    response_model=CredentialResponse,
    summary="Get credential metadata",
    description="Retrieve safe masked metadata for a specific credential owned by the authenticated user.",
)
async def get_credential(
    credential_id: str,
    user_id: str = Depends(get_authenticated_user_id),
) -> CredentialResponse:
    return ai_settings_service.get_credential(user_id, credential_id)


@router.put(
    "/credentials/{credential_id}",
    response_model=CredentialResponse,
    summary="Update credential metadata or replace API key",
    description="Updates credential properties. If a new API key is provided, it is securely re-encrypted.",
)
async def update_credential(
    credential_id: str,
    request: CredentialUpdateRequest,
    user_id: str = Depends(get_authenticated_user_id),
) -> CredentialResponse:
    return ai_settings_service.update_credential(user_id, credential_id, request)


@router.patch(
    "/credentials/{credential_id}/status",
    response_model=CredentialResponse,
    summary="Enable or disable a credential",
    description="Toggle the operational state of a credential without deleting it.",
)
async def update_credential_status(
    credential_id: str,
    request: CredentialStatusUpdateRequest,
    user_id: str = Depends(get_authenticated_user_id),
) -> CredentialResponse:
    return ai_settings_service.update_credential_status(user_id, credential_id, request.enabled)


@router.delete(
    "/credentials/{credential_id}",
    summary="Delete a credential",
    description="Permanently delete a credential record owned by the authenticated user.",
)
async def delete_credential(
    credential_id: str,
    user_id: str = Depends(get_authenticated_user_id),
) -> dict[str, Any]:
    ai_settings_service.delete_credential(user_id, credential_id)
    return {"deleted": True, "credentialId": credential_id}


@router.get(
    "/settings",
    response_model=AISettingsResponse,
    summary="Get user AI settings",
    description="Retrieve user AI routing preferences, provider priority, and cost enforcement policies.",
)
async def get_settings(
    user_id: str = Depends(get_authenticated_user_id),
) -> AISettingsResponse:
    return ai_settings_service.get_settings(user_id)


@router.put(
    "/settings",
    response_model=AISettingsResponse,
    summary="Update user AI settings",
    description="Update user AI routing preferences, cost policy, and paid fallback permissions.",
)
async def update_settings(
    request: AISettingsUpdateRequest,
    user_id: str = Depends(get_authenticated_user_id),
) -> AISettingsResponse:
    return ai_settings_service.update_settings(user_id, request)


@router.post(
    "/credentials/{credential_id}/probe",
    response_model=ProbeResponse,
    summary="Probe an AI credential connection",
    description="Executes a minimal safe ping request against the provider using the user's credential. Returns safe latency and operational status.",
)
async def probe_credential(
    credential_id: str,
    request: ProbeRequest | None = None,
    user_id: str = Depends(get_authenticated_user_id),
) -> ProbeResponse:
    return await ai_settings_service.probe_credential(user_id, credential_id, request)


@router.get(
    "/health",
    response_model=AIHealthResponse,
    summary="Get runtime AI health and cooldown diagnostics",
    description="Retrieve per-user runtime health status, active cooldowns, and provider operational states.",
)
async def get_health(
    user_id: str = Depends(get_authenticated_user_id),
) -> AIHealthResponse:
    return ai_settings_service.get_health_status(user_id)


@router.get(
    "/models",
    response_model=list[ModelCatalogItemDTO],
    summary="List available AI models",
    description="Retrieve the catalog of supported models across all registered provider adapters with capabilities and cost tiers.",
)
async def get_models(
    user_id: str = Depends(get_authenticated_user_id),
) -> list[ModelCatalogItemDTO]:
    return ai_settings_service.get_model_catalog()


@router.get(
    "/telemetry",
    response_model=TelemetryResponse,
    summary="Get user AI execution telemetry",
    description="Retrieve aggregated statistics and recent execution records scoped strictly to the authenticated user.",
)
async def get_telemetry(
    limit: int = 50,
    user_id: str = Depends(get_authenticated_user_id),
) -> TelemetryResponse:
    return ai_settings_service.get_telemetry_summary(user_id, limit=min(limit, 100))
