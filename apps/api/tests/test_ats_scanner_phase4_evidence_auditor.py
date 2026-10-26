"""Tests for Phase 4: Truth-Lock Evidence Validation.

Validates:
1. Valid exact quotations pass validation.
2. Fabricated or malformed quotations are flagged with blocking violations.
3. Permitted whitespace normalization works as intended (spaces, tabs, newlines).
4. Generic or insufficiently specific quotations (< 5 chars) trigger advisory warnings.
5. Job description text incorrectly cited as candidate evidence is caught and blocked.
6. Supported candidate-specific claims pass; unsupported ones fail.
7. Tenant isolation: Profile belonging to a different user raises PermissionError.
8. Requirements marked MEETS without evidence trigger blocking violations.
9. Nuanced distinction between missing evidence and negative candidate qualification.
10. Fully grounded rewrite proposals are validated as GROUNDED.
11. Rewrite proposals that invent metrics, percentages, or numbers are marked UNVERIFIED and blocked.
12. Proof that the AI contextual score is NEVER modified, recalculated, or deducted.
13. Distinction between blocking violations (fail) and advisory warnings (review-required).
14. Full typed schema serialization of TruthLockAuditReport and EvidenceAuditFinding.
"""

import pytest
from app.schemas.ats_analysis import (
    AtsAnalysisResult,
    ContextualKeywordItem,
    EvidenceViolationSeverity,
    GroundedRewriteProposalItem,
    JobRequirementAnalysisItem,
    KeywordCoverageStatus,
    RequirementCriticality,
    RequirementMatchStatus,
    ResumeSectionAnalysisItem,
    RewriteValidationStatus,
    SectionName,
    ValidationStatus,
)
from app.schemas.profile import Profile
from app.services.ats_evidence_auditor import AtsEvidenceAuditorService, ats_evidence_auditor


# ---------------------------------------------------------------------------
# Helpers & Fixtures
# ---------------------------------------------------------------------------

SAMPLE_RESUME = """
Alex Chen
San Francisco, CA | alex@example.com

SUMMARY
Senior Backend Software Engineer with 6 years building distributed APIs in Python and FastAPI.

EXPERIENCE
Staff Engineer | Acme Corp | 2021 - Present
- Designed and maintained microservices processing 50M requests daily with 99.9% uptime.
- Led migration of legacy monolith to containerized Docker containers orchestrated on Kubernetes.
- Optimized PostgreSQL database queries, reducing p95 latency from 450ms to 120ms.

Software Engineer | Beta Startup | 2018 - 2021
- Developed REST APIs using Django and Celery for asynchronous background job processing.
- Implemented CI/CD pipelines using GitHub Actions.

SKILLS
Python, FastAPI, Django, PostgreSQL, Docker, Kubernetes, Redis, AWS
"""

SAMPLE_JD = """
Senior Python Infrastructure Engineer
TechCorp Inc.

Requirements:
- 5+ years of production experience in Python backend development.
- Deep expertise in Kubernetes and container orchestration.
- Demonstrated experience with high-throughput distributed systems.
- Preferred: Experience with GraphQL and Apache Kafka.
"""


def create_base_analysis(overall_score: int = 85) -> AtsAnalysisResult:
    return AtsAnalysisResult(
        overall_score=overall_score,
        overall_explanation="Candidate has strong Python backend and Kubernetes experience matching the core requirements.",
        executive_summary="Candidate demonstrates 6 years of Python experience and solid cloud infrastructure knowledge.",
        requirements=[
            JobRequirementAnalysisItem(
                requirement_description="5+ years of production experience in Python backend development",
                criticality=RequirementCriticality.MANDATORY,
                match_status=RequirementMatchStatus.MEETS,
                supporting_evidence=[
                    "Senior Backend Software Engineer with 6 years building distributed APIs in Python and FastAPI."
                ],
                explanation="Candidate explicitly lists 6 years of Python experience.",
                missing_evidence=False,
            ),
            JobRequirementAnalysisItem(
                requirement_description="Deep expertise in Kubernetes and container orchestration",
                criticality=RequirementCriticality.MANDATORY,
                match_status=RequirementMatchStatus.MEETS,
                supporting_evidence=[
                    "containerized Docker containers orchestrated on Kubernetes"
                ],
                explanation="Demonstrated container orchestration experience at Acme Corp.",
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
                original_text="Implemented CI/CD pipelines using GitHub Actions.",
                proposed_text="Engineered automated CI/CD deployment pipelines utilizing GitHub Actions.",
                explanation="Enhances professional action verb usage while maintaining exact scope.",
                factual_basis="Candidate implemented CI/CD pipelines using GitHub Actions.",
                validation_status=RewriteValidationStatus.PENDING_REVIEW,
            )
        ],
        strengths=["Strong Python and Kubernetes production record."],
        gaps=["No explicit mention of GraphQL or Apache Kafka."],
        recommendations=["Highlight any familiarity with asynchronous message queues or GraphQL."],
    )


# ---------------------------------------------------------------------------
# Test 1 & 2: Valid Exact Quotations & Whitespace Normalization
# ---------------------------------------------------------------------------

def test_exact_quotation_and_whitespace_normalization():
    """Exact quotation with varying whitespace (newlines/spaces/tabs) passes validation."""
    auditor = AtsEvidenceAuditorService()
    
    # Direct method test
    quote_with_newlines = "containerized Docker containers\n orchestrated on   Kubernetes"
    assert auditor.is_exact_quotation_present(quote_with_newlines, SAMPLE_RESUME)

    # Full contextual analysis test
    analysis = create_base_analysis()
    analysis.requirements[1].supporting_evidence = [quote_with_newlines]

    report = auditor.audit_contextual_analysis(
        analysis=analysis,
        raw_resume_text=SAMPLE_RESUME,
        job_description=SAMPLE_JD,
    )

    assert report.is_valid is True
    assert report.status == ValidationStatus.PASS
    assert report.blocking_violations_count == 0


def test_fabricated_quotation_fails_with_blocking_violation():
    """Fabricated quotation not present in resume triggers a blocking violation."""
    auditor = AtsEvidenceAuditorService()
    analysis = create_base_analysis()

    # Add fabricated quote
    analysis.requirements[0].supporting_evidence = [
        "Architected enterprise machine learning neural networks serving 1 billion users."
    ]

    report = auditor.audit_contextual_analysis(
        analysis=analysis,
        raw_resume_text=SAMPLE_RESUME,
        job_description=SAMPLE_JD,
    )

    assert report.is_valid is False
    assert report.status == ValidationStatus.FAIL
    assert report.blocking_violations_count >= 1

    blocking_findings = [f for f in report.findings if f.is_blocking]
    assert any("Fabricated or ungrounded quotation" in f.reason for f in blocking_findings)


# ---------------------------------------------------------------------------
# Test 3 & 4: Generic / Insufficient Quotations
# ---------------------------------------------------------------------------

def test_generic_short_quotation_triggers_advisory_warning():
    """Quotation shorter than 5 characters is rejected as insufficiently specific, producing advisory warning."""
    auditor = AtsEvidenceAuditorService()
    analysis = create_base_analysis()

    # Generic 2-character quote
    analysis.requirements[0].supporting_evidence = ["6y"]

    report = auditor.audit_contextual_analysis(
        analysis=analysis,
        raw_resume_text=SAMPLE_RESUME,
        job_description=SAMPLE_JD,
    )

    # Advisory findings require review
    assert report.advisory_warnings_count >= 1
    assert any("too generic (< 5 characters)" in f.reason for f in report.findings)


# ---------------------------------------------------------------------------
# Test 5: Job Description Text Incorrectly Cited as Candidate Evidence
# ---------------------------------------------------------------------------

def test_job_description_cited_as_candidate_evidence_is_blocked():
    """Citing words from the JD that are absent from the resume is caught as a JD attribution error."""
    auditor = AtsEvidenceAuditorService()
    analysis = create_base_analysis()

    # Quote from JD ("Experience with GraphQL and Apache Kafka") which is NOT in Alex's resume
    jd_quote = "Experience with GraphQL and Apache Kafka"
    analysis.requirements[0].supporting_evidence = [jd_quote]

    report = auditor.audit_contextual_analysis(
        analysis=analysis,
        raw_resume_text=SAMPLE_RESUME,
        job_description=SAMPLE_JD,
    )

    assert report.is_valid is False
    assert report.status == ValidationStatus.FAIL
    blocking_findings = [f for f in report.findings if f.is_blocking]
    assert any("Job description text was cited as candidate evidence" in f.reason for f in blocking_findings)
    assert any(f.evidence_source == "job_description" for f in blocking_findings)


# ---------------------------------------------------------------------------
# Test 6 & 7: Requirements Marked MEETS without Evidence & Missing Nuance
# ---------------------------------------------------------------------------

def test_requirement_marked_meets_with_zero_evidence_triggers_blocking_violation():
    """A requirement claimed as MEETS but with empty supporting evidence list is blocked."""
    auditor = AtsEvidenceAuditorService()
    analysis = create_base_analysis()

    analysis.requirements[0].supporting_evidence = []

    report = auditor.audit_contextual_analysis(
        analysis=analysis,
        raw_resume_text=SAMPLE_RESUME,
        job_description=SAMPLE_JD,
    )

    assert report.is_valid is False
    assert report.status == ValidationStatus.FAIL
    blocking_findings = [f for f in report.findings if f.is_blocking]
    assert any("zero supporting evidence citations" in f.reason for f in blocking_findings)


def test_missing_requirement_nuance_preserves_candidate_fairness():
    """Requirements marked MISSING with missing_evidence=True pass without blocking violations."""
    auditor = AtsEvidenceAuditorService()
    analysis = create_base_analysis()

    analysis.requirements.append(
        JobRequirementAnalysisItem(
            requirement_description="Experience with GraphQL and Apache Kafka",
            criticality=RequirementCriticality.PREFERRED,
            match_status=RequirementMatchStatus.MISSING,
            supporting_evidence=[],
            explanation="Candidate resume does not mention Kafka or GraphQL.",
            missing_evidence=True,
        )
    )

    report = auditor.audit_contextual_analysis(
        analysis=analysis,
        raw_resume_text=SAMPLE_RESUME,
        job_description=SAMPLE_JD,
    )

    assert report.is_valid is True
    assert report.status == ValidationStatus.PASS
    assert report.blocking_violations_count == 0


# ---------------------------------------------------------------------------
# Test 8 & 9: Rewrite Proposal Validation (Grounded vs Hallucinated Metrics)
# ---------------------------------------------------------------------------

def test_grounded_rewrite_proposal_is_approved():
    """Rewrite proposal that refines language without fabricating new facts is marked GROUNDED."""
    auditor = AtsEvidenceAuditorService()
    analysis = create_base_analysis()

    # Original exists in resume: "Implemented CI/CD pipelines using GitHub Actions."
    # Proposed improves wording but introduces no new numbers or ungrounded facts.
    proposal = analysis.rewrite_proposals[0]

    report = auditor.audit_contextual_analysis(
        analysis=analysis,
        raw_resume_text=SAMPLE_RESUME,
        job_description=SAMPLE_JD,
    )

    assert proposal.validation_status == RewriteValidationStatus.GROUNDED
    assert report.is_valid is True


def test_rewrite_proposal_fabricating_numbers_and_metrics_is_blocked():
    """Rewrite proposal introducing fabricated numbers/percentages ($500k, 45%) is marked UNVERIFIED and blocked."""
    auditor = AtsEvidenceAuditorService()
    analysis = create_base_analysis()

    # Hallucinating 45% and $500k which do not exist in original text
    analysis.rewrite_proposals[0].proposed_text = (
        "Engineered automated CI/CD pipelines using GitHub Actions, cutting release cycles by 45% and saving $500k."
    )

    report = auditor.audit_contextual_analysis(
        analysis=analysis,
        raw_resume_text=SAMPLE_RESUME,
        job_description=SAMPLE_JD,
    )

    assert analysis.rewrite_proposals[0].validation_status == RewriteValidationStatus.UNVERIFIED
    assert report.is_valid is False
    assert report.status == ValidationStatus.FAIL
    assert report.blocking_violations_count >= 1

    blocking_findings = [f for f in report.findings if f.is_blocking]
    assert any("fabricates ungrounded numerical metrics" in f.reason for f in blocking_findings)


def test_rewrite_proposal_citing_absent_original_text_is_blocked():
    """Rewrite proposal citing original text that is absent from resume is blocked."""
    auditor = AtsEvidenceAuditorService()
    analysis = create_base_analysis()

    analysis.rewrite_proposals[0].original_text = "Spearheaded company-wide quantum computing initiative."

    report = auditor.audit_contextual_analysis(
        analysis=analysis,
        raw_resume_text=SAMPLE_RESUME,
        job_description=SAMPLE_JD,
    )

    assert analysis.rewrite_proposals[0].validation_status == RewriteValidationStatus.UNVERIFIED
    assert report.is_valid is False
    blocking_findings = [f for f in report.findings if f.is_blocking]
    assert any("does not exist in the candidate's submitted resume" in f.reason for f in blocking_findings)


# ---------------------------------------------------------------------------
# Test 10: Tenant Isolation & Master Profile Boundaries
# ---------------------------------------------------------------------------

def test_tenant_isolation_unauthorized_profile_raises_permission_error():
    """Accessing a profile belonging to a different userId raises PermissionError."""
    auditor = AtsEvidenceAuditorService()
    analysis = create_base_analysis()

    from app.schemas.profile import PersonalContact, SkillFact

    foreign_profile = Profile(
        userId="foreign-user-456",
        personal=PersonalContact(fullName="Different Candidate", email="diff@example.com"),
        skills=[SkillFact(id="s1", name="Go", verified=True)],
    )

    with pytest.raises(PermissionError) as exc_info:
        auditor.audit_contextual_analysis(
            analysis=analysis,
            raw_resume_text=SAMPLE_RESUME,
            profile=foreign_profile,
            authenticated_user_id="legitimate-user-123",
        )

    assert "Tenant isolation violation" in str(exc_info.value)
    assert "foreign-user-456" in str(exc_info.value)


# ---------------------------------------------------------------------------
# Test 11: Critical Architectural Guarantee — Score Immutability
# ---------------------------------------------------------------------------

def test_auditor_never_modifies_or_recalculates_ai_score():
    """Even in the presence of severe blocking violations, analysis.overall_score is 100% untouched."""
    auditor = AtsEvidenceAuditorService()
    analysis = create_base_analysis(overall_score=78)

    # Inject severe violations
    analysis.requirements[0].supporting_evidence = ["Completely fabricated qualification string."]
    analysis.rewrite_proposals[0].proposed_text = "Fabricated metrics: 99% faster and $10M revenue."

    report = auditor.audit_contextual_analysis(
        analysis=analysis,
        raw_resume_text=SAMPLE_RESUME,
        job_description=SAMPLE_JD,
    )

    # Score MUST remain exactly 78
    assert analysis.overall_score == 78
    assert report.original_ai_score == 78
    assert "AI Contextual Score preserved: 78/100" in report.summary
    assert report.is_valid is False


# ---------------------------------------------------------------------------
# Test 12: Typed Validation Outcomes & Serialization
# ---------------------------------------------------------------------------

def test_truth_lock_audit_report_serialization():
    """TruthLockAuditReport serializes cleanly to dict and JSON."""
    auditor = AtsEvidenceAuditorService()
    analysis = create_base_analysis(overall_score=92)

    report = auditor.audit_contextual_analysis(
        analysis=analysis,
        raw_resume_text=SAMPLE_RESUME,
        job_description=SAMPLE_JD,
    )

    data = report.model_dump()
    assert data["is_valid"] is True
    assert data["status"] == "pass"
    assert data["original_ai_score"] == 92
    assert isinstance(data["findings"], list)
    assert len(data["findings"]) > 0

    json_str = report.model_dump_json()
    assert '"status":"pass"' in json_str
    assert '"original_ai_score":92' in json_str
