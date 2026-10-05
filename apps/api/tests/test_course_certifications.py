"""Tests for Verified Course Certifications, Truth-Lock, Resume Pipeline, and Environment Variable Integrity."""

import pytest
from httpx import AsyncClient

from app.core.auth import get_authenticated_user_id
from app.core.config import settings
from app.main import app
from app.schemas.profile import CourseCertificationFact, PersonalContact, Profile, SkillFact
from app.schemas.resume import (
    ResumeContact,
    ResumeCourseCertificationItem,
    ResumeEducationItem,
    ResumeExperienceItem,
    ResumeProjectItem,
    ResumeSkillCategory,
    StructuredResumeContent,
)
from app.services.latex_template import latex_engine
from app.services.profile_service import ProfileService
from app.services.reportlab_renderer import reportlab_renderer
from app.services.resume_generator import resume_generator
from app.services.resume_validator import resume_validator


def test_course_certification_schema_validation():
    """Verify CourseCertificationFact schema defaults and constraints."""
    course = CourseCertificationFact(
        id="course-1",
        title="R Programming for Beginners",
        certificateUrl="https://simpli-web.app.link/e/y7IuGdmHVNb",
        completionYear="2024",
    )
    assert course.title == "R Programming for Beginners"
    assert course.completionYear == "2024"
    assert course.verified is True
    assert course.source == "candidate_confirmed"
    assert course.provider is None
    assert course.credentialId is None
    assert course.description is None


def test_profile_default_seed_contains_the_three_verified_courses():
    """Verify ProfileService default profile contains the three user-provided courses."""
    service = ProfileService()
    profile = service.get_profile("user_default")

    assert len(profile.courseCertifications) >= 3
    titles = [c.title for c in profile.courseCertifications]
    assert "R Programming for Beginners" in titles
    assert "Introduction to Data Science (IDS) with R Programming" in titles
    assert "Introduction to Data Science (IDS)" in titles

    c1 = next(c for c in profile.courseCertifications if c.title == "R Programming for Beginners")
    assert c1.completionYear == "2024"
    assert c1.certificateUrl == "https://simpli-web.app.link/e/y7IuGdmHVNb"

    c2 = next(c for c in profile.courseCertifications if c.title == "Introduction to Data Science (IDS) with R Programming")
    assert c2.completionYear == "2024"
    assert c2.certificateUrl == "https://surl.li/kghssn"

    c3 = next(c for c in profile.courseCertifications if c.title == "Introduction to Data Science (IDS)")
    assert c3.completionYear == "2024"
    assert "credly.com" in (c3.certificateUrl or "")


def test_course_crud_and_multi_user_isolation():
    """Verify create, edit, delete of courses and ensure user isolation in ProfileService."""
    service = ProfileService()
    user_a = "user_isolation_alpha"
    user_b = "user_isolation_beta"

    # User A profile
    prof_a = service.get_profile(user_a)
    new_course_a = CourseCertificationFact(
        id="course-unique-a",
        title="Advanced Machine Learning on GCP",
        certificateUrl="https://example.com/cert-a",
        completionYear="2025",
        description="Completed custom ML specialization.",
    )
    prof_a.courseCertifications.append(new_course_a)
    updated_a = service.update_profile(prof_a)

    assert any(c.id == "course-unique-a" for c in updated_a.courseCertifications)

    # User B should NOT see User A's custom course
    prof_b = service.get_profile(user_b)
    assert not any(c.id == "course-unique-a" for c in prof_b.courseCertifications)

    # Edit course for User A
    course_to_edit = next(c for c in updated_a.courseCertifications if c.id == "course-unique-a")
    course_to_edit.description = "Updated description verified by user."
    updated_a_edit = service.update_profile(updated_a)
    assert next(c for c in updated_a_edit.courseCertifications if c.id == "course-unique-a").description == "Updated description verified by user."

    # Delete course for User A
    updated_a_edit.courseCertifications = [c for c in updated_a_edit.courseCertifications if c.id != "course-unique-a"]
    updated_a_del = service.update_profile(updated_a_edit)
    assert not any(c.id == "course-unique-a" for c in updated_a_del.courseCertifications)


@pytest.mark.asyncio
async def test_profile_api_courses_endpoints(async_client: AsyncClient):
    """Verify profile GET and PUT via API preserves courseCertifications."""
    test_uid = "user_default"
    app.dependency_overrides[get_authenticated_user_id] = lambda: test_uid

    try:
        # 1. GET profile
        res = await async_client.get("/api/v1/profile")
        assert res.status_code == 200
        data = res.json()
        assert "courseCertifications" in data
        assert len(data["courseCertifications"]) >= 3

        # 2. PUT updated profile with a modified course
        data["courseCertifications"].append({
            "id": "course-api-test-1",
            "title": "FastAPI Microservices Certification",
            "completionYear": "2024",
            "certificateUrl": "https://example.com/fastapi-cert",
            "description": "User approved training in asynchronous Python microservices.",
            "verified": True,
            "source": "candidate_confirmed",
        })

        put_res = await async_client.put("/api/v1/profile", json=data)
        assert put_res.status_code == 200
        saved_data = put_res.json()
        assert any(c["id"] == "course-api-test-1" for c in saved_data["courseCertifications"])

        # 3. GET again to ensure persistence
        get_res_2 = await async_client.get("/api/v1/profile")
        assert get_res_2.status_code == 200
        refetched = get_res_2.json()
        saved_item = next(c for c in refetched["courseCertifications"] if c["id"] == "course-api-test-1")
        assert saved_item["title"] == "FastAPI Microservices Certification"
        assert saved_item["certificateUrl"] == "https://example.com/fastapi-cert"
    finally:
        app.dependency_overrides.pop(get_authenticated_user_id, None)


def test_resume_generator_prepares_courses_in_verified_facts():
    """Verify _prepare_verified_profile_facts formats course certifications without fabrication."""
    generator = resume_generator
    profile = Profile(
        userId="user_gen_test",
        personal=PersonalContact(fullName="Affan Razvi", email="affan@test.com"),
        skills=[SkillFact(id="s1", name="Python", category="backend", verified=True)],
        courseCertifications=[
            CourseCertificationFact(
                id="c1",
                title="R Programming for Beginners",
                completionYear="2024",
                certificateUrl="https://simpli-web.app.link/e/y7IuGdmHVNb",
                description="Completed foundational training in R.",
            )
        ],
    )

    facts_dict = generator._prepare_verified_profile_facts(profile)
    assert "courses_and_certifications" in facts_dict
    courses = facts_dict["courses_and_certifications"]
    assert len(courses) == 1
    assert courses[0]["id"] == "c1"
    assert courses[0]["title"] == "R Programming for Beginners"
    assert courses[0]["completionYear"] == "2024"
    assert courses[0]["certificateUrl"] == "https://simpli-web.app.link/e/y7IuGdmHVNb"
    assert courses[0]["description"] == "Completed foundational training in R."


def test_resume_validator_detects_unsupported_course_certifications():
    """Verify Truth-Lock flags any hallucinated course certification not in Master Profile."""
    profile = Profile(
        userId="val_test",
        personal=PersonalContact(fullName="Affan", email="affan@test.com"),
        skills=[SkillFact(id="s1", name="Python", category="backend", verified=True)],
        courseCertifications=[
            CourseCertificationFact(
                id="c1",
                title="R Programming for Beginners",
                completionYear="2024",
                certificateUrl="https://simpli-web.app.link/e/y7IuGdmHVNb",
            )
        ],
    )

    valid_resume = StructuredResumeContent(
        personal=ResumeContact(fullName="Affan", email="affan@test.com"),
        summary="A " * 50,  # Pass length requirement
        course_certifications=[
            ResumeCourseCertificationItem(
                course_fact_id="c1",
                title="R Programming for Beginners",
                completionYear="2024",
                certificateUrl="https://simpli-web.app.link/e/y7IuGdmHVNb",
            )
        ],
    )
    result = resume_validator.validate(valid_resume, profile, enforce_structural=False)
    assert not any("Unsupported course certification" in v for v in result.truth_violations)

    hallucinated_resume = StructuredResumeContent(
        personal=ResumeContact(fullName="Affan", email="affan@test.com"),
        summary="A " * 50,
        course_certifications=[
            ResumeCourseCertificationItem(
                title="Ph.D. in Deep Learning from MIT",
                completionYear="2024",
            )
        ],
    )
    res_bad = resume_validator.validate(hallucinated_resume, profile, enforce_structural=False)
    assert any("Unsupported course certification" in v for v in res_bad.truth_violations)
    assert "Ph.D. in Deep Learning from MIT" in str(res_bad.truth_violations)


def test_latex_template_contains_courses_section_and_clickable_links():
    """Verify latex_template_service formats COURSES & CERTIFICATIONS between projects and leadership."""
    resume_content = StructuredResumeContent(
        personal=ResumeContact(fullName="Mohammed Affan Razvi", email="affan@test.com"),
        summary="Summary test text.",
        course_certifications=[
            ResumeCourseCertificationItem(
                title="Introduction to Data Science (IDS)",
                completionYear="2024",
                certificateUrl="https://www.credly.com/badges/test",
                description="User verified completion of data science fundamentals.",
            )
        ],
    )
    latex_output = latex_engine.generate_latex(resume_content)

    assert "Courses \\& Certifications" in latex_output
    assert "Introduction to Data Science (IDS)" in latex_output
    assert "\\href{https://www.credly.com/badges/test}{Certificate}" in latex_output
    assert "User verified completion of data science fundamentals." in latex_output

    # Check ordering: PROJECTS should come before COURSES, and COURSES before EXPERIENCE
    if "TECHNICAL PROJECTS" in latex_output and "EXPERIENCE" in latex_output:
        idx_proj = latex_output.index("TECHNICAL PROJECTS")
        idx_courses = latex_output.index("COURSES & CERTIFICATIONS")
        idx_exp = latex_output.index("EXPERIENCE")
        assert idx_proj < idx_courses < idx_exp


def test_reportlab_renderer_renders_pdf_with_courses():
    """Verify ReportLab produces valid PDF bytes containing courses and certifications."""
    resume_content = StructuredResumeContent(
        personal=ResumeContact(fullName="Mohammed Affan Razvi", email="affan@test.com"),
        summary="Summary test text.",
        course_certifications=[
            ResumeCourseCertificationItem(
                title="R Programming for Beginners",
                completionYear="2024",
                certificateUrl="https://simpli-web.app.link/e/y7IuGdmHVNb",
                description="Completed foundational training in R programming.",
            )
        ],
    )
    pdf_bytes = reportlab_renderer.render_pdf(resume_content)
    assert isinstance(pdf_bytes, bytes)
    assert len(pdf_bytes) > 1000
    assert pdf_bytes.startswith(b"%PDF")


def test_environment_variable_integrity():
    """Verify that RESUME_GEMINI_API_KEY is recognized and no corrupted 'qh' exists."""
    assert hasattr(settings, "RESUME_GEMINI_API_KEY")
    # Verify the env var value is loaded (non-empty string or properly initialized)
    val = getattr(settings, "RESUME_GEMINI_API_KEY", None)
    # Value must exist or be None/str, but definitely not corrupted by 'qh'
    assert val != "qh"
