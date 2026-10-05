"""Domain models for AI/API Hub.

Includes credential models, model descriptors, project scopes, cost policy
evaluation, execution requests, and responses.
"""

from datetime import UTC, datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from app.ai.hub.types import (
    AITaskType,
    CostPolicy,
    CostTier,
    CredentialHealth,
    CredentialTier,
    ModelCapability,
    ProviderType,
    ScopeType,
)


class ProjectScope(BaseModel):
    """Project and quota scope tracking for an AI credential.

    Crucial Quota Boundary Rules:
    - synthetic scope (UNVERIFIED_UNIQUE) is an internal tracking identity only.
    - USER_DECLARED_PROJECT and UNVERIFIED_UNIQUE scopes are NEVER treated as proof of quota independence.
    - Only VERIFIED_PROJECT metadata directly from the provider can establish genuine quota boundaries.
    """

    model_config = ConfigDict(frozen=True)

    scope_id: str
    scope_type: ScopeType = ScopeType.UNVERIFIED_UNIQUE
    verified: bool = False

    def is_provably_independent(self, other: "ProjectScope") -> bool:
        """Return True if and only if both scopes are provider-verified to belong to distinct projects.

        Any unverified or user-declared scope cannot guarantee quota independence.
        """
        if not self.verified or not other.verified:
            return False
        if (
            self.scope_type != ScopeType.VERIFIED_PROJECT
            or other.scope_type != ScopeType.VERIFIED_PROJECT
        ):
            return False
        return self.scope_id != other.scope_id

    def shares_known_scope(self, other: "ProjectScope") -> bool:
        """Return True if both credentials explicitly share the same project scope identifier."""
        return self.scope_id == other.scope_id and (
            self.verified or self.scope_type == ScopeType.USER_DECLARED_PROJECT
        )


class UserCredential(BaseModel):
    """Reusable provider credential belonging to an authenticated user."""

    id: str
    user_id: str
    provider: ProviderType
    friendly_name: str
    encrypted_api_key: str = Field(repr=False)
    masked_key: str
    project_scope: ProjectScope
    cost_tier: CredentialTier = CredentialTier.FREE_TIER
    is_active: bool = True
    health_status: CredentialHealth = CredentialHealth.HEALTHY
    cooldown_until: datetime | None = None
    decrypted_key: str | None = Field(default=None, repr=False, exclude=True)
    created_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(UTC))


class ModelDescriptor(BaseModel):
    """Descriptor for an AI model supported by a provider adapter."""

    model_config = ConfigDict(frozen=True)

    model_id: str
    provider: ProviderType
    display_name: str
    capabilities: set[ModelCapability]
    context_window: int = 128000
    cost_tier: CostTier = CostTier.UNKNOWN
    is_available: bool = True
    default_priority: int = 100

    def satisfies_capabilities(self, required: set[ModelCapability]) -> bool:
        """Check if this model satisfies all required capabilities for a task."""
        return required.issubset(self.capabilities)


class TaskRequirements(BaseModel):
    """Task specification and required model capabilities."""

    model_config = ConfigDict(frozen=True)

    task: AITaskType
    required_capabilities: set[ModelCapability]
    minimum_context_window: int = 4000
    schema_required: bool = False


class UserAIProfile(BaseModel):
    """Per-user configuration profile for routing, cost policy, and preferences."""

    user_id: str
    cost_policy: CostPolicy = CostPolicy.FREE_ONLY
    allow_paid_fallback: bool = False
    primary_provider: ProviderType = ProviderType.GEMINI
    provider_priority: list[ProviderType] = Field(
        default_factory=lambda: [ProviderType.GEMINI, ProviderType.OPENROUTER, ProviderType.GROQ]
    )
    task_routing: dict[str, str] = Field(default_factory=dict)
    credentials: list[UserCredential] = Field(default_factory=list)
    created_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(UTC))


class CostPolicyCheckResult(BaseModel):
    """Result of evaluating a model and credential against a user's cost policy."""

    model_config = ConfigDict(frozen=True)

    allowed: bool
    effective_tier: CostTier
    rejection_reason: str | None = None


def evaluate_cost_policy(
    policy: CostPolicy,
    allow_paid_fallback: bool,
    model_tier: CostTier,
    credential_tier: CredentialTier = CredentialTier.FREE_TIER,
) -> CostPolicyCheckResult:
    """Server-side enforcement of cost policy against model and credential tiers.

    Unknown pricing is treated as PAID for safety to prevent accidental spending.
    """
    # Defensive classification: UNKNOWN is treated as PAID
    is_free = model_tier == CostTier.FREE and credential_tier == CredentialTier.FREE_TIER
    effective_tier = CostTier.FREE if is_free else CostTier.PAID

    if policy == CostPolicy.FREE_ONLY:
        if effective_tier == CostTier.FREE:
            return CostPolicyCheckResult(allowed=True, effective_tier=CostTier.FREE)
        return CostPolicyCheckResult(
            allowed=False,
            effective_tier=effective_tier,
            rejection_reason=(
                f"Resource is classified as {effective_tier.value} (model={model_tier.value}, "
                f"credential={credential_tier.value}), which violates FREE_ONLY policy."
            ),
        )

    if policy == CostPolicy.FREE_PREFERRED:
        if effective_tier == CostTier.FREE:
            return CostPolicyCheckResult(allowed=True, effective_tier=CostTier.FREE)
        if allow_paid_fallback:
            return CostPolicyCheckResult(allowed=True, effective_tier=CostTier.PAID)
        return CostPolicyCheckResult(
            allowed=False,
            effective_tier=effective_tier,
            rejection_reason=(
                f"Resource is classified as {effective_tier.value}. Under FREE_PREFERRED policy, "
                "paid fallback is blocked because allowPaidFallback is disabled."
            ),
        )

    # ANY_CONFIGURED allows both free and paid
    return CostPolicyCheckResult(allowed=True, effective_tier=effective_tier)


class ExecutionRequest(BaseModel):
    """Specification of an AI invocation request passed to the orchestrator."""

    model_config = ConfigDict(arbitrary_types_allowed=True)

    task: AITaskType
    user_id: str
    prompt: str
    system_instruction: str | None = None
    schema_cls: Any | None = None
    temperature: float = 0.7
    execution_timeout: float = 30.0
    metadata: dict[str, Any] = Field(default_factory=dict)


class ExecutionResponse(BaseModel):
    """Result of an AI invocation returned by the orchestrator."""

    model_config = ConfigDict(arbitrary_types_allowed=True)

    text: str
    structured_data: Any | None = None
    provider_used: ProviderType
    model_used: str
    credential_id_used: str
    latency_ms: float
    token_usage: dict[str, int] = Field(default_factory=dict)
    attempted_hops: list[dict[str, Any]] = Field(default_factory=list)
