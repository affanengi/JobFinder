"""Regression & Integration Tests for Issue 1 (Scale AI Deduplication) and Issue 2 (Backend Event Loop Stability).

Validates:
1. Canonical company normalization for Scale AI and Figma variants.
2. GET /api/v1/companies collapses multiple raw company variants into 1 canonical card with combined openings count (89 for Scale AI).
3. GET /api/v1/companies/{name_or_key} resolves all 89 openings whether queried by raw name, canonical key, or slug.
4. Non-blocking backend execution: health check /api/v1/health responds with low latency even during company detail retrieval with 89 opportunities.
5. Ingestion normalization produces canonical company name and slug.
"""

import asyncio
from datetime import UTC, datetime
import pytest
from httpx import ASGITransport, AsyncClient

from app.main import app
from app.schemas.job import CanonicalJob, JobSourceRef
from app.services.company_identity_service import normalize_company
from app.services.job_normalization_service import job_normalization_service
from app.services.job_service import job_service
from app.sources.base import RawJobPayload


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


def test_scale_ai_and_figma_identity_normalization():
    """Verify company_identity_service canonicalizes various forms of Scale AI and Figma."""
    # Scale AI variations
    k1, name1, dom1 = normalize_company("Scale AI", "https://scale.com")
    assert k1 == "scale-ai"
    assert name1 == "Scale AI"
    assert dom1 == "scale.com"

    k2, name2, dom2 = normalize_company("Scaleai", "https://job-boards.greenhouse.io/scaleai")
    assert k2 == "scale-ai"
    assert name2 == "Scale AI"
    assert dom2 == "scale.com"

    k3, name3, dom3 = normalize_company("ScaleAI Labs", "https://jobs.ashbyhq.com/scaleai")
    assert k3 == "scale-ai"
    assert name3 == "Scale AI"
    assert dom3 == "scale.com"

    # Figma variations
    k4, name4, dom4 = normalize_company("Figma Inc.", "https://figma.com")
    assert k4 == "figma"
    assert name4 == "Figma"
    assert dom4 == "figma.com"


def test_job_ingestion_canonicalization():
    """Verify job_normalization_service assigns canonical name and slug on ATS ingestion."""
    raw_ashby = RawJobPayload(
        sourceType="ashby",
        sourceId="12345",
        companyName="Scaleai",
        companySlug="scaleai",
        url="https://jobs.ashbyhq.com/scaleai/12345",
        rawTitle="Forward Deployed Engineer",
        rawLocation="San Francisco, CA",
        rawDescription="Building custom AI solutions with Python and FastAPI.",
    )
    job = job_normalization_service.normalize(raw_ashby)
    assert job.company == "Scale AI"
    assert job.sourceRef.companySlug == "scale-ai"


@pytest.mark.asyncio
async def test_get_companies_deduplicates_scale_ai_to_single_card():
    """Verify 89 Scale AI jobs split across 'Scale AI', 'Scaleai', and 'ScaleAI Labs' yield exactly 1 card with 89 openings."""
    user_id = "user_test_scale_dedup"
    now = datetime.now(UTC).isoformat()

    # Seed 73 jobs as 'Scale AI', 15 as 'Scaleai', 1 as 'ScaleAI Labs'
    for i in range(73):
        job = CanonicalJob(
            id=f"job_scale_ashby_{i}",
            title=f"Ashby Scale Engineer {i}",
            company="Scale AI",
            companySlug="scale-ai",
            location="San Francisco, CA",
            description="Scale AI job",
            sourceRef=JobSourceRef(adapter="ashby", originalUrl=f"https://jobs.ashbyhq.com/scaleai/{i}"),
            createdAt=now,
        )
        job_service._jobs[job.id] = job

    for i in range(15):
        job = CanonicalJob(
            id=f"job_scale_gh_{i}",
            title=f"Greenhouse Scale Engineer {i}",
            company="Scaleai",
            companySlug="scaleai",
            location="Remote",
            description="Scale AI Greenhouse job",
            sourceRef=JobSourceRef(adapter="greenhouse", originalUrl=f"https://job-boards.greenhouse.io/scaleai/{i}"),
            createdAt=now,
        )
        job_service._jobs[job.id] = job

    job_labs = CanonicalJob(
        id="job_scale_labs_0",
        title="ScaleAI Labs Researcher",
        company="ScaleAI Labs",
        companySlug="scaleai-labs",
        location="New York, NY",
        description="ScaleAI Labs job",
        sourceRef=JobSourceRef(adapter="manual_url", originalUrl="https://scale.com/careers/research"),
        createdAt=now,
    )
    job_service._jobs[job_labs.id] = job_labs

    assert len(job_service._jobs) == 89

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.get("/api/v1/companies", headers={"X-User-Id": user_id})
        assert resp.status_code == 200
        cards = resp.json()

        # Should be exactly ONE card for Scale AI
        scale_cards = [c for c in cards if c["key"] == "scale-ai" or c["name"] == "Scale AI"]
        assert len(scale_cards) == 1, f"Expected 1 Scale AI card, got {len(scale_cards)}"

        card = scale_cards[0]
        assert card["key"] == "scale-ai"
        assert card["name"] == "Scale AI"
        assert card["domain"] == "scale.com"
        assert card["opportunityCount"] == 89


@pytest.mark.asyncio
async def test_get_company_detail_scale_ai_queries_all_variations():
    """Verify company detail resolves all 89 openings whether queried as 'Scale AI', 'scale-ai', or 'scaleai'."""
    user_id = "user_test_scale_detail"
    now = datetime.now(UTC).isoformat()

    # Seed 89 jobs across the 3 variations
    for i in range(73):
        job = CanonicalJob(
            id=f"job_scale_ashby_{i}",
            title=f"Ashby Scale Engineer {i}",
            company="Scale AI",
            companySlug="scale-ai",
            location="San Francisco, CA",
            description="Scale AI job",
            sourceRef=JobSourceRef(adapter="ashby", originalUrl=f"https://jobs.ashbyhq.com/scaleai/{i}"),
            createdAt=now,
        )
        job_service._jobs[job.id] = job

    for i in range(15):
        job = CanonicalJob(
            id=f"job_scale_gh_{i}",
            title=f"Greenhouse Scale Engineer {i}",
            company="Scaleai",
            companySlug="scaleai",
            location="Remote",
            description="Scale AI Greenhouse job",
            sourceRef=JobSourceRef(adapter="greenhouse", originalUrl=f"https://job-boards.greenhouse.io/scaleai/{i}"),
            createdAt=now,
        )
        job_service._jobs[job.id] = job

    job_labs = CanonicalJob(
        id="job_scale_labs_0",
        title="ScaleAI Labs Researcher",
        company="ScaleAI Labs",
        companySlug="scaleai-labs",
        location="New York, NY",
        description="ScaleAI Labs job",
        sourceRef=JobSourceRef(adapter="manual_url", originalUrl="https://scale.com/careers/research"),
        createdAt=now,
    )
    job_service._jobs[job_labs.id] = job_labs

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # 1. Query by canonical key: /api/v1/companies/scale-ai
        resp_key = await client.get("/api/v1/companies/scale-ai", headers={"X-User-Id": user_id})
        assert resp_key.status_code == 200
        detail_key = resp_key.json()
        assert detail_key["key"] == "scale-ai"
        assert detail_key["name"] == "Scale AI"
        assert len(detail_key["opportunities"]) == 89

        # 2. Query by URL-encoded name: /api/v1/companies/Scale%20AI
        resp_name = await client.get("/api/v1/companies/Scale%20AI", headers={"X-User-Id": user_id})
        assert resp_name.status_code == 200
        detail_name = resp_name.json()
        assert detail_name["key"] == "scale-ai"
        assert len(detail_name["opportunities"]) == 89

        # 3. Query by raw variation: /api/v1/companies/scaleai
        resp_var = await client.get("/api/v1/companies/scaleai", headers={"X-User-Id": user_id})
        assert resp_var.status_code == 200
        detail_var = resp_var.json()
        assert detail_var["key"] == "scale-ai"
        assert len(detail_var["opportunities"]) == 89


@pytest.mark.asyncio
async def test_backend_event_loop_concurrency_during_company_detail():
    """Verify that requesting company detail with 89 jobs does not block concurrent health checks."""
    user_id = "user_test_scale_concurrency"
    now = datetime.now(UTC).isoformat()

    for i in range(89):
        job = CanonicalJob(
            id=f"job_scale_perf_{i}",
            title=f"Engineer {i}",
            company="Scale AI",
            companySlug="scale-ai",
            location="San Francisco, CA",
            description="Testing concurrent event loop responsiveness",
            sourceRef=JobSourceRef(adapter="ashby", originalUrl=f"https://jobs.ashbyhq.com/scaleai/{i}"),
            createdAt=now,
        )
        job_service._jobs[job.id] = job

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # Launch both requests concurrently
        t0 = asyncio.get_event_loop().time()
        detail_task = asyncio.create_task(
            client.get("/api/v1/companies/scale-ai", headers={"X-User-Id": user_id})
        )
        # Small sleep to let detail_task start executing
        await asyncio.sleep(0.001)
        health_resp = await client.get("/api/v1/health")
        detail_resp = await detail_task
        elapsed = asyncio.get_event_loop().time() - t0

        assert health_resp.status_code == 200
        assert health_resp.json()["status"] == "ok"
        assert detail_resp.status_code == 200
        assert len(detail_resp.json()["opportunities"]) == 89
        # Both complete quickly without blocking
        assert elapsed < 1.0
