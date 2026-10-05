"""API Integration tests for Phase 2 Endpoints: Job Analysis, Matching, and ATS Evidence."""

import pytest
from httpx import ASGITransport, AsyncClient

from app.db.repositories.job_repo import job_repo
from app.db.repositories.resume_repo import resume_repo
from app.main import app
from app.schemas.job import CanonicalJob, JobSourceRef
from app.schemas.profile import Profile
from app.schemas.resume import (
    ResumeBullet,
    ResumeContact,
    ResumeExperienceItem,
    ResumeValidationResult,
    StructuredResumeContent,
    TailoredResumeDTO,
)
from app.services.profile_service import profile_service
from tests.fixtures.golden_jds import GOLDEN_SWE_JD


@pytest.fixture
def registered_test_job() -> CanonicalJob:
    """Register a canonical job opportunity in repository for API tests."""
    job = CanonicalJob(
        id="job-test-api-swe",
        title=GOLDEN_SWE_JD["title"],
        company=GOLDEN_SWE_JD["company"],
        location=GOLDEN_SWE_JD["location"],
        workMode="remote",
        category="technical",
        employmentType="full_time",
        seniority="junior",
        experienceYearsRequired=1.0,
        experienceText="0 - 2 yrs",
        description=GOLDEN_SWE_JD["description"],
        requiredSkills=GOLDEN_SWE_JD["requiredSkills"],
        preferredSkills=GOLDEN_SWE_JD["preferredSkills"],
        sourceRef=JobSourceRef(
            adapter="greenhouse",
            originalUrl="https://example.com/test-job",
            sourceJobId="job-test-api-swe",
        ),
    )
    job_repo.save(job)
    return job


@pytest.fixture
def registered_test_resume(registered_test_job) -> TailoredResumeDTO:
    """Register a tailored resume in repository for ATS Evidence endpoint tests."""
    resume_dto = TailoredResumeDTO(
        id="resume-test-api-01",
        userId="test_phase2_api_user",
        jobId=registered_test_job.id,
        jobTitle=registered_test_job.title,
        jobCompany=registered_test_job.company,
        structuredContent=StructuredResumeContent(
            personal=ResumeContact(
                fullName="Mohammed Affan Razvi",
                email="affan@example.com",
            ),
            summary="Full stack engineer specializing in TypeScript, Fastify, and React.",
            education=[],
            skills=[],
            experience=[
                ResumeExperienceItem(
                    company="Lodestar",
                    title="Software Engineering Intern",
                    bullets=[
                        ResumeBullet(text="Built Fastify ingest service replaying ~14.6K synthetic events."),
                    ],
                )
            ],
            projects=[],
            course_certifications=[],
            leadership=[],
        ),
        validationResult=ResumeValidationResult(
            is_valid=True,
            truth_score=100,
            verified_fact_count=5,
            violations=[],
            truth_violations=[],
            structural_violations=[],
            transferable_highlights=[],
            skill_gaps=[],
            status="PASSED",
        ),
        latexCode="% Mock LaTeX code",
    )
    resume_repo.save_tailored_resume(resume_dto)
    return resume_dto


@pytest.mark.asyncio
async def test_job_analysis_api_endpoints(registered_test_job):
    """Test POST /jobs/{id}/analyze and GET /jobs/{id}/analysis."""
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        headers = {"X-User-Id": "test_phase2_api_user"}

        # 1. Trigger job analysis
        post_resp = await client.post(
            f"/api/v1/jobs/{registered_test_job.id}/analyze?force_regenerate=true",
            headers=headers,
        )
        assert post_resp.status_code == 200
        analysis_data = post_resp.json()
        assert analysis_data["jobId"] == registered_test_job.id
        assert analysis_data["roleCategory"] == "software_engineering"
        assert len(analysis_data["requirements"]) > 0

        # 2. Get cached job analysis
        get_resp = await client.get(
            f"/api/v1/jobs/{registered_test_job.id}/analysis",
            headers=headers,
        )
        assert get_resp.status_code == 200
        cached_data = get_resp.json()
        assert cached_data["jobId"] == registered_test_job.id
        assert cached_data["id"] == analysis_data["id"]


@pytest.mark.asyncio
async def test_job_profile_match_and_snapshot_endpoints(registered_test_job):
    """Test GET /jobs/{id}/match and POST /jobs/{id}/snapshot."""
    user_id = "test_phase2_api_user"
    profile_service._init_default_profile(user_id)

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        headers = {"X-User-Id": user_id}

        # 1. Get deterministic match
        match_resp = await client.get(
            f"/api/v1/jobs/{registered_test_job.id}/match",
            headers=headers,
        )
        assert match_resp.status_code == 200
        match_data = match_resp.json()
        assert match_data["jobId"] == registered_test_job.id
        assert match_data["userId"] == user_id
        assert "matches" in match_data
        assert "overallScore" in match_data
        assert len(match_data["strongMatches"]) > 0

        # 2. Generate application snapshot
        snap_resp = await client.post(
            f"/api/v1/jobs/{registered_test_job.id}/snapshot",
            headers=headers,
        )
        assert snap_resp.status_code == 200
        snap_data = snap_resp.json()
        assert snap_data["jobId"] == registered_test_job.id
        assert snap_data["userId"] == user_id
        assert len(snap_data["selectedFactIds"]) > 0


@pytest.mark.asyncio
async def test_scanner_ats_evidence_endpoint(registered_test_job, registered_test_resume):
    """Test POST /scanner/ats-evidence auditing."""
    user_id = registered_test_resume.userId
    profile_service._init_default_profile(user_id)

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        headers = {"X-User-Id": user_id}

        resp = await client.post(
            "/api/v1/scanner/ats-evidence",
            headers=headers,
            json={
                "resume_id": registered_test_resume.id,
                "job_id": registered_test_job.id,
            },
        )
        assert resp.status_code == 200
        report = resp.json()
        assert report["jobId"] == registered_test_job.id
        assert report["resumeId"] == registered_test_resume.id
        assert report["truthIntegrityStatus"] in ("VERIFIED", "VIOLATIONS_DETECTED")
        assert 0 <= report["atsScore"] <= 100
        assert len(report["items"]) > 0
