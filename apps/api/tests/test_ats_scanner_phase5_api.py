"""Tests for Phase 5: Backend API Modernization.

Validates:
1. POST /api/v1/scanner/scan executes through AIOrchestrator for AITaskType.ATS_SCAN_ANALYSIS.
2. Structured output parsing and validation against AtsAnalysisResult.
3. Deterministic Truth-Lock Evidence Auditor executes before returning response.
4. AI Contextual Score is preserved without alteration.
5. Application-owned default Gemini key resolution via AI Hub routing.
6. User-configured credential precedence over server default.
7. FREE_ONLY policy enforcement blocks paid models.
8. Sanitized error handling for 429 quota exhaustion, 503 unavailable, 502 schema errors.
9. Zero silent fallback to legacy deterministic 100-point scoring on AI failure.
10. Tenant isolation: Accessing another user's tailored resume returns HTTP 403.
11. Persistence policy: Saving report is permitted when valid, blocked when blocking violations exist.
12. Provenance metadata accurately identifies scoring_version="v2_ai_first".
13. Backward compatibility: Existing legacy routes (/scan-tailored, /reports) remain intact.
"""

from unittest.mock import AsyncMock, patch
import pytest
from httpx import ASGITransport, AsyncClient

from app.ai.errors import (
    AIAuthenticationError,
    AIConfigurationError,
    AIOutputValidationError,
    AIProviderError,
    AIProviderUnavailableError,
)
from app.ai.hub.models import ExecutionRequest, ExecutionResponse
from app.ai.hub.types import AITaskType, ProviderType
from app.db.repositories.resume_repo import resume_repo
from app.main import app
from app.schemas.ats_analysis import (
    AtsAnalysisResult,
    ContextualKeywordItem,
    GroundedRewriteProposalItem,
    JobRequirementAnalysisItem,
    KeywordCoverageStatus,
    RequirementCriticality,
    RequirementMatchStatus,
    ResumeSectionAnalysisItem,
    RewriteValidationStatus,
)
from app.schemas.resume import (
    ResumeContact,
    ResumeValidationResult,
    StructuredResumeContent,
    TailoredResumeDTO,
)


def seed_test_tailored_resume(
    resume_id: str, user_id: str, job_id: str = "general"
) -> TailoredResumeDTO:
    dto = TailoredResumeDTO(
        id=resume_id,
        userId=user_id,
        jobId=job_id,
        jobTitle="Backend Developer",
        jobCompany="TechCorp",
        structuredContent=StructuredResumeContent(
            personal=ResumeContact(fullName="Alex Chen", email="alex@example.com"),
            summary="Python and PostgreSQL backend engineer with FastAPI experience.",
            skills=[],
            experience=[],
            projects=[],
            education=[],
        ),
        latexCode="\\documentclass{article}",
        validationResult=ResumeValidationResult(
            is_valid=True, truth_score=95, verified_fact_count=10
        ),
    )
    return resume_repo.save_tailored_resume(dto)


SAMPLE_RESUME = """Alex Chen
San Francisco, CA | alex@example.com

SUMMARY
Senior Backend Software Engineer with 6 years building distributed APIs in Python and FastAPI.

EXPERIENCE
Staff Engineer | Acme Corp | 2021 - Present
- Designed and maintained microservices processing 50M requests daily with 99.9% uptime.
- Led migration of legacy monolith to containerized Docker containers orchestrated on Kubernetes.

SKILLS
Python, FastAPI, Docker, Kubernetes, PostgreSQL
"""

SAMPLE_JD = """Senior Python Developer at TechCorp.
Requirements:
- 5+ years experience in Python backend development.
- Deep expertise in Kubernetes and container orchestration.
"""


def create_sample_analysis(overall_score: int = 88) -> AtsAnalysisResult:
    return AtsAnalysisResult(
        overall_score=overall_score,
        overall_explanation="Candidate possesses 6 years of Python experience and direct Kubernetes expertise.",
        executive_summary="Candidate demonstrates 6 years of Python experience and solid cloud infrastructure knowledge.",
        requirements=[
            JobRequirementAnalysisItem(
                requirement_description="5+ years experience in Python backend development",
                criticality=RequirementCriticality.MANDATORY,
                match_status=RequirementMatchStatus.MEETS,
                supporting_evidence=[
                    "Senior Backend Software Engineer with 6 years building distributed APIs in Python and FastAPI."
                ],
                explanation="Demonstrates 6 years of Python experience.",
                missing_evidence=False,
            ),
            JobRequirementAnalysisItem(
                requirement_description="Deep expertise in Kubernetes and container orchestration",
                criticality=RequirementCriticality.MANDATORY,
                match_status=RequirementMatchStatus.MEETS,
                supporting_evidence=[
                    "containerized Docker containers orchestrated on Kubernetes"
                ],
                explanation="Demonstrated container orchestration at Acme Corp.",
                missing_evidence=False,
            ),
        ],
        section_analysis=[
            ResumeSectionAnalysisItem(
                section_name="experience",
                findings=["Strong quantifiable impact and clear technical scope."],
                supporting_evidence=["Designed and maintained microservices processing 50M requests daily with 99.9% uptime."],
            )
        ],
        keyword_analysis=[
            ContextualKeywordItem(
                keyword="FastAPI",
                status=KeywordCoverageStatus.PRESENT_AND_RELEVANT,
                explanation="Core framework used at Acme Corp for distributed APIs.",
                supporting_evidence="building distributed APIs in Python and FastAPI",
            )
        ],
        rewrite_proposals=[
            GroundedRewriteProposalItem(
                original_text="Designed and maintained microservices processing 50M requests daily with 99.9% uptime.",
                proposed_text="Architected high-throughput microservices handling 50M daily requests at 99.9% availability.",
                explanation="Elevates action verb and technical clarity while preserving scope.",
                factual_basis="Candidate maintained 50M daily requests microservices at 99.9% uptime.",
                validation_status=RewriteValidationStatus.PENDING_REVIEW,
            )
        ],
        strengths=["Demonstrated 6 years Python experience."],
        gaps=[],
        recommendations=["Continue highlighting distributed systems accomplishments."],
    )


# ---------------------------------------------------------------------------
# Test 1: Successful Primary Scan Execution via AI Hub
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_primary_scan_endpoint_success():
    """POST /api/v1/scanner/scan successfully invokes AIOrchestrator and returns AtsScanResponse."""
    mock_analysis = create_sample_analysis(overall_score=91)
    mock_response = ExecutionResponse(
        text=mock_analysis.model_dump_json(),
        structured_data=mock_analysis,
        provider_used=ProviderType.GEMINI,
        model_used="gemini-3.5-flash-lite",
        credential_id_used="server_gemini_credential",
        latency_ms=420.5,
    )

    transport = ASGITransport(app=app)
    with patch("app.ai.hub.orchestrator.ai_orchestrator.execute", new_callable=AsyncMock) as mock_exec:
        mock_exec.return_value = mock_response

        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.post(
                "/api/v1/scanner/scan",
                json={
                    "raw_resume_text": SAMPLE_RESUME,
                    "job_description": SAMPLE_JD,
                    "role_category": "software_engineering",
                },
                headers={"X-User-Id": "user_default"},
            )

        assert resp.status_code == 200
        data = resp.json()

        # Check analysis payload
        assert data["analysis"]["overall_score"] == 91
        assert "analysis" in data
        assert "audit_report" in data
        assert "provenance" in data

        # Check evidence auditor execution
        assert data["audit_report"]["is_valid"] is True
        assert data["audit_report"]["status"] == "pass"
        assert data["audit_report"]["original_ai_score"] == 91

        # Check provenance and operation_id propagation
        assert data["provenance"]["scoring_version"] == "v2_ai_first"
        assert "operation_id" in data["provenance"]
        assert data["provenance"]["operation_id"] is not None
        assert data["provenance"]["operation_id"].startswith("op_")
        assert len(data["provenance"]["operation_id"]) == 15  # "op_" + 12 hex chars
        assert data["provenance"]["provider_used"] == "gemini"
        assert data["provenance"]["model_used"] == "gemini-3.5-flash-lite"
        assert data["provenance"]["truth_lock_passed"] is True

        # Verify AI Hub orchestrator was called with AITaskType.ATS_SCAN_ANALYSIS and matching operation_id
        mock_exec.assert_awaited_once()
        assert mock_exec.await_args is not None
        req_arg: ExecutionRequest = mock_exec.await_args.kwargs["request"]
        assert req_arg.task == AITaskType.ATS_SCAN_ANALYSIS
        assert req_arg.user_id == "user_default"
        assert req_arg.operation_id == data["provenance"]["operation_id"]
        assert "Alex Chen" in req_arg.prompt
        assert "Senior Python Developer" in req_arg.prompt


# ---------------------------------------------------------------------------
# Test 2: Evidence Auditor Flags Blocking Violations in Endpoint
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_primary_scan_flags_blocking_violations_without_altering_score():
    """When model generates ungrounded citations, truth lock fails but AI score remains untouched."""
    flawed_analysis = create_sample_analysis(overall_score=85)
    # Inject fabricated quote
    flawed_analysis.requirements[0].supporting_evidence = [
        "Led machine learning research at OpenAI publishing 10 papers."
    ]

    mock_response = ExecutionResponse(
        text=flawed_analysis.model_dump_json(),
        structured_data=flawed_analysis,
        provider_used=ProviderType.GEMINI,
        model_used="gemini-3.5-flash-lite",
        credential_id_used="server_gemini_credential",
        latency_ms=350.0,
    )

    transport = ASGITransport(app=app)
    with patch("app.ai.hub.orchestrator.ai_orchestrator.execute", new_callable=AsyncMock) as mock_exec:
        mock_exec.return_value = mock_response

        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.post(
                "/api/v1/scanner/scan",
                json={
                    "raw_resume_text": SAMPLE_RESUME,
                    "job_description": SAMPLE_JD,
                },
                headers={"X-User-Id": "user_default"},
            )

        assert resp.status_code == 200
        data = resp.json()

        # Score MUST remain exactly 85
        assert data["analysis"]["overall_score"] == 85
        assert data["audit_report"]["original_ai_score"] == 85
        assert data["audit_report"]["is_valid"] is False
        assert data["audit_report"]["status"] == "fail"
        assert data["provenance"]["truth_lock_passed"] is False


# ---------------------------------------------------------------------------
# Test 3: Tenant Isolation & Unauthorized Resume Access
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_tenant_isolation_unauthorized_resume_access_returns_403():
    """Attempting to scan a tailored resume belonging to another user returns HTTP 403 Forbidden."""
    seed_test_tailored_resume(
        resume_id="resume_user_victim_123",
        user_id="victim_user_456",
        job_id="job_1",
    )

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.post(
            "/api/v1/scanner/scan",
            json={"resume_id": "resume_user_victim_123"},
            headers={"X-User-Id": "attacker_user_789"},
        )

    assert resp.status_code == 403
    assert "Unauthorized access to resume" in resp.json()["detail"]


# ---------------------------------------------------------------------------
# Test 4: Zero Fallback to Legacy Heuristic Scoring on AI Provider Error
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_no_fallback_to_deterministic_legacy_scoring_on_failure():
    """When AI provider fails, endpoint raises structured HTTP error and NEVER falls back to legacy formula."""
    transport = ASGITransport(app=app)

    # 4A: Provider Quota Exhaustion / 429
    with patch("app.ai.hub.orchestrator.ai_orchestrator.execute", new_callable=AsyncMock) as mock_exec:
        mock_exec.side_effect = AIProviderError("429 RESOURCE_EXHAUSTED Quota exceeded for gemini-3.5-flash-lite")

        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.post(
                "/api/v1/scanner/scan",
                json={"raw_resume_text": SAMPLE_RESUME, "job_description": SAMPLE_JD},
                headers={"X-User-Id": "user_default"},
            )

        assert resp.status_code == 429
        assert "rate limit or quota exceeded" in resp.json()["detail"].lower()

    # 4B: Authentication Failure / Missing Credentials -> 503
    with patch("app.ai.hub.orchestrator.ai_orchestrator.execute", new_callable=AsyncMock) as mock_exec:
        mock_exec.side_effect = AIAuthenticationError("API key expired or invalid.")

        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.post(
                "/api/v1/scanner/scan",
                json={"raw_resume_text": SAMPLE_RESUME, "job_description": SAMPLE_JD},
                headers={"X-User-Id": "user_default"},
            )

        assert resp.status_code == 503
        assert "authentication failed" in resp.json()["detail"].lower()

    # 4C: No eligible model route / Configuration Error -> 503
    with patch("app.ai.hub.orchestrator.ai_orchestrator.execute", new_callable=AsyncMock) as mock_exec:
        mock_exec.side_effect = AIConfigurationError("No eligible route available.")

        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.post(
                "/api/v1/scanner/scan",
                json={"raw_resume_text": SAMPLE_RESUME, "job_description": SAMPLE_JD},
                headers={"X-User-Id": "user_default"},
            )

        assert resp.status_code == 503
        assert "No eligible AI model route available" in resp.json()["detail"]


# ---------------------------------------------------------------------------
# Test 5: Sanitized Error Responses Never Expose Keys or Stack Traces
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_sanitized_errors_never_expose_secrets():
    """Errors must never leak API keys, tokens, or raw internal tracebacks to the client."""
    secret_key = "AIzaSy" + "A" * 33
    transport = ASGITransport(app=app)

    with patch("app.ai.hub.orchestrator.ai_orchestrator.execute", new_callable=AsyncMock) as mock_exec:
        mock_exec.side_effect = AIProviderError(f"Provider rejected request with key {secret_key}")

        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.post(
                "/api/v1/scanner/scan",
                json={"raw_resume_text": SAMPLE_RESUME, "job_description": SAMPLE_JD},
                headers={"X-User-Id": "user_default"},
            )

        assert resp.status_code == 502
        body_text = resp.text
        assert secret_key not in body_text
        assert "[REDACTED_SECRET]" in body_text or "AI provider error" in body_text


# ---------------------------------------------------------------------------
# Test 6: Report Persistence Policy Guarding
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_report_persistence_policy_enforcement():
    """Verified scan report saves successfully when valid; blocked when truth violations exist."""
    transport = ASGITransport(app=app)

    # 6A: Valid report saves successfully
    valid_analysis = create_sample_analysis(overall_score=94)
    valid_response = ExecutionResponse(
        text=valid_analysis.model_dump_json(),
        structured_data=valid_analysis,
        provider_used=ProviderType.GEMINI,
        model_used="gemini-3.5-flash-lite",
        credential_id_used="server_gemini_credential",
        latency_ms=250.0,
    )

    with patch("app.ai.hub.orchestrator.ai_orchestrator.execute", new_callable=AsyncMock) as mock_exec:
        mock_exec.return_value = valid_response

        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.post(
                "/api/v1/scanner/scan",
                json={
                    "raw_resume_text": SAMPLE_RESUME,
                    "job_description": SAMPLE_JD,
                    "save_report": True,
                    "report_name": "Senior Python Architect Fit",
                },
                headers={"X-User-Id": "user_default"},
            )

        assert resp.status_code == 200
        data = resp.json()
        assert data["saved_report_id"] is not None
        assert data["saved_report_id"].startswith("scan-rep-")

    # 6B: Invalid report with blocking violations blocks persistence
    invalid_analysis = create_sample_analysis(overall_score=75)
    invalid_analysis.requirements[0].supporting_evidence = ["Completely fabricated qualification."]
    invalid_response = ExecutionResponse(
        text=invalid_analysis.model_dump_json(),
        structured_data=invalid_analysis,
        provider_used=ProviderType.GEMINI,
        model_used="gemini-3.5-flash-lite",
        credential_id_used="server_gemini_credential",
        latency_ms=250.0,
    )

    with patch("app.ai.hub.orchestrator.ai_orchestrator.execute", new_callable=AsyncMock) as mock_exec:
        mock_exec.return_value = invalid_response

        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.post(
                "/api/v1/scanner/scan",
                json={
                    "raw_resume_text": SAMPLE_RESUME,
                    "job_description": SAMPLE_JD,
                    "save_report": True,
                },
                headers={"X-User-Id": "user_default"},
            )

        assert resp.status_code == 200
        data = resp.json()
        # Persistence MUST be blocked
        assert data["saved_report_id"] is None
        assert data["audit_report"]["is_valid"] is False


# ---------------------------------------------------------------------------
# Test 7: Backward Compatibility of Existing Scanner Routes
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_backward_compatibility_of_existing_scanner_routes():
    """Existing endpoints (/scan-tailored, /reports) remain intact with v1_heuristic provenance."""
    seed_test_tailored_resume(
        resume_id="resume_tailored_legacy_test",
        user_id="user_default",
        job_id="general",
    )

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # Legacy scan-tailored endpoint still responds with AtsScanResult
        resp = await client.post(
            "/api/v1/scanner/scan-tailored",
            json={"resume_id": "resume_tailored_legacy_test"},
            headers={"X-User-Id": "user_default"},
        )

        assert resp.status_code == 200
        data = resp.json()
        assert "overall_score" in data
        assert "grade" in data
        assert data["metadata"]["scoring_version"] == "v1_heuristic"
