"""Tests for Resume API Endpoints with Mock AI Provider."""

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.schemas.job import CanonicalJob, JobSourceRef
from app.schemas.resume import (
    ResumeBullet,
    ResumeContact,
    ResumeEducationItem,
    ResumeExperienceItem,
    ResumeJobAlignment,
    ResumeProjectItem,
    ResumeSkillCategory,
    StructuredResumeContent,
)
from app.services.job_service import job_service
from app.services.resume_generator import resume_generator

client = TestClient(app)


@pytest.fixture
def setup_mock_job_and_ai(monkeypatch):
    # Setup a mock job in job_service
    test_job = CanonicalJob(
        id="job-test-123",
        title="Python Backend Developer",
        company="InnoTech",
        location="Hyderabad, India",
        workMode="remote",
        category="technical",
        employmentType="full_time",
        seniority="entry",
        description="Seeking Python and FastAPI developer.",
        requiredSkills=["Python", "FastAPI"],
        sourceRef=JobSourceRef(adapter="lever", originalUrl="https://jobs.lever.co/innotech/123"),
    )
    job_service._jobs["job-test-123"] = test_job

    # Mock AI response
    mock_structured = StructuredResumeContent(
        personal=ResumeContact(
            fullName="Affan Razvi",
            email="affan@test.com",
            phone="+91 98765 43210",
            city="Hyderabad",
        ),
        summary="Experienced Python developer.",
        skills=[ResumeSkillCategory(category="Languages", items=["Python"])],
        experience=[
            ResumeExperienceItem(
                company="Tech Corp",
                title="Intern",
                bullets=[ResumeBullet(text="Built backend services.")],
            )
        ],
        projects=[
            ResumeProjectItem(
                name="JobFinder",
                technologies=["Python", "FastAPI"],
                bullets=[ResumeBullet(text="Built career engine.")],
            )
        ],
        education=[
            ResumeEducationItem(
                institution="Osmania University",
                degree="B.Tech",
            )
        ],
        job_alignment=ResumeJobAlignment(
            matched_skills=["Python"],
            skill_gaps=["Docker"],
        ),
    )

    async def mock_generate(*args, **kwargs):
        return mock_structured

    monkeypatch.setattr(resume_generator.ai_provider, "generate_structured", mock_generate)
    return test_job


def test_tailor_resume_api(setup_mock_job_and_ai):
    """Test POST /api/v1/resumes/tailor returns structured resume with validation result."""
    response = client.post(
        "/api/v1/resumes/tailor",
        json={"job_id": "job-test-123", "user_id": "user_default"},
        headers={"X-User-Id": "user_default"},
    )
    assert response.status_code == 200
    data = response.json()
    assert "id" in data
    assert data["jobTitle"] == "Python Backend Developer"
    assert data["jobCompany"] == "InnoTech"
    assert "structuredContent" in data
    assert "validationResult" in data
    assert "latexCode" in data

    # Test PDF download endpoint
    resume_id = data["id"]
    pdf_resp = client.get(f"/api/v1/resumes/{resume_id}/pdf")
    assert pdf_resp.status_code == 200
    assert pdf_resp.headers["content-type"] == "application/pdf"
    assert pdf_resp.content.startswith(b"%PDF")

    # Test TEX download endpoint
    tex_resp = client.get(f"/api/v1/resumes/{resume_id}/tex")
    assert tex_resp.status_code == 200
    assert "\\documentclass" in tex_resp.text
