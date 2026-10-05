"""Ashby Public ATS Board Adapter (100% Free & Legal Public JSON API)."""

import logging
import re

import httpx

from app.sources.base import JobSourceAdapter, RawJobPayload

logger = logging.getLogger("jobFinder.sources.ashby")


class AshbyAdapter(JobSourceAdapter):
    """Adapter for Ashby's public read-only Job Board API."""

    BASE_URL = "https://api.ashbyhq.com/posting-api/job-board"

    def __init__(self, client: httpx.AsyncClient | None = None):
        self._client = client

    async def _get_client(self) -> httpx.AsyncClient:
        if self._client is None:
            self._client = httpx.AsyncClient(timeout=15.0, headers={"User-Agent": "JobFinder/1.0"})
        return self._client

    def extract_slug_and_id_from_url(self, url: str) -> tuple[str | None, str | None]:
        """Extract company slug and job ID from an Ashby URL."""
        pattern = r"jobs\.ashbyhq\.com/([^/?#]+)(?:/([a-zA-Z0-9-]+))?"
        match = re.search(pattern, url)
        if match:
            slug = match.group(1)
            job_id = match.group(2)
            return slug, job_id
        return None, None

    async def fetch_job_by_url(self, url: str) -> RawJobPayload | None:
        """Fetch single Ashby job posting."""
        slug, job_id = self.extract_slug_and_id_from_url(url)
        if not slug or not job_id:
            logger.warning(f"Could not parse Ashby slug or job_id from {url}")
            return None

        board_jobs = await self.fetch_company_board(slug, limit=200)
        for job in board_jobs:
            if job.sourceId == job_id or (job_id and job_id in job.url):
                return job

        return None

    async def fetch_company_board(
        self,
        company_slug: str,
        limit: int = 50,
    ) -> list[RawJobPayload]:
        """Fetch active job postings from Ashby public API."""
        client = await self._get_client()
        api_url = f"{self.BASE_URL}/{company_slug}"
        results: list[RawJobPayload] = []

        try:
            res = await client.get(api_url)
            if res.status_code != 200:
                res = await client.post(api_url, json={})
                if res.status_code != 200:
                    logger.warning(
                        f"Failed to fetch Ashby board for {company_slug}: {res.status_code}"
                    )
                    return []

            data = res.json()
            job_postings = data.get("jobs", []) or data.get("jobPostings", [])
            job_postings = job_postings[:limit]

            for job in job_postings:
                job_id = job.get("id")
                comp_tier = job.get("compensationTier") or job.get("compensation")
                raw_comp = None
                if isinstance(comp_tier, dict):
                    raw_comp = f"{comp_tier.get('min', '')} - {comp_tier.get('max', '')} {comp_tier.get('currency', 'USD')}"
                elif isinstance(comp_tier, str):
                    raw_comp = comp_tier

                location_val = job.get("location") or job.get("locationName") or ""
                if not location_val and job.get("secondaryLocations"):
                    location_val = job.get("secondaryLocations")[0]

                is_remote = (
                    job.get("isRemote") is True
                    or "remote" in location_val.lower()
                    or job.get("workplaceType") == "Remote"
                )

                posted_at = job.get("publishedAt") or job.get("openedAt") or job.get("createdAt")

                payload = RawJobPayload(
                    sourceType="ashby",
                    sourceId=job_id,
                    companyName=company_slug.replace("-", " ").title(),
                    companySlug=company_slug,
                    url=job.get("jobUrl")
                    or job.get("applyUrl")
                    or f"https://jobs.ashbyhq.com/{company_slug}/{job_id}",
                    rawTitle=job.get("title", "Untitled Role"),
                    rawLocation=location_val or ("Remote" if is_remote else "Global"),
                    rawDepartment=job.get("department")
                    or job.get("departmentName")
                    or job.get("team"),
                    rawDescription=job.get("descriptionHtml") or job.get("descriptionPlain") or "",
                    rawCompensation=raw_comp,
                    rawCommitment=job.get("employmentType"),
                    rawPostedAt=posted_at,
                    metadata={"isRemote": is_remote},
                )
                results.append(payload)

            logger.info(f"Fetched {len(results)} jobs from Ashby board: {company_slug}")
            return results
        except Exception as e:
            logger.error(f"Error querying Ashby board {company_slug}: {e}")
            return []
