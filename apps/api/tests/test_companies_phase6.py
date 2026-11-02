"""Phase 6 Backend Integration Test Suite: Company-First Portal API.

Validates:
1. GET /api/v1/companies returns deduplicated company summaries.
2. Company search filtering operates accurately (case-insensitive debounced queries).
3. Company enrichment connects cached Scam Shield intelligence and discovered contacts.
4. GET /api/v1/companies/{company_key} resolves full company details with opportunities and contacts.
5. Strict tenant isolation across companies, company intelligence, and discovered contacts.
6. 404 handling for nonexistent company keys.
"""

from datetime import UTC, datetime, timedelta
import pytest
from httpx import ASGITransport, AsyncClient

from app.db.repositories.company_intelligence_repo import company_intelligence_repo
from app.db.repositories.opportunity_contact_repo import opportunity_contact_repo
from app.main import app
from app.schemas.company_intelligence import (
    CompanyIntelligenceResult,
    EvaluatedDimensionItem,
)
from app.schemas.job import CanonicalJob, JobSourceRef
from app.schemas.opportunity_contact import DiscoveredContact
from app.services.job_service import job_service


@pytest.fixture(autouse=True)
def setup_teardown_opportunities():
    """Ensure in-memory repositories have pristine state for each test."""
    original_jobs = dict(job_service._jobs)
    original_init = job_service._initialized_from_db
    job_service._jobs = {}
    job_service._initialized_from_db = True
    yield
    job_service._jobs = original_jobs
    job_service._initialized_from_db = original_init


@pytest.mark.asyncio
async def test_get_companies_empty():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # User with no opportunities in the catalog
        resp = await client.get("/api/v1/companies", headers={"X-User-Id": "user_empty_p6"})
        assert resp.status_code == 200
        assert resp.json() == []


@pytest.mark.asyncio
async def test_get_companies_deduplication_and_enrichment():
    user_id = "user_p6_dedup"
    now = datetime.now(UTC).isoformat()
    ttl = (datetime.now(UTC) + timedelta(days=14)).isoformat()

    # Seed 3 opportunities: 2 for Stripe, 1 for Figma
    job1 = CanonicalJob(
        id="job_stripe_1",
        title="Staff Backend Engineer",
        company="Stripe",
        companySlug="stripe",
        location="San Francisco, CA",
        description="Staff backend engineer building financial infrastructure.",
        sourceRef=JobSourceRef(adapter="manual_url", originalUrl="https://stripe.com/jobs/1"),
        createdAt=now,
    )
    job2 = CanonicalJob(
        id="job_stripe_2",
        title="Senior Frontend Engineer",
        company="Stripe",
        companySlug="stripe",
        location="Remote",
        description="Frontend engineer working on Dashboard.",
        sourceRef=JobSourceRef(adapter="manual_url", originalUrl="https://stripe.com/jobs/2"),
        createdAt=now,
    )
    job3 = CanonicalJob(
        id="job_figma_1",
        title="Product Designer",
        company="Figma",
        companySlug="figma",
        location="New York, NY",
        description="Product designer on design systems.",
        sourceRef=JobSourceRef(adapter="manual_url", originalUrl="https://figma.com/careers/1"),
        createdAt=now,
    )

    job_service._jobs[job1.id] = job1
    job_service._jobs[job2.id] = job2
    job_service._jobs[job3.id] = job3

    # Seed intelligence for Stripe for user_id
    intel = CompanyIntelligenceResult(
        id="intel_stripe_p6",
        userId=user_id,
        opportunityId=job1.id,
        companyName="Stripe",
        officialDomain="stripe.com",
        careersUrl="https://stripe.com/jobs",
        riskTier="NO_OBVIOUS_RED_FLAGS_FOUND",
        summary="Leading payment infrastructure company.",
        evaluatedDimensions={
            "domainConsistency": EvaluatedDimensionItem(status="PASS", evidence="Domain matches", confidence=1.0)
        },
        researchedAt=now,
        ttlExpiresAt=ttl,
    )
    company_intelligence_repo.save_intelligence(intel)

    # Seed a contact for Stripe job1 for user_id
    contact = DiscoveredContact(
        id="contact_stripe_1",
        userId=user_id,
        opportunityId=job1.id,
        fullName="Patrick Collison",
        roleTitle="CEO",
        companyName="Stripe",
        email="patrick@stripe.com",
        emailEvidenceClassification="PUBLICLY_LISTED",
    )
    opportunity_contact_repo.save_contact(contact)

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.get("/api/v1/companies", headers={"X-User-Id": user_id})
        assert resp.status_code == 200
        companies = resp.json()

        # Should have exactly 2 deduplicated companies (Stripe, Figma)
        assert len(companies) == 2
        names = [c["name"] for c in companies]
        assert "Stripe" in names
        assert "Figma" in names

        stripe = next(c for c in companies if c["name"] == "Stripe")
        assert stripe["opportunityCount"] == 2
        assert stripe["contactsCount"] == 1
        assert stripe["intelligenceStatus"] == "NO_OBVIOUS_RED_FLAGS_FOUND"

        figma = next(c for c in companies if c["name"] == "Figma")
        assert figma["opportunityCount"] == 1
        assert figma["contactsCount"] == 0
        assert figma["intelligenceStatus"] == "NOT_RESEARCHED"


@pytest.mark.asyncio
async def test_get_companies_search_filter():
    user_id = "user_p6_search"
    now = datetime.now(UTC).isoformat()

    job1 = CanonicalJob(
        id="job_search_1",
        title="Software Engineer",
        company="Datadog",
        location="New York, NY",
        description="Observability engineering.",
        sourceRef=JobSourceRef(adapter="manual_url", originalUrl="https://datadog.com"),
        createdAt=now,
    )
    job2 = CanonicalJob(
        id="job_search_2",
        title="DevOps Engineer",
        company="DataBricks",
        location="San Francisco, CA",
        description="Data engineering platforms.",
        sourceRef=JobSourceRef(adapter="manual_url", originalUrl="https://databricks.com"),
        createdAt=now,
    )
    job3 = CanonicalJob(
        id="job_search_3",
        title="Security Analyst",
        company="Cloudflare",
        location="Remote",
        description="Zero trust security engineering.",
        sourceRef=JobSourceRef(adapter="manual_url", originalUrl="https://cloudflare.com"),
        createdAt=now,
    )
    job_service._jobs[job1.id] = job1
    job_service._jobs[job2.id] = job2
    job_service._jobs[job3.id] = job3

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # Search "data"
        resp = await client.get("/api/v1/companies?query=data", headers={"X-User-Id": user_id})
        assert resp.status_code == 200
        data_companies = resp.json()
        assert len(data_companies) == 2
        names = {c["name"] for c in data_companies}
        assert names == {"Datadog", "Databricks"}

        # Search "cloud"
        resp_cloud = await client.get("/api/v1/companies?query=cloud", headers={"X-User-Id": user_id})
        assert resp_cloud.status_code == 200
        cloud_companies = resp_cloud.json()
        assert len(cloud_companies) == 1
        assert cloud_companies[0]["name"] == "Cloudflare"


@pytest.mark.asyncio
async def test_get_company_detail_and_tenant_isolation():
    user_alice = "user_p6_tenant_alice"
    user_bob = "user_p6_tenant_bob"
    now = datetime.now(UTC).isoformat()
    ttl = (datetime.now(UTC) + timedelta(days=14)).isoformat()

    job = CanonicalJob(
        id="job_acme_1",
        title="Principal Architect",
        company="Acme Corp",
        location="Remote",
        description="Building scalable enterprise architectures.",
        sourceRef=JobSourceRef(adapter="manual_url", originalUrl="https://acme.com/jobs/1"),
        createdAt=now,
    )
    job_service._jobs[job.id] = job

    # Alice conducts Scam Shield research and discovers contacts for Acme
    intel_alice = CompanyIntelligenceResult(
        id="intel_acme_alice",
        userId=user_alice,
        opportunityId=job.id,
        companyName="Acme Corp",
        officialDomain="acme.com",
        careersUrl="https://acme.com/jobs/1",
        riskTier="NO_OBVIOUS_RED_FLAGS_FOUND",
        summary="Alice private analysis for Acme.",
        evaluatedDimensions={
            "domainConsistency": EvaluatedDimensionItem(status="PASS", evidence="Matches", confidence=1.0)
        },
        researchedAt=now,
        ttlExpiresAt=ttl,
    )
    company_intelligence_repo.save_intelligence(intel_alice)

    contact_alice = DiscoveredContact(
        id="contact_acme_alice",
        userId=user_alice,
        opportunityId=job.id,
        fullName="Alice Contact",
        roleTitle="VP Engineering",
        companyName="Acme Corp",
        email="vp@acme.com",
        emailEvidenceClassification="PROVIDER_VERIFIED",
    )
    opportunity_contact_repo.save_contact(contact_alice)

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # 1. Alice retrieves Acme Corp detail -> Sees her intelligence and contacts
        resp_alice = await client.get("/api/v1/companies/acme-corp", headers={"X-User-Id": user_alice})
        assert resp_alice.status_code == 200
        detail_alice = resp_alice.json()
        assert detail_alice["name"] == "Acme Corp"
        assert len(detail_alice["opportunities"]) == 1
        assert detail_alice["intelligence"] is not None
        assert detail_alice["intelligence"]["id"] == "intel_acme_alice"
        assert len(detail_alice["contacts"]) == 1
        assert detail_alice["contacts"][0]["id"] == "contact_acme_alice"

        # 2. Bob retrieves Acme Corp detail -> Sees opportunities, but CANNOT see Alice's intelligence or contacts (Tenant Isolation)
        resp_bob = await client.get("/api/v1/companies/acme-corp", headers={"X-User-Id": user_bob})
        assert resp_bob.status_code == 200
        detail_bob = resp_bob.json()
        assert detail_bob["name"] == "Acme Corp"
        assert len(detail_bob["opportunities"]) == 1
        assert detail_bob["intelligence"] is None
        assert len(detail_bob["contacts"]) == 0

        # 3. Nonexistent company returns 404
        resp_unknown = await client.get("/api/v1/companies/non-existent-company", headers={"X-User-Id": user_alice})
        assert resp_unknown.status_code == 404
