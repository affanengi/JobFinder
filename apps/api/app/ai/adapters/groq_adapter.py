"""Groq Cloud Provider Adapter implementing BaseProviderAdapter."""

import json
import logging
import re
from typing import Any, TypeVar

import httpx
from pydantic import BaseModel, ValidationError

from app.ai.adapters.base import BaseProviderAdapter, SchemaRepairNeededError
from app.ai.errors import (
    AIAuthenticationError,
    AIConfigurationError,
    AIProviderError,
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

logger = logging.getLogger("jobFinder.ai.groq_adapter")

T = TypeVar("T", bound=BaseModel)

DEFAULT_GROQ_MODELS = [
    ModelDescriptor(
        model_id="openai/gpt-oss-120b",
        provider=ProviderType.GROQ,
        display_name="GPT OSS 120B (Groq)",
        capabilities={
            ModelCapability.STRUCTURED_OUTPUT,
            ModelCapability.LONG_CONTEXT,
            ModelCapability.HIGH_REASONING,
            ModelCapability.FAST_INFERENCE,
        },
        context_window=131072,
        cost_tier=CostTier.FREE,
        default_priority=10,
        is_available=True,
    ),
    ModelDescriptor(
        model_id="openai/gpt-oss-20b",
        provider=ProviderType.GROQ,
        display_name="GPT OSS 20B (Groq)",
        capabilities={
            ModelCapability.STRUCTURED_OUTPUT,
            ModelCapability.LONG_CONTEXT,
            ModelCapability.FAST_INFERENCE,
            ModelCapability.HIGH_REASONING,
        },
        context_window=131072,
        cost_tier=CostTier.FREE,
        default_priority=20,
        is_available=True,
    ),
    ModelDescriptor(
        model_id="qwen/qwen3.8-27b",
        provider=ProviderType.GROQ,
        display_name="Qwen 3.8 27B (Groq)",
        capabilities={
            ModelCapability.STRUCTURED_OUTPUT,
            ModelCapability.LONG_CONTEXT,
            ModelCapability.FAST_INFERENCE,
            ModelCapability.HIGH_REASONING,
        },
        context_window=131072,
        cost_tier=CostTier.FREE,
        default_priority=30,
        is_available=True,
    ),
    # Legacy descriptors kept for backward compatibility and test mock validation
    ModelDescriptor(
        model_id="llama-3.3-70b-versatile",
        provider=ProviderType.GROQ,
        display_name="Llama 3.3 70B Versatile (Legacy/Groq)",
        capabilities={
            ModelCapability.STRUCTURED_OUTPUT,
            ModelCapability.LONG_CONTEXT,
            ModelCapability.HIGH_REASONING,
            ModelCapability.FAST_INFERENCE,
        },
        context_window=128000,
        cost_tier=CostTier.FREE,
        default_priority=90,
        is_available=False,
    ),
    ModelDescriptor(
        model_id="llama-3.1-8b-instant",
        provider=ProviderType.GROQ,
        display_name="Llama 3.1 8B Instant (Legacy/Groq)",
        capabilities={
            ModelCapability.STRUCTURED_OUTPUT,
            ModelCapability.FAST_INFERENCE,
        },
        context_window=128000,
        cost_tier=CostTier.FREE,
        default_priority=91,
        is_available=False,
    ),
    ModelDescriptor(
        model_id="mixtral-8x7b-32768",
        provider=ProviderType.GROQ,
        display_name="Mixtral 8x7B 32k (Legacy/Groq)",
        capabilities={ModelCapability.FAST_INFERENCE},
        context_window=32768,
        cost_tier=CostTier.FREE,
        default_priority=92,
        is_available=False,
    ),
    ModelDescriptor(
        model_id="gemma2-9b-it",
        provider=ProviderType.GROQ,
        display_name="Gemma 2 9B IT (Legacy/Groq)",
        capabilities={ModelCapability.FAST_INFERENCE},
        context_window=8192,
        cost_tier=CostTier.FREE,
        default_priority=93,
        is_available=False,
    ),
]


class GroqAdapter(BaseProviderAdapter):
    """Provider adapter interfacing with Groq Cloud ultra-fast inference API."""

    def __init__(
        self,
        api_key: str | None = None,
        base_url: str = "https://api.groq.com/openai/v1",
        http_client: httpx.AsyncClient | None = None,
    ):
        self.api_key = api_key or settings.GROQ_API_KEY
        self.base_url = base_url.rstrip("/")
        self._client = http_client
        self._models: dict[str, ModelDescriptor] = {m.model_id: m for m in DEFAULT_GROQ_MODELS}

    @property
    def provider_type(self) -> ProviderType:
        return ProviderType.GROQ

    def register_model(self, descriptor: ModelDescriptor) -> None:
        """Register or override a model descriptor in the catalog."""
        self._models[descriptor.model_id] = descriptor

    def get_supported_models(self) -> list[ModelDescriptor]:
        """Return list of supported models in this catalog."""
        return list(self._models.values())

    def _get_headers(self, api_key: str | None = None) -> dict[str, str]:
        key = api_key or self.api_key
        if not key:
            raise AIAuthenticationError(
                "Groq API key is not configured. Please set GROQ_API_KEY in .env or configure a credential."
            )
        return {
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
        }

    def classify_error(self, error: Exception, model: str) -> AIProviderError:
        """Translate raw HTTP or Groq API errors into typed domain exceptions."""
        if isinstance(error, AIProviderError):
            return error

        safe_msg = sanitize_text(str(error))
        err_str = safe_msg.lower()
        status_code: int | None = None

        if isinstance(error, httpx.HTTPStatusError):
            status_code = error.response.status_code
            try:
                data = error.response.json()
                if isinstance(data, dict):
                    err_msg = (
                        data.get("error", {}).get("message") or data.get("message") or safe_msg
                    )
                    err_str = f"{err_str} {sanitize_text(str(err_msg)).lower()}"
            except Exception:
                pass

        if (
            status_code == 401
            or "401" in err_str
            or "unauthenticated" in err_str
            or "invalid api key" in err_str
        ):
            return AIAuthenticationError(
                f"Groq authentication failed for model {model}: {safe_msg}",
                model=model,
                status_code=401,
            )

        if status_code == 403 or "403" in err_str or "forbidden" in err_str:
            return AIConfigurationError(
                f"Groq configuration or permission error for model {model}: {safe_msg}",
                model=model,
                status_code=403,
            )

        if (
            status_code == 404
            or "404" in err_str
            or "model not found" in err_str
            or "does not exist" in err_str
        ):
            return AIServiceUnavailableError(
                f"Groq model {model} not found or unavailable: {safe_msg}",
                model=model,
                status_code=404,
            )

        if (
            status_code == 429
            or "429" in err_str
            or "rate limit" in err_str
            or "quota" in err_str
            or "too many requests" in err_str
            or "rate_limit_exceeded" in err_str
        ):
            return AIRateLimitError(
                f"Groq rate limit / quota exceeded for model {model}: {safe_msg}",
                model=model,
                status_code=429,
            )

        if status_code == 400 or "400" in err_str or "bad request" in err_str:
            return AIRequestError(
                f"Malformed Groq request for model {model}: {safe_msg}",
                model=model,
                status_code=400,
            )

        if (
            status_code in (502, 503)
            or "503" in err_str
            or "502" in err_str
            or "service unavailable" in err_str
        ):
            return AIServiceUnavailableError(
                f"Groq service temporarily unavailable for model {model}: {safe_msg}",
                model=model,
                status_code=status_code or 503,
            )

        if status_code and 500 <= status_code < 600:
            return AITransientError(
                f"Groq server error ({status_code}) for model {model}: {safe_msg}",
                model=model,
                status_code=status_code,
            )

        if (
            isinstance(error, (httpx.TimeoutException, TimeoutError))
            or "timeout" in err_str
            or "timed out" in err_str
        ):
            return AITimeoutError(
                f"Groq request timed out for model {model}: {safe_msg}",
                model=model,
            )

        if "safety" in err_str or "moderation" in err_str or "content filter" in err_str:
            return AISafetyError(
                f"Groq safety/moderation rejection on model {model}: {safe_msg}",
                model=model,
            )

        return AIProviderError(
            f"Unexpected Groq error for model {model}: {safe_msg}",
            model=model,
            status_code=status_code,
        )

    async def _make_request(
        self,
        payload: dict[str, Any],
        timeout: float,
        api_key: str | None = None,
        custom_client: httpx.AsyncClient | None = None,
    ) -> dict[str, Any]:
        """Send JSON payload to Groq chat completions endpoint."""
        url = f"{self.base_url}/chat/completions"
        headers = self._get_headers(api_key)

        client = custom_client or self._client
        if client:
            resp = await client.post(url, json=payload, headers=headers, timeout=timeout)
            resp.raise_for_status()
            return resp.json()

        async with httpx.AsyncClient() as managed_client:
            resp = await managed_client.post(url, json=payload, headers=headers, timeout=timeout)
            resp.raise_for_status()
            return resp.json()

    async def generate_text(
        self,
        model: str,
        prompt: str,
        system_instruction: str | None = None,
        temperature: float = 0.7,
        timeout: float = 30.0,
        **kwargs,
    ) -> str:
        """Generate unstructured text via Groq."""
        messages: list[dict[str, str]] = []
        if system_instruction:
            messages.append({"role": "system", "content": system_instruction})
        messages.append({"role": "user", "content": prompt})

        payload = {
            "model": model,
            "messages": messages,
            "temperature": temperature,
        }

        try:
            data = await self._make_request(
                payload=payload,
                timeout=timeout,
                api_key=kwargs.get("api_key"),
                custom_client=kwargs.get("client"),
            )
            choices = data.get("choices")
            if not choices:
                return ""
            message = choices[0].get("message", {})
            return message.get("content") or ""
        except Exception as e:
            raise self.classify_error(e, model) from e

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
        """Generate structured JSON via Groq and validate against Pydantic schema."""
        messages: list[dict[str, str]] = []
        schema_json = json.dumps(schema.model_json_schema())
        system_prompt = (
            f"{system_instruction or 'You are a structured data extractor.'}\n"
            f"You MUST respond ONLY with valid JSON conforming strictly to this JSON schema:\n"
            f"{schema_json}\nDo not include markdown fences or explanation."
        )
        messages.append({"role": "system", "content": system_prompt})
        messages.append({"role": "user", "content": prompt})

        payload = {
            "model": model,
            "messages": messages,
            "temperature": temperature,
            "response_format": {"type": "json_object"},
        }

        try:
            data = await self._make_request(
                payload=payload,
                timeout=timeout,
                api_key=kwargs.get("api_key"),
                custom_client=kwargs.get("client"),
            )
            choices = data.get("choices")
            if not choices:
                raw_text = "{}"
            else:
                raw_text = choices[0].get("message", {}).get("content") or "{}"
        except Exception as e:
            raise self.classify_error(e, model) from e

        # Clean any potential markdown code fences
        cleaned = raw_text.strip()
        cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned, flags=re.MULTILINE)
        cleaned = re.sub(r"\s*```$", "", cleaned, flags=re.MULTILINE).strip()

        try:
            parsed = json.loads(cleaned)
            validated = schema.model_validate(parsed)
            return raw_text, validated
        except (json.JSONDecodeError, ValidationError) as validation_err:
            raise SchemaRepairNeededError(
                f"Groq model {model} structured validation failed: {validation_err}",
                raw_output=raw_text,
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
        """Embedding is intentionally unsupported on Groq to preserve Gemini embedding isolation."""
        raise AIConfigurationError(
            "Groq provider adapter does not support vector embeddings in this architecture; "
            "vector embeddings are isolated to the Gemini adapter.",
            model=model,
            status_code=400,
        )
