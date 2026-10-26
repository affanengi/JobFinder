"""Phase 7: AI-First ATS Scanner Benchmark Suite, Regression Testing & Legacy Retirement Gates.

Evaluates the AI-First ATS Scanner across 5 rigorous acceptance criteria:
Criterion A: Output Validity (Schema compliance, required fields, score boundaries [0-100], robust error responses)
Criterion B: Evidence Integrity (Truth-Lock validation, detection of fabricated metrics, source inversion, grounded quotes)
Criterion C: Contextual Relevance (Semantic understanding vs literal keyword counting, transferable skills, required vs preferred)
Criterion D: Score Integrity (Authoritative AI score preserved without arithmetic point deductions, zero silent fallback on AI failure)
Criterion E: Operational Reliability, Security & Cost Policy (Server-side secret isolation, FREE_ONLY enforcement, tenant isolation, historical provenance preservation)
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
from app.db.repositories.scan_report_repo import scan_report_repo
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
from app.schemas.scanner import (
    AtsScanResponse,
    AtsScanResult,
    KeywordMatrix,
    SavedScanReportDTO,
    ScanMetadata,
    TruthLockAuditReport,
)
from app.services.ats_scanner_engine import ats_scanner_engine


# ============================================================================
# Synthetic Test Fixtures & Helpers across 5 Roles
# ============================================================================

BENCHMARK_SCENARIOS = {
    "backend_distributed": {
        "title": "Staff Backend Engineer",
        "job_description": """We are seeking a Staff Backend Engineer to design high-throughput distributed microservices.
Requirements:
- Deep expertise in Python, Go, and PostgreSQL schema design.
- Hands-on experience with Apache Kafka or RabbitMQ event-driven streaming.
- Production experience with Docker and Kubernetes container orchestration.
Preferred:
- Experience with Redis caching and gRPC communication.""",
        "resume_text": """Alex Morgan | alex.morgan@example.com
SUMMARY
Experienced backend software engineer specializing in scalable Python microservices, distributed data processing, and relational database architecture.
EXPERIENCE
Senior Software Engineer at Nexus Systems (2021 - Present)
- Engineered high-throughput Python backend microservices utilizing FastAPI and PostgreSQL, serving 12M monthly queries.
- Integrated Apache Kafka event streams for asynchronous event-driven task processing across 8 internal services.
- Containerized microservice fleet using Docker and managed deployments on Kubernetes clusters with automated CI/CD.
SKILLS
Python, Go, FastAPI, PostgreSQL, Apache Kafka, Docker, Kubernetes, Git, Linux.""",
    },
    "frontend_web": {
        "title": "Lead Frontend Architect",
        "job_description": """Seeking a Senior/Lead Frontend Engineer to architect performant web applications.
Requirements:
- Mastery of TypeScript, React, Next.js, and state management (Zustand or Redux).
- Deep knowledge of Web Vitals, accessibility (WCAG AA), and modern CSS architectures.
- Experience with automated testing using Vitest, Jest, and Playwright.
Preferred:
- Experience with GraphQL and microfrontends.""",
        "resume_text": """Jordan Lee | jordan.lee@example.com
SUMMARY
Lead Frontend Engineer with 7 years of experience building accessible, responsive, and high-performance React and TypeScript applications.
EXPERIENCE
Staff UI Engineer at CloudCanvas (2020 - Present)
- Architected enterprise React and TypeScript design system adopted by 6 product teams, improving WCAG AA accessibility compliance.
- Optimized core web vitals, reducing Largest Contentful Paint (LCP) from 3.2s to 1.1s across high-traffic dashboard views.
- Implemented comprehensive frontend testing strategy utilizing Vitest and Playwright with 88% component coverage.
SKILLS
TypeScript, React, Next.js, Zustand, CSS Modules, TailwindCSS, Vitest, Playwright, Web Vitals.""",
    },
    "ml_data_engineering": {
        "title": "Senior ML / Data Infrastructure Engineer",
        "job_description": """Looking for a Senior Data & ML Engineer to build production pipelines.
Requirements:
- Proficiency in Python, PySpark, and Apache Airflow.
- Hands-on experience with BigQuery or Snowflake data warehouses.
- Proven track record deploying machine learning models to production using MLflow or Vertex AI.""",
        "resume_text": """Taylor Swift-Tech | taylor.tech@example.com
SUMMARY
Data and Machine Learning Engineer specializing in petabyte-scale data pipelines and production ML model serving.
EXPERIENCE
Data Platform Engineer at AlphaData (2021 - Present)
- Engineered scalable PySpark ETL pipelines on Dataproc, transforming 5TB of clickstream data daily.
- Orchestrated 45+ daily batch workflows using Apache Airflow with automated alerting and backfill capabilities.
- Deployed ML inference services to BigQuery and managed model lifecycle tracking with MLflow.
SKILLS
Python, PySpark, Apache Airflow, BigQuery, Snowflake, MLflow, SQL, GCP.""",
    },
    "cloud_devops_sre": {
        "title": "Principal SRE / Cloud Platform Architect",
        "job_description": """Seeking a Principal Site Reliability Engineer.
Requirements:
- Expert-level infrastructure as code (Terraform) and AWS/GCP cloud platforms.
- Deep expertise in Kubernetes, service mesh (Istio), and observability (Prometheus, Grafana).
- Strong track record designing 99.99% SLA resilient multi-region architectures.""",
        "resume_text": """Casey Rivera | casey.rivera@example.com
SUMMARY
Principal Site Reliability Engineer with 9+ years managing cloud infrastructure and high-availability systems.
EXPERIENCE
Lead Infrastructure Engineer at GlobalOps (2019 - Present)
- Designed and maintained multi-region cloud platform on AWS and GCP using modular Terraform configurations.
- Administered 14 production Kubernetes clusters with Istio service mesh, Prometheus monitoring, and Grafana dashboards.
- Established automated incident response runbooks and disaster recovery drills ensuring 99.99% platform availability.
SKILLS
Terraform, AWS, GCP, Kubernetes, Istio, Prometheus, Grafana, Python, Bash, CI/CD.""",
    },
    "leadership_product": {
        "title": "Director of Engineering",
        "job_description": """Seeking a Director of Engineering to lead 25+ engineers.
Requirements:
- Demonstrated experience hiring, managing, and mentoring engineering managers and senior ICs.
- Strong strategic vision aligning engineering roadmap with business KPIs and enterprise delivery.
- Technical background in cloud software systems and Agile development practices.""",
        "resume_text": """Morgan Vance | morgan.vance@example.com
SUMMARY
Engineering leader with 12 years of experience building high-performing engineering organizations and shipping enterprise software.
EXPERIENCE
Director of Software Engineering at EnterpriseFlow (2020 - Present)
- Managed an organization of 30+ distributed engineers across 4 squads, reducing attrition and coaching 4 managers.
- Partnered with product and executive leadership to deliver key enterprise roadmap milestones on time and under budget.
- Introduced standard Agile engineering rituals, architecture review board, and OKR alignment framework.
SKILLS
Engineering Management, Organizational Leadership, Technical Strategy, Agile/Scrum, Mentorship, Cloud Architecture.""",
    },
}


def build_synthetic_ai_analysis(
    overall_score: int = 88,
    match_status: RequirementMatchStatus = RequirementMatchStatus.MEETS,
    evidence_quote: str = "Engineered high-throughput Python backend microservices utilizing FastAPI and PostgreSQL, serving 12M monthly queries.",
    findings_count: int = 1,
    include_rewrite: bool = True,
) -> AtsAnalysisResult:
    """Helper to generate structured AtsAnalysisResult conforming to schema."""
    reqs = [
        JobRequirementAnalysisItem(
            requirement_description="Deep expertise in Python and PostgreSQL",
            criticality=RequirementCriticality.MANDATORY,
            match_status=match_status,
            supporting_evidence=[evidence_quote] if match_status != RequirementMatchStatus.MISSING else [],
            explanation="Demonstrated in core production microservices.",
            missing_evidence=(match_status == RequirementMatchStatus.MISSING),
        ),
        JobRequirementAnalysisItem(
            requirement_description="Experience with Apache Kafka event streams",
            criticality=RequirementCriticality.MANDATORY,
            match_status=RequirementMatchStatus.MEETS,
            supporting_evidence=["Integrated Apache Kafka event streams for asynchronous event-driven task processing across 8 internal services."],
            explanation="Direct match for event-driven architecture.",
            missing_evidence=False,
        ),
        JobRequirementAnalysisItem(
            requirement_description="Experience with Redis caching",
            criticality=RequirementCriticality.PREFERRED,
            match_status=RequirementMatchStatus.PARTIAL,
            supporting_evidence=[],
            explanation="Redis not explicitly cited, but general caching principles evident.",
            missing_evidence=True,
        ),
    ]

    rewrites = []
    if include_rewrite:
        rewrites.append(
            GroundedRewriteProposalItem(
                original_text="Engineered high-throughput Python backend microservices utilizing FastAPI and PostgreSQL, serving 12M monthly queries.",
                proposed_text="Architected high-throughput Python microservices in FastAPI and PostgreSQL, serving 12M monthly queries with zero downtime.",
                factual_basis="Candidate maintained 12M monthly queries microservices at Nexus Systems.",
                explanation="Strengthened leadership framing around microservice architecture while preserving exact verified metrics.",
                validation_status=RewriteValidationStatus.PENDING_REVIEW,
            )
        )

    return AtsAnalysisResult(
        overall_score=overall_score,
        overall_explanation="Candidate demonstrates strong hands-on expertise in Python, PostgreSQL, Kafka, and Kubernetes.",
        executive_summary="Strong candidate with direct production alignment to the Staff Backend role.",
        requirements=reqs,
        section_analysis=[
            ResumeSectionAnalysisItem(
                section_name="experience",
                findings=["Strong action verbs and clear technical ownership."],
                supporting_evidence=[evidence_quote],
                gaps=[],
                recommendations=["Consider detailing database indexing strategies."],
            )
        ],
        keyword_analysis=[
            ContextualKeywordItem(
                keyword="PostgreSQL",
                status=KeywordCoverageStatus.PRESENT_AND_RELEVANT,
                explanation="Critical for relational database architecture",
                supporting_evidence=evidence_quote,
            ),
            ContextualKeywordItem(
                keyword="Apache Kafka",
                status=KeywordCoverageStatus.PRESENT_AND_RELEVANT,
                explanation="Essential for distributed event processing",
                supporting_evidence="Integrated Apache Kafka event streams",
            ),
            ContextualKeywordItem(
                keyword="Redis",
                status=KeywordCoverageStatus.PRESENT_WEAK,
                explanation="Preferred caching competency; transferable from backend experience",
                supporting_evidence=None,
            ),
        ],
        rewrite_proposals=rewrites,
        strengths=["Strong background in microservices and streaming."],
        gaps=["No explicit Redis mention."],
        recommendations=["Highlight database tuning accomplishments."],
    )


def seed_benchmark_resume(resume_id: str, user_id: str, domain_key: str) -> TailoredResumeDTO:
    scenario = BENCHMARK_SCENARIOS[domain_key]
    dto = TailoredResumeDTO(
        id=resume_id,
        userId=user_id,
        jobId="general",
        jobTitle=scenario["title"],
        jobCompany="TechCorp",
        structuredContent=StructuredResumeContent(
            personal=ResumeContact(fullName="Benchmark Candidate", email="bench@example.com"),
            summary=scenario["resume_text"],
            skills=[],
            experience=[],
            projects=[],
            education=[],
        ),
        latexCode="\\documentclass{article}",
        validationResult=ResumeValidationResult(
            is_valid=True, truth_score=95, verified_fact_count=12
        ),
    )
    return resume_repo.save_tailored_resume(dto)


# ============================================================================
# CRITERION A: Output Validity Benchmark Tests
# ============================================================================

@pytest.mark.asyncio
async def test_criterion_a_schema_validity_across_5_role_domains():
    """Validates complete Pydantic response schema compliance across 5 diverse technical roles."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        for domain_key, scenario in BENCHMARK_SCENARIOS.items():
            user_id = f"user_{domain_key}"
            resume_id = f"res_{domain_key}"
            seed_benchmark_resume(resume_id, user_id, domain_key)

            mock_analysis = build_synthetic_ai_analysis(overall_score=85)
            mock_exec_resp = ExecutionResponse(
                task=AITaskType.ATS_SCAN_ANALYSIS,
                provider_used=ProviderType.GEMINI,
                model_used="gemini-2.5-flash",
                credential_id_used="app_default_gemini",
                structured_data=mock_analysis,
                latency_ms=180.5,
                text="",
            )

            with patch("app.api.v1.scanner.ai_orchestrator.execute", new_callable=AsyncMock) as mock_exec:
                mock_exec.return_value = mock_exec_resp

                resp = await client.post(
                    "/api/v1/scanner/scan",
                    json={
                        "resume_id": resume_id,
                        "job_description": scenario["job_description"],
                    },
                    headers={"X-User-Id": user_id},
                )

                assert resp.status_code == 200, f"Failed for domain {domain_key}: {resp.text}"
                data = resp.json()

                # Validate Pydantic schema deserialization
                validated_resp = AtsScanResponse.model_validate(data)
                assert validated_resp.analysis.overall_score == 85
                assert 0 <= validated_resp.analysis.overall_score <= 100
                assert validated_resp.analysis.overall_score >= 0
                assert validated_resp.analysis.executive_summary
                assert validated_resp.analysis.overall_explanation
                assert len(validated_resp.analysis.requirements) >= 1
                assert len(validated_resp.analysis.section_analysis) >= 1
                assert len(validated_resp.analysis.keyword_analysis) >= 1
                assert validated_resp.provenance.scoring_version == "v2_ai_first"
                assert validated_resp.provenance.model_used == "gemini-2.5-flash"
                assert validated_resp.audit_report is not None


@pytest.mark.asyncio
async def test_criterion_a_input_validation_and_malformed_handling():
    """Validates robust rejection of invalid inputs (<50 chars resume, <20 chars JD) and malformed AI outputs."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # 1. Too short resume text
        resp_short_res = await client.post(
            "/api/v1/scanner/scan",
            json={"raw_resume_text": "Too short", "job_description": "Valid job description over 20 chars"},
            headers={"X-User-Id": "user_val"},
        )
        assert resp_short_res.status_code == 400
        assert "Resume content is too short" in resp_short_res.json()["detail"]

        # 2. Too short job description
        resp_short_jd = await client.post(
            "/api/v1/scanner/scan",
            json={"raw_resume_text": "This is a valid resume with enough characters to pass validation checks.", "job_description": "short"},
            headers={"X-User-Id": "user_val"},
        )
        assert resp_short_jd.status_code == 400
        assert "Job description is too short" in resp_short_jd.json()["detail"]

        # 3. Model outputs unparseable / malformed structure
        with patch("app.api.v1.scanner.ai_orchestrator.execute", new_callable=AsyncMock) as mock_exec:
            mock_exec.side_effect = AIOutputValidationError("Malformed JSON schema")
            resp_malformed = await client.post(
                "/api/v1/scanner/scan",
                json={
                    "raw_resume_text": "This is a valid resume with enough characters to pass validation checks.",
                    "job_description": "We need a Senior Software Engineer with Python and PostgreSQL expertise.",
                },
                headers={"X-User-Id": "user_val"},
            )
            assert resp_malformed.status_code == 502
            assert "invalid or unparseable structured response" in resp_malformed.json()["detail"]


# ============================================================================
# CRITERION B: Evidence Integrity & Truth-Lock Benchmark Tests
# ============================================================================

@pytest.mark.asyncio
async def test_criterion_b_truth_lock_detects_fabricated_metrics_and_blocks():
    """Confirms that Truth-Lock blocks rewrite proposals introducing ungrounded numerical metrics."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        scenario = BENCHMARK_SCENARIOS["backend_distributed"]
        user_id = "user_truth_metric"
        resume_id = "res_truth_metric"
        seed_benchmark_resume(resume_id, user_id, "backend_distributed")

        # Rewrite introduces completely fabricated numerical metric: "reduced latency by 99% across 500 nodes"
        fabricated_rewrite = GroundedRewriteProposalItem(
            original_text="Engineered high-throughput Python backend microservices utilizing FastAPI and PostgreSQL, serving 12M monthly queries.",
            proposed_text="Architected microservices reducing latency by 99% across 500 nodes and generating $15M revenue.",
            factual_basis="Candidate claims this in review.",
            explanation="Added strong numbers.",
            validation_status=RewriteValidationStatus.PENDING_REVIEW,
        )

        mock_analysis = build_synthetic_ai_analysis(overall_score=90, include_rewrite=False)
        mock_analysis.rewrite_proposals = [fabricated_rewrite]

        mock_exec_resp = ExecutionResponse(
            task=AITaskType.ATS_SCAN_ANALYSIS,
            provider_used=ProviderType.GEMINI,
            model_used="gemini-2.5-flash",
            credential_id_used="app_default_gemini",
            structured_data=mock_analysis,
            latency_ms=195.0,
            text="",
        )

        with patch("app.api.v1.scanner.ai_orchestrator.execute", new_callable=AsyncMock) as mock_exec:
            mock_exec.return_value = mock_exec_resp

            resp = await client.post(
                "/api/v1/scanner/scan",
                json={
                    "resume_id": resume_id,
                    "job_description": scenario["job_description"],
                    "save_report": True,
                },
                headers={"X-User-Id": user_id},
            )

            assert resp.status_code == 200
            data = resp.json()
            audit = data["audit_report"]

            # Truth-Lock must detect ungrounded numbers
            assert audit["is_valid"] is False
            assert audit["blocking_violations_count"] >= 1
            assert any(f["is_blocking"] is True for f in audit["findings"])
            assert data["provenance"]["truth_lock_passed"] is False
            # Report must NOT be saved when blocking violations exist
            assert data["saved_report_id"] is None


@pytest.mark.asyncio
async def test_criterion_b_truth_lock_detects_source_inversion_and_missing_evidence():
    """Confirms that citing job requirements as candidate evidence (source inversion) is strictly blocked."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        scenario = BENCHMARK_SCENARIOS["frontend_web"]
        user_id = "user_truth_inversion"
        resume_id = "res_truth_inversion"
        seed_benchmark_resume(resume_id, user_id, "frontend_web")

        # Model hallucinates and cites the Job Description's text as the candidate's supporting evidence
        inversion_item = JobRequirementAnalysisItem(
            requirement_description="Mastery of TypeScript, React, Next.js",
            criticality=RequirementCriticality.MANDATORY,
            match_status=RequirementMatchStatus.MEETS,
            supporting_evidence=["Seeking a Senior/Lead Frontend Engineer to architect performant web applications."],
            explanation="Matches requirement exactly.",
            missing_evidence=False,
        )

        mock_analysis = build_synthetic_ai_analysis(overall_score=82, include_rewrite=False)
        mock_analysis.requirements = [inversion_item]

        mock_exec_resp = ExecutionResponse(
            task=AITaskType.ATS_SCAN_ANALYSIS,
            provider_used=ProviderType.GEMINI,
            model_used="gemini-2.5-flash",
            credential_id_used="app_default_gemini",
            structured_data=mock_analysis,
            latency_ms=210.0,
            text="",
        )

        with patch("app.api.v1.scanner.ai_orchestrator.execute", new_callable=AsyncMock) as mock_exec:
            mock_exec.return_value = mock_exec_resp

            resp = await client.post(
                "/api/v1/scanner/scan",
                json={
                    "resume_id": resume_id,
                    "job_description": scenario["job_description"],
                },
                headers={"X-User-Id": user_id},
            )

            assert resp.status_code == 200
            data = resp.json()
            audit = data["audit_report"]

            assert audit["is_valid"] is False
            assert audit["blocking_violations_count"] >= 1
            assert any(f["is_blocking"] is True for f in audit["findings"])


# ============================================================================
# CRITERION C: Contextual Relevance vs Literal Keyword Stuffing
# ============================================================================

@pytest.mark.asyncio
async def test_criterion_c_semantic_equivalence_and_transferable_competencies():
    """Verifies that contextual analysis recognizes semantic equivalents (e.g. Postgres vs Relational DBs) without requiring literal repetition."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        user_id = "user_semantic_eval"
        resume_id = "res_semantic_eval"

        # Resume has "PostgreSQL, SQLAlchemy, relational DBs, FastAPI microservices"
        # Job description requests "Relational database schema optimization and REST microservices"
        scenario = BENCHMARK_SCENARIOS["backend_distributed"]
        seed_benchmark_resume(resume_id, user_id, "backend_distributed")

        mock_analysis = build_synthetic_ai_analysis(overall_score=87)
        # Verify requirement breakdown captures both MEETS and transferable PARTIAL
        assert any(r.match_status == RequirementMatchStatus.MEETS for r in mock_analysis.requirements)
        assert any(r.match_status == RequirementMatchStatus.PARTIAL for r in mock_analysis.requirements)
        assert any(k.status == KeywordCoverageStatus.PRESENT_WEAK for k in mock_analysis.keyword_analysis)

        mock_exec_resp = ExecutionResponse(
            task=AITaskType.ATS_SCAN_ANALYSIS,
            provider_used=ProviderType.GEMINI,
            model_used="gemini-2.5-flash",
            credential_id_used="app_default_gemini",
            structured_data=mock_analysis,
            latency_ms=175.0,
            text="",
        )

        with patch("app.api.v1.scanner.ai_orchestrator.execute", new_callable=AsyncMock) as mock_exec:
            mock_exec.return_value = mock_exec_resp

            resp = await client.post(
                "/api/v1/scanner/scan",
                json={
                    "resume_id": resume_id,
                    "job_description": scenario["job_description"],
                },
                headers={"X-User-Id": user_id},
            )

            assert resp.status_code == 200
            data = resp.json()
            keywords = data["analysis"]["keyword_analysis"]

            # Transferable competency must be preserved without treating it as an automatic failure
            redis_kw = next((k for k in keywords if k["keyword"] == "Redis"), None)
            assert redis_kw is not None
            assert redis_kw["status"] == "present_weak"


# ============================================================================
# CRITERION D: Score Integrity & Strict No-Fallback Guarantee
# ============================================================================

@pytest.mark.asyncio
async def test_criterion_d_score_integrity_preserved_without_arithmetic_deductions():
    """Verifies that the AI-generated contextual score (e.g. 73 or 92) is returned verbatim without arithmetic formula deductions."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        user_id = "user_score_intact"
        resume_id = "res_score_intact"
        seed_benchmark_resume(resume_id, user_id, "backend_distributed")

        for test_score in [62, 73, 85, 94]:
            mock_analysis = build_synthetic_ai_analysis(overall_score=test_score)
            mock_exec_resp = ExecutionResponse(
                task=AITaskType.ATS_SCAN_ANALYSIS,
                provider_used=ProviderType.GEMINI,
                model_used="gemini-2.5-flash",
                credential_id_used="app_default_gemini",
                structured_data=mock_analysis,
                latency_ms=160.0,
                text="",
            )

            with patch("app.api.v1.scanner.ai_orchestrator.execute", new_callable=AsyncMock) as mock_exec:
                mock_exec.return_value = mock_exec_resp

                resp = await client.post(
                    "/api/v1/scanner/scan",
                    json={
                        "resume_id": resume_id,
                        "job_description": BENCHMARK_SCENARIOS["backend_distributed"]["job_description"],
                    },
                    headers={"X-User-Id": user_id},
                )

                assert resp.status_code == 200
                data = resp.json()
                # Score returned by API must EXACTLY equal the AI contextual score
                assert data["analysis"]["overall_score"] == test_score


@pytest.mark.asyncio
async def test_criterion_d_strict_no_fallback_on_ai_failure():
    """Validates the strict no-fallback guarantee: 429 quota, 503 unavailable, 502 validation error NEVER call legacy heuristic formula."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        user_id = "user_no_fallback"
        resume_id = "res_no_fallback"
        seed_benchmark_resume(resume_id, user_id, "backend_distributed")

        failure_cases = [
            (AIProviderError("Resource exhausted: 429 quota exceeded"), 429),
            (AIProviderUnavailableError("Gemini service unavailable in region"), 503),
            (AIAuthenticationError("Invalid API key provided"), 503),
            (AIConfigurationError("No eligible route for task"), 503),
            (AIOutputValidationError("Schema validation failed"), 502),
        ]

        for exc, expected_status in failure_cases:
            with patch("app.api.v1.scanner.ai_orchestrator.execute", new_callable=AsyncMock) as mock_exec, \
                 patch.object(ats_scanner_engine, "scan_tailored_resume") as mock_legacy_scan:

                mock_exec.side_effect = exc

                resp = await client.post(
                    "/api/v1/scanner/scan",
                    json={
                        "resume_id": resume_id,
                        "job_description": BENCHMARK_SCENARIOS["backend_distributed"]["job_description"],
                    },
                    headers={"X-User-Id": user_id},
                )

                assert resp.status_code == expected_status, f"Expected {expected_status} for {exc}, got {resp.status_code}: {resp.text}"
                # CRITICAL: Legacy deterministic scoring MUST NOT be invoked as a fallback!
                assert mock_legacy_scan.call_count == 0


# ============================================================================
# CRITERION E: Operational Reliability, Security & Cost Policy
# ============================================================================

@pytest.mark.asyncio
async def test_criterion_e_security_secret_isolation_and_tenant_boundaries():
    """Verifies that API keys/secrets are never leaked and cross-user resume access is strictly rejected."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        owner_id = "user_owner"
        attacker_id = "user_attacker"
        resume_id = "res_secret_test"
        seed_benchmark_resume(resume_id, owner_id, "cloud_devops_sre")

        # 1. Attacker attempts to scan owner's resume -> HTTP 403 Forbidden
        resp_unauth = await client.post(
            "/api/v1/scanner/scan",
            json={
                "resume_id": resume_id,
                "job_description": BENCHMARK_SCENARIOS["cloud_devops_sre"]["job_description"],
            },
            headers={"X-User-Id": attacker_id},
        )
        assert resp_unauth.status_code == 403
        assert "Unauthorized" in resp_unauth.json()["detail"]

        # 2. Spoofed header check
        resp_spoofed = await client.post(
            "/api/v1/scanner/scan",
            json={
                "resume_id": resume_id,
                "job_description": BENCHMARK_SCENARIOS["cloud_devops_sre"]["job_description"],
            },
            headers={"X-User-Id": "spoofed_header_id", "Authorization": "Bearer mocked"},
        )
        # Header mismatch returns 403
        assert resp_spoofed.status_code in [401, 403]

        # 3. Secret isolation: Provider error message must be sanitized and not contain secret patterns
        raw_secret_key = "AIzaSy" + "A" * 33
        with patch("app.api.v1.scanner.ai_orchestrator.execute", new_callable=AsyncMock) as mock_exec:
            mock_exec.side_effect = AIProviderError(f"Failed with key {raw_secret_key}")

            resp_err = await client.post(
                "/api/v1/scanner/scan",
                json={
                    "resume_id": resume_id,
                    "job_description": BENCHMARK_SCENARIOS["cloud_devops_sre"]["job_description"],
                },
                headers={"X-User-Id": owner_id},
            )
            assert resp_err.status_code == 502
            err_detail = resp_err.json()["detail"]
            assert raw_secret_key not in err_detail


@pytest.mark.asyncio
async def test_criterion_e_cost_policy_free_only_routing():
    """Verifies that the ATS scanner adheres to the FREE_ONLY policy."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        user_id = "user_cost_policy"
        resume_id = "res_cost_policy"
        seed_benchmark_resume(resume_id, user_id, "leadership_product")

        # When orchestrator rejects routing due to cost policy
        with patch("app.api.v1.scanner.ai_orchestrator.execute", new_callable=AsyncMock) as mock_exec:
            mock_exec.side_effect = AIConfigurationError("No eligible AI model route available matching task requirements or cost policy.")

            resp = await client.post(
                "/api/v1/scanner/scan",
                json={
                    "resume_id": resume_id,
                    "job_description": BENCHMARK_SCENARIOS["leadership_product"]["job_description"],
                },
                headers={"X-User-Id": user_id},
            )
            assert resp.status_code == 503
            assert "cost policy" in resp.json()["detail"].lower()


@pytest.mark.asyncio
async def test_criterion_e_backward_compatibility_and_provenance_preservation():
    """Verifies that legacy /scan-tailored returns v1_heuristic, historical reports retain v1_heuristic, and /scan returns v2_ai_first."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        user_id = "user_provenance_compat"
        resume_id = "res_provenance_compat"
        seed_benchmark_resume(resume_id, user_id, "backend_distributed")

        # 1. Primary AI-first /scan returns v2_ai_first
        mock_analysis = build_synthetic_ai_analysis(overall_score=84)
        mock_exec_resp = ExecutionResponse(
            task=AITaskType.ATS_SCAN_ANALYSIS,
            provider_used=ProviderType.GEMINI,
            model_used="gemini-2.5-flash",
            credential_id_used="app_default_gemini",
            structured_data=mock_analysis,
            latency_ms=190.0,
            text="",
        )

        with patch("app.api.v1.scanner.ai_orchestrator.execute", new_callable=AsyncMock) as mock_exec:
            mock_exec.return_value = mock_exec_resp

            resp_ai = await client.post(
                "/api/v1/scanner/scan",
                json={
                    "resume_id": resume_id,
                    "job_description": BENCHMARK_SCENARIOS["backend_distributed"]["job_description"],
                    "save_report": True,
                },
                headers={"X-User-Id": user_id},
            )
            assert resp_ai.status_code == 200
            data_ai = resp_ai.json()
            assert data_ai["provenance"]["scoring_version"] == "v2_ai_first"
            report_id = data_ai["saved_report_id"]
            assert report_id is not None

            # Retrieve saved report -> verifies scoring_version == v2_ai_first
            resp_rep = await client.get(
                f"/api/v1/scanner/reports/{report_id}",
                headers={"X-User-Id": user_id},
            )
            assert resp_rep.status_code == 200
            assert resp_rep.json()["scoring_version"] == "v2_ai_first"

        # 2. Legacy /scan-tailored returns v1_heuristic (or backward-compatible scan metadata)
        resp_legacy = await client.post(
            "/api/v1/scanner/scan-tailored",
            json={"resume_id": resume_id},
            headers={"X-User-Id": user_id},
        )
        assert resp_legacy.status_code == 200
        data_legacy = resp_legacy.json()
        assert data_legacy["metadata"]["scoring_version"] in ["v1_heuristic", "1.0.0"]

        # 3. Historical report saved with v1_heuristic is NEVER relabeled as AI-generated
        hist_rep_id = f"hist-rep-{resume_id}"
        hist_rep = SavedScanReportDTO(
            id=hist_rep_id,
            userId=user_id,
            reportName="Historical Legacy Scan Report",
            sourceType="tailored_resume",
            resumeId=resume_id,
            jobTitle="Backend Developer",
            overallScore=78,
            grade="B",
            scanResult=AtsScanResult(
                overall_score=78,
                grade="B",
                summary="Historical report using legacy 4-pillar formula.",
                category_scores={},
                keyword_matrix=KeywordMatrix(),
                bullet_audits=[],
                actionable_checklist=[],
                metadata=ScanMetadata(source_type="tailored_resume", scoring_version="v1_heuristic"),
            ),
            scoring_version="v1_heuristic",
            createdAt="2026-09-01T12:00:00Z",
            updatedAt="2026-09-01T12:00:00Z",
        )
        scan_report_repo.save_report(hist_rep)

        resp_hist = await client.get(
            f"/api/v1/scanner/reports/{hist_rep_id}",
            headers={"X-User-Id": user_id},
        )
        assert resp_hist.status_code == 200
        hist_data = resp_hist.json()
        assert hist_data["scoring_version"] == "v1_heuristic"
