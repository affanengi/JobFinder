"""Adversarial Behavioral Test Suite (Tests A through P) for Truth-First Architecture & Independent ATS Scanner."""

import pytest
from app.schemas.profile import Profile, PersonalContact, PersonalLinks, SkillFact, ProjectFact, ExperienceFact, EducationFact, MetricFact
from app.schemas.resume import (
    StructuredResumeContent,
    ResumeValidationResult,
    ResumeSkillCategory,
    ResumeProjectItem,
    ResumeExperienceItem,
    ResumeEducationItem,
    ResumeBullet,
    ResumeContact,
    ResumeJobAlignment,
)
from app.services.resume_validator import resume_validator
from app.services.taxonomy.technical_taxonomy import audit_bullet_text, ALL_ACTION_VERBS_SET
from app.services.ats_scanner_engine import ats_scanner_engine
from app.services.profile_service import ProfileService


@pytest.fixture
def candidate_verified_profile() -> Profile:
    """Fixture providing candidate-confirmed verified profile."""
    return Profile(
        userId="test-user-123",
        personal=PersonalContact(
            fullName="Mohammed Affan Razvi",
            email="affanrazvi98@gmail.com",
            phone="+91-8886915222",
            city="Hyderabad",
            country="India",
            links=PersonalLinks(
                github="https://github.com/mohd-affan-razvi",
                linkedin="https://linkedin.com/in/mohammed-affan-razvi"
            )
        ),
        summary="Engineering undergraduate and full-stack software developer with hands-on experience building enterprise dashboards and generative AI systems.",
        skills=[
            SkillFact(id="s1", name="Python", category="programming", proficiency="advanced", verified=True),
            SkillFact(id="s2", name="FastAPI", category="web", proficiency="advanced", verified=True),
            SkillFact(id="s3", name="React", category="web", proficiency="advanced", verified=True),
            SkillFact(id="s4", name="PostgreSQL", category="data", proficiency="intermediate", verified=True),
        ],
        experience=[
            ExperienceFact(
                id="exp-techniva",
                company="Techniva Technical Club",
                title="Co-Founder & Technical Lead",
                location="Hyderabad, Telangana",
                startDate="2024",
                endDate="2026",
                current=False,
                bullets=[
                    "Co-founded and scaled the departmental technical club, organizing 10+ technical events and hands-on workshops.",
                    "Mentored 300+ student participants across programming hackathons and full-stack development bootcamps.",
                    "Delivered technical keynote sessions on modern web engineering to an audience of 70+ students."
                ],
                metrics=[
                    MetricFact(id="m1", value="10+", description="Technical events and workshops organized", parentId="exp-techniva"),
                    MetricFact(id="m2", value="300+", description="Participants mentored in hackathons", parentId="exp-techniva"),
                    MetricFact(id="m3", value="70+", description="Audience in technical keynotes", parentId="exp-techniva")
                ]
            )
        ],
        projects=[
            ProjectFact(
                id="p-jobfinder",
                name="Personal AI Career Agent (jobFinder)",
                description="Production full-stack career platform automating job intelligence and truthful resume generation.",
                technologies=["FastAPI", "React", "Python", "Tailwind CSS"],
                bullets=[
                    "Architected autonomous job intelligence pipeline processing live job postings with sub-second retrieval.",
                    "Engineered 1-shot LLM structured output pipeline delivering validated resumes in ~1-2s workflow performance.",
                    "Implemented deterministic Python validation layer enforcing 100% factual accuracy against verified profile facts.",
                    "Integrated ReportLab PDF rendering engine producing professional ATS-optimized resumes with 0 API cost."
                ],
                metrics=[
                    MetricFact(id="m4", value="~1-2s", description="Observed workflow generation and validation performance", parentId="p-jobfinder")
                ]
            ),
            ProjectFact(
                id="p-school",
                name="School Management Dashboard",
                description="Comprehensive academic operations dashboard for student records, fee tracking, and performance analytics.",
                technologies=["React", "Chart.js", "Tailwind CSS"],
                bullets=[
                    "Architected responsive school management platform centralizing attendance tracking and fee collection workflows.",
                    "Designed dynamic analytics dashboard featuring 8+ interactive charts visualizing operational metrics.",
                    "Implemented modular React component architecture with optimistic UI updates and zero layout shift.",
                    "Built role-based administrative control interfaces for secure record management and tabular data export."
                ],
                metrics=[
                    MetricFact(id="m5", value="8+", description="Interactive charts in real-time analytics dashboard", parentId="p-school")
                ]
            ),
            ProjectFact(
                id="p-webpilot",
                name="WebPilot Automation Platform",
                description="Automated browser workflow orchestration system executing multi-step web interactions.",
                technologies=["Python", "Selenium", "FastAPI"],
                bullets=[
                    "Built headless browser automation engine executing 8+ canonical workflow automations.",
                    "Engineered robust element-locator resilience framework handling dynamic DOM mutations.",
                    "Implemented asynchronous task queue with retry backoff and failure recovery mechanisms.",
                    "Designed RESTful orchestration endpoints for programmatic workflow execution and real-time status streaming."
                ],
                metrics=[
                    MetricFact(id="m6", value="8+", description="Canonical workflow automations", parentId="p-webpilot")
                ]
            ),
            ProjectFact(
                id="p-video",
                name="AI Video Intelligence & Summarizer",
                description="Automated video processing pipeline extracting transcripts and synthesizing structured chapter summaries.",
                technologies=["Python", "FastAPI", "Gemini API"],
                bullets=[
                    "Engineered asynchronous media processing pipeline extracting audio streams from video content.",
                    "Integrated multi-modal AI APIs to synthesize structured chapter summaries and key takeaway action items.",
                    "Designed timestamped transcript alignment system enabling instant temporal search across long-form media.",
                    "Built responsive playback interface with synchronized transcript highlighting and markdown export capabilities."
                ]
            )
        ],
        education=[
            EducationFact(
                id="edu1",
                institution="Deccan College of Engineering and Technology",
                degree="Bachelor of Engineering",
                field="Computer Science and Engineering",
                endDate="2026",
                grade="7.8 CGPA"
            )
        ]
    )


def test_a_validator_rejects_unverified_metric_claim(candidate_verified_profile):
    """Test A: Validator rejects unverified metric claim (50,000 active students)."""
    fabricated_resume = StructuredResumeContent(
        personal=ResumeContact(fullName="Mohammed Affan Razvi", email="affanrazvi98@gmail.com"),
        summary="Engineering undergraduate and full-stack software developer with hands-on experience building enterprise dashboards and generative AI systems with extensive production scale." * 2,
        skills=[ResumeSkillCategory(category="Languages", items=["Python"])],
        projects=[
            ResumeProjectItem(
                name="School Management Dashboard",
                bullets=[
                    ResumeBullet(text="Architected responsive school management platform serving 50000 active students.", source_fact_ids=["p-school"]),
                    ResumeBullet(text="Designed dynamic analytics dashboard featuring 8+ interactive charts.", source_fact_ids=["p-school"]),
                    ResumeBullet(text="Implemented modular React component architecture with optimistic updates.", source_fact_ids=["p-school"]),
                    ResumeBullet(text="Built role-based administrative control interfaces for secure records.", source_fact_ids=["p-school"])
                ]
            )
        ],
        experience=[],
        education=[ResumeEducationItem(institution="Deccan College of Engineering and Technology", degree="Bachelor of Engineering", endDate="2026")],
        job_alignment=ResumeJobAlignment()
    )

    result = resume_validator.validate(fabricated_resume, candidate_verified_profile, enforce_structural=False)
    assert not result.is_valid
    assert any("50000" in v or "unsupported quantitative claim" in v.lower() for v in result.violations)


def test_b_validator_rejects_cross_project_metric_leak(candidate_verified_profile):
    """Test B: Validator rejects cross-project metric leak (Techniva's 10+ events placed into School Management)."""
    cross_leaked_resume = StructuredResumeContent(
        personal=ResumeContact(fullName="Mohammed Affan Razvi", email="affanrazvi98@gmail.com"),
        summary="Engineering undergraduate and full-stack software developer with hands-on experience building enterprise dashboards and generative AI systems with extensive production scale." * 2,
        skills=[ResumeSkillCategory(category="Languages", items=["Python"])],
        projects=[
            ResumeProjectItem(
                name="School Management Dashboard",
                bullets=[
                    ResumeBullet(text="Organized 10+ technical events and workshops inside school management system.", source_fact_ids=["p-school"]),
                    ResumeBullet(text="Designed dynamic analytics dashboard featuring 8+ interactive charts.", source_fact_ids=["p-school"]),
                    ResumeBullet(text="Implemented modular React component architecture with optimistic updates.", source_fact_ids=["p-school"]),
                    ResumeBullet(text="Built role-based administrative control interfaces for secure records.", source_fact_ids=["p-school"])
                ]
            )
        ],
        experience=[],
        education=[ResumeEducationItem(institution="Deccan College of Engineering and Technology", degree="Bachelor of Engineering", endDate="2026")],
        job_alignment=ResumeJobAlignment()
    )

    result = resume_validator.validate(cross_leaked_resume, candidate_verified_profile, enforce_structural=False)
    assert not result.is_valid
    assert any("10" in v and "School Management Dashboard" in v for v in result.violations)


def test_c_validator_rejects_present_date_for_techniva(candidate_verified_profile):
    """Test C: Validator rejects 'Present' date claim for Techniva Technical Club."""
    invalid_date_resume = StructuredResumeContent(
        personal=ResumeContact(fullName="Mohammed Affan Razvi", email="affanrazvi98@gmail.com"),
        summary="Engineering undergraduate and full-stack software developer with hands-on experience building enterprise dashboards and generative AI systems with extensive production scale." * 2,
        skills=[ResumeSkillCategory(category="Languages", items=["Python"])],
        projects=[],
        experience=[
            ResumeExperienceItem(
                company="Techniva Technical Club",
                title="Co-Founder & Technical Lead",
                startDate="2024",
                endDate="Present",
                bullets=[
                    ResumeBullet(text="Organized 10+ technical events and workshops for 300+ participants.", source_fact_ids=["exp-techniva"])
                ]
            )
        ],
        education=[ResumeEducationItem(institution="Deccan College of Engineering and Technology", degree="Bachelor of Engineering", endDate="2026")],
        job_alignment=ResumeJobAlignment()
    )

    result = resume_validator.validate(invalid_date_resume, candidate_verified_profile, enforce_structural=False)
    assert not result.is_valid
    assert any("Present" in v for v in result.violations)


def test_d_validator_accepts_verified_numbers(candidate_verified_profile):
    """Test D: Validator accepts all candidate-confirmed verified numbers."""
    valid_resume = StructuredResumeContent(
        personal=ResumeContact(fullName="Mohammed Affan Razvi", email="affanrazvi98@gmail.com"),
        summary="Engineering undergraduate and full-stack software developer with hands-on experience building enterprise dashboards and generative AI systems with extensive production scale. Dedicated to robust full-stack web applications and deterministic career intelligence." * 2,
        skills=[
            ResumeSkillCategory(category="Languages", items=["Python", "PostgreSQL"]),
            ResumeSkillCategory(category="Frameworks", items=["FastAPI", "React"])
        ],
        projects=[
            ResumeProjectItem(
                name="Personal AI Career Agent (jobFinder)",
                bullets=[
                    ResumeBullet(text="Architected autonomous job intelligence pipeline processing live postings with sub-second retrieval.", source_fact_ids=["p-jobfinder"]),
                    ResumeBullet(text="Engineered 1-shot LLM structured output pipeline delivering validated resumes in ~1-2s workflow performance.", source_fact_ids=["p-jobfinder"]),
                    ResumeBullet(text="Implemented deterministic Python validation layer enforcing 100% factual accuracy against verified profile facts.", source_fact_ids=["p-jobfinder"]),
                    ResumeBullet(text="Integrated ReportLab PDF rendering engine producing professional ATS-optimized resumes with 0 API cost.", source_fact_ids=["p-jobfinder"])
                ]
            ),
            ResumeProjectItem(
                name="School Management Dashboard",
                bullets=[
                    ResumeBullet(text="Architected responsive school management platform centralizing attendance tracking and fee collection workflows.", source_fact_ids=["p-school"]),
                    ResumeBullet(text="Designed dynamic analytics dashboard featuring 8+ interactive charts visualizing operational metrics.", source_fact_ids=["p-school"]),
                    ResumeBullet(text="Implemented modular React component architecture with optimistic UI updates and zero layout shift.", source_fact_ids=["p-school"]),
                    ResumeBullet(text="Built role-based administrative control interfaces for secure record management and tabular data export.", source_fact_ids=["p-school"])
                ]
            ),
            ResumeProjectItem(
                name="WebPilot Automation Platform",
                bullets=[
                    ResumeBullet(text="Built headless browser automation engine executing 8+ canonical workflow automations.", source_fact_ids=["p-webpilot"]),
                    ResumeBullet(text="Engineered robust element-locator resilience framework handling dynamic DOM mutations.", source_fact_ids=["p-webpilot"]),
                    ResumeBullet(text="Implemented asynchronous task queue with retry backoff and failure recovery mechanisms.", source_fact_ids=["p-webpilot"]),
                    ResumeBullet(text="Designed RESTful orchestration endpoints for programmatic workflow execution and real-time streaming.", source_fact_ids=["p-webpilot"])
                ]
            ),
            ResumeProjectItem(
                name="AI Video Intelligence & Summarizer",
                bullets=[
                    ResumeBullet(text="Engineered asynchronous media processing pipeline extracting audio streams from video content.", source_fact_ids=["p-video"]),
                    ResumeBullet(text="Integrated multi-modal AI APIs to synthesize structured chapter summaries and key takeaway action items.", source_fact_ids=["p-video"]),
                    ResumeBullet(text="Designed timestamped transcript alignment system enabling instant temporal search across long-form media.", source_fact_ids=["p-video"]),
                    ResumeBullet(text="Built responsive playback interface with synchronized transcript highlighting and markdown export capabilities.", source_fact_ids=["p-video"])
                ]
            )
        ],
        experience=[
            ResumeExperienceItem(
                company="Techniva Technical Club",
                title="Co-Founder & Technical Lead",
                startDate="2024",
                endDate="2026",
                bullets=[
                    ResumeBullet(text="Co-founded and scaled the departmental technical club, organizing 10+ technical events and hands-on workshops.", source_fact_ids=["exp-techniva"]),
                    ResumeBullet(text="Mentored 300+ student participants across programming hackathons and full-stack development bootcamps.", source_fact_ids=["exp-techniva"]),
                    ResumeBullet(text="Delivered technical keynote sessions on modern web engineering to an audience of 70+ students.", source_fact_ids=["exp-techniva"])
                ]
            )
        ],
        education=[ResumeEducationItem(institution="Deccan College of Engineering and Technology", degree="Bachelor of Engineering", endDate="2026")],
        job_alignment=ResumeJobAlignment()
    )

    result = resume_validator.validate(valid_resume, candidate_verified_profile, enforce_structural=True)
    assert result.is_valid, f"Expected valid, got violations: {result.violations}"
    assert result.truth_score == 100


def test_e_validator_enforces_project_count_minimum(candidate_verified_profile):
    """Test E: Validator enforces minimum 4 projects."""
    sparse_resume = StructuredResumeContent(
        personal=ResumeContact(fullName="Mohammed Affan Razvi", email="affanrazvi98@gmail.com"),
        summary="A" * 400,
        skills=[],
        projects=[
            ResumeProjectItem(
                name="School Management Dashboard",
                bullets=[ResumeBullet(text="b1"), ResumeBullet(text="b2"), ResumeBullet(text="b3"), ResumeBullet(text="b4")]
            )
        ],
        experience=[],
        education=[ResumeEducationItem(institution="Deccan College of Engineering and Technology", degree="Bachelor of Engineering", endDate="2026")],
        job_alignment=ResumeJobAlignment()
    )

    result = resume_validator.validate(sparse_resume, candidate_verified_profile, enforce_structural=True)
    assert not result.is_valid
    assert any("Selected project count (1) is below the mandatory minimum of 4" in v for v in result.structural_violations)


def test_f_validator_enforces_bullets_count_minimum(candidate_verified_profile):
    """Test F: Validator enforces minimum 4 bullets per project."""
    sparse_bullets_resume = StructuredResumeContent(
        personal=ResumeContact(fullName="Mohammed Affan Razvi", email="affanrazvi98@gmail.com"),
        summary="A" * 400,
        skills=[],
        projects=[
            ResumeProjectItem(name="School Management Dashboard", bullets=[ResumeBullet(text="b1")]),
            ResumeProjectItem(name="WebPilot Automation Platform", bullets=[ResumeBullet(text="b1")]),
            ResumeProjectItem(name="AI Video Intelligence & Summarizer", bullets=[ResumeBullet(text="b1")]),
            ResumeProjectItem(name="Personal AI Career Agent (jobFinder)", bullets=[ResumeBullet(text="b1")])
        ],
        experience=[],
        education=[ResumeEducationItem(institution="Deccan College of Engineering and Technology", degree="Bachelor of Engineering", endDate="2026")],
        job_alignment=ResumeJobAlignment()
    )

    result = resume_validator.validate(sparse_bullets_resume, candidate_verified_profile, enforce_structural=True)
    assert not result.is_valid
    assert any("mandatory minimum: 4 substantive bullets" in v for v in result.structural_violations)


def test_g_validator_enforces_summary_density(candidate_verified_profile):
    """Test G: Validator enforces minimum summary density (>=350 chars)."""
    short_summary_resume = StructuredResumeContent(
        personal=ResumeContact(fullName="Mohammed Affan Razvi", email="affanrazvi98@gmail.com"),
        summary="Short summary.",
        skills=[],
        projects=[],
        experience=[],
        education=[ResumeEducationItem(institution="Deccan College of Engineering and Technology", degree="Bachelor of Engineering", endDate="2026")],
        job_alignment=ResumeJobAlignment()
    )

    result = resume_validator.validate(short_summary_resume, candidate_verified_profile, enforce_structural=True)
    assert not result.is_valid
    assert any("Professional Summary is too brief" in v for v in result.structural_violations)


def test_h_ats_scanner_strong_architectural_bullet_without_metric():
    """Test H: Strong architectural bullet without metric scores >= 80 (status: 'strong')."""
    bullet = "Architected asynchronous RESTful microservices backend using FastAPI, PostgreSQL, and Redis caching for distributed session handling."
    audit = audit_bullet_text(bullet)
    assert audit["score"] >= 80, f"Expected >= 80, got {audit['score']}"
    assert audit["status"] == "strong"
    assert audit["has_action_verb"] is True
    assert audit["has_metric"] is False


def test_i_ats_scanner_quantified_bullet_with_metric():
    """Test I: Quantified bullet with verified metric scores >= 85 (status: 'strong')."""
    bullet = "Architected an interactive analytics dashboard featuring 8+ real-time charts using React and Chart.js."
    audit = audit_bullet_text(bullet)
    assert audit["score"] >= 85, f"Expected >= 85, got {audit['score']}"
    assert audit["status"] == "strong"
    assert audit["has_metric"] is True


def test_j_ats_scanner_weak_passive_bullet():
    """Test J: Weak passive bullet scores <= 40 (status: 'weak')."""
    bullet = "Worked on website stuff and helped with backend."
    audit = audit_bullet_text(bullet)
    assert audit["score"] <= 40, f"Expected <= 40, got {audit['score']}"
    assert audit["status"] == "weak"
    assert audit["has_weak_opener"] is True


def test_k_ats_scanner_number_does_not_equal_automatic_high_score():
    """Test K: Bullet with number but weak verb ('Responsible for 50 servers') scores <= 55."""
    bullet = "Responsible for 50 servers."
    audit = audit_bullet_text(bullet)
    assert audit["score"] <= 55, f"Expected <= 55, got {audit['score']}"
    assert audit["status"] in ("weak", "moderate")


def test_l_ats_scanner_expanded_action_verbs_recognized():
    """Test L: Expanded technical action verbs are recognized."""
    new_verbs = [
        "visualized", "rendered", "structured", "customized", "synthesized",
        "extracted", "mapped", "monitored", "profiled", "compiled",
        "automated", "scheduled", "indexed", "audited"
    ]
    for verb in new_verbs:
        assert verb in ALL_ACTION_VERBS_SET, f"Expected {verb} to be in ALL_ACTION_VERBS_SET"
        sample_bullet = f"{verb.capitalize()} technical data pipelines across distributed clusters."
        audit = audit_bullet_text(sample_bullet)
        assert audit["has_action_verb"] is True, f"Failed to detect {verb} in bullet"


def test_m_ats_scanner_pillar_3_diminishing_returns():
    """Test M: Pillar 3 evaluates metrics with diminishing returns."""
    res_0_metrics = {
        "summary": "Full stack engineer...",
        "skills": [{"category": "Languages", "items": ["Python", "React"]}],
        "experience": [],
        "projects": [
            {
                "name": "Project A",
                "bullets": [
                    "Architected scalable microservices backend using FastAPI and PostgreSQL database.",
                    "Engineered modular frontend components with React and Tailwind CSS styling.",
                    "Implemented asynchronous task worker queues with Redis caching mechanisms.",
                    "Designed RESTful endpoints for real-time data streaming and error logging."
                ]
            }
        ],
        "education": []
    }
    scan_0 = ats_scanner_engine.scan_tailored_resume(res_0_metrics, "FastAPI and React developer")
    p3_0 = scan_0.category_scores.get("impact_action") or next(p for p in scan_0.category_scores.values() if "Impact" in p.name)
    metric_check_0 = next(c for c in p3_0.checks if "Quantified" in c.name)
    assert metric_check_0.score == 5.0  # solid baseline

    res_3_metrics = {
        "summary": "Full stack engineer...",
        "skills": [{"category": "Languages", "items": ["Python", "React"]}],
        "experience": [],
        "projects": [
            {
                "name": "Project A",
                "bullets": [
                    "Architected scalable microservices backend featuring 8+ interactive charts in React.",
                    "Engineered modular frontend components supporting 10+ technical events.",
                    "Implemented asynchronous task worker queues delivering ~1-2s latency.",
                    "Designed RESTful endpoints for real-time data streaming and error logging."
                ]
            }
        ],
        "education": []
    }
    scan_3 = ats_scanner_engine.scan_tailored_resume(res_3_metrics, "FastAPI and React developer")
    p3_3 = scan_3.category_scores.get("impact_action") or next(p for p in scan_3.category_scores.values() if "Impact" in p.name)
    metric_check_3 = next(c for c in p3_3.checks if "Quantified" in c.name)
    assert metric_check_3.score == 9.0  # strong diminishing returns score


def test_n_bulk_ai_bullet_suggestions_anti_fabrication_prompt():
    """Test N: Bulk AI suggestions enforces anti-fabrication and Set A / Set B."""
    import inspect
    method_source = inspect.getsource(ats_scanner_engine.generate_bulk_ai_bullet_suggestions)
    assert "NEVER FABRICATE" in method_source
    assert "set_a" in method_source
    assert "set_b" in method_source


def test_p_profile_service_default_profile_verified_facts():
    """Test P: Profile service default profile contains exact confirmed facts and current: False for Techniva."""
    svc = ProfileService()
    default_prof = svc._init_default_profile("default_user")
    
    techniva = next(e for e in default_prof.experience if "Techniva" in e.company)
    assert techniva.current is False
    assert techniva.endDate == "2026"
    assert "fest" not in "".join(techniva.bullets).lower()
    
    # Check metrics existence
    assert len(techniva.metrics) >= 3
    school = next(p for p in default_prof.projects if "School" in p.name)
    assert len(school.metrics) >= 1
    school_metric = school.metrics[0]
    val = school_metric.value if hasattr(school_metric, "value") else school_metric
    assert "8+" in str(val)
