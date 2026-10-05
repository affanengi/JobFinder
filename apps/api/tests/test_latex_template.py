"""Tests for Controlled LaTeX Template Generator."""

from app.schemas.resume import (
    ResumeBullet,
    ResumeContact,
    ResumeProjectItem,
    ResumeSkillCategory,
    StructuredResumeContent,
)
from app.services.latex_template import latex_engine


def test_latex_generation_produces_clean_source():
    """Verify LaTeX generator escapes characters and outputs valid Overleaf LaTeX code."""
    content = StructuredResumeContent(
        personal=ResumeContact(
            fullName="Affan & Co Razvi",
            email="affan@test.com",
            phone="+91 99999",
            city="Hyderabad",
            github="https://github.com/affan",
            linkedin="https://linkedin.com/in/affan",
        ),
        summary="Engineered backend APIs with 99.9% uptime & reliability.",
        skills=[
            ResumeSkillCategory(
                category="Core & Tools",
                items=["C++", "C#", "Python", "SQL"],
            )
        ],
        projects=[
            ResumeProjectItem(
                name="ATS Engine & Platform",
                technologies=["FastAPI", "React"],
                bullets=[ResumeBullet(text="Handled 100+ requests/sec with & without caching.")],
            )
        ],
    )

    latex_code = latex_engine.generate_latex(content)

    assert "\\documentclass" in latex_code
    assert "\\begin{document}" in latex_code
    assert "\\end{document}" in latex_code
    assert "Affan \\& Co Razvi" in latex_code
    assert "\\&" in latex_code
    assert "\\resumeProjectHeading" in latex_code
