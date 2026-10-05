"""Unit tests for the Hybrid Matching Engine, Experience Penalties, and Filters."""

import pytest
from httpx import AsyncClient

from app.matching.engine import MatchingEngineService
from app.matching.hard_filters import HardFilterService
from app.schemas.job import CanonicalJob, JobSourceRef
from app.schemas.profile import Profile, SkillFact


def test_hard_filters_language_and_location():
    """Verify non-English and overseas physical locations are rejected while Remote/India roles pass."""
    filters = HardFilterService()

    # 1. Reject Japanese title
    assert not filters.is_english_title("デリバリーソリューションアーキテクト")
    assert not filters.is_english_title("ソリューションアーキテクト（プリセールス）")
    assert filters.is_english_title("AI Automation & Data Operations Intern")

    gh_ref = JobSourceRef(adapter="greenhouse", originalUrl="https://boards.greenhouse.io/test/1")

    # 2. Reject overseas physical onsite role (San Francisco, Tokyo, London)
    sf_job = CanonicalJob(
        id="j-sf",
        title="Software Engineer",
        company="Scale AI",
        location="San Francisco, CA",
        workMode="onsite",
        description="Work in SF office",
        sourceRef=gh_ref,
    )
    passes_sf, reason_sf = filters.passes_hard_filters(sf_job)
    assert not passes_sf
    assert "Location" in reason_sf

    # 3. Accept Remote role
    remote_job = CanonicalJob(
        id="j-remote",
        title="Full Stack AI Developer Intern",
        company="Acme Corp",
        location="Remote (India / US Flexible)",
        workMode="remote",
        description="Build automation with Python and React",
        requiredSkills=["Python", "FastAPI", "React"],
        sourceRef=gh_ref,
    )
    passes_remote, _ = filters.passes_hard_filters(remote_job)
    assert passes_remote

    # 4. Accept India physical role (Hyderabad / Bangalore / Mumbai)
    india_job = CanonicalJob(
        id="j-india",
        title="Data Analyst Intern",
        company="DataLabs India",
        location="Hyderabad, India",
        workMode="hybrid",
        category="data",
        description="SQL and Python analytics",
        requiredSkills=["Python", "SQL"],
        sourceRef=gh_ref,
    )
    passes_india, _ = filters.passes_hard_filters(india_job)
    assert passes_india


def test_experience_penalty_for_freshers():
    """Verify senior roles (3+ and 5+ yrs) and missing skills are penalized for fresher candidates."""
    engine = MatchingEngineService()
    profile = Profile(
        id="p1",
        userId="u1",
        version=1,
        personal={"fullName": "Mohammed Affan Razvi", "email": "test@example.com"},
        skills=[
            SkillFact(id="s1", name="Python", verified=True),
            SkillFact(id="s2", name="Playwright", verified=True),
        ],
    )

    gh_ref = JobSourceRef(adapter="greenhouse", originalUrl="https://boards.greenhouse.io/test/1")

    # 1. Fresher role (0-1 yrs)
    fresher_job = CanonicalJob(
        id="j-fresh",
        title="AI Automation Intern",
        company="Scale AI",
        location="Remote",
        workMode="remote",
        seniority="internship",
        experienceYearsRequired=0.0,
        requiredSkills=["Python", "Playwright"],
        description="Intern role",
        sourceRef=gh_ref,
    )
    fresh_score, fresh_tier, _, _ = engine.compute_fit_score(fresher_job, profile)
    assert fresh_score >= 90
    assert fresh_tier == "Strong"

    # 2. 3+ years experience role (e.g. Assistant Manager / Cloud Associate)
    mid_job = CanonicalJob(
        id="j-mid",
        title="Cloud Billing Associate",
        company="Elastic",
        location="Bangalore, India",
        workMode="onsite",
        experienceYearsRequired=3.0,
        requiredSkills=["Communication", "Excel", "SQL", "AWS", "Azure"],
        description="Role requiring 3+ years experience",
        sourceRef=gh_ref,
    )
    mid_score, mid_tier, _, missing_mid = engine.compute_fit_score(mid_job, profile)
    assert mid_score < 50
    assert mid_tier in ("Low", "Not a Match")
    assert len(missing_mid) > 0

    # 3. Leadership / Associate Director role
    director_job = CanonicalJob(
        id="j-dir",
        title="Associate Director - Commerce Platform",
        company="Meesho",
        location="Bangalore, Karnataka",
        workMode="hybrid",
        experienceYearsRequired=3.0,
        requiredSkills=["Communication"],
        description="Leadership director role",
        sourceRef=gh_ref,
    )
    dir_score, dir_tier, _, _ = engine.compute_fit_score(director_job, profile)
    assert dir_score < 40
    assert dir_tier in ("Low", "Not a Match")

    # 4. Senior role (5+ yrs) with exact same skills
    senior_job = CanonicalJob(
        id="j-sen",
        title="Senior AI Infrastructure Principal",
        company="Scale AI",
        location="Remote",
        workMode="remote",
        seniority="senior",
        experienceYearsRequired=5.0,
        requiredSkills=["Python", "Playwright"],
        description="Senior role requiring 5+ years",
        sourceRef=gh_ref,
    )
    sen_score, sen_tier, _, _ = engine.compute_fit_score(senior_job, profile)
    assert sen_score < 60
    assert sen_tier in ("Low", "Not a Match")


@pytest.mark.asyncio
async def test_recommendations_api(async_client: AsyncClient):
    """Verify GET /api/v1/recommendations returns filtered and scored jobs."""
    await async_client.post(
        "/api/v1/jobs/ingest-text",
        json={
            "title": "AI Workflow Automation Intern (Remote)",
            "company": "ScaleAI Labs",
            "text": "Looking for an intern skilled in Python, Playwright, and FastAPI. Pay is $120k - $140k / year.",
        },
    )

    res = await async_client.get("/api/v1/recommendations")
    assert res.status_code == 200
    data = res.json()
    assert len(data) > 0
    top_job = data[0]
    assert "fitScore" in top_job
    assert "fitReason" in top_job
    assert "experienceText" in top_job
    assert top_job["fitScore"] >= 70
