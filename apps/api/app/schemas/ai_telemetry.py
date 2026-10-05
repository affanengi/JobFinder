"""Pydantic schemas for AI Hub Telemetry, Health Diagnostics, and Live Probes."""

from datetime import UTC, datetime

from pydantic import BaseModel, Field

from app.ai.hub.types import (
    AITaskType,
    CostTier,
    CredentialHealth,
    ModelCapability,
    ProviderType,
)


class ProbeRequest(BaseModel):
    """Optional configuration for running a credential probe."""

    customPrompt: str | None = Field(default=None, max_length=100)


class ProbeResponse(BaseModel):
    """Safe diagnostic result of testing an AI credential connection.

    GUARANTEE: Secrets, authorization headers, and raw exception URLs are NEVER exposed.
    """

    credentialId: str
    provider: ProviderType
    model: str
    success: bool
    latencyMs: float
    message: str
    healthStatus: CredentialHealth
    timestamp: str = Field(default_factory=lambda: datetime.now(UTC).isoformat())


class ActiveCooldownDTO(BaseModel):
    """Safe representation of an active model or credential cooldown."""

    credentialId: str
    modelId: str
    expiresInSeconds: float


class ProviderHealthDTO(BaseModel):
    """Operational status of a provider adapter."""

    provider: ProviderType
    operational: bool
    registeredModelsCount: int


class AIHealthResponse(BaseModel):
    """Per-user runtime health diagnostic state."""

    providers: list[ProviderHealthDTO]
    credentialStatuses: dict[str, CredentialHealth]
    activeCooldowns: list[ActiveCooldownDTO]
    healthyCredentialsCount: int
    totalCredentialsCount: int
    timestamp: str = Field(default_factory=lambda: datetime.now(UTC).isoformat())


class ModelCatalogItemDTO(BaseModel):
    """Safe model descriptor for display in the UI catalog."""

    modelId: str
    provider: ProviderType
    displayName: str
    capabilities: list[ModelCapability]
    contextWindow: int
    costTier: CostTier
    defaultPriority: int
    isAvailable: bool = True


class ExecutionTelemetryDTO(BaseModel):
    """Safe execution telemetry record for a completed AI invocation.

    GUARANTEE: Prompts, completions, raw keys, and secret tokens are NEVER stored.
    """

    executionId: str
    userId: str
    task: AITaskType
    providerUsed: ProviderType
    modelUsed: str
    credentialIdUsed: str
    success: bool
    latencyMs: float
    fallbackLevel: int = 0
    hopsCount: int = 1
    failureCategory: str | None = None
    costTier: CostTier = CostTier.FREE
    timestamp: str


class TelemetrySummaryDTO(BaseModel):
    """Aggregated statistics for user AI executions."""

    totalRequests: int = 0
    successfulRequests: int = 0
    failedRequests: int = 0
    successRate: float = 0.0
    averageLatencyMs: float = 0.0
    fallbackCount: int = 0
    providerDistribution: dict[str, int] = Field(default_factory=dict)
    taskDistribution: dict[str, int] = Field(default_factory=dict)


class TelemetryResponse(BaseModel):
    """Telemetry dashboard payload containing aggregated statistics and recent history."""

    summary: TelemetrySummaryDTO
    recentExecutions: list[ExecutionTelemetryDTO]
    timestamp: str = Field(default_factory=lambda: datetime.now(UTC).isoformat())
