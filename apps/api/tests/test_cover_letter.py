"""Unit tests for Unified AI Resume & Cover Letter Generation, ReportLab PDF, and Deterministic Validator."""

import pytest
from httpx import AsyncClient

from app.schemas.application_artifacts import UnifiedApplicationArtifacts
from app.schemas.cover_letter import CoverLetterContent
from app.schemas.profile import PersonalContact, Profile, SkillFact
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
from app.services.cover_letter_validator import cover_letter_validator
from app.services.cover_letter_latex_template import cover_letter_latex_engine

def test_cover_letter_latex_generator():
    """Verify LaTeX generation produces valid Overleaf-compatible code."""
    content = CoverLetterContent(
        fullName="Mohammed Affan Razvi",
        email="affan@example.com",
        phone="+91 9876543210",
        city="Hyderabad",
        country="India",
        linkedin="https://linkedin.com/in/affan",
        github="https://github.com/affan",
        companyName="ScaleAI Labs",
        jobTitle="AI Automation Intern",
        date="September 4, 2026",
        greeting="Dear Hiring Team at ScaleAI Labs,",
        subject="Application for AI Automation Intern",
        paragraph1_hook="I am writing to express my strong interest in the AI Automation Intern role.",
        paragraph2_evidence="During my engineering projects, I architected automated workflow pipelines using Python.",
        paragraph3_impact="I look forward to discussing how I can contribute to your team.",
        signOff="Sincerely,",
    )
    tex = cover_letter_latex_engine.generate_latex(content)
    assert r"\documentclass[letterpaper,10pt]{article}" in tex
    assert "Mohammed Affan Razvi" in tex
    assert "Hyderabad, India" in tex
    assert "ScaleAI Labs" in tex
    assert "Subject: Application for AI Automation Intern" in tex

from app.services.job_service import job_service
from app.services.reportlab_cover_letter_renderer import reportlab_cover_letter_renderer
from app.services.resume_generator import format_cover_letter_markdown, resume_generator


def test_cover_letter_validator():
    """Verify deterministic validator flags missing required fields or short paragraphs."""
    profile = Profile(
        id="p1",
        userId="u1",
        version=1,
        personal=PersonalContact(fullName="Mohammed Affan Razvi", email="affan@example.com"),
        skills=[SkillFact(id="s1", name="Python", verified=True)],
    )

    valid_content = CoverLetterContent(
        fullName="Mohammed Affan Razvi",
        email="affan@example.com",
        phone="+91 9876543210",
        companyName="ScaleAI Labs",
        jobTitle="AI Automation Intern",
        date="September 4, 2026",
        greeting="Dear Hiring Team at ScaleAI Labs,",
        paragraph1_hook="I am writing to express my strong interest in the AI Automation Intern role at ScaleAI Labs, where I can apply my Python engineering skills.",
        paragraph2_evidence="During my engineering projects, I architected automated workflow pipelines using Python, FastAPI, and Playwright, achieving 99.4% data extraction reliability.",
        paragraph3_impact="I am excited about ScaleAI's mission and would love the opportunity to contribute immediately to your engineering workflows. Thank you for your time.",
        signOff="Sincerely,",
        sourceFactIds=["s1"],
    )

    val_res = cover_letter_validator.validate(valid_content, profile)
    assert val_res.is_valid
    assert len(val_res.violations) == 0

    # Test violation on short paragraph
    invalid_content = valid_content.model_copy(update={"paragraph2_evidence": "Too short"})
    invalid_res = cover_letter_validator.validate(invalid_content, profile)
    assert not invalid_res.is_valid
    assert any("Paragraph 2" in v for v in invalid_res.violations)


def test_reportlab_cover_letter_pdf_renderer():
    """Verify ReportLab produces valid PDF binary byte stream."""
    content = CoverLetterContent(
        fullName="Mohammed Affan Razvi",
        email="affan@example.com",
        phone="+91 9876543210",
        companyName="ScaleAI Labs",
        jobTitle="AI Automation Intern",
        date="September 4, 2026",
        greeting="Dear Hiring Team at ScaleAI Labs,",
        paragraph1_hook="I am writing to express my strong interest in the AI Automation Intern role at ScaleAI Labs, where I can apply my Python engineering skills.",
        paragraph2_evidence="During my engineering projects, I architected automated workflow pipelines using Python, FastAPI, and Playwright, achieving 99.4% data extraction reliability.",
        paragraph3_impact="I am excited about ScaleAI's mission and would love the opportunity to contribute immediately to your engineering workflows. Thank you for your time.",
        signOff="Sincerely,",
        sourceFactIds=["s1"],
    )

    pdf_bytes = reportlab_cover_letter_renderer.render_to_bytes(content)
    assert isinstance(pdf_bytes, bytes)
    assert len(pdf_bytes) > 500
    assert pdf_bytes.startswith(b"%PDF-")


def test_format_cover_letter_markdown():
    """Verify markdown output formatting."""
    content = CoverLetterContent(
        fullName="Mohammed Affan",
        email="affan@example.com",
        companyName="Meesho",
        jobTitle="Software Engineer",
        date="September 4, 2026",
        greeting="Dear Hiring Team,",
        paragraph1_hook="Hook intro paragraph.",
        paragraph2_evidence="Core evidence paragraph.",
        paragraph3_impact="Closing impact paragraph.",
        signOff="Sincerely,",
    )
    md = format_cover_letter_markdown(content)
    assert "# Mohammed Affan" in md
    assert "Hook intro paragraph." in md
    assert "Core evidence paragraph." in md


@pytest.mark.asyncio
async def test_artifacts_and_cover_letter_endpoints(async_client: AsyncClient, monkeypatch):
    """Verify artifacts generation and cover letter endpoints with mocked 1-shot AI generation."""
    # Mock Unified Application Artifacts
    mock_resume = StructuredResumeContent(
        personal=ResumeContact(
            fullName="Mohammed Affan Razvi",
            email="affan@test.com",
            phone="+91 98765 43210",
        ),
        summary="Experienced Python and AI automation developer.",
        skills=[ResumeSkillCategory(category="Languages", items=["Python", "FastAPI"])],
        experience=[
            ResumeExperienceItem(
                company="Tech Club",
                title="Lead",
                bullets=[ResumeBullet(text="Led technical workshops.")],
            )
        ],
        projects=[
            ResumeProjectItem(
                name="JobFinder",
                technologies=["Python", "FastAPI", "Playwright"],
                bullets=[ResumeBullet(text="Built automated workflow platform.")],
            )
        ],
        education=[
            ResumeEducationItem(
                institution="University",
                degree="B.Tech",
            )
        ],
        job_alignment=ResumeJobAlignment(
            matched_skills=["Python", "FastAPI"],
            skill_gaps=[],
        ),
    )

    mock_letter = CoverLetterContent(
        fullName="Mohammed Affan Razvi",
        email="affan@test.com",
        phone="+91 98765 43210",
        companyName="ScaleAI",
        jobTitle="Backend AI Intern",
        date="September 4, 2026",
        greeting="Dear Hiring Team at ScaleAI,",
        paragraph1_hook="I am writing to express my strong enthusiasm for the Backend AI Intern role at ScaleAI.",
        paragraph2_evidence="During my engineering work, I architected scalable Python backend systems using FastAPI and Playwright automation.",
        paragraph3_impact="I look forward to bringing high-velocity engineering to your team and discussing how I can contribute immediately.",
        signOff="Sincerely,",
    )

    async def mock_generate_structured(*args, **kwargs):
        schema = kwargs.get("schema")
        if schema == UnifiedApplicationArtifacts:
            return UnifiedApplicationArtifacts(resume=mock_resume, cover_letter=mock_letter)
        elif schema == StructuredResumeContent:
            return mock_resume
        elif schema == CoverLetterContent:
            return mock_letter
        return UnifiedApplicationArtifacts(resume=mock_resume, cover_letter=mock_letter)

    monkeypatch.setattr(resume_generator.ai_provider, "generate_structured", mock_generate_structured)

    # Ingest a test job
    job_res = await async_client.post(
        "/api/v1/jobs/ingest-text",
        json={
            "title": "Backend AI Intern",
            "company": "ScaleAI",
            "text": "Looking for an intern with Python and FastAPI experience.",
        },
    )
    assert job_res.status_code == 200
    job_data = job_res.json()
    job_id = job_data["id"]

    # 1. Generate artifacts (mode="both" in 1 request)
    gen_res = await async_client.post(
        "/api/v1/artifacts/generate",
        json={"jobId": job_id, "mode": "both", "coverLetterTone": "professional", "forceRegenerate": True},
    )
    assert gen_res.status_code == 200
    gen_data = gen_res.json()
    assert gen_data["mode"] == "both"
    assert gen_data["resume"] is not None
    assert gen_data["coverLetter"] is not None
    assert gen_data["fromCache"] is False
    letter_id = gen_data["coverLetter"]["id"]

    # 2. Test Quota Rule: Second call without forceRegenerate must return fromCache=True (0 Gemini calls)
    cache_res = await async_client.post(
        "/api/v1/artifacts/generate",
        json={"jobId": job_id, "mode": "both", "forceRegenerate": False},
    )
    assert cache_res.status_code == 200
    cache_data = cache_res.json()
    assert cache_data["fromCache"] is True
    assert cache_data["resume"]["id"] == gen_data["resume"]["id"]
    assert cache_data["coverLetter"]["id"] == letter_id

    # 3. Fetch cover letter by job
    get_res = await async_client.get(f"/api/v1/cover-letters/job/{job_id}")
    assert get_res.status_code == 200
    assert get_res.json()["id"] == letter_id

    # 4. Download PDF
    pdf_res = await async_client.get(f"/api/v1/cover-letters/{letter_id}/pdf")
    assert pdf_res.status_code == 200
    assert pdf_res.headers["content-type"] == "application/pdf"
    assert pdf_res.content.startswith(b"%PDF-")

    # 5. Download Markdown
    md_res = await async_client.get(f"/api/v1/cover-letters/{letter_id}/markdown")
    assert md_res.status_code == 200
    assert "text/markdown" in md_res.headers["content-type"]

    # 6. Update cover letter without AI call
    updated_content = gen_data["coverLetter"]["content"]
    updated_content["paragraph1_hook"] = "Updated custom hook with more details about my background and experience."
    put_res = await async_client.put(
        f"/api/v1/cover-letters/{letter_id}",
        json={"content": updated_content, "tone": "technical"},
    )
    assert put_res.status_code == 200
    assert put_res.json()["tone"] == "technical"
    assert put_res.json()["content"]["paragraph1_hook"] == updated_content["paragraph1_hook"]

    # 7. List cover letters
    list_res = await async_client.get("/api/v1/cover-letters")
    assert list_res.status_code == 200
    assert any(cl["id"] == letter_id for cl in list_res.json())

    # 8. Download LaTeX (.tex)
    tex_res = await async_client.get(f"/api/v1/cover-letters/{letter_id}/tex")
    assert tex_res.status_code == 200
    assert r"\documentclass" in tex_res.text
    assert "ScaleAI" in tex_res.text

    # 9. Direct PDF render endpoint (0 Gemini cost)
    direct_res = await async_client.post(
        "/api/v1/cover-letters/render-pdf-direct",
        json=updated_content,
    )
    assert direct_res.status_code == 200
    assert direct_res.content.startswith(b"%PDF-")

    # 10. Delete cover letter
    del_res = await async_client.delete(f"/api/v1/cover-letters/{letter_id}")
    assert del_res.status_code == 200
    assert del_res.json()["status"] == "deleted"