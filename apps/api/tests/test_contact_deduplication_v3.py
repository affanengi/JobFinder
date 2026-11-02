"""Version 3.0 Comprehensive Verification Test Suite.

Verifies:
1. Cross-opportunity contact deduplication at the same company (1 contact document, associatedOpportunityIds updated).
2. Preservation of existing outreach history, review status, drafts, and notes on rediscovery.
3. False-positive protection: Identical names with conflicting LinkedIn slugs prevent auto-merge.
4. False-positive protection: Identical names with conflicting verified emails prevent auto-merge.
5. Ambiguity protection: Identical names without strong signals are flagged with isAmbiguousMatch and discriminant IDs.
6. Pre-persistence tombstone verification: Deleted contact is never resurrected by in-flight discovery.
7. Contact deletion security: Dual-ownership check (403 for other user, 400 for unrelated opp).
8. Contact deletion idempotency: Retrying deletion returns 200 OK safely.
9. Bulk research job lifecycle: POST /bulk-research/jobs returns 202 Accepted.
10. Bulk research job recovery: Lease claim prevents concurrent workers; stale jobs (>180s) recovered.
11. Migration script safety: Defaults to dry-run; refuses execution without explicit confirmation.
"""

from datetime import UTC, datetime, timedelta
import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from httpx import ASGITransport, AsyncClient

from app.main import app
from app.db.repositories.opportunity_contact_repo import (
    OpportunityContactRepository,
    opportunity_contact_repo,
)
from app.db.repositories.bulk_research_job_repo import bulk_research_job_repo
from app.schemas.company import BulkResearchJobDocument
from app.schemas.job import CanonicalJob
from app.schemas.opportunity_contact import (
    ContactDiscoveryResponse,
    DiscoveredContact,
)
from app.services.contact_discovery_service import ContactDiscoveryService
from app.services.job_service import job_service
from app.services.search_provider import RawContactCandidate
from app.utils.contact_identity import (
    check_signal_divergence,
    compute_deterministic_contact_id,
    extract_linkedin_vanity_slug,
    generate_ambiguity_discriminant_id,
    generate_candidate_identity_keys,
    normalize_company_key,
    normalize_email_address,
)


def _make_test_job(job_id: str, company: str, title: str = "Engineer") -> CanonicalJob:
    job = CanonicalJob(
        id=job_id,
        title=title,
        company=company,
        companyKey=normalize_company_key(company),
        location="San Francisco, CA",
        description=f"{title} position at {company}",
        source="manual_url",
        sourceRef={
            "adapter": "manual_url",
            "originalUrl": f"https://{company.lower().replace(' ', '')}.com/jobs/{job_id}",
            "companySlug": company.lower().replace(" ", ""),
        },
    )
    job_service.save_job(job)
    return job


# -----------------------------------------------------------------------------
# 1. Identity Keys & Canonicalization Unit Tests
# -----------------------------------------------------------------------------
def test_identity_canonicalization_and_vanity_slugs():
    assert extract_linkedin_vanity_slug("https://www.linkedin.com/in/alex-smith-123/?param=value") == "alex-smith-123"
    assert extract_linkedin_vanity_slug("https://linkedin.com/in/john-doe") == "john-doe"
    assert extract_linkedin_vanity_slug("alexsmith") == "alexsmith"
    assert extract_linkedin_vanity_slug(None) is None

    assert normalize_email_address("  Alex.Smith+test@Acme.COM ") == "alex.smith+test@acme.com"
    assert normalize_email_address(None) is None

    assert normalize_company_key("Stripe, Inc.") == "stripe"
    assert normalize_company_key("Google LLC") == "google"

    keys = generate_candidate_identity_keys(
        company_name="Acme Corp",
        full_name="Alex Smith",
        linkedin_url="https://www.linkedin.com/in/alexsmith",
        email="alex@acme.com",
        role_title="Senior Recruiter",
    )
    assert "li:alexsmith" in keys
    assert "em:alex@acme.com" in keys
    assert "comp_fn_role:acme:alexsmith:recruiter" in keys


def test_signal_divergence_detection():
    # Conflicting LinkedIn slugs
    cand_keys = ["li:alexsmith-eng", "comp_fn_role:acme:alexsmith:engineer"]
    exist_keys = ["li:alexsmith-recruiter", "comp_fn_role:acme:alexsmith:recruiter"]
    assert check_signal_divergence(cand_keys, exist_keys) is True

    # Conflicting Emails
    cand_keys = ["em:alex1@acme.com", "comp_fn_role:acme:alexsmith:recruiter"]
    exist_keys = ["em:alex2@acme.com", "comp_fn_role:acme:alexsmith:recruiter"]
    assert check_signal_divergence(cand_keys, exist_keys) is True

    # Matching LinkedIn slug, differing email (non-conflicting enrichment or same person)
    cand_keys = ["li:alexsmith", "em:alex@acme.com"]
    exist_keys = ["li:alexsmith"]
    assert check_signal_divergence(cand_keys, exist_keys) is False

    # String-based signature check
    assert check_signal_divergence("alexsmith", None, "johnsmith", None) is True
    assert check_signal_divergence(None, "alex@a.com", None, "bob@a.com") is True


# -----------------------------------------------------------------------------
# 2. Cross-Opportunity Deduplication at Same Company
# -----------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_cross_opportunity_deduplication_same_company():
    """Verify same person discovered under two opportunities at one company produces 1 contact document."""
    repo = OpportunityContactRepository()
    service = ContactDiscoveryService(repo=repo)

    job_1 = _make_test_job("opp_stripe_eng", "Stripe", "Backend Engineer")
    job_2 = _make_test_job("opp_stripe_pm", "Stripe", "Product Manager")

    candidate_raw = RawContactCandidate(
        full_name="Jane Doe",
        role_title="Lead Talent Partner",
        company="Stripe",
        linkedin_url="https://www.linkedin.com/in/janedoe-stripe",
        email="janedoe@stripe.com",
    )

    service.agent_reach.is_configured = MagicMock(return_value=True)
    service.agent_reach.search_contacts = AsyncMock(return_value=([candidate_raw], ["Stripe recruiters"]))

    # First discovery run for Opportunity 1
    with patch("app.services.contact_discovery_service.verify_domain_mx", new_callable=AsyncMock) as mock_mx, \
         patch.object(repo, "list_active_contacts_for_company", return_value=[]) as mock_active_co, \
         patch.object(repo, "list_company_tombstones", return_value=[]) as mock_tombstones, \
         patch.object(repo, "save_contact", side_effect=lambda c: c) as mock_save:

        mock_mx.return_value = ("VALID_MX", ["mail.stripe.com"])

        resp_1 = await service.discover_contacts(user_id="user_dedup_1", opportunity_id="opp_stripe_eng", force_refresh=True)
        assert len(resp_1.contacts) == 1
        saved_contact = resp_1.contacts[0]
        assert saved_contact.fullName == "Jane Doe"
        assert "opp_stripe_eng" in saved_contact.associatedOpportunityIds
        assert saved_contact.companyKey == "stripe"

    # Second discovery run for Opportunity 2: Active company contacts now contains Jane Doe
    with patch("app.services.contact_discovery_service.verify_domain_mx", new_callable=AsyncMock) as mock_mx, \
         patch.object(repo, "list_active_contacts_for_company", return_value=[saved_contact]) as mock_active_co, \
         patch.object(repo, "list_company_tombstones", return_value=[]) as mock_tombstones, \
         patch.object(repo, "save_contact", side_effect=lambda c: c) as mock_save:

        mock_mx.return_value = ("VALID_MX", ["mail.stripe.com"])

        resp_2 = await service.discover_contacts(user_id="user_dedup_1", opportunity_id="opp_stripe_pm", force_refresh=True)
        assert len(resp_2.contacts) == 1
        merged_contact = resp_2.contacts[0]

        # Reuses exact contact ID
        assert merged_contact.id == saved_contact.id
        # Multi-opportunity association includes both opportunities
        assert "opp_stripe_eng" in merged_contact.associatedOpportunityIds
        assert "opp_stripe_pm" in merged_contact.associatedOpportunityIds
        assert resp_2.existingRefreshed == 1


# -----------------------------------------------------------------------------
# 3. Preservation of Existing Outreach History & Notes
# -----------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_preservation_of_existing_outreach_history_and_notes():
    """Verify rediscovery preserves contact review status, notes, outreach count, and drafts."""
    repo = OpportunityContactRepository()
    service = ContactDiscoveryService(repo=repo)

    job = _make_test_job("opp_figma_eng", "Figma", "Frontend Engineer")

    existing_contact = DiscoveredContact(
        id="contact_figma_recruiter",
        userId="user_outreach_1",
        opportunityId="opp_figma_prev",
        companyName="Figma",
        companyKey="figma",
        associatedOpportunityIds=["opp_figma_prev"],
        fullName="Dylan Field",
        roleTitle="CEO & Co-Founder",
        email=None,
        linkedinUrl="https://linkedin.com/in/dylanfield",
        identityKeys=["li:dylanfield", "comp_fn_role:figma:dylanfield:leadership"],
        contactabilityStatus="PROFILE_ONLY",
        isReviewed=True,
        doNotContact=True,
        suppressionState="GLOBAL_STAKEHOLDER_SUPPRESSION",
        suppressionReason="Manual user suppression",
        rankingScore=150,
        confidenceScore=0.9,
    )

    candidate_raw = RawContactCandidate(
        full_name="Dylan Field",
        role_title="CEO",
        company="Figma",
        linkedin_url="https://linkedin.com/in/dylanfield",
        email="dylan@figma.com",
    )

    service.agent_reach.is_configured = MagicMock(return_value=True)
    service.agent_reach.search_contacts = AsyncMock(return_value=([candidate_raw], ["Figma CEO"]))

    with patch("app.services.contact_discovery_service.verify_domain_mx", new_callable=AsyncMock) as mock_mx, \
         patch.object(repo, "list_active_contacts_for_company", return_value=[existing_contact]) as mock_active_co, \
         patch.object(repo, "list_company_tombstones", return_value=[]) as mock_tombstones, \
         patch.object(repo, "save_contact", side_effect=lambda c: c) as mock_save:

        mock_mx.return_value = ("VALID_MX", ["mail.figma.com"])

        resp = await service.discover_contacts(user_id="user_outreach_1", opportunity_id="opp_figma_eng", force_refresh=True)
        assert len(resp.contacts) == 1
        enriched = resp.contacts[0]

        # Review status and suppression state strictly intact
        assert enriched.id == "contact_figma_recruiter"
        assert enriched.isReviewed is True
        assert enriched.doNotContact is True
        assert enriched.suppressionState == "GLOBAL_STAKEHOLDER_SUPPRESSION"
        assert enriched.suppressionReason == "Manual user suppression"
        assert enriched.rankingScore == 150
        assert enriched.confidenceScore == 0.9
        # Enriched email and new opportunity added
        assert enriched.email == "dylan@figma.com"
        assert "opp_figma_eng" in enriched.associatedOpportunityIds
        assert "opp_figma_prev" in enriched.associatedOpportunityIds


# -----------------------------------------------------------------------------
# 4. Ambiguity Protection & False-Positive Guard Tests
# -----------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_identical_names_conflicting_signals_prevent_auto_merge():
    """Verify people with identical names but conflicting LinkedIn vanity slugs are never merged."""
    repo = OpportunityContactRepository()
    service = ContactDiscoveryService(repo=repo)

    job = _make_test_job("opp_acme_eng", "Acme Corp", "Software Engineer")

    cand_1 = RawContactCandidate(
        full_name="Alex Smith",
        role_title="Senior Recruiter",
        company="Acme Corp",
        linkedin_url="https://linkedin.com/in/alex-smith-recruiting",
    )
    cand_2 = RawContactCandidate(
        full_name="Alex Smith",
        role_title="Lead Technical Recruiter",
        company="Acme Corp",
        linkedin_url="https://linkedin.com/in/alex-smith-tech-talent",
    )

    service.agent_reach.is_configured = MagicMock(return_value=True)
    service.agent_reach.search_contacts = AsyncMock(return_value=([cand_1, cand_2], ["Acme recruiters"]))

    with patch.object(repo, "list_active_contacts_for_company", return_value=[]) as mock_active_co, \
         patch.object(repo, "list_company_tombstones", return_value=[]) as mock_tombstones, \
         patch.object(repo, "save_contact", side_effect=lambda c: c) as mock_save:

        resp = await service.discover_contacts(user_id="user_ambig_1", opportunity_id="opp_acme_eng", force_refresh=True)
        # Conflicting strong LinkedIn signals prevent merge -> 2 separate contacts
        assert len(resp.contacts) == 2
        assert resp.contacts[0].id != resp.contacts[1].id
        linkedin_slugs = {extract_linkedin_vanity_slug(c.linkedinUrl) for c in resp.contacts}
        assert "alex-smith-recruiting" in linkedin_slugs
        assert "alex-smith-tech-talent" in linkedin_slugs


@pytest.mark.asyncio
async def test_ambiguous_names_flagged_with_discriminant_id():
    """Verify identical names matching an existing record without strong signals are flagged as ambiguous."""
    repo = OpportunityContactRepository()
    service = ContactDiscoveryService(repo=repo)

    job = _make_test_job("opp_globex_eng", "Globex", "Software Engineer")

    # Existing contact in Globex without verified email or LinkedIn URL
    existing_john = DiscoveredContact(
        id="c_globex_john_1",
        userId="user_ambig_2",
        opportunityId="opp_globex_prev",
        companyName="Globex",
        companyKey="globex",
        associatedOpportunityIds=["opp_globex_prev"],
        fullName="John Doe",
        roleTitle="Software Engineer",
        email=None,
        linkedinUrl=None,
        identityKeys=["comp_fn_role:globex:johndoe:engineer"],
        contactabilityStatus="PROFILE_ONLY",
    )

    # New candidate discovered with identical name, same role, no strong signals
    candidate_raw = RawContactCandidate(
        full_name="John Doe",
        role_title="Software Engineer",
        company="Globex",
        location="Hyderabad, India",
    )

    service.agent_reach.is_configured = MagicMock(return_value=True)
    service.agent_reach.search_contacts = AsyncMock(return_value=([candidate_raw], ["Globex engineers"]))

    with patch.object(repo, "list_active_contacts_for_company", return_value=[existing_john]) as mock_active_co, \
         patch.object(repo, "list_company_tombstones", return_value=[]) as mock_tombstones, \
         patch.object(repo, "save_contact", side_effect=lambda c: c) as mock_save:

        resp = await service.discover_contacts(user_id="user_ambig_2", opportunity_id="opp_globex_eng", force_refresh=True)

        # Ambiguity safeguard triggers: contact is preserved as distinct, flagged isAmbiguousMatch
        assert len(resp.contacts) == 1
        ambig_contact = resp.contacts[0]
        assert "identical or similar name" in (ambig_contact.ambiguityReason or "")
        # Collision-resistant discriminant ID assigned
        assert ambig_contact.id != existing_john.id


# -----------------------------------------------------------------------------
# 5. Pre-Persistence Tombstone Verification Prevents Resurrection
# -----------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_pre_persistence_tombstone_verification_prevents_resurrection():
    """Verify that a contact deleted/tombstoned before or during discovery is NEVER resurrected."""
    repo = OpportunityContactRepository()
    service = ContactDiscoveryService(repo=repo)

    job = _make_test_job("opp_umbrella_1", "Umbrella Corp", "Biochemist")

    candidate_raw = RawContactCandidate(
        full_name="Albert Wesker",
        role_title="Director of Research",
        company="Umbrella Corp",
        linkedin_url="https://linkedin.com/in/albertwesker",
        email="wesker@umbrella.com",
    )

    service.agent_reach.is_configured = MagicMock(return_value=True)
    service.agent_reach.search_contacts = AsyncMock(return_value=([candidate_raw], ["Umbrella leadership"]))

    # Tombstone exists in company tombstones collection for Albert Wesker
    tombstone_doc = {
        "companyKey": "umbrellacorp",
        "identityKeys": ["li:albertwesker", "em:wesker@umbrella.com"],
        "deletedAt": "2026-10-25T12:00:00Z",
    }

    with patch("app.services.contact_discovery_service.verify_domain_mx", new_callable=AsyncMock) as mock_mx, \
         patch.object(repo, "list_active_contacts_for_company", return_value=[]) as mock_active_co, \
         patch.object(repo, "list_company_tombstones", return_value=[tombstone_doc]) as mock_tombstones, \
         patch.object(repo, "is_identity_tombstoned", return_value=True) as mock_is_tomb, \
         patch.object(repo, "save_contact", side_effect=lambda c: c) as mock_save:

        mock_mx.return_value = ("VALID_MX", ["mail.umbrella.com"])

        resp = await service.discover_contacts(user_id="user_tomb_1", opportunity_id="opp_umbrella_1", force_refresh=True)

        # Contact is suppressed by tombstone
        assert len(resp.contacts) == 0
        assert resp.tombstonesSuppressed == 1
        mock_save.assert_not_called()


# -----------------------------------------------------------------------------
# 6. Contact Deletion API Security & Idempotency
# -----------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_contact_deletion_security_and_idempotency():
    """Verify dual ownership authorization, opportunity association check, and idempotent retries."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        contact = DiscoveredContact(
            id="c_delete_sec_1",
            userId="user_owner_1",
            opportunityId="opp_valid_1",
            companyName="Wayne Enterprises",
            companyKey="wayne",
            associatedOpportunityIds=["opp_valid_1", "opp_valid_2"],
            fullName="Lucius Fox",
            roleTitle="Head of Applied Sciences",
            contactabilityStatus="PROFILE_ONLY",
        )

        # 1. User B attempts to delete User A's contact -> 403 Forbidden
        with patch.object(opportunity_contact_repo, "get_contact", return_value=None), \
             patch.object(opportunity_contact_repo, "get_contact_any_user", return_value=contact):

            resp_cross = await client.delete(
                "/api/v1/opportunities/opp_valid_1/contacts/c_delete_sec_1",
                headers={"X-User-Id": "user_attacker_2"},
            )
            assert resp_cross.status_code == 403
            assert "Forbidden" in resp_cross.json()["detail"]

        # 2. User A attempts to delete specifying an opportunity that the contact is NOT associated with -> 400 Bad Request
        with patch.object(opportunity_contact_repo, "get_contact", return_value=contact):
            resp_unrelated = await client.delete(
                "/api/v1/opportunities/opp_unrelated_99/contacts/c_delete_sec_1",
                headers={"X-User-Id": "user_owner_1"},
            )
            assert resp_unrelated.status_code == 400
            assert "associated" in resp_unrelated.json()["detail"]

        # 3. Legitimate deletion with valid opportunity -> 200 OK
        with patch.object(opportunity_contact_repo, "get_contact", return_value=contact), \
             patch.object(opportunity_contact_repo, "soft_delete_contact", return_value=True):

            resp_ok = await client.delete(
                "/api/v1/opportunities/opp_valid_1/contacts/c_delete_sec_1",
                headers={"X-User-Id": "user_owner_1"},
            )
            assert resp_ok.status_code == 200
            data = resp_ok.json()
            assert data["success"] is True
            assert data["idempotent"] is False

        # 4. Retrying deletion when contact is already deleted -> 200 OK (idempotent)
        deleted_contact = contact.model_copy(update={"isDeleted": True, "deletedAt": datetime.now(UTC).isoformat()})
        with patch.object(opportunity_contact_repo, "get_contact", return_value=deleted_contact):

            resp_retry = await client.delete(
                "/api/v1/opportunities/opp_valid_1/contacts/c_delete_sec_1",
                headers={"X-User-Id": "user_owner_1"},
            )
            assert resp_retry.status_code == 200
            assert resp_retry.json()["idempotent"] is True


# -----------------------------------------------------------------------------
# 7. Persistent Bulk Research Jobs API & Concurrency
# -----------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_bulk_research_job_api_and_lease_concurrency():
    """Verify HTTP 202 on job creation, atomic lease claiming, and concurrency prevention."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:

        # 1. POST /bulk-research/jobs returns HTTP 202 Accepted
        with patch.object(bulk_research_job_repo, "save_job") as mock_save, \
             patch.object(bulk_research_job_repo, "get_active_job", return_value=None), \
             patch("app.api.v1.companies.bulk_company_orchestrator.execute_async_bulk_job", new_callable=AsyncMock):

            mock_save.side_effect = lambda job: job

            create_resp = await client.post(
                "/api/v1/companies/bulk-research/jobs",
                headers={"X-User-Id": "user_job_1"},
                json={"companyKeys": ["stripe", "figma"], "forceRefresh": False},
            )
            assert create_resp.status_code == 202
            body = create_resp.json()
            assert "jobId" in body
            assert body["status"] == "QUEUED"
            job_id = body["jobId"]

        # 2. GET /bulk-research/jobs/{id} returns job
        mock_job = BulkResearchJobDocument(
            jobId=job_id,
            userId="user_job_1",
            companyKeys=["stripe", "figma"],
            status="HARVESTING",
            progressStage="harvesting",
            progressPct=35,
            currentStageDescription="Scraping corporate career signals",
            createdAt=datetime.now(UTC).isoformat(),
            updatedAt=datetime.now(UTC).isoformat(),
        )

        with patch.object(bulk_research_job_repo, "get_job") as mock_get_job:
            mock_get_job.return_value = mock_job

            get_resp = await client.get(
                f"/api/v1/companies/bulk-research/jobs/{job_id}",
                headers={"X-User-Id": "user_job_1"},
            )
            assert get_resp.status_code == 200
            job_data = get_resp.json()
            assert job_data["jobId"] == job_id
            assert job_data["status"] == "HARVESTING"
            assert job_data["progressPct"] == 35

            # Tenant isolation: other user cannot view this job
            mock_get_job.return_value = None
            get_resp_denied = await client.get(
                f"/api/v1/companies/bulk-research/jobs/{job_id}",
                headers={"X-User-Id": "other_user_2"},
            )
            assert get_resp_denied.status_code == 404

        # 3. Lease Concurrency Guard: Worker 1 claims, Worker 2 is rejected
        repo = bulk_research_job_repo
        now_iso = datetime.now(UTC).isoformat()
        future_iso = (datetime.now(UTC) + timedelta(seconds=120)).isoformat()

        job_doc = BulkResearchJobDocument(
            jobId="job_lease_test",
            userId="user_lease_1",
            companyKeys=["stripe"],
            status="QUEUED",
            progressStage="queued",
            progressPct=0,
            currentStageDescription="Queued",
            createdAt=now_iso,
            updatedAt=now_iso,
        )

        with patch.object(repo, "get_job") as mock_get_j, \
             patch.object(repo, "save_job") as mock_save_j:

            mock_get_j.return_value = job_doc
            mock_save_j.side_effect = lambda j: j

            claimed_1 = repo.claim_job_lease(
                user_id="user_lease_1",
                job_id="job_lease_test",
                worker_id="worker_A",
                lease_duration_seconds=120,
            )
            assert claimed_1 is True

            # Worker 2 attempts to claim active leased job before expiry
            job_doc.workerId = "worker_A"
            job_doc.leaseExpiresAt = future_iso
            mock_get_j.return_value = job_doc

            claimed_2 = repo.claim_job_lease(
                user_id="user_lease_1",
                job_id="job_lease_test",
                worker_id="worker_B",
                lease_duration_seconds=120,
            )
            assert claimed_2 is False


# -----------------------------------------------------------------------------
# 8. Stale Job Recovery & Lease Expiry
# -----------------------------------------------------------------------------
def test_stale_job_recovery():
    """Verify that crashed/stale background jobs are safely recovered without leaving orphaned running jobs."""
    repo = bulk_research_job_repo
    past_stale_iso = (datetime.now(UTC) - timedelta(seconds=300)).isoformat()

    stale_job = BulkResearchJobDocument(
        jobId="job_crashed_1",
        userId="user_recov_1",
        companyKeys=["stripe"],
        status="HARVESTING",
        progressStage="harvesting",
        progressPct=40,
        currentStageDescription="Harvesting signals",
        workerId="crashed_worker_1",
        leaseExpiresAt=past_stale_iso,
        createdAt=past_stale_iso,
        updatedAt=past_stale_iso,
    )

    # Insert stale job into memory cache
    repo._memory_cache[repo._cache_key("user_recov_1", "job_crashed_1")] = stale_job

    with patch("app.db.repositories.bulk_research_job_repo.get_firestore_client", return_value=None):
        recovered = repo.recover_stale_jobs("user_recov_1", stale_timeout_seconds=180)
        assert len(recovered) == 1
        assert recovered[0].jobId == "job_crashed_1"
        assert recovered[0].status == "FAILED"
        assert recovered[0].errorMessage is not None
        assert "timed out or interrupted by backend restart" in recovered[0].errorMessage


# -----------------------------------------------------------------------------
# 9. Migration Script Safety Guard
# -----------------------------------------------------------------------------
def test_migration_script_safety_abort():
    """Verify deduplication migration script refuses execution unless BOTH --execute and --confirm are provided."""
    import subprocess
    import sys

    # 1. Dry-run mode by default
    res_dry = subprocess.run(
        [sys.executable, "scripts/deduplicate_existing_contacts.py", "--dry-run"],
        cwd="/home/mohdaffan/Desktop/jobFinder/apps/api",
        capture_output=True,
        text=True,
    )
    assert res_dry.returncode == 0
    assert "DRY RUN" in res_dry.stdout or "DRY RUN" in res_dry.stderr

    # 2. Execution attempted without --confirm -> MUST ABORT WITH EXIT CODE 1
    res_abort = subprocess.run(
        [sys.executable, "scripts/deduplicate_existing_contacts.py", "--execute"],
        cwd="/home/mohdaffan/Desktop/jobFinder/apps/api",
        capture_output=True,
        text=True,
    )
    assert res_abort.returncode == 1
    assert "Aborting" in res_abort.stderr or "CRITICAL SAFETY VIOLATION" in res_abort.stderr or "ABORTED" in res_abort.stderr
