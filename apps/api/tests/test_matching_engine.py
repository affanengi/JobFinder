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
    assert fresh_score is not None
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
    assert mid_score is not None
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
    assert dir_score is not None
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
    assert sen_score is not None
    assert sen_score < 60
    assert sen_tier in ("Low", "Not a Match")


def test_empty_profile_returns_unscored():
    """Verify empty or incomplete profile returns Unscored (None) instead of fake numbers."""
    engine = MatchingEngineService()
    empty_profile = Profile(
        id="p-empty",
        userId="u-empty",
        personal={"fullName": "New User", "email": "new@example.com"},
        skills=[],
        experience=[],
        projects=[],
    )
    gh_ref = JobSourceRef(adapter="greenhouse", originalUrl="https://boards.greenhouse.io/test/1")
    job = CanonicalJob(
        id="j-test",
        title="Python Engineer",
        company="TechCorp",
        location="Remote",
        workMode="remote",
        requiredSkills=["Python", "FastAPI"],
        description="Python backend developer",
        sourceRef=gh_ref,
    )
    score, tier, matched, missing = engine.compute_fit_score(job, empty_profile)
    assert score is None
    assert tier == "Unscored"
    assert len(matched) == 0


def test_empty_job_skills_does_not_produce_artificial_high_score():
    """Verify job with no required skills listed does not produce artificially inflated 85%+ score."""
    engine = MatchingEngineService()
    profile = Profile(
        id="p-user",
        userId="u-user",
        personal={"fullName": "Test User", "email": "test@example.com"},
        skills=[SkillFact(id="s1", name="Rust", verified=True)],
        experience=[],
        projects=[],
    )
    gh_ref = JobSourceRef(adapter="greenhouse", originalUrl="https://boards.greenhouse.io/test/1")
    job_no_skills = CanonicalJob(
        id="j-no-skills",
        title="Operations Coordinator",
        company="GlobalLogistics",
        location="Remote",
        workMode="remote",
        requiredSkills=[],
        description="General administrative coordination and reporting.",
        sourceRef=gh_ref,
    )
    score, tier, matched, missing = engine.compute_fit_score(job_no_skills, profile)
    assert score is not None
    # Must NOT produce the reported bug score of 85-94%
    assert score < 70
    assert tier in ("Moderate", "Low", "Not a Match")


@pytest.mark.asyncio
async def test_recommendations_api(async_client: AsyncClient):
    """Verify GET /api/v1/recommendations returns Unscored for guests and empty profiles, and high fit for complete profiles."""
    await async_client.post(
        "/api/v1/jobs/ingest-text",
        json={
            "title": "AI Workflow Automation Intern (Remote)",
            "company": "ScaleAI Labs",
            "text": "Looking for an intern skilled in Python, Playwright, and FastAPI. Pay is $120k - $140k / year.",
        },
    )

    from app.services.profile_service import profile_service

    auth_headers = {"Authorization": "Bearer user_default_test"}

    # 1. Unauthenticated guest request -> returns Unscored with sign-in guidance
    res_guest = await async_client.get("/api/v1/recommendations")
    assert res_guest.status_code == 200
    guest_data = res_guest.json()
    assert len(guest_data) > 0
    guest_job = guest_data[0]
    assert guest_job["fitScore"] is None
    assert guest_job["matchTier"] == "Unscored"
    assert "Sign in and complete your Master Profile" in guest_job["fitReason"]
    assert guest_job["matchedSkills"] == []
    assert guest_job["missingSkills"] == []

    # 2. Authenticated user with empty profile -> returns Unscored with profile completion guidance
    user_profile = profile_service.get_profile("user_default_test")
    user_profile.skills = []
    user_profile.experience = []
    user_profile.projects = []
    profile_service.update_profile(user_profile)

    res_empty = await async_client.get("/api/v1/recommendations", headers=auth_headers)
    assert res_empty.status_code == 200
    empty_data = res_empty.json()
    assert len(empty_data) > 0
    top_job = empty_data[0]
    assert top_job["fitScore"] is None
    assert top_job["matchTier"] == "Unscored"
    assert "Profile incomplete" in top_job["fitReason"]

    # 3. Add verified skills to candidate profile
    user_profile.skills = [
        SkillFact(id="s-py", name="Python", verified=True),
        SkillFact(id="s-pw", name="Playwright", verified=True),
        SkillFact(id="s-fa", name="FastAPI", verified=True),
    ]
    profile_service.update_profile(user_profile)

    # 4. Authenticated request after adding verified skills -> calibrated match score >= 70
    res_updated = await async_client.get("/api/v1/recommendations", headers=auth_headers)
    assert res_updated.status_code == 200
    updated_data = res_updated.json()
    assert len(updated_data) > 0
    scored_job = updated_data[0]
    assert scored_job["fitScore"] is not None
    assert scored_job["fitScore"] >= 70
    assert scored_job["matchTier"] in ("Strong", "Good")

    # 5. Subsequent unauthenticated guest request still returns Unscored (zero leakage of user profile)
    res_guest_after = await async_client.get("/api/v1/recommendations")
    assert res_guest_after.status_code == 200
    guest_after_job = res_guest_after.json()[0]
    assert guest_after_job["fitScore"] is None
    assert guest_after_job["matchTier"] == "Unscored"
    assert "Sign in and complete your Master Profile" in guest_after_job["fitReason"]
