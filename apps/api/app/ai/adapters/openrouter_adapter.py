"""OpenRouter Provider Adapter implementing BaseProviderAdapter."""

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

logger = logging.getLogger("jobFinder.ai.openrouter_adapter")

T = TypeVar("T", bound=BaseModel)

DEFAULT_OPENROUTER_MODELS = [
    ModelDescriptor(
        model_id="openrouter/free",
        provider=ProviderType.OPENROUTER,
        display_name="OpenRouter Free Router (:free)",
        capabilities={
            ModelCapability.STRUCTURED_OUTPUT,
            ModelCapability.LONG_CONTEXT,
            ModelCapability.HIGH_REASONING,
            ModelCapability.FAST_INFERENCE,
        },
        context_window=200000,
        cost_tier=CostTier.FREE,
        default_priority=10,
        is_available=True,
    ),
    ModelDescriptor(
        model_id="nvidia/nemotron-3-ultra-550b-a55b:free",
        provider=ProviderType.OPENROUTER,
        display_name="Nemotron 3 Ultra 550B (Free)",
        capabilities={
            ModelCapability.STRUCTURED_OUTPUT,
            ModelCapability.LONG_CONTEXT,
            ModelCapability.HIGH_REASONING,
            ModelCapability.FAST_INFERENCE,
        },
        context_window=1000000,
        cost_tier=CostTier.FREE,
        default_priority=20,
        is_available=True,
    ),
    ModelDescriptor(
        model_id="nvidia/nemotron-3-super-120b-a12b:free",
        provider=ProviderType.OPENROUTER,
        display_name="Nemotron 3 Super 120B (Free)",
        capabilities={
            ModelCapability.STRUCTURED_OUTPUT,
            ModelCapability.LONG_CONTEXT,
            ModelCapability.HIGH_REASONING,
            ModelCapability.FAST_INFERENCE,
        },
        context_window=262144,
        cost_tier=CostTier.FREE,
        default_priority=30,
        is_available=True,
    ),
    ModelDescriptor(
        model_id="nvidia/nemotron-3.5-lightning:free",
        provider=ProviderType.OPENROUTER,
        display_name="Nemotron 3.5 Lightning (Free)",
        capabilities={
            ModelCapability.STRUCTURED_OUTPUT,
            ModelCapability.LONG_CONTEXT,
            ModelCapability.HIGH_REASONING,
            ModelCapability.FAST_INFERENCE,
        },
        context_window=1000000,
        cost_tier=CostTier.FREE,
        default_priority=40,
        is_available=True,
    ),
    ModelDescriptor(
        model_id="poolside/laguna-s-2.1:free",
        provider=ProviderType.OPENROUTER,
        display_name="Poolside Laguna S 2.1 (Free)",
        capabilities={
            ModelCapability.STRUCTURED_OUTPUT,
            ModelCapability.LONG_CONTEXT,
            ModelCapability.FAST_INFERENCE,
        },
        context_window=262144,
        cost_tier=CostTier.FREE,
        default_priority=50,
        is_available=True,
    ),
    ModelDescriptor(
        model_id="poolside/laguna-xs-2.1:free",
        provider=ProviderType.OPENROUTER,
        display_name="Poolside Laguna XS 2.1 (Free)",
        capabilities={
            ModelCapability.STRUCTURED_OUTPUT,
            ModelCapability.FAST_INFERENCE,
        },
        context_window=262144,
        cost_tier=CostTier.FREE,
        default_priority=60,
        is_available=True,
    ),
    ModelDescriptor(
        model_id="qwen/qwen3.8-27b:free",
        provider=ProviderType.OPENROUTER,
        display_name="Qwen 3.8 27B (Free)",
        capabilities={
            ModelCapability.STRUCTURED_OUTPUT,
            ModelCapability.LONG_CONTEXT,
            ModelCapability.HIGH_REASONING,
            ModelCapability.FAST_INFERENCE,
        },
        context_window=262144,
        cost_tier=CostTier.FREE,
        default_priority=70,
        is_available=True,
    ),
    ModelDescriptor(
        model_id="cohere/north-mini-code:free",
        provider=ProviderType.OPENROUTER,
        display_name="Cohere North Mini Code (Free)",
        capabilities={
            ModelCapability.STRUCTURED_OUTPUT,
            ModelCapability.LONG_CONTEXT,
            ModelCapability.FAST_INFERENCE,
        },
        context_window=256000,
        cost_tier=CostTier.FREE,
        default_priority=80,
        is_available=True,
    ),
    ModelDescriptor(
        model_id="google/gemma-4-31b-it:free",
        provider=ProviderType.OPENROUTER,
        display_name="Gemma 4 31B (Free)",
        capabilities={
            ModelCapability.STRUCTURED_OUTPUT,
            ModelCapability.LONG_CONTEXT,
            ModelCapability.FAST_INFERENCE,
        },
        context_window=262144,
        cost_tier=CostTier.FREE,
        default_priority=90,
        is_available=True,
    ),
    ModelDescriptor(
        model_id="google/gemma-4-26b-a4b-it:free",
        provider=ProviderType.OPENROUTER,
        display_name="Gemma 4 26B (Free)",
        capabilities={
            ModelCapability.STRUCTURED_OUTPUT,
            ModelCapability.FAST_INFERENCE,
        },
        context_window=262144,
        cost_tier=CostTier.FREE,
        default_priority=100,
        is_available=True,
    ),
    ModelDescriptor(
        model_id="meta-llama/llama-3.3-70b-instruct",
        provider=ProviderType.OPENROUTER,
        display_name="Llama 3.3 70B Instruct (Paid)",
        capabilities={
            ModelCapability.STRUCTURED_OUTPUT,
            ModelCapability.LONG_CONTEXT,
            ModelCapability.HIGH_REASONING,
            ModelCapability.FAST_INFERENCE,
        },
        context_window=131072,
        cost_tier=CostTier.PAID,
        default_priority=110,
        is_available=True,
    ),
    ModelDescriptor(
        model_id="anthropic/claude-3.5-sonnet",
        provider=ProviderType.OPENROUTER,
        display_name="Claude 3.5 Sonnet (Paid)",
        capabilities={
            ModelCapability.STRUCTURED_OUTPUT,
            ModelCapability.LONG_CONTEXT,
            ModelCapability.HIGH_REASONING,
        },
        context_window=200000,
        cost_tier=CostTier.PAID,
        default_priority=120,
        is_available=True,
    ),
    # Legacy descriptors kept for backward compatibility and test mock validation
    ModelDescriptor(
        model_id="meta-llama/llama-3.3-70b-instruct:free",
        provider=ProviderType.OPENROUTER,
        display_name="Llama 3.3 70B Instruct (Legacy/Free)",
        capabilities={
            ModelCapability.STRUCTURED_OUTPUT,
            ModelCapability.LONG_CONTEXT,
            ModelCapability.HIGH_REASONING,
            ModelCapability.FAST_INFERENCE,
        },
        context_window=131072,
        cost_tier=CostTier.FREE,
        default_priority=90,
        is_available=False,
    ),
    ModelDescriptor(
        model_id="google/gemini-2.0-flash-exp:free",
        provider=ProviderType.OPENROUTER,
        display_name="Gemini 2.0 Flash Exp (Legacy/Free)",
        capabilities={
            ModelCapability.STRUCTURED_OUTPUT,
            ModelCapability.LONG_CONTEXT,
            ModelCapability.HIGH_REASONING,
            ModelCapability.FAST_INFERENCE,
        },
        context_window=1000000,
        cost_tier=CostTier.FREE,
        default_priority=91,
        is_available=False,
    ),
    ModelDescriptor(
        model_id="qwen/qwen-2.5-72b-instruct:free",
        provider=ProviderType.OPENROUTER,
        display_name="Qwen 2.5 72B Instruct (Legacy/Free)",
        capabilities={
            ModelCapability.STRUCTURED_OUTPUT,
            ModelCapability.LONG_CONTEXT,
            ModelCapability.HIGH_REASONING,
        },
        context_window=32768,
        cost_tier=CostTier.FREE,
        default_priority=92,
        is_available=False,
    ),
    ModelDescriptor(
        model_id="mistralai/mistral-7b-instruct:free",
        provider=ProviderType.OPENROUTER,
        display_name="Mistral 7B Instruct (Legacy/Free)",
        capabilities={ModelCapability.FAST_INFERENCE},
        context_window=32768,
        cost_tier=CostTier.FREE,
        default_priority=93,
        is_available=False,
    ),
]


class OpenRouterAdapter(BaseProviderAdapter):
    """Provider adapter interfacing with OpenRouter API via OpenAI-compatible endpoints."""

    def __init__(
        self,
        api_key: str | None = None,
        base_url: str = "https://openrouter.ai/api/v1",
        http_client: httpx.AsyncClient | None = None,
    ):
        self.api_key = api_key or settings.OPENROUTER_API_KEY
        self.base_url = base_url.rstrip("/")
        self._client = http_client
        self._models: dict[str, ModelDescriptor] = {
            m.model_id: m for m in DEFAULT_OPENROUTER_MODELS
        }

    @property
    def provider_type(self) -> ProviderType:
        return ProviderType.OPENROUTER

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
                "OpenRouter API key is not configured. Please set OPENROUTER_API_KEY in .env or configure a credential."
            )
        return {
            "Authorization": f"Bearer {key}",
            "HTTP-Referer": "https://jobfinder.app",
            "X-Title": "JobFinder",
            "Content-Type": "application/json",
        }

    def classify_error(self, error: Exception, model: str) -> AIProviderError:
        """Translate raw HTTP or OpenRouter errors into typed domain exceptions."""
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
                f"OpenRouter authentication failed for model {model}: {safe_msg}",
                model=model,
                status_code=401,
            )

        if (
            status_code == 403
            or "403" in err_str
            or "forbidden" in err_str
            or "credit balance" in err_str
            or "insufficient credits" in err_str
        ):
            return AIConfigurationError(
                f"OpenRouter permission/credits error for model {model}: {safe_msg}",
                model=model,
                status_code=403,
            )

        if (
            status_code == 404
            or "404" in err_str
            or "model not found" in err_str
            or "not available" in err_str
        ):
            return AIServiceUnavailableError(
                f"OpenRouter model {model} not found or unavailable: {safe_msg}",
                model=model,
                status_code=404,
            )

        if (
            status_code == 429
            or "429" in err_str
            or "rate limit" in err_str
            or "quota" in err_str
            or "too many requests" in err_str
        ):
            return AIRateLimitError(
                f"OpenRouter rate limit / quota exceeded for model {model}: {safe_msg}",
                model=model,
                status_code=429,
            )

        if status_code == 400 or "400" in err_str or "bad request" in err_str:
            return AIRequestError(
                f"Malformed OpenRouter request for model {model}: {safe_msg}",
                model=model,
                status_code=400,
            )

        if (
            status_code in (502, 503)
            or "503" in err_str
            or "502" in err_str
            or "unavailable" in err_str
        ):
            return AIServiceUnavailableError(
                f"OpenRouter upstream service unavailable for model {model}: {safe_msg}",
                model=model,
                status_code=status_code or 503,
            )

        if status_code and 500 <= status_code < 600:
            return AITransientError(
                f"OpenRouter server error ({status_code}) for model {model}: {safe_msg}",
                model=model,
                status_code=status_code,
            )

        if (
            isinstance(error, (httpx.TimeoutException, TimeoutError))
            or "timeout" in err_str
            or "timed out" in err_str
        ):
            return AITimeoutError(
                f"OpenRouter request timed out for model {model}: {safe_msg}",
                model=model,
            )

        if "safety" in err_str or "moderation" in err_str or "content filter" in err_str:
            return AISafetyError(
                f"OpenRouter safety/moderation rejection on model {model}: {safe_msg}",
                model=model,
            )

        return AIProviderError(
            f"Unexpected OpenRouter error for model {model}: {safe_msg}",
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
        """Send JSON payload to OpenRouter chat completions endpoint."""
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
        """Generate unstructured text via OpenRouter."""
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
        """Generate structured JSON via OpenRouter and validate against Pydantic schema."""
        messages: list[dict[str, str]] = []
        schema_json = json.dumps(schema.model_json_schema())
        system_prompt = (
            f"{system_instruction or 'You are a structured data extractor.'}\n"
            f"You MUST respond ONLY with valid JSON conforming strictly to this JSON schema:\n"
            f"{schema_json}\nDo not include any explanation or markdown formatting."
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
                f"OpenRouter model {model} structured validation failed: {validation_err}",
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
        """Embedding is intentionally unsupported on OpenRouter to preserve Gemini embedding isolation."""
        raise AIConfigurationError(
            "OpenRouter provider adapter does not support vector embeddings in this architecture; "
            "vector embeddings are isolated to the Gemini adapter.",
            model=model,
            status_code=400,
        )
