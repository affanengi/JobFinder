"""Tests for Gemini Provider Error Classification, Multi-Model Fallback & Embedding Isolation."""

from unittest.mock import MagicMock

import pytest
from google.genai import errors as genai_errors
from pydantic import BaseModel

from app.ai.errors import (
    AIAuthenticationError,
    AIConfigurationError,
    AIProviderUnavailableError,
    AIRateLimitError,
    AIRequestError,
    AIServiceUnavailableError,
)
from app.ai.gemini import GeminiProvider


class SampleStructuredOutput(BaseModel):
    name: str
    score: int


def create_mock_client_error(status_code: int, message: str) -> genai_errors.ClientError:
    """Helper to instantiate Google ClientError with response payload."""
    err = genai_errors.ClientError(
        status_code, {"error": {"code": status_code, "message": message}}, None
    )
    return err


def create_mock_server_error(status_code: int, message: str) -> genai_errors.ServerError:
    """Helper to instantiate Google ServerError with response payload."""
    err = genai_errors.ServerError(
        status_code, {"error": {"code": status_code, "message": message}}, None
    )
    return err


def test_error_classification():
    """Verify that HTTP error codes map to typed non-transient and transient domain exceptions."""
    provider = GeminiProvider(api_key="fake-key")

    # 401 Unauthorized -> AIAuthenticationError (Non-transient)
    err_401 = provider._classify_error(
        create_mock_client_error(401, "Invalid API key"), "gemini-3.7-flash"
    )
    assert isinstance(err_401, AIAuthenticationError)
    assert err_401.status_code == 401

    # 403 Forbidden -> AIConfigurationError (Non-transient)
    err_403 = provider._classify_error(
        create_mock_client_error(403, "API not enabled"), "gemini-3.7-flash"
    )
    assert isinstance(err_403, AIConfigurationError)

    # 400 Bad Request -> AIRequestError (Non-transient)
    err_400 = provider._classify_error(
        create_mock_client_error(400, "Bad parameter"), "gemini-3.7-flash"
    )
    assert isinstance(err_400, AIRequestError)

    # 429 Rate Limit -> AIRateLimitError (Transient)
    err_429 = provider._classify_error(
        create_mock_client_error(429, "Quota exceeded"), "gemini-3.7-flash"
    )
    assert isinstance(err_429, AIRateLimitError)

    # 503 Service Unavailable -> AIServiceUnavailableError (Transient)
    err_503 = provider._classify_error(
        create_mock_server_error(503, "High demand spike"), "gemini-3.7-flash"
    )
    assert isinstance(err_503, AIServiceUnavailableError)


@pytest.mark.asyncio
async def test_fallback_chain_on_transient_error():
    """Verify that a 503 error on primary model falls back to the next model in chain."""
    provider = GeminiProvider(
        api_key="fake-key",
        model_chain=["gemini-3.7-flash", "gemini-3.6-flash"],
        max_retries_per_model=0,  # Switch immediately for test speed
        base_delay_seconds=0.01,
    )

    mock_client = MagicMock()

    def side_effect(model, contents, config):
        if model == "gemini-3.7-flash":
            raise create_mock_server_error(503, "Temporary spike")
        if model == "gemini-3.6-flash":
            resp = MagicMock()
            resp.text = "Success from fallback"
            return resp
        raise ValueError(f"Unexpected model: {model}")

    mock_client.models.generate_content.side_effect = side_effect
    provider._client = mock_client

    result = await provider.generate_text("Test prompt")
    assert result == "Success from fallback"
    assert provider.last_model_used == "gemini-3.6-flash"


@pytest.mark.asyncio
async def test_non_transient_error_does_not_fallback():
    """Verify that an authentication 401 error fails immediately without trying fallback models."""
    provider = GeminiProvider(
        api_key="fake-key",
        model_chain=["gemini-3.7-flash", "gemini-3.6-flash"],
        max_retries_per_model=1,
    )

    mock_client = MagicMock()
    mock_client.models.generate_content.side_effect = create_mock_client_error(
        401, "API key expired"
    )
    provider._client = mock_client

    with pytest.raises(AIAuthenticationError):
        await provider.generate_text("Test prompt")

    # Ensure gemini-3.6-flash was NEVER called
    assert mock_client.models.generate_content.call_count == 1


@pytest.mark.asyncio
async def test_all_fallback_models_exhausted():
    """Verify that when all fallback models fail with transient errors, AIProviderUnavailableError is raised."""
    provider = GeminiProvider(
        api_key="fake-key",
        model_chain=["gemini-3.7-flash", "gemini-3.6-flash"],
        max_retries_per_model=0,
    )

    mock_client = MagicMock()
    mock_client.models.generate_content.side_effect = create_mock_server_error(503, "All down")
    provider._client = mock_client

    with pytest.raises(AIProviderUnavailableError) as exc_info:
        await provider.generate_text("Test prompt")

    assert "All models in fallback chain" in str(exc_info.value)


@pytest.mark.asyncio
async def test_embedding_model_isolation():
    """Verify embedding uses gemini-embedding-2 and returns 3072 dimensions."""
    provider = GeminiProvider(api_key="fake-key", embedding_model="gemini-embedding-2")

    mock_client = MagicMock()
    mock_res = MagicMock()
    mock_res.embedding.values = [0.123] * 3072
    mock_client.models.embed_content.return_value = mock_res
    provider._client = mock_client

    vector = await provider.embed("Python automation engineer")
    assert len(vector) == 3072
    mock_client.models.embed_content.assert_called_once_with(
        model="gemini-embedding-2",
        contents="Python automation engineer",
    )
