"""Unit tests for Deterministic Job Normalization and Ingestion."""

import pytest
from httpx import AsyncClient

from app.services.job_normalization_service import JobNormalizationService


def test_title_normalization():
    """Verify titles are cleaned from trailing remote tags and noise."""
    normalizer = JobNormalizationService()

    assert normalizer.normalize_title("AI Automation Intern (Remote)") == "AI Automation Intern"
    assert (
        normalizer.normalize_title("Full Stack AI Developer [Hybrid - Bangalore]")
        == "Full Stack AI Developer"
    )
    assert (
        normalizer.normalize_title("Senior Python Engineer - Full-time") == "Senior Python Engineer"
    )


def test_work_mode_and_employment_type_detection():
    """Verify work mode and employment type classification."""
    normalizer = JobNormalizationService()

    # Remote detection
    assert (
        normalizer.detect_work_mode(
            "AI Engineer", "Remote, India", "Looking for remote engineer", {}
        )
        == "remote"
    )
    assert (
        normalizer.detect_work_mode(
            "Software Developer", "Bangalore, India", "Hybrid 2 days in office", {}
        )
        == "hybrid"
    )
    assert (
        normalizer.detect_work_mode("QA Engineer", "Hyderabad, India", "Onsite role", {})
        == "onsite"
    )

    # Employment type detection
    assert normalizer.detect_employment_type("AI Automation Intern", None, "") == "internship"
    assert normalizer.detect_employment_type("Contract QA Engineer", "Contract", "") == "contract"
    assert normalizer.detect_employment_type("Full Stack Developer", "Full Time", "") == "full_time"


def test_category_detection():
    """Verify categorization into technical, data, qa, and non-technical."""
    normalizer = JobNormalizationService()

    assert normalizer.detect_category("Data Analyst Intern", "SQL, Python, Power BI") == "data"
    assert normalizer.detect_category("QA Automation Engineer", "Playwright, test cases") == "qa"
    assert (
        normalizer.detect_category("Account Executive", "Enterprise B2B sales") == "non_technical"
    )
    assert normalizer.detect_category("Full Stack AI Developer", "FastAPI, React") == "technical"


def test_compensation_parsing():
    """Verify numeric compensation ranges, k-notation, LPA, and currency intervals."""
    normalizer = JobNormalizationService()

    # USD annual with k notation
    k_comp = normalizer.parse_compensation("", "The salary for this role is $120k - $160k / year.")
    assert k_comp is not None
    assert k_comp.min == 120000.0
    assert k_comp.max == 160000.0
    assert k_comp.currency == "USD"
    assert k_comp.interval == "year"

    # INR LPA notation
    lpa_comp = normalizer.parse_compensation(
        "", "Compensation range is 6 - 10 LPA depending on experience."
    )
    assert lpa_comp is not None
    assert lpa_comp.min == 600000.0
    assert lpa_comp.max == 1000000.0
    assert lpa_comp.currency == "INR"

    # INR monthly
    inr_comp = normalizer.parse_compensation("₹35,000 - ₹55,000 / month", "")
    assert inr_comp is not None
    assert inr_comp.min == 35000.0
    assert inr_comp.max == 55000.0
    assert inr_comp.currency == "INR"
    assert inr_comp.interval == "month"


def test_skill_extraction():
    """Verify tech skills dictionary extraction from job description text."""
    normalizer = JobNormalizationService()

    text = "We require strong experience with Python, FastAPI, Playwright for web automation, Docker, and React."
    skills = normalizer.extract_skills(text, {})
    assert "Python" in skills
    assert "FastAPI" in skills
    assert "Playwright" in skills
    assert "Docker" in skills
    assert "React" in skills


@pytest.mark.asyncio
async def test_job_ingest_text_api(async_client: AsyncClient):
    """Verify POST /api/v1/jobs/ingest-text endpoint."""
    res = await async_client.post(
        "/api/v1/jobs/ingest-text",
        json={
            "title": "AI Workflow Automation Intern (Remote)",
            "company": "ScaleAI Labs",
            "text": "Looking for an intern skilled in Python, n8n, Google Gemini, and Playwright. Pay is ₹40,000 - ₹60,000/month.",
        },
    )
    assert res.status_code == 200
    data = res.json()
    assert data["title"] == "AI Workflow Automation Intern"
    assert data["company"] == "ScaleAI Labs"
    assert data["workMode"] == "remote"
    assert data["employmentType"] == "internship"
    assert "Python" in data["requiredSkills"]
    assert "Playwright" in data["requiredSkills"]
    assert data["compensation"]["min"] == 40000.0
