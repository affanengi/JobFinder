"""Unit tests for Greenhouse, Lever, and Ashby Public ATS Adapters."""

from unittest.mock import AsyncMock, MagicMock

import pytest

from app.sources.ashby import AshbyAdapter
from app.sources.greenhouse import GreenhouseAdapter
from app.sources.lever import LeverAdapter


def test_greenhouse_url_parsing():
    """Verify Greenhouse slug and job ID extraction from various URL patterns."""
    adapter = GreenhouseAdapter()

    slug, job_id = adapter.extract_slug_and_id_from_url(
        "https://boards.greenhouse.io/scaleai/jobs/123456"
    )
    assert slug == "scaleai"
    assert job_id == "123456"

    slug2, job_id2 = adapter.extract_slug_and_id_from_url(
        "https://job-boards.greenhouse.io/stripe/jobs/998877"
    )
    assert slug2 == "stripe"
    assert job_id2 == "998877"


def test_lever_url_parsing():
    """Verify Lever slug and posting ID extraction."""
    adapter = LeverAdapter()

    slug, job_id = adapter.extract_slug_and_id_from_url(
        "https://jobs.lever.co/anthropic/abcd-1234-efgh"
    )
    assert slug == "anthropic"
    assert job_id == "abcd-1234-efgh"


def test_ashby_url_parsing():
    """Verify Ashby slug and job ID extraction."""
    adapter = AshbyAdapter()

    slug, job_id = adapter.extract_slug_and_id_from_url("https://jobs.ashbyhq.com/openai/9876-xyz")
    assert slug == "openai"
    assert job_id == "9876-xyz"


@pytest.mark.asyncio
async def test_greenhouse_fetch_job_mock():
    """Verify Greenhouse adapter fetches and formats raw job payload."""
    adapter = GreenhouseAdapter()
    mock_client = AsyncMock()

    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.json.return_value = {
        "id": 123456,
        "title": "AI Automation Engineer",
        "absolute_url": "https://boards.greenhouse.io/scaleai/jobs/123456",
        "location": {"name": "Remote, US"},
        "departments": [{"name": "Engineering"}],
        "content": "&lt;p&gt;We are looking for a Python Playwright expert.&lt;/p&gt;",
        "updated_at": "2026-09-01T12:00:00Z",
    }
    mock_client.get.return_value = mock_resp
    adapter._client = mock_client

    payload = await adapter.fetch_job_by_url("https://boards.greenhouse.io/scaleai/jobs/123456")
    assert payload is not None
    assert payload.sourceType == "greenhouse"
    assert payload.rawTitle == "AI Automation Engineer"
    assert payload.companyName == "Scaleai"
    assert "Python Playwright" in payload.rawDescription
