"""Central AIOrchestrator coordinating candidate routing, fallback execution, and health tracking."""

import logging
import time
from datetime import UTC, datetime, timedelta
from typing import Any, TypeVar

from pydantic import BaseModel

from app.ai.adapters.base import BaseProviderAdapter, SchemaRepairNeededError
from app.ai.adapters.gemini_adapter import GeminiAdapter
from app.ai.adapters.groq_adapter import GroqAdapter
from app.ai.adapters.openrouter_adapter import OpenRouterAdapter
from app.ai.errors import (
    AIAuthenticationError,
    AIConfigurationError,
    AIOutputValidationError,
    AIProviderError,
    AIProviderUnavailableError,
    AISafetyError,
)
from app.ai.hub.crypto import sanitize_text
from app.ai.hub.models import ExecutionRequest, ExecutionResponse, UserAIProfile
from app.ai.hub.router import AIRouter, CandidateRoute
from app.ai.hub.types import CredentialHealth, ProviderType

logger = logging.getLogger("jobFinder.ai.orchestrator")

T = TypeVar("T", bound=BaseModel)


class HealthRegistry:
    """In-memory health and cooldown registry strictly partitioned by user and credential."""

    def __init__(self):
        # Key: (userId, credentialId, modelId) -> cooldown_until: datetime
        self._model_cooldowns: dict[tuple[str, str, str], datetime] = {}
        # Key: (userId, credentialId) -> CredentialHealth
        self._credential_status: dict[tuple[str, str], CredentialHealth] = {}
        # Key: (userId, credentialId) -> cooldown_until: datetime
        self._credential_cooldowns: dict[tuple[str, str], datetime] = {}

    def is_model_in_cooldown(self, user_id: str, credential_id: str, model_id: str) -> bool:
        """Check if model is currently in cooldown for this specific user and credential."""
        key = (user_id, credential_id, model_id)
        expiry = self._model_cooldowns.get(key)
        if not expiry:
            return False
        if datetime.now(UTC) < expiry:
            return True
        # Cooldown expired; clean up
        self._model_cooldowns.pop(key, None)
        return False

    def set_model_cooldown(
        self,
        user_id: str,
        credential_id: str,
        model_id: str,
        duration_seconds: float = 60.0,
    ) -> None:
        """Put model into temporary cooldown for this specific user and credential."""
        key = (user_id, credential_id, model_id)
        self._model_cooldowns[key] = datetime.now(UTC) + timedelta(seconds=duration_seconds)
        logger.info(
            f"[HEALTH_COOLDOWN] Cooldown set for user={user_id} cred={credential_id} model={model_id} for {duration_seconds}s"
        )

    def set_credential_health(
        self,
        user_id: str,
        credential_id: str,
        status: CredentialHealth,
        duration_seconds: float = 60.0,
    ) -> None:
        """Set credential health status for this specific user."""
        key = (user_id, credential_id)
        self._credential_status[key] = status
        if status in (CredentialHealth.COOLDOWN, CredentialHealth.QUOTA_EXHAUSTED):
            self._credential_cooldowns[key] = datetime.now(UTC) + timedelta(
                seconds=duration_seconds
            )
        logger.info(
            f"[CREDENTIAL_HEALTH] Health set for user={user_id} cred={credential_id}: {status.value}"
        )

    def get_credential_health(self, user_id: str, credential_id: str) -> CredentialHealth:
        """Get credential health status for this specific user."""
        key = (user_id, credential_id)
        status = self._credential_status.get(key, CredentialHealth.HEALTHY)
        if status in (CredentialHealth.COOLDOWN, CredentialHealth.QUOTA_EXHAUSTED):
            expiry = self._credential_cooldowns.get(key)
            if expiry and datetime.now(UTC) >= expiry:
                self._credential_cooldowns.pop(key, None)
                self._credential_status[key] = CredentialHealth.HEALTHY
                return CredentialHealth.HEALTHY
        return status

    def is_credential_healthy(self, user_id: str, credential_id: str) -> bool:
        """Check if credential is fully healthy (not in error or cooldown) for this user."""
        status = self.get_credential_health(user_id, credential_id)
        return status == CredentialHealth.HEALTHY

    def get_user_cooldowns(self, user_id: str) -> list[tuple[str, str, float]]:
        """Return list of (credential_id, model_id, seconds_remaining) for active cooldowns of this user."""
        now = datetime.now(UTC)
        results = []
        for (uid, cred_id, model_id), expiry in list(self._model_cooldowns.items()):
            if uid == user_id:
                if now < expiry:
                    results.append((cred_id, model_id, (expiry - now).total_seconds()))
                else:
                    self._model_cooldowns.pop((uid, cred_id, model_id), None)
        return results

    def get_user_credential_statuses(self, user_id: str) -> dict[str, CredentialHealth]:
        """Return dict of {credential_id: CredentialHealth} for this user."""
        now = datetime.now(UTC)
        results = {}
        for (uid, cred_id), status in list(self._credential_status.items()):
            if uid == user_id:
                if status in (CredentialHealth.COOLDOWN, CredentialHealth.QUOTA_EXHAUSTED):
                    expiry = self._credential_cooldowns.get((uid, cred_id))
                    if expiry and now >= expiry:
                        self._credential_cooldowns.pop((uid, cred_id), None)
                        self._credential_status[(uid, cred_id)] = CredentialHealth.HEALTHY
                        results[cred_id] = CredentialHealth.HEALTHY
                        continue
                results[cred_id] = status
        return results

    def reset_user(self, user_id: str) -> None:
        """Clear all health states for a specific user."""
        for m_key in list(self._model_cooldowns.keys()):
            if m_key[0] == user_id:
                self._model_cooldowns.pop(m_key, None)
        for s_key in list(self._credential_status.keys()):
            if s_key[0] == user_id:
                self._credential_status.pop(s_key, None)
        for c_key in list(self._credential_cooldowns.keys()):
            if c_key[0] == user_id:
                self._credential_cooldowns.pop(c_key, None)

    def reset(self) -> None:
        """Clear all health states (primarily for testing)."""
        self._model_cooldowns.clear()
        self._credential_status.clear()
        self._credential_cooldowns.clear()


class AIOrchestrator:
    """Central AI Orchestration layer coordinating all model invocations, fallbacks, and health."""

    def __init__(
        self,
        router: AIRouter | None = None,
        health_registry: HealthRegistry | None = None,
        register_defaults: bool = True,
    ):
        self.router = router or AIRouter()
        self.health_registry = health_registry or HealthRegistry()
        self._adapters: dict[ProviderType, BaseProviderAdapter] = {}

        if register_defaults:
            self.register_adapter(GeminiAdapter())
            self.register_adapter(OpenRouterAdapter())
            self.register_adapter(GroqAdapter())

    def register_adapter(self, adapter: BaseProviderAdapter) -> None:
        """Register a provider adapter."""
        self._adapters[adapter.provider_type] = adapter

    def get_adapter(self, provider_type: ProviderType) -> BaseProviderAdapter | None:
        """Retrieve a registered provider adapter."""
        return self._adapters.get(provider_type)

    def _safe_record_telemetry(
        self,
        user_id: str,
        task: Any,
        candidate_provider: str,
        candidate_model: str,
        candidate_credential_id: str,
        success: bool,
        latency_ms: float,
        hops: list[dict[str, Any]],
        cost_tier: str = "FREE",
        failure_category: str | None = None,
    ) -> None:
        """Safely persist execution telemetry without leaking secrets or failing caller."""
        try:
            import uuid

            from app.db.repositories.ai_telemetry_repo import ai_telemetry_repo

            hops_count = len(hops)
            fallback_level = 0
            if hops_count > 1:
                providers_in_hops = {h.get("provider") for h in hops}
                creds_in_hops = {h.get("credential_id") for h in hops}
                if len(providers_in_hops) > 1:
                    fallback_level = 3
                elif len(creds_in_hops) > 1:
                    fallback_level = 2
                else:
                    fallback_level = 1

            task_val = task.value if hasattr(task, "value") else str(task)
            exec_id = f"exec_{uuid.uuid4().hex[:12]}"
            now_iso = datetime.now(UTC).isoformat()

            ai_telemetry_repo.record_execution(
                user_id=user_id,
                record={
                    "executionId": exec_id,
                    "userId": user_id,
                    "task": task_val,
                    "providerUsed": candidate_provider,
                    "modelUsed": candidate_model,
                    "credentialIdUsed": candidate_credential_id,
                    "success": success,
                    "latencyMs": round(latency_ms, 2),
                    "fallbackLevel": fallback_level,
                    "hopsCount": hops_count,
                    "failureCategory": failure_category,
                    "costTier": cost_tier,
                    "timestamp": now_iso,
                },
            )
        except Exception as err:
            logger.warning(f"Could not record AI execution telemetry for user {user_id}: {err}")

    async def execute(
        self,
        request: ExecutionRequest,
        profile: UserAIProfile | None = None,
        explicit_model_chain: list[str] | None = None,
        custom_adapter: BaseProviderAdapter | None = None,
        **kwargs,
    ) -> ExecutionResponse:
        """Execute an AI generation request with unified Level 1, 2, and 3 Fallback."""
        start_time = time.time()
        attempted_models: list[str] = []
        attempted_hops: list[dict[str, Any]] = []
        last_error: AIProviderError | None = None

        # Build list of active model cooldowns for this user
        user_cooldowns: set[Any] = set()
        for (uid, cred_id, model_id), expiry in list(self.health_registry._model_cooldowns.items()):
            if uid == request.user_id and datetime.now(UTC) < expiry:
                user_cooldowns.add(model_id)
                user_cooldowns.add((cred_id, model_id))

        # Build list of bad/unhealthy credentials for this user
        unhealthy_creds: set[str] = set()
        for (uid, cred_id), status in list(self.health_registry._credential_status.items()):
            if uid == request.user_id:
                if status in (CredentialHealth.INVALID_KEY, CredentialHealth.CONFIG_ERROR):
                    unhealthy_creds.add(cred_id)
                elif not self.health_registry.is_credential_healthy(uid, cred_id):
                    unhealthy_creds.add(cred_id)

        # Resolve user profile from persistence if not explicitly provided
        user_profile = profile
        if user_profile is None and not explicit_model_chain:
            try:
                from app.services.ai_settings_service import ai_settings_service

                user_profile = await ai_settings_service.load_user_ai_profile(request.user_id)
            except Exception as e:
                logger.debug(f"Could not load persisted user AI profile for {request.user_id}: {e}")
                user_profile = None

        # Resolve candidate execution routes
        candidates = self.router.resolve_candidates(
            request=request,
            profile=user_profile,
            explicit_model_chain=explicit_model_chain,
            explicit_adapter=custom_adapter,
            registered_adapters=self._adapters,
            active_cooldowns=user_cooldowns,
            unhealthy_credentials=unhealthy_creds,
        )

        if not candidates:
            raise AIProviderUnavailableError(
                f"No healthy candidates available to service task {request.task.value} under active cost policy.",
                details={"task": request.task.value, "user_id": request.user_id},
            )

        # Set of credentials pruned during this execution run (e.g. invalid key)
        pruned_credentials: set[str] = set()
        # Set of scope_ids with confirmed quota exhaustion
        exhausted_scope_ids: set[str] = set()

        for candidate in candidates:
            # Skip if this candidate uses a credential pruned during this execution
            if candidate.credential_id in pruned_credentials:
                continue

            # Level 2 check: if candidate shares a verified/known scope with an exhausted project, skip
            if candidate.project_scope and candidate.project_scope.scope_id in exhausted_scope_ids:
                if (
                    candidate.project_scope.verified
                    or candidate.project_scope.scope_type.value == "USER_DECLARED_PROJECT"
                ):
                    logger.info(
                        f"[QUOTA_SCOPE_SKIP] Skipping credential {candidate.credential_id} sharing exhausted scope {candidate.project_scope.scope_id}"
                    )
                    continue

            attempted_models.append(candidate.model_id)
            hop_start = time.time()

            try:
                # Merge candidate api_key if provided
                call_kwargs = dict(kwargs)
                if candidate.api_key and "api_key" not in call_kwargs:
                    call_kwargs["api_key"] = candidate.api_key

                if request.schema_cls is not None:
                    # Structured generation path with 1-shot self-repair
                    raw_text, structured_data = await self._execute_structured_with_repair(
                        candidate=candidate,
                        request=request,
                        **call_kwargs,
                    )
                else:
                    # Plain text generation path
                    raw_text = await candidate.adapter.generate_text(
                        model=candidate.model_id,
                        prompt=request.prompt,
                        system_instruction=request.system_instruction,
                        temperature=request.temperature,
                        timeout=request.execution_timeout,
                        **call_kwargs,
                    )
                    structured_data = None

                hop_latency = (time.time() - hop_start) * 1000
                total_latency = (time.time() - start_time) * 1000

                attempted_hops.append(
                    {
                        "provider": candidate.provider.value,
                        "model": candidate.model_id,
                        "credential_id": candidate.credential_id,
                        "status": "SUCCESS",
                        "latency_ms": hop_latency,
                    }
                )

                logger.info(
                    f"[AI_SUCCESS] Completed request using {candidate.provider.value}:{candidate.model_id} via {candidate.credential_id}"
                )

                self._safe_record_telemetry(
                    user_id=request.user_id,
                    task=request.task,
                    candidate_provider=candidate.provider.value,
                    candidate_model=candidate.model_id,
                    candidate_credential_id=candidate.credential_id,
                    success=True,
                    latency_ms=total_latency,
                    hops=attempted_hops,
                    cost_tier=candidate.cost_tier.value
                    if hasattr(candidate.cost_tier, "value")
                    else str(candidate.cost_tier),
                    failure_category=None,
                )

                return ExecutionResponse(
                    text=raw_text,
                    structured_data=structured_data,
                    provider_used=candidate.provider,
                    model_used=candidate.model_id,
                    credential_id_used=candidate.credential_id,
                    latency_ms=total_latency,
                    attempted_hops=attempted_hops,
                )

            except Exception as raw_e:
                # If schema validation self-repair was exhausted and failed, abort immediately
                if isinstance(raw_e, AIOutputValidationError):
                    logger.error(
                        f"[AI_ERROR] Schema self-repair failed on {candidate.model_id}: {raw_e.message}. Aborting without fallback."
                    )
                    total_latency = (time.time() - start_time) * 1000
                    self._safe_record_telemetry(
                        user_id=request.user_id,
                        task=request.task,
                        candidate_provider=candidate.provider.value,
                        candidate_model=candidate.model_id,
                        candidate_credential_id=candidate.credential_id,
                        success=False,
                        latency_ms=total_latency,
                        hops=attempted_hops,
                        cost_tier=candidate.cost_tier.value
                        if hasattr(candidate.cost_tier, "value")
                        else str(candidate.cost_tier),
                        failure_category="AIOutputValidationError",
                    )
                    raise raw_e

                hop_latency = (time.time() - hop_start) * 1000
                classified_err = candidate.adapter.classify_error(raw_e, candidate.model_id)
                last_error = classified_err

                candidate_secrets = [candidate.api_key] if candidate.api_key else None
                safe_err_str = sanitize_text(str(classified_err), candidate_secrets)
                safe_err_msg = sanitize_text(classified_err.message, candidate_secrets)

                attempted_hops.append(
                    {
                        "provider": candidate.provider.value,
                        "model": candidate.model_id,
                        "credential_id": candidate.credential_id,
                        "status": "FAILED",
                        "error": safe_err_str,
                        "latency_ms": hop_latency,
                    }
                )

                # Fatal non-transient error: Safety policy refusal aborts immediately without hopping
                if isinstance(classified_err, AISafetyError):
                    logger.error(
                        f"[AI_ERROR] Safety policy refusal on {candidate.model_id}: {safe_err_msg}. Aborting without fallback."
                    )
                    total_latency = (time.time() - start_time) * 1000
                    self._safe_record_telemetry(
                        user_id=request.user_id,
                        task=request.task,
                        candidate_provider=candidate.provider.value,
                        candidate_model=candidate.model_id,
                        candidate_credential_id=candidate.credential_id,
                        success=False,
                        latency_ms=total_latency,
                        hops=attempted_hops,
                        cost_tier=candidate.cost_tier.value
                        if hasattr(candidate.cost_tier, "value")
                        else str(candidate.cost_tier),
                        failure_category="AISafetyError",
                    )
                    raise classified_err from raw_e

                # Fatal credential error: Authentication failure (401)
                # When authentication fails, the credential itself is invalid.
                # Mark credential as INVALID_KEY and abort immediately to avoid pointless hopping.
                if isinstance(classified_err, (AIAuthenticationError, AIConfigurationError)):
                    self.health_registry.set_credential_health(
                        user_id=request.user_id,
                        credential_id=candidate.credential_id,
                        status=CredentialHealth.INVALID_KEY
                        if isinstance(classified_err, AIAuthenticationError)
                        else CredentialHealth.CONFIG_ERROR,
                    )
                    pruned_credentials.add(candidate.credential_id)
                    logger.error(
                        f"[AI_ERROR] Fatal auth/config error on {candidate.credential_id} ({candidate.model_id}): {safe_err_msg}. Aborting without fallback."
                    )
                    total_latency = (time.time() - start_time) * 1000
                    self._safe_record_telemetry(
                        user_id=request.user_id,
                        task=request.task,
                        candidate_provider=candidate.provider.value,
                        candidate_model=candidate.model_id,
                        candidate_credential_id=candidate.credential_id,
                        success=False,
                        latency_ms=total_latency,
                        hops=attempted_hops,
                        cost_tier=candidate.cost_tier.value
                        if hasattr(candidate.cost_tier, "value")
                        else str(candidate.cost_tier),
                        failure_category=classified_err.__class__.__name__,
                    )
                    raise classified_err from raw_e

                # Rate Limit (429) & Quota Exhaustion
                # Put model into temporary cooldown for this (user, credential, model)
                self.health_registry.set_model_cooldown(
                    user_id=request.user_id,
                    credential_id=candidate.credential_id,
                    model_id=candidate.model_id,
                    duration_seconds=60.0,
                )

                # If candidate has a verified or user-declared project scope, track it for quota exhaustion
                if candidate.project_scope and (
                    candidate.project_scope.verified
                    or candidate.project_scope.scope_type.value == "USER_DECLARED_PROJECT"
                ):
                    exhausted_scope_ids.add(candidate.project_scope.scope_id)

                logger.warning(
                    f"[AI_INSTANT_FALLBACK] {candidate.provider.value}:{candidate.model_id} on {candidate.credential_id} encountered {classified_err.__class__.__name__} "
                    f"({safe_err_msg}). Seamlessly trying next candidate..."
                )
                continue

        # If all candidates fail
        total_latency = (time.time() - start_time) * 1000
        last_hop = attempted_hops[-1] if attempted_hops else {}
        self._safe_record_telemetry(
            user_id=request.user_id,
            task=request.task,
            candidate_provider=str(last_hop.get("provider", "UNKNOWN")),
            candidate_model=str(last_hop.get("model", "UNKNOWN")),
            candidate_credential_id=str(last_hop.get("credential_id", "UNKNOWN")),
            success=False,
            latency_ms=total_latency,
            hops=attempted_hops,
            cost_tier="FREE",
            failure_category=last_error.__class__.__name__
            if last_error
            else "AIProviderUnavailableError",
        )
        safe_last_err = sanitize_text(str(last_error))
        raise AIProviderUnavailableError(
            f"All models in fallback chain ({', '.join(attempted_models)}) failed. Last error: {safe_last_err}",
            details={"attempted_models": attempted_models, "last_error": safe_last_err},
        )

    async def _execute_structured_with_repair(
        self,
        candidate: CandidateRoute,
        request: ExecutionRequest,
        **kwargs,
    ) -> tuple[str, Any]:
        """Execute structured JSON generation with guaranteed 1-shot self-repair on schema validation failure."""
        schema = request.schema_cls
        assert schema is not None

        try:
            return await candidate.adapter.generate_structured(
                model=candidate.model_id,
                prompt=request.prompt,
                schema=schema,
                system_instruction=request.system_instruction,
                temperature=request.temperature,
                timeout=request.execution_timeout,
                **kwargs,
            )
        except SchemaRepairNeededError as repair_err:
            logger.warning(
                f"[AI_SCHEMA_RETRY] Structured output validation failed on {candidate.model_id}: {repair_err.original_error}. "
                "Attempting 1-shot self-repair prompt..."
            )
            raw_output = repair_err.raw_output
            repair_prompt = (
                f"The following JSON failed schema validation:\n```json\n{raw_output}\n```\n"
                f"Validation Error: {repair_err.original_error}\n"
                f"Please correct the JSON so it strictly satisfies the requested schema."
            )
            try:
                # 1-shot repair invocation
                repaired_raw, repaired_obj = await candidate.adapter.generate_structured(
                    model=candidate.model_id,
                    prompt=repair_prompt,
                    schema=schema,
                    system_instruction=request.system_instruction,
                    temperature=request.temperature,
                    timeout=request.execution_timeout,
                    **kwargs,
                )
                return repaired_raw, repaired_obj
            except Exception as final_err:
                orig_err = getattr(final_err, "original_error", final_err)
                raise AIOutputValidationError(
                    f"Model {candidate.model_id} produced invalid structured output that failed Pydantic validation: {orig_err}",
                    model=candidate.model_id,
                    details={"raw_output": raw_output, "error": str(orig_err)},
                ) from final_err

    async def execute_embedding(
        self,
        text: str,
        user_id: str = "system_default",
        provider: ProviderType = ProviderType.GEMINI,
        model: str | None = None,
        custom_adapter: BaseProviderAdapter | None = None,
        **kwargs,
    ) -> list[float]:
        """Execute vector embedding directly via target provider adapter (isolated from text fallback)."""
        adapter = custom_adapter or self._adapters.get(provider)
        if not adapter:
            raise AIProviderUnavailableError(f"No adapter registered for provider {provider.value}")
        return await adapter.embed(text=text, model=model, **kwargs)


# Module-level singleton instance
ai_orchestrator = AIOrchestrator()
