"""Domain enumeration types for AI/API Hub.

Defines tasks, providers, cost tiers, policies, capabilities, scopes, and health states.
"""

from enum import StrEnum


class AITaskType(StrEnum):
    """Supported AI tasks in JobFinder."""

    RESUME_TAILORING = "resume_tailoring"
    COVER_LETTER_GEN = "cover_letter_gen"
    DUAL_ARTIFACT_GEN = "dual_artifact_gen"
    ATS_BULLET_REWRITE = "ats_bullet_rewrite"
    ATS_BULK_REWRITE = "ats_bulk_rewrite"
    QA_COPILOT = "qa_copilot"
    RESUME_PARSING = "resume_parsing"
    JOB_INGESTION = "job_ingestion"
    JOB_ANALYSIS = "job_analysis"


class ProviderType(StrEnum):
    """Supported AI model providers."""

    GEMINI = "gemini"
    OPENROUTER = "openrouter"
    GROQ = "groq"
    OPENAI = "openai"
    ANTHROPIC = "anthropic"


class CostTier(StrEnum):
    """Resource pricing classification."""

    FREE = "FREE"
    PAID = "PAID"
    UNKNOWN = "UNKNOWN"


class CredentialTier(StrEnum):
    """Credential billing tier classification."""

    FREE_TIER = "FREE_TIER"
    PAID_TIER = "PAID_TIER"
    UNKNOWN = "UNKNOWN"


class CostPolicy(StrEnum):
    """User cost enforcement policy."""

    FREE_ONLY = "FREE_ONLY"
    FREE_PREFERRED = "FREE_PREFERRED"
    ANY_CONFIGURED = "ANY_CONFIGURED"


class ModelCapability(StrEnum):
    """Specific model capability requirements."""

    STRUCTURED_OUTPUT = "STRUCTURED_OUTPUT"
    LONG_CONTEXT = "LONG_CONTEXT"
    HIGH_REASONING = "HIGH_REASONING"
    FAST_INFERENCE = "FAST_INFERENCE"
    EMBEDDINGS = "EMBEDDINGS"


class ScopeType(StrEnum):
    """Quota boundary scope classification.

    Note: USER_DECLARED_PROJECT and UNVERIFIED_UNIQUE are NEVER treated as proof
    of independent quota. Only VERIFIED_PROJECT establishes genuine quota boundaries.
    """

    VERIFIED_PROJECT = "VERIFIED_PROJECT"
    USER_DECLARED_PROJECT = "USER_DECLARED_PROJECT"
    UNVERIFIED_UNIQUE = "UNVERIFIED_UNIQUE"


class CredentialHealth(StrEnum):
    """Real-time operational status of an individual credential."""

    HEALTHY = "HEALTHY"
    COOLDOWN = "COOLDOWN"
    QUOTA_EXHAUSTED = "QUOTA_EXHAUSTED"
    INVALID_KEY = "INVALID_KEY"
    CONFIG_ERROR = "CONFIG_ERROR"


class ModelHealth(StrEnum):
    """Operational status of a specific model on a provider/credential."""

    HEALTHY = "HEALTHY"
    COOLDOWN = "COOLDOWN"
    DEGRADED = "DEGRADED"
    UNAVAILABLE = "UNAVAILABLE"
