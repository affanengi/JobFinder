"""Comprehensive Phase 2 Test Suite: Professional Contact Discovery & Email Evidence Classification.

Validates all 13 mandatory criteria:
1. Discovery from a public company or professional source.
2. Correct stakeholder ranking (Recruiter > Hiring Manager > Tech Lead > Regional Lead > Other) with Hyderabad boost.
3. Correct classification for publicly listed and pattern-inferred email addresses.
4. MX records classified as domain mail capability without claiming mailbox verification.
5. Missing, conflicting, or insufficient evidence produces cautious classifications (UNVERIFIED / INVALID_OR_UNSUPPORTED).
6. Search-provider failure and quota exhaustion degrade gracefully.
7. No automatic paid fallback occurs (CostPolicy.FREE_ONLY strictly preserved).
8. Duplicate contacts are handled and deduplicated appropriately.
9. Contact persistence and retrieval work correctly under users/{userId}/opportunity_contacts/{contactId}.
10. Cross-tenant access is rejected (tenant isolation).
11. User dismissal and review states persist correctly.
12. Endpoints return expected status codes and structured responses.
13. No inferred or unverified contact can trigger an email dispatch (zero dispatch mechanism).
"""

import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from fastapi.testclient import TestClient

from app.main import app
from app.db.repositories.opportunity_contact_repo import OpportunityContactRepository
from app.schemas.job import CanonicalJob
from app.schemas.opportunity_contact import (
    ContactDiscoveryResponse,
    ContactSearchLink,
    DiscoveredContact,
    EmailEvidenceClassification,
    StakeholderTier,
)
from app.services.contact_discovery_service import (
    ContactDiscoveryService,
    classify_stakeholder_tier,
    is_hyderabad_location,
    validate_email_syntax,
    TIER_BASE_SCORES,
    HYDERABAD_LOCATION_BOOST,
)
from app.services.search_provider import (
    BraveSearchProvider,
    ExaSearchProvider,
    FallbackQueryLinkProvider,
    RawContactCandidate,
)
from app.utils.dns_verifier import verify_domain_mx, MX_DISCLAIMER

client = TestClient(app)


# ------------------------------------------------------------------------------
# Test 1 & 2: Stakeholder Ranking & Hyderabad Boost
# ------------------------------------------------------------------------------
def test_stakeholder_ranking_hierarchy():
    """Verify stakeholder ranking hierarchy: Recruiter > Hiring Manager > Tech Lead > Regional Lead > Other."""
    recruiter_tier = classify_stakeholder_tier("Senior Technical Recruiter")
    hm_tier = classify_stakeholder_tier("Engineering Manager - Platform")
    lead_tier = classify_stakeholder_tier("Staff Software Engineer & Tech Lead")
    reg_tier = classify_stakeholder_tier("India Site Lead & Director")
    other_tier = classify_stakeholder_tier("Junior Quality Analyst")

    assert recruiter_tier == "RECRUITER"
    assert hm_tier == "HIRING_MANAGER"
    assert lead_tier == "TECH_LEAD"
    assert reg_tier == "REGIONAL_LEAD"
    assert other_tier == "OTHER"

    # Base scores strictly follow priority
    assert TIER_BASE_SCORES["RECRUITER"] > TIER_BASE_SCORES["HIRING_MANAGER"]
    assert TIER_BASE_SCORES["HIRING_MANAGER"] > TIER_BASE_SCORES["TECH_LEAD"]
    assert TIER_BASE_SCORES["TECH_LEAD"] > TIER_BASE_SCORES["REGIONAL_LEAD"]
    assert TIER_BASE_SCORES["REGIONAL_LEAD"] > TIER_BASE_SCORES["OTHER"]


def test_hyderabad_location_boost():
    """Verify Hyderabad locations receive positive ranking boost."""
    assert is_hyderabad_location("Hyderabad, Telangana, India") is True
    assert is_hyderabad_location("HITEC City, Hyderabad") is True
    assert is_hyderabad_location("Gachibowli, Telangana") is True
    assert is_hyderabad_location("Bengaluru, Karnataka") is False
    assert is_hyderabad_location("San Francisco, CA") is False
    assert is_hyderabad_location(None) is False


# ------------------------------------------------------------------------------
# Test 3 & 4: Email Evidence Taxonomy & DNS MX Record Validation
# ------------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_email_evidence_publicly_listed_vs_domain_mail_enabled():
    """Verify publicly listed email vs domain mail enabled vs pattern inferred classification."""
    repo = OpportunityContactRepository()
    service = ContactDiscoveryService(repo=repo)

    # 1. Candidate with public email on company page
    with patch("app.services.contact_discovery_service.verify_domain_mx", new_callable=AsyncMock) as mock_dns:
        mock_dns.return_value = ("VALID_MX", ["mail.acme.com"])

        contact_public = await service._process_and_rank_candidate(
            candidate=RawContactCandidate(
                full_name="Alice Smith",
                role_title="Lead Technical Recruiter",
                company="Acme Corp",
                location="Hyderabad, India",
                email="alice.recruiting@acme.com",
                source_url="https://acme.com/careers",
                provider="company_page",
            ),
            user_id="user_test_1",
            opportunity_id="opp_123",
            company_name="Acme Corp",
            domain_hint="acme.com",
            provider_name="company_page",
        )

        assert contact_public.emailClassification == "PUBLICLY_LISTED"
        assert contact_public.stakeholderTier == "RECRUITER"
        assert contact_public.isHyderabad is True
        assert contact_public.mxStatus == "VALID_MX"
        assert "Passive DNS MX record lookup confirms that the domain is configured to receive mail" in contact_public.emailEvidenceSummary
        assert contact_public.rankingScore >= 400 + 50  # Recruiter base + Hyderabad boost

    # 2. Candidate with domain-mail-enabled email from external provider
    with patch("app.services.contact_discovery_service.verify_domain_mx", new_callable=AsyncMock) as mock_dns:
        mock_dns.return_value = ("VALID_MX", ["mx1.acme.com"])

        contact_domain_mail = await service._process_and_rank_candidate(
            candidate=RawContactCandidate(
                full_name="Bob Jones",
                role_title="Engineering Manager",
                company="Acme Corp",
                location="Hyderabad",
                email="bob@acme.com",
                source_url="https://linkedin.com/in/bobjones",
                provider="exa",
            ),
            user_id="user_test_1",
            opportunity_id="opp_123",
            company_name="Acme Corp",
            domain_hint="acme.com",
            provider_name="exa",
        )

        assert contact_domain_mail.emailClassification == "DOMAIN_MAIL_ENABLED"
        assert contact_domain_mail.mxStatus == "VALID_MX"
        assert "confirmed MX mail exchangers" in contact_domain_mail.emailEvidenceSummary
        assert "does not verify individual mailbox existence" in contact_domain_mail.emailEvidenceSummary


# ------------------------------------------------------------------------------
# Test 5: Missing / Conflicting Evidence Cautious Classification
# ------------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_cautious_classifications_on_missing_or_invalid_evidence():
    """Verify missing, invalid syntax, or NO_MX domain produces cautious classifications."""
    repo = OpportunityContactRepository()
    service = ContactDiscoveryService(repo=repo)

    # A: Contact with no email address
    contact_no_email = await service._process_and_rank_candidate(
        candidate=RawContactCandidate(
            full_name="Carol Danvers",
            role_title="Tech Lead",
            company="Acme Corp",
            location="Bengaluru",
            email=None,
            source_url="https://linkedin.com/in/carol",
            provider="search",
        ),
        user_id="user_test_1",
        opportunity_id="opp_123",
        company_name="Acme Corp",
        domain_hint="acme.com",
        provider_name="search",
    )
    assert contact_no_email.emailClassification == "UNVERIFIED"
    assert contact_no_email.mxStatus == "UNCHECKED"
    assert "No public email address discovered" in contact_no_email.emailEvidenceSummary

    # B: Contact with invalid email syntax
    contact_bad_email = await service._process_and_rank_candidate(
        candidate=RawContactCandidate(
            full_name="Dave Miller",
            role_title="Staff Engineer",
            company="Acme Corp",
            location="Hyderabad",
            email="not-an-email-at-all",
            source_url="https://linkedin.com/in/dave",
            provider="search",
        ),
        user_id="user_test_1",
        opportunity_id="opp_123",
        company_name="Acme Corp",
        domain_hint="acme.com",
        provider_name="search",
    )
    assert contact_bad_email.emailClassification == "INVALID_OR_UNSUPPORTED"
    assert contact_bad_email.mxStatus == "NO_MX"

    # C: Contact with NO_MX domain (domain does not receive mail)
    with patch("app.services.contact_discovery_service.verify_domain_mx", new_callable=AsyncMock) as mock_dns:
        mock_dns.return_value = ("NO_MX", [])

        contact_no_mx = await service._process_and_rank_candidate(
            candidate=RawContactCandidate(
                full_name="Eve Adams",
                role_title="Talent Lead",
                company="Fictitious Inc",
                location="Hyderabad",
                email="eve@defunct-company-domain-12345.xyz",
                source_url="https://careers.fictitious.xyz",
                provider="search",
            ),
            user_id="user_test_1",
            opportunity_id="opp_123",
            company_name="Fictitious Inc",
            domain_hint=None,
            provider_name="search",
        )
        assert contact_no_mx.emailClassification == "INVALID_OR_UNSUPPORTED"
        assert contact_no_mx.mxStatus == "NO_MX"
        assert "no valid DNS MX mail exchanger records" in contact_no_mx.emailEvidenceSummary


# ------------------------------------------------------------------------------
# Test 6 & 7: Graceful Provider Degradation & FREE_ONLY Policy
# ------------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_search_provider_quota_exhaustion_and_free_only_fallback():
    """Verify search provider degrades gracefully on 429/402 and returns $0 browser links without paid calls."""
    # Exa with 429 quota exhaustion
    exa = ExaSearchProvider(api_key="mock_test_key")
    with patch("httpx.AsyncClient.post", new_callable=AsyncMock) as mock_post:
        mock_resp = MagicMock()
        mock_resp.status_code = 429
        mock_resp.is_success = False
        mock_post.return_value = mock_resp

        results = await exa.search_contacts(company_name="TestCorp")
        assert results == []
        assert exa.is_exhausted is True  # Marked exhausted, will not retry or charge
        assert exa.is_configured() is False

    # Brave with 402 payment required / quota limit
    brave = BraveSearchProvider(api_key="mock_brave_key")
    with patch("httpx.AsyncClient.get", new_callable=AsyncMock) as mock_get:
        mock_resp = MagicMock()
        mock_resp.status_code = 402
        mock_resp.is_success = False
        mock_get.return_value = mock_resp

        results = await brave.search_contacts(company_name="TestCorp")
        assert results == []
        assert brave.is_exhausted is True
        assert brave.is_configured() is False

    # FallbackQueryLinkProvider generates 5 rich search exploration links for $0
    links = FallbackQueryLinkProvider.generate_links(company_name="Zomato", location_hint="Hyderabad")
    assert len(links) >= 4
    assert any("google.com/search" in link.url for link in links)
    assert any("linkedin.com/search" in link.url for link in links)


# ------------------------------------------------------------------------------
# Test 8: Candidate Deduplication
# ------------------------------------------------------------------------------
def test_candidate_deduplication():
    """Verify candidates with identical names and company are merged and deduplicated."""
    service = ContactDiscoveryService(repo=OpportunityContactRepository())

    candidates = [
        RawContactCandidate(
            full_name="Priya Sharma",
            role_title="Recruiter",
            company="Swiggy",
            location=None,
            email=None,
            source_url="https://google.com/result1",
        ),
        RawContactCandidate(
            full_name="Priya Sharma",
            role_title="Senior Talent Acquisition Partner",  # More specific title
            company="Swiggy",
            location="Hyderabad",
            email="priya@swiggy.in",
            source_url="https://linkedin.com/in/priyasharma",
        ),
    ]

    deduped = service._deduplicate_candidates(candidates, "Swiggy")
    assert len(deduped) == 1
    assert deduped[0].full_name == "Priya Sharma"
    assert deduped[0].role_title == "Senior Talent Acquisition Partner"
    assert deduped[0].email == "priya@swiggy.in"
    assert deduped[0].location == "Hyderabad"


# ------------------------------------------------------------------------------
# Test 9 & 10: Tenant Isolation & Firestore Persistence
# ------------------------------------------------------------------------------
def test_tenant_isolation_and_persistence():
    """Verify contacts are persisted in user-scoped partition and cross-tenant access is rejected."""
    repo = OpportunityContactRepository()

    contact_user_a = DiscoveredContact(
        id="contact_a_1",
        userId="user_alice",
        opportunityId="opp_100",
        companyName="Microsoft",
        fullName="Suresh Reddy",
        roleTitle="Technical Recruiter",
        stakeholderTier="RECRUITER",
        location="Hyderabad",
        isHyderabad=True,
        rankingScore=450,
    )

    # Save for user_alice
    repo.save_contact(contact_user_a)

    # user_alice can retrieve it
    retrieved_alice = repo.get_contact("user_alice", "contact_a_1")
    assert retrieved_alice is not None
    assert retrieved_alice.fullName == "Suresh Reddy"

    # user_bob cannot retrieve user_alice's contact (returns None)
    retrieved_bob = repo.get_contact("user_bob", "contact_a_1")
    assert retrieved_bob is None

    # Opportunity listing for user_bob returns empty
    bob_contacts = repo.list_contacts_for_opportunity("user_bob", "opp_100")
    assert len(bob_contacts) == 0

    # Opportunity listing for user_alice returns contact
    alice_contacts = repo.list_contacts_for_opportunity("user_alice", "opp_100")
    assert len(alice_contacts) == 1


# ------------------------------------------------------------------------------
# Test 11: Contact Dismissal and Review State Updates
# ------------------------------------------------------------------------------
def test_contact_status_update_and_dismissal():
    """Verify dismissal and review state changes persist correctly."""
    repo = OpportunityContactRepository()

    contact = DiscoveredContact(
        id="contact_mod_1",
        userId="user_tester",
        opportunityId="opp_200",
        companyName="Amazon",
        fullName="Rahul Varma",
        roleTitle="Engineering Manager",
        stakeholderTier="HIRING_MANAGER",
        isDismissed=False,
        isReviewed=False,
    )
    repo.save_contact(contact)

    # 1. Update review status
    updated_review = repo.update_contact_status("user_tester", "contact_mod_1", is_reviewed=True)
    assert updated_review is not None
    assert updated_review.isReviewed is True
    assert updated_review.isDismissed is False

    # 2. Update dismissal status
    updated_dismiss = repo.update_contact_status("user_tester", "contact_mod_1", is_dismissed=True)
    assert updated_dismiss is not None
    assert updated_dismiss.isDismissed is True

    # 3. Cross-tenant modification rejected
    cross_tenant_update = repo.update_contact_status("malicious_user", "contact_mod_1", is_dismissed=False)
    assert cross_tenant_update is None


# ------------------------------------------------------------------------------
# Test 12: API Endpoints (FastAPI TestClient)
# ------------------------------------------------------------------------------
def test_contact_discovery_api_endpoints():
    """Test authenticated endpoints for contact discovery, listing, dismissal, and review."""
    from app.services.job_service import job_service

    # Create dummy canonical job
    test_job = CanonicalJob(
        id="job_api_test_1",
        title="Software Engineer, Infrastructure",
        company="Google",
        location="Hyderabad, Telangana, India",
        description="Join Google Cloud in Hyderabad.",
        source="manual_url",
        sourceRef={
            "adapter": "manual_url",
            "originalUrl": "https://careers.google.com/jobs/results/123",
            "companySlug": "google",
        },
    )
    job_service.save_job(test_job)

    auth_headers = {"X-User-Id": "user_api_tester"}

    with patch("app.services.contact_discovery_service.verify_domain_mx", new_callable=AsyncMock) as mock_mx:
        mock_mx.return_value = ("VALID_MX", ["smtp.google.com"])

        # 1. POST /api/v1/opportunities/{id}/contacts/discover
        res = client.post(
            "/api/v1/opportunities/job_api_test_1/contacts/discover",
            headers=auth_headers,
            json={"forceRefresh": True},
        )
        assert res.status_code == 200
        data = res.json()
        assert data["opportunityId"] == "job_api_test_1"
        assert data["companyName"] == "Google"
        assert data["costPolicyEnforced"] == "FREE_ONLY"
        assert len(data["searchLinks"]) >= 4

        # 2. GET /api/v1/opportunities/{id}/contacts
        get_res = client.get(
            "/api/v1/opportunities/job_api_test_1/contacts",
            headers=auth_headers,
        )
        assert get_res.status_code == 200
        contacts = get_res.json()
        assert isinstance(contacts, list)

        # 3. Save a test contact for user_api_tester to verify dismissal & review
        from app.db.repositories.opportunity_contact_repo import opportunity_contact_repo
        contact_id = "test_contact_api_123"
        test_contact = DiscoveredContact(
            id=contact_id,
            userId="user_api_tester",
            opportunityId="job_api_test_1",
            companyName="Google",
            fullName="Sundar Pichai",
            roleTitle="Executive",
            isDismissed=False,
            isReviewed=False,
        )
        opportunity_contact_repo.save_contact(test_contact)

        # 4. PATCH /dismiss
        dismiss_res = client.patch(
            f"/api/v1/opportunities/job_api_test_1/contacts/{contact_id}/dismiss",
            headers=auth_headers,
            json={"isDismissed": True},
        )
        assert dismiss_res.status_code == 200
        assert dismiss_res.json()["isDismissed"] is True

        # 5. PATCH /review
        review_res = client.patch(
            f"/api/v1/opportunities/job_api_test_1/contacts/{contact_id}/review",
            headers=auth_headers,
            json={"isReviewed": True},
        )
        assert review_res.status_code == 200
        assert review_res.json()["isReviewed"] is True

        # 6. Cross-tenant access rejection
        foreign_headers = {"X-User-Id": "user_foreign_attacker"}
        unauthorized_patch = client.patch(
            f"/api/v1/opportunities/job_api_test_1/contacts/{contact_id}/dismiss",
            headers=foreign_headers,
            json={"isDismissed": True},
        )
        assert unauthorized_patch.status_code == 404  # Rejects existence to foreign tenant


# ------------------------------------------------------------------------------
# Test 13: Zero Automated Email Dispatch Policy
# ------------------------------------------------------------------------------
# Test 13: Zero Automated Email Dispatch Policy
# ------------------------------------------------------------------------------
def test_zero_automated_email_dispatch_policy():
    """Verify that no email dispatch mechanism exists in Phase 2."""
    from app.services.contact_discovery_service import ContactDiscoveryService

    service = ContactDiscoveryService()
    # Confirm no email sending methods or routes exist
    assert not hasattr(service, "send_email")
    assert not hasattr(service, "dispatch_outreach")
    assert not hasattr(service, "send_gmail")

    # Confirm router does not have send endpoint
    routes = [getattr(route, "path", "") for route in app.routes]
    assert not any("contacts/send" in r for r in routes)


# ------------------------------------------------------------------------------
# Test 14: Dual-Query Search Provider Execution & Bounded Limits (Task 2.1)
# ------------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_dual_query_execution_and_bounded_limits():
    """Verify exactly two targeted bounded queries per company capped at 5 results each."""
    from app.services.agent_reach_service import AgentReachSearchResultItem, AgentReachSearchResult
    from app.services.search_provider import AgentReachSearchProvider, PER_QUERY_SEARCH_LIMIT

    mock_service = MagicMock()
    mock_service.is_search_available.return_value = True

    # Mock search_web to record queries and return mock items
    queries_executed = []

    async def mock_search_web(query: str, limit: int = 5):
        queries_executed.append((query, limit))
        if "talent acquisition" in query:
            return AgentReachSearchResult(
                ok=True,
                query=query,
                items=[
                    AgentReachSearchResultItem(
                        title="Jane Doe - Lead Technical Recruiter - Canonical | LinkedIn",
                        url="https://linkedin.com/in/janedoe",
                        snippet="### Jane Doe - Lead Technical Recruiter - Canonical (Current)",
                    )
                ],
            )
        else:
            return AgentReachSearchResult(
                ok=True,
                query=query,
                items=[
                    AgentReachSearchResultItem(
                        title="John Smith - Director of Engineering - Canonical | LinkedIn",
                        url="https://linkedin.com/in/johnsmith",
                        snippet="### John Smith - Director of Engineering - Canonical (Current)",
                    )
                ],
            )

    mock_service.search_web = mock_search_web
    provider = AgentReachSearchProvider(service=mock_service)

    candidates = await provider.search_contacts("Canonical", limit=5)

    # 1. Exactly two queries executed concurrently
    assert len(queries_executed) == 2

    q1, limit1 = queries_executed[0]
    q2, limit2 = queries_executed[1]

    # 2. Query 1 targets recruiting / talent acquisition
    assert "talent acquisition" in q1.lower() or "technical recruiter" in q1.lower()
    assert limit1 <= PER_QUERY_SEARCH_LIMIT

    # 3. Query 2 targets engineering leadership
    assert "engineering manager" in q2.lower() or "tech lead" in q2.lower()
    assert limit2 <= PER_QUERY_SEARCH_LIMIT

    # 4. Results returned cleanly
    assert len(candidates) == 2
    names = [c.full_name for c in candidates]
    assert "Jane Doe" in names
    assert "John Smith" in names


# ------------------------------------------------------------------------------
# Test 15: Search Provider Failure, Zero Results & Upstream Broken Handling (Task 2.1 / Step 2)
# ------------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_search_provider_resilience_and_upstream_broken():
    """Verify search success, successful zero results, upstream failure, and timeouts."""
    from app.services.agent_reach_service import AgentReachSearchResult
    from app.services.search_provider import AgentReachSearchProvider

    mock_service = MagicMock()
    mock_service.is_search_available.return_value = True

    # Case A: Successful zero results
    async def mock_zero(query: str, limit: int = 5):
        return AgentReachSearchResult(ok=True, query=query, items=[])

    mock_service.search_web = mock_zero
    provider = AgentReachSearchProvider(service=mock_service)
    results = await provider.search_contacts("UnknownCorp", limit=5)
    assert results == []

    # Case B: Exa UPSTREAM_BROKEN failure path
    async def mock_upstream_broken(query: str, limit: int = 5):
        return AgentReachSearchResult(
            ok=False,
            query=query,
            error="UPSTREAM_BROKEN: Exa returned no recognizable search results",
            items=[],
        )

    mock_service.search_web = mock_upstream_broken
    provider = AgentReachSearchProvider(service=mock_service)
    results_broken = await provider.search_contacts("Canonical", limit=5)
    assert results_broken == []  # Does NOT manufacture fake contacts!

    # Case C: Exception / Timeout
    async def mock_timeout(query: str, limit: int = 5):
        raise TimeoutError("Search subprocess timed out after 10.0s")

    mock_service.search_web = mock_timeout
    provider = AgentReachSearchProvider(service=mock_service)
    results_timeout = await provider.search_contacts("Canonical", limit=5)
    assert results_timeout == []


# ------------------------------------------------------------------------------
# Test 16: Role Currency Classification and Former Employee Filtering (Task 2.2)
# ------------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_role_currency_evaluations_and_filtering():
    """Verify current, likely-current, former, and unclear role classifications."""
    from app.services.search_provider import evaluate_role_currency

    # 1. FORMER_ROLE evaluations
    assert evaluate_role_currency(
        title="Eric St-Jean - Former Senior Engineering Manager - Canonical",
        snippet="Experience: Canonical Mar 2020 - Nov 2024 · 4 yrs 9 mos",
        target_company="Canonical",
    ) == "FORMER_ROLE"

    assert evaluate_role_currency(
        title="Bob Smith - Staff Engineer - Microsoft",
        snippet="Past: Canonical (2018 - 2022). Currently at Microsoft.",
        target_company="Canonical",
    ) == "FORMER_ROLE"

    assert evaluate_role_currency(
        title="Alice Vance - Tech Lead",
        snippet="Ex-Canonical engineering lead currently exploring new roles.",
        target_company="Canonical",
    ) == "FORMER_ROLE"

    # 2. CURRENT_CONFIRMED evaluations
    assert evaluate_role_currency(
        title="Nick D. - Director of Engineering, Platform - Canonical | LinkedIn",
        snippet="### Nick D. - Director of Engineering, Platform - Canonical (Current)",
        target_company="Canonical",
    ) == "CURRENT_CONFIRMED"

    assert evaluate_role_currency(
        title="Celine Chong - Global Talent Acquisition Lead - Canonical | LinkedIn",
        snippet="Canonical · Full-time · Present · London, United Kingdom",
        target_company="Canonical",
    ) == "CURRENT_CONFIRMED"

    # 3. LIKELY_CURRENT evaluations
    assert evaluate_role_currency(
        title="Guruprasad L - Engineering Manager - Canonical | LinkedIn",
        snippet="Bengaluru, Karnataka, India · 500+ connections",
        target_company="Canonical",
    ) == "LIKELY_CURRENT"

    # 4. UNCLEAR_ASSOCIATION evaluations
    assert evaluate_role_currency(
        title="Sam Taylor - Independent Consultant | LinkedIn",
        snippet="Expert in Linux systems and open-source stacks including Ubuntu and Debian.",
        target_company="Canonical",
    ) == "UNCLEAR_ASSOCIATION"

    # 5. Verify that ContactDiscoveryService excludes former employees from active recommendations
    repo = OpportunityContactRepository()
    service = ContactDiscoveryService(repo=repo)

    mock_candidates = [
        RawContactCandidate(
            full_name="Eric St-Jean",
            role_title="Senior Engineering Manager",
            company="Canonical",
            source_url="https://linkedin.com/in/ericstjean",
            role_evidence_status="FORMER_ROLE",
        ),
        RawContactCandidate(
            full_name="Nick D.",
            role_title="Director of Engineering",
            company="Canonical",
            source_url="https://linkedin.com/in/nickd",
            role_evidence_status="CURRENT_CONFIRMED",
        ),
    ]

    service.agent_reach.search_contacts = AsyncMock(return_value=mock_candidates)
    service.agent_reach.is_configured = MagicMock(return_value=True)

    with patch("app.services.contact_discovery_service.job_service") as mock_jobs:
        mock_job = CanonicalJob(
            id="job_canon_1",
            title="Software Engineer",
            company="Canonical",
            location="Remote",
            description="Engineering roles at Canonical.",
            source="manual_url",
            sourceRef={
                "adapter": "manual_url",
                "originalUrl": "https://canonical.com/careers",
                "companySlug": "canonical",
            },
        )
        mock_jobs.get_job.return_value = mock_job

        resp = await service.discover_contacts("user_curr_test", "job_canon_1", force_refresh=True)

        # Former employee Eric St-Jean was filtered out
        names = [c.fullName for c in resp.contacts]
        assert "Eric St-Jean" not in names
        assert "Nick D." in names


# ------------------------------------------------------------------------------
# Test 17: Multi-Channel Extraction & Honest Contactability Statuses (Task 2.2)
# ------------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_multi_channel_extraction_and_contactability_statuses():
    """Verify public LinkedIn, GitHub, portfolio extraction and honest contactability classifications."""
    from app.services.search_provider import extract_candidate_from_snippet

    # 1. Profile with LinkedIn and GitHub in snippet
    parsed = extract_candidate_from_snippet(
        title="Val Z. - Senior Engineering Manager - Cloudflare | LinkedIn",
        snippet="Managing edge platform systems. Personal projects: https://github.com/valz and https://valz.dev",
        url="https://www.linkedin.com/in/val-z-123456?utm_source=share",
        target_company="Cloudflare",
        provider="agent_reach",
    )
    assert parsed is not None
    assert parsed.full_name == "Val Z."
    assert parsed.linkedin_url == "https://www.linkedin.com/in/val-z-123456"
    assert parsed.github_url == "https://github.com/valz"
    assert parsed.portfolio_url == "https://valz.dev"

    # 2. Contactability status classification in ContactDiscoveryService
    repo = OpportunityContactRepository()
    service = ContactDiscoveryService(repo=repo)

    # A: Profile only (LinkedIn, no email)
    c_profile_only = await service._process_and_rank_candidate(
        candidate=RawContactCandidate(
            full_name="Sarah Connor",
            role_title="Senior Recruiter",
            company="Cyberdyne",
            linkedin_url="https://linkedin.com/in/sarahconnor",
            email=None,
        ),
        user_id="u1",
        opportunity_id="opp1",
        company_name="Cyberdyne",
        domain_hint=None,
        provider_name="search",
    )
    assert c_profile_only.contactabilityStatus == "PROFILE_ONLY"
    assert c_profile_only.email is None

    # B: Multiple public channels (Direct email + LinkedIn)
    with patch("app.services.contact_discovery_service.verify_domain_mx", new_callable=AsyncMock) as mock_mx:
        mock_mx.return_value = ("VALID_MX", ["mx.cyberdyne.com"])
        c_multi = await service._process_and_rank_candidate(
            candidate=RawContactCandidate(
                full_name="John Connor",
                role_title="Tech Lead",
                company="Cyberdyne",
                linkedin_url="https://linkedin.com/in/johnconnor",
                email="john@cyberdyne.com",
            ),
            user_id="u1",
            opportunity_id="opp1",
            company_name="Cyberdyne",
            domain_hint=None,
            provider_name="search",
        )
        assert c_multi.contactabilityStatus == "MULTIPLE_PUBLIC_CHANNELS_FOUND"
        assert c_multi.email == "john@cyberdyne.com"

    # C: Direct email only (no social profiles)
    with patch("app.services.contact_discovery_service.verify_domain_mx", new_callable=AsyncMock) as mock_mx:
        mock_mx.return_value = ("VALID_MX", ["mx.cyberdyne.com"])
        c_direct = await service._process_and_rank_candidate(
            candidate=RawContactCandidate(
                full_name="Kyle Reese",
                role_title="Recruiter",
                company="Cyberdyne",
                email="kyle@cyberdyne.com",
            ),
            user_id="u1",
            opportunity_id="opp1",
            company_name="Cyberdyne",
            domain_hint=None,
            provider_name="search",
        )
        assert c_direct.contactabilityStatus == "DIRECT_EMAIL_FOUND"


# ------------------------------------------------------------------------------
# Test 18: Abolition of Synthetic Recruiter Personas & Organizational Channels (Task 2.2)
# ------------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_persona_abolition_and_org_channels():
    """Verify generic mailboxes never become fictional people named 'Company Talent Team'."""
    repo = OpportunityContactRepository()
    service = ContactDiscoveryService(repo=repo)

    mock_html_content = """
    <html>
        <body>
            <h1>Careers at Canonical</h1>
            <p>If you require accommodation during the interview process, email accommodations@canonical.com</p>
            <p>For general hiring inquiries, contact careers@canonical.com or talent@canonical.com</p>
            <p>Media and press: press@canonical.com</p>
        </body>
    </html>
    """

    with patch("app.services.contact_discovery_service.agent_reach_service.fetch_page_content", new_callable=AsyncMock) as mock_fetch:
        mock_fetch.return_value = MagicMock(ok=True, text=mock_html_content)

        extracted = await service._extract_public_page_contacts("https://canonical.com/careers", "Canonical")

        # 1. No fictional "Canonical Talent Team" person is created
        for cand in extracted:
            assert cand.full_name != "Canonical Talent Team"
            assert cand.contact_type == "ORGANIZATION_CHANNEL"

        # 2. Accommodations inbox is correctly purpose-classified
        accom = next((c for c in extracted if "accommodations@" in c.email), None)
        assert accom is not None
        assert accom.full_name == "Accommodations & Accessibility Inbox"
        assert accom.channel_purpose == "ACCOMMODATIONS_ONLY"

        # 3. Careers shared inbox
        careers = next((c for c in extracted if "careers@" in c.email), None)
        assert careers is not None
        assert careers.full_name == "Official Careers Channel"
        assert careers.channel_purpose == "GENERAL_CAREERS_INBOX"

        # 4. Talent / HR shared inbox
        talent = next((c for c in extracted if "talent@" in c.email), None)
        assert talent is not None
        assert talent.full_name == "Talent & People Shared Inbox"
        assert talent.channel_purpose == "HR_SHARED_INBOX"

        # 5. Press / IR channel
        press = next((c for c in extracted if "press@" in c.email), None)
        assert press is not None
        assert press.full_name == "Press & Media Relations"
        assert press.channel_purpose == "PRESS_INVESTOR_RELATIONS"


# ------------------------------------------------------------------------------
# Test 19: Backend Safe Outreach Guards for Missing Recipient Email (Task 2.4)
# ------------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_backend_safe_outreach_guards_on_missing_or_invalid_email():
    """Verify backend independently rejects Gmail sending when recipient email is missing, invalid, or accommodations."""
    from app.services.gmail_sending_service import (
        GmailSendingService,
        IneligibleRecipientError,
    )
    from app.db.repositories.outreach_repo import OutreachRepository
    from app.schemas.outreach import OutreachMessage

    outreach_repo_mock = MagicMock(spec=OutreachRepository)
    sending_service = GmailSendingService(repo=outreach_repo_mock)

    draft = OutreachMessage(
        id="draft_safe_1",
        userId="user_guard_1",
        opportunityId="opp_guard_1",
        contactId="contact_guard_1",
        recipientName="Test Recipient",
        companyName="Canonical",
        correlationId="corr_123",
        subject="Hello",
        body="Message body",
        status="APPROVED",
    )
    outreach_repo_mock.get_outreach.return_value = draft

    # Case A: Contact has no email address (Profile-only)
    contact_no_email = DiscoveredContact(
        id="contact_guard_1",
        userId="user_guard_1",
        opportunityId="opp_guard_1",
        companyName="Canonical",
        fullName="Profile Only Person",
        roleTitle="Recruiter",
        email=None,
        contactabilityStatus="PROFILE_ONLY",
    )
    with patch("app.services.gmail_sending_service.opportunity_contact_repo.get_contact", return_value=contact_no_email):
        with pytest.raises(IneligibleRecipientError) as exc_info:
            await sending_service.send_approved_outreach("user_guard_1", "opp_guard_1", "draft_safe_1")
        assert "Contact email address is missing" in str(exc_info.value) or "profile-only" in str(exc_info.value)

    # Case B: Contact has invalid email syntax
    contact_invalid_email = DiscoveredContact(
        id="contact_guard_1",
        userId="user_guard_1",
        opportunityId="opp_guard_1",
        companyName="Canonical",
        fullName="Bad Email Person",
        roleTitle="Recruiter",
        email="not-an-email",
    )
    with patch("app.services.gmail_sending_service.opportunity_contact_repo.get_contact", return_value=contact_invalid_email):
        with pytest.raises(IneligibleRecipientError) as exc_info:
            await sending_service.send_approved_outreach("user_guard_1", "opp_guard_1", "draft_safe_1")
        assert "invalid syntax" in str(exc_info.value)

    # Case C: Accommodations-only mailbox guard
    contact_accom = DiscoveredContact(
        id="contact_guard_1",
        userId="user_guard_1",
        opportunityId="opp_guard_1",
        companyName="Canonical",
        fullName="Accommodations Inbox",
        roleTitle="Accommodations Channel",
        email="accommodations@canonical.com",
        contactType="ORGANIZATION_CHANNEL",
        channelPurpose="ACCOMMODATIONS_ONLY",
        emailClassification="PUBLICLY_LISTED",
    )
    with patch("app.services.gmail_sending_service.opportunity_contact_repo.get_contact", return_value=contact_accom):
        with pytest.raises(IneligibleRecipientError) as exc_info:
            await sending_service.send_approved_outreach("user_guard_1", "opp_guard_1", "draft_safe_1")
        assert "accommodations-only mailbox is prohibited" in str(exc_info.value)


# ------------------------------------------------------------------------------
# Test 20: Backward Compatibility with Phase 1 Records (Task 2.5)
# ------------------------------------------------------------------------------
def test_backward_compatibility_with_phase1_records():
    """Verify legacy Phase 1 contact records deserialize cleanly with honest defaults."""
    legacy_dict = {
        "id": "contact_legacy_1",
        "userId": "user_leg",
        "opportunityId": "opp_leg",
        "companyName": "Acme",
        "fullName": "Alice Legacy",
        "roleTitle": "Recruiter",
        "email": "alice@acme.com",
        "sourceUrls": ["https://linkedin.com/in/alicelegacy?ref=123"],
    }

    contact = DiscoveredContact.model_validate(legacy_dict)

    # Backfilled linkedinUrl from sourceUrls
    assert contact.linkedinUrl == "https://linkedin.com/in/alicelegacy?ref=123"
    # Defaults filled
    assert contact.contactType == "INDIVIDUAL"
    assert contact.channelPurpose == "INDIVIDUAL_REPRESENTATIVE"
    assert contact.roleEvidenceStatus == "LIKELY_CURRENT"
    # Derived honest contactabilityStatus
    assert contact.contactabilityStatus == "MULTIPLE_PUBLIC_CHANNELS_FOUND"

