"""Service managing AI Settings, encrypted credential lifecycle, and profile integration."""

import logging
import time
import uuid
from datetime import UTC, datetime
from typing import Any

from fastapi import HTTPException, status

from app.ai.errors import (
    AIAuthenticationError,
    AIConfigurationError,
    AIRateLimitError,
)
from app.ai.hub.crypto import (
    CryptoError,
    decrypt_api_key,
    encrypt_api_key,
    mask_api_key,
    sanitize_text,
)
from app.ai.hub.models import (
    ProjectScope,
    UserAIProfile,
    UserCredential,
)
from app.ai.hub.types import (
    AITaskType,
    CostPolicy,
    CostTier,
    CredentialHealth,
    CredentialTier,
    ProviderType,
    ScopeType,
)
from app.db.repositories.ai_credential_repo import (
    AICredentialRepository,
    ai_credential_repo,
)
from app.db.repositories.ai_telemetry_repo import (
    ai_telemetry_repo,
)
from app.schemas.ai_settings import (
    AISettingsResponse,
    AISettingsUpdateRequest,
    CredentialCreateRequest,
    CredentialResponse,
    CredentialUpdateRequest,
    ProjectScopeDTO,
)
from app.schemas.ai_telemetry import (
    ActiveCooldownDTO,
    AIHealthResponse,
    ExecutionTelemetryDTO,
    ModelCatalogItemDTO,
    ProbeRequest,
    ProbeResponse,
    ProviderHealthDTO,
    TelemetryResponse,
    TelemetrySummaryDTO,
)

logger = logging.getLogger("jobFinder.services.ai_settings")


class AISettingsService:
    """Service layer enforcing business validation, AES-256-GCM encryption, and safe metadata exposure."""

    def __init__(self, repo: AICredentialRepository | None = None):
        self.repo = repo or ai_credential_repo

    def create_credential(
        self, user_id: str, request: CredentialCreateRequest
    ) -> CredentialResponse:
        """Create and store an encrypted user credential in Firestore."""
        raw_key = request.apiKey.strip()
        if not raw_key:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="API key cannot be empty or whitespace.",
            )

        # Encrypt the raw key with AES-256-GCM
        try:
            encrypted_payload = encrypt_api_key(raw_key)
        except CryptoError as e:
            logger.error(f"Cryptographic failure while encrypting key for user {user_id}: {e}")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Internal encryption error while securing credential.",
            ) from e

        masked_key = mask_api_key(raw_key)
        cred_id = f"cred_{uuid.uuid4().hex[:12]}"
        now_iso = datetime.now(UTC).isoformat()

        # Build ProjectScope metadata
        if request.projectScope:
            scope_dict = {
                "scope_id": request.projectScope.scope_id,
                "scope_type": request.projectScope.scope_type.value,
                "verified": request.projectScope.verified,
            }
        else:
            scope_dict = {
                "scope_id": f"synth_{uuid.uuid4().hex[:8]}",
                "scope_type": ScopeType.UNVERIFIED_UNIQUE.value,
                "verified": False,
            }

        # Determine server-authoritative friendly name if omitted
        raw_name = request.friendlyName.strip() if request.friendlyName else ""
        if not raw_name:
            if request.provider == ProviderType.GEMINI:
                prefix = "Gemini API Key"
            elif request.provider == ProviderType.OPENROUTER:
                prefix = "OpenRouter Key"
            elif request.provider == ProviderType.GROQ:
                prefix = "Groq Key"
            else:
                prefix = f"{request.provider.value.capitalize()} Key"

            try:
                existing_creds = self.repo.list_credentials(user_id)
            except Exception:
                existing_creds = []
            provider_creds = [
                c for c in existing_creds if c.get("provider") == request.provider.value
            ]
            import re

            pattern = re.compile(rf"^{re.escape(prefix)}\s+(\d+)$", re.IGNORECASE)
            used_numbers = set()
            for c in provider_creds:
                c_name = c.get("friendlyName", "").strip()
                match = pattern.match(c_name)
                if match:
                    try:
                        used_numbers.add(int(match.group(1)))
                    except ValueError:
                        pass
            next_num = 1
            while next_num in used_numbers:
                next_num += 1
            friendly_name = f"{prefix} {next_num}"
        else:
            friendly_name = raw_name

        doc_data: dict[str, Any] = {
            "credentialId": cred_id,
            "userId": user_id,
            "provider": request.provider.value,
            "friendlyName": friendly_name,
            "encryptedApiKey": encrypted_payload,
            "maskedApiKey": masked_key,
            "projectScope": scope_dict,
            "costTier": request.costTier.value,
            "enabled": request.enabled,
            "createdAt": now_iso,
            "updatedAt": now_iso,
        }

        doc_data.pop("apiKey", None)
        doc_data.pop("decryptedKey", None)
        doc_data.pop("decrypted_key", None)
        doc_data.pop("rawKey", None)

        try:
            self.repo.save_credential(user_id, cred_id, doc_data)
        except Exception as e:
            logger.error(f"Failed to save credential for user {user_id}: {e}")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Database error: Failed to save credential in Firestore.",
            ) from e

        return CredentialResponse(
            credentialId=cred_id,
            userId=user_id,
            provider=request.provider,
            friendlyName=doc_data["friendlyName"],
            maskedApiKey=masked_key,
            projectScope=ProjectScopeDTO(
                scope_id=str(scope_dict["scope_id"]),
                scope_type=ScopeType(str(scope_dict["scope_type"])),
                verified=bool(scope_dict["verified"]),
            ),
            costTier=request.costTier,
            enabled=request.enabled,
            createdAt=now_iso,
            updatedAt=now_iso,
        )

    def get_credential(self, user_id: str, credential_id: str) -> CredentialResponse:
        """Retrieve safe credential metadata for the authenticated user."""
        try:
            data = self.repo.get_credential(user_id, credential_id)
        except Exception as e:
            logger.error(f"Failed to get credential {credential_id} for user {user_id}: {e}")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Database error: Failed to retrieve credential.",
            ) from e

        if not data:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Credential {credential_id} not found.",
            )

        scope_raw = data.get("projectScope", {})
        return CredentialResponse(
            credentialId=data["credentialId"],
            userId=data["userId"],
            provider=ProviderType(data["provider"]),
            friendlyName=data["friendlyName"],
            maskedApiKey=data["maskedApiKey"],
            projectScope=ProjectScopeDTO(
                scope_id=scope_raw.get("scope_id", "default_scope"),
                scope_type=ScopeType(
                    scope_raw.get("scope_type", ScopeType.UNVERIFIED_UNIQUE.value)
                ),
                verified=scope_raw.get("verified", False),
            ),
            costTier=CredentialTier(data.get("costTier", CredentialTier.FREE_TIER.value)),
            enabled=data.get("enabled", True),
            createdAt=data.get("createdAt", ""),
            updatedAt=data.get("updatedAt", ""),
        )

    def list_credentials(self, user_id: str) -> list[CredentialResponse]:
        """List all credentials for the authenticated user with masked keys."""
        try:
            items = self.repo.list_credentials(user_id)
        except Exception as e:
            logger.error(f"Failed to list credentials for user {user_id}: {e}")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Database error: Failed to list credentials.",
            ) from e

        responses: list[CredentialResponse] = []
        for data in items:
            scope_raw = data.get("projectScope", {})
            responses.append(
                CredentialResponse(
                    credentialId=data["credentialId"],
                    userId=data["userId"],
                    provider=ProviderType(data["provider"]),
                    friendlyName=data["friendlyName"],
                    maskedApiKey=data["maskedApiKey"],
                    projectScope=ProjectScopeDTO(
                        scope_id=scope_raw.get("scope_id", "default_scope"),
                        scope_type=ScopeType(
                            scope_raw.get("scope_type", ScopeType.UNVERIFIED_UNIQUE.value)
                        ),
                        verified=scope_raw.get("verified", False),
                    ),
                    costTier=CredentialTier(data.get("costTier", CredentialTier.FREE_TIER.value)),
                    enabled=data.get("enabled", True),
                    createdAt=data.get("createdAt", ""),
                    updatedAt=data.get("updatedAt", ""),
                )
            )
        return responses

    def update_credential(
        self, user_id: str, credential_id: str, request: CredentialUpdateRequest
    ) -> CredentialResponse:
        """Update metadata or replace the secret key for an existing credential."""
        try:
            data = self.repo.get_credential(user_id, credential_id)
        except Exception as e:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Database error: Failed to retrieve credential for update.",
            ) from e

        if not data:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Credential {credential_id} not found.",
            )

        now_iso = datetime.now(UTC).isoformat()
        updates = dict(data)
        updates["updatedAt"] = now_iso

        if request.friendlyName is not None:
            updates["friendlyName"] = request.friendlyName.strip()

        if request.costTier is not None:
            updates["costTier"] = request.costTier.value

        if request.enabled is not None:
            updates["enabled"] = request.enabled

        if request.projectScope is not None:
            updates["projectScope"] = {
                "scope_id": request.projectScope.scope_id,
                "scope_type": request.projectScope.scope_type.value,
                "verified": request.projectScope.verified,
            }

        # If a new raw API key is provided, encrypt and update masked representation
        if request.apiKey is not None:
            raw_key = request.apiKey.strip()
            if not raw_key:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Updated API key cannot be empty.",
                )
            try:
                updates["encryptedApiKey"] = encrypt_api_key(raw_key)
                updates["maskedApiKey"] = mask_api_key(raw_key)
            except CryptoError as e:
                logger.error(f"Cryptographic failure while updating key for user {user_id}: {e}")
                raise HTTPException(
                    status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                    detail="Internal encryption error while updating credential.",
                ) from e

        updates.pop("apiKey", None)
        updates.pop("decryptedKey", None)
        updates.pop("decrypted_key", None)
        updates.pop("rawKey", None)

        try:
            self.repo.save_credential(user_id, credential_id, updates)
        except Exception as e:
            logger.error(f"Failed to persist updated credential for user {user_id}: {e}")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Database error: Failed to update credential in Firestore.",
            ) from e

        scope_raw = updates.get("projectScope", {})
        return CredentialResponse(
            credentialId=updates["credentialId"],
            userId=updates["userId"],
            provider=ProviderType(updates["provider"]),
            friendlyName=updates["friendlyName"],
            maskedApiKey=updates["maskedApiKey"],
            projectScope=ProjectScopeDTO(
                scope_id=scope_raw.get("scope_id", "default_scope"),
                scope_type=ScopeType(
                    scope_raw.get("scope_type", ScopeType.UNVERIFIED_UNIQUE.value)
                ),
                verified=scope_raw.get("verified", False),
            ),
            costTier=CredentialTier(updates.get("costTier", CredentialTier.FREE_TIER.value)),
            enabled=updates.get("enabled", True),
            createdAt=updates.get("createdAt", ""),
            updatedAt=updates.get("updatedAt", now_iso),
        )

    def update_credential_status(
        self, user_id: str, credential_id: str, enabled: bool
    ) -> CredentialResponse:
        """Enable or disable a credential for the authenticated user."""
        return self.update_credential(
            user_id=user_id,
            credential_id=credential_id,
            request=CredentialUpdateRequest(enabled=enabled),
        )

    def delete_credential(self, user_id: str, credential_id: str) -> bool:
        """Delete credential scoped strictly to the authenticated user."""
        try:
            deleted = self.repo.delete_credential(user_id, credential_id)
        except Exception as e:
            logger.error(f"Failed to delete credential {credential_id} for user {user_id}: {e}")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Database error: Failed to delete credential.",
            ) from e

        if not deleted:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Credential {credential_id} not found.",
            )

        # Clean up any task routing preferences pointing to this deleted credential
        try:
            current_settings = self.repo.get_settings(user_id)
            if current_settings and "taskRouting" in current_settings:
                routing = dict(current_settings["taskRouting"])
                updated = False
                for task_k, target_v in list(routing.items()):
                    if target_v == credential_id:
                        del routing[task_k]
                        updated = True
                if updated:
                    current_settings["taskRouting"] = routing
                    self.repo.save_settings(user_id, current_settings)
                    logger.info(
                        f"Cleaned up deleted credential {credential_id} from taskRouting for user {user_id}"
                    )
        except Exception as e:
            logger.warning(
                f"Non-fatal error cleaning task routing for deleted credential {credential_id}: {e}"
            )

        return True

    def get_settings(self, user_id: str) -> AISettingsResponse:
        """Retrieve user AI preferences with safe default fallbacks."""
        try:
            raw = self.repo.get_settings(user_id)
        except Exception as e:
            logger.error(f"Failed to fetch settings for user {user_id}: {e}")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Database error: Failed to retrieve AI settings.",
            ) from e

        if not raw:
            return AISettingsResponse(
                userId=user_id,
                costPolicy=CostPolicy.FREE_ONLY,
                allowPaidFallback=False,
                primaryProvider=ProviderType.GEMINI,
                providerPriority=[ProviderType.GEMINI, ProviderType.OPENROUTER, ProviderType.GROQ],
                taskRouting={},
                updatedAt=datetime.now(UTC).isoformat(),
            )

        provider_prio = [
            ProviderType(p) for p in raw.get("providerPriority", ["gemini", "openrouter", "groq"])
        ]
        return AISettingsResponse(
            userId=user_id,
            costPolicy=CostPolicy(raw.get("costPolicy", CostPolicy.FREE_ONLY.value)),
            allowPaidFallback=raw.get("allowPaidFallback", False),
            primaryProvider=ProviderType(raw.get("primaryProvider", ProviderType.GEMINI.value)),
            providerPriority=provider_prio,
            taskRouting=raw.get("taskRouting", {}),
            updatedAt=raw.get("updatedAt", datetime.now(UTC).isoformat()),
        )

    def update_settings(self, user_id: str, request: AISettingsUpdateRequest) -> AISettingsResponse:
        """Update and persist AI routing preferences and cost policy."""
        current = self.get_settings(user_id)
        now_iso = datetime.now(UTC).isoformat()

        # Validate task routing targets if provided
        if request.taskRouting is not None:
            sanitized_routing: dict[str, str] = {}
            try:
                user_creds = self.repo.list_credentials(user_id)
            except Exception:
                user_creds = []
            valid_cred_ids = {c["credentialId"] for c in user_creds}
            valid_providers = {"gemini", "openrouter", "groq"}

            for task_k, target_v in request.taskRouting.items():
                if not target_v or target_v.strip().lower() in ("auto", "none", ""):
                    continue
                cleaned_target = target_v.strip()
                if cleaned_target.lower() in valid_providers:
                    sanitized_routing[task_k] = cleaned_target.lower()
                elif cleaned_target in valid_cred_ids:
                    sanitized_routing[task_k] = cleaned_target
                else:
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail=(
                            f"Invalid routing target '{cleaned_target}': Credential does not exist "
                            f"or does not belong to user {user_id}."
                        ),
                    )
        else:
            sanitized_routing = dict(current.taskRouting)

        updated_dict: dict[str, Any] = {
            "userId": user_id,
            "costPolicy": (
                request.costPolicy.value
                if request.costPolicy is not None
                else current.costPolicy.value
            ),
            "allowPaidFallback": (
                request.allowPaidFallback
                if request.allowPaidFallback is not None
                else current.allowPaidFallback
            ),
            "primaryProvider": (
                request.primaryProvider.value
                if request.primaryProvider is not None
                else current.primaryProvider.value
            ),
            "providerPriority": [
                p.value
                for p in (
                    request.providerPriority
                    if request.providerPriority is not None
                    else current.providerPriority
                )
            ],
            "taskRouting": (
                sanitized_routing if request.taskRouting is not None else current.taskRouting
            ),
            "updatedAt": now_iso,
        }

        try:
            self.repo.save_settings(user_id, updated_dict)
        except Exception as e:
            logger.error(f"Failed to persist AI settings for user {user_id}: {e}")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Database error: Failed to save AI settings.",
            ) from e

        return AISettingsResponse(
            userId=user_id,
            costPolicy=CostPolicy(updated_dict["costPolicy"]),
            allowPaidFallback=updated_dict["allowPaidFallback"],
            primaryProvider=ProviderType(updated_dict["primaryProvider"]),
            providerPriority=[ProviderType(p) for p in updated_dict["providerPriority"]],
            taskRouting=updated_dict["taskRouting"],
            updatedAt=now_iso,
        )

    async def load_user_ai_profile(self, user_id: str) -> UserAIProfile:
        """Construct UserAIProfile with decrypted credentials for AIOrchestrator execution.

        Note: Decrypted keys exist in memory strictly for the execution lifetime.
        """
        settings_res = self.get_settings(user_id)

        try:
            raw_credentials = self.repo.list_credentials(user_id)
        except Exception as e:
            logger.warning(f"Could not load credentials from repository for user {user_id}: {e}")
            raw_credentials = []

        active_credentials: list[UserCredential] = []

        for c in raw_credentials:
            if not c.get("enabled", True):
                continue

            encrypted_key = c.get("encryptedApiKey")
            if not encrypted_key:
                continue

            try:
                decrypted_key = decrypt_api_key(encrypted_key)
            except CryptoError as e:
                logger.error(
                    f"Integrity check or decryption failed for credential {c.get('credentialId')} (user {user_id}): {e}. Skipping credential."
                )
                continue

            scope_raw = c.get("projectScope", {})
            scope = ProjectScope(
                scope_id=scope_raw.get("scope_id", "default_scope"),
                scope_type=ScopeType(
                    scope_raw.get("scope_type", ScopeType.UNVERIFIED_UNIQUE.value)
                ),
                verified=scope_raw.get("verified", False),
            )

            user_cred = UserCredential(
                id=c["credentialId"],
                user_id=user_id,
                provider=ProviderType(c["provider"]),
                friendly_name=c.get("friendlyName", "User Key"),
                encrypted_api_key=encrypted_key,
                masked_key=c.get("maskedApiKey", "***"),
                project_scope=scope,
                cost_tier=CredentialTier(c.get("costTier", CredentialTier.FREE_TIER.value)),
                is_active=True,
                health_status=CredentialHealth.HEALTHY,
                decrypted_key=decrypted_key,
            )
            active_credentials.append(user_cred)

        # Sanitize task_routing: remove targets for credentials that are inactive or deleted
        active_cred_ids = {c.id for c in active_credentials}
        valid_providers = {"gemini", "openrouter", "groq"}
        clean_task_routing: dict[str, str] = {}
        for t_name, t_target in settings_res.taskRouting.items():
            if t_target in valid_providers or t_target in active_cred_ids:
                clean_task_routing[t_name] = t_target

        return UserAIProfile(
            user_id=user_id,
            cost_policy=settings_res.costPolicy,
            allow_paid_fallback=settings_res.allowPaidFallback,
            primary_provider=settings_res.primaryProvider,
            provider_priority=settings_res.providerPriority,
            task_routing=clean_task_routing,
            credentials=active_credentials,
        )

    async def probe_credential(
        self, user_id: str, credential_id: str, probe_req: ProbeRequest | None = None
    ) -> ProbeResponse:
        """Run a minimal, controlled, server-side health probe on a credential."""
        from app.ai.hub.orchestrator import ai_orchestrator

        try:
            data = self.repo.get_credential(user_id, credential_id)
        except Exception as e:
            logger.error(f"Failed to retrieve credential {credential_id} for user {user_id}: {e}")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Database error: Failed to retrieve credential.",
            ) from e

        if not data:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Credential {credential_id} not found.",
            )

        encrypted_key = data.get("encryptedApiKey")
        if not encrypted_key:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Credential does not contain encrypted key material.",
            )

        try:
            decrypted_key = decrypt_api_key(encrypted_key)
        except CryptoError as e:
            logger.error(f"Decryption failed during probe for credential {credential_id}: {e}")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Internal decryption error while probing credential.",
            ) from e

        provider = ProviderType(data["provider"])
        adapter = ai_orchestrator.get_adapter(provider)
        if not adapter:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"No provider adapter available for {provider.value}.",
            )

        # Pick minimal probe model (favor free models that are available)
        supported_models = adapter.get_supported_models()
        free_models = [m for m in supported_models if m.cost_tier == CostTier.FREE and m.is_available]
        candidate_probe_models = [m.model_id for m in free_models]
        if not candidate_probe_models:
            candidate_probe_models = [m.model_id for m in supported_models if m.is_available]
        if not candidate_probe_models:
            candidate_probe_models = [supported_models[0].model_id] if supported_models else ["default"]

        prompt = (
            probe_req.customPrompt if probe_req and probe_req.customPrompt else None
        ) or "ping"

        t0 = time.time()
        success = False
        health_status = CredentialHealth.HEALTHY
        msg = "Connection probe succeeded."
        probe_model = candidate_probe_models[0]

        for candidate in candidate_probe_models:
            probe_model = candidate
            try:
                await adapter.generate_text(
                    model=candidate,
                    prompt=prompt,
                    timeout=10.0,
                    api_key=decrypted_key,
                )
                success = True
                msg = f"Connection probe succeeded."
                health_status = CredentialHealth.HEALTHY
                ai_orchestrator.health_registry.set_credential_health(
                    user_id=user_id,
                    credential_id=credential_id,
                    status=CredentialHealth.HEALTHY,
                )
                break
            except Exception as raw_e:
                success = False
                classified = adapter.classify_error(raw_e, candidate)
                safe_msg = sanitize_text(classified.message, [decrypted_key])
                if isinstance(classified, (AIAuthenticationError, AIConfigurationError)):
                    health_status = CredentialHealth.INVALID_KEY
                    msg = f"Authentication failed: {safe_msg}"
                    ai_orchestrator.health_registry.set_credential_health(
                        user_id=user_id,
                        credential_id=credential_id,
                        status=CredentialHealth.INVALID_KEY,
                    )
                    break
                elif isinstance(classified, AIRateLimitError):
                    health_status = CredentialHealth.COOLDOWN
                    msg = f"Rate limited on {candidate}: {safe_msg}"
                    continue
                else:
                    health_status = CredentialHealth.CONFIG_ERROR
                    msg = f"Connection failed: {safe_msg}"
                    continue

        if not success and health_status != CredentialHealth.INVALID_KEY:
            ai_orchestrator.health_registry.set_credential_health(
                user_id=user_id,
                credential_id=credential_id,
                status=health_status,
                duration_seconds=60.0,
            )

        latency_ms = (time.time() - t0) * 1000

        return ProbeResponse(
            credentialId=credential_id,
            provider=provider,
            model=probe_model,
            success=success,
            latencyMs=round(latency_ms, 2),
            message=msg,
            healthStatus=health_status,
            timestamp=datetime.now(UTC).isoformat(),
        )

    def get_health_status(self, user_id: str) -> AIHealthResponse:
        """Inspect per-user runtime health status, active cooldowns, and provider operational states."""
        from app.ai.hub.orchestrator import ai_orchestrator

        provider_health_list: list[ProviderHealthDTO] = []
        for p in [ProviderType.GEMINI, ProviderType.OPENROUTER, ProviderType.GROQ]:
            adapter = ai_orchestrator.get_adapter(p)
            operational = adapter is not None
            model_count = len(adapter.get_supported_models()) if adapter else 0
            provider_health_list.append(
                ProviderHealthDTO(
                    provider=p,
                    operational=operational,
                    registeredModelsCount=model_count,
                )
            )

        user_creds = self.list_credentials(user_id)
        total_creds = len(user_creds)
        registry_statuses = ai_orchestrator.health_registry.get_user_credential_statuses(user_id)

        healthy_count = 0
        cred_statuses: dict[str, CredentialHealth] = {}
        for c in user_creds:
            cid = c.credentialId
            status_val = registry_statuses.get(
                cid,
                CredentialHealth.HEALTHY if c.enabled else CredentialHealth.CONFIG_ERROR,
            )
            cred_statuses[cid] = status_val
            if status_val == CredentialHealth.HEALTHY and c.enabled:
                healthy_count += 1

        cooldowns_raw = ai_orchestrator.health_registry.get_user_cooldowns(user_id)
        active_cooldowns = [
            ActiveCooldownDTO(
                credentialId=c_id,
                modelId=m_id,
                expiresInSeconds=round(rem, 1),
            )
            for c_id, m_id, rem in cooldowns_raw
        ]

        return AIHealthResponse(
            providers=provider_health_list,
            credentialStatuses=cred_statuses,
            activeCooldowns=active_cooldowns,
            healthyCredentialsCount=healthy_count,
            totalCredentialsCount=total_creds,
            timestamp=datetime.now(UTC).isoformat(),
        )

    def get_model_catalog(self) -> list[ModelCatalogItemDTO]:
        """Aggregate catalog of supported models across all registered provider adapters."""
        from app.ai.hub.orchestrator import ai_orchestrator

        catalog: list[ModelCatalogItemDTO] = []
        for provider_type in [ProviderType.GEMINI, ProviderType.OPENROUTER, ProviderType.GROQ]:
            adapter = ai_orchestrator.get_adapter(provider_type)
            if not adapter:
                continue
            models = adapter.get_supported_models()
            for m in models:
                if not m.is_available:
                    continue
                catalog.append(
                    ModelCatalogItemDTO(
                        modelId=m.model_id,
                        provider=m.provider,
                        displayName=m.display_name,
                        capabilities=list(m.capabilities),
                        contextWindow=m.context_window,
                        costTier=m.cost_tier,
                        defaultPriority=m.default_priority,
                        isAvailable=m.is_available,
                    )
                )
        return catalog

    def get_telemetry_summary(self, user_id: str, limit: int = 50) -> TelemetryResponse:
        """Compute aggregated telemetry summary and recent executions for user."""
        try:
            records = ai_telemetry_repo.list_executions(user_id, limit=limit)
        except Exception as e:
            logger.error(f"Failed to query telemetry for user {user_id}: {e}")
            records = []

        total = len(records)
        successful = sum(1 for r in records if r.get("success", False))
        failed = total - successful
        success_rate = round((successful / total) * 100.0, 1) if total > 0 else 0.0
        avg_latency = (
            round(sum(float(r.get("latencyMs", 0.0)) for r in records) / total, 1)
            if total > 0
            else 0.0
        )
        fallbacks = sum(
            1
            for r in records
            if int(r.get("fallbackLevel", 0)) > 0 or int(r.get("hopsCount", 1)) > 1
        )

        provider_dist: dict[str, int] = {}
        task_dist: dict[str, int] = {}
        for r in records:
            p = str(r.get("providerUsed", "unknown"))
            t = str(r.get("task", "unknown"))
            provider_dist[p] = provider_dist.get(p, 0) + 1
            task_dist[t] = task_dist.get(t, 0) + 1

        summary = TelemetrySummaryDTO(
            totalRequests=total,
            successfulRequests=successful,
            failedRequests=failed,
            successRate=success_rate,
            averageLatencyMs=avg_latency,
            fallbackCount=fallbacks,
            providerDistribution=provider_dist,
            taskDistribution=task_dist,
        )

        recent: list[ExecutionTelemetryDTO] = []
        for r in records:
            try:
                task_raw = str(r.get("task", ""))
                try:
                    task_enum = AITaskType(task_raw)
                except ValueError:
                    task_enum = AITaskType.JOB_INGESTION

                provider_raw = str(r.get("providerUsed", ""))
                try:
                    provider_enum = ProviderType(provider_raw)
                except ValueError:
                    provider_enum = ProviderType.GEMINI

                cost_raw = str(r.get("costTier", CostTier.FREE.value))
                try:
                    cost_enum = CostTier(cost_raw)
                except ValueError:
                    cost_enum = CostTier.FREE

                recent.append(
                    ExecutionTelemetryDTO(
                        executionId=str(r.get("executionId", "")),
                        userId=user_id,
                        task=task_enum,
                        providerUsed=provider_enum,
                        modelUsed=str(r.get("modelUsed", "")),
                        credentialIdUsed=str(r.get("credentialIdUsed", "")),
                        success=bool(r.get("success", False)),
                        latencyMs=float(r.get("latencyMs", 0.0)),
                        fallbackLevel=int(r.get("fallbackLevel", 0)),
                        hopsCount=int(r.get("hopsCount", 1)),
                        failureCategory=r.get("failureCategory"),
                        costTier=cost_enum,
                        timestamp=str(r.get("timestamp", "")),
                    )
                )
            except Exception as parse_err:
                logger.debug(f"Skipping malformed telemetry record: {parse_err}")

        return TelemetryResponse(
            summary=summary,
            recentExecutions=recent,
            timestamp=datetime.now(UTC).isoformat(),
        )


ai_settings_service = AISettingsService()
