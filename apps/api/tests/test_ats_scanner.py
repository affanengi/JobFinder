"""Comprehensive Test Suite for the 100-Point ATS Resume Scanner & Keyword Match Engine."""

import pytest
import time
from fastapi.testclient import TestClient
from app.main import app
from app.services.taxonomy.technical_taxonomy import (
    extract_technical_entities,
    match_keywords_against_job,
    audit_bullet_text,
    TAXONOMY_VERSION,
)
from app.services.ats_scanner_engine import ats_scanner_engine


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture
def sample_strong_resume():
    return {
        "id": "res_strong_101",
        "jobId": "job_dev_202",
        "targetRole": "Senior Backend Developer",
        "content": {
            "contact": {
                "fullName": "Alex Mercer",
                "email": "alex.mercer@example.com",
                "phone": "+1 (555) 234-5678",
                "location": "San Francisco, CA",
                "linkedin": "linkedin.com/in/alexmercer",
                "github": "github.com/alexmercer"
            },
            "summary": "Results-driven Senior Backend Developer with 6+ years of expertise designing high-throughput distributed microservices using Python, FastAPI, Docker, and PostgreSQL on AWS. Proven track record reducing API latency by 45% and leading Agile development teams.",
            "experience": [
                {
                    "title": "Senior Backend Engineer",
                    "company": "Apex Cloud Systems",
                    "location": "San Francisco, CA",
                    "duration": "2021 - Present",
                    "bullets": [
                        "Architected distributed microservices in FastAPI and Docker, reducing p99 API latency by 45% for 250k+ daily active users.",
                        "Engineered high-performance PostgreSQL query indexing and Redis caching layer, saving $40K annually in cloud infrastructure.",
                        "Automated CI/CD deployment pipelines using GitHub Actions, cutting release deployment cycle times from 45 min to 8 min."
                    ]
                }
            ],
            "projects": [
                {
                    "name": "Cloud Autoscale Orchestrator",
                    "technologies": ["Python", "Kubernetes", "AWS", "Terraform"],
                    "bullets": [
                        "Engineered Kubernetes autoscaling engine on AWS, optimizing compute utilization by 35% across 80 nodes.",
                        "Implemented automated unit testing with Pytest achieving 96% branch test coverage across all core services."
                    ]
                },
                {
                    "name": "Real-Time Event Streamer",
                    "technologies": ["Python", "Kafka", "PostgreSQL"],
                    "bullets": [
                        "Developed real-time event streaming pipeline processing 10M events daily with sub-second message delivery.",
                        "Refactored legacy database schemas into normalized PostgreSQL tables, improving write throughput by 50%."
                    ]
                }
            ],
            "skills": {
                "languages": ["Python", "TypeScript", "SQL"],
                "frameworks": ["FastAPI", "React", "Docker"],
                "cloud": ["AWS", "Kubernetes", "PostgreSQL", "Redis"]
            },
            "education": [
                {
                    "degree": "Bachelor of Science in Computer Science",
                    "institution": "University of California, Berkeley",
                    "year": "2019",
                    "score": "GPA 3.9/4.0"
                }
            ]
        }
    }


@pytest.fixture
def sample_job():
    return {
        "id": "job_dev_202",
        "title": "Senior Backend Developer",
        "description": "We are seeking a Senior Backend Developer proficient in Python, FastAPI, AWS, Docker, Kubernetes, and PostgreSQL to design scalable REST APIs and microservices.",
        "requirements": [
            "Expertise in Python and FastAPI",
            "Strong experience with AWS, Docker, and Kubernetes",
            "Proficiency in PostgreSQL and Redis caching",
            "Solid understanding of CI/CD and unit testing"
        ],
        "skills": ["Python", "FastAPI", "AWS", "Docker", "Kubernetes", "PostgreSQL", "Redis", "CI/CD"]
    }


def test_taxonomy_entity_extraction():
    """Verify that technical entities across domains are accurately extracted and canonicalized."""
    text = "Built a fullstack application using Python3, FastAPI, React.js, Docker, Kubernetes, and PostgreSQL on AWS."
    entities = extract_technical_entities(text)
    entity_ids = {e["id"] for e in entities}

    assert "python" in entity_ids
    assert "fastapi" in entity_ids
    assert "react" in entity_ids
    assert "docker" in entity_ids
    assert "kubernetes" in entity_ids
    assert "postgresql" in entity_ids
    assert "aws" in entity_ids


def test_taxonomy_keyword_matching(sample_job):
    """Verify deterministic keyword matching against a job description."""
    resume_text = "Proficient in Python, FastAPI, Docker, and PostgreSQL. Experienced with Git and Linux."
    job_text = sample_job["description"] + " " + " ".join(sample_job["requirements"])

    match_result = match_keywords_against_job(resume_text, job_text)
    matched_ids = {k["id"] for k in match_result["matched_keywords"]}
    missing_ids = {k["id"] for k in match_result["missing_keywords"]}

    assert "python" in matched_ids
    assert "fastapi" in matched_ids
    assert "docker" in matched_ids
    assert "postgresql" in matched_ids
    assert "aws" in missing_ids
    assert "kubernetes" in missing_ids
    assert match_result["matched_count"] >= 4
    assert match_result["missing_count"] >= 2


def test_bullet_auditing_strong():
    """Verify strong bullet point evaluation."""
    bullet = "Architected distributed FastAPI microservice reducing p99 latency by 45% across 100k+ daily users."
    audit = audit_bullet_text(bullet)

    assert audit["has_action_verb"] is True
    assert audit["verb"] == "architected"
    assert audit["has_metric"] is True
    assert audit["has_weak_opener"] is False
    assert audit["status"] == "strong"
    assert audit["score"] >= 80


def test_bullet_auditing_weak_passive():
    """Verify detection of weak and passive bullet openers."""
    bullet = "Worked on helping with python code and bug fixes."
    audit = audit_bullet_text(bullet)

    assert audit["has_weak_opener"] is True
    assert audit["has_metric"] is False
    assert audit["status"] == "weak"
    assert len(audit["issues"]) >= 2
    assert audit["score"] < 50


def test_deterministic_scan_tailored_resume(sample_strong_resume, sample_job):
    """Verify complete 100-point scan on a strong tailored resume."""
    start_time = time.perf_counter()
    result = ats_scanner_engine.scan_tailored_resume(sample_strong_resume, sample_job)
    elapsed = time.perf_counter() - start_time

    assert elapsed < 0.5
    assert result.overall_score >= 85
    assert result.grade in ["A+", "A"]
    assert result.category_scores["parseability"].score >= 20.0
    assert result.category_scores["keyword_match"].score >= 20.0
    assert result.category_scores["impact_verbs"].score >= 20.0
    assert result.category_scores["structural_integrity"].score >= 15.0

    assert result.keyword_matrix.matched_count > 0
    assert result.keyword_matrix.match_percentage > 70.0
    assert len(result.actionable_checklist) > 0


def test_raw_file_scan_txt():
    """Verify scanning raw text resume bytes."""
    raw_txt = """
    Jane Doe
    jane.doe@example.com | +1 (555) 987-6543 | San Francisco, CA | linkedin.com/in/janedoe | github.com/janedoe

    Professional Summary:
    Senior Software Engineer with 5+ years of experience designing scalable backend architectures using Python, Django, PostgreSQL, Docker, and AWS. Proven success in cloud infrastructure optimization and leading engineering sprints.

    Experience:
    Tech Leader at Innovate Corp (2020 - Present)
    - Architected scalable REST API backend using Python and Django, serving 1M requests daily with 99.9% uptime.
    - Optimized database query performance by 40% through PostgreSQL index restructuring and Redis caching.
    - Led team of 4 engineers using Agile scrum workflows and automated CI/CD deployment pipelines.

    Projects:
    Data Engine
    - Built real-time analytics dashboard with React, FastAPI, and Docker, reducing data ingestion latency by 50%.
    - Automated integration tests with Pytest reaching 90% branch test coverage across all microservices.

    Education:
    Bachelor of Science in Computer Science, MIT, 2019, GPA 3.8/4.0
    """.encode("utf-8")

    result = ats_scanner_engine.scan_raw_resume_bytes(
        file_bytes=raw_txt,
        filename="jane_doe_resume.txt",
        content_type="text/plain",
        job_description="Looking for Python, Django, AWS, Docker, and PostgreSQL backend developer."
    )

    assert result.overall_score >= 70
    assert result.grade in ["A+", "A", "B"]
    assert result.metadata.source_type == "file_upload"
    assert result.metadata.file_name == "jane_doe_resume.txt"


def test_api_scan_file_upload(client):
    """Verify POST /api/v1/scanner/scan-file endpoint with multipart file upload."""
    sample_txt = b"John Doe\njohn@example.com\nPython, Docker, FastAPI developer."
    response = client.post(
        "/api/v1/scanner/scan-file",
        files={"file": ("resume.txt", sample_txt, "text/plain")},
        data={"job_description": "Looking for a Python and FastAPI engineer."}
    )
    assert response.status_code == 200
    data = response.json()
    assert "overall_score" in data
    assert "category_scores" in data
    assert "keyword_matrix" in data
    assert data["metadata"]["source_type"] == "file_upload"
