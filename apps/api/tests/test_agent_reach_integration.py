"""Tests for Agent Reach CLI integration, search provider, and contact discovery pipeline.

Covers:
1. AgentReachService.search_web (valid results, empty results, malformed JSON, timeout, non-zero exit, missing CLI).
2. AgentReachSearchProvider query formatting and candidate extraction.
3. Candidate parsing from title separators, markdown headers, and experience snippets.
4. ContactDiscoveryService end-to-end integration with Agent Reach as primary provider.
5. Zero-contacts state returning searchLinks and honest message.
6. Tenant isolation and persistence.
"""

import asyncio
import json
import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from app.db.repositories.opportunity_contact_repo import OpportunityContactRepository
from app.schemas.job import CanonicalJob
from app.schemas.opportunity_contact import DiscoveredContact
from app.services.agent_reach_service import (
    AgentReachService,
    AgentReachSearchResult,
    AgentReachSearchResultItem,
)
from app.services.contact_discovery_service import ContactDiscoveryService
from app.services.search_provider import (
    AgentReachSearchProvider,
    RawContactCandidate,
    clean_person_name,
    extract_candidate_from_snippet,
)


# ------------------------------------------------------------------------------
# 1. AgentReachService.search_web Tests
# ------------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_agent_reach_service_missing_cli():
    """Verify that search_web handles a missing executable gracefully."""
    svc = AgentReachService()
    with patch.object(svc, "_resolve_cli_path", return_value=None):
        res = await svc.search_web("Databricks recruiter")
        assert res.ok is False
        assert "not found" in res.error.lower()
        assert res.source == "failed"
        assert res.items == []


@pytest.mark.asyncio
async def test_agent_reach_service_empty_query():
    """Verify that empty queries return early with structured error."""
    svc = AgentReachService()
    res = await svc.search_web("   ")
    assert res.ok is False
    assert "cannot be empty" in res.error.lower()


@pytest.mark.asyncio
async def test_agent_reach_service_valid_json_output():
    """Verify search_web successfully parses valid JSON stdout from the CLI."""
    sample_json = json.dumps({
        "ok": True,
        "items": [
            {
                "title": "Jane Doe - Technical Recruiter - Databricks | LinkedIn",
                "url": "https://www.linkedin.com/in/janedoe",
                "text": "# Jane Doe\n\nTechnical Recruiter at Databricks. San Francisco Bay Area.",
            },
            {
                "title": "John Smith - Engineering Manager - Databricks | LinkedIn",
                "url": "https://www.linkedin.com/in/johnsmith",
                "text": "# John Smith\n\nEngineering Manager at Databricks. Bengaluru, India.",
            }
        ],
        "meta": {"limit": 2}
    }).encode("utf-8")

    mock_process = AsyncMock()
    mock_process.communicate.return_value = (sample_json, b"")
    mock_process.returncode = 0

    with patch("app.services.agent_reach_service.shutil.which", return_value="/mock/bin/agent-reach"):
        with patch("asyncio.create_subprocess_exec", return_value=mock_process):
            svc = AgentReachService(cli_path="/mock/bin/agent-reach")
            res = await svc.search_web('site:linkedin.com/in "Databricks" recruiter', limit=2)

            assert res.ok is True
            assert res.source == "agent_reach_cli"
            assert len(res.items) == 2
            assert res.items[0].title == "Jane Doe - Technical Recruiter - Databricks | LinkedIn"
            assert res.items[0].url == "https://www.linkedin.com/in/janedoe"
            assert "Technical Recruiter" in res.items[0].snippet


@pytest.mark.asyncio
async def test_agent_reach_service_timeout():
    """Verify search_web terminates subprocess and returns structured error on timeout."""
    mock_process = AsyncMock()
    mock_process.communicate.side_effect = TimeoutError()
    mock_process.kill = MagicMock()
    mock_process.wait = AsyncMock()

    with patch("asyncio.create_subprocess_exec", return_value=mock_process):
        svc = AgentReachService(cli_path="/mock/bin/agent-reach")
        with patch.object(svc, "_resolve_cli_path", return_value="/mock/bin/agent-reach"):
            res = await svc.search_web("Databricks recruiter", timeout=0.01)

            assert res.ok is False
            assert "timed out" in res.error.lower()
            assert res.source == "failed"
            mock_process.kill.assert_called_once()


@pytest.mark.asyncio
async def test_agent_reach_service_nonzero_exit():
    """Verify search_web handles non-zero exit codes."""
    mock_process = AsyncMock()
    mock_process.communicate.return_value = (b"", b"Network failure connecting to search provider")
    mock_process.returncode = 1

    with patch("asyncio.create_subprocess_exec", return_value=mock_process):
        svc = AgentReachService(cli_path="/mock/bin/agent-reach")
        with patch.object(svc, "_resolve_cli_path", return_value="/mock/bin/agent-reach"):
            res = await svc.search_web("Databricks recruiter")

            assert res.ok is False
            assert "failed" in res.error.lower()
            assert "Network failure" in res.error


@pytest.mark.asyncio
async def test_agent_reach_service_malformed_json():
    """Verify search_web handles invalid JSON gracefully."""
    mock_process = AsyncMock()
    mock_process.communicate.return_value = (b"Not JSON output at all", b"")
    mock_process.returncode = 0

    with patch("asyncio.create_subprocess_exec", return_value=mock_process):
        svc = AgentReachService(cli_path="/mock/bin/agent-reach")
        with patch.object(svc, "_resolve_cli_path", return_value="/mock/bin/agent-reach"):
            res = await svc.search_web("Databricks recruiter")

            assert res.ok is False
            assert "unparseable json" in res.error.lower()


# ------------------------------------------------------------------------------
# 2. Candidate Extraction Tests
# ------------------------------------------------------------------------------

def test_extract_candidate_title_with_separator():
    """Extract candidate when title follows Name - Role - Company convention."""
    cand = extract_candidate_from_snippet(
        title="Francesca Paternoster - Senior Technical Recruiter - Databricks | LinkedIn",
        snippet="San Francisco Bay Area · Experienced recruiter focused on infrastructure and AI teams.",
        url="https://www.linkedin.com/in/francescapaternoster",
        target_company="Databricks",
        provider="agent_reach",
    )
    assert cand is not None
    assert cand.full_name == "Francesca Paternoster"
    assert "Recruiter" in cand.role_title
    assert cand.company == "Databricks"
    assert cand.source_url == "https://www.linkedin.com/in/francescapaternoster"


def test_extract_candidate_title_as_name_with_markdown_experience():
    """Extract candidate when title is just the person's name and experience is in markdown snippet."""
    cand = extract_candidate_from_snippet(
        title="Hannah Moats",
        snippet="# Hannah Moats\n\n### Lead Technical Recruiter - Databricks\n\nSan Francisco, California. Sourcing top engineering talent.",
        url="https://www.linkedin.com/in/hannahmoats",
        target_company="Databricks",
        provider="agent_reach",
    )
    assert cand is not None
    assert cand.full_name == "Hannah Moats"
    assert "Recruiter" in cand.role_title
    assert cand.company == "Databricks"


def test_extract_candidate_cleans_certifications():
    """Clean professional certifications like CDSP or PMP from candidate names."""
    cand = extract_candidate_from_snippet(
        title="Hamsa Bharadwaj, CDSP",
        snippet="# Hamsa Bharadwaj\n\nEngineering Recruiter @ Elastic · Bengaluru, Karnataka, India",
        url="https://www.linkedin.com/in/hamsabharadwaj",
        target_company="Elastic",
        provider="agent_reach",
    )
    assert cand is not None
    assert cand.full_name == "Hamsa Bharadwaj"
    assert "Recruiter" in cand.role_title
    assert cand.location == "Bengaluru, India"


def test_extract_candidate_rejects_non_person_page():
    """Ensure generic company pages or search directories are not mistaken for personal profiles."""
    cand = extract_candidate_from_snippet(
        title="Top 25 Recruiter profiles at Databricks | LinkedIn",
        snippet="Browse the top Recruiter professionals at Databricks on LinkedIn.",
        url="https://www.linkedin.com/pub/dir/+/Recruiter?trk=companies",
        target_company="Databricks",
        provider="agent_reach",
    )
    assert cand is None


# ------------------------------------------------------------------------------
# 3. AgentReachSearchProvider Tests
# ------------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_agent_reach_search_provider_execution():
    """Verify AgentReachSearchProvider invokes service and parses results."""
    mock_service = AsyncMock(spec=AgentReachService)
    mock_service.is_search_available.return_value = True
    mock_service.search_web.return_value = AgentReachSearchResult(
        ok=True,
        query='site:linkedin.com/in "Canonical" ("recruiter")',
        items=[
            AgentReachSearchResultItem(
                title="Harry Kang - Senior Internal Technical Recruiter - Canonical | LinkedIn",
                url="https://www.linkedin.com/in/harrykang",
                snippet="Recruiting OpenSource, IoT, and Cloud Engineers for Canonical.",
            )
        ],
        source="agent_reach_cli",
    )

    provider = AgentReachSearchProvider(service=mock_service)
    assert provider.is_configured() is True

    candidates = await provider.search_contacts(company_name="Canonical")
    assert len(candidates) == 1
    assert candidates[0].full_name == "Harry Kang"
    assert "Recruiter" in candidates[0].role_title
    assert candidates[0].company == "Canonical"
    assert candidates[0].provider == "agent_reach"


# ------------------------------------------------------------------------------
# 4. ContactDiscoveryService End-to-End Integration Tests
# ------------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_contact_discovery_service_with_agent_reach():
    """Verify ContactDiscoveryService uses AgentReach as primary engine and persists results."""
    import uuid
    test_user_1 = f"user_tenant_{uuid.uuid4().hex[:8]}"
    test_user_2 = f"user_tenant_{uuid.uuid4().hex[:8]}"
    test_opp_id = f"job-{uuid.uuid4().hex[:8]}"

    repo = OpportunityContactRepository()
    mock_provider = AsyncMock(spec=AgentReachSearchProvider)
    mock_provider.is_configured.return_value = True
    mock_provider.search_contacts.return_value = [
        RawContactCandidate(
            full_name="Andrew Kinnas",
            role_title="Senior Technical Recruiter",
            company="Cloudflare",
            location="Austin, Texas",
            email=None,
            source_url="https://www.linkedin.com/in/andrewkinnas",
            snippet="Technical Recruiting lead at Cloudflare.",
            provider="agent_reach",
        )
    ]

    service = ContactDiscoveryService(
        repo=repo,
        agent_reach_provider=mock_provider,
    )

    mock_job = MagicMock(spec=CanonicalJob)
    mock_job.company = "Cloudflare"
    mock_job.id = test_opp_id

    with patch("app.services.contact_discovery_service.job_service.get_job", return_value=mock_job):
        response = await service.discover_contacts(
            user_id=test_user_1,
            opportunity_id=test_opp_id,
            force_refresh=True,
        )

        assert response.companyName == "Cloudflare"
        assert response.providerUsed == "agent_reach"
        assert len(response.contacts) == 1
        contact = response.contacts[0]
        assert contact.fullName == "Andrew Kinnas"
        assert contact.stakeholderTier == "RECRUITER"
        assert contact.searchProviderUsed == "agent_reach"
        assert len(response.searchLinks) >= 3

        # Verify persisted under tenant
        persisted = repo.list_contacts_for_opportunity(test_user_1, test_opp_id)
        assert len(persisted) == 1
        assert persisted[0].fullName == "Andrew Kinnas"

        # Verify tenant isolation: other user cannot see test_user_1's contacts
        other_user_contacts = repo.list_contacts_for_opportunity(test_user_2, test_opp_id)
        assert len(other_user_contacts) == 0


@pytest.mark.asyncio
async def test_contact_discovery_zero_contacts_returns_honest_message_and_links():
    """Verify that zero contacts found returns informative status without error and provides searchLinks."""
    repo = OpportunityContactRepository()
    mock_provider = AsyncMock(spec=AgentReachSearchProvider)
    mock_provider.is_configured.return_value = True
    mock_provider.search_contacts.return_value = []

    service = ContactDiscoveryService(
        repo=repo,
        agent_reach_provider=mock_provider,
    )

    mock_job = MagicMock(spec=CanonicalJob)
    mock_job.company = "RareCorp"
    mock_job.id = "job-rare-01"

    with patch("app.services.contact_discovery_service.job_service.get_job", return_value=mock_job):
        response = await service.discover_contacts(
            user_id="user_tenant_1",
            opportunity_id="job-rare-01",
            force_refresh=True,
        )

        assert len(response.contacts) == 0
        assert "No public contacts discovered" in response.message
        assert len(response.searchLinks) >= 3
        # Ensure searchLinks contains direct search URLs
        assert any("google.com" in link.url for link in response.searchLinks)
        assert any("linkedin.com" in link.url for link in response.searchLinks)
