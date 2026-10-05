"""Comprehensive Phase 3 Tests for OpenRouter & Groq Adapters, Level 1-3 Fallbacks,

Cost Policies, Credential Scopes, and Multi-User Isolation.
"""

from unittest.mock import AsyncMock, MagicMock

import httpx
import pytest
from pydantic import BaseModel

from app.ai.adapters.base import SchemaRepairNeededError
from app.ai.adapters.gemini_adapter import GeminiAdapter
from app.ai.adapters.groq_adapter import GroqAdapter
from app.ai.adapters.openrouter_adapter import OpenRouterAdapter
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
from app.ai.gemini import GeminiProvider
from app.ai.hub.models import (
    ExecutionRequest,
    ModelDescriptor,
    ProjectScope,
    UserAIProfile,
    evaluate_cost_policy,
)
from app.ai.hub.orchestrator import AIOrchestrator, HealthRegistry
from app.ai.hub.router import AIRouter
from app.ai.hub.types import (
    AITaskType,
    CostPolicy,
    CostTier,
    CredentialHealth,
    ModelCapability,
    ProviderType,
    ScopeType,
)


class SampleResumeExtraction(BaseModel):
    name: str
    experience_years: int


# ==============================================================================
# 1. OpenRouter Adapter Text Generation
# ==============================================================================


@pytest.mark.asyncio
async def test_openrouter_adapter_text_generation():
    """Verify OpenRouterAdapter sends correct OpenAI-compatible request and extracts text."""
    mock_client = AsyncMock(spec=httpx.AsyncClient)
    mock_resp = MagicMock(spec=httpx.Response)
    mock_resp.status_code = 200
    mock_resp.json.return_value = {
        "choices": [{"message": {"content": "Hello from OpenRouter!"}}],
        "usage": {"total_tokens": 25},
    }
    mock_client.post.return_value = mock_resp

    adapter = OpenRouterAdapter(api_key="sk-or-test-key", http_client=mock_client)
    result = await adapter.generate_text(
        model="meta-llama/llama-3.3-70b-instruct:free",
        prompt="Tell me a joke",
        system_instruction="Be brief.",
        temperature=0.5,
    )

    assert result == "Hello from OpenRouter!"
    mock_client.post.assert_called_once()
    call_args = mock_client.post.call_args
    assert call_args.args[0] == "https://openrouter.ai/api/v1/chat/completions"
    headers = call_args.kwargs["headers"]
    assert headers["Authorization"] == "Bearer sk-or-test-key"
    assert headers["HTTP-Referer"] == "https://jobfinder.app"
    payload = call_args.kwargs["json"]
    assert payload["model"] == "meta-llama/llama-3.3-70b-instruct:free"
    assert payload["temperature"] == 0.5


# ==============================================================================
# 2. OpenRouter Error Classification
# ==============================================================================


def test_openrouter_error_classification():
    """Verify that OpenRouter HTTP status codes and error messages map to domain AI errors."""
    adapter = OpenRouterAdapter(api_key="test-key")
    model = "meta-llama/llama-3.3-70b-instruct:free"

    def make_http_err(status: int, msg: str = "") -> httpx.HTTPStatusError:
        req = httpx.Request("POST", "https://openrouter.ai/api/v1/chat/completions")
        resp = httpx.Response(status, request=req, json={"error": {"message": msg}})
        return httpx.HTTPStatusError(f"HTTP {status}", request=req, response=resp)

    # 401 -> AIAuthenticationError
    assert isinstance(adapter.classify_error(make_http_err(401, "Invalid API key"), model), AIAuthenticationError)
    # 403 -> AIConfigurationError
    assert isinstance(adapter.classify_error(make_http_err(403, "Insufficient credits"), model), AIConfigurationError)
    # 404 -> AIServiceUnavailableError
    assert isinstance(adapter.classify_error(make_http_err(404, "Model not found"), model), AIServiceUnavailableError)
    # 429 -> AIRateLimitError
    assert isinstance(adapter.classify_error(make_http_err(429, "Rate limit exceeded"), model), AIRateLimitError)
    # 400 -> AIRequestError
    assert isinstance(adapter.classify_error(make_http_err(400, "Bad Request"), model), AIRequestError)
    # 503 -> AIServiceUnavailableError
    assert isinstance(adapter.classify_error(make_http_err(503, "Unavailable"), model), AIServiceUnavailableError)
    # 500 -> AITransientError
    assert isinstance(adapter.classify_error(make_http_err(500, "Internal Server Error"), model), AITransientError)
    # Timeout -> AITimeoutError
    assert isinstance(adapter.classify_error(httpx.ReadTimeout("Read timed out"), model), AITimeoutError)
    # Moderation / Safety -> AISafetyError
    assert isinstance(adapter.classify_error(Exception("Content safety policy moderation violation"), model), AISafetyError)


# ==============================================================================
# 3. OpenRouter Model Capability Filtering
# ==============================================================================


def test_openrouter_model_capability_filtering():
    """Verify OpenRouter models advertise explicit capabilities and filter accurately."""
    adapter = OpenRouterAdapter(api_key="test-key")
    models = adapter.get_supported_models()
    model_map = {m.model_id: m for m in models}

    llama_free = model_map["meta-llama/llama-3.3-70b-instruct:free"]
    assert ModelCapability.STRUCTURED_OUTPUT in llama_free.capabilities
    assert ModelCapability.HIGH_REASONING in llama_free.capabilities
    assert llama_free.cost_tier == CostTier.FREE

    mistral_free = model_map["mistralai/mistral-7b-instruct:free"]
    assert ModelCapability.HIGH_REASONING not in mistral_free.capabilities
    assert not mistral_free.satisfies_capabilities({ModelCapability.HIGH_REASONING})

    # Test dynamic registration
    custom_desc = ModelDescriptor(
        model_id="custom/dynamic-model:free",
        provider=ProviderType.OPENROUTER,
        display_name="Custom Free",
        capabilities={ModelCapability.FAST_INFERENCE},
        cost_tier=CostTier.FREE,
    )
    adapter.register_model(custom_desc)
    assert "custom/dynamic-model:free" in [m.model_id for m in adapter.get_supported_models()]


# ==============================================================================
# 4. Groq Adapter Text Generation
# ==============================================================================


@pytest.mark.asyncio
async def test_groq_adapter_text_generation():
    """Verify GroqAdapter communicates with Groq Cloud API and returns text."""
    mock_client = AsyncMock(spec=httpx.AsyncClient)
    mock_resp = MagicMock(spec=httpx.Response)
    mock_resp.status_code = 200
    mock_resp.json.return_value = {
        "choices": [{"message": {"content": "Fast response from Groq!"}}],
        "usage": {"total_tokens": 12},
    }
    mock_client.post.return_value = mock_resp

    adapter = GroqAdapter(api_key="gsk-test-key", http_client=mock_client)
    result = await adapter.generate_text(
        model="llama-3.3-70b-versatile",
        prompt="Explain quantum physics in 5 words",
    )

    assert result == "Fast response from Groq!"
    mock_client.post.assert_called_once()
    call_args = mock_client.post.call_args
    assert call_args.args[0] == "https://api.groq.com/openai/v1/chat/completions"
    headers = call_args.kwargs["headers"]
    assert headers["Authorization"] == "Bearer gsk-test-key"


# ==============================================================================
# 5. Groq Error Classification
# ==============================================================================


def test_groq_error_classification():
    """Verify that Groq HTTP error codes and exception messages map to domain AI errors."""
    adapter = GroqAdapter(api_key="test-key")
    model = "llama-3.3-70b-versatile"

    def make_http_err(status: int, msg: str = "") -> httpx.HTTPStatusError:
        req = httpx.Request("POST", "https://api.groq.com/openai/v1/chat/completions")
        resp = httpx.Response(status, request=req, json={"error": {"message": msg}})
        return httpx.HTTPStatusError(f"HTTP {status}", request=req, response=resp)

    # 401 -> AIAuthenticationError
    assert isinstance(adapter.classify_error(make_http_err(401, "Invalid API key"), model), AIAuthenticationError)
    # 403 -> AIConfigurationError
    assert isinstance(adapter.classify_error(make_http_err(403, "Forbidden"), model), AIConfigurationError)
    # 404 -> AIServiceUnavailableError
    assert isinstance(adapter.classify_error(make_http_err(404, "Model not found"), model), AIServiceUnavailableError)
    # 429 -> AIRateLimitError
    assert isinstance(adapter.classify_error(make_http_err(429, "Rate limit reached"), model), AIRateLimitError)
    # 400 -> AIRequestError
    assert isinstance(adapter.classify_error(make_http_err(400, "Bad Request"), model), AIRequestError)
    # 503 -> AIServiceUnavailableError
    assert isinstance(adapter.classify_error(make_http_err(503, "Service unavailable"), model), AIServiceUnavailableError)
    # 500 -> AITransientError
    assert isinstance(adapter.classify_error(make_http_err(500, "Server error"), model), AITransientError)
    # Timeout -> AITimeoutError
    assert isinstance(adapter.classify_error(httpx.ConnectTimeout("Connection timed out"), model), AITimeoutError)
    # Safety -> AISafetyError
    assert isinstance(adapter.classify_error(Exception("Safety violation detected"), model), AISafetyError)


# ==============================================================================
# 6. Groq Model Capability Filtering
# ==============================================================================


def test_groq_model_capability_filtering():
    """Verify Groq models match appropriate tasks and reject missing capabilities."""
    adapter = GroqAdapter(api_key="test-key")
    models = adapter.get_supported_models()
    model_map = {m.model_id: m for m in models}

    llama_versatile = model_map["llama-3.3-70b-versatile"]
    assert ModelCapability.HIGH_REASONING in llama_versatile.capabilities
    assert ModelCapability.STRUCTURED_OUTPUT in llama_versatile.capabilities
    assert llama_versatile.satisfies_capabilities({ModelCapability.HIGH_REASONING, ModelCapability.STRUCTURED_OUTPUT})

    mixtral = model_map["mixtral-8x7b-32768"]
    assert ModelCapability.HIGH_REASONING not in mixtral.capabilities
    assert not mixtral.satisfies_capabilities({ModelCapability.HIGH_REASONING})


# ==============================================================================
# 7. Centralized Model Fallback (Level 1)
# ==============================================================================


@pytest.mark.asyncio
async def test_centralized_model_fallback_across_models():
    """Verify AIOrchestrator manages model-to-model fallback within an adapter."""
    mock_adapter = MagicMock(spec=GroqAdapter)
    mock_adapter.provider_type = ProviderType.GROQ

    call_count = 0

    async def mock_generate(model, prompt, **kwargs):
        nonlocal call_count
        call_count += 1
        if model == "llama-3.3-70b-versatile":
            raise AIRateLimitError("Rate limit on model 1", model=model, status_code=429)
        return "Success on model 2"

    mock_adapter.generate_text = AsyncMock(side_effect=mock_generate)
    mock_adapter.classify_error = lambda err, m: err if isinstance(err, AIProviderError) else AIRateLimitError(str(err), model=m, status_code=429)

    orchestrator = AIOrchestrator(register_defaults=False)
    orchestrator.register_adapter(mock_adapter)

    req = ExecutionRequest(
        task=AITaskType.JOB_INGESTION,
        user_id="user_test_model_fallback",
        prompt="Hello",
    )

    resp = await orchestrator.execute(
        request=req,
        explicit_model_chain=["llama-3.3-70b-versatile", "llama-3.1-8b-instant"],
        custom_adapter=mock_adapter,
    )

    assert resp.text == "Success on model 2"
    assert resp.model_used == "llama-3.1-8b-instant"
    assert len(resp.attempted_hops) == 2
    assert resp.attempted_hops[0]["status"] == "FAILED"
    assert resp.attempted_hops[1]["status"] == "SUCCESS"
    assert call_count == 2


# ==============================================================================
# 8. Gemini → OpenRouter Provider Fallback (Level 3)
# ==============================================================================


@pytest.mark.asyncio
async def test_gemini_to_openrouter_provider_fallback():
    """Verify that when Gemini models fail with transient errors, AIOrchestrator falls back to OpenRouter."""
    mock_gemini = MagicMock(spec=GeminiAdapter)
    mock_gemini.provider_type = ProviderType.GEMINI
    mock_gemini.get_supported_models.return_value = [
        ModelDescriptor(
            model_id="gemini-3.5-flash-lite",
            provider=ProviderType.GEMINI,
            display_name="Flash Lite",
            capabilities={ModelCapability.STRUCTURED_OUTPUT, ModelCapability.FAST_INFERENCE},
            cost_tier=CostTier.FREE,
            default_priority=10,
        )
    ]
    mock_gemini.generate_text = AsyncMock(
        side_effect=AIServiceUnavailableError("Gemini 503 Overloaded", model="gemini-3.5-flash-lite")
    )
    mock_gemini.classify_error = lambda err, m: err

    mock_openrouter = MagicMock(spec=OpenRouterAdapter)
    mock_openrouter.provider_type = ProviderType.OPENROUTER
    mock_openrouter.get_supported_models.return_value = [
        ModelDescriptor(
            model_id="meta-llama/llama-3.3-70b-instruct:free",
            provider=ProviderType.OPENROUTER,
            display_name="Llama 3.3 Free",
            capabilities={ModelCapability.STRUCTURED_OUTPUT, ModelCapability.FAST_INFERENCE},
            cost_tier=CostTier.FREE,
            default_priority=10,
        )
    ]
    mock_openrouter.generate_text = AsyncMock(return_value="Output from OpenRouter fallback")
    mock_openrouter.classify_error = lambda err, m: err

    orchestrator = AIOrchestrator(register_defaults=False)
    orchestrator.register_adapter(mock_gemini)
    orchestrator.register_adapter(mock_openrouter)

    profile = UserAIProfile(
        user_id="user_fallback_test",
        cost_policy=CostPolicy.FREE_ONLY,
        provider_priority=[ProviderType.GEMINI, ProviderType.OPENROUTER],
    )
    req = ExecutionRequest(
        task=AITaskType.JOB_INGESTION,
        user_id="user_fallback_test",
        prompt="Process job",
    )

    resp = await orchestrator.execute(request=req, profile=profile)

    assert resp.provider_used == ProviderType.OPENROUTER
    assert resp.model_used == "meta-llama/llama-3.3-70b-instruct:free"
    assert resp.text == "Output from OpenRouter fallback"
    assert len(resp.attempted_hops) == 2
    assert resp.attempted_hops[0]["provider"] == "gemini"
    assert resp.attempted_hops[0]["status"] == "FAILED"
    assert resp.attempted_hops[1]["provider"] == "openrouter"
    assert resp.attempted_hops[1]["status"] == "SUCCESS"


# ==============================================================================
# 9. OpenRouter → Groq Provider Fallback (Level 3)
# ==============================================================================


@pytest.mark.asyncio
async def test_openrouter_to_groq_provider_fallback():
    """Verify that when OpenRouter fails with rate limits, orchestrator falls back to Groq."""
    mock_or = MagicMock(spec=OpenRouterAdapter)
    mock_or.provider_type = ProviderType.OPENROUTER
    mock_or.get_supported_models.return_value = [
        ModelDescriptor(
            model_id="meta-llama/llama-3.3-70b-instruct:free",
            provider=ProviderType.OPENROUTER,
            display_name="Llama 3.3 Free",
            capabilities={ModelCapability.STRUCTURED_OUTPUT, ModelCapability.FAST_INFERENCE},
            cost_tier=CostTier.FREE,
            default_priority=10,
        )
    ]
    mock_or.generate_text = AsyncMock(
        side_effect=AIRateLimitError("OpenRouter 429 Quota Exceeded", model="meta-llama/llama-3.3-70b-instruct:free")
    )
    mock_or.classify_error = lambda err, m: err

    mock_groq = MagicMock(spec=GroqAdapter)
    mock_groq.provider_type = ProviderType.GROQ
    mock_groq.get_supported_models.return_value = [
        ModelDescriptor(
            model_id="llama-3.1-8b-instant",
            provider=ProviderType.GROQ,
            display_name="Groq Llama Instant",
            capabilities={ModelCapability.STRUCTURED_OUTPUT, ModelCapability.FAST_INFERENCE},
            cost_tier=CostTier.FREE,
            default_priority=20,
        )
    ]
    mock_groq.generate_text = AsyncMock(return_value="Output from Groq ultra-fast fallback")
    mock_groq.classify_error = lambda err, m: err

    orchestrator = AIOrchestrator(register_defaults=False)
    orchestrator.register_adapter(mock_or)
    orchestrator.register_adapter(mock_groq)

    profile = UserAIProfile(
        user_id="user_groq_fallback",
        cost_policy=CostPolicy.FREE_ONLY,
        provider_priority=[ProviderType.OPENROUTER, ProviderType.GROQ],
    )
    req = ExecutionRequest(
        task=AITaskType.JOB_INGESTION,
        user_id="user_groq_fallback",
        prompt="Process job with Groq",
    )

    resp = await orchestrator.execute(request=req, profile=profile)

    assert resp.provider_used == ProviderType.GROQ
    assert resp.model_used == "llama-3.1-8b-instant"
    assert resp.text == "Output from Groq ultra-fast fallback"
    assert len(resp.attempted_hops) == 2


# ==============================================================================
# 10. Fatal Authentication Failure Behavior
# ==============================================================================


@pytest.mark.asyncio
async def test_fatal_authentication_failure_aborts_without_hopping():
    """Verify 401 unauthenticated aborts immediately and does not hop to other models or providers."""
    mock_or = MagicMock(spec=OpenRouterAdapter)
    mock_or.provider_type = ProviderType.OPENROUTER
    mock_or.get_supported_models.return_value = [
        ModelDescriptor(
            model_id="meta-llama/llama-3.3-70b-instruct:free",
            provider=ProviderType.OPENROUTER,
            display_name="Llama Free",
            capabilities={ModelCapability.STRUCTURED_OUTPUT, ModelCapability.FAST_INFERENCE},
            cost_tier=CostTier.FREE,
        )
    ]
    mock_or.generate_text = AsyncMock(
        side_effect=AIAuthenticationError("Invalid API key", model="meta-llama/llama-3.3-70b-instruct:free")
    )
    mock_or.classify_error = lambda err, m: err

    mock_groq = MagicMock(spec=GroqAdapter)
    mock_groq.provider_type = ProviderType.GROQ
    mock_groq.generate_text = AsyncMock(return_value="Groq should NOT be called")

    orchestrator = AIOrchestrator(register_defaults=False)
    orchestrator.register_adapter(mock_or)
    orchestrator.register_adapter(mock_groq)

    profile = UserAIProfile(
        user_id="user_auth_fail",
        provider_priority=[ProviderType.OPENROUTER, ProviderType.GROQ],
    )
    req = ExecutionRequest(
        task=AITaskType.JOB_INGESTION,
        user_id="user_auth_fail",
        prompt="Test auth failure",
    )

    with pytest.raises(AIAuthenticationError):
        await orchestrator.execute(request=req, profile=profile)

    # Groq was NEVER called because auth error is fatal to avoid pointless hopping
    mock_groq.generate_text.assert_not_called()


# ==============================================================================
# 11. Rate-Limit Fallback Behavior
# ==============================================================================


@pytest.mark.asyncio
async def test_rate_limit_fallback_sets_cooldown_and_proceeds():
    """Verify 429 sets model cooldown and seamlessly tries next candidate."""
    health = HealthRegistry()
    orchestrator = AIOrchestrator(health_registry=health, register_defaults=False)

    mock_adapter = MagicMock()
    mock_adapter.provider_type = ProviderType.GROQ
    mock_adapter.get_supported_models.return_value = [
        ModelDescriptor(
            model_id="llama-3.3-70b-versatile",
            provider=ProviderType.GROQ,
            display_name="Llama 70B",
            capabilities={ModelCapability.STRUCTURED_OUTPUT, ModelCapability.FAST_INFERENCE},
            cost_tier=CostTier.FREE,
            default_priority=10,
        ),
        ModelDescriptor(
            model_id="llama-3.1-8b-instant",
            provider=ProviderType.GROQ,
            display_name="Llama 8B",
            capabilities={ModelCapability.STRUCTURED_OUTPUT, ModelCapability.FAST_INFERENCE},
            cost_tier=CostTier.FREE,
            default_priority=20,
        ),
    ]

    async def mock_gen(model, **kwargs):
        if model == "llama-3.3-70b-versatile":
            raise AIRateLimitError("Rate limit exceeded", model=model, status_code=429)
        return "Recovered on 8B"

    mock_adapter.generate_text = AsyncMock(side_effect=mock_gen)
    mock_adapter.classify_error = lambda err, m: err
    orchestrator.register_adapter(mock_adapter)

    profile = UserAIProfile(user_id="user_ratelimit", provider_priority=[ProviderType.GROQ])
    req = ExecutionRequest(task=AITaskType.JOB_INGESTION, user_id="user_ratelimit", prompt="Test")

    resp = await orchestrator.execute(request=req, profile=profile)
    assert resp.text == "Recovered on 8B"
    # Verify model 1 is in cooldown
    assert health.is_model_in_cooldown("user_ratelimit", "server_groq_credential", "llama-3.3-70b-versatile")


# ==============================================================================
# 12. Timeout Fallback Behavior
# ==============================================================================


@pytest.mark.asyncio
async def test_timeout_fallback_behavior():
    """Verify AITimeoutError triggers candidate fallback."""
    orchestrator = AIOrchestrator(register_defaults=False)
    mock_adapter = MagicMock()
    mock_adapter.provider_type = ProviderType.GROQ
    mock_adapter.get_supported_models.return_value = [
        ModelDescriptor(
            model_id="llama-3.3-70b-versatile",
            provider=ProviderType.GROQ,
            display_name="Llama 70B",
            capabilities={ModelCapability.STRUCTURED_OUTPUT, ModelCapability.FAST_INFERENCE},
            cost_tier=CostTier.FREE,
            default_priority=10,
        ),
        ModelDescriptor(
            model_id="llama-3.1-8b-instant",
            provider=ProviderType.GROQ,
            display_name="Llama 8B",
            capabilities={ModelCapability.STRUCTURED_OUTPUT, ModelCapability.FAST_INFERENCE},
            cost_tier=CostTier.FREE,
            default_priority=20,
        ),
    ]

    async def mock_gen(model, **kwargs):
        if model == "llama-3.3-70b-versatile":
            raise AITimeoutError("Gateway timeout", model=model)
        return "Success after timeout"

    mock_adapter.generate_text = AsyncMock(side_effect=mock_gen)
    mock_adapter.classify_error = lambda err, m: err
    orchestrator.register_adapter(mock_adapter)

    profile = UserAIProfile(user_id="user_timeout", provider_priority=[ProviderType.GROQ])
    req = ExecutionRequest(task=AITaskType.JOB_INGESTION, user_id="user_timeout", prompt="Test")

    resp = await orchestrator.execute(request=req, profile=profile)
    assert resp.text == "Success after timeout"


# ==============================================================================
# 13. Model-Not-Found (404) Fallback Behavior
# ==============================================================================


@pytest.mark.asyncio
async def test_model_not_found_fallback_behavior():
    """Verify 404 model not found triggers candidate fallback."""
    orchestrator = AIOrchestrator(register_defaults=False)
    mock_adapter = MagicMock()
    mock_adapter.provider_type = ProviderType.OPENROUTER
    mock_adapter.get_supported_models.return_value = [
        ModelDescriptor(
            model_id="deprecated/model:free",
            provider=ProviderType.OPENROUTER,
            display_name="Deprecated Model",
            capabilities={ModelCapability.STRUCTURED_OUTPUT, ModelCapability.FAST_INFERENCE},
            cost_tier=CostTier.FREE,
            default_priority=10,
        ),
        ModelDescriptor(
            model_id="meta-llama/llama-3.3-70b-instruct:free",
            provider=ProviderType.OPENROUTER,
            display_name="Active Model",
            capabilities={ModelCapability.STRUCTURED_OUTPUT, ModelCapability.FAST_INFERENCE},
            cost_tier=CostTier.FREE,
            default_priority=20,
        ),
    ]

    async def mock_gen(model, **kwargs):
        if model == "deprecated/model:free":
            raise AIServiceUnavailableError("Model not found", model=model, status_code=404)
        return "Active model succeeded"

    mock_adapter.generate_text = AsyncMock(side_effect=mock_gen)
    mock_adapter.classify_error = lambda err, m: err
    orchestrator.register_adapter(mock_adapter)

    profile = UserAIProfile(user_id="user_404", provider_priority=[ProviderType.OPENROUTER])
    req = ExecutionRequest(task=AITaskType.JOB_INGESTION, user_id="user_404", prompt="Test")

    resp = await orchestrator.execute(request=req, profile=profile)
    assert resp.text == "Active model succeeded"


# ==============================================================================
# 14. Cost Policy Enforcement
# ==============================================================================


def test_cost_policy_enforcement_comprehensive():
    """Verify evaluation of FREE_ONLY, FREE_PREFERRED, and ANY_CONFIGURED policies."""
    # FREE_ONLY rejects PAID and UNKNOWN
    assert evaluate_cost_policy(CostPolicy.FREE_ONLY, False, CostTier.FREE).allowed
    assert not evaluate_cost_policy(CostPolicy.FREE_ONLY, False, CostTier.PAID).allowed
    assert not evaluate_cost_policy(CostPolicy.FREE_ONLY, False, CostTier.UNKNOWN).allowed
    assert not evaluate_cost_policy(CostPolicy.FREE_ONLY, True, CostTier.PAID).allowed  # allow_paid_fallback ignored in FREE_ONLY

    # FREE_PREFERRED permits paid ONLY when allow_paid_fallback is True
    assert evaluate_cost_policy(CostPolicy.FREE_PREFERRED, False, CostTier.FREE).allowed
    assert not evaluate_cost_policy(CostPolicy.FREE_PREFERRED, False, CostTier.PAID).allowed
    assert evaluate_cost_policy(CostPolicy.FREE_PREFERRED, True, CostTier.PAID).allowed

    # ANY_CONFIGURED allows both
    assert evaluate_cost_policy(CostPolicy.ANY_CONFIGURED, False, CostTier.FREE).allowed
    assert evaluate_cost_policy(CostPolicy.ANY_CONFIGURED, False, CostTier.PAID).allowed


# ==============================================================================
# 15. FREE_ONLY Never Selects Paid or Unknown Models
# ==============================================================================


def test_free_only_never_selects_paid_or_unknown_models():
    """Verify router completely excludes paid and unknown models under FREE_ONLY."""
    router = AIRouter()
    adapter = OpenRouterAdapter(api_key="test-key")
    # Register an UNKNOWN pricing model
    adapter.register_model(
        ModelDescriptor(
            model_id="mysterious/pricing-model",
            provider=ProviderType.OPENROUTER,
            display_name="Mysterious Pricing",
            capabilities={ModelCapability.FAST_INFERENCE},
            cost_tier=CostTier.UNKNOWN,
        )
    )

    profile = UserAIProfile(
        user_id="user_free_strict",
        cost_policy=CostPolicy.FREE_ONLY,
        allow_paid_fallback=True,  # Even with flag True, FREE_ONLY must block paid/unknown
        provider_priority=[ProviderType.OPENROUTER],
    )
    req = ExecutionRequest(
        task=AITaskType.JOB_INGESTION,
        user_id="user_free_strict",
        prompt="Test",
    )

    candidates = router.resolve_candidates(
        request=req,
        profile=profile,
        registered_adapters={ProviderType.OPENROUTER: adapter},
    )

    candidate_ids = [c.model_id for c in candidates]
    assert "mysterious/pricing-model" not in candidate_ids
    assert "meta-llama/llama-3.3-70b-instruct" not in candidate_ids
    assert "anthropic/claude-3.5-sonnet" not in candidate_ids
    for c in candidates:
        assert c.cost_tier == CostTier.FREE


# ==============================================================================
# 16. FREE_PREFERRED Does Not Use Paid Fallback Without Explicit Permission
# ==============================================================================


def test_free_preferred_paid_fallback_requires_explicit_permission():
    """Verify that FREE_PREFERRED excludes paid models without allow_paid_fallback=True."""
    router = AIRouter()
    adapter = OpenRouterAdapter(api_key="test-key")
    req = ExecutionRequest(task=AITaskType.JOB_INGESTION, user_id="user_pref", prompt="Test")

    # Without allow_paid_fallback
    prof_no_paid = UserAIProfile(
        user_id="user_pref",
        cost_policy=CostPolicy.FREE_PREFERRED,
        allow_paid_fallback=False,
        provider_priority=[ProviderType.OPENROUTER],
    )
    candidates_no_paid = router.resolve_candidates(
        request=req, profile=prof_no_paid, registered_adapters={ProviderType.OPENROUTER: adapter}
    )
    assert "anthropic/claude-3.5-sonnet" not in [c.model_id for c in candidates_no_paid]

    # With allow_paid_fallback
    prof_with_paid = UserAIProfile(
        user_id="user_pref",
        cost_policy=CostPolicy.FREE_PREFERRED,
        allow_paid_fallback=True,
        provider_priority=[ProviderType.OPENROUTER],
    )
    candidates_with_paid = router.resolve_candidates(
        request=req, profile=prof_with_paid, registered_adapters={ProviderType.OPENROUTER: adapter}
    )
    assert "anthropic/claude-3.5-sonnet" in [c.model_id for c in candidates_with_paid]
    # Crucial: Paid model must be ranked AFTER free models
    free_candidates = [c for c in candidates_with_paid if c.cost_tier == CostTier.FREE]
    paid_candidates = [c for c in candidates_with_paid if c.cost_tier == CostTier.PAID]
    assert free_candidates[0].priority < paid_candidates[0].priority


# ==============================================================================
# 17. Credential / Project Candidate Selection & Quota Rules
# ==============================================================================


def test_credential_project_candidate_selection_and_quota_rules():
    """Verify project scope contracts: UNVERIFIED_UNIQUE does NOT prove quota independence."""
    scope_synth1 = ProjectScope(scope_id="synth_1", scope_type=ScopeType.UNVERIFIED_UNIQUE, verified=False)
    scope_synth2 = ProjectScope(scope_id="synth_2", scope_type=ScopeType.UNVERIFIED_UNIQUE, verified=False)
    assert not scope_synth1.is_provably_independent(scope_synth2)

    scope_user_decl1 = ProjectScope(scope_id="proj_alpha", scope_type=ScopeType.USER_DECLARED_PROJECT, verified=False)
    scope_user_decl2 = ProjectScope(scope_id="proj_beta", scope_type=ScopeType.USER_DECLARED_PROJECT, verified=False)
    assert not scope_user_decl1.is_provably_independent(scope_user_decl2)

    # Only verified distinct projects prove independence
    scope_ver1 = ProjectScope(scope_id="gcp-123", scope_type=ScopeType.VERIFIED_PROJECT, verified=True)
    scope_ver2 = ProjectScope(scope_id="gcp-456", scope_type=ScopeType.VERIFIED_PROJECT, verified=True)
    assert scope_ver1.is_provably_independent(scope_ver2)

    # Shared scope detection
    scope_shared = ProjectScope(scope_id="gcp-123", scope_type=ScopeType.VERIFIED_PROJECT, verified=True)
    assert scope_ver1.shares_known_scope(scope_shared)


# ==============================================================================
# 18. Per-User Health Isolation
# ==============================================================================


def test_per_user_health_isolation_openrouter_and_groq():
    """Verify that user A rate limit or invalid key does NOT affect user B."""
    health = HealthRegistry()
    user_a = "user_a"
    user_b = "user_b"
    cred_id = "cred_openrouter_test"
    model_id = "meta-llama/llama-3.3-70b-instruct:free"

    # Put User A in cooldown & mark credential invalid
    health.set_model_cooldown(user_a, cred_id, model_id, duration_seconds=60.0)
    health.set_credential_health(user_a, cred_id, CredentialHealth.INVALID_KEY)

    # User A is affected
    assert health.is_model_in_cooldown(user_a, cred_id, model_id)
    assert not health.is_credential_healthy(user_a, cred_id)

    # User B is completely healthy and isolated
    assert not health.is_model_in_cooldown(user_b, cred_id, model_id)
    assert health.is_credential_healthy(user_b, cred_id)


# ==============================================================================
# 19. No Adapter-Level Fallback Loops
# ==============================================================================


@pytest.mark.asyncio
async def test_no_adapter_level_fallback_loops():
    """Verify that OpenRouter and Groq adapters execute single requests and do not contain fallback loops."""
    mock_client = AsyncMock(spec=httpx.AsyncClient)
    req = httpx.Request("POST", "https://openrouter.ai/api/v1/chat/completions")
    resp = httpx.Response(429, request=req, json={"error": {"message": "Rate limit"}})
    mock_client.post.side_effect = httpx.HTTPStatusError("429 Rate limit", request=req, response=resp)

    adapter = OpenRouterAdapter(api_key="test-key", http_client=mock_client)

    # Calling adapter directly MUST immediately raise AIRateLimitError on 1 call
    with pytest.raises(AIRateLimitError):
        await adapter.generate_text(model="meta-llama/llama-3.3-70b-instruct:free", prompt="Test")

    # Adapter executed exactly ONE call, proving NO internal multi-model fallback loop
    assert mock_client.post.call_count == 1


# ==============================================================================
# 20. Structured Output Self-Repair Remains 1-Shot
# ==============================================================================


@pytest.mark.asyncio
async def test_structured_output_self_repair_remains_1_shot_on_openrouter():
    """Verify structured output validation failure triggers exactly 1 self-repair call."""
    mock_adapter = MagicMock(spec=OpenRouterAdapter)
    mock_adapter.provider_type = ProviderType.OPENROUTER
    mock_adapter.get_supported_models.return_value = [
        ModelDescriptor(
            model_id="meta-llama/llama-3.3-70b-instruct:free",
            provider=ProviderType.OPENROUTER,
            display_name="Llama Free",
            capabilities={ModelCapability.STRUCTURED_OUTPUT, ModelCapability.FAST_INFERENCE},
            cost_tier=CostTier.FREE,
        )
    ]

    call_count = 0

    async def mock_gen_struct(model, prompt, schema, **kwargs):
        nonlocal call_count
        call_count += 1
        if call_count == 1:
            # First call returns invalid schema
            raise SchemaRepairNeededError("Missing experience_years", raw_output='{"name": "Alice"}', original_error=ValueError("field missing"))
        # Second (repair) call returns valid object
        return '{"name": "Alice", "experience_years": 5}', schema(name="Alice", experience_years=5)

    mock_adapter.generate_structured = AsyncMock(side_effect=mock_gen_struct)
    mock_adapter.classify_error = lambda err, m: err

    orchestrator = AIOrchestrator(register_defaults=False)
    orchestrator.register_adapter(mock_adapter)

    profile = UserAIProfile(user_id="user_repair", provider_priority=[ProviderType.OPENROUTER])
    req = ExecutionRequest(
        task=AITaskType.JOB_INGESTION,
        user_id="user_repair",
        prompt="Extract info",
        schema_cls=SampleResumeExtraction,
    )

    resp = await orchestrator.execute(request=req, profile=profile)
    assert resp.structured_data is not None
    assert isinstance(resp.structured_data, SampleResumeExtraction)
    assert resp.structured_data.name == "Alice"
    assert resp.structured_data.experience_years == 5
    # Exactly 2 calls: initial + 1-shot repair
    assert call_count == 2


# ==============================================================================
# 21. Existing Gemini Fallback Remains Unchanged
# ==============================================================================


@pytest.mark.asyncio
async def test_existing_gemini_fallback_remains_unchanged():
    """Verify the original Gemini model fallback chain operates seamlessly."""
    provider = GeminiProvider(
        api_key="fake-key",
        model_chain=["gemini-3.5-flash-lite", "gemini-3.1-flash-lite"],
    )
    mock_client = MagicMock()

    def side_effect(model, contents, config):
        if model == "gemini-3.5-flash-lite":
            from google.genai import errors as genai_errors
            raise genai_errors.ServerError(503, {"error": {"message": "Gemini 503"}}, None)
        resp = MagicMock()
        resp.text = "Gemini Flash Lite 3.1 OK"
        return resp

    mock_client.models.generate_content.side_effect = side_effect
    provider._client = mock_client

    result = await provider.generate_text("Prompt")
    assert result == "Gemini Flash Lite 3.1 OK"
    assert provider.last_model_used == "gemini-3.1-flash-lite"


# ==============================================================================
# 22. Existing GeminiProvider Compatibility Remains Intact
# ==============================================================================


@pytest.mark.asyncio
async def test_existing_gemini_provider_compatibility_facade():
    """Verify GeminiProvider compatibility facade maintains all caller contracts."""
    provider = GeminiProvider(api_key="fake-key", model_chain=["gemini-3.5-flash-lite"])
    mock_client = MagicMock()
    mock_resp = MagicMock()
    mock_resp.text = '{"name": "Bob", "experience_years": 8}'
    mock_client.models.generate_content.return_value = mock_resp
    provider._client = mock_client

    data = await provider.generate_structured("Extract resume", SampleResumeExtraction)
    assert data.name == "Bob"
    assert data.experience_years == 8
    assert provider.last_model_used == "gemini-3.5-flash-lite"


# ==============================================================================
# 23. Embedding Path Remains Isolated
# ==============================================================================


@pytest.mark.asyncio
async def test_embedding_path_remains_isolated_to_gemini():
    """Verify vector embeddings are isolated to Gemini and rejected by OpenRouter/Groq."""
    openrouter = OpenRouterAdapter(api_key="test-key")
    groq = GroqAdapter(api_key="test-key")

    with pytest.raises(AIConfigurationError) as exc_or:
        await openrouter.embed("test query")
    assert "isolated to the Gemini adapter" in str(exc_or.value)

    with pytest.raises(AIConfigurationError) as exc_groq:
        await groq.embed("test query")
    assert "isolated to the Gemini adapter" in str(exc_groq.value)
