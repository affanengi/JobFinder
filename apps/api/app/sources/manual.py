"""Manual URL and Raw Text Ingestion Adapters."""

import html
import logging
import re

import httpx
from pydantic import BaseModel, Field

from app.ai.gemini import GeminiProvider
from app.ai.provider import AIProvider
from app.sources.ashby import AshbyAdapter
from app.sources.base import JobSourceAdapter, RawJobPayload
from app.sources.greenhouse import GreenhouseAdapter
from app.sources.lever import LeverAdapter

logger = logging.getLogger("jobFinder.sources.manual")


class ExtractedWebJob(BaseModel):
    title: str
    company: str
    location: str = "Remote"
    description: str
    compensation: str | None = None
    employmentType: str | None = "full_time"
    workMode: str | None = "remote"
    requiredSkills: list[str] = Field(default_factory=list)


class ManualSourceManager(JobSourceAdapter):
    """Router that dispatches ATS URLs to deterministic adapters, or uses AI interpretation for generic pages."""

    def __init__(self, ai_provider: AIProvider | None = None):
        self.greenhouse = GreenhouseAdapter()
        self.lever = LeverAdapter()
        self.ashby = AshbyAdapter()
        self.ai_provider = ai_provider or GeminiProvider()
        self._client: httpx.AsyncClient | None = None

    async def _get_client(self) -> httpx.AsyncClient:
        if self._client is None:
            self._client = httpx.AsyncClient(timeout=15.0, headers={"User-Agent": "JobFinder/1.0"})
        return self._client

    async def fetch_job_by_url(self, url: str) -> RawJobPayload | None:
        """Fetch job posting, preferring deterministic ATS APIs when matching URL."""
        # 1. Greenhouse URL check
        if "greenhouse.io" in url:
            gh_res = await self.greenhouse.fetch_job_by_url(url)
            if gh_res:
                return gh_res

        # 2. Lever URL check
        if "lever.co" in url:
            lev_res = await self.lever.fetch_job_by_url(url)
            if lev_res:
                return lev_res

        # 3. Ashby URL check
        if "ashbyhq.com" in url:
            ashby_res = await self.ashby.fetch_job_by_url(url)
            if ashby_res:
                return ashby_res

        # 4. Generic Web Page (read-only HTTP GET + Gemini structured interpretation)
        try:
            client = await self._get_client()
            res = await client.get(url)
            res.raise_for_status()
            html_text = res.text

            # Strip script and style tags
            clean_text = re.sub(
                r"<(script|style).*?</\1>", "", html_text, flags=re.DOTALL | re.IGNORECASE
            )
            # Strip remaining tags for LLM prompt efficiency
            text_snippet = re.sub(r"<[^>]+>", " ", clean_text)
            text_snippet = html.unescape(re.sub(r"\s+", " ", text_snippet)).strip()[:8000]

            prompt = f"""
Extract the job posting details from the following web page content into structured JSON.
Do not invent facts.

Web Page Text:
\"\"\"
{text_snippet}
\"\"\"
"""
            extracted: ExtractedWebJob = await self.ai_provider.generate_structured(
                prompt=prompt,
                schema=ExtractedWebJob,
                system_instruction="Extract clean job posting data from web pages.",
                temperature=0.0,
            )

            return RawJobPayload(
                sourceType="manual_url",
                companyName=extracted.company or "Direct Employer",
                url=url,
                rawTitle=extracted.title or "Job Opportunity",
                rawLocation=extracted.location,
                rawDescription=extracted.description or text_snippet[:2000],
                rawCompensation=extracted.compensation,
                rawCommitment=extracted.employmentType,
                metadata={"extracted_skills": extracted.requiredSkills},
            )
        except Exception as e:
            logger.error(f"Failed generic web fetch for {url}: {e}")
            return None

    async def fetch_company_board(self, company_slug: str, limit: int = 50) -> list[RawJobPayload]:
        # Manual adapter does not serve boards
        return []

    async def ingest_raw_text(
        self,
        title: str,
        company: str,
        raw_text: str,
        url: str | None = None,
    ) -> RawJobPayload:
        """Parse raw job description text with Gemini interpretation."""
        return RawJobPayload(
            sourceType="manual_text",
            companyName=company,
            url=url or "manual://pasted_text",
            rawTitle=title,
            rawDescription=raw_text,
        )
