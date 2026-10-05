"""Lever Public ATS Board Adapter (100% Free & Legal Public JSON API)."""

import logging
import re
from datetime import UTC, datetime

import httpx

from app.sources.base import JobSourceAdapter, RawJobPayload

logger = logging.getLogger("jobFinder.sources.lever")


class LeverAdapter(JobSourceAdapter):
    """Adapter for Lever's public read-only Job Postings API."""

    BASE_URL = "https://api.lever.co/v0/postings"

    def __init__(self, client: httpx.AsyncClient | None = None):
        self._client = client

    async def _get_client(self) -> httpx.AsyncClient:
        if self._client is None:
            self._client = httpx.AsyncClient(timeout=15.0, headers={"User-Agent": "JobFinder/1.0"})
        return self._client

    def extract_slug_and_id_from_url(self, url: str) -> tuple[str | None, str | None]:
        """Extract company slug and posting ID from a Lever URL."""
        pattern = r"jobs\.lever\.co/([^/?#]+)(?:/([a-zA-Z0-9-]+))?"
        match = re.search(pattern, url)
        if match:
            slug = match.group(1)
            job_id = match.group(2)
            return slug, job_id
        return None, None

    async def fetch_job_by_url(self, url: str) -> RawJobPayload | None:
        """Fetch single Lever job posting."""
        slug, job_id = self.extract_slug_and_id_from_url(url)
        if not slug or not job_id:
            logger.warning(f"Could not parse Lever slug or job_id from {url}")
            return None

        client = await self._get_client()
        api_url = f"{self.BASE_URL}/{slug}/{job_id}"
        try:
            res = await client.get(api_url)
            if res.status_code == 404:
                return None
            res.raise_for_status()
            data = res.json()

            categories = data.get("categories", {})
            location = (
                categories.get("location") or categories.get("allLocations", [""])[0]
                if categories.get("allLocations")
                else ""
            )
            department = categories.get("department") or categories.get("team")
            commitment = categories.get("commitment")

            description_plain = data.get("descriptionPlain", "")
            lists = data.get("lists", [])
            full_description = description_plain
            for lst in lists:
                full_description += f"\n\n{lst.get('text', '')}:\n{lst.get('content', '')}"

            posted_at_iso = None
            created_ms = data.get("createdAt")
            if created_ms:
                try:
                    posted_at_iso = datetime.fromtimestamp(created_ms / 1000, tz=UTC).isoformat()
                except Exception:
                    pass

            return RawJobPayload(
                sourceType="lever",
                sourceId=data.get("id", job_id),
                companyName=slug.replace("-", " ").title(),
                companySlug=slug,
                url=data.get("hostedUrl", url),
                rawTitle=data.get("text", "Untitled Role"),
                rawLocation=location,
                rawDepartment=department,
                rawDescription=full_description or data.get("description", ""),
                rawCommitment=commitment,
                rawPostedAt=posted_at_iso,
                metadata={
                    "createdAt": created_ms,
                    "lists": lists,
                    "descriptionPlain": description_plain,
                    "additionalPlain": data.get("additionalPlain", ""),
                    "additionalHtml": data.get("additional", ""),
                },
            )
        except Exception as e:
            logger.error(f"Error fetching Lever job {url}: {e}")
            return None

    async def fetch_company_board(
        self,
        company_slug: str,
        limit: int = 50,
    ) -> list[RawJobPayload]:
        """Fetch active job postings from Lever public API."""
        client = await self._get_client()
        api_url = f"{self.BASE_URL}/{company_slug}"
        results: list[RawJobPayload] = []

        try:
            res = await client.get(api_url, params={"mode": "json"})
            if res.status_code != 200:
                logger.warning(f"Failed to fetch Lever board for {company_slug}: {res.status_code}")
                return []

            postings = res.json()[:limit]
            for data in postings:
                categories = data.get("categories", {})
                location = categories.get("location") or (
                    categories.get("allLocations", [""])[0]
                    if categories.get("allLocations")
                    else ""
                )
                department = categories.get("department") or categories.get("team")
                commitment = categories.get("commitment")

                description_plain = data.get("descriptionPlain", "")
                lists = data.get("lists", [])
                full_description = description_plain
                for lst in lists:
                    full_description += f"\n\n{lst.get('text', '')}:\n{lst.get('content', '')}"

                posted_at_iso = None
                created_ms = data.get("createdAt")
                if created_ms:
                    try:
                        posted_at_iso = datetime.fromtimestamp(
                            created_ms / 1000, tz=UTC
                        ).isoformat()
                    except Exception:
                        pass

                payload = RawJobPayload(
                    sourceType="lever",
                    sourceId=data.get("id"),
                    companyName=company_slug.replace("-", " ").title(),
                    companySlug=company_slug,
                    url=data.get(
                        "hostedUrl", f"https://jobs.lever.co/{company_slug}/{data.get('id')}"
                    ),
                    rawTitle=data.get("text", "Untitled Role"),
                    rawLocation=location,
                    rawDepartment=department,
                    rawDescription=full_description or data.get("description", ""),
                    rawCommitment=commitment,
                    rawPostedAt=posted_at_iso,
                    metadata={
                        "createdAt": created_ms,
                        "lists": lists,
                        "descriptionPlain": description_plain,
                        "additionalPlain": data.get("additionalPlain", ""),
                        "additionalHtml": data.get("additional", ""),
                    },
                )
                results.append(payload)

            logger.info(f"Fetched {len(results)} jobs from Lever board: {company_slug}")
            return results
        except Exception as e:
            logger.error(f"Error querying Lever board {company_slug}: {e}")
            return []
