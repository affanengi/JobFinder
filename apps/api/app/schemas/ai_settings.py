"""Pydantic schemas for AI Settings and Credential REST API."""

from pydantic import BaseModel, ConfigDict, Field

from app.ai.hub.types import (
    CostPolicy,
    CredentialTier,
    ProviderType,
    ScopeType,
)


class ProjectScopeDTO(BaseModel):
    """Project and quota scope representation for an AI credential."""

    model_config = ConfigDict(frozen=True)

    scope_id: str
    scope_type: ScopeType = ScopeType.UNVERIFIED_UNIQUE
    verified: bool = False


class CredentialCreateRequest(BaseModel):
    """Request payload to register a new user provider credential.

    Note: The raw apiKey is transmitted securely over HTTPS, encrypted immediately
    with AES-256-GCM, and NEVER logged or returned in responses.
    """

    provider: ProviderType
    friendlyName: str = Field(default="", max_length=100)
    apiKey: str = Field(..., min_length=1, max_length=500, repr=False)
    projectScope: ProjectScopeDTO | None = None
    costTier: CredentialTier = CredentialTier.FREE_TIER
    enabled: bool = True


class CredentialUpdateRequest(BaseModel):
    """Request payload to update an existing credential.

    If apiKey is omitted or null, the existing encrypted secret remains unchanged.
    """

    friendlyName: str | None = Field(default=None, min_length=1, max_length=100)
    apiKey: str | None = Field(default=None, min_length=1, max_length=500, repr=False)
    projectScope: ProjectScopeDTO | None = None
    costTier: CredentialTier | None = None
    enabled: bool | None = None


class CredentialStatusUpdateRequest(BaseModel):
    """Request payload to enable or disable a credential."""

    enabled: bool


class CredentialResponse(BaseModel):
    """Safe public representation of a user credential.

    GUARANTEE: The raw API key and encrypted cipher payload are NEVER exposed.
    Only a safe masked representation (e.g. AIzaSy••••••••abcd) is provided.
    """

    credentialId: str
    userId: str
    provider: ProviderType
    friendlyName: str
    maskedApiKey: str
    projectScope: ProjectScopeDTO
    costTier: CredentialTier
    enabled: bool
    createdAt: str
    updatedAt: str


class AISettingsUpdateRequest(BaseModel):
    """Request payload to update user AI routing preferences and cost policies."""

    costPolicy: CostPolicy | None = None
    allowPaidFallback: bool | None = None
    primaryProvider: ProviderType | None = None
    providerPriority: list[ProviderType] | None = None
    taskRouting: dict[str, str] | None = None


class AISettingsResponse(BaseModel):
    """User AI configuration profile and routing preferences."""

    userId: str
    costPolicy: CostPolicy
    allowPaidFallback: bool
    primaryProvider: ProviderType
    providerPriority: list[ProviderType]
    taskRouting: dict[str, str]
    updatedAt: str
