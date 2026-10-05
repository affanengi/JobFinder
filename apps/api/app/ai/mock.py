"""Mock AI Provider for fast offline testing and deterministic behavior."""

from typing import Any, TypeVar

from pydantic import BaseModel

from app.ai.provider import AIProvider

T = TypeVar("T", bound=BaseModel)


class MockAIProvider(AIProvider):
    """Mock implementation of AIProvider returning canned or generated test data."""

    def __init__(self, canned_responses: dict[str, Any] | None = None):
        self.canned_responses = canned_responses or {}
        self.calls: list[dict[str, Any]] = []
        self.last_model_used = "mock-model"

    async def generate_text(
        self,
        prompt: str,
        system_instruction: str | None = None,
        temperature: float = 0.2,
    ) -> str:
        self.calls.append({"type": "text", "prompt": prompt})
        return self.canned_responses.get("text", "Mocked AI text response.")

    async def generate_structured(
        self,
        prompt: str,
        schema: type[T],
        system_instruction: str | None = None,
        temperature: float = 0.1,
    ) -> T:
        self.calls.append({"type": "structured", "prompt": prompt, "schema": schema.__name__})
        if "structured" in self.canned_responses:
            data = self.canned_responses["structured"]
            if isinstance(data, dict):
                return schema.model_validate(data)
            if isinstance(data, schema):
                return data

        # Default fallback construct
        return schema.model_construct()

    async def embed(self, text: str) -> list[float]:
        self.calls.append({"type": "embed", "text": text})
        # Return standard 3072 dimension mock vector
        return [0.0] * 3072
