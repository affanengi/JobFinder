"""Unit and integration tests for Phase 1: Verified Lodestar Experience,
Courses & Certifications (including Dr. Angela Yu), Deterministic Course Reconstruction,
Resume Truth-Lock, and Section Ordering.
"""

import pytest

from app.schemas.profile import (
    CourseCertificationFact,
    EducationFact,
    ExperienceFact,
    PersonalContact,
    Profile,
    ProjectFact,
    SkillFact,
)
from app.schemas.resume import (
    ResumeBullet,
    ResumeContact,
    ResumeCourseCertificationItem,
    ResumeEducationItem,
    ResumeExperienceItem,
    ResumeProjectItem,
    ResumeSkillCategory,
    StructuredResumeContent,
)
from app.services.latex_template import latex_engine
from app.services.profile_migration_service import (
    MIGRATION_V1_LODESTAR_COURSES,
    ProfileMigrationService,
)
from app.services.profile_service import ProfileService
from app.services.reportlab_renderer import reportlab_renderer
from app.services.resume_generator import (
    ground_experience_and_leadership,
    reconstruct_verified_courses,
)
from app.services.resume_validator import resume_validator


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def canonical_profile():
    service = ProfileService()
    # default profile contains canonical Lodestar, Techniva, and 4 courses
    return service._init_default_profile("test_user_phase1")


# ---------------------------------------------------------------------------
# 1. Migration Tests
# ---------------------------------------------------------------------------

def test_migration_adds_lodestar_and_udemy_course_when_missing():
    """Profile without Lodestar or Udemy gets migrated and records migration version."""
    service = ProfileMigrationService()
    profile = Profile(
        userId="mig_user_1",
        personal=PersonalContact(fullName="Affan Razvi", email="affan@test.com"),
        skills=[SkillFact(id="s1", name="Python", category="backend", verified=True)],
        experience=[
            ExperienceFact(
                id="exp-techniva",
                company="Techniva Software Solutions",
                title="Lead Developer",
                startDate="2024",
                endDate="2026",
                category="leadership",
                bullets=["Led engineering team."],
            )
        ],
        courseCertifications=[],
        appliedMigrations=[],
    )

    updated, migrated = service.migrate_profile(profile)
    assert migrated is True
    assert MIGRATION_V1_LODESTAR_COURSES in updated.appliedMigrations

    # Verify Lodestar added
    lodestar = next((e for e in updated.experience if "Lodestar" in e.company), None)
    assert lodestar is not None
    assert lodestar.title == "Software Engineering Intern"
    assert lodestar.startDate == "Jun 2026"
    assert lodestar.endDate == "Aug 2026"
    assert lodestar.location == "Remote"
    assert lodestar.category == "work"
    assert any(("~14.6K" in b or "14.6K" in b) and "synthetic" in b.lower() for b in lodestar.bullets)

    # Verify Udemy course added with Dr. Angela Yu
    udemy = next((c for c in updated.courseCertifications if "Angela Yu" in (c.instructor or "")), None)
    assert udemy is not None
    assert udemy.provider == "Udemy"
    assert "udemy.com" in (udemy.certificateUrl or "")
    assert udemy.instructor == "Dr. Angela Yu"


def test_migration_is_idempotent_and_respects_version_marker():
    """Migration should not re-run if version marker is already present."""
    service = ProfileMigrationService()
    profile = Profile(
        userId="mig_user_2",
        personal=PersonalContact(fullName="Affan Razvi", email="affan@test.com"),
        appliedMigrations=[MIGRATION_V1_LODESTAR_COURSES],
        experience=[],
        courseCertifications=[],
    )

    updated, migrated = service.migrate_profile(profile)
    assert migrated is False
    # No items resurrect because migration is already recorded as applied!
    assert len(updated.experience) == 0
    assert len(updated.courseCertifications) == 0


def test_migration_does_not_resurrect_intentionally_deleted_items():
    """If user deleted Lodestar or a course after migration, subsequent checks do not resurrect them."""
    service = ProfileMigrationService()
    # 1. Run migration first time
    empty_profile = Profile(
        userId="mig_user_3",
        personal=PersonalContact(fullName="Affan Razvi", email="affan@test.com"),
        appliedMigrations=[],
    )
    profile, migrated = service.migrate_profile(empty_profile)
    assert migrated is True
    assert len(profile.experience) >= 1
    assert len(profile.courseCertifications) >= 4

    # 2. User deliberately deletes Lodestar and the Udemy course
    profile.experience = [e for e in profile.experience if "Lodestar" not in e.company]
    profile.courseCertifications = [c for c in profile.courseCertifications if "Angela Yu" not in (c.instructor or "")]

    # 3. Check migration again
    profile_after, migrated_again = service.migrate_profile(profile)
    assert migrated_again is False
    assert not any("Lodestar" in e.company for e in profile_after.experience)
    assert not any("Angela Yu" in (c.instructor or "") for c in profile_after.courseCertifications)


def test_migration_preserves_custom_bullets_on_existing_lodestar():
    """If profile already had Lodestar with custom bullets, migration does not clobber them."""
    service = ProfileMigrationService()
    profile = Profile(
        userId="mig_user_4",
        personal=PersonalContact(fullName="Affan Razvi", email="affan@test.com"),
        experience=[
            ExperienceFact(
                id="exp-lodestar-canonical",
                company="Lodestar Financial Systems",
                title="Software Engineering Intern",
                startDate="Jun 2026",
                endDate="Aug 2026",
                location="Remote",
                category="work",
                bullets=["User custom edited bullet 1", "User custom edited bullet 2"],
            )
        ],
        appliedMigrations=[],
    )

    updated, migrated = service.migrate_profile(profile)
    assert migrated is True
    lodestar = next(e for e in updated.experience if e.id == "exp-lodestar-canonical")
    assert lodestar.bullets == ["User custom edited bullet 1", "User custom edited bullet 2"]


# ---------------------------------------------------------------------------
# 2. Deterministic Course Reconstruction Tests
# ---------------------------------------------------------------------------

def test_reconstruct_verified_courses_guarantees_all_profile_courses():
    """AI returning partial or no courses results in deterministic append of all missing profile courses."""
    profile_courses = [
        CourseCertificationFact(
            id="c1",
            title="R Programming",
            provider="Simplilearn",
            completionYear="2024",
            certificateUrl="https://cert1.example.com",
            description="Learned basic R syntax.",
        ),
        CourseCertificationFact(
            id="c2",
            title="IDS with R",
            provider="Simplilearn",
            completionYear="2024",
            certificateUrl="https://cert2.example.com",
            description="Learned data science with R.",
        ),
        CourseCertificationFact(
            id="c3",
            title="Udemy Full-Stack Bootcamp",
            provider="Udemy",
            instructor="Dr. Angela Yu",
            completionYear="2024",
            certificateUrl="https://cert3.example.com",
            description="Full-stack web development.",
        ),
    ]

    # AI returned only c3
    ai_items = [
        ResumeCourseCertificationItem(
            course_fact_id="c3",
            title="AI Fabricated Title",
            provider="AI Provider",
            instructor="Fabricated Instructor",
            completionYear="1999",
            certificateUrl="https://fake.url",
            description="AI fabricated description.",
        )
    ]

    reconstructed = reconstruct_verified_courses(profile_courses, ai_items)

    assert len(reconstructed) == 3
    # c3 is first because AI ranked it first
    assert reconstructed[0].course_fact_id == "c3"
    # But properties are 100% grounded from the profile fact, NOT the AI payload!
    assert reconstructed[0].title == "Udemy Full-Stack Bootcamp"
    assert reconstructed[0].provider == "Udemy"
    assert reconstructed[0].instructor == "Dr. Angela Yu"
    assert reconstructed[0].completionYear == "2024"
    assert reconstructed[0].certificateUrl == "https://cert3.example.com"
    assert reconstructed[0].description == "Full-stack web development."

    # c1 and c2 are appended deterministically
    assert reconstructed[1].course_fact_id == "c1"
    assert reconstructed[2].course_fact_id == "c2"


def test_reconstruct_verified_courses_filters_hallucinations_and_duplicates():
    """Hallucinated course IDs are discarded and duplicate AI entries are deduplicated."""
    profile_courses = [
        CourseCertificationFact(id="c1", title="Course 1", completionYear="2024"),
        CourseCertificationFact(id="c2", title="Course 2", completionYear="2024"),
    ]

    ai_items = [
        ResumeCourseCertificationItem(course_fact_id="c1", title="Course 1"),
        ResumeCourseCertificationItem(course_fact_id="fake_id", title="Fake Course"),
        ResumeCourseCertificationItem(course_fact_id="c1", title="Course 1 Duplicate"),
    ]

    reconstructed = reconstruct_verified_courses(profile_courses, ai_items)
    assert len(reconstructed) == 2
    assert [c.course_fact_id for c in reconstructed] == ["c1", "c2"]


# ---------------------------------------------------------------------------
# 3. Grounding Experience and Leadership Tests
# ---------------------------------------------------------------------------

def test_ground_experience_and_leadership_separates_work_and_leadership(canonical_profile):
    """Ensures Lodestar is placed in experience and Techniva in leadership, even if AI swapped them."""
    structured = StructuredResumeContent(
        personal=ResumeContact(fullName="Affan Razvi", email="affan@example.com"),
        summary="Summary text.",
        education=[],
        skills=[],
        # AI incorrectly put Techniva in experience and Lodestar in leadership
        experience=[
            ResumeExperienceItem(
                company="Techniva Software Solutions",
                title="Lead Developer",
                startDate="2024",
                endDate="2026",
                location="Hyderabad, India",
                bullets=[ResumeBullet(text="Led team")],
            )
        ],
        leadership=[
            ResumeExperienceItem(
                company="Lodestar Financial Systems",
                title="Software Engineering Intern",
                startDate="Jun 2026",
                endDate="Aug 2026",
                location="Remote",
                bullets=[ResumeBullet(text="Built test harness")],
            )
        ],
        projects=[],
        course_certifications=[],
    )

    ground_experience_and_leadership(canonical_profile, structured)

    # Experience must contain Lodestar
    assert any("Lodestar" in e.company for e in structured.experience)
    assert not any("Techniva" in e.company for e in structured.experience)

    # Leadership must contain Techniva
    assert any("Techniva" in l.company for l in structured.leadership)
    assert not any("Lodestar" in l.company for l in structured.leadership)


# ---------------------------------------------------------------------------
# 4. Resume Truth-Lock Validator Tests
# ---------------------------------------------------------------------------

def test_truth_lock_rejects_altered_lodestar_title(canonical_profile):
    """Validator strictly rejects any altered Lodestar role title."""
    resume = StructuredResumeContent(
        personal=ResumeContact(fullName="Affan Razvi", email="affan@example.com"),
        summary="Summary text.",
        education=[],
        skills=[],
        experience=[
            ResumeExperienceItem(
                company="Lodestar",
                title="Senior Backend Engineer",  # Fabricated title!
                startDate="Jun 2026",
                endDate="Aug 2026",
                location="Remote",
                bullets=[ResumeBullet(text="Synthesized ~14.6K synthetic/test events.")],
            )
        ],
        leadership=[],
        projects=[],
        course_certifications=[
            ResumeCourseCertificationItem(
                course_fact_id=c.id,
                title=c.title,
                provider=c.provider,
                instructor=c.instructor,
                completionYear=c.completionYear,
                certificateUrl=c.certificateUrl,
                description=c.description,
            )
            for c in canonical_profile.courseCertifications
        ],
    )

    result = resume_validator.validate(resume, canonical_profile, enforce_structural=False)
    assert result.is_valid is False
    assert any("Software Engineering Intern" in err for err in result.truth_violations)


def test_truth_lock_rejects_production_claims_on_synthetic_events(canonical_profile):
    """Validator strictly rejects claiming ~14.6K events were live production customer traffic."""
    resume = StructuredResumeContent(
        personal=ResumeContact(fullName="Affan Razvi", email="affan@example.com"),
        summary="Summary text.",
        education=[],
        skills=[],
        experience=[
            ResumeExperienceItem(
                company="Lodestar",
                title="Software Engineering Intern",
                startDate="Jun 2026",
                endDate="Aug 2026",
                location="Remote",
                bullets=[ResumeBullet(text="Processed ~14.6K real user transactions in live production environment.")],
            )
        ],
        leadership=[],
        projects=[],
        course_certifications=[
            ResumeCourseCertificationItem(
                course_fact_id=c.id,
                title=c.title,
                provider=c.provider,
                instructor=c.instructor,
                completionYear=c.completionYear,
                certificateUrl=c.certificateUrl,
                description=c.description,
            )
            for c in canonical_profile.courseCertifications
        ],
    )

    result = resume_validator.validate(resume, canonical_profile, enforce_structural=False)
    assert result.is_valid is False
    assert any("synthetic" in err.lower() or "production" in err.lower() for err in result.truth_violations)


def test_truth_lock_accepts_valid_synthetic_event_wording(canonical_profile):
    """Validator accepts faithful phrasing regarding the ~14.6K synthetic/test events."""
    resume = StructuredResumeContent(
        personal=ResumeContact(fullName="Affan Razvi", email="mohammedaffanrazvi604@gmail.com"),
        summary="Summary text with sufficient length.",
        education=[],
        skills=[],
        experience=[
            ResumeExperienceItem(
                company="Lodestar",
                title="Software Engineering Intern",
                startDate="Jun 2026",
                endDate="Aug 2026",
                location="Remote",
                bullets=[ResumeBullet(text="Engineered mock financial server processing ~14.6K synthetic/test events across ~40 simulated test sessions.")],
            )
        ],
        leadership=[],
        projects=[],
        course_certifications=[
            ResumeCourseCertificationItem(
                course_fact_id=c.id,
                title=c.title,
                provider=c.provider,
                instructor=c.instructor,
                completionYear=c.completionYear,
                certificateUrl=c.certificateUrl,
                description=c.description,
            )
            for c in canonical_profile.courseCertifications
        ],
    )

    result = resume_validator.validate(resume, canonical_profile, enforce_structural=False)
    # No Lodestar-specific errors in truth_violations
    assert not any("Lodestar" in err for err in result.truth_violations)


def test_truth_lock_rejects_altered_course_instructor(canonical_profile):
    """Validator rejects altering instructor name for a course certification."""
    course_items = [
        ResumeCourseCertificationItem(
            course_fact_id=c.id,
            title=c.title,
            provider=c.provider,
            instructor=c.instructor,
            completionYear=c.completionYear,
            certificateUrl=c.certificateUrl,
            description=c.description,
        )
        for c in canonical_profile.courseCertifications
    ]
    # Alter Udemy instructor
    udemy_item = next(c for c in course_items if c.provider == "Udemy")
    udemy_item.instructor = "Fabricated Professor"

    resume = StructuredResumeContent(
        personal=ResumeContact(fullName="Affan Razvi", email="affan@example.com"),
        summary="Summary text.",
        education=[],
        skills=[],
        experience=[],
        leadership=[],
        projects=[],
        course_certifications=course_items,
    )

    result = resume_validator.validate(resume, canonical_profile, enforce_structural=False)
    assert result.is_valid is False
    assert any("instructor" in err.lower() for err in result.truth_violations)


def test_truth_lock_rejects_missing_course_certification(canonical_profile):
    """Validator rejects omitting any verified course present in profile."""
    course_items = [
        ResumeCourseCertificationItem(
            course_fact_id=c.id,
            title=c.title,
            provider=c.provider,
            instructor=c.instructor,
            completionYear=c.completionYear,
            certificateUrl=c.certificateUrl,
            description=c.description,
        )
        for c in canonical_profile.courseCertifications[:-1]  # Omit the last course
    ]

    resume = StructuredResumeContent(
        personal=ResumeContact(fullName="Affan Razvi", email="affan@example.com"),
        summary="Summary text.",
        education=[],
        skills=[],
        experience=[],
        leadership=[],
        projects=[],
        course_certifications=course_items,
    )

    result = resume_validator.validate(resume, canonical_profile, enforce_structural=False)
    assert result.is_valid is False
    assert any("missing verified course" in err.lower() for err in result.truth_violations)


# ---------------------------------------------------------------------------
# 5. Resume Section Ordering Tests (LaTeX & ReportLab)
# ---------------------------------------------------------------------------

def test_latex_section_ordering():
    """Verify LaTeX template renders sections in the canonical order:
    Header -> Professional Summary -> Education -> Technical Skills -> Experience -> Technical Projects -> Courses & Certifications -> Leadership & Activities
    """
    resume = StructuredResumeContent(
        personal=ResumeContact(fullName="Affan Razvi", email="affan@test.com", phone="1234567890"),
        summary="Professional summary text.",
        education=[ResumeEducationItem(institution="Osmania University", degree="B.E. CSE", endDate="2026")],
        skills=[ResumeSkillCategory(category="Languages", items=["Python", "TypeScript"])],
        experience=[ResumeExperienceItem(company="Lodestar", title="Software Engineering Intern", startDate="Jun 2026", endDate="Aug 2026", bullets=[ResumeBullet(text="Built mock server")])],
        projects=[ResumeProjectItem(name="JobFinder AI", bullets=[ResumeBullet(text="FastAPI backend")])],
        course_certifications=[
            ResumeCourseCertificationItem(
                course_fact_id="c1",
                title="Udemy Full-Stack Web Development",
                provider="Udemy",
                instructor="Dr. Angela Yu",
                completionYear="2024",
                certificateUrl="https://sur.li/qpvqaa",
                description="Comprehensive full-stack course.",
            )
        ],
        leadership=[ResumeExperienceItem(company="Techniva Software Solutions", title="Lead Developer", startDate="2024", endDate="2026", bullets=[ResumeBullet(text="Led technical workshops")])],
    )

    latex_code = latex_engine.generate_latex(resume)

    # Check section indices
    idx_summary = latex_code.find(r"\section{Professional Summary}")
    idx_education = latex_code.find(r"\section{Education}")
    idx_skills = latex_code.find(r"\section{Technical Skills}")
    idx_experience = latex_code.find(r"\section{Experience}")
    idx_projects = latex_code.find(r"\section{Technical Projects}")
    idx_courses = latex_code.find(r"\section{Courses \& Certifications}")
    idx_leadership = latex_code.find(r"\section{Leadership \& Activities}")

    assert idx_summary != -1
    assert idx_education != -1
    assert idx_skills != -1
    assert idx_experience != -1
    assert idx_projects != -1
    assert idx_courses != -1
    assert idx_leadership != -1

    assert idx_summary < idx_education < idx_skills < idx_experience < idx_projects < idx_courses < idx_leadership

    # Check provider and instructor rendering in LaTeX
    assert "Udemy" in latex_code
    assert "Dr. Angela Yu" in latex_code


def test_reportlab_section_ordering():
    """Verify ReportLab PDF renderer generates valid PDF bytes with leadership & courses."""
    resume = StructuredResumeContent(
        personal=ResumeContact(fullName="Affan Razvi", email="affan@test.com", phone="1234567890"),
        summary="Professional summary text.",
        education=[ResumeEducationItem(institution="Osmania University", degree="B.E. CSE", endDate="2026")],
        skills=[ResumeSkillCategory(category="Languages", items=["Python", "TypeScript"])],
        experience=[ResumeExperienceItem(company="Lodestar", title="Software Engineering Intern", startDate="Jun 2026", endDate="Aug 2026", bullets=[ResumeBullet(text="Built mock server")])],
        projects=[ResumeProjectItem(name="JobFinder AI", bullets=[ResumeBullet(text="FastAPI backend")])],
        course_certifications=[
            ResumeCourseCertificationItem(
                course_fact_id="c1",
                title="Udemy Full-Stack Web Development",
                provider="Udemy",
                instructor="Dr. Angela Yu",
                completionYear="2024",
                certificateUrl="https://sur.li/qpvqaa",
                description="Comprehensive full-stack course.",
            )
        ],
        leadership=[ResumeExperienceItem(company="Techniva Software Solutions", title="Lead Developer", startDate="2024", endDate="2026", bullets=[ResumeBullet(text="Led technical workshops")])],
    )

    pdf_bytes = reportlab_renderer.render_pdf(resume)
    assert pdf_bytes is not None
    assert len(pdf_bytes) > 500
    assert pdf_bytes.startswith(b"%PDF")


def test_get_profile_is_pure_read_and_does_not_invoke_migration_service(monkeypatch):
    """Calling get_profile() is a pure read and must NOT invoke profile_migration_service.migrate_profile()."""
    from app.services.profile_migration_service import profile_migration_service
    from app.services.profile_service import profile_service

    migration_invoked = False

    def fake_migrate_profile(*args, **kwargs):
        nonlocal migration_invoked
        migration_invoked = True
        return args[0], False

    monkeypatch.setattr(profile_migration_service, "migrate_profile", fake_migrate_profile)

    # 1. Fetching existing profile (e.g. user_default) must not invoke migration
    p1 = profile_service.get_profile("user_default")
    assert p1 is not None
    assert migration_invoked is False

    # 2. Fetching authenticated user profile must not invoke migration
    p2 = profile_service.get_profile("Sf0isG4mUuXwTQTWWwG1Wf4aIM82")
    assert p2 is not None
    assert migration_invoked is False

    # 3. Explicit sync_verified_profile DOES invoke migration
    profile_service.sync_verified_profile("user_default")
    assert migration_invoked is True


@pytest.mark.asyncio
async def test_api_get_profile_pure_read_and_explicit_migrate_endpoint(async_client):
    """GET /profile is a pure read and does not execute migration; POST /profile/migrate explicitly triggers it."""
    from app.core.auth import get_authenticated_user_id
    from app.main import app

    test_uid = "Sf0isG4mUuXwTQTWWwG1Wf4aIM82"
    app.dependency_overrides[get_authenticated_user_id] = lambda: test_uid

    try:
        # GET profile is pure read
        res_get = await async_client.get("/api/v1/profile")
        assert res_get.status_code == 200
        data = res_get.json()
        work_exp = [e for e in data["experience"] if e.get("category") == "work"]
        lead_exp = [e for e in data["experience"] if e.get("category") == "leadership"]
        assert len(work_exp) == 1
        assert work_exp[0]["company"] == "Lodestar"
        assert len(lead_exp) == 1
        assert "techniva" in lead_exp[0]["company"].lower()
        assert len(data.get("courseCertifications", [])) >= 4

        # POST /profile/migrate works explicitly
        res_mig = await async_client.post("/api/v1/profile/migrate")
        assert res_mig.status_code == 200
        mig_data = res_mig.json()
        assert mig_data["userId"] == test_uid
    finally:
        app.dependency_overrides.pop(get_authenticated_user_id, None)

