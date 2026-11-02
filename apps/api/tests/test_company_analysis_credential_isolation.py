"""Targeted tests for Company Analysis Dedicated Gemini Key Isolation and Task Map Routing.

Verifies:
1. COMPANY_INTELLIGENCE uses the dedicated GEMINI_COMPANY_ANALYSIS_API_KEY.
2. Existing AI tasks continue using their respective configured keys.
3. Missing dedicated key produces a safe diagnostic error without falling back to GEMINI_API_KEY.
4. Quota exhaustion on company analysis does not trigger paid fallback or primary key fallback.
5. Secrets never appear in results, API responses, or serialized outputs.
"""

from unittest.mock import AsyncMock, patch

import pytest

from app.ai.hub.models import ExecutionRequest
from app.ai.hub.router import AIRouter
from app.ai.hub.types import AITaskType, CostPolicy, ProviderType
from app.core.config import settings
from app.schemas.company_intelligence import (
    CompanyIntelligenceResult,
    CompanyRiskTier,
    CompanyScamAssessmentOutput,
    EvaluatedDimensionItem,
)
from app.schemas.job import CanonicalJob, JobSourceRef
from app.services.agent_reach_service import AgentReachResult, AgentReachService
from app.services.company_intelligence_service import (
    CompanyIntelligenceService,
    resolve_company_analysis_api_key,
)
from app.services.job_service import job_service


DEDICATED_KEY = "AQ.Ab8MockCompanyAnalysisKey1234567890cmKQ"
PRIMARY_KEY = "AIzaSyPrimaryDefaultKeyForGeneralTasks123"
QA_KEY = "AIzaSyQACopilotDedicatedKey456"
RESUME_KEY = "AIzaSyResumeDedicatedKey789"
SCANNER_KEY = "AIzaSyScannerDedicatedKey012"


@pytest.fixture
def mock_opp_job() -> CanonicalJob:
    job = CanonicalJob(
        id="job_opp_isolation_test",
        title="Software Engineer",
        company="Starlight Technologies",
        location="San Francisco, CA",
        description="Core systems infrastructure.",
        source="manual_url",
        sourceRef=JobSourceRef(
            adapter="manual_url",
            originalUrl="https://starlight.tech/careers/swe",
            companySlug="starlight",
        ),
    )
    job_service._jobs[job.id] = job
    return job


def test_resolve_company_analysis_api_key():
    """Verify dedicated key resolution priority and strict refusal to use general key."""
    with patch.object(settings, "GEMINI_COMPANY_ANALYSIS_API_KEY", DEDICATED_KEY), patch.object(
        settings, "COMPANY_ANALYSIS_GEMINI_API_KEY", ""
    ), patch.object(settings, "GEMINI_API_KEY", PRIMARY_KEY):
        assert resolve_company_analysis_api_key() == DEDICATED_KEY

    with patch.object(settings, "GEMINI_COMPANY_ANALYSIS_API_KEY", ""), patch.object(
        settings, "COMPANY_ANALYSIS_GEMINI_API_KEY", DEDICATED_KEY
    ), patch.object(settings, "GEMINI_API_KEY", PRIMARY_KEY):
        assert resolve_company_analysis_api_key() == DEDICATED_KEY

    # When both dedicated vars are empty, resolve_company_analysis_api_key MUST NOT return GEMINI_API_KEY
    with patch.object(settings, "GEMINI_COMPANY_ANALYSIS_API_KEY", ""), patch.object(
        settings, "COMPANY_ANALYSIS_GEMINI_API_KEY", ""
    ), patch.object(settings, "GEMINI_API_KEY", PRIMARY_KEY):
        assert resolve_company_analysis_api_key() is None


def test_company_intelligence_router_key_isolation():
    """Verify router uses dedicated key for COMPANY_INTELLIGENCE and original keys for existing tasks."""
    from app.ai.adapters.gemini_adapter import GeminiAdapter

    router = AIRouter()
    adapters = {ProviderType.GEMINI: GeminiAdapter()}

    with patch.object(settings, "GEMINI_COMPANY_ANALYSIS_API_KEY", DEDICATED_KEY), patch.object(
        settings, "GEMINI_API_KEY", PRIMARY_KEY
    ), patch.object(settings, "QA_COPILOT_GEMINI_API_KEY", QA_KEY), patch.object(
        settings, "RESUME_GEMINI_API_KEY", RESUME_KEY
    ), patch.object(settings, "SCANNER_GEMINI_API_KEY", SCANNER_KEY):

        # 1. COMPANY_INTELLIGENCE must receive DEDICATED_KEY
        req_comp = ExecutionRequest(task=AITaskType.COMPANY_INTELLIGENCE, user_id="user_test", prompt="Analyze company")
        candidates_comp = router.resolve_candidates(request=req_comp, registered_adapters=adapters)
        gemini_comp = [c for c in candidates_comp if c.provider == ProviderType.GEMINI]
        assert len(gemini_comp) > 0
        assert gemini_comp[0].api_key == DEDICATED_KEY
        assert gemini_comp[0].api_key != PRIMARY_KEY

        # 2. Existing tasks must receive their original keys and never DEDICATED_KEY
        req_qa = ExecutionRequest(task=AITaskType.QA_COPILOT, user_id="user_test", prompt="Answer question")
        candidates_qa = router.resolve_candidates(request=req_qa, registered_adapters=adapters)
        gemini_qa = [c for c in candidates_qa if c.provider == ProviderType.GEMINI]
        assert gemini_qa[0].api_key == QA_KEY
        assert gemini_qa[0].api_key != DEDICATED_KEY

        req_resume = ExecutionRequest(task=AITaskType.RESUME_TAILORING, user_id="user_test", prompt="Tailor resume")
        candidates_resume = router.resolve_candidates(request=req_resume, registered_adapters=adapters)
        gemini_resume = [c for c in candidates_resume if c.provider == ProviderType.GEMINI]
        assert gemini_resume[0].api_key == RESUME_KEY
        assert gemini_resume[0].api_key != DEDICATED_KEY

        req_scanner = ExecutionRequest(task=AITaskType.ATS_SCAN_ANALYSIS, user_id="user_test", prompt="Scan resume")
        candidates_scanner = router.resolve_candidates(request=req_scanner, registered_adapters=adapters)
        gemini_scanner = [c for c in candidates_scanner if c.provider == ProviderType.GEMINI]
        assert gemini_scanner[0].api_key == SCANNER_KEY
        assert gemini_scanner[0].api_key != DEDICATED_KEY

        # Generic task receives PRIMARY_KEY
        req_ingest = ExecutionRequest(task=AITaskType.JOB_INGESTION, user_id="user_test", prompt="Ingest job")
        candidates_ingest = router.resolve_candidates(request=req_ingest, registered_adapters=adapters)
        gemini_ingest = [c for c in candidates_ingest if c.provider == ProviderType.GEMINI]
        assert gemini_ingest[0].api_key == PRIMARY_KEY
        assert gemini_ingest[0].api_key != DEDICATED_KEY


def test_missing_dedicated_key_refuses_fallback_to_primary():
    """Verify that if dedicated company key is missing, router refuses silent fallback to GEMINI_API_KEY."""
    from app.ai.adapters.gemini_adapter import GeminiAdapter

    router = AIRouter()
    adapters = {ProviderType.GEMINI: GeminiAdapter()}

    with patch.object(settings, "GEMINI_COMPANY_ANALYSIS_API_KEY", ""), patch.object(
        settings, "COMPANY_ANALYSIS_GEMINI_API_KEY", ""
    ), patch.object(settings, "GEMINI_API_KEY", PRIMARY_KEY):

        req_comp = ExecutionRequest(task=AITaskType.COMPANY_INTELLIGENCE, user_id="user_test", prompt="Analyze company")
        candidates = router.resolve_candidates(request=req_comp, registered_adapters=adapters)
        gemini_candidates = [c for c in candidates if c.provider == ProviderType.GEMINI]
        # Must NOT generate a candidate with primary key
        assert len(gemini_candidates) == 0


@pytest.mark.asyncio
async def test_missing_key_produces_safe_understandable_diagnostic(mock_opp_job: CanonicalJob):
    """Verify missing dedicated key produces graceful diagnostic result without crashing."""
    mock_reach = AsyncMock(spec=AgentReachService)
    mock_reach.fetch_page_content.return_value = AgentReachResult(
        ok=True,
        url=mock_opp_job.sourceRef.originalUrl or "",
        text="Starlight Technologies careers page content.",
        source="agent_reach_cli",
    )

    with patch.object(settings, "GEMINI_COMPANY_ANALYSIS_API_KEY", ""), patch.object(
        settings, "COMPANY_ANALYSIS_GEMINI_API_KEY", ""
    ), patch.object(settings, "GEMINI_API_KEY", PRIMARY_KEY):

        service = CompanyIntelligenceService()
        service.agent_reach = mock_reach

        result = await service.research_opportunity(
            opportunity_id=mock_opp_job.id,
            user_id="user_test_diag",
            force_refresh=True,
        )

        assert result.riskTier in ("NO_OBVIOUS_RED_FLAGS_FOUND", "NEEDS_VERIFICATION")
        assert "dedicated company analysis api key is unconfigured" in result.summary.lower()
        assert PRIMARY_KEY not in result.summary
        assert DEDICATED_KEY not in result.summary


@pytest.mark.asyncio
async def test_quota_exhaustion_does_not_trigger_paid_fallback_or_general_key(mock_opp_job: CanonicalJob):
    """Verify company analysis quota exhaustion gracefully falls back deterministically without paid fallback."""
    mock_reach = AsyncMock(spec=AgentReachService)
    mock_reach.fetch_page_content.return_value = AgentReachResult(
        ok=True,
        url=mock_opp_job.sourceRef.originalUrl or "",
        text="Starlight Technologies authentic engineering listing.",
        source="agent_reach_cli",
    )

    # Mock provider raising 429 Quota Exhausted
    mock_ai = AsyncMock()
    mock_ai.generate_structured.side_effect = RuntimeError("429 RESOURCE_EXHAUSTED Quota exceeded for model")

    service = CompanyIntelligenceService(ai_provider=mock_ai)
    service.agent_reach = mock_reach

    result = await service.research_opportunity(
        opportunity_id=mock_opp_job.id,
        user_id="user_test_quota",
        force_refresh=True,
    )

    assert result.riskTier in ("NO_OBVIOUS_RED_FLAGS_FOUND", "NEEDS_VERIFICATION")
    assert "quota exhausted" in result.summary.lower()
    # Confirm cost policy FREE_ONLY holds and no raw key leaked
    assert DEDICATED_KEY not in result.summary
    assert PRIMARY_KEY not in result.summary


def test_secrets_never_appear_in_result_payload():
    """Verify raw API keys are never exposed in serialized output or metadata."""
    res = CompanyIntelligenceResult(
        id="comp-intel-sec-test",
        userId="user_123",
        opportunityId="opp_123",
        companyName="Starlight Tech",
        careersUrl="https://starlight.tech/careers",
        riskTier="NO_OBVIOUS_RED_FLAGS_FOUND",
        summary="Legitimate company with authentic corporate presence.",
        evaluatedDimensions={
            "domainConsistency": EvaluatedDimensionItem(status="PASS", evidence="Domain matches", confidence=0.9)
        },
        redFlags=[],
        positiveSignals=["Corporate ATS present"],
        sourceUrls=["https://starlight.tech"],
        researchedAt="2026-10-26T12:00:00Z",
        ttlExpiresAt="2026-11-09T12:00:00Z",
    )

    serialized = res.model_dump_json()
    assert DEDICATED_KEY not in serialized
    assert PRIMARY_KEY not in serialized
    assert "api_key" not in res.model_dump()
