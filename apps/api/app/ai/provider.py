"""Abstract Protocol Interface for AI Providers."""

from typing import Any, Protocol, TypeVar

from pydantic import BaseModel

T = TypeVar("T", bound=BaseModel)


class AIProvider(Protocol):
    """Abstract interface that all AI providers must implement."""

    async def generate_text(
        self,
        prompt: str,
        system_instruction: str | None = None,
        temperature: float = 0.2,
        task: Any = None,
        user_id: str | None = None,
        operation_id: str | None = None,
    ) -> str:
        """Generate unstructured text from a prompt."""
        ...

    async def generate_structured(
        self,
        prompt: str,
        schema: type[T],
        system_instruction: str | None = None,
        temperature: float = 0.1,
        task: Any = None,
        user_id: str | None = None,
        operation_id: str | None = None,
    ) -> T:
        """Generate validated, structured JSON adhering to a Pydantic schema."""
        ...

    async def embed(self, text: str, user_id: str | None = None) -> list[float]:
        """Generate vector embeddings for semantic retrieval (3072 dims)."""
        ...
