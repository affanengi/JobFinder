"""Tests for Deterministic Python Resume Validator (Transferable Evidence & Structural Density Edition)."""

import pytest

from app.schemas.profile import (
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
    ResumeEducationItem,
    ResumeExperienceItem,
    ResumeJobAlignment,
    ResumeProjectItem,
    ResumeSkillCategory,
    StructuredResumeContent,
)
from app.services.resume_validator import resume_validator


@pytest.fixture
def mock_candidate_profile():
    return Profile(
        userId="user_test",
        personal=PersonalContact(
            fullName="Affan Razvi",
            email="affan@example.com",
            phone="+91 98765 43210",
            city="Hyderabad",
            country="India",
        ),
        skills=[
            SkillFact(id="sk-1", name="Python", category="programming", verified=True),
            SkillFact(id="sk-2", name="FastAPI", category="web", verified=True),
            SkillFact(id="sk-3", name="React", category="web", verified=True),
            SkillFact(id="sk-4", name="REST APIs", category="web", verified=True),
        ],
        projects=[
            ProjectFact(
                id="proj-1",
                name="AI Career Platform",
                description="Built automated career operating system.",
                bullets=["Engineered async REST endpoints using FastAPI."],
                technologies=["Python", "FastAPI", "React"],
                verified=True,
            ),
            ProjectFact(
                id="proj-2",
                name="Automation Platform",
                description="Built workflow automation engine.",
                bullets=["Automated webhook delivery and job schedules."],
                technologies=["Python", "FastAPI"],
                verified=True,
            ),
            ProjectFact(
                id="proj-3",
                name="Dashboard UI",
                description="Built real-time school analytics dashboard.",
                bullets=["Built charts and role-based views."],
                technologies=["React"],
                verified=True,
            ),
            ProjectFact(
                id="proj-4",
                name="Social App",
                description="Built full-stack networking platform.",
                bullets=["Designed relational data schemas."],
                technologies=["React", "Python"],
                verified=True,
            ),
        ],
        experience=[
            ExperienceFact(
                id="exp-1",
                company="Tech Innovators",
                title="Software Engineering Intern",
                location="Hyderabad",
                startDate="2024-01",
                endDate="2024-06",
                bullets=["Developed backend services with Python."],
                verified=True,
            )
        ],
        education=[
            EducationFact(
                id="edu-1",
                institution="Osmania University",
                degree="B.Tech Computer Science",
                endDate="2025",
                verified=True,
            )
        ],
    )


def test_validator_passes_truthful_dense_resume(mock_candidate_profile):
    """Verify that a dense resume meeting all truth + structural requirements passes with 100% truth score."""
    content = StructuredResumeContent(
        personal=ResumeContact(
            fullName="Affan Razvi",
            email="affan@example.com",
            phone="+91 98765 43210",
            city="Hyderabad",
            country="India",
        ),
        summary=(
            "Software engineer with verified experience in Python, FastAPI, and React building scalable backend microservices "
            "and workflow automation pipelines. Experienced in designing truth-audited API engines and responsive web applications "
            "with zero data hallucination. Proven track record of developing real-time dashboards and relational database schemas "
            "to optimize complex workflows. Demonstrated leadership as a technical lead mentoring peers and hosting hackathons."
        ),
        summary_fact_ids=["sk-1", "sk-2", "sk-3", "proj-1"],
        skills=[
            ResumeSkillCategory(
                category="Backend",
                items=["Python", "FastAPI", "REST APIs"],
                source_fact_ids=["sk-1", "sk-2", "sk-4"],
            )
        ],
        experience=[
            ResumeExperienceItem(
                experience_fact_id="exp-1",
                company="Tech Innovators",
                title="Software Engineering Intern",
                bullets=[
                    ResumeBullet(
                        text="Developed backend services with Python and FastAPI.", source_fact_ids=["exp-1"]
                    ),
                    ResumeBullet(
                        text="Engineered modular REST APIs ensuring low-latency request processing.", source_fact_ids=["exp-1"]
                    ),
                    ResumeBullet(
                        text="Collaborated on asynchronous worker pipelines for background tasks.", source_fact_ids=["exp-1"]
                    ),
                ],
            )
        ],
        projects=[
            ResumeProjectItem(
                project_fact_id="proj-1",
                name="AI Career Platform",
                technologies=["Python", "FastAPI", "React"],
                bullets=[
                    ResumeBullet(text="Architected async REST microservices using FastAPI.", source_fact_ids=["proj-1"]),
                    ResumeBullet(text="Integrated automated verification pipelines to block unverified claims.", source_fact_ids=["proj-1"]),
                    ResumeBullet(text="Built responsive client interfaces utilizing React and state management.", source_fact_ids=["proj-1"]),
                    ResumeBullet(text="Engineered structured data schemas for fast multi-dimensional retrieval.", source_fact_ids=["proj-1"]),
                ],
            ),
            ResumeProjectItem(
                project_fact_id="proj-2",
                name="Automation Platform",
                technologies=["Python", "FastAPI"],
                bullets=[
                    ResumeBullet(text="Developed event-driven workflow automation engine.", source_fact_ids=["proj-2"]),
                    ResumeBullet(text="Implemented webhook integrations for scheduled dispatches.", source_fact_ids=["proj-2"]),
                    ResumeBullet(text="Architected robust error handling with automatic retry queues.", source_fact_ids=["proj-2"]),
                    ResumeBullet(text="Optimized API response latency across high-throughput endpoints.", source_fact_ids=["proj-2"]),
                ],
            ),
            ResumeProjectItem(
                project_fact_id="proj-3",
                name="Dashboard UI",
                technologies=["React"],
                bullets=[
                    ResumeBullet(text="Engineered interactive data visualization dashboards using React.", source_fact_ids=["proj-3"]),
                    ResumeBullet(text="Built role-based authentication and secure multi-tier views.", source_fact_ids=["proj-3"]),
                    ResumeBullet(text="Created reusable UI component libraries for consistent layout styling.", source_fact_ids=["proj-3"]),
                    ResumeBullet(text="Integrated dynamic filtering for complex metrics analysis.", source_fact_ids=["proj-3"]),
                ],
            ),
            ResumeProjectItem(
                project_fact_id="proj-4",
                name="Social App",
                technologies=["React", "Python"],
                bullets=[
                    ResumeBullet(text="Built full-stack networking platform with real-time features.", source_fact_ids=["proj-4"]),
                    ResumeBullet(text="Designed normalized relational schemas for graph connections.", source_fact_ids=["proj-4"]),
                    ResumeBullet(text="Implemented responsive UI components for cross-device support.", source_fact_ids=["proj-4"]),
                    ResumeBullet(text="Engineered secure session management and input validation.", source_fact_ids=["proj-4"]),
                ],
            ),
        ],
        education=[
            ResumeEducationItem(
                education_fact_id="edu-1",
                institution="Osmania University",
                degree="B.Tech Computer Science",
                endDate="2025",
            )
        ],
        job_alignment=ResumeJobAlignment(
            matched_skills=["Python", "FastAPI", "REST APIs"],
            transferable_strengths=[
                "FastAPI REST APIs emphasized for backend service requirements"
            ],
            skill_gaps=["Express.js", "Docker"],
        ),
    )

    result = resume_validator.validate(content, mock_candidate_profile)
    assert result.is_valid is True
    assert result.status == "PASSED"
    assert result.truth_score == 100
    assert len(result.violations) == 0
    assert len(result.truth_violations) == 0
    assert len(result.structural_violations) == 0
    assert "Express.js" in result.skill_gaps


def test_validator_blocks_structural_insufficient_projects(mock_candidate_profile):
    """Verify that providing fewer than 4 projects when 4 exist triggers structural violation."""
    content = StructuredResumeContent(
        personal=ResumeContact(fullName="Affan Razvi", email="affan@example.com"),
        summary="A" * 400,
        projects=[
            ResumeProjectItem(
                name="AI Career Platform",
                bullets=[ResumeBullet(text="B1"), ResumeBullet(text="B2"), ResumeBullet(text="B3"), ResumeBullet(text="B4")],
            )
        ],
    )
    result = resume_validator.validate(content, mock_candidate_profile)
    assert result.is_valid is False
    assert any("mandatory minimum of 4" in v for v in result.structural_violations)


def test_validator_blocks_structural_insufficient_bullets(mock_candidate_profile):
    """Verify that any project with < 4 bullets triggers structural violation."""
    content = StructuredResumeContent(
        personal=ResumeContact(fullName="Affan Razvi", email="affan@example.com"),
        summary="A" * 400,
        projects=[
            ResumeProjectItem(
                name="AI Career Platform",
                bullets=[ResumeBullet(text="Only 1 bullet")],
            ),
            ResumeProjectItem(name="Automation Platform", bullets=[ResumeBullet(text="B1"), ResumeBullet(text="B2"), ResumeBullet(text="B3"), ResumeBullet(text="B4")]),
            ResumeProjectItem(name="Dashboard UI", bullets=[ResumeBullet(text="B1"), ResumeBullet(text="B2"), ResumeBullet(text="B3"), ResumeBullet(text="B4")]),
            ResumeProjectItem(name="Social App", bullets=[ResumeBullet(text="B1"), ResumeBullet(text="B2"), ResumeBullet(text="B3"), ResumeBullet(text="B4")]),
        ],
    )
    result = resume_validator.validate(content, mock_candidate_profile)
    assert result.is_valid is False
    assert any("has 1 bullets (mandatory minimum: 4" in v for v in result.structural_violations)


def test_validator_blocks_structural_short_summary(mock_candidate_profile):
    """Verify that a summary with < 350 chars triggers structural violation."""
    content = StructuredResumeContent(
        personal=ResumeContact(fullName="Affan Razvi", email="affan@example.com"),
        summary="Short 2 line summary.",
        projects=[
            ResumeProjectItem(name="AI Career Platform", bullets=[ResumeBullet(text="B1"), ResumeBullet(text="B2"), ResumeBullet(text="B3"), ResumeBullet(text="B4")]),
            ResumeProjectItem(name="Automation Platform", bullets=[ResumeBullet(text="B1"), ResumeBullet(text="B2"), ResumeBullet(text="B3"), ResumeBullet(text="B4")]),
            ResumeProjectItem(name="Dashboard UI", bullets=[ResumeBullet(text="B1"), ResumeBullet(text="B2"), ResumeBullet(text="B3"), ResumeBullet(text="B4")]),
            ResumeProjectItem(name="Social App", bullets=[ResumeBullet(text="B1"), ResumeBullet(text="B2"), ResumeBullet(text="B3"), ResumeBullet(text="B4")]),
        ],
    )
    result = resume_validator.validate(content, mock_candidate_profile)
    assert result.is_valid is False
    assert any("Professional Summary is too brief" in v for v in result.structural_violations)


def test_validator_blocks_unverified_skill_claim(mock_candidate_profile):
    """Verify that claiming an unverified skill is mechanically blocked in truth_violations."""
    content = StructuredResumeContent(
        personal=ResumeContact(
            fullName="Affan Razvi",
            email="affan@example.com",
        ),
        summary="Backend developer with Express.js experience.",
        skills=[
            ResumeSkillCategory(
                category="Backend",
                items=["Python", "Express.js"],
            )
        ],
    )

    result = resume_validator.validate(content, mock_candidate_profile, enforce_structural=False)
    assert result.is_valid is False
    assert result.status == "BLOCKED"
    assert any("Express.js" in v for v in result.truth_violations)


def test_validator_blocks_fake_employer(mock_candidate_profile):
    """Verify that inventing a fake employer is blocked in truth_violations."""
    content = StructuredResumeContent(
        personal=ResumeContact(
            fullName="Affan Razvi",
            email="affan@example.com",
        ),
        summary="Software engineer.",
        experience=[
            ResumeExperienceItem(
                company="Google DeepMind",
                title="Lead Staff Engineer",
                bullets=[ResumeBullet(text="Led AI architecture.")],
            )
        ],
    )

    result = resume_validator.validate(content, mock_candidate_profile, enforce_structural=False)
    assert result.is_valid is False
    assert result.status == "BLOCKED"
    assert any("Google DeepMind" in v for v in result.truth_violations)
