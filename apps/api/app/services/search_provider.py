"""Search Provider Abstraction adhering strictly to CostPolicy.FREE_ONLY.

Supported Providers:
1. AgentReachSearchProvider: Primary free web search via local agent-reach CLI ($0 cost).
2. ExaSearchProvider: Optional fallback if EXA_API_KEY is configured with available free tier.
3. BraveSearchProvider: Optional fallback if BRAVE_SEARCH_API_KEY is configured with available credits.
4. FallbackQueryLinkProvider: Guaranteed $0 free fallback generating pre-formatted browser search links.
"""

import asyncio
import logging
import re
import urllib.parse
from dataclasses import dataclass, field
from typing import Optional

import httpx

from app.core.config import settings
from app.schemas.opportunity_contact import ContactSearchLink
from app.services.agent_reach_service import AgentReachService, agent_reach_service

logger = logging.getLogger("jobFinder.services.search_provider")

DEFAULT_SEARCH_TIMEOUT = 10.0
PER_QUERY_SEARCH_LIMIT = 5


@dataclass
class RawContactCandidate:
    """Raw contact candidate discovered from search provider or public page."""

    full_name: str
    role_title: str
    company: str
    location: Optional[str] = None
    email: Optional[str] = None
    source_url: str = ""
    snippet: str = ""
    provider: str = "search"
    linkedin_url: Optional[str] = None
    github_url: Optional[str] = None
    portfolio_url: Optional[str] = None
    contact_type: str = "INDIVIDUAL"
    channel_purpose: str = "INDIVIDUAL_REPRESENTATIVE"
    role_evidence_status: str = "LIKELY_CURRENT"


LOCATION_INDICATORS = (
    "area",
    "united states",
    "india",
    "california",
    "texas",
    "washington",
    "new york",
    "england",
    "united kingdom",
    "spain",
    "remote",
    "metroplex",
    "san francisco",
    "bengaluru",
    "bangalore",
    "hyderabad",
    "london",
    "bay area",
    "seattle",
    "ireland",
    "germany",
    "(us)",
    "(in)",
    "(gb)",
    "(uk)",
    "(es)",
    "(de)",
)


def clean_person_name(raw_name: str) -> str:
    """Sanitize and format a person's full name, stripping honorifics, titles, and emojis."""
    if not raw_name:
        return ""
    # Strip professional certifications/honorifics like ", CDSP", ", SPHR", ", SHRM-CP", ", PMP"
    name = re.sub(
        r",\s*(?:CDSP|SPHR|SHRM-CP|PHR|PMP|MBA|MS|PhD|CPA)\b.*$",
        "",
        raw_name,
        flags=re.IGNORECASE,
    )
    # Remove separators and suffixes
    name = re.sub(r"[\|\-–—•].*$", "", name)
    # Remove parentheticals (pronouns, etc.)
    name = re.sub(r"\(.*?\)", "", name)
    # Remove unwanted punctuation
    name = re.sub(r"[^\w\s\.\']", "", name)
    name = re.sub(r"\s+", " ", name).strip()
    return name.title() if name else ""


def is_location_indicator(text: str) -> bool:
    """Determine if a snippet or title fragment describes a geographic location."""
    if not text:
        return False
    t = text.lower()
    return any(ind in t for ind in LOCATION_INDICATORS)


def normalize_profile_url(raw_url: str) -> str:
    """Normalize public profile URL, stripping tracking parameters."""
    if not raw_url:
        return ""
    clean = re.sub(r"\?.*$", "", raw_url.strip())
    return clean


def evaluate_role_currency(title: str, snippet: str, target_company: str) -> str:
    """Evaluate whether candidate's association with target_company appears current or former."""
    text = f"{title}\n{snippet}".strip()
    company_lower = target_company.lower()

    # 1. Check for former/past indicators
    # Examples: "Past: Canonical", "Former Senior Engineering Manager - Canonical", "Ex-Canonical", "Canonical · Mar 2020 - Nov 2024"
    former_patterns = [
        rf"\b(?:past|former|ex)[\s:–—\-]+(?:at\s+)?{re.escape(company_lower)}\b",
        rf"\b(?:former|past)\s+[^\n\r]*?[-–—|]\s*{re.escape(company_lower)}\b",
        rf"\b(?:previously|prior)\s+(?:at\s+)?{re.escape(company_lower)}\b",
        rf"\b(?:past|previous|prior):\s*[^\n\r]*?\b{re.escape(company_lower)}\b",
        rf"\bex-{re.escape(company_lower)}\b",
        rf"{re.escape(company_lower)}[^\n\r]*\b(?:19\d\d|20\d\d)\s*[-–—]\s*(?:[A-Za-z]{3,9}\s+)?(?:19\d\d|20[0-2][0-5])\b",
    ]
    for pattern in former_patterns:
        if re.search(pattern, text, re.IGNORECASE):
            return "FORMER_ROLE"

    # 2. Check for explicit current confirmation
    # Examples: "(Current)", "· Present", "- Present", "Currently at"
    current_patterns = [
        rf"\b{re.escape(company_lower)}[^\n\r]*\((?:current)\)",
        rf"\b{re.escape(company_lower)}[^\n\r]*(?:[-–—·]\s*present|to\s*present)",
        rf"\b(?:currently\s+at|current\s*role\s*at)\s+{re.escape(company_lower)}\b",
        rf"###\s*\[?{re.escape(company_lower)}\]?[^\n\r]*\bpresent\b",
    ]
    for pattern in current_patterns:
        if re.search(pattern, text, re.IGNORECASE):
            return "CURRENT_CONFIRMED"

    # 3. If target company is in title or headline with role and no past indicators
    if re.search(rf"\b{re.escape(company_lower)}\b", title, re.IGNORECASE):
        return "LIKELY_CURRENT"
    if re.search(rf"\b{re.escape(company_lower)}\b", snippet, re.IGNORECASE):
        return "LIKELY_CURRENT"

    return "UNCLEAR_ASSOCIATION"


def extract_candidate_from_snippet(
    title: str,
    snippet: str,
    url: str,
    target_company: str,
    provider: str,
) -> Optional[RawContactCandidate]:
    """Parse candidate name, role, channels, currency, and location from search results and snippets."""
    text = f"{title}\n{snippet}".strip()

    full_name = ""
    role_title = ""
    location = None

    # Check location hint in overall text
    if re.search(r"\b(hyderabad|telangana|cyberabad|hitec city|gachibowli)\b", text, re.IGNORECASE):
        location = "Hyderabad, Telangana, India"
    elif re.search(r"\b(bengaluru|bangalore)\b", text, re.IGNORECASE):
        location = "Bengaluru, India"
    elif re.search(r"\b(san francisco|bay area|silicon valley)\b", text, re.IGNORECASE):
        location = "San Francisco Bay Area, US"
    elif re.search(r"\b(london|greater london|united kingdom)\b", text, re.IGNORECASE):
        location = "London, United Kingdom"
    elif re.search(r"\bindia\b", text, re.IGNORECASE):
        location = "India"

    # Step 1: Check title for "Name - Role at Company | LinkedIn" or "Name | Role"
    parts = re.split(r"\s*[-–—|]\s*", title)
    if len(parts) >= 2:
        cand_name = clean_person_name(parts[0])
        if 2 <= len(cand_name.split()) <= 4 and not any(
            kw in cand_name.lower() for kw in ("jobs", "careers", "recruiter", "hiring", "linkedin")
        ):
            full_name = cand_name
            cand_role = parts[1].strip()
            # Clean trailing company reference
            cand_role = re.sub(
                r"\s+(?:at|@)\s+" + re.escape(target_company) + r".*$",
                "",
                cand_role,
                flags=re.IGNORECASE,
            ).strip()
            if not is_location_indicator(cand_role) and len(cand_role) > 2:
                role_title = cand_role

    # Step 2: If no name yet, check if title itself is a 2-4 word person name
    if not full_name:
        cand_name = clean_person_name(title)
        if 2 <= len(cand_name.split()) <= 4 and not any(
            kw in cand_name.lower()
            for kw in ("jobs", "careers", "recruiter", "hiring", "opportunities", "directory", "linkedin")
        ):
            full_name = cand_name

    # Step 3: If still no name, check top-level markdown heading "# Name" in snippet
    if not full_name:
        h1_match = re.search(r"^#\s+([A-Za-z\.\'\s]{3,40})", snippet, re.MULTILINE)
        if h1_match:
            cand_name = clean_person_name(h1_match.group(1))
            if 2 <= len(cand_name.split()) <= 4 and not any(
                kw in cand_name.lower() for kw in ("jobs", "careers", "recruiter", "hiring", "about")
            ):
                full_name = cand_name

    # If no candidate name was found, this result is not a valid personal profile
    if not full_name:
        return None

    # Step 4: Extract role if not already identified
    if not role_title:
        # Check experience block: "### [Role] - [Company]" or "### [Role] - ... - [Company]"
        exp_match = re.search(
            r"###\s*([^\n\-\[\(]+?)\s*(?:-\s*[^\n\-\[\(]+?)*\s*-\s*\[?" + re.escape(target_company),
            snippet,
            re.IGNORECASE,
        )
        if exp_match:
            role_title = exp_match.group(1).strip()

        # Check company header block: "### [Company]\n+#### [Role]"
        if not role_title:
            company_block = re.search(
                r"###\s*\[?" + re.escape(target_company) + r"\]?[^\n]*\n+####\s*([^\n\(\[]+)",
                snippet,
                re.IGNORECASE,
            )
            if company_block:
                role_title = company_block.group(1).strip()

        # Check headline immediately following "# Name"
        if not role_title:
            headline_match = re.search(
                r"#\s+" + re.escape(full_name) + r"\s*\n+([^\n#]+)",
                snippet,
                re.IGNORECASE,
            )
            if headline_match:
                cand_role = headline_match.group(1).strip()
                if is_location_indicator(cand_role):
                    if not location:
                        location = cand_role
                elif 3 < len(cand_role) < 90 and not any(
                    kw in cand_role.lower() for kw in ("followers", "connections", "mutual")
                ):
                    role_title = cand_role

        # Check common hiring and recruiting role patterns
        if not role_title:
            role_regex = re.search(
                r"\b((?:Senior\s+|Lead\s+|Principal\s+|Staff\s+|Director\s+of\s+|Head\s+of\s+)?"
                r"(?:Technical\s+|Tech\s+|Executive\s+|Engineering\s+|Talent\s+)?"
                r"(?:Recruiter|Recruiting\s+Manager|Talent\s+Partner|Talent\s+Acquisition|"
                r"Hiring\s+Manager|Engineering\s+Manager|Technical\s+Lead|Staff\s+Engineer))\b",
                snippet,
                re.IGNORECASE,
            )
            if role_regex:
                role_title = role_regex.group(1).strip()

    # Clean role title
    if role_title:
        role_title = re.sub(r"\(Current\)", "", role_title, flags=re.IGNORECASE).strip()
        role_title = re.sub(r"\s+", " ", role_title)
    else:
        role_title = "Talent Acquisition / Professional"

    # Multi-channel extraction
    linkedin_url: Optional[str] = None
    if "linkedin.com/in/" in url.lower() or "linkedin.com/pub/" in url.lower():
        linkedin_url = normalize_profile_url(url)
    else:
        li_match = re.search(r"https?://(?:[a-z]{2,3}\.)?linkedin\.com/in/[A-Za-z0-9_-]+", text)
        if li_match:
            linkedin_url = normalize_profile_url(li_match.group(0))

    github_url: Optional[str] = None
    gh_match = re.search(r"https?://(?:www\.)?github\.com/([A-Za-z0-9_-]+)", text)
    if gh_match and gh_match.group(1).lower() not in ("features", "about", "site", "enterprise", "pricing", "login"):
        github_url = gh_match.group(0)

    portfolio_url: Optional[str] = None
    portfolio_match = re.search(r"https?://([a-zA-Z0-9-]+\.(?:io|me|dev|org))(?:\/[^\s\)]*)?", text)
    if portfolio_match and not any(ign in portfolio_match.group(0).lower() for ign in ("github.io", "linkedin.com")):
        portfolio_url = portfolio_match.group(0)

    # Check for email address in snippet or title
    email_match = re.search(r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b", text)
    email = email_match.group(0).lower() if email_match else None

    # Role currency classification
    role_currency = evaluate_role_currency(title=title, snippet=snippet, target_company=target_company)

    return RawContactCandidate(
        full_name=full_name,
        role_title=role_title,
        company=target_company,
        location=location,
        email=email,
        source_url=url,
        snippet=snippet[:400] if snippet else title,
        provider=provider,
        linkedin_url=linkedin_url,
        github_url=github_url,
        portfolio_url=portfolio_url,
        contact_type="INDIVIDUAL",
        channel_purpose="INDIVIDUAL_REPRESENTATIVE",
        role_evidence_status=role_currency,
    )



class AgentReachSearchProvider:
    """Agent Reach search provider executing web searches via local agent-reach CLI ($0 cost)."""

    def __init__(self, service: AgentReachService | None = None):
        self.service = service or agent_reach_service
        self.last_attempted_angles: list[str] = []

    def is_configured(self) -> bool:
        """Verify that agent-reach CLI is accessible in PATH or ~/.local/bin."""
        return self.service.is_search_available()

    async def search_contacts(
        self,
        company_name: str,
        role_keywords: list[str] | None = None,
        limit: int = PER_QUERY_SEARCH_LIMIT,
        query_round: int = 0,
        return_angles: bool = False,
    ) -> list[RawContactCandidate] | tuple[list[RawContactCandidate], list[str]]:
        """Execute bounded queries via Agent Reach CLI ($0 cost) with query angle rotation.

        Rotates across role specialization pools based on query_round to improve diversity.
        """
        if not self.is_configured():
            self.last_attempted_angles = []
            return ([], []) if return_angles else []

        clean_company = (company_name or "").strip()
        if not clean_company:
            self.last_attempted_angles = []
            return ([], []) if return_angles else []

        query_limit = min(limit, PER_QUERY_SEARCH_LIMIT)

        # 4-tier query angle templates
        angle_pool = [
            (
                "Recruiting & Sourcing",
                f'site:linkedin.com/in "{clean_company}" ("talent acquisition" OR "technical recruiter" OR "recruiting manager" OR "sourcer")',
            ),
            (
                "Engineering Leadership",
                f'site:linkedin.com/in "{clean_company}" ("engineering manager" OR "director of engineering" OR "tech lead" OR "head of technology")',
            ),
            (
                "Technical Leads & Architecture",
                f'site:linkedin.com/in "{clean_company}" ("staff engineer" OR "principal engineer" OR "lead architect" OR "senior tech lead")',
            ),
            (
                "Executive Leadership",
                f'site:linkedin.com/in "{clean_company}" ("head of engineering" OR "vp of engineering" OR "vp engineering" OR "cto")',
            ),
        ]

        # Select two angles based on rotation sequence
        idx1 = (query_round * 2) % len(angle_pool)
        idx2 = (query_round * 2 + 1) % len(angle_pool)

        angle1_name, query1 = angle_pool[idx1]
        angle2_name, query2 = angle_pool[idx2]
        attempted_angles = [angle1_name, angle2_name]

        try:
            res1, res2 = await asyncio.gather(
                self.service.search_web(query=query1, limit=query_limit),
                self.service.search_web(query=query2, limit=query_limit),
                return_exceptions=True,
            )

            all_items = []
            failures = []

            for query_name, res in [(angle1_name, res1), (angle2_name, res2)]:
                if isinstance(res, Exception):
                    failures.append(f"{query_name} query error: {res}")
                elif not res.ok:
                    failures.append(f"{query_name} query failed: {res.error}")
                elif res.items:
                    all_items.extend(res.items)

            if failures and not all_items:
                logger.warning(
                    f"Agent Reach queries failed for company '{clean_company}': {'; '.join(failures)}"
                )
                self.last_attempted_angles = attempted_angles
                if return_angles:
                    return [], attempted_angles
                return []

            seen_urls: set[str] = set()
            candidates: list[RawContactCandidate] = []

            for item in all_items:
                norm_url = normalize_profile_url(item.url) or item.url
                if norm_url in seen_urls:
                    continue
                seen_urls.add(norm_url)

                parsed = extract_candidate_from_snippet(
                    title=item.title,
                    snippet=item.snippet,
                    url=item.url,
                    target_company=clean_company,
                    provider="agent_reach",
                )
                if parsed:
                    candidates.append(parsed)

            self.last_attempted_angles = attempted_angles
            if return_angles:
                return candidates, attempted_angles
            return candidates
        except Exception as e:
            logger.warning(f"Agent Reach search error for company '{clean_company}': {e}")
            self.last_attempted_angles = attempted_angles
            if return_angles:
                return [], attempted_angles
            return []


class ExaSearchProvider:
    """Exa Neural Search provider operating strictly under free allowance."""

    def __init__(self, api_key: str | None = None):
        self.api_key = (api_key or settings.EXA_API_KEY or "").strip()
        self.is_exhausted = False

    def is_configured(self) -> bool:
        return bool(self.api_key) and not self.is_exhausted

    async def _execute_single_query(
        self, client: httpx.AsyncClient, query: str, limit: int, company_name: str
    ) -> list[RawContactCandidate]:
        res = await client.post(
            "https://api.exa.ai/search",
            headers={
                "x-api-key": self.api_key,
                "content-type": "application/json",
            },
            json={
                "query": query,
                "numResults": limit,
                "type": "neural",
                "useAutoprompt": True,
            },
        )
        if res.status_code in (401, 402, 429):
            logger.warning(
                f"Exa search quota exhausted or unauthorized (status {res.status_code}). "
                "Marking Exa unavailable."
            )
            self.is_exhausted = True
            return []
        if not res.is_success:
            logger.warning(f"Exa search returned error {res.status_code}: {res.text}")
            return []

        data = res.json()
        results = data.get("results", [])
        candidates: list[RawContactCandidate] = []
        for item in results:
            title = item.get("title", "")
            url = item.get("url", "")
            snippet = item.get("text", "") or item.get("highlight", "")
            parsed = extract_candidate_from_snippet(
                title=title,
                snippet=snippet,
                url=url,
                target_company=company_name,
                provider="exa",
            )
            if parsed:
                candidates.append(parsed)
        return candidates

    async def search_contacts(
        self,
        company_name: str,
        role_keywords: list[str] | None = None,
        limit: int = PER_QUERY_SEARCH_LIMIT,
    ) -> list[RawContactCandidate]:
        """Execute dual bounded search on Exa under free allowance."""
        if not self.is_configured():
            return []

        query_limit = min(limit, PER_QUERY_SEARCH_LIMIT)
        query_recruiting = (
            f'site:linkedin.com/in "{company_name}" '
            '("talent acquisition" OR "technical recruiter" OR "recruiting manager" OR "sourcer")'
        )
        query_engineering = (
            f'site:linkedin.com/in "{company_name}" '
            '("engineering manager" OR "director of engineering" OR "tech lead" OR "head of technology")'
        )

        try:
            async with httpx.AsyncClient(timeout=DEFAULT_SEARCH_TIMEOUT) as client:
                res1, res2 = await asyncio.gather(
                    self._execute_single_query(client, query_recruiting, query_limit, company_name),
                    self._execute_single_query(client, query_engineering, query_limit, company_name),
                    return_exceptions=True,
                )

                seen_urls: set[str] = set()
                combined: list[RawContactCandidate] = []
                for res in [res1, res2]:
                    if isinstance(res, list):
                        for c in res:
                            norm_url = normalize_profile_url(c.source_url) or c.source_url
                            if norm_url not in seen_urls:
                                seen_urls.add(norm_url)
                                combined.append(c)

                return combined
        except Exception as e:
            logger.warning(f"Exa search error: {e}. Gracefully continuing with free fallback.")
            return []


class BraveSearchProvider:
    """Brave Search provider operating strictly under configured user credits/free tier."""

    def __init__(self, api_key: str | None = None):
        self.api_key = (api_key or settings.BRAVE_SEARCH_API_KEY or "").strip()
        self.is_exhausted = False

    def is_configured(self) -> bool:
        return bool(self.api_key) and not self.is_exhausted

    async def _execute_single_query(
        self, client: httpx.AsyncClient, query: str, limit: int, company_name: str
    ) -> list[RawContactCandidate]:
        res = await client.get(
            "https://api.search.brave.com/res/v1/web/search",
            headers={
                "X-Subscription-Token": self.api_key,
                "Accept": "application/json",
            },
            params={
                "q": query,
                "count": limit,
            },
        )
        if res.status_code in (401, 402, 429):
            logger.warning(
                f"Brave search quota exhausted or unauthorized (status {res.status_code}). "
                "Marking Brave unavailable."
            )
            self.is_exhausted = True
            return []
        if not res.is_success:
            logger.warning(f"Brave search returned error {res.status_code}")
            return []

        data = res.json()
        web_results = data.get("web", {}).get("results", [])
        candidates: list[RawContactCandidate] = []
        for item in web_results:
            title = item.get("title", "")
            url = item.get("url", "")
            snippet = item.get("description", "")
            parsed = extract_candidate_from_snippet(
                title=title,
                snippet=snippet,
                url=url,
                target_company=company_name,
                provider="brave",
            )
            if parsed:
                candidates.append(parsed)
        return candidates

    async def search_contacts(
        self,
        company_name: str,
        role_keywords: list[str] | None = None,
        limit: int = PER_QUERY_SEARCH_LIMIT,
    ) -> list[RawContactCandidate]:
        """Execute dual bounded search on Brave API."""
        if not self.is_configured():
            return []

        query_limit = min(limit, PER_QUERY_SEARCH_LIMIT)
        query_recruiting = (
            f'site:linkedin.com/in "{company_name}" '
            '("talent acquisition" OR "technical recruiter" OR "recruiting manager" OR "sourcer")'
        )
        query_engineering = (
            f'site:linkedin.com/in "{company_name}" '
            '("engineering manager" OR "director of engineering" OR "tech lead" OR "head of technology")'
        )

        try:
            async with httpx.AsyncClient(timeout=DEFAULT_SEARCH_TIMEOUT) as client:
                res1, res2 = await asyncio.gather(
                    self._execute_single_query(client, query_recruiting, query_limit, company_name),
                    self._execute_single_query(client, query_engineering, query_limit, company_name),
                    return_exceptions=True,
                )

                seen_urls: set[str] = set()
                combined: list[RawContactCandidate] = []
                for res in [res1, res2]:
                    if isinstance(res, list):
                        for c in res:
                            norm_url = normalize_profile_url(c.source_url) or c.source_url
                            if norm_url not in seen_urls:
                                seen_urls.add(norm_url)
                                combined.append(c)

                return combined
        except Exception as e:
            logger.warning(f"Brave search error: {e}. Gracefully continuing with free fallback.")
            return []



class FallbackQueryLinkProvider:
    """Generates guaranteed free pre-formatted browser search links for candidate exploration."""

    @staticmethod
    def generate_links(company_name: str, location_hint: str = "Hyderabad") -> list[ContactSearchLink]:
        clean_company = company_name.strip()
        encoded_company = urllib.parse.quote(f'"{clean_company}"')
        encoded_location = urllib.parse.quote(location_hint)

        return [
            ContactSearchLink(
                title=f"Recruiters & Talent Acquisition ({clean_company} • {location_hint})",
                query=f'site:linkedin.com/in "{clean_company}" (recruiter OR "talent acquisition") {location_hint}',
                url=f'https://www.google.com/search?q=site:linkedin.com/in+{encoded_company}+(recruiter+OR+"talent+acquisition")+{encoded_location}',
                platform="google",
            ),
            ContactSearchLink(
                title=f"Hiring & Engineering Managers ({clean_company} • {location_hint})",
                query=f'site:linkedin.com/in "{clean_company}" ("engineering manager" OR "hiring manager") {location_hint}',
                url=f'https://www.google.com/search?q=site:linkedin.com/in+{encoded_company}+("engineering+manager"+OR+"hiring+manager")+{encoded_location}',
                platform="google",
            ),
            ContactSearchLink(
                title=f"Technical Leads & Architects ({clean_company})",
                query=f'site:linkedin.com/in "{clean_company}" ("tech lead" OR "technical lead" OR "principal engineer")',
                url=f'https://www.google.com/search?q=site:linkedin.com/in+{encoded_company}+("tech+lead"+OR+"technical+lead"+OR+"principal+engineer")',
                platform="google",
            ),
            ContactSearchLink(
                title=f"LinkedIn People Search ({clean_company} • Recruiters)",
                query=f"{clean_company} recruiter {location_hint}",
                url=f"https://www.linkedin.com/search/results/people/?keywords={urllib.parse.quote(clean_company)}+recruiter+{encoded_location}",
                platform="linkedin",
            ),
            ContactSearchLink(
                title=f"Official Careers & Team Directory ({clean_company})",
                query=f'"{clean_company}" (careers OR team OR leadership)',
                url=f'https://www.google.com/search?q={encoded_company}+(careers+OR+team+OR+leadership)',
                platform="careers",
            ),
        ]
