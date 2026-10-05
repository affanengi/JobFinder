"""Base interface definition for AI Provider Adapters."""

from abc import ABC, abstractmethod
from typing import TypeVar

from pydantic import BaseModel

from app.ai.errors import AIProviderError
from app.ai.hub.models import ModelDescriptor
from app.ai.hub.types import ProviderType

T = TypeVar("T", bound=BaseModel)


class SchemaRepairNeededError(Exception):
    """Raised when structured output fails JSON decoding or Pydantic validation."""

    def __init__(self, message: str, raw_output: str, original_error: Exception):
        super().__init__(message)
        self.raw_output = raw_output
        self.original_error = original_error


class BaseProviderAdapter(ABC):
    """Abstract interface that all provider adapters (Gemini, OpenRouter, Groq, etc.) must implement."""

    @property
    @abstractmethod
    def provider_type(self) -> ProviderType:
        """The provider type enum."""
        pass

    @abstractmethod
    def get_supported_models(self) -> list[ModelDescriptor]:
        """Return list of models supported by this adapter with their capabilities and pricing."""
        pass

    @abstractmethod
    def classify_error(self, error: Exception, model: str) -> AIProviderError:
        """Translate raw provider/HTTP exceptions into typed domain exceptions."""
        pass

    @abstractmethod
    async def generate_text(
        self,
        model: str,
        prompt: str,
        system_instruction: str | None = None,
        temperature: float = 0.7,
        timeout: float = 30.0,
        **kwargs,
    ) -> str:
        """Generate unstructured text from prompt."""
        pass

    @abstractmethod
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
        """Generate structured data validating against Pydantic schema.

        Returns tuple of (raw_json_string, validated_pydantic_instance).
        """
        pass

    @abstractmethod
    async def embed(
        self,
        text: str,
        model: str | None = None,
        max_retries: int = 1,
        base_delay_seconds: float = 0.5,
        **kwargs,
    ) -> list[float]:
        """Generate vector embedding for semantic search/matching."""
        pass
