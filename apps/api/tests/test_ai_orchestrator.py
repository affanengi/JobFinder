"""Unit and integration tests for AIOrchestrator, GeminiAdapter, and routing engine."""

from unittest.mock import MagicMock

import pytest
from google.genai import errors as genai_errors
from pydantic import BaseModel

from app.ai.adapters.base import BaseProviderAdapter
from app.ai.adapters.gemini_adapter import GeminiAdapter
from app.ai.errors import (
    AIAuthenticationError,
    AIOutputValidationError,
)
from app.ai.gemini import GeminiProvider
from app.ai.hub.models import ExecutionRequest
from app.ai.hub.orchestrator import AIOrchestrator, HealthRegistry
from app.ai.hub.router import AIRouter
from app.ai.hub.types import (
    AITaskType,
    CostTier,
    ModelCapability,
    ProviderType,
)


class SampleResumeSchema(BaseModel):
    headline: str
    skills: list[str]


def create_mock_client_error(status_code: int, message: str) -> genai_errors.ClientError:
    return genai_errors.ClientError(
        status_code, {"error": {"code": status_code, "message": message}}, None
    )


def create_mock_server_error(status_code: int, message: str) -> genai_errors.ServerError:
    return genai_errors.ServerError(
        status_code, {"error": {"code": status_code, "message": message}}, None
    )


@pytest.mark.asyncio
async def test_gemini_adapter_text_generation():
    """Verify GeminiAdapter generates text using provided client."""
    adapter = GeminiAdapter(api_key="fake-key")
    mock_client = MagicMock()
    mock_resp = MagicMock()
    mock_resp.text = "Hello from Gemini Adapter"
    mock_client.models.generate_content.return_value = mock_resp

    result = await adapter.generate_text(
        model="gemini-3.5-flash-lite",
        prompt="Say hello",
        client=mock_client,
    )
    assert result == "Hello from Gemini Adapter"
    mock_client.models.generate_content.assert_called_once()


@pytest.mark.asyncio
async def test_gemini_adapter_structured_generation():
    """Verify GeminiAdapter generates validated structured JSON."""
    adapter = GeminiAdapter(api_key="fake-key")
    mock_client = MagicMock()
    mock_resp = MagicMock()
    mock_resp.text = '{"headline": "Senior Engineer", "skills": ["Python", "FastAPI"]}'
    mock_client.models.generate_content.return_value = mock_resp

    raw_text, data = await adapter.generate_structured(
        model="gemini-3.5-flash-lite",
        prompt="Extract resume",
        schema=SampleResumeSchema,
        client=mock_client,
    )
    assert data.headline == "Senior Engineer"
    assert "FastAPI" in data.skills
    assert "Senior Engineer" in raw_text


def test_gemini_adapter_supported_models():
    """Verify GeminiAdapter exports active model descriptors with capabilities."""
    adapter = GeminiAdapter(api_key="fake-key")
    models = adapter.get_supported_models()
    assert len(models) >= 7

    model_map = {m.model_id: m for m in models}
    assert "gemini-3.5-flash-lite" in model_map
    assert ModelCapability.STRUCTURED_OUTPUT in model_map["gemini-3.5-flash-lite"].capabilities
    assert model_map["gemini-3.5-flash-lite"].cost_tier == CostTier.FREE


@pytest.mark.asyncio
async def test_orchestrator_dynamic_routing_by_capability():
    """Verify router matches models with the required task capabilities."""
    router = AIRouter()
    adapter = GeminiAdapter(api_key="fake-key")
    adapters: dict[ProviderType, BaseProviderAdapter] = {ProviderType.GEMINI: adapter}

    req = ExecutionRequest(
        task=AITaskType.RESUME_TAILORING,
        user_id="user_123",
        prompt="Tailor resume",
    )
    candidates = router.resolve_candidates(
        request=req,
        registered_adapters=adapters,
    )
    # RESUME_TAILORING requires HIGH_REASONING, LONG_CONTEXT, STRUCTURED_OUTPUT
    # flash-lite models should be excluded; 3.5-flash, 3.8-flash, 3.6-flash, 3.7-flash should be included
    candidate_ids = [c.model_id for c in candidates]
    assert "gemini-3.5-flash-lite" not in candidate_ids
    assert "gemini-3.5-flash" in candidate_ids
    assert "gemini-3.6-flash" in candidate_ids


@pytest.mark.asyncio
async def test_orchestrator_model_fallback_on_transient_failure():
    """Verify orchestrator fails over from model 1 to model 2 on 503."""
    orchestrator = AIOrchestrator()
    mock_client = MagicMock()

    def side_effect(model, contents, config):
        if model == "gemini-3.5-flash-lite":
            raise create_mock_server_error(503, "High demand")
        if model == "gemini-3.1-flash-lite":
            resp = MagicMock()
            resp.text = "Success from flash-lite 3.1"
            return resp
        raise ValueError(f"Unexpected: {model}")

    mock_client.models.generate_content.side_effect = side_effect

    req = ExecutionRequest(
        task=AITaskType.JOB_INGESTION,
        user_id="user_123",
        prompt="Test fallback",
    )
    resp = await orchestrator.execute(
        request=req,
        explicit_model_chain=["gemini-3.5-flash-lite", "gemini-3.1-flash-lite"],
        client=mock_client,
    )

    assert resp.text == "Success from flash-lite 3.1"
    assert resp.model_used == "gemini-3.1-flash-lite"
    assert len(resp.attempted_hops) == 2
    assert resp.attempted_hops[0]["status"] == "FAILED"
    assert resp.attempted_hops[1]["status"] == "SUCCESS"


@pytest.mark.asyncio
async def test_orchestrator_fatal_error_aborts_without_fallback():
    """Verify 401 unauthenticated aborts immediately and does not retry next model."""
    orchestrator = AIOrchestrator()
    mock_client = MagicMock()
    mock_client.models.generate_content.side_effect = create_mock_client_error(
        401, "API Key Expired"
    )

    req = ExecutionRequest(
        task=AITaskType.JOB_INGESTION,
        user_id="user_123",
        prompt="Test fatal error",
    )

    with pytest.raises(AIAuthenticationError):
        await orchestrator.execute(
            request=req,
            explicit_model_chain=["gemini-3.5-flash-lite", "gemini-3.1-flash-lite"],
            client=mock_client,
        )

    # Crucial: only 1 attempt made
    assert mock_client.models.generate_content.call_count == 1


@pytest.mark.asyncio
async def test_orchestrator_structured_self_repair_success():
    """Verify invalid JSON on first attempt triggers 1-shot self-repair prompt and succeeds."""
    orchestrator = AIOrchestrator()
    mock_client = MagicMock()

    call_count = 0

    def side_effect(model, contents, config):
        nonlocal call_count
        call_count += 1
        resp = MagicMock()
        if call_count == 1:
            # Malformed JSON missing required field
            resp.text = '{"bad_json": 123}'
        else:
            # Self-repair prompt returned valid schema
            resp.text = '{"headline": "Repaired Lead", "skills": ["Python"]}'
        return resp

    mock_client.models.generate_content.side_effect = side_effect

    req = ExecutionRequest(
        task=AITaskType.JOB_INGESTION,
        user_id="user_123",
        prompt="Extract headline and skills",
        schema_cls=SampleResumeSchema,
    )
    resp = await orchestrator.execute(
        request=req,
        explicit_model_chain=["gemini-3.5-flash-lite"],
        client=mock_client,
    )

    assert resp.structured_data is not None
    assert resp.structured_data.headline == "Repaired Lead"
    assert call_count == 2  # Original call + 1 repair call


@pytest.mark.asyncio
async def test_orchestrator_structured_self_repair_failure_raises_typed_error():
    """Verify unrecoverable JSON raises AIOutputValidationError after self-repair fails."""
    orchestrator = AIOrchestrator()
    mock_client = MagicMock()
    resp = MagicMock()
    resp.text = "This is not json at all"
    mock_client.models.generate_content.return_value = resp

    req = ExecutionRequest(
        task=AITaskType.JOB_INGESTION,
        user_id="user_123",
        prompt="Extract headline and skills",
        schema_cls=SampleResumeSchema,
    )

    with pytest.raises(AIOutputValidationError) as exc_info:
        await orchestrator.execute(
            request=req,
            explicit_model_chain=["gemini-3.5-flash-lite"],
            client=mock_client,
        )

    assert "invalid structured output" in str(exc_info.value)


@pytest.mark.asyncio
async def test_orchestrator_health_cooldown_multi_user_isolation():
    """Verify that placing Model A in cooldown for User 1 NEVER impacts User 2."""
    health = HealthRegistry()
    orchestrator = AIOrchestrator(health_registry=health)

    user1_id = "user_alpha"
    user2_id = "user_beta"
    cred_id = "cred_gemini_default"
    model_id = "gemini-3.5-flash-lite"

    # Put model into cooldown for User 1
    health.set_model_cooldown(user1_id, cred_id, model_id, duration_seconds=60.0)

    # User 1 has active cooldown via orchestrator
    assert orchestrator.health_registry.is_model_in_cooldown(user1_id, cred_id, model_id)

    # User 2 has ZERO cooldown! Complete isolation guaranteed!
    assert not orchestrator.health_registry.is_model_in_cooldown(user2_id, cred_id, model_id)


@pytest.mark.asyncio
async def test_orchestrator_embedding_isolation():
    """Verify vector embeddings call embed API directly without routing through text fallback."""
    orchestrator = AIOrchestrator()
    mock_client = MagicMock()
    mock_res = MagicMock()
    mock_res.embedding.values = [0.42] * 3072
    mock_client.models.embed_content.return_value = mock_res

    vector = await orchestrator.execute_embedding(
        text="Software Architect",
        client=mock_client,
    )
    assert len(vector) == 3072
    mock_client.models.embed_content.assert_called_once_with(
        model="gemini-embedding-2",
        contents="Software Architect",
    )


@pytest.mark.asyncio
async def test_compatibility_gemini_provider_integration():
    """Verify legacy GeminiProvider interface delegates seamlessly to AIOrchestrator."""
    provider = GeminiProvider(api_key="fake-key", model_chain=["gemini-3.5-flash-lite"])
    mock_client = MagicMock()
    mock_resp = MagicMock()
    mock_resp.text = "Response from GeminiProvider facade"
    mock_client.models.generate_content.return_value = mock_resp
    provider._client = mock_client

    text = await provider.generate_text("Hello facade")
    assert text == "Response from GeminiProvider facade"
    assert provider.last_model_used == "gemini-3.5-flash-lite"
