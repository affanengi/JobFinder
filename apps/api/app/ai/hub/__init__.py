"""AI/API Hub domain package.

Centralized AI execution and routing layer supporting multiple providers,
isolated credentials, capability-aware routing, and cost control.
"""

from app.ai.hub.crypto import (
    CryptoError,
    CryptoKeyMissingError,
    CryptoTamperError,
    decrypt_api_key,
    encrypt_api_key,
    mask_api_key,
    sanitize_text,
)
from app.ai.hub.models import (
    CostPolicyCheckResult,
    ExecutionRequest,
    ExecutionResponse,
    ModelDescriptor,
    ProjectScope,
    TaskRequirements,
    UserAIProfile,
    UserCredential,
)
from app.ai.hub.types import (
    AITaskType,
    CostPolicy,
    CostTier,
    CredentialHealth,
    CredentialTier,
    ModelCapability,
    ModelHealth,
    ProviderType,
    ScopeType,
)

__all__ = [
    "AITaskType",
    "CostPolicy",
    "CostTier",
    "CredentialHealth",
    "CredentialTier",
    "ModelCapability",
    "ModelHealth",
    "ProviderType",
    "ScopeType",
    "ProjectScope",
    "UserCredential",
    "ModelDescriptor",
    "TaskRequirements",
    "UserAIProfile",
    "CostPolicyCheckResult",
    "ExecutionRequest",
    "ExecutionResponse",
    "CryptoError",
    "CryptoKeyMissingError",
    "CryptoTamperError",
    "encrypt_api_key",
    "decrypt_api_key",
    "mask_api_key",
    "sanitize_text",
]
