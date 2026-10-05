"""Idempotent migration script to refresh and structure active jobs from authentic ATS sources."""

import asyncio
from datetime import UTC, datetime
import logging
import sys

from app.db.firebase import get_firestore_client
from app.db.repositories.job_repo import job_repo
from app.schemas.job import CanonicalJob
from app.services.job_normalization_service import job_normalization_service
from app.sources.ashby import AshbyAdapter
from app.sources.greenhouse import GreenhouseAdapter
from app.sources.lever import LeverAdapter

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("refresh_jobs_structure")


async def refresh_active_jobs(company_filter: str | None = None, limit: int | None = None):
    """Re-fetch active jobs via source adapters and update description & descriptionBlocks."""
    gh_adapter = GreenhouseAdapter()
    ashby_adapter = AshbyAdapter()
    lever_adapter = LeverAdapter()
    db = get_firestore_client()

    all_jobs = job_repo.list_all(limit=500)
    logger.info(f"Loaded {len(all_jobs)} jobs from Firestore.")

    target_jobs = all_jobs
    if company_filter:
        target_jobs = [j for j in all_jobs if company_filter.lower() in j.company.lower()]
        logger.info(f"Filtered to {len(target_jobs)} jobs for company matching: {company_filter}")

    if limit:
        target_jobs = target_jobs[:limit]

    refreshed_count = 0
    skipped_count = 0

    for job in target_jobs:
        adapter_type = job.sourceRef.adapter
        url = job.sourceRef.originalUrl
        raw_payload = None

        try:
            if adapter_type == "greenhouse":
                raw_payload = await gh_adapter.fetch_job_by_url(
                    url,
                    fallback_slug=job.sourceRef.companySlug,
                    fallback_id=job.sourceRef.sourceJobId,
                )
            elif adapter_type == "ashby":
                raw_payload = await ashby_adapter.fetch_job_by_url(url)
            elif adapter_type == "lever":
                raw_payload = await lever_adapter.fetch_job_by_url(url)
            else:
                logger.debug(f"Skipping manual/unsupported adapter: {adapter_type} for job {job.id}")
                skipped_count += 1
                continue

            if not raw_payload:
                logger.warning(f"Could not re-fetch raw job {job.id} from {url} (job may be closed/expired). Skipping.")
                skipped_count += 1
                continue

            # Re-normalize using our updated structural parser
            canonical = job_normalization_service.normalize(raw_payload)

            if canonical.descriptionBlocks:
                # Update ONLY description, descriptionBlocks, and updatedAt
                doc_ref = db.collection("jobs").document(job.id)
                doc_ref.update({
                    "description": canonical.description,
                    "descriptionBlocks": [b.model_dump() for b in canonical.descriptionBlocks],
                    "updatedAt": datetime.now(UTC).isoformat(),
                })
                refreshed_count += 1
                logger.info(f"Updated job {job.id} ({job.title} at {job.company}) with {len(canonical.descriptionBlocks)} blocks.")
            else:
                skipped_count += 1

        except Exception as e:
            logger.error(f"Error refreshing job {job.id} ({job.title}): {e}")
            skipped_count += 1

    logger.info(f"Migration completed. Successfully refreshed: {refreshed_count}, Skipped/Unchanged: {skipped_count}")


def assert_canonical_alliances_field_engineer():
    """Run strict structural assertions on Canonical Alliances Field Engineer job."""
    job = job_repo.get_by_id("job-0f98e66908")
    assert job is not None, "Canonical Alliances Field Engineer job-0f98e66908 not found!"

    blocks = job.descriptionBlocks
    assert blocks, "job-0f98e66908 has no descriptionBlocks!"

    headings = [b for b in blocks if b.type == "heading"]
    heading_texts = [h.text for h in headings]
    logger.info(f"Asserting headings on job-0f98e66908: {heading_texts}")

    # 1. Exact headings
    assert "What your day will look like" in heading_texts, "Missing heading: What your day will look like"
    assert "What we are looking for in you" in heading_texts, "Missing heading: What we are looking for in you"
    assert "What we offer you" in heading_texts, "Missing heading: What we offer you"
    assert "About Canonical" in heading_texts, "Missing heading: About Canonical"

    # 2. Section order
    day_idx = heading_texts.index("What your day will look like")
    look_idx = heading_texts.index("What we are looking for in you")
    offer_idx = heading_texts.index("What we offer you")
    about_idx = heading_texts.index("About Canonical")
    assert day_idx < look_idx < offer_idx < about_idx, f"Section order invalid: {day_idx} < {look_idx} < {offer_idx} < {about_idx}"

    # 3. Bullet lists and counts
    bullet_lists = [b for b in blocks if b.type == "bullet_list"]
    assert len(bullet_lists) >= 3, f"Expected at least 3 bullet lists, got {len(bullet_lists)}"

    # Day list: 6 bullets
    day_list = bullet_lists[0]
    assert len(day_list.items) == 6, f"Expected 6 bullets for day, got {len(day_list.items)}"
    assert day_list.items[0].startswith("Understand Ubuntu, Linux")

    # Looking for in you: 10 bullets
    look_list = bullet_lists[1]
    assert len(look_list.items) == 10, f"Expected 10 bullets for looking for in you, got {len(look_list.items)}"
    assert look_list.items[0].startswith("Extensive experience with Linux")

    # What we offer you: 9 bullets
    offer_list = bullet_lists[2]
    assert len(offer_list.items) == 9, f"Expected 9 bullets for what we offer you, got {len(offer_list.items)}"
    assert offer_list.items[0].startswith("Distributed work environment")

    # 4. Paragraph under What we offer you must be intact
    offer_block_idx = next(i for i, b in enumerate(blocks) if b.type == "heading" and b.text == "What we offer you")
    comp_para = blocks[offer_block_idx + 1]
    assert comp_para.type == "paragraph", f"Expected paragraph after What we offer you, got {comp_para.type}"
    assert comp_para.text.startswith("We consider geographical location"), f"Compensation paragraph text mismatch: {comp_para.text[:50]}"
    assert "in you" not in comp_para.text[:10], f"Stray in you found in paragraph: {comp_para.text[:20]}"

    logger.info("ALL STRUCTURAL ASSERTIONS PASSED FOR CANONICAL ALLIANCES FIELD ENGINEER!")


if __name__ == "__main__":
    comp_arg = sys.argv[1] if len(sys.argv) > 1 else None
    asyncio.run(refresh_active_jobs(company_filter=comp_arg))
    if not comp_arg or "canonical" in comp_arg.lower():
        assert_canonical_alliances_field_engineer()
