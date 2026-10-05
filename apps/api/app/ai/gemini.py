"""Gemini AI Provider compatibility facade delegating to central AIOrchestrator."""

import logging
from typing import TypeVar

from google import genai
from pydantic import BaseModel

from app.ai.adapters.gemini_adapter import (
    DEFAULT_EMBEDDING_MODEL,
    DEFAULT_GENERATION_FALLBACK_CHAIN,
    GeminiAdapter,
)
from app.ai.errors import AIAuthenticationError, AIProviderError
from app.ai.hub.models import ExecutionRequest
from app.ai.hub.orchestrator import ai_orchestrator
from app.ai.hub.types import AITaskType
from app.ai.provider import AIProvider
from app.core.config import settings

logger = logging.getLogger("jobFinder.ai.gemini")

T = TypeVar("T", bound=BaseModel)


class GeminiProvider(AIProvider):
    """Google Gemini AI Provider compatibility bridge delegating to AIOrchestrator.

    Preserves full backward compatibility for existing callers while routing execution,
    fallback, self-repair, and health management through the centralized AI Hub.
    """

    def __init__(
        self,
        api_key: str | None = None,
        model_chain: list[str] | None = None,
        embedding_model: str | None = None,
        max_retries_per_model: int = 1,
        base_delay_seconds: float = 0.5,
        user_id: str = "system_default",
    ):
        self.api_key = api_key or settings.GEMINI_API_KEY
        self.user_id = user_id
        if model_chain:
            self.model_chain = model_chain
            self._has_explicit_chain = True
        elif settings.GEMINI_MODEL and settings.GEMINI_MODEL in DEFAULT_GENERATION_FALLBACK_CHAIN:
            self.model_chain = [settings.GEMINI_MODEL] + [
                m for m in DEFAULT_GENERATION_FALLBACK_CHAIN if m != settings.GEMINI_MODEL
            ]
            self._has_explicit_chain = False
        else:
            self.model_chain = DEFAULT_GENERATION_FALLBACK_CHAIN
            self._has_explicit_chain = False

        self.embedding_model = embedding_model or DEFAULT_EMBEDDING_MODEL
        self.max_retries_per_model = max_retries_per_model
        self.base_delay_seconds = base_delay_seconds
        self.last_model_used: str | None = None
        self._client: genai.Client | None = None

        if self.api_key:
            self._client = genai.Client(api_key=self.api_key)

        self._adapter = GeminiAdapter(
            api_key=self.api_key,
            client=self._client,
            embedding_model=self.embedding_model,
        )

    def _get_client(self) -> genai.Client:
        """Get or initialize the Gemini client."""
        if not self.api_key:
            raise AIAuthenticationError(
                "Gemini API key is not configured. Please set GEMINI_API_KEY in .env."
            )
        if self._client is None:
            self._client = genai.Client(api_key=self.api_key)
        return self._client

    def _classify_error(self, error: Exception, model: str) -> AIProviderError:
        """Classify a raw Gemini/Google API error into a typed domain exception."""
        return self._adapter.classify_error(error, model)

    async def generate_text(
        self,
        prompt: str,
        system_instruction: str | None = None,
        temperature: float = 0.2,
        task: AITaskType = AITaskType.JOB_INGESTION,
        user_id: str | None = None,
    ) -> str:
        """Generate unstructured text with instant model fallback via AIOrchestrator."""
        effective_user_id = user_id or self.user_id
        request = ExecutionRequest(
            task=task,
            user_id=effective_user_id,
            prompt=prompt,
            system_instruction=system_instruction,
            temperature=temperature,
        )

        use_explicit = self._has_explicit_chain
        active_client = self._client or (self.api_key and self._get_client())
        response = await ai_orchestrator.execute(
            request=request,
            explicit_model_chain=self.model_chain if use_explicit else None,
            custom_adapter=self._adapter,
            client=active_client if use_explicit else None,
        )

        self.last_model_used = response.model_used
        return response.text

    async def generate_structured(
        self,
        prompt: str,
        schema: type[T],
        system_instruction: str | None = None,
        temperature: float = 0.1,
        task: AITaskType = AITaskType.JOB_INGESTION,
        user_id: str | None = None,
    ) -> T:
        """Generate validated Pydantic structured output with schema self-repair via AIOrchestrator."""
        effective_user_id = user_id or self.user_id
        request = ExecutionRequest(
            task=task,
            user_id=effective_user_id,
            prompt=prompt,
            system_instruction=system_instruction,
            temperature=temperature,
            schema_cls=schema,
        )

        use_explicit = self._has_explicit_chain
        active_client = self._client or (self.api_key and self._get_client())
        response = await ai_orchestrator.execute(
            request=request,
            explicit_model_chain=self.model_chain if use_explicit else None,
            custom_adapter=self._adapter,
            client=active_client if use_explicit else None,
        )

        self.last_model_used = response.model_used
        assert response.structured_data is not None
        return response.structured_data

    async def embed(self, text: str, user_id: str | None = None) -> list[float]:
        """Generate vector embedding using gemini-embedding-2 with retry via AIOrchestrator."""
        effective_user_id = user_id or self.user_id
        active_client = self._client or (self.api_key and self._get_client())
        return await ai_orchestrator.execute_embedding(
            text=text,
            user_id=effective_user_id,
            model=self.embedding_model,
            max_retries=self.max_retries_per_model,
            base_delay_seconds=self.base_delay_seconds,
            custom_adapter=self._adapter,
            client=active_client,
        )
