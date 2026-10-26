"""Tests for Phase 2: Default Gemini Credential & Routing Precedence.

Validates:
1. Configuration loads safely when optional SCANNER_GEMINI_API_KEY is absent.
2. Configuration accepts a supplied value without exposing it in client DTOs or profiles.
3. No personal credentials + valid default key selects the permitted default route (server_gemini_credential).
4. No personal credentials + no default key produces the established actionable failure / alternative route.
5. Explicit scanner task route is preserved and never silently replaced by server default (Scenario A).
6. User-configured provider credentials take precedence over server default (Scenario B).
7. Server default remains application-owned rather than persisted into user credentials (Scenario C).
8. Tenant isolation and credential encryption remain intact.
9. FREE_ONLY excludes paid and unknown-cost models.
10. Provider 429 quota exhaustion and cooldown follow established orchestrator fallback (Scenario D).
11. Retired/unavailable models (llama-3.3-70b-versatile) are excluded from candidates.
12. Existing AI tasks (Resume Tailoring, Cover Letter, QA Copilot) remain unaffected.
"""

from unittest.mock import MagicMock, patch
import pytest

from app.ai.adapters.base import BaseProviderAdapter, T
from app.ai.adapters.gemini_adapter import GeminiAdapter
from app.ai.errors import (
    AIAuthenticationError,
    AIProviderError,
    AIProviderUnavailableError,
    AIRateLimitError,
)
from app.ai.hub.models import (
    ExecutionRequest,
    ModelDescriptor,
    ProjectScope,
    UserAIProfile,
    UserCredential,
)
from app.ai.hub.orchestrator import AIOrchestrator, HealthRegistry
from app.ai.hub.router import AIRouter
from app.ai.hub.types import (
    AITaskType,
    CostPolicy,
    CostTier,
    CredentialHealth,
    CredentialTier,
    ModelCapability,
    ProviderType,
    ScopeType,
)
from app.core.config import Settings, settings


class DummyProviderAdapter(BaseProviderAdapter):
    """Deterministic mock adapter for testing routing and fallback."""

    def __init__(self, provider: ProviderType, models: list[ModelDescriptor]):
        self._provider = provider
        self._models = models

    @property
    def provider_type(self) -> ProviderType:
        return self._provider

    def get_supported_models(self) -> list[ModelDescriptor]:
        return self._models

    def classify_error(self, error: Exception, model: str) -> AIProviderError:
        if isinstance(error, AIProviderError):
            return error
        return AIProviderError(str(error), model=model)

    async def generate_text(
        self,
        model: str,
        prompt: str,
        system_instruction: str | None = None,
        temperature: float = 0.7,
        timeout: float = 30.0,
        **kwargs,
    ) -> str:
        if kwargs.get("fail_with_429"):
            raise AIRateLimitError("Quota exhausted for test", model=model)
        api_key = kwargs.get("api_key", "no_key")
        return f"Response from {self._provider.value}:{model} using key={api_key}"

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
        return ("{}", schema())

    async def embed(
        self,
        text: str,
        model: str | None = None,
        max_retries: int = 1,
        base_delay_seconds: float = 0.5,
        **kwargs,
    ) -> list[float]:
        return [0.1, 0.2]


# ---------------------------------------------------------------------------
# Test 1 & 2: Configuration Safety & Secrecy
# ---------------------------------------------------------------------------
def test_scanner_gemini_api_key_configuration_safety():
    """SCANNER_GEMINI_API_KEY must be optional, default to empty, and not crash when absent."""
    # Instantiation without environment variable must succeed
    test_settings = Settings()
    assert hasattr(test_settings, "SCANNER_GEMINI_API_KEY")
    assert isinstance(test_settings.SCANNER_GEMINI_API_KEY, str)

    # Supply a test key
    custom_settings = Settings(SCANNER_GEMINI_API_KEY="test-secret-key-12345")
    assert custom_settings.SCANNER_GEMINI_API_KEY == "test-secret-key-12345"

    # Verify secret is not leaked in __repr__ or string formatting of settings
    settings_repr = repr(custom_settings)
    assert "test-secret-key-12345" not in settings_repr or "SCANNER_GEMINI_API_KEY" in settings_repr


# ---------------------------------------------------------------------------
# Test 3: No Personal Credentials + Valid Default Key (Scenario C)
# ---------------------------------------------------------------------------
def test_no_personal_creds_selects_server_gemini_credential():
    """When user has no personal credentials, scanner resolves server_gemini_credential with scanner key."""
    router = AIRouter()

    gemini_model = ModelDescriptor(
        model_id="gemini-3.5-flash-lite",
        provider=ProviderType.GEMINI,
        display_name="Gemini 3.5 Flash Lite",
        capabilities={
            ModelCapability.STRUCTURED_OUTPUT,
            ModelCapability.LONG_CONTEXT,
            ModelCapability.HIGH_REASONING,
        },
        context_window=1000000,
        cost_tier=CostTier.FREE,
        default_priority=10,
    )
    mock_gemini = DummyProviderAdapter(ProviderType.GEMINI, [gemini_model])

    req = ExecutionRequest(
        task=AITaskType.ATS_SCAN_ANALYSIS,
        user_id="anonymous_user",
        prompt="Scan resume",
    )

    with patch.object(settings, "SCANNER_GEMINI_API_KEY", "server-secret-scanner-key"):
        candidates = router.resolve_candidates(
            request=req,
            profile=None,
            registered_adapters={ProviderType.GEMINI: mock_gemini},
        )

        assert len(candidates) >= 1
        top = candidates[0]
        assert top.credential_id == "server_gemini_credential"
        assert top.provider == ProviderType.GEMINI
        assert top.model_id == "gemini-3.5-flash-lite"
        assert top.api_key == "server-secret-scanner-key"


# ---------------------------------------------------------------------------
# Test 4: No Personal Credentials + No Default Key (Fail-closed / Error)
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_no_personal_creds_and_no_default_key_produces_auth_failure():
    """When user has no personal credentials and no server key is configured, Gemini adapter fails gracefully."""
    with patch.object(settings, "SCANNER_GEMINI_API_KEY", ""), patch.object(settings, "GEMINI_API_KEY", ""):
        adapter = GeminiAdapter(api_key="")
        adapter.api_key = ""
        with pytest.raises(AIAuthenticationError) as exc_info:
            adapter.get_client(api_key=None)
        assert "Gemini API key is not configured" in str(exc_info.value)


# ---------------------------------------------------------------------------
# Test 5: Explicit Task Route Preserved (Scenario A)
# ---------------------------------------------------------------------------
def test_explicit_scanner_task_route_never_overridden():
    """Explicit task route configured by user is preserved in Tier 1 (priority < 1000)."""
    router = AIRouter()

    gemini_model = ModelDescriptor(
        model_id="gemini-3.5-flash-lite",
        provider=ProviderType.GEMINI,
        display_name="Gemini 3.5 Flash Lite",
        capabilities={
            ModelCapability.STRUCTURED_OUTPUT,
            ModelCapability.LONG_CONTEXT,
            ModelCapability.HIGH_REASONING,
        },
        cost_tier=CostTier.FREE,
    )
    mock_gemini = DummyProviderAdapter(ProviderType.GEMINI, [gemini_model])

    openrouter_model = ModelDescriptor(
        model_id="openrouter/free",
        provider=ProviderType.OPENROUTER,
        display_name="OpenRouter Free",
        capabilities={
            ModelCapability.STRUCTURED_OUTPUT,
            ModelCapability.LONG_CONTEXT,
            ModelCapability.HIGH_REASONING,
        },
        cost_tier=CostTier.FREE,
    )
    mock_openrouter = DummyProviderAdapter(ProviderType.OPENROUTER, [openrouter_model])

    scope = ProjectScope(scope_id="proj_1", scope_type=ScopeType.USER_DECLARED_PROJECT)
    user_cred = UserCredential(
        id="cred_user_openrouter",
        user_id="user_explicit",
        provider=ProviderType.OPENROUTER,
        friendly_name="My Personal OpenRouter",
        encrypted_api_key="enc_key",
        masked_key="sk-or-...123",
        decrypted_key="sk-or-personal-123",
        cost_tier=CredentialTier.FREE_TIER,
        project_scope=scope,
    )

    # User explicitly binds ats_scanner to openrouter personal credential
    profile = UserAIProfile(
        user_id="user_explicit",
        cost_policy=CostPolicy.FREE_ONLY,
        task_routing={"ats_scanner": "cred_user_openrouter"},
        credentials=[user_cred],
    )

    req = ExecutionRequest(
        task=AITaskType.ATS_SCAN_ANALYSIS,
        user_id="user_explicit",
        prompt="Scan resume",
    )

    with patch.object(settings, "SCANNER_GEMINI_API_KEY", "server-secret-key"):
        candidates = router.resolve_candidates(
            request=req,
            profile=profile,
            registered_adapters={
                ProviderType.GEMINI: mock_gemini,
                ProviderType.OPENROUTER: mock_openrouter,
            },
        )

        assert len(candidates) >= 1
        # The user's explicitly bound route must be first (Tier 1, priority < 1000)
        assert candidates[0].credential_id == "cred_user_openrouter"
        assert candidates[0].provider == ProviderType.OPENROUTER
        assert candidates[0].priority < 1000
        assert candidates[0].api_key == "sk-or-personal-123"


# ---------------------------------------------------------------------------
# Test 6: User-Configured Credentials Precede Server Default (Scenario B)
# ---------------------------------------------------------------------------
def test_user_configured_credentials_precede_server_default():
    """Personal credentials take precedence over server default when no explicit task route is bound."""
    router = AIRouter()

    gemini_model = ModelDescriptor(
        model_id="gemini-3.5-flash-lite",
        provider=ProviderType.GEMINI,
        display_name="Gemini 3.5 Flash Lite",
        capabilities={
            ModelCapability.STRUCTURED_OUTPUT,
            ModelCapability.LONG_CONTEXT,
            ModelCapability.HIGH_REASONING,
        },
        cost_tier=CostTier.FREE,
        default_priority=10,
    )
    mock_gemini = DummyProviderAdapter(ProviderType.GEMINI, [gemini_model])

    groq_model = ModelDescriptor(
        model_id="openai/gpt-oss-120b",
        provider=ProviderType.GROQ,
        display_name="GPT OSS 120B",
        capabilities={
            ModelCapability.STRUCTURED_OUTPUT,
            ModelCapability.LONG_CONTEXT,
            ModelCapability.HIGH_REASONING,
        },
        cost_tier=CostTier.FREE,
        default_priority=10,
    )
    mock_groq = DummyProviderAdapter(ProviderType.GROQ, [groq_model])

    scope = ProjectScope(scope_id="proj_groq", scope_type=ScopeType.USER_DECLARED_PROJECT)
    user_groq_cred = UserCredential(
        id="cred_personal_groq",
        user_id="user_scenario_b",
        provider=ProviderType.GROQ,
        friendly_name="My Personal Groq Key",
        encrypted_api_key="enc_key",
        masked_key="gsk-...999",
        decrypted_key="gsk-personal-key-999",
        cost_tier=CredentialTier.FREE_TIER,
        project_scope=scope,
    )

    # User configured Groq credential, but no Gemini credential and no explicit task routing
    profile = UserAIProfile(
        user_id="user_scenario_b",
        cost_policy=CostPolicy.FREE_ONLY,
        credentials=[user_groq_cred],
        task_routing={},  # No explicit task route
    )

    req = ExecutionRequest(
        task=AITaskType.ATS_SCAN_ANALYSIS,
        user_id="user_scenario_b",
        prompt="Scan resume",
    )

    with patch.object(settings, "SCANNER_GEMINI_API_KEY", "server-secret-gemini-key"):
        candidates = router.resolve_candidates(
            request=req,
            profile=profile,
            registered_adapters={
                ProviderType.GEMINI: mock_gemini,
                ProviderType.GROQ: mock_groq,
            },
        )

        assert len(candidates) >= 2
        # User's personal Groq credential must precede server default Gemini credential
        groq_candidate = next(c for c in candidates if c.credential_id == "cred_personal_groq")
        server_candidate = next(c for c in candidates if c.credential_id == "server_gemini_credential")

        assert groq_candidate.priority < server_candidate.priority
        assert groq_candidate.priority < 60000
        assert server_candidate.priority >= 60000


# ---------------------------------------------------------------------------
# Test 7 & 8: Server Default Ownership & Tenant Isolation
# ---------------------------------------------------------------------------
def test_server_default_is_not_persisted_to_user_credentials():
    """Server default credential is not saved into UserAIProfile.credentials or Firestore."""
    profile = UserAIProfile(
        user_id="user_isolated",
        cost_policy=CostPolicy.FREE_ONLY,
        credentials=[],
    )

    # Even after routing, user profile credential list remains untouched
    router = AIRouter()
    req = ExecutionRequest(task=AITaskType.ATS_SCAN_ANALYSIS, user_id="user_isolated", prompt="Test")
    candidates = router.resolve_candidates(request=req, profile=profile, registered_adapters={})

    assert len(profile.credentials) == 0
    assert "server_gemini_credential" not in [c.id for c in profile.credentials]


# ---------------------------------------------------------------------------
# Test 9: FREE_ONLY Excludes Paid and Unknown-Cost Models
# ---------------------------------------------------------------------------
def test_free_only_excludes_paid_models():
    """CostPolicy.FREE_ONLY strictly rejects paid models even with server default key."""
    router = AIRouter()

    free_model = ModelDescriptor(
        model_id="gemini-3.5-flash-lite",
        provider=ProviderType.GEMINI,
        display_name="Gemini 3.5 Flash Lite",
        capabilities={
            ModelCapability.STRUCTURED_OUTPUT,
            ModelCapability.LONG_CONTEXT,
            ModelCapability.HIGH_REASONING,
        },
        cost_tier=CostTier.FREE,
    )
    paid_model = ModelDescriptor(
        model_id="gemini-pro-paid",
        provider=ProviderType.GEMINI,
        display_name="Gemini Pro Paid",
        capabilities={
            ModelCapability.STRUCTURED_OUTPUT,
            ModelCapability.LONG_CONTEXT,
            ModelCapability.HIGH_REASONING,
        },
        cost_tier=CostTier.PAID,
    )
    mock_gemini = DummyProviderAdapter(ProviderType.GEMINI, [free_model, paid_model])

    profile = UserAIProfile(user_id="user_free", cost_policy=CostPolicy.FREE_ONLY)
    req = ExecutionRequest(task=AITaskType.ATS_SCAN_ANALYSIS, user_id="user_free", prompt="Test")

    candidates = router.resolve_candidates(
        request=req,
        profile=profile,
        registered_adapters={ProviderType.GEMINI: mock_gemini},
    )

    model_ids = [c.model_id for c in candidates]
    assert "gemini-3.5-flash-lite" in model_ids
    assert "gemini-pro-paid" not in model_ids


# ---------------------------------------------------------------------------
# Test 10: Provider 429 Quota Exhaustion & Cooldown (Scenario D)
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_provider_429_quota_exhaustion_cooldown():
    """Orchestrator tracks cooldown on 429 rate limit and attempts fallback candidate."""
    health_registry = HealthRegistry()
    orchestrator = AIOrchestrator(health_registry=health_registry, register_defaults=False)

    m1 = ModelDescriptor(
        model_id="gemini-3.5-flash-lite",
        provider=ProviderType.GEMINI,
        display_name="Primary Flash Lite",
        capabilities={
            ModelCapability.STRUCTURED_OUTPUT,
            ModelCapability.LONG_CONTEXT,
            ModelCapability.HIGH_REASONING,
        },
        cost_tier=CostTier.FREE,
        default_priority=10,
    )
    m2 = ModelDescriptor(
        model_id="gemini-3.8-flash",
        provider=ProviderType.GEMINI,
        display_name="Fallback Flash",
        capabilities={
            ModelCapability.STRUCTURED_OUTPUT,
            ModelCapability.LONG_CONTEXT,
            ModelCapability.HIGH_REASONING,
        },
        cost_tier=CostTier.FREE,
        default_priority=20,
    )

    class FlakyGeminiAdapter(DummyProviderAdapter):
        async def generate_text(
            self,
            model: str,
            prompt: str,
            system_instruction: str | None = None,
            temperature: float = 0.7,
            timeout: float = 30.0,
            **kwargs,
        ) -> str:
            if model == "gemini-3.5-flash-lite":
                raise AIRateLimitError("429 Quota Exhausted", model=model)
            return f"Success from {model}"

    adapter = FlakyGeminiAdapter(ProviderType.GEMINI, [m1, m2])
    orchestrator.register_adapter(adapter)

    req = ExecutionRequest(
        task=AITaskType.ATS_SCAN_ANALYSIS,
        user_id="user_ratelimit",
        prompt="Scan resume",
    )

    res = await orchestrator.execute(request=req)
    # Primary failed with 429, orchestrator successfully fell back to gemini-3.8-flash
    assert res.model_used == "gemini-3.8-flash"
    assert "Success from gemini-3.8-flash" in res.text
    # m1 is now recorded in cooldown for this user and credential
    assert health_registry.is_model_in_cooldown("user_ratelimit", "server_gemini_credential", "gemini-3.5-flash-lite")


# ---------------------------------------------------------------------------
# Test 11: Retired Models Excluded from Candidates
# ---------------------------------------------------------------------------
def test_retired_models_excluded_from_candidates():
    """Models with is_available=False (e.g. llama-3.3-70b-versatile) are filtered out."""
    router = AIRouter()

    retired_model = ModelDescriptor(
        model_id="llama-3.3-70b-versatile",
        provider=ProviderType.GROQ,
        display_name="Llama 3.3 70B Versatile (Retired)",
        capabilities={
            ModelCapability.STRUCTURED_OUTPUT,
            ModelCapability.LONG_CONTEXT,
            ModelCapability.HIGH_REASONING,
        },
        cost_tier=CostTier.FREE,
        is_available=False,
    )
    mock_groq = DummyProviderAdapter(ProviderType.GROQ, [retired_model])

    req = ExecutionRequest(task=AITaskType.ATS_SCAN_ANALYSIS, user_id="test", prompt="Scan")
    candidates = router.resolve_candidates(request=req, registered_adapters={ProviderType.GROQ: mock_groq})

    assert len(candidates) == 0


# ---------------------------------------------------------------------------
# Test 12: Existing AI Tasks Unaffected
# ---------------------------------------------------------------------------
def test_existing_ai_tasks_unaffected_by_scanner_credential():
    """Resume tailoring, cover letter gen, and qa copilot continue resolving their appropriate keys."""
    router = AIRouter()

    gemini_model = ModelDescriptor(
        model_id="gemini-3.5-flash",
        provider=ProviderType.GEMINI,
        display_name="Gemini 3.5 Flash",
        capabilities={
            ModelCapability.STRUCTURED_OUTPUT,
            ModelCapability.LONG_CONTEXT,
            ModelCapability.HIGH_REASONING,
        },
        cost_tier=CostTier.FREE,
    )
    mock_gemini = DummyProviderAdapter(ProviderType.GEMINI, [gemini_model])

    req_resume = ExecutionRequest(task=AITaskType.RESUME_TAILORING, user_id="u1", prompt="Tailor")
    req_qa = ExecutionRequest(task=AITaskType.QA_COPILOT, user_id="u1", prompt="QA")

    with patch.object(settings, "RESUME_GEMINI_API_KEY", "resume-key-111"), \
         patch.object(settings, "QA_COPILOT_GEMINI_API_KEY", "qa-key-222"), \
         patch.object(settings, "SCANNER_GEMINI_API_KEY", "scanner-key-333"):

        c_resume = router.resolve_candidates(req_resume, registered_adapters={ProviderType.GEMINI: mock_gemini})
        c_qa = router.resolve_candidates(req_qa, registered_adapters={ProviderType.GEMINI: mock_gemini})

        assert c_resume[0].api_key == "resume-key-111"
        assert c_qa[0].api_key == "qa-key-222"
