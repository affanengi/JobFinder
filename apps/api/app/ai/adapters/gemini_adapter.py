"""Google Gemini Provider Adapter implementing BaseProviderAdapter."""

import asyncio
import json
import logging
import random
from typing import TypeVar

from google import genai
from google.genai import errors as genai_errors
from google.genai import types
from pydantic import BaseModel, ValidationError

from app.ai.adapters.base import BaseProviderAdapter, SchemaRepairNeededError
from app.ai.errors import (
    AIAuthenticationError,
    AIConfigurationError,
    AIProviderError,
    AIProviderUnavailableError,
    AIRateLimitError,
    AIRequestError,
    AISafetyError,
    AIServiceUnavailableError,
    AITimeoutError,
    AITransientError,
)
from app.ai.hub.crypto import sanitize_text
from app.ai.hub.models import ModelDescriptor
from app.ai.hub.types import CostTier, ModelCapability, ProviderType
from app.core.config import settings

logger = logging.getLogger("jobFinder.ai.gemini_adapter")

T = TypeVar("T", bound=BaseModel)

DEFAULT_GENERATION_FALLBACK_CHAIN = [
    "gemini-3.5-flash-lite",  # 500 RPD, 15 RPM - Primary (highest quota & ultra-fast)
    "gemini-3.1-flash-lite",  # 500 RPD, 15 RPM - Secondary (high quota)
    "gemini-3.5-flash",  # 20 RPD
    "gemini-3.8-flash",  # 20 RPD
    "gemini-3.6-flash",  # 20 RPD
    "gemini-3.7-flash",  # 20 RPD
    "gemini-3-flash-preview",
]

DEFAULT_EMBEDDING_MODEL = "gemini-embedding-2"


class GeminiAdapter(BaseProviderAdapter):
    """Provider adapter interfacing with Google GenAI SDK."""

    def __init__(
        self,
        api_key: str | None = None,
        client: genai.Client | None = None,
        embedding_model: str | None = None,
    ):
        self.api_key = api_key or settings.GEMINI_API_KEY
        self.embedding_model = embedding_model or DEFAULT_EMBEDDING_MODEL
        self._client = client
        if self._client is None and self.api_key:
            self._client = genai.Client(api_key=self.api_key)

    @property
    def provider_type(self) -> ProviderType:
        return ProviderType.GEMINI

    def get_client(
        self, api_key: str | None = None, injected_client: genai.Client | None = None
    ) -> genai.Client:
        """Resolve client using injected mock, provided api_key, or default."""
        if injected_client is not None:
            return injected_client
        if api_key:
            return genai.Client(api_key=api_key)
        if self._client is not None:
            return self._client
        key = self.api_key
        if not key:
            raise AIAuthenticationError(
                "Gemini API key is not configured. Please set GEMINI_API_KEY in .env."
            )
        self._client = genai.Client(api_key=key)
        return self._client

    def _parse_rate_limit_details(self, error: Exception) -> tuple[bool, float | None, str | None]:
        """Extract structured rate-limit and quota information from provider error.

        Returns:
            (is_project_quota_exhausted, retry_after, quota_metric)
        """
        is_project_exhausted = False
        retry_after: float | None = None
        quota_metric: str | None = None

        raw_details = getattr(error, "details", None)
        if raw_details:
            details_list = raw_details if isinstance(raw_details, (list, tuple)) else [raw_details]
            for item in details_list:
                if isinstance(item, dict):
                    reason = str(item.get("reason", "")).upper()
                    metadata = item.get("metadata", {}) if isinstance(item.get("metadata"), dict) else {}
                    q_metric = metadata.get("quota_metric") or metadata.get("metric", "")
                    if q_metric:
                        quota_metric = str(q_metric)
                    if "QUOTA" in reason and any(term in str(q_metric).lower() for term in ("day", "daily", "project")):
                        is_project_exhausted = True
                elif hasattr(item, "reason"):
                    reason = str(getattr(item, "reason", "")).upper()
                    metadata = getattr(item, "metadata", {}) or {}
                    q_metric = metadata.get("quota_metric", "") if isinstance(metadata, dict) else ""
                    if q_metric:
                        quota_metric = str(q_metric)
                    if "QUOTA" in reason and any(term in str(q_metric).lower() for term in ("day", "daily", "project")):
                        is_project_exhausted = True

        response = getattr(error, "response", None)
        if response is not None:
            headers = getattr(response, "headers", {}) or {}
            ra = headers.get("retry-after") or headers.get("Retry-After")
            if ra:
                try:
                    retry_after = float(ra)
                except (ValueError, TypeError):
                    pass

        return is_project_exhausted, retry_after, quota_metric

    def classify_error(self, error: Exception, model: str) -> AIProviderError:
        """Classify a raw Gemini/Google API error into a typed domain exception."""
        if isinstance(error, AIProviderError):
            return error

        safe_msg = sanitize_text(str(error))
        err_str = safe_msg.lower()

        if (
            "429" in err_str
            or "resource_exhausted" in err_str
            or "quota" in err_str
            or "rate limit" in err_str
            or "too many requests" in err_str
        ):
            is_proj, ra, q_metric = self._parse_rate_limit_details(error)
            return AIRateLimitError(
                f"Rate limit / Quota exceeded on model {model}: {safe_msg}",
                model=model,
                status_code=429,
                is_project_quota_exhausted=is_proj,
                retry_after=ra,
                quota_metric=q_metric,
            )

        if isinstance(error, genai_errors.ClientError):
            code = getattr(error, "code", None) or getattr(error, "status_code", None)
            if code == 401 or "401" in err_str or "unauthenticated" in err_str:
                return AIAuthenticationError(
                    f"Invalid API Key for model {model}: {safe_msg}", model=model, status_code=401
                )
            if (
                code == 403
                or "403" in err_str
                or "permission" in err_str
                or "not enabled" in err_str
            ):
                return AIConfigurationError(
                    f"Permission/Billing failure for model {model}: {safe_msg}",
                    model=model,
                    status_code=403,
                )
            if (
                code == 404
                or "404" in err_str
                or "not found" in err_str
                or "no longer available" in err_str
            ):
                return AIServiceUnavailableError(
                    f"Model {model} is not available: {safe_msg}", model=model, status_code=404
                )
            if (
                code == 429
                or "429" in err_str
                or "resource_exhausted" in err_str
                or "quota" in err_str
            ):
                is_proj, ra, q_metric = self._parse_rate_limit_details(error)
                return AIRateLimitError(
                    f"Rate limit / Quota exceeded on model {model}: {safe_msg}",
                    model=model,
                    status_code=429,
                    is_project_quota_exhausted=is_proj,
                    retry_after=ra,
                    quota_metric=q_metric,
                )
            if code == 400 or "400" in err_str:
                return AIRequestError(
                    f"Malformed request to model {model}: {safe_msg}", model=model, status_code=400
                )

        if isinstance(error, genai_errors.ServerError):
            code = getattr(error, "code", None) or getattr(error, "status_code", None)
            if (
                code == 503
                or "503" in err_str
                or "unavailable" in err_str
                or "high demand" in err_str
            ):
                return AIServiceUnavailableError(
                    f"High demand/unavailable on model {model}: {safe_msg}",
                    model=model,
                    status_code=503,
                )
            return AITransientError(
                f"Server error on model {model}: {safe_msg}", model=model, status_code=code or 500
            )

        if "timeout" in err_str or "timed out" in err_str:
            return AITimeoutError(f"Request timed out on model {model}: {safe_msg}", model=model)

        if "safety" in err_str or "blocked" in err_str:
            return AISafetyError(f"Safety policy refusal on model {model}: {safe_msg}", model=model)

        return AIProviderError(
            f"Unexpected AI provider error on model {model}: {safe_msg}", model=model
        )

    def get_supported_models(self) -> list[ModelDescriptor]:
        """Return catalog of supported Gemini models with capability tags."""
        return [
            ModelDescriptor(
                model_id="gemini-3.5-flash-lite",
                provider=ProviderType.GEMINI,
                display_name="Gemini 3.5 Flash Lite",
                capabilities={
                    ModelCapability.STRUCTURED_OUTPUT,
                    ModelCapability.LONG_CONTEXT,
                    ModelCapability.FAST_INFERENCE,
                },
                context_window=1000000,
                cost_tier=CostTier.FREE,
                default_priority=10,
            ),
            ModelDescriptor(
                model_id="gemini-3.1-flash-lite",
                provider=ProviderType.GEMINI,
                display_name="Gemini 3.1 Flash Lite",
                capabilities={
                    ModelCapability.STRUCTURED_OUTPUT,
                    ModelCapability.LONG_CONTEXT,
                    ModelCapability.FAST_INFERENCE,
                },
                context_window=1000000,
                cost_tier=CostTier.FREE,
                default_priority=20,
            ),
            ModelDescriptor(
                model_id="gemini-3.5-flash",
                provider=ProviderType.GEMINI,
                display_name="Gemini 3.5 Flash",
                capabilities={
                    ModelCapability.STRUCTURED_OUTPUT,
                    ModelCapability.LONG_CONTEXT,
                    ModelCapability.HIGH_REASONING,
                    ModelCapability.FAST_INFERENCE,
                },
                context_window=1000000,
                cost_tier=CostTier.FREE,
                default_priority=30,
            ),
            ModelDescriptor(
                model_id="gemini-3.8-flash",
                provider=ProviderType.GEMINI,
                display_name="Gemini 3.8 Flash",
                capabilities={
                    ModelCapability.STRUCTURED_OUTPUT,
                    ModelCapability.LONG_CONTEXT,
                    ModelCapability.HIGH_REASONING,
                },
                context_window=1000000,
                cost_tier=CostTier.FREE,
                default_priority=40,
            ),
            ModelDescriptor(
                model_id="gemini-3.6-flash",
                provider=ProviderType.GEMINI,
                display_name="Gemini 3.6 Flash",
                capabilities={
                    ModelCapability.STRUCTURED_OUTPUT,
                    ModelCapability.LONG_CONTEXT,
                    ModelCapability.HIGH_REASONING,
                },
                context_window=1000000,
                cost_tier=CostTier.FREE,
                default_priority=50,
            ),
            ModelDescriptor(
                model_id="gemini-3.7-flash",
                provider=ProviderType.GEMINI,
                display_name="Gemini 3.7 Flash",
                capabilities={
                    ModelCapability.STRUCTURED_OUTPUT,
                    ModelCapability.LONG_CONTEXT,
                    ModelCapability.HIGH_REASONING,
                },
                context_window=1000000,
                cost_tier=CostTier.FREE,
                default_priority=60,
            ),
            ModelDescriptor(
                model_id="gemini-3-flash-preview",
                provider=ProviderType.GEMINI,
                display_name="Gemini 3 Flash Preview",
                capabilities={ModelCapability.STRUCTURED_OUTPUT, ModelCapability.LONG_CONTEXT},
                context_window=1000000,
                cost_tier=CostTier.FREE,
                default_priority=70,
            ),
        ]

    async def generate_text(
        self,
        model: str,
        prompt: str,
        system_instruction: str | None = None,
        temperature: float = 0.7,
        timeout: float = 30.0,
        **kwargs,
    ) -> str:
        client = None
        if kwargs.get("api_key"):
            client = self.get_client(kwargs.get("api_key"))
        elif kwargs.get("client"):
            client = kwargs.get("client")
        else:
            client = self.get_client()

        def _call() -> str:
            config = types.GenerateContentConfig(
                temperature=temperature,
                system_instruction=system_instruction,
            )
            response = client.models.generate_content(
                model=model,
                contents=prompt,
                config=config,
            )
            return response.text or ""

        return await asyncio.to_thread(_call)

    async def generate_structured(
        self,
        model: str,
        prompt: str,
        schema: type[T],
        system_instruction: str | None = None,
        temperature: float = 0.1,
        timeout: float = 30.0,
        **kwargs,
    ) -> tuple[str, T]:
        client = None
        if kwargs.get("api_key"):
            client = self.get_client(kwargs.get("api_key"))
        elif kwargs.get("client"):
            client = kwargs.get("client")
        else:
            client = self.get_client()

        def _call() -> str:
            config = types.GenerateContentConfig(
                temperature=temperature,
                system_instruction=system_instruction,
                response_mime_type="application/json",
                response_schema=schema,
            )
            response = client.models.generate_content(
                model=model,
                contents=prompt,
                config=config,
            )
            return response.text or "{}"

        raw_json = await asyncio.to_thread(_call)
        try:
            parsed = json.loads(raw_json)
            validated = schema.model_validate(parsed)
            return raw_json, validated
        except (json.JSONDecodeError, ValidationError) as validation_err:
            raise SchemaRepairNeededError(
                f"Structured validation failed: {validation_err}",
                raw_output=raw_json,
                original_error=validation_err,
            ) from validation_err

    async def embed(
        self,
        text: str,
        model: str | None = None,
        max_retries: int = 1,
        base_delay_seconds: float = 0.5,
        **kwargs,
    ) -> list[float]:
        """Generate vector embedding using gemini-embedding-2 with backoff and retry."""
        target_model = model or self.embedding_model
        client = kwargs.get("client") or self.get_client(kwargs.get("api_key"))

        for attempt in range(max_retries + 1):
            try:

                def _call_embed() -> list[float]:
                    res = client.models.embed_content(
                        model=target_model,
                        contents=text,
                    )
                    if (
                        hasattr(res, "embedding")
                        and res.embedding
                        and res.embedding.values is not None
                    ):
                        return list(res.embedding.values)
                    if (
                        hasattr(res, "embeddings")
                        and res.embeddings
                        and res.embeddings[0].values is not None
                    ):
                        return list(res.embeddings[0].values)
                    raise AIProviderError("Invalid embedding response format from Gemini.")

                return await asyncio.to_thread(_call_embed)
            except Exception as raw_e:
                classified_err = self.classify_error(raw_e, target_model)

                if attempt >= max_retries:
                    logger.error(
                        f"[AI_EMBEDDING_ERROR] Failed to generate embedding on {target_model}: {classified_err}"
                    )
                    raise classified_err from raw_e

                delay = base_delay_seconds * (2**attempt) + random.uniform(0.1, 0.3)
                logger.warning(
                    f"[AI_EMBEDDING_RETRY] {target_model} transient error. Retrying in {delay:.2f}s..."
                )
                await asyncio.sleep(delay)

        raise AIProviderUnavailableError(f"Embedding model {target_model} failed after retries.")
