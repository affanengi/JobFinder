"""Job Ingestion & Normalization Service adhering to SCHEMA.md with relative posting time calculation."""

import hashlib
import html
import logging
import re
import urllib.parse
import uuid
from datetime import UTC, datetime
from typing import Any, Literal

from app.schemas.job import (
    CanonicalJob,
    CompensationRange,
    EmploymentType,
    JobCategory,
    JobDescriptionBlock,
    SeniorityLevel,
    WorkMode,
)
from app.services.job_structure_parser import job_structure_parser
from app.sources.base import RawJobPayload

logger = logging.getLogger("jobFinder.job_normalization")

KNOWN_SKILLS = [
    "Python",
    "JavaScript",
    "TypeScript",
    "React",
    "Node.js",
    "Next.js",
    "Vue.js",
    "Angular",
    "HTML",
    "CSS",
    "TailwindCSS",
    "FastAPI",
    "Django",
    "Flask",
    "Express",
    "NestJS",
    "PostgreSQL",
    "MySQL",
    "MongoDB",
    "Redis",
    "SQLite",
    "DynamoDB",
    "Cloud Firestore",
    "Firebase",
    "AWS",
    "GCP",
    "Google Cloud",
    "Azure",
    "Docker",
    "Kubernetes",
    "Terraform",
    "Git",
    "GitHub",
    "CI/CD",
    "GraphQL",
    "REST",
    "gRPC",
    "PyTorch",
    "TensorFlow",
    "Scikit-Learn",
    "Pandas",
    "NumPy",
    "Hugging Face",
    "LangChain",
    "LlamaIndex",
    "LLMs",
    "OpenAI",
    "Gemini",
    "AI Agents",
    "RAG",
    "Data Pipelines",
    "BigQuery",
    "Snowflake",
    "Selenium",
    "Cypress",
    "Playwright",
    "Jest",
    "Pytest",
    "QA Testing",
    "Automation Testing",
    "Manual Testing",
    "Excel",
    "Data Analysis",
    "Account Management",
    "Customer Success",
    "Sales",
    "Recruiting",
    "HR",
    "Project Management",
    "Agile",
    "Scrum",
    "Jira",
    "Communication Skills",
    "Problem Solving",
]


class JobNormalizationService:
    """Deterministic normalizer and parser converting raw payloads into CanonicalJob models."""

    def canonicalize_url(self, raw_url: str) -> str:
        """Strip marketing, tracking, and session query parameters, fragments, and trailing slashes."""
        if not raw_url:
            return ""
        parsed = urllib.parse.urlparse(raw_url.strip())
        TRACKING_KEYS = {
            "refid", "trk", "trackingid", "ref", "midtoken", "fbclid", "gclid",
            "session_id", "source", "originalsubdomain", "context", "position", "page"
        }
        query_params = urllib.parse.parse_qsl(parsed.query, keep_blank_values=False)
        cleaned_params = []
        for k, v in query_params:
            k_lower = k.lower()
            if k_lower.startswith("utm_") or k_lower in TRACKING_KEYS:
                continue
            cleaned_params.append((k, v))

        new_query = urllib.parse.urlencode(cleaned_params)
        clean_path = parsed.path.rstrip("/")
        return urllib.parse.urlunparse((
            parsed.scheme.lower() or "https",
            parsed.netloc.lower(),
            clean_path,
            "",
            new_query,
            "",
        ))

    def compute_canonical_hash(self, company: str, title: str, location: str | None = None) -> str:
        """Generate deterministic SHA-256 fingerprint hash for company + title + location."""
        c_clean = re.sub(r"[^a-z0-9]", "", (company or "").lower())
        t_clean = re.sub(r"[^a-z0-9]", "", (title or "").lower())
        loc_clean = re.sub(r"[^a-z0-9]", "", (location or "")[:25].lower())
        fingerprint = f"{c_clean}|{t_clean}|{loc_clean}"
        return hashlib.sha256(fingerprint.encode("utf-8")).hexdigest()

    def clean_html(self, raw_html: str) -> str:
        """Strip HTML tags and unescape HTML entities into clean markdown/text."""
        if not raw_html:
            return ""
        text = re.sub(r"<style[^>]*>[\s\S]*?</style>", "", raw_html, flags=re.IGNORECASE)
        text = re.sub(r"<script[^>]*>[\s\S]*?</script>", "", text, flags=re.IGNORECASE)
        text = re.sub(r"<h[1-6][^>]*>", "\n\n### ", text, flags=re.IGNORECASE)
        text = re.sub(r"</h[1-6]>", "\n\n", text, flags=re.IGNORECASE)
        text = re.sub(r"<li[^>]*>", "\n• ", text, flags=re.IGNORECASE)
        text = re.sub(r"</li>", "\n", text, flags=re.IGNORECASE)
        text = re.sub(r"</?[uo]l[^>]*>", "\n\n", text, flags=re.IGNORECASE)
        text = re.sub(r"<p[^>]*>", "\n\n", text, flags=re.IGNORECASE)
        text = re.sub(r"</p>", "\n\n", text, flags=re.IGNORECASE)
        text = re.sub(r"<br\s*/?>", "\n", text, flags=re.IGNORECASE)
        text = re.sub(r"<div[^>]*>", "\n", text, flags=re.IGNORECASE)
        text = re.sub(r"</div>", "\n", text, flags=re.IGNORECASE)
        text = re.sub(r"<[^>]+>", "", text)
        text = html.unescape(text)
        lines = [re.sub(r"[ \t\r\f\v]+", " ", line).strip() for line in text.split("\n")]
        text = "\n".join(lines)
        return re.sub(r"\n{3,}", "\n\n", text).strip()

    def normalize_title(self, raw_title: str) -> str:
        """Clean boilerplate noise from titles."""
        cleaned = re.sub(r"\s*-\s*\(.*?\)", "", raw_title)
        cleaned = re.sub(r"\[.*?\]", "", cleaned)
        cleaned = re.sub(
            r"\((?:remote|hybrid|onsite|india|us|uk|emea|apac)\)", "", cleaned, flags=re.IGNORECASE
        )
        cleaned = re.sub(
            r"\s*-\s*(?:full-time|part-time|contract|internship|temporary)",
            "",
            cleaned,
            flags=re.IGNORECASE,
        )
        return cleaned.strip()

    def format_relative_time(self, iso_or_ts: str | None) -> str:
        """Calculate human-friendly relative age string for posting (e.g. '2d ago', 'Today', '1w ago')."""
        if not iso_or_ts:
            return "Active posting"
        try:
            dt = datetime.fromisoformat(iso_or_ts.replace("Z", "+00:00"))
            now = datetime.now(UTC)
            diff = now - dt
            seconds = diff.total_seconds()
            if seconds < 0:
                return "Today"
            days = int(seconds // 86400)
            if days == 0:
                hours = int(seconds // 3600)
                if hours <= 1:
                    return "Just now"
                return f"{hours}h ago"
            elif days == 1:
                return "1d ago"
            elif days < 7:
                return f"{days}d ago"
            elif days < 30:
                weeks = max(1, days // 7)
                return f"{weeks}w ago"
            elif days < 365:
                months = max(1, days // 30)
                return f"{months}mo ago"
            else:
                return f"{dt.strftime('%b %Y')}"
        except Exception:
            return "Active posting"

    def detect_category(self, raw_title: str, raw_text: str) -> JobCategory:
        """Detect job role category (technical, data, qa, non_technical)."""
        combined = f"{raw_title} {raw_text[:500]}".lower()

        if any(
            k in combined
            for k in [
                "qa",
                "test",
                "quality assurance",
                "sdet",
                "automation engineer",
                "tester",
                "testing",
                "quality analyst",
            ]
        ):
            return "qa"

        if any(
            k in combined
            for k in [
                "data analyst",
                "data scientist",
                "data engineer",
                "analytics",
                "business intelligence",
                "bi developer",
                "bi analyst",
                "machine learning",
                "ai engineer",
                "mlops",
                "deep learning",
            ]
        ):
            return "data"

        if any(
            k in combined
            for k in [
                "account executive",
                "sales",
                "business development",
                "recruiter",
                "talent",
                "hr ",
                "human resources",
                "operations",
                "marketing",
                "finance",
                "customer success",
                "support engineer",
            ]
        ):
            return "non_technical"

        return "technical"

    def detect_experience(self, raw_title: str, raw_text: str) -> tuple[float | None, str | None]:
        """Detect years of experience required from title and text."""
        combined = f"{raw_title} {raw_text[:1200]}".lower()

        if any(
            k in combined
            for k in [
                "intern",
                "internship",
                "trainee",
                "entry level",
                "entry-level",
                "graduate",
                "fresher",
                "campus",
            ]
        ):
            return 0.0, "Fresher / Intern"

        # Regex for range e.g. "0-2 years", "1 to 3 years", "3 - 5 yrs"
        match_range = re.search(
            r"(\d+)\s*(?:-|to)\s*(\d+)\s*(?:years?|yrs?)(?:\s+of\s+experience)?", combined
        )
        if match_range:
            min_y = float(match_range.group(1))
            max_y = float(match_range.group(2))
            if min_y == 0:
                return min_y, f"{int(min_y)} - {int(max_y)} yrs (Fresher OK)"
            return min_y, f"{int(min_y)} - {int(max_y)} yrs experience"

        # Regex for single number e.g. "3+ years", "5+ yrs"
        match_single = re.search(r"(\d+)\+?\s*(?:years?|yrs?)(?:\s+of\s+experience)?", combined)
        if match_single:
            yrs = float(match_single.group(1))
            if yrs <= 1.0:
                return yrs, f"{int(yrs)} yr (Fresher OK)"
            return yrs, f"{int(yrs)}+ yrs experience"

        if any(k in raw_title.lower() for k in ["senior", "sr.", "lead", "principal", "staff"]):
            return 5.0, "5+ yrs (Senior)"
        if any(k in raw_title.lower() for k in ["junior", "jr.", "associate"]):
            return 1.0, "0 - 1 yrs (Fresher OK)"

        return 0.0, "Fresher OK"

    def detect_work_mode(
        self,
        raw_title: str,
        raw_location: str | None,
        raw_text: str,
        metadata: dict[str, Any],
    ) -> WorkMode:
        """Detect remote, hybrid, or onsite."""
        combined = f"{raw_title} {raw_location or ''} {raw_text[:300]} {metadata.get('workplaceType', '')}".lower()

        if (
            metadata.get("isRemote") is True
            or "remote" in (raw_location or "").lower()
            or "remote" in raw_title.lower()
            or "anywhere" in combined
            or "work from home" in combined
            or "worldwide" in combined
        ):
            return "remote"
        if "hybrid" in combined:
            return "hybrid"
        if "remote" in combined:
            return "remote"
        return "onsite"

    def detect_employment_type(
        self, raw_title: str, raw_commitment: str | None, raw_text: str
    ) -> EmploymentType:
        """Detect employment type (internship, full_time, contract, etc.)."""
        combined = f"{raw_title} {raw_commitment or ''} {raw_text[:500]}".lower()

        if "intern" in combined or "trainee" in combined or "co-op" in combined:
            return "internship"
        if "contract" in combined or "freelance" in combined or "temporary" in combined:
            return "contract"
        if "part-time" in combined or "part time" in combined:
            return "part_time"
        return "full_time"

    def detect_seniority(self, raw_title: str, raw_text: str) -> SeniorityLevel:
        """Detect seniority level from title and description."""
        title_lower = raw_title.lower()

        if "intern" in title_lower or "trainee" in title_lower:
            return "internship"
        if (
            "lead" in title_lower
            or "principal" in title_lower
            or "head" in title_lower
            or "director" in title_lower
        ):
            return "lead"
        if "senior" in title_lower or "sr." in title_lower or "staff" in title_lower:
            return "senior"
        if (
            "junior" in title_lower
            or "jr." in title_lower
            or "associate" in title_lower
            or "entry" in title_lower
        ):
            return "entry"
        return "mid"

    def parse_compensation(self, raw_comp: str | None, raw_text: str) -> CompensationRange | None:
        """Parse compensation bounds, currency, and pay interval."""
        comp_str = raw_comp or ""

        if not comp_str:
            patterns = [
                r"(\$|₹|€|£|USD|INR|EUR|GBP|CAD|SGD)\s*([0-9]{1,3}(?:,[0-9]{3})+|[0-9]{4,6})\s*(?:-|to)\s*(\$|₹|€|£|USD|INR|EUR|GBP|CAD|SGD)?\s*([0-9]{1,3}(?:,[0-9]{3})+|[0-9]{4,6})\s*(USD|INR|EUR|GBP|CAD|SGD)?",
                r"(\$|₹|€|£|USD|INR|EUR|GBP)\s*([0-9]{2,3})\s*k\s*(?:-|to)\s*(\$|₹|€|£|USD|INR|EUR|GBP)?\s*([0-9]{2,3})\s*k",
                r"([0-9]+(?:\.[0-9]+)?)\s*(?:-|to)\s*([0-9]+(?:\.[0-9]+)?)\s*(?:LPA|Lakhs|lakhs\s+per\s+annum)",
                r"(\$|₹|€|£|USD|INR|EUR|GBP)\s*([0-9]{1,3}(?:,[0-9]{3})+|[0-9]{4,6})\s*(USD|INR|EUR|GBP)?\s*(?:/(?:year|yr|annum|month|mo|hr|hour))?",
            ]
            for pat in patterns:
                m = re.search(pat, raw_text, flags=re.IGNORECASE)
                if m:
                    comp_str = m.group(0)
                    break

        if not comp_str:
            return None

        currency = "USD"
        if "₹" in comp_str or "INR" in comp_str or "LPA" in comp_str or "Lakh" in comp_str:
            currency = "INR"
        elif "€" in comp_str or "EUR" in comp_str:
            currency = "EUR"
        elif "£" in comp_str or "GBP" in comp_str:
            currency = "GBP"
        elif "CAD" in comp_str:
            currency = "CAD"
        elif "SGD" in comp_str:
            currency = "SGD"

        interval: Literal["year", "month", "hour"] = "year"
        comp_lower = comp_str.lower()
        if "month" in comp_lower or "/mo" in comp_lower or "pm" in comp_lower:
            interval = "month"
        elif "hour" in comp_lower or "/hr" in comp_lower or "hourly" in comp_lower:
            interval = "hour"

        if "lpa" in comp_lower or "lakh" in comp_lower:
            lpa_nums = [float(n) for n in re.findall(r"[0-9]+(?:\.[0-9]+)?", comp_str)]
            if lpa_nums:
                min_val = lpa_nums[0] * 100000.0
                max_val = lpa_nums[1] * 100000.0 if len(lpa_nums) > 1 else min_val
                return CompensationRange(
                    min=min_val,
                    max=max_val,
                    currency="INR",
                    interval="year",
                    rawString=comp_str.strip(),
                )

        num_matches = re.findall(
            r"([0-9]+(?:,[0-9]+)*(?:\.[0-9]+)?)\s*(k)?", comp_str, flags=re.IGNORECASE
        )
        nums = []
        for val_str, k_suffix in num_matches:
            val = float(val_str.replace(",", ""))
            if k_suffix.lower() == "k" or (val < 1000 and interval == "year" and currency == "USD"):
                val *= 1000.0
            nums.append(val)

        if not nums:
            return None

        min_val = nums[0]
        max_val = nums[1] if len(nums) > 1 else min_val

        return CompensationRange(
            min=min_val,
            max=max_val,
            currency=currency,
            interval=interval,
            rawString=comp_str.strip(),
        )

    def extract_skills(self, text: str, metadata: dict) -> list[str]:
        """Extract explicit skills matched against tech skills dictionary."""
        extracted: set[str] = set()

        if "extracted_skills" in metadata and isinstance(metadata["extracted_skills"], list):
            for s in metadata["extracted_skills"]:
                if s:
                    extracted.add(s)

        text_lower = f" {text.lower()} "
        for skill in KNOWN_SKILLS:
            pattern = rf"\b{re.escape(skill.lower())}\b"
            if re.search(pattern, text_lower):
                extracted.add(skill)

        return sorted(extracted)

    def normalize(self, raw_payload: RawJobPayload) -> CanonicalJob:
        """Convert a RawJobPayload into a fully validated CanonicalJob."""
        # Extract explicit structural blocks based on source type
        description_blocks = []
        if raw_payload.sourceType == "lever" and raw_payload.metadata and "lists" in raw_payload.metadata:
            description_blocks = job_structure_parser.parse_lever_to_blocks(
                raw_payload.metadata.get("descriptionPlain"),
                raw_payload.metadata.get("lists"),
                raw_payload.metadata.get("additionalPlain"),
                additional_html=raw_payload.metadata.get("additionalHtml"),
            )
        elif raw_payload.rawDescription and ("<" in raw_payload.rawDescription and ">" in raw_payload.rawDescription):
            description_blocks = job_structure_parser.parse_html_to_blocks(raw_payload.rawDescription)
        elif raw_payload.rawDescription:
            description_blocks = job_structure_parser.parse_text_to_blocks(raw_payload.rawDescription)

        # Authoritative description derived deterministically from blocks if available
        if description_blocks:
            cleaned_desc = job_structure_parser.blocks_to_clean_text(description_blocks)
        else:
            cleaned_desc = self.clean_html(raw_payload.rawDescription)

        cleaned_title = self.normalize_title(raw_payload.rawTitle)
        category = self.detect_category(raw_payload.rawTitle, cleaned_desc)
        exp_years, exp_text = self.detect_experience(raw_payload.rawTitle, cleaned_desc)
        work_mode = self.detect_work_mode(
            raw_payload.rawTitle, raw_payload.rawLocation, cleaned_desc, raw_payload.metadata
        )
        emp_type = self.detect_employment_type(
            raw_payload.rawTitle, raw_payload.rawCommitment, cleaned_desc
        )
        seniority = self.detect_seniority(raw_payload.rawTitle, cleaned_desc)
        compensation = self.parse_compensation(raw_payload.rawCompensation, cleaned_desc)
        skills = self.extract_skills(cleaned_desc, raw_payload.metadata)
        relative_posted = self.format_relative_time(raw_payload.rawPostedAt)

        canonical_url = self.canonicalize_url(raw_payload.url)
        canonical_hash = self.compute_canonical_hash(
            raw_payload.companyName, cleaned_title, raw_payload.rawLocation
        )
        job_id = f"job-{uuid.uuid5(uuid.NAMESPACE_URL, canonical_url).hex[:10]}"

        return CanonicalJob(
            id=job_id,
            canonicalHash=canonical_hash,
            title=cleaned_title,
            company=raw_payload.companyName,
            location=raw_payload.rawLocation
            or ("Remote" if work_mode == "remote" else "India / Global"),
            workMode=work_mode,
            category=category,
            employmentType=emp_type,
            seniority=seniority,
            experienceYearsRequired=exp_years,
            experienceText=exp_text,
            postedAt=raw_payload.rawPostedAt,
            postedDateText=relative_posted,
            compensation=compensation,
            description=cleaned_desc,
            descriptionBlocks=description_blocks,
            requiredSkills=skills,
            department=raw_payload.rawDepartment,
            sourceRef=raw_payload.to_source_ref(),
        )


job_normalization_service = JobNormalizationService()
