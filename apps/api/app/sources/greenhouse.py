"""Greenhouse Public ATS Board Adapter (100% Free & Legal Public JSON API)."""

import html
import logging
import re

import httpx

from app.sources.base import JobSourceAdapter, RawJobPayload

logger = logging.getLogger("jobFinder.sources.greenhouse")


class GreenhouseAdapter(JobSourceAdapter):
    """Adapter for Greenhouse's public read-only Job Board API."""

    BASE_URL = "https://boards-api.greenhouse.io/v1/boards"

    def __init__(self, client: httpx.AsyncClient | None = None):
        self._client = client

    async def _get_client(self) -> httpx.AsyncClient:
        if self._client is None:
            self._client = httpx.AsyncClient(timeout=15.0, headers={"User-Agent": "JobFinder/1.0"})
        return self._client

    def extract_slug_and_id_from_url(
        self,
        url: str,
        fallback_slug: str | None = None,
        fallback_id: str | None = None,
    ) -> tuple[str | None, str | None]:
        """Extract company slug and job ID from a Greenhouse URL (including custom domains with gh_jid)."""
        from urllib.parse import parse_qs, urlparse

        slug, job_id = None, None
        parsed = urlparse(url)
        query_params = parse_qs(parsed.query)

        # 1. Check gh_jid or token query params
        if 'gh_jid' in query_params:
            job_id = query_params['gh_jid'][0]
        elif 'token' in query_params:
            job_id = query_params['token'][0]

        # 2. Check for query param ?for=slug
        if 'for' in query_params:
            slug = query_params['for'][0]

        # 3. Check standard greenhouse.io pattern
        pattern = r"greenhouse\.io/(?:v1/boards/)?(?:embed/job_app\?for=)?([^/?#]+)(?:/jobs/(\d+))?"
        match = re.search(pattern, url)
        if match:
            matched_slug = match.group(1)
            if matched_slug not in ['embed', 'v1', 'boards'] and not slug:
                slug = matched_slug
            if not job_id and match.group(2):
                job_id = match.group(2)

        # 4. Check domain name if slug still missing (e.g. databricks.com -> databricks)
        if not slug and parsed.netloc:
            parts = parsed.netloc.split('.')
            if parts[0] == 'www' and len(parts) > 2:
                slug = parts[1]
            elif len(parts) >= 2 and parts[0] not in ['boards', 'api']:
                slug = parts[0]

        slug = slug or fallback_slug
        job_id = job_id or fallback_id
        return slug, job_id

    async def fetch_job_by_url(
        self,
        url: str,
        fallback_slug: str | None = None,
        fallback_id: str | None = None,
    ) -> RawJobPayload | None:
        """Fetch full job details from Greenhouse public API."""
        slug, job_id = self.extract_slug_and_id_from_url(
            url,
            fallback_slug=fallback_slug,
            fallback_id=fallback_id,
        )
        if not slug or not job_id:
            logger.warning(f"Could not parse Greenhouse slug or job_id from {url}")
            return None

        client = await self._get_client()
        api_url = f"{self.BASE_URL}/{slug}/jobs/{job_id}"
        try:
            res = await client.get(api_url, params={"content": "true"})
            if res.status_code == 404:
                logger.info(f"Greenhouse job {job_id} not found on board {slug}")
                return None
            res.raise_for_status()
            data = res.json()

            raw_content = data.get("content", "")
            clean_content = html.unescape(raw_content)

            return RawJobPayload(
                sourceType="greenhouse",
                sourceId=str(data.get("id", job_id)),
                companyName=slug.replace("-", " ").title(),
                companySlug=slug,
                url=data.get("absolute_url", url),
                rawTitle=data.get("title", "Untitled Role"),
                rawLocation=data.get("location", {}).get("name")
                if isinstance(data.get("location"), dict)
                else str(data.get("location") or ""),
                rawDepartment=data.get("departments", [{}])[0].get("name")
                if data.get("departments")
                else None,
                rawDescription=clean_content,
                rawPostedAt=data.get("updated_at"),
                metadata={"updated_at": data.get("updated_at")},
            )
        except Exception as e:
            logger.error(f"Error fetching Greenhouse job {url}: {e}")
            return None

    async def fetch_company_board(
        self,
        company_slug: str,
        limit: int = 50,
    ) -> list[RawJobPayload]:
        """Fetch active job postings for a company board."""
        client = await self._get_client()
        api_url = f"{self.BASE_URL}/{company_slug}/jobs"
        results: list[RawJobPayload] = []

        try:
            res = await client.get(api_url, params={"content": "true"})
            if res.status_code != 200:
                logger.warning(
                    f"Failed to fetch Greenhouse board for {company_slug}: {res.status_code}"
                )
                return []

            data = res.json()
            jobs = data.get("jobs", [])[:limit]

            for job in jobs:
                job_id = str(job.get("id"))
                raw_content = html.unescape(job.get("content", ""))
                payload = RawJobPayload(
                    sourceType="greenhouse",
                    sourceId=job_id,
                    companyName=company_slug.replace("-", " ").title(),
                    companySlug=company_slug,
                    url=job.get(
                        "absolute_url", f"https://boards.greenhouse.io/{company_slug}/jobs/{job_id}"
                    ),
                    rawTitle=job.get("title", "Untitled Role"),
                    rawLocation=job.get("location", {}).get("name")
                    if isinstance(job.get("location"), dict)
                    else str(job.get("location") or ""),
                    rawDepartment=job.get("departments", [{}])[0].get("name")
                    if job.get("departments")
                    else None,
                    rawDescription=raw_content,
                    rawPostedAt=job.get("updated_at"),
                    metadata={"updated_at": job.get("updated_at")},
                )
                results.append(payload)

            logger.info(f"Fetched {len(results)} jobs from Greenhouse board: {company_slug}")
            return results
        except Exception as e:
            logger.error(f"Error querying Greenhouse board {company_slug}: {e}")
            return []
