"""Tests for Deterministic ReportLab PDF Resume Renderer."""

from app.schemas.resume import (
    ResumeBullet,
    ResumeContact,
    ResumeEducationItem,
    ResumeExperienceItem,
    ResumeProjectItem,
    ResumeSkillCategory,
    StructuredResumeContent,
)
from app.services.reportlab_renderer import reportlab_renderer


def test_reportlab_renders_valid_pdf_bytes():
    """Verify ReportLab compiles StructuredResumeContent to a valid PDF byte stream."""
    content = StructuredResumeContent(
        personal=ResumeContact(
            fullName="Mohammed Affan Razvi",
            email="affan@example.com",
            phone="+91 98765 43210",
            city="Hyderabad",
            country="India",
            github="https://github.com/affanrazvi",
            linkedin="https://linkedin.com/in/affanrazvi",
        ),
        summary="Results-driven Software Engineer with deep expertise in Python, FastAPI, and React.",
        skills=[
            ResumeSkillCategory(
                category="Programming & Web",
                items=["Python", "FastAPI", "React", "TypeScript", "Node.js", "SQL"],
            )
        ],
        experience=[
            ResumeExperienceItem(
                company="Tech Solutions Ltd",
                title="Full Stack Developer Intern",
                location="Hyderabad, India",
                startDate="Jan 2024",
                endDate="Jun 2024",
                bullets=[
                    ResumeBullet(
                        text="Engineered responsive React web interfaces integrated with FastAPI backend."
                    ),
                    ResumeBullet(
                        text="Optimized database indexing and queries across PostgreSQL schemas."
                    ),
                ],
            )
        ],
        projects=[
            ResumeProjectItem(
                name="Career Automation Agent",
                technologies=["React", "FastAPI", "Cloud Firestore"],
                url="https://github.com/affanrazvi/jobfinder",
                bullets=[
                    ResumeBullet(
                        text="Architected resilient multi-model fallback chain supporting instant failover."
                    ),
                ],
            )
        ],
        education=[
            ResumeEducationItem(
                institution="Osmania University",
                degree="Bachelor of Technology in Computer Science",
                endDate="2025",
            )
        ],
    )

    pdf_bytes = reportlab_renderer.render_to_pdf_bytes(content)

    assert isinstance(pdf_bytes, bytes)
    assert len(pdf_bytes) > 500
    # Standard PDF magic header check
    assert pdf_bytes.startswith(b"%PDF")
