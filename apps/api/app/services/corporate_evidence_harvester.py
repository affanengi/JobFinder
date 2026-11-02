"""Corporate Evidence Harvester for Official Domain Resolution & Public Corporate Page Extraction.

Strict Compliance:
- CostPolicy.FREE_ONLY ($0 Spend).
- Exactly at most 2 corporate pages read per company.
- Bounded text payload (~4,800 characters / ~1,200 tokens per company).
- Reject ATS / job-board hosts as canonical company domains.
- Never invent corporate history, products, or descriptions.
"""

import asyncio
import logging
import re
from dataclasses import dataclass, field
from urllib.parse import urlparse

from app.services.agent_reach_service import agent_reach_service

logger = logging.getLogger("jobFinder.services.corporate_evidence_harvester")

MAX_CORPORATE_PAGES_PER_COMPANY = 2
MAX_EVIDENCE_CHARS_PER_COMPANY = 4800

KNOWN_ATS_DOMAINS = {
    "greenhouse.io",
    "boards.greenhouse.io",
    "lever.co",
    "jobs.lever.co",
    "workday.com",
    "myworkdayjobs.com",
    "ashbyhq.com",
    "jobs.ashbyhq.com",
    "smartrecruiters.com",
    "bamboohr.com",
    "jobvite.com",
    "icims.com",
    "taleo.net",
    "recruitee.com",
    "breezy.hr",
    "workable.com",
    "rippling-ats.com",
    "applytojob.com",
}

CANONICAL_COMPANY_DOMAIN_MAP: dict[str, str] = {
    "canonical": "canonical.com",
    "cloudflare": "cloudflare.com",
    "stripe": "stripe.com",
    "openai": "openai.com",
    "databricks": "databricks.com",
    "figma": "figma.com",
    "mongodb": "mongodb.com",
    "gitlab": "gitlab.com",
    "scale ai": "scale.com",
    "scaleai": "scale.com",
    "notion": "notion.so",
    "linear": "linear.app",
    "sentry": "sentry.io",
    "supabase": "supabase.com",
    "ramp": "ramp.com",
    "elastic": "elastic.co",
    "thoughtworks": "thoughtworks.com",
    "palantir": "palantir.com",
    "meesho": "meesho.io",
    "cred": "cred.club",
    "spotify": "spotify.com",
}


@dataclass
class CorporateHarvestResult:
    """Structured evidence harvested from public corporate domains."""

    company_key: str
    company_name: str
    official_domain: str
    source_urls: list[str] = field(default_factory=list)
    evidence_text: str = ""
    pages_read_count: int = 0
    retrieval_ok: bool = False
    error: str | None = None


def is_ats_domain(domain: str | None) -> bool:
    """Check if a domain belongs to a third-party ATS, job-board, or applicant portal."""
    if not domain:
        return False
    d = domain.lower().strip()
    if d in KNOWN_ATS_DOMAINS:
        return True
    for ats in KNOWN_ATS_DOMAINS:
        if d.endswith("." + ats):
            return True
    return False


def resolve_canonical_domain(
    company_name: str,
    given_domain: str | None = None,
    job_url: str | None = None,
) -> str:
    """Resolve and validate the canonical corporate domain, strictly rejecting ATS hosts."""
    clean_name = (company_name or "").strip()
    slug = re.sub(r"[^a-z0-9]+", "", clean_name.lower())
    lower_name = clean_name.lower()

    # 1. Check curated canonical mapping
    if lower_name in CANONICAL_COMPANY_DOMAIN_MAP:
        return CANONICAL_COMPANY_DOMAIN_MAP[lower_name]
    if slug in CANONICAL_COMPANY_DOMAIN_MAP:
        return CANONICAL_COMPANY_DOMAIN_MAP[slug]

    # 2. Check provided domain if not an ATS host
    if given_domain:
        clean_domain = given_domain.lower().strip()
        if clean_domain.startswith("http://") or clean_domain.startswith("https://"):
            try:
                parsed = urlparse(clean_domain)
                clean_domain = parsed.netloc or clean_domain
            except Exception:
                pass
        if clean_domain.startswith("www."):
            clean_domain = clean_domain[4:]

        if clean_domain and not is_ats_domain(clean_domain):
            return clean_domain

    # 3. Check job_url domain if not an ATS host
    if job_url:
        try:
            parsed = urlparse(job_url)
            netloc = parsed.netloc.lower()
            if netloc.startswith("www."):
                netloc = netloc[4:]
            if netloc and not is_ats_domain(netloc):
                return netloc
        except Exception:
            pass

    # 4. Standard default fallback: slug.com
    fallback = f"{slug}.com" if slug else "company.com"
    return fallback


class CorporateEvidenceHarvester:
    """Fetches and extracts clean, bounded corporate evidence from public official domains."""

    def __init__(self, service=None):
        self.agent_reach = service or agent_reach_service

    async def harvest_company_evidence(
        self,
        company_key: str,
        company_name: str,
        given_domain: str | None = None,
        job_url: str | None = None,
    ) -> CorporateHarvestResult:
        """Harvest public corporate evidence for a single company bounded to max 2 pages."""
        canonical_domain = resolve_canonical_domain(
            company_name=company_name,
            given_domain=given_domain,
            job_url=job_url,
        )

        # Plan target URLs: Max 2 pages (Homepage + About)
        page1_url = f"https://{canonical_domain}"
        page2_url = f"https://{canonical_domain}/about"

        # If job_url is authentic and directly on the corporate domain, use it as page 2
        if job_url and not is_ats_domain(job_url):
            try:
                parsed = urlparse(job_url)
                if canonical_domain in parsed.netloc.lower():
                    page2_url = job_url
            except Exception:
                pass

        target_urls = [page1_url, page2_url]
        source_urls: list[str] = []
        combined_text_chunks: list[str] = []
        pages_read = 0

        async def fetch_one(u: str):
            try:
                retrieval = await self.agent_reach.fetch_page_content(u, timeout=4.0)
                if retrieval.ok and retrieval.text:
                    clean_chunk = re.sub(r"\n{3,}", "\n\n", retrieval.text.strip())
                    return (u, clean_chunk)
            except Exception as e:
                logger.debug(f"Failed to fetch corporate page {u} for {company_name}: {e}")
            return None

        # Fetch candidate pages concurrently within bounded time
        fetch_results = await asyncio.gather(*(fetch_one(u) for u in target_urls), return_exceptions=True)

        for item in fetch_results:
            if isinstance(item, tuple) and item[0] and item[1]:
                pages_read += 1
                source_urls.append(item[0])
                combined_text_chunks.append(f"Source: {item[0]}\n{item[1]}")
                if pages_read >= MAX_CORPORATE_PAGES_PER_COMPANY:
                    break

        if combined_text_chunks:
            full_evidence = "\n\n---\n\n".join(combined_text_chunks)
            # Bound evidence length strictly to MAX_EVIDENCE_CHARS_PER_COMPANY
            bounded_evidence = full_evidence[:MAX_EVIDENCE_CHARS_PER_COMPANY].strip()
            return CorporateHarvestResult(
                company_key=company_key,
                company_name=company_name,
                official_domain=canonical_domain,
                source_urls=source_urls,
                evidence_text=bounded_evidence,
                pages_read_count=pages_read,
                retrieval_ok=True,
            )

        return CorporateHarvestResult(
            company_key=company_key,
            company_name=company_name,
            official_domain=canonical_domain,
            source_urls=[page1_url],
            evidence_text="",
            pages_read_count=0,
            retrieval_ok=False,
            error=f"Corporate web pages for {canonical_domain} could not be retrieved. Target server unreachable or protected by bot verification.",
        )

    async def harvest_batch_evidence(
        self,
        companies: list[dict[str, str | None]],
        concurrency: int = 3,
    ) -> list[CorporateHarvestResult]:
        """Harvest evidence for up to 5 companies concurrently with bounded semaphore."""
        sem = asyncio.Semaphore(concurrency)

        async def _bounded_harvest(item: dict[str, str | None]) -> CorporateHarvestResult:
            async with sem:
                return await self.harvest_company_evidence(
                    company_key=str(item.get("company_key") or ""),
                    company_name=str(item.get("company_name") or ""),
                    given_domain=item.get("domain"),
                    job_url=item.get("job_url"),
                )

        tasks = [_bounded_harvest(c) for c in companies]
        results = await asyncio.gather(*tasks, return_exceptions=True)

        harvested: list[CorporateHarvestResult] = []
        for i, res in enumerate(results):
            if isinstance(res, Exception):
                comp = companies[i]
                key = str(comp.get("company_key") or "")
                name = str(comp.get("company_name") or "")
                harvested.append(
                    CorporateHarvestResult(
                        company_key=key,
                        company_name=name,
                        official_domain=resolve_canonical_domain(name, comp.get("domain")),
                        source_urls=[],
                        evidence_text="",
                        pages_read_count=0,
                        retrieval_ok=False,
                        error=f"Harvesting error: {res}",
                    )
                )
            else:
                harvested.append(res)

        return harvested


corporate_evidence_harvester = CorporateEvidenceHarvester()
