"""Hard Exclusion Filters to strictly enforce India Tech Hubs and Global Remote criteria."""

import logging
import re

from app.schemas.job import CanonicalJob
from app.schemas.profile import Profile

logger = logging.getLogger("jobFinder.matching.filters")

# Strict Overseas Country/City names (when not combined with India or Worldwide)
FOREIGN_ONLY_PATTERNS = [
    r"\b(berlin|germany|paris|france|dublin|ireland|amsterdam|netherlands|london|uk|united kingdom)\b",
    r"\b(tokyo|japan|singapore|sydney|australia|melbourne|auckland|new zealand)\b",
    r"\b(toronto|canada|vancouver|montreal|são paulo|brazil|mexico|colombia|chile)\b",
    r"\b(san francisco|sf|bay area|new york|nyc|seattle|austin|chicago|boston|los angeles|california|ca|washington|wa|texas|tx|ny|usa?|united states)\b",
]

# Allowed Location Keywords (India tech hubs + Global Remote)
ALLOWED_INDIA_KEYWORDS = [
    "india",
    "hyderabad",
    "bangalore",
    "bengaluru",
    "mumbai",
    "pune",
    "delhi",
    "ncr",
    "gurgaon",
    "gurugram",
    "noida",
    "chennai",
    "kolkata",
]

ALLOWED_GLOBAL_REMOTE_KEYWORDS = [
    "worldwide",
    "global",
    "anywhere",
    "remote, global",
    "remote - global",
    "work from anywhere",
    "all locations",
    "home based - worldwide",
]

EXCLUDED_DISQUALIFIED_ROLES = [
    "customer service",
    "call center",
    "telecaller",
    "telemarketing",
    "nurse",
    "medical officer",
    "driver",
    "warehouse associate",
    "cook",
]


class HardFilterService:
    """Evaluates whether a CanonicalJob passes location (India/Remote) and language criteria."""

    def is_english_title(self, title: str) -> bool:
        """Reject non-Latin/non-English job titles."""
        non_ascii_chars = re.findall(r"[^\x00-\x7F\u0080-\u024F]", title)
        return len(non_ascii_chars) <= 2

    def is_allowed_location(self, job: CanonicalJob) -> bool:
        """Enforce: Remote (Worldwide / India) OR physically located in India (Hyderabad, Bangalore, Mumbai, etc.)."""
        loc_str = f"{job.location} {job.title}".lower()

        # 1. Check if located in India (physical or remote India)
        for kw in ALLOWED_INDIA_KEYWORDS:
            if kw in loc_str:
                return True

        # 2. Check if explicitly Global / Worldwide Remote
        for kw in ALLOWED_GLOBAL_REMOTE_KEYWORDS:
            if kw in loc_str:
                return True

        # 3. If workMode is remote AND location is simply "Remote" or "Flexible" without a foreign lock
        if job.workMode == "remote" and (
            "remote" in loc_str or not job.location or job.location == "Remote"
        ):
            # Ensure it's not locked to a foreign city/country
            for pat in FOREIGN_ONLY_PATTERNS:
                if re.search(pat, loc_str):
                    return False
            return True

        # 4. Otherwise, reject
        return False

    def is_acceptable_role(self, job: CanonicalJob) -> bool:
        """Allow Technical, Data, QA, and Business/Non-Tech roles; exclude customer service/manual labor."""
        title_lower = job.title.lower()
        for excluded in EXCLUDED_DISQUALIFIED_ROLES:
            if excluded in title_lower:
                return False
        return True

    def passes_hard_filters(
        self, job: CanonicalJob, profile: Profile | None = None
    ) -> tuple[bool, str]:
        """Check all hard exclusion criteria."""
        # 1. Language Check
        if not self.is_english_title(job.title):
            return False, "Non-English job posting"

        # 2. Disqualified Role Check
        if not self.is_acceptable_role(job):
            return False, "Disqualified role category"

        # 3. Location Check (India or Global Remote only)
        if not self.is_allowed_location(job):
            return False, f"Location '{job.location}' outside India/Global Remote constraints"

        return True, "Passed all hard filters"


hard_filter_service = HardFilterService()
