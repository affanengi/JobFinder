"""Routing engine for AI/API Hub candidate selection and capability matching."""

from collections.abc import Mapping
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from app.ai.adapters.base import BaseProviderAdapter
from app.ai.hub.models import (
    ExecutionRequest,
    ProjectScope,
    TaskRequirements,
    UserAIProfile,
    evaluate_cost_policy,
)
from app.ai.hub.types import (
    AITaskType,
    CostPolicy,
    CostTier,
    CredentialHealth,
    CredentialTier,
    ModelCapability,
    ProviderType,
)


class CandidateRoute(BaseModel):
    """An executable routing candidate representing a provider, model, and adapter."""

    model_config = ConfigDict(arbitrary_types_allowed=True)

    provider: ProviderType
    model_id: str
    credential_id: str = "default_server_credential"
    project_scope: ProjectScope | None = None
    api_key: str | None = Field(default=None, repr=False, exclude=True)
    adapter: Any
    priority: int = 100
    cost_tier: CostTier = CostTier.UNKNOWN


TASK_REQUIREMENTS_MAP: dict[AITaskType, TaskRequirements] = {
    AITaskType.RESUME_TAILORING: TaskRequirements(
        task=AITaskType.RESUME_TAILORING,
        required_capabilities={
            ModelCapability.STRUCTURED_OUTPUT,
            ModelCapability.LONG_CONTEXT,
            ModelCapability.HIGH_REASONING,
        },
        minimum_context_window=32000,
        schema_required=True,
    ),
    AITaskType.COVER_LETTER_GEN: TaskRequirements(
        task=AITaskType.COVER_LETTER_GEN,
        required_capabilities={
            ModelCapability.STRUCTURED_OUTPUT,
            ModelCapability.HIGH_REASONING,
        },
        minimum_context_window=16000,
        schema_required=True,
    ),
    AITaskType.DUAL_ARTIFACT_GEN: TaskRequirements(
        task=AITaskType.DUAL_ARTIFACT_GEN,
        required_capabilities={
            ModelCapability.STRUCTURED_OUTPUT,
            ModelCapability.LONG_CONTEXT,
            ModelCapability.HIGH_REASONING,
        },
        minimum_context_window=32000,
        schema_required=True,
    ),
    AITaskType.ATS_BULLET_REWRITE: TaskRequirements(
        task=AITaskType.ATS_BULLET_REWRITE,
        required_capabilities={
            ModelCapability.STRUCTURED_OUTPUT,
            ModelCapability.FAST_INFERENCE,
        },
        minimum_context_window=4000,
        schema_required=True,
    ),
    AITaskType.ATS_BULK_REWRITE: TaskRequirements(
        task=AITaskType.ATS_BULK_REWRITE,
        required_capabilities={
            ModelCapability.STRUCTURED_OUTPUT,
            ModelCapability.LONG_CONTEXT,
        },
        minimum_context_window=16000,
        schema_required=True,
    ),
    AITaskType.QA_COPILOT: TaskRequirements(
        task=AITaskType.QA_COPILOT,
        required_capabilities={
            ModelCapability.STRUCTURED_OUTPUT,
            ModelCapability.HIGH_REASONING,
        },
        minimum_context_window=16000,
        schema_required=True,
    ),
    AITaskType.RESUME_PARSING: TaskRequirements(
        task=AITaskType.RESUME_PARSING,
        required_capabilities={
            ModelCapability.STRUCTURED_OUTPUT,
            ModelCapability.LONG_CONTEXT,
        },
        minimum_context_window=16000,
        schema_required=True,
    ),
    AITaskType.JOB_INGESTION: TaskRequirements(
        task=AITaskType.JOB_INGESTION,
        required_capabilities={
            ModelCapability.STRUCTURED_OUTPUT,
        },
        minimum_context_window=8000,
        schema_required=False,
    ),
    AITaskType.JOB_ANALYSIS: TaskRequirements(
        task=AITaskType.JOB_ANALYSIS,
        required_capabilities={
            ModelCapability.STRUCTURED_OUTPUT,
            ModelCapability.HIGH_REASONING,
        },
        minimum_context_window=16000,
        schema_required=True,
    ),
}


class AIRouter:
    """Resolves and ranks candidate execution paths for an AI task."""

    def resolve_candidates(
        self,
        request: ExecutionRequest,
        profile: UserAIProfile | None = None,
        explicit_model_chain: list[str] | None = None,
        explicit_adapter: BaseProviderAdapter | None = None,
        registered_adapters: Mapping[ProviderType, BaseProviderAdapter] | None = None,
        active_cooldowns: set[Any]
        | None = None,  # Set of model_ids or (cred_id, model_id) tuples in cooldown
        unhealthy_credentials: set[str]
        | None = None,  # Set of credential_ids with invalid key or config error
    ) -> list[CandidateRoute]:
        """Produce an ordered list of candidate routes adhering to Level 1, 2, and 3 fallback."""
        adapters = dict(registered_adapters or {})
        if explicit_adapter:
            adapters[explicit_adapter.provider_type] = explicit_adapter
        cooldowns = active_cooldowns or set()
        bad_creds = unhealthy_credentials or set()

        # Path 1: Explicit model chain supplied (backward compatibility bridge)
        if explicit_model_chain:
            adapter = explicit_adapter or adapters.get(ProviderType.GEMINI)
            if not adapter:
                raise ValueError("No adapter available to execute explicit model chain.")
            return [
                CandidateRoute(
                    provider=adapter.provider_type,
                    model_id=model,
                    adapter=adapter,
                    priority=idx * 10,
                )
                for idx, model in enumerate(explicit_model_chain)
            ]

        # Path 2: Dynamic capability-aware routing
        user_profile = profile or UserAIProfile(user_id=request.user_id)
        task_req = TASK_REQUIREMENTS_MAP.get(
            request.task,
            TaskRequirements(task=request.task, required_capabilities=set()),
        )

        candidates: list[CandidateRoute] = []

        # Iterate over provider sequence in user priority order (Level 3 Provider priority)
        for provider_idx, provider_type in enumerate(user_profile.provider_priority):
            adapter = adapters.get(provider_type)
            if not adapter:
                continue

            # Resolve credentials for this provider
            matching_creds = [
                c for c in user_profile.credentials if c.provider == provider_type and c.is_active
            ]

            # If user configured credentials, iterate over them (Level 2 Credential fallback)
            if matching_creds:
                cred_list: list[tuple[str, ProjectScope | None, CredentialTier, str | None]] = [
                    (c.id, c.project_scope, c.cost_tier, c.decrypted_key)
                    for c in matching_creds
                    if c.health_status != CredentialHealth.INVALID_KEY
                    and c.health_status != CredentialHealth.CONFIG_ERROR
                    and c.id not in bad_creds
                ]
            else:
                # Default server credential
                cred_list = [
                    (
                        f"server_{provider_type.value}_credential",
                        None,
                        CredentialTier.FREE_TIER,
                        None,
                    )
                ]

            models = adapter.get_supported_models()

            for cred_idx, (cred_id, scope, cred_cost_tier, cred_key) in enumerate(cred_list):
                if cred_id in bad_creds:
                    continue

                for model_desc in models:
                    # 0. Filter out decommissioned or offline models
                    if not model_desc.is_available:
                        continue

                    # 1. Filter out models in active cooldown for this user/credential
                    if (
                        model_desc.model_id in cooldowns
                        or (cred_id, model_desc.model_id) in cooldowns
                    ):
                        continue

                    # 2. Filter out models that lack task capabilities
                    if not model_desc.satisfies_capabilities(task_req.required_capabilities):
                        continue

                    # 3. Filter by cost policy
                    cost_check = evaluate_cost_policy(
                        policy=user_profile.cost_policy,
                        allow_paid_fallback=user_profile.allow_paid_fallback,
                        model_tier=model_desc.cost_tier,
                        credential_tier=cred_cost_tier,
                    )
                    if not cost_check.allowed:
                        continue

                    # Determine ranking priority:
                    # Under FREE_PREFERRED, all free models across providers are attempted before paid fallback
                    if user_profile.cost_policy == CostPolicy.FREE_PREFERRED:
                        cost_penalty = 0 if cost_check.effective_tier == CostTier.FREE else 10000
                    else:
                        cost_penalty = 0

                    # Task-specific routing preference bonus:
                    # Supports credential-level (-10000 bonus), provider-level (-5000 bonus),
                    # and intra-provider credential fallback (-5000 bonus).
                    task_key = (
                        request.task.value if hasattr(request.task, "value") else str(request.task)
                    )
                    aliases = [task_key, str(request.task)]
                    if task_key == "resume_tailoring":
                        aliases.append("resume_generation")
                    elif task_key == "resume_generation":
                        aliases.append("resume_tailoring")
                    elif task_key == "cover_letter_gen":
                        aliases.append("cover_letter_generation")
                    elif task_key == "cover_letter_generation":
                        aliases.append("cover_letter_gen")

                    preferred_target = None
                    for k in aliases:
                        if k in user_profile.task_routing:
                            preferred_target = user_profile.task_routing[k]
                            break

                    if preferred_target and cred_id and cred_id == preferred_target:
                        # Highest preference: exact credential target
                        task_bonus = -10000
                    elif preferred_target:
                        target_cred = next(
                            (c for c in user_profile.credentials if c.id == preferred_target),
                            None,
                        )
                        if target_cred and target_cred.provider == provider_type:
                            # Sibling credential under the same provider as preferred credential
                            task_bonus = -5000
                        elif (
                            provider_type.value.lower() == preferred_target.lower()
                            or str(provider_type).lower() == preferred_target.lower()
                        ):
                            # Provider-level preference
                            task_bonus = -5000
                        else:
                            task_bonus = 0
                    else:
                        task_bonus = 0

                    candidate_priority = (
                        cost_penalty
                        + task_bonus
                        + (provider_idx * 1000)
                        + (cred_idx * 100)
                        + model_desc.default_priority
                    )

                    candidates.append(
                        CandidateRoute(
                            provider=provider_type,
                            model_id=model_desc.model_id,
                            credential_id=cred_id,
                            project_scope=scope,
                            api_key=cred_key,
                            adapter=adapter,
                            priority=candidate_priority,
                            cost_tier=cost_check.effective_tier,
                        )
                    )

        # Sort candidates deterministically by calculated priority
        candidates.sort(key=lambda c: c.priority)
        return candidates
