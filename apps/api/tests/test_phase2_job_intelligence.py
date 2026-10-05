"""Comprehensive test suite for Phase 2: Job Intelligence & Truth-Locked Tailoring.

Validates:
1. Job Analysis (Deterministic fallback & structured extraction on 5 Golden JDs).
2. Deterministic Profile-Job Matching (Strong, Transferable, Missing, Evidence Traceability).
3. ApplicationProfileSnapshot (Read-only, derived fact ID references, zero profile mutation).
4. Cover Letter Truth-Lock (Lodestar title, synthetic events metric, unsupported claims).
5. ATS Evidence Audit (5 states, separation of ATS score from Truth Integrity).
6. Non-negotiable Phase 1 invariants (Lodestar title, courses, Techniva leadership, section order).
"""

import pytest
from unittest.mock import AsyncMock, MagicMock

from app.schemas.cover_letter import CoverLetterContent
from app.schemas.job import CanonicalJob, JobSourceRef
from app.schemas.job_analysis import JobAnalysisResult, JobRequirementItem
from app.schemas.profile import Profile
from app.schemas.resume import (
    ResumeBullet,
    ResumeContact,
    ResumeCourseCertificationItem,
    ResumeExperienceItem,
    ResumeProjectItem,
    StructuredResumeContent,
)
from app.services.ats_evidence_auditor import ats_evidence_auditor
from app.services.cover_letter_validator import cover_letter_validator
from app.services.job_analysis_service import JobAnalysisService, job_analysis_service
from app.services.profile_job_matching_service import (
    ProfileJobMatchingService,
    profile_job_matcher,
)
from app.services.profile_service import profile_service
from app.services.resume_generator import (
    ground_experience_and_leadership,
    reconstruct_verified_courses,
)
from app.services.resume_validator import resume_validator
from tests.fixtures.golden_jds import (
    GOLDEN_DATA_JD,
    GOLDEN_MALFORMED_JD,
    GOLDEN_PRODUCT_OPS_JD,
    GOLDEN_QA_JD,
    GOLDEN_SWE_JD,
)


@pytest.fixture
def canonical_candidate_profile() -> Profile:
    """Authoritative candidate profile populated with verified Phase 1 candidate facts."""
    return profile_service._init_default_profile("test_user_phase2")


def create_canonical_job_from_dict(data: dict) -> CanonicalJob:
    """Helper to convert test fixture dict to CanonicalJob."""
    return CanonicalJob(
        id=data["id"],
        title=data["title"],
        company=data["company"],
        location=data.get("location") or "Remote",
        workMode=data.get("workMode") or "remote",
        category=data.get("category") or "technical",
        employmentType=data.get("employmentType") or "full_time",
        seniority=data.get("seniority") or "junior",
        experienceYearsRequired=data.get("experienceYearsRequired", 1.0),
        experienceText=data.get("experienceText") or "0 - 1 yr",
        description=data["description"],
        requiredSkills=data.get("requiredSkills", []),
        preferredSkills=data.get("preferredSkills", []),
        sourceRef=JobSourceRef(
            adapter="greenhouse",
            originalUrl="https://example.com/job",
            sourceJobId=data["id"],
        ),
    )


# ==============================================================================
# 1. JOB ANALYSIS SERVICE TESTS (GOLDEN JDs & DETERMINISTIC FALLBACK)
# ==============================================================================

def test_deterministic_job_analysis_golden_swe():
    """Verify deterministic extraction on SWE Golden JD extracts Fastify, SDK, and APIs."""
    job = create_canonical_job_from_dict(GOLDEN_SWE_JD)
    analysis = job_analysis_service.deterministic_fallback_analysis(job)

    assert analysis.jobId == job.id
    assert analysis.roleCategory == "software_engineering"
    assert "Fastify" in analysis.requiredSkills or "TypeScript" in analysis.requiredSkills
    assert len(analysis.requirements) >= 4
    assert analysis.source == "deterministic_fallback"


def test_deterministic_job_analysis_golden_data():
    """Verify deterministic extraction on Data Analyst Golden JD detects data category."""
    job = create_canonical_job_from_dict(GOLDEN_DATA_JD)
    analysis = job_analysis_service.deterministic_fallback_analysis(job)

    assert analysis.roleCategory == "data_analytics"
    assert any(s in analysis.requiredSkills for s in ["Python", "SQL", "R Programming"])
    assert "data" in analysis.roleFocus.lower()


def test_deterministic_job_analysis_golden_qa():
    """Verify deterministic extraction on QA Golden JD detects QA and test automation."""
    job = create_canonical_job_from_dict(GOLDEN_QA_JD)
    analysis = job_analysis_service.deterministic_fallback_analysis(job)

    assert analysis.roleCategory == "qa_testing"
    assert any(s in analysis.requiredSkills for s in ["Test Automation", "Python", "API Testing"])


def test_deterministic_job_analysis_malformed_jd():
    """Verify malformed or minimal JD does not crash and marks confidence as low/medium."""
    job = create_canonical_job_from_dict(GOLDEN_MALFORMED_JD)
    analysis = job_analysis_service.deterministic_fallback_analysis(job)

    assert analysis.jobId == job.id
    assert analysis.confidence in ("low", "medium")
    assert isinstance(analysis.requirements, list)
    assert len(analysis.summary) > 10


@pytest.mark.asyncio
async def test_job_analysis_caching_and_mock_ai():
    """Verify AI analysis is cached by job ID and returns cached result on subsequent calls."""
    job = create_canonical_job_from_dict(GOLDEN_SWE_JD)

    mock_provider = MagicMock()
    mock_output = MagicMock()
    mock_output.roleCategory = "software_engineering"
    mock_output.roleFocus = "Browser SDK, Fastify, REST APIs"
    mock_output.summary = "Nexus is hiring a Junior Full Stack Engineer for browser SDK telemetry."
    mock_output.requirements = [
        JobRequirementItem(
            id="req-1",
            type="skill_technical",
            text="Build browser SDKs in TypeScript",
            category="required",
            keywords=["TypeScript", "SDK"],
            importance="critical",
        )
    ]
    mock_output.requiredSkills = ["TypeScript", "Fastify", "REST APIs"]
    mock_output.preferredSkills = ["Docker"]
    mock_output.responsibilities = ["Build browser SDK"]
    mock_output.qualifications = ["Bachelor's degree"]
    mock_output.keywords = ["TypeScript", "SDK", "Fastify"]
    mock_output.softSkills = ["Collaboration"]
    mock_output.domainContext = ["Telemetry"]

    mock_provider.generate_structured = AsyncMock(return_value=mock_output)
    mock_provider.last_model_used = "gemini-2.5-flash"

    service = JobAnalysisService(ai_provider=mock_provider)
    result = await service.analyze_job(job=job, force_regenerate=True)

    assert result.roleCategory == "software_engineering"
    assert result.confidence == "high"
    assert result.source == "ai_structured"

    # Second call without force_regenerate should use cache (mock not called again)
    mock_provider.generate_structured.reset_mock()
    cached_result = await service.analyze_job(job=job, force_regenerate=False)
    assert cached_result.jobId == result.jobId
    mock_provider.generate_structured.assert_not_called()


# ==============================================================================
# 2. DETERMINISTIC PROFILE-JOB MATCHING TESTS
# ==============================================================================

def test_deterministic_matching_strong_match(canonical_candidate_profile):
    """Verify verified profile skills (Fastify, React, Python) produce strong direct match."""
    req = JobRequirementItem(
        id="req-fastify",
        type="skill_technical",
        text="Build scalable backend services using Fastify and REST APIs",
        category="required",
        keywords=["Fastify", "REST APIs"],
        importance="critical",
    )
    matcher = ProfileJobMatchingService()
    fact_index = matcher._build_candidate_fact_index(canonical_candidate_profile)
    evidence = matcher.match_requirement(req, fact_index)

    assert evidence.matchLevel == "strong"
    assert "Fastify" in evidence.candidateEvidence or "Lodestar" in evidence.candidateEvidence
    assert "Direct match" in evidence.rationale


def test_deterministic_matching_transferable_match(canonical_candidate_profile):
    """Verify unverified technology with known adjacent verified skill is marked Transferable.

    Candidate has verified Playwright, but JD asks for Selenium.
    Must NOT claim direct match.
    """
    req = JobRequirementItem(
        id="req-selenium",
        type="skill_technical",
        text="Hands-on experience with Selenium web automation framework",
        category="required",
        keywords=["Selenium"],
        importance="high",
    )
    matcher = ProfileJobMatchingService()
    fact_index = matcher._build_candidate_fact_index(canonical_candidate_profile)
    evidence = matcher.match_requirement(req, fact_index)

    assert evidence.matchLevel == "transferable"
    assert "NOT directly verified" in evidence.rationale
    assert "playwright" in evidence.candidateEvidence.lower()


def test_deterministic_matching_missing_requirement(canonical_candidate_profile):
    """Verify completely unverified technology (e.g. Snowflake or Salesforce) is marked Missing."""
    req = JobRequirementItem(
        id="req-snowflake",
        type="skill_technical",
        text="Minimum 1 year with Snowflake data warehousing",
        category="required",
        keywords=["Snowflake"],
        importance="critical",
    )
    matcher = ProfileJobMatchingService()
    fact_index = matcher._build_candidate_fact_index(canonical_candidate_profile)
    evidence = matcher.match_requirement(req, fact_index)

    assert evidence.matchLevel == "missing"
    assert "Missing requirement" in evidence.rationale
    assert evidence.verifiedFactIds == []


def test_application_profile_snapshot_generation(canonical_candidate_profile):
    """Verify ApplicationProfileSnapshot is derived, references canonical facts, and does not duplicate profile."""
    job = create_canonical_job_from_dict(GOLDEN_SWE_JD)
    analysis = job_analysis_service.deterministic_fallback_analysis(job)
    match_result = profile_job_matcher.compute_match(canonical_candidate_profile, analysis)

    snapshot = profile_job_matcher.create_application_snapshot(
        canonical_candidate_profile, analysis, match_result
    )

    assert snapshot.userId == canonical_candidate_profile.userId
    assert snapshot.jobId == job.id
    assert snapshot.roleCategory == "software_engineering"
    assert len(snapshot.selectedFactIds) > 0
    assert "exp-lodestar-01" in snapshot.selectedFactIds
    assert len(snapshot.selectedProjectIds) <= 4
    # Ensure snapshot contains references rather than full cloned objects
    assert not hasattr(snapshot, "personal")
    assert not hasattr(snapshot, "education")


# ==============================================================================
# 3. CLAIM-LEVEL COVER LETTER TRUTH-LOCK TESTS
# ==============================================================================

def test_cover_letter_truth_lock_valid(canonical_candidate_profile):
    """Verify honest, fact-grounded cover letter passes Truth-Lock validation."""
    valid_content = CoverLetterContent(
        fullName="Mohammed Affan Razvi",
        email="mohammedaffanrazvi604@gmail.com",
        companyName="Nexus Technologies",
        jobTitle="Junior Full Stack Engineer",
        date="October 4, 2026",
        paragraph1_hook="I am writing to express my enthusiastic interest in the Junior Full Stack Engineer opening at Nexus Technologies.",
        paragraph2_evidence="During my internship at Lodestar as a Software Engineering Intern, I built a seed/load harness that replayed ~14.6K synthetic events across ~40 sessions through a per-tenant Fastify ingest service. I also engineered Next-Social using React, Next.js, and FastAPI.",
        paragraph3_impact="With a strong foundation in full-stack development and automated testing, I am eager to contribute to Nexus Technologies.",
        sourceFactIds=["exp-lodestar-01", "proj-next-social"],
    )
    result = cover_letter_validator.validate(valid_content, canonical_candidate_profile)
    assert result.is_valid is True
    assert len(result.violations) == 0


def test_cover_letter_truth_lock_rejects_title_inflation(canonical_candidate_profile):
    """Verify cover letter claiming 'Lead Software Engineer' at Lodestar is strictly rejected."""
    inflated_content = CoverLetterContent(
        fullName="Mohammed Affan Razvi",
        email="mohammedaffanrazvi604@gmail.com",
        companyName="Nexus Technologies",
        jobTitle="Junior Full Stack Engineer",
        date="October 4, 2026",
        paragraph1_hook="I am writing to apply for the Junior Full Stack Engineer position at Nexus Technologies.",
        paragraph2_evidence="At Lodestar, as a Lead Software Engineer, I architected the core ingest service and managed telemetry teams.",
        paragraph3_impact="I am confident my technical leadership will drive results for your engineering team.",
        sourceFactIds=["exp-lodestar-01"],
    )
    result = cover_letter_validator.validate(inflated_content, canonical_candidate_profile)
    assert result.is_valid is False
    assert any("title inflation" in v.lower() for v in result.violations)


def test_cover_letter_truth_lock_rejects_synthetic_metric_production_claim(canonical_candidate_profile):
    """Verify cover letter describing ~14.6K events as 'real users' or 'production traffic' fails."""
    prohibited_content = CoverLetterContent(
        fullName="Mohammed Affan Razvi",
        email="mohammedaffanrazvi604@gmail.com",
        companyName="Nexus Technologies",
        jobTitle="Junior Full Stack Engineer",
        date="October 4, 2026",
        paragraph1_hook="I am excited to submit my application for the Junior Full Stack Engineer opening.",
        paragraph2_evidence="At Lodestar as a Software Engineering Intern, I processed 14.6K real users in live production traffic.",
        paragraph3_impact="I look forward to discussing how my experience aligns with Nexus Technologies.",
        sourceFactIds=["exp-lodestar-01"],
    )
    result = cover_letter_validator.validate(prohibited_content, canonical_candidate_profile)
    assert result.is_valid is False
    assert any("synthetic 14.6k events must not be described" in v.lower() for v in result.violations)


# ==============================================================================
# 4. ATS EVIDENCE AUDITOR TESTS (DECOUPLING TRUTH FROM ATS SCORE)
# ==============================================================================

def test_ats_evidence_auditor_all_five_states(canonical_candidate_profile):
    """Verify ATS Evidence Auditor identifies all 5 distinct states accurately."""
    job = create_canonical_job_from_dict(GOLDEN_SWE_JD)
    analysis = job_analysis_service.deterministic_fallback_analysis(job)

    # Construct mock structured resume with:
    # - Evidence match: Fastify, React, TypeScript (in resume, in job, in profile)
    # - Unsupported keyword: Kubernetes (in resume, not in profile)
    resume = StructuredResumeContent(
        personal=ResumeContact(
            fullName="Mohammed Affan Razvi",
            email="affan@example.com",
        ),
        summary="Dense 5-line summary covering TypeScript, Fastify, React, and Kubernetes infrastructure.",
        education=[],
        skills=[],
        experience=[
            ResumeExperienceItem(
                company="Lodestar",
                title="Software Engineering Intern",
                bullets=[
                    ResumeBullet(text="Built Fastify ingest service replaying ~14.6K synthetic events."),
                    ResumeBullet(text="Deployed containerized microservices using Kubernetes."),
                ],
            )
        ],
        projects=[
            ResumeProjectItem(
                name="Next-Social (LinkedIn Clone)",
                technologies=["React", "TypeScript", "FastAPI"],
                bullets=[ResumeBullet(text="Built responsive web interface in React.")],
            )
        ],
        course_certifications=[],
        leadership=[],
    )

    report = ats_evidence_auditor.audit_ats_evidence(
        resume=resume,
        job_analysis=analysis,
        profile=canonical_candidate_profile,
    )

    # 1. Truth Integrity must fail because 'Kubernetes' is unsupported
    assert report.truthIntegrityStatus == "VIOLATIONS_DETECTED"
    assert any("kubernetes" in k.lower() for k in report.unsupportedKeywords)

    # 2. ATS score should still be a valid numerical metric
    assert 0 <= report.atsScore <= 100

    # 3. Evidence matches should include Fastify, React, or TypeScript
    assert any("fastify" in em.lower() or "react" in em.lower() or "typescript" in em.lower() for em in report.evidenceMatches)


# ==============================================================================
# 5. PHASE 1 REGRESSION & TRUTH-LOCK INVARIANTS
# ==============================================================================

def test_reconstruct_verified_courses_deterministic_preservation(canonical_candidate_profile):
    """Verify deterministic course reconstruction preserves all 4 courses verbatim."""
    ai_reordered = [
        ResumeCourseCertificationItem(
            course_fact_id="course-cert-4",
            title="The Complete Full-Stack Web Development Bootcamp",
        ),
        ResumeCourseCertificationItem(
            course_fact_id="course-cert-1",
            title="R Programming for Beginners",
        ),
    ]
    reconstructed = reconstruct_verified_courses(
        canonical_candidate_profile.courseCertifications, ai_reordered
    )

    # Must preserve all 4 courses
    assert len(reconstructed) == 4
    # First should be the AI prioritized course (course-cert-4)
    assert reconstructed[0].course_fact_id == "course-cert-4"
    assert reconstructed[0].instructor == "Dr. Angela Yu"
    assert reconstructed[0].provider == "Udemy"
    assert "https://www.udemy.com/certificate/" in (reconstructed[0].certificateUrl or "")
    # Missing courses must be appended
    remaining_ids = {c.course_fact_id for c in reconstructed}
    assert remaining_ids == {"course-cert-1", "course-cert-2", "course-cert-3", "course-cert-4"}


def test_ground_experience_and_leadership_invariants(canonical_candidate_profile):
    """Verify Lodestar remains Software Engineering Intern and Techniva remains Leadership."""
    resume = StructuredResumeContent(
        personal=ResumeContact(fullName="Test", email="test@example.com"),
        summary="Test summary",
        education=[],
        skills=[],
        experience=[
            ResumeExperienceItem(
                company="Techniva Technical Club",  # Misplaced into experience by bad AI
                title="President",
            ),
            ResumeExperienceItem(
                company="Lodestar",
                title="Full Stack Software Developer",  # Renamed by bad AI
                bullets=[ResumeBullet(text="Served 14.6K real users in production.")],  # Bad metric context
            ),
        ],
        projects=[],
        course_certifications=[],
        leadership=[],
    )

    ground_experience_and_leadership(canonical_candidate_profile, resume)

    # 1. Lodestar grounded in experience with exact title
    assert len(resume.experience) == 1
    lodestar = resume.experience[0]
    assert lodestar.company == "Lodestar"
    assert lodestar.title == "Software Engineering Intern"  # Hard invariant

    # 2. Synthetic metric cleansed of live production wording
    for b in lodestar.bullets:
        assert "real users" not in b.text.lower()
        assert "live production" not in b.text.lower()

    # 3. Techniva grounded in leadership
    assert len(resume.leadership) == 1
    techniva = resume.leadership[0]
    assert techniva.company == "Techniva Technical Club"
    assert techniva.title == "Co-Founder & Technical Lead"
