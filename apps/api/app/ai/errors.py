"""Error Classification Layer for AI Providers."""

from typing import Any


class AIProviderError(Exception):
    """Base exception for all AI provider errors."""

    def __init__(
        self,
        message: str,
        model: str | None = None,
        status_code: int | None = None,
        details: dict[str, Any] | None = None,
    ):
        super().__init__(message)
        self.message = message
        self.model = model
        self.status_code = status_code
        self.details = details or {}


# ==============================================================================
# Transient / Fallback-Eligible Errors (Retry with backoff & model fallback)
# ==============================================================================


class AITransientError(AIProviderError):
    """Temporary model or network failure that may be retried or fallbacked."""


class AIRateLimitError(AITransientError):
    """HTTP 429 / Resource exhausted / Quota exceeded."""

    def __init__(
        self,
        message: str,
        model: str | None = None,
        status_code: int | None = 429,
        details: dict[str, Any] | None = None,
        is_project_quota_exhausted: bool = False,
        retry_after: float | None = None,
        quota_metric: str | None = None,
    ):
        super().__init__(message, model=model, status_code=status_code, details=details)
        self.is_project_quota_exhausted = is_project_quota_exhausted
        self.retry_after = retry_after
        self.quota_metric = quota_metric


class AIServiceUnavailableError(AITransientError):
    """HTTP 503 / Service unavailable / High demand spike."""


class AITimeoutError(AITransientError):
    """Network connection or gateway timeout."""


class AIProviderUnavailableError(AIProviderError):
    """Raised when all models in the fallback chain have failed."""


# ==============================================================================
# Non-Transient / Unrecoverable Errors (DO NOT fallback - fail immediately)
# ==============================================================================


class AIAuthenticationError(AIProviderError):
    """HTTP 401 / Invalid API key or credentials."""


class AIConfigurationError(AIProviderError):
    """HTTP 403 / API not enabled, billing, or project permission failure."""


class AIRequestError(AIProviderError):
    """HTTP 400 / Malformed request or invalid parameters."""


class AISafetyError(AIProviderError):
    """Model safety policy refusal."""


class AIOutputValidationError(AIProviderError):
    """Model generated output that failed Pydantic schema validation."""
