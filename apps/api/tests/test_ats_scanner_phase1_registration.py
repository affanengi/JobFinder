"""Tests for Phase 1: ATS Scanner Task Registration & AI Hub Wiring.

Validates:
1. ATS_SCAN_ANALYSIS is registered in AITaskType and TASK_REQUIREMENTS_MAP.
2. Supported task aliases normalize consistently to the canonical identifier.
3. Route resolution resolves candidates for ATS_SCAN_ANALYSIS through AIRouter.
4. Structured-output and capability requirements are enforced during candidate resolution.
5. CostPolicy.FREE_ONLY strictly excludes paid and unknown-cost models.
6. Existing task identifiers and routing behaviors remain intact and unaffected.
7. Unsupported task aliases and invalid tasks behave according to existing conventions.
"""

import pytest

from app.ai.adapters.base import BaseProviderAdapter, T
from app.ai.errors import AIProviderError
from app.ai.hub.models import (
    ExecutionRequest,
    ModelDescriptor,
    ProjectScope,
    UserAIProfile,
    UserCredential,
)
from app.ai.hub.router import TASK_REQUIREMENTS_MAP, AIRouter
from app.ai.hub.task_key_normalizer import (
    get_task_aliases,
    normalize_task_key,
)
from app.ai.hub.types import (
    AITaskType,
    CostPolicy,
    CostTier,
    CredentialTier,
    ModelCapability,
    ProviderType,
    ScopeType,
)


class DummyMockAdapter(BaseProviderAdapter):
    """Deterministic mock adapter for unit testing routing contracts."""

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
        return f"Mock text from {model}"

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
# Test 1: Task Registration & Requirements Verification
# ---------------------------------------------------------------------------
def test_ats_scan_analysis_task_registration():
    """ATS_SCAN_ANALYSIS must be registered as a valid AITaskType enum with explicit requirements."""
    # Enum registration
    assert hasattr(AITaskType, "ATS_SCAN_ANALYSIS")
    assert AITaskType.ATS_SCAN_ANALYSIS.value == "ats_scan_analysis"

    # Requirements mapping registration
    assert AITaskType.ATS_SCAN_ANALYSIS in TASK_REQUIREMENTS_MAP
    req = TASK_REQUIREMENTS_MAP[AITaskType.ATS_SCAN_ANALYSIS]

    assert req.task == AITaskType.ATS_SCAN_ANALYSIS
    assert ModelCapability.STRUCTURED_OUTPUT in req.required_capabilities
    assert ModelCapability.LONG_CONTEXT in req.required_capabilities
    assert ModelCapability.HIGH_REASONING in req.required_capabilities
    assert req.minimum_context_window >= 16000
    assert req.schema_required is True


# ---------------------------------------------------------------------------
# Test 2: Task Key Normalization & Aliases
# ---------------------------------------------------------------------------
def test_ats_scanner_task_key_normalization():
    """Verify bidirectional alias normalization for ATS Scanner task keys."""
    # Canonical key
    assert normalize_task_key("ats_scan_analysis") == "ats_scan_analysis"
    assert normalize_task_key(AITaskType.ATS_SCAN_ANALYSIS) == "ats_scan_analysis"

    # Recognized aliases
    assert normalize_task_key("ats_scanner") == "ats_scan_analysis"
    assert normalize_task_key("ats_scan") == "ats_scan_analysis"

    # Whitespace handling
    assert normalize_task_key("  ats_scanner  ") == "ats_scan_analysis"

    # Alias group retrieval
    aliases = get_task_aliases(AITaskType.ATS_SCAN_ANALYSIS)
    assert "ats_scan_analysis" in aliases
    assert "ats_scanner" in aliases
    assert "ats_scan" in aliases
    assert sorted(aliases) == ["ats_scan", "ats_scan_analysis", "ats_scanner"]


# ---------------------------------------------------------------------------
# Test 3 & 4: Route Resolution & Capability Enforcement
# ---------------------------------------------------------------------------
def test_ats_scan_route_resolution_and_capability_filtering():
    """AIRouter must filter models by required capabilities for ATS_SCAN_ANALYSIS."""
    router = AIRouter()

    # Model 1: Fully qualified for ATS_SCAN_ANALYSIS
    qualified_model = ModelDescriptor(
        model_id="gemini-3.5-flash-lite",
        provider=ProviderType.GEMINI,
        display_name="Gemini 3.5 Flash-Lite",
        capabilities={
            ModelCapability.STRUCTURED_OUTPUT,
            ModelCapability.LONG_CONTEXT,
            ModelCapability.HIGH_REASONING,
        },
        context_window=1000000,
        cost_tier=CostTier.FREE,
        default_priority=10,
    )

    # Model 2: Missing STRUCTURED_OUTPUT capability
    unstructured_model = ModelDescriptor(
        model_id="legacy-unstructured-model",
        provider=ProviderType.GEMINI,
        display_name="Legacy Unstructured Model",
        capabilities={
            ModelCapability.LONG_CONTEXT,
            ModelCapability.HIGH_REASONING,
        },
        context_window=1000000,
        cost_tier=CostTier.FREE,
        default_priority=20,
    )

    # Model 3: Missing LONG_CONTEXT and HIGH_REASONING capabilities
    fast_simple_model = ModelDescriptor(
        model_id="fast-simple-model",
        provider=ProviderType.GEMINI,
        display_name="Fast Simple Model",
        capabilities={
            ModelCapability.STRUCTURED_OUTPUT,
            ModelCapability.FAST_INFERENCE,
        },
        context_window=4000,
        cost_tier=CostTier.FREE,
        default_priority=30,
    )

    mock_gemini = DummyMockAdapter(
        ProviderType.GEMINI,
        [qualified_model, unstructured_model, fast_simple_model],
    )

    req = ExecutionRequest(
        task=AITaskType.ATS_SCAN_ANALYSIS,
        user_id="test_user",
        prompt="Scan resume against job description",
    )

    candidates = router.resolve_candidates(
        request=req,
        registered_adapters={ProviderType.GEMINI: mock_gemini},
    )

    # Only the qualified model should be returned
    assert len(candidates) == 1
    assert candidates[0].model_id == "gemini-3.5-flash-lite"
    assert candidates[0].provider == ProviderType.GEMINI


# ---------------------------------------------------------------------------
# Test 5: Cost Policy Enforcement (FREE_ONLY)
# ---------------------------------------------------------------------------
def test_ats_scan_free_only_cost_policy_enforcement():
    """FREE_ONLY cost policy must strictly exclude paid and unknown-cost models."""
    router = AIRouter()

    free_model = ModelDescriptor(
        model_id="free-flash-model",
        provider=ProviderType.GEMINI,
        display_name="Free Flash Model",
        capabilities={
            ModelCapability.STRUCTURED_OUTPUT,
            ModelCapability.LONG_CONTEXT,
            ModelCapability.HIGH_REASONING,
        },
        context_window=1000000,
        cost_tier=CostTier.FREE,
        default_priority=10,
    )

    paid_model = ModelDescriptor(
        model_id="paid-pro-model",
        provider=ProviderType.GEMINI,
        display_name="Paid Pro Model",
        capabilities={
            ModelCapability.STRUCTURED_OUTPUT,
            ModelCapability.LONG_CONTEXT,
            ModelCapability.HIGH_REASONING,
        },
        context_window=1000000,
        cost_tier=CostTier.PAID,
        default_priority=20,
    )

    unknown_model = ModelDescriptor(
        model_id="unknown-pricing-model",
        provider=ProviderType.GEMINI,
        display_name="Unknown Pricing Model",
        capabilities={
            ModelCapability.STRUCTURED_OUTPUT,
            ModelCapability.LONG_CONTEXT,
            ModelCapability.HIGH_REASONING,
        },
        context_window=1000000,
        cost_tier=CostTier.UNKNOWN,
        default_priority=30,
    )

    mock_gemini = DummyMockAdapter(
        ProviderType.GEMINI,
        [free_model, paid_model, unknown_model],
    )

    # User profile with CostPolicy.FREE_ONLY
    profile = UserAIProfile(
        user_id="user_free_only",
        cost_policy=CostPolicy.FREE_ONLY,
        allow_paid_fallback=False,
    )

    req = ExecutionRequest(
        task=AITaskType.ATS_SCAN_ANALYSIS,
        user_id="user_free_only",
        prompt="Scan resume",
    )

    candidates = router.resolve_candidates(
        request=req,
        profile=profile,
        registered_adapters={ProviderType.GEMINI: mock_gemini},
    )

    # Only the free-tier model must be selected
    candidate_ids = [c.model_id for c in candidates]
    assert candidate_ids == ["free-flash-model"]
    assert "paid-pro-model" not in candidate_ids
    assert "unknown-pricing-model" not in candidate_ids


# ---------------------------------------------------------------------------
# Test 6: Task Routing Map Preference Preservation
# ---------------------------------------------------------------------------
def test_ats_scan_explicit_task_routing_preference():
    """If user configures a preferred credential for ats_scan_analysis, it must be ranked Tier 1 (priority=0)."""
    router = AIRouter()

    model_free = ModelDescriptor(
        model_id="gemini-3.5-flash-lite",
        provider=ProviderType.GEMINI,
        display_name="Gemini 3.5 Flash-Lite",
        capabilities={
            ModelCapability.STRUCTURED_OUTPUT,
            ModelCapability.LONG_CONTEXT,
            ModelCapability.HIGH_REASONING,
        },
        context_window=1000000,
        cost_tier=CostTier.FREE,
    )

    mock_gemini = DummyMockAdapter(ProviderType.GEMINI, [model_free])

    scope = ProjectScope(scope_id="proj_test", scope_type=ScopeType.USER_DECLARED_PROJECT, verified=False)

    cred_general = UserCredential(
        id="cred_general",
        user_id="user_1",
        provider=ProviderType.GEMINI,
        friendly_name="General Key",
        encrypted_api_key="enc_key_1",
        masked_key="key_1...",
        project_scope=scope,
        cost_tier=CredentialTier.FREE_TIER,
    )

    cred_scanner = UserCredential(
        id="cred_scanner_dedicated",
        user_id="user_1",
        provider=ProviderType.GEMINI,
        friendly_name="ATS Scanner Dedicated Key",
        encrypted_api_key="enc_key_2",
        masked_key="key_2...",
        project_scope=scope,
        cost_tier=CredentialTier.FREE_TIER,
    )

    # User explicitly prefers cred_scanner_dedicated via the alias "ats_scanner"
    profile = UserAIProfile(
        user_id="user_1",
        cost_policy=CostPolicy.FREE_ONLY,
        task_routing={"ats_scanner": "cred_scanner_dedicated"},
        credentials=[cred_general, cred_scanner],
    )

    req = ExecutionRequest(
        task=AITaskType.ATS_SCAN_ANALYSIS,
        user_id="user_1",
        prompt="Scan resume",
    )

    candidates = router.resolve_candidates(
        request=req,
        profile=profile,
        registered_adapters={ProviderType.GEMINI: mock_gemini},
    )

    assert len(candidates) == 2
    # The preferred credential must be first and in Tier 0 (< 10000)
    assert candidates[0].credential_id == "cred_scanner_dedicated"
    assert candidates[0].priority < 1000  # Base tier 0 + model priority
    # Sibling credential follows in Tier 2 (10000+)
    assert candidates[1].credential_id == "cred_general"
    assert candidates[1].priority >= 10000


# ---------------------------------------------------------------------------
# Test 7: Unaffected Existing Tasks & Invalid Task Handling
# ---------------------------------------------------------------------------
def test_existing_tasks_unaffected_and_invalid_task_behavior():
    """Adding ATS_SCAN_ANALYSIS must not mutate existing task requirements or normalizers."""
    # Existing tasks remain intact
    assert AITaskType.RESUME_TAILORING in TASK_REQUIREMENTS_MAP
    assert AITaskType.COVER_LETTER_GEN in TASK_REQUIREMENTS_MAP
    assert AITaskType.QA_COPILOT in TASK_REQUIREMENTS_MAP
    assert AITaskType.JOB_ANALYSIS in TASK_REQUIREMENTS_MAP

    # Normalization of existing tasks
    assert normalize_task_key("resume_generation") == "resume_tailoring"
    assert normalize_task_key("cover_letter_generation") == "cover_letter_gen"
    assert normalize_task_key("qa_copilot") == "qa_copilot"

    # Invalid / unrecognized task returns raw input without crash
    assert normalize_task_key("unsupported_custom_task_xyz") == "unsupported_custom_task_xyz"
    assert normalize_task_key(None) == ""
    assert get_task_aliases(None) == []
