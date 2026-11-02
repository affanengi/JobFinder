"""Phase 3 Test Suite: Bulk Company Research, Single-Request Gemini Batching, and Evidence Harvesting.

Coverage:
1. Canonical corporate domain resolution & ATS host rejection.
2. Corporate evidence harvesting bounded to max 2 pages and ~4,800 characters per company.
3. Single-request Gemini batch synthesis with XML company boundaries and 0 contact PII.
4. Gemini request accounting: exactly 1 request for uncached batch, 0 requests on full cache hit.
5. Fallback on Gemini provider error or missing company output without 500 crashes.
6. Bulk Company Orchestrator cache partitioning, partial success handling, and idempotency lock.
7. POST /api/v1/companies/bulk-research validation (1-5 limit, auth, duplicate prevention).
"""

import asyncio
from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.schemas.company import BulkCompanyResearchResponse
from app.schemas.company_intelligence import (
    BatchCompanyScamItem,
    BulkCompanyIntelligenceOutput,
    CompanyIntelligenceResult,
    EvaluatedDimensionItem,
)
from app.schemas.opportunity_contact import DiscoveredContact
from app.services.agent_reach_service import AgentReachResult
from app.services.bulk_company_orchestrator import (
    BulkCompanyOrchestrator,
    bulk_company_orchestrator,
)
from app.services.company_intelligence_service import (
    CompanyIntelligenceService,
)
from app.services.corporate_evidence_harvester import (
    CorporateEvidenceHarvester,
    CorporateHarvestResult,
    is_ats_domain,
    resolve_canonical_domain,
)


# ============================================================================
# 1. Domain Resolution & ATS Rejection Tests
# ============================================================================

def test_resolve_canonical_domain_and_ats_rejection():
    """Verify official corporate domain resolution and strict rejection of ATS hosts."""
    # 1. Rejects known ATS domains
    assert is_ats_domain("boards.greenhouse.io") is True
    assert is_ats_domain("jobs.lever.co") is True
    assert is_ats_domain("company.myworkdayjobs.com") is True
    assert is_ats_domain("canonical.com") is False
    assert is_ats_domain("cloudflare.com") is False

    # 2. Canonical mapping resolution
    assert resolve_canonical_domain("Canonical") == "canonical.com"
    assert resolve_canonical_domain("Cloudflare") == "cloudflare.com"
    assert resolve_canonical_domain("Stripe") == "stripe.com"

    # 3. Rejects ATS domain in given_domain or job_url and resolves authentic domain
    assert resolve_canonical_domain("Cloudflare", given_domain="boards.greenhouse.io") == "cloudflare.com"
    assert resolve_canonical_domain("Canonical", job_url="https://jobs.lever.co/canonical/123") == "canonical.com"

    # 4. Unknown company with clean domain
    assert resolve_canonical_domain("Acme Corp", given_domain="acmecorp.io") == "acmecorp.io"


# ============================================================================
# 2. Corporate Evidence Harvesting Tests
# ============================================================================

@pytest.mark.asyncio
async def test_corporate_evidence_harvesting_bounded_pages_and_size():
    """Verify evidence harvesting is strictly capped at 2 pages and <= 4,800 characters."""
    mock_agent_reach = MagicMock()
    # Mock return 3000 chars per page
    long_text = "Corporate products, platform overview, mission statement.\n" * 50
    mock_agent_reach.fetch_page_content = AsyncMock(
        return_value=AgentReachResult(
            ok=True,
            text=long_text,
            url="https://canonical.com",
            title="Canonical",
        )
    )

    harvester = CorporateEvidenceHarvester(service=mock_agent_reach)
    result = await harvester.harvest_company_evidence(
        company_key="canonical",
        company_name="Canonical",
        given_domain="canonical.com",
    )

    # Must be bounded to at most 2 pages
    assert mock_agent_reach.fetch_page_content.call_count <= 2
    assert result.pages_read_count <= 2
    assert result.retrieval_ok is True
    assert len(result.evidence_text) <= 4800
    assert "canonical.com" in result.official_domain


@pytest.mark.asyncio
async def test_corporate_evidence_harvesting_unreachable_server():
    """Verify unreachable target server returns clean failure without crash."""
    mock_agent_reach = MagicMock()
    mock_agent_reach.fetch_page_content = AsyncMock(
        return_value=AgentReachResult(
            ok=False,
            error="Connection timed out",
            url="https://unreachable-co.com",
        )
    )

    harvester = CorporateEvidenceHarvester(service=mock_agent_reach)
    result = await harvester.harvest_company_evidence(
        company_key="unreachable",
        company_name="Unreachable Co",
        given_domain="unreachable-co.com",
    )

    assert result.retrieval_ok is False
    assert result.pages_read_count == 0
    assert result.error is not None
    assert "unreachable" in result.error.lower()


# ============================================================================
# 3. Gemini XML Batch Prompt & Request Accounting Tests
# ============================================================================

def test_build_batch_prompt_xml_boundaries_and_zero_pii():
    """Verify prompt builder encloses evidence in XML tags and excludes personal PII."""
    service = CompanyIntelligenceService()
    evidence_list = [
        CorporateHarvestResult(
            company_key="canonical",
            company_name="Canonical",
            official_domain="canonical.com",
            evidence_text="Canonical publishes Ubuntu and cloud tools.",
            retrieval_ok=True,
        ),
        CorporateHarvestResult(
            company_key="cloudflare",
            company_name="Cloudflare",
            official_domain="cloudflare.com",
            evidence_text="Cloudflare provides CDN, DNS, and edge compute.",
            retrieval_ok=True,
        ),
    ]

    prompt = service._build_batch_prompt(evidence_list)

    assert "<BATCH_REQUEST>" in prompt
    assert "</BATCH_REQUEST>" in prompt
    assert '<COMPANY key="canonical">' in prompt
    assert '<COMPANY key="cloudflare">' in prompt
    assert "<DOMAIN>canonical.com</DOMAIN>" in prompt
    assert "<DOMAIN>cloudflare.com</DOMAIN>" in prompt
    assert "Canonical publishes Ubuntu" in prompt
    assert "Cloudflare provides CDN" in prompt
    # Guarantee no personal contact fields are in the prompt
    assert "email" not in prompt.lower()
    assert "linkedin.com/in" not in prompt


@pytest.mark.asyncio
async def test_single_request_gemini_batch_synthesis_success():
    """Verify exactly 1 Gemini generation request is issued for a batch of uncached companies."""
    mock_ai_provider = MagicMock()

    batch_output = BulkCompanyIntelligenceOutput(
        companies=[
            BatchCompanyScamItem(
                companyKey="canonical",
                companyName="Canonical",
                officialDomain="canonical.com",
                riskTier="NO_OBVIOUS_RED_FLAGS_FOUND",
                overview="Canonical develops Ubuntu and enterprise cloud infrastructure.",
                summary="Legitimate enterprise open-source technology publisher.",
                domainConsistency=EvaluatedDimensionItem(status="PASS", evidence="canonical.com verified", confidence=1.0),
                paymentSolicitations=EvaluatedDimensionItem(status="PASS", evidence="No fees requested", confidence=1.0),
                communicationChannels=EvaluatedDimensionItem(status="PASS", evidence="Corporate systems", confidence=1.0),
                publicScamReports=EvaluatedDimensionItem(status="PASS", evidence="None found", confidence=1.0),
                requisitionConsistency=EvaluatedDimensionItem(status="PASS", evidence="Standard", confidence=1.0),
            ),
            BatchCompanyScamItem(
                companyKey="cloudflare",
                companyName="Cloudflare",
                officialDomain="cloudflare.com",
                riskTier="NO_OBVIOUS_RED_FLAGS_FOUND",
                overview="Cloudflare provides global CDN, cybersecurity, and edge network infrastructure.",
                summary="Verified global cloud security and connectivity provider.",
                domainConsistency=EvaluatedDimensionItem(status="PASS", evidence="cloudflare.com verified", confidence=1.0),
                paymentSolicitations=EvaluatedDimensionItem(status="PASS", evidence="No fees requested", confidence=1.0),
                communicationChannels=EvaluatedDimensionItem(status="PASS", evidence="Corporate systems", confidence=1.0),
                publicScamReports=EvaluatedDimensionItem(status="PASS", evidence="None found", confidence=1.0),
                requisitionConsistency=EvaluatedDimensionItem(status="PASS", evidence="Standard", confidence=1.0),
            ),
        ]
    )

    mock_ai_provider.generate_structured = AsyncMock(return_value=batch_output)

    service = CompanyIntelligenceService(ai_provider=mock_ai_provider)
    evidence_list = [
        CorporateHarvestResult(company_key="canonical", company_name="Canonical", official_domain="canonical.com", evidence_text="Ubuntu", retrieval_ok=True),
        CorporateHarvestResult(company_key="cloudflare", company_name="Cloudflare", official_domain="cloudflare.com", evidence_text="CDN", retrieval_ok=True),
    ]

    with patch("app.services.company_intelligence_service.resolve_company_analysis_api_key", return_value="test-key"):
        results_map, requests_issued = await service.synthesize_bulk_company_intelligence(
            user_id="user_test_1",
            evidence_list=evidence_list,
        )

    # Crucial accounting requirement: Exactly 1 request issued for both companies
    assert requests_issued == 1
    assert mock_ai_provider.generate_structured.call_count == 1
    assert "canonical" in results_map
    assert "cloudflare" in results_map
    assert results_map["canonical"].riskTier == "NO_OBVIOUS_RED_FLAGS_FOUND"
    assert "Ubuntu" in results_map["canonical"].overview


@pytest.mark.asyncio
async def test_gemini_batch_synthesis_fallback_on_provider_error():
    """Verify graceful deterministic fallback without unhandled 500 when Gemini provider fails."""
    mock_ai_provider = MagicMock()
    mock_ai_provider.generate_structured = AsyncMock(side_effect=RuntimeError("ResourceExhausted: 429 Quota Exceeded"))

    service = CompanyIntelligenceService(ai_provider=mock_ai_provider)
    evidence_list = [
        CorporateHarvestResult(company_key="stripe", company_name="Stripe", official_domain="stripe.com", evidence_text="Payments", retrieval_ok=True),
    ]

    with patch("app.services.company_intelligence_service.resolve_company_analysis_api_key", return_value="test-key"):
        results_map, requests_issued = await service.synthesize_bulk_company_intelligence(
            user_id="user_test_1",
            evidence_list=evidence_list,
        )

    # Bounded retry policy preserves request count and degrades to deterministic evaluation
    assert requests_issued == 1
    assert "stripe" in results_map
    assert results_map["stripe"].riskTier in ("NEEDS_VERIFICATION", "SIGNIFICANT_RED_FLAGS")
    assert "quota exhausted" in results_map["stripe"].summary


# ============================================================================
# 4. Bulk Company Orchestrator Tests
# ============================================================================

@pytest.mark.asyncio
async def test_orchestrator_cache_hit_issues_zero_gemini_requests():
    """Verify that when requested companies are validly cached, 0 Gemini requests are issued."""
    orchestrator = BulkCompanyOrchestrator()

    mock_cached_intel = CompanyIntelligenceResult(
        id="comp-intel-canonical-1",
        userId="user_test_1",
        opportunityId="canonical-job-1",
        companyName="Canonical",
        officialDomain="canonical.com",
        careersUrl="https://canonical.com/careers",
        riskTier="NO_OBVIOUS_RED_FLAGS_FOUND",
        overview="Canonical publishes Ubuntu.",
        summary="Verified enterprise employer.",
        evaluatedDimensions={},
        ttlExpiresAt=(datetime.now(UTC) + timedelta(days=7)).isoformat(),
    )

    orchestrator.intel_repo = MagicMock()
    orchestrator.intel_repo.get_intelligence.return_value = mock_cached_intel
    orchestrator.contact_repo = MagicMock()
    orchestrator.contact_repo.list_contacts_for_opportunity.return_value = [
        DiscoveredContact(
            id="contact-1",
            userId="user_test_1",
            opportunityId="canonical-job-1",
            companyName="Canonical",
            fullName="Celine Chong",
            roleTitle="Talent Acquisition Project Manager",
            linkedinUrl="https://linkedin.com/in/celinechong",
            contactabilityStatus="PROFILE_ONLY",
            roleEvidenceStatus="CURRENT_CONFIRMED",
        )
    ]
    orchestrator.intelligence_service = MagicMock()
    orchestrator.intelligence_service.synthesize_bulk_company_intelligence = AsyncMock()

    response: BulkCompanyResearchResponse = await orchestrator.orchestrate_bulk_research(
        user_id="user_test_1",
        company_keys=["canonical"],
        force_refresh=False,
    )

    assert response.status == "COMPLETED"
    assert response.metrics.cachedCount == 1
    assert response.metrics.liveHarvestedCount == 0
    # ZERO Gemini calls issued for full cache hit
    assert response.metrics.geminiRequestsIssued == 0
    orchestrator.intelligence_service.synthesize_bulk_company_intelligence.assert_not_called()
    assert len(response.results) == 1
    assert response.results[0].companyKey == "canonical"
    assert len(response.results[0].contacts) == 1


@pytest.mark.asyncio
async def test_orchestrator_mixed_batch_cached_and_uncached():
    """Verify batch with 1 cached and 1 uncached company issues exactly 1 Gemini call for uncached only."""
    orchestrator = BulkCompanyOrchestrator()

    now = datetime.now(UTC)
    mock_cached_intel = CompanyIntelligenceResult(
        id="comp-intel-canonical-1",
        userId="user_test_1",
        opportunityId="canonical-job-1",
        companyName="Canonical",
        officialDomain="canonical.com",
        careersUrl="https://canonical.com/careers",
        riskTier="NO_OBVIOUS_RED_FLAGS_FOUND",
        summary="Verified employer",
        evaluatedDimensions={},
        ttlExpiresAt=(now + timedelta(days=7)).isoformat(),
    )

    # Cache hit for canonical, cache miss for cloudflare
    def mock_resolve_meta(key):
        if key == "canonical":
            return "canonical", "Canonical", "canonical.com", "canonical-job-1", "https://canonical.com/careers"
        return "cloudflare", "Cloudflare", "cloudflare.com", "cloudflare-job-1", "https://cloudflare.com/careers"

    orchestrator._resolve_company_meta = mock_resolve_meta

    def mock_get_intel(user_id, opportunity_id):
        if "canonical" in opportunity_id.lower():
            return mock_cached_intel
        return None

    orchestrator.intel_repo = MagicMock()
    orchestrator.intel_repo.get_intelligence.side_effect = mock_get_intel
    orchestrator.contact_repo = MagicMock()
    orchestrator.contact_repo.list_contacts_for_opportunity.return_value = []

    # Mock evidence harvester for cloudflare
    orchestrator.evidence_harvester = MagicMock()
    orchestrator.evidence_harvester.harvest_company_evidence = AsyncMock(
        return_value=CorporateHarvestResult(
            company_key="cloudflare",
            company_name="Cloudflare",
            official_domain="cloudflare.com",
            evidence_text="Cloudflare edge network",
            retrieval_ok=True,
        )
    )

    # Mock contact discovery for cloudflare
    mock_discovery_resp = MagicMock()
    mock_discovery_resp.contacts = []
    orchestrator.contact_service = MagicMock()
    orchestrator.contact_service.discover_contacts = AsyncMock(return_value=mock_discovery_resp)

    # Mock Gemini batch call
    orchestrator.intelligence_service = MagicMock()
    orchestrator.intelligence_service.synthesize_bulk_company_intelligence = AsyncMock(
        return_value=(
            {
                "cloudflare": BatchCompanyScamItem(
                    companyKey="cloudflare",
                    companyName="Cloudflare",
                    officialDomain="cloudflare.com",
                    riskTier="NO_OBVIOUS_RED_FLAGS_FOUND",
                    overview="Cloudflare edge network security",
                    summary="Verified cloud vendor",
                    domainConsistency=EvaluatedDimensionItem(status="PASS", evidence="verified", confidence=1.0),
                    paymentSolicitations=EvaluatedDimensionItem(status="PASS", evidence="none", confidence=1.0),
                    communicationChannels=EvaluatedDimensionItem(status="PASS", evidence="corporate", confidence=1.0),
                    publicScamReports=EvaluatedDimensionItem(status="PASS", evidence="none", confidence=1.0),
                    requisitionConsistency=EvaluatedDimensionItem(status="PASS", evidence="standard", confidence=1.0),
                )
            },
            1,  # 1 request issued
        )
    )

    response = await orchestrator.orchestrate_bulk_research(
        user_id="user_test_1",
        company_keys=["canonical", "cloudflare"],
        force_refresh=False,
    )

    assert response.status == "COMPLETED"
    assert response.metrics.totalRequested == 2
    assert response.metrics.cachedCount == 1
    assert response.metrics.liveHarvestedCount == 1
    assert response.metrics.geminiRequestsIssued == 1
    assert len(response.results) == 2


@pytest.mark.asyncio
async def test_orchestrator_in_memory_idempotency_lock():
    """Verify concurrent double-clicks by the same user return HTTP 409 Conflict."""
    orchestrator = BulkCompanyOrchestrator()
    # Manually hold lock for user_1
    await orchestrator._acquire_user_lock("user_1")

    # Second concurrent call for user_1 must be rejected
    with pytest.raises(Exception) as exc_info:
        await orchestrator._acquire_user_lock("user_1")

    assert "409" in str(exc_info.value) or exc_info.value.status_code == 409

    # Another user can proceed concurrently
    await orchestrator._acquire_user_lock("user_2")
    assert "user_2" in orchestrator._active_user_locks

    # Release locks
    await orchestrator._release_user_lock("user_1")
    await orchestrator._release_user_lock("user_2")


# ============================================================================
# 5. FastAPI Route End-to-End Validation
# ============================================================================

def test_api_bulk_research_validation_and_bounds():
    """Verify API endpoint validation, item bounds, and orchestrator delegation."""
    client = TestClient(app)

    # 1. Unauthenticated request returns 401 when dependency overrides are cleared
    overrides_backup = dict(app.dependency_overrides)
    try:
        app.dependency_overrides.clear()
        resp_unauth = client.post(
            "/api/v1/companies/bulk-research",
            json={"companyKeys": ["canonical"]},
        )
        assert resp_unauth.status_code == 401
    finally:
        app.dependency_overrides.update(overrides_backup)

    # 2. Over 5 companies rejected by schema (422)
    resp_too_many = client.post(
        "/api/v1/companies/bulk-research",
        json={"companyKeys": ["c1", "c2", "c3", "c4", "c5", "c6"]},
        headers={"X-User-Id": "user_api_test"},
    )
    assert resp_too_many.status_code == 422

    # 3. Empty keys rejected by schema (422)
    resp_empty = client.post(
        "/api/v1/companies/bulk-research",
        json={"companyKeys": []},
        headers={"X-User-Id": "user_api_test"},
    )
    assert resp_empty.status_code == 422

    # 4. Valid request delegates to orchestrator
    mock_resp = BulkCompanyResearchResponse(
        operationId="bulk_mock_1",
        status="COMPLETED",
        metrics={
            "totalRequested": 1,
            "cachedCount": 1,
            "liveHarvestedCount": 0,
            "geminiRequestsIssued": 0,
            "totalContactsDiscovered": 0,
            "contactsWithDirectEmail": 0,
            "contactsWithProfileOnly": 0,
            "durationSeconds": 0.5,
        },
        results=[],
    )
    with patch(
        "app.api.v1.companies.bulk_company_orchestrator.orchestrate_bulk_research",
        new_callable=AsyncMock,
        return_value=mock_resp,
    ) as mock_orch:
        resp_valid = client.post(
            "/api/v1/companies/bulk-research",
            json={"companyKeys": ["canonical"]},
            headers={"X-User-Id": "user_api_test"},
        )
        assert resp_valid.status_code == 200
        data = resp_valid.json()
        assert data["operationId"] == "bulk_mock_1"
        assert data["status"] == "COMPLETED"
        mock_orch.assert_called_once_with(
            user_id="user_api_test",
            company_keys=["canonical"],
            force_refresh=False,
        )

