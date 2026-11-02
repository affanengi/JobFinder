"""Authoritative contact identity resolution, normalization, and ambiguity helpers."""

import hashlib
import re
from typing import Optional


def normalize_company_key(raw_name: str | None) -> str:
    """Normalize raw company name into a clean, collision-resistant slug."""
    if not raw_name or not isinstance(raw_name, str):
        return "unknown"
    from app.services.company_identity_service import normalize_company
    canonical_key, _, _ = normalize_company(raw_name)
    if canonical_key and canonical_key != "unknown":
        return canonical_key
    cleaned = raw_name.strip().lower()
    # Strip common corporate suffixes for key normalization
    cleaned = re.sub(r"\b(inc|corp|corporation|llc|ltd|limited|technologies|technology|tech|labs|co)\b\.?", "", cleaned)
    slug = re.sub(r"[^a-z0-9]+", "-", cleaned).strip("-")
    return slug or "unknown"


def extract_linkedin_vanity_slug(url: str | None) -> Optional[str]:
    """Extract canonical lowercase vanity slug from a LinkedIn profile URL."""
    if not url or not isinstance(url, str):
        return None
    clean = url.strip().lower()
    # Remove protocol, www, and localized subdomains (e.g. in.linkedin.com)
    clean = re.sub(r"^https?://", "", clean)
    clean = re.sub(r"^[a-z]{2,3}\.linkedin\.com", "linkedin.com", clean)
    clean = re.sub(r"^www\.linkedin\.com", "linkedin.com", clean)
    # Strip query parameters and trailing anchors/slashes
    clean = clean.split("?")[0].split("#")[0].rstrip("/")

    match = re.search(r"linkedin\.com/(?:in|pub)/([a-zA-Z0-9_\-\%]+)", clean)
    if match:
        slug = match.group(1).lower().strip()
        if slug in ("search", "feed", "jobs", "company", "in", "pub"):
            return None
        return slug

    # Also support raw vanity slug if passed directly without domain
    if "/" not in clean and "." not in clean and re.match(r"^[a-z0-9_\-\%]+$", clean):
        if clean not in ("search", "feed", "jobs", "company", "in", "pub"):
            return clean

    return None


def normalize_email_address(email: str | None) -> Optional[str]:
    """Clean and normalize a professional email address."""
    if not email or not isinstance(email, str):
        return None
    clean = email.strip().lower()
    # Basic RFC-like validation sanity check
    if re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", clean):
        return clean
    return None


def categorize_role_title(role_title: str | None) -> str:
    """Classify a role title into an authoritative role category bucket."""
    if not role_title or not isinstance(role_title, str):
        return "other"
    title_lower = role_title.lower()

    if any(k in title_lower for k in ("sourcer", "sourcing")):
        return "sourcer"
    if any(k in title_lower for k in ("recruiter", "talent acquisition", "recruiting", "talent partner", "headhunter")):
        return "recruiter"
    if any(k in title_lower for k in ("engineering manager", "em", "software manager", "sdm", "development manager")):
        return "eng_manager"
    if any(k in title_lower for k in ("director of engineering", "vp of engineering", "head of engineering", "vp engineering")):
        return "eng_director"
    if any(k in title_lower for k in ("tech lead", "lead engineer", "principal engineer", "staff engineer", "architect")):
        return "tech_lead"
    if any(k in title_lower for k in ("software engineer", "developer", "backend", "frontend", "full stack")):
        return "engineer"
    if any(k in title_lower for k in ("cto", "cio", "cpo", "founder", "co-founder")):
        return "executive"

    return "other"


def generate_candidate_identity_keys(
    company_name: str,
    full_name: str,
    role_title: str | None = None,
    linkedin_url: str | None = None,
    email: str | None = None,
) -> list[str]:
    """Generate all applicable identity alias keys for a contact.
    
    Includes:
    - `li:<vanity_slug>` (Strong)
    - `em:<email>` (Strong)
    - `comp_fn_role:<comp_key>:<norm_name>:<role_category>` (Weak fallback)
    """
    keys: list[str] = []
    comp_key = normalize_company_key(company_name)
    norm_name = re.sub(r"[^a-z0-9]", "", (full_name or "").lower())
    role_cat = categorize_role_title(role_title)

    # 1. Canonical LinkedIn Vanity Slug (Strong)
    slug = extract_linkedin_vanity_slug(linkedin_url)
    if slug:
        keys.append(f"li:{slug}")

    # 2. Direct Professional Email (Strong)
    clean_email = normalize_email_address(email)
    if clean_email:
        keys.append(f"em:{clean_email}")

    # 3. Company-Scoped Fallback (Weak)
    if comp_key and norm_name:
        keys.append(f"comp_fn_role:{comp_key}:{norm_name}:{role_cat}")

    return keys


def compute_deterministic_contact_id(
    company_name: str,
    full_name: str,
    role_title: str | None = None,
    linkedin_url: str | None = None,
    email: str | None = None,
) -> str:
    """Compute a deterministic, collision-resistant contact ID based on strongest signal."""
    slug = extract_linkedin_vanity_slug(linkedin_url)
    if slug:
        raw = f"li:{slug}"
        return f"cnt-{hashlib.sha256(raw.encode('utf-8')).hexdigest()[:16]}"

    clean_email = normalize_email_address(email)
    if clean_email:
        raw = f"em:{clean_email}"
        return f"cnt-{hashlib.sha256(raw.encode('utf-8')).hexdigest()[:16]}"

    comp_key = normalize_company_key(company_name)
    norm_name = re.sub(r"[^a-z0-9]", "", (full_name or "").lower())
    role_cat = categorize_role_title(role_title)
    raw = f"comp_fn_role:{comp_key}:{norm_name}:{role_cat}"
    return f"cnt-{hashlib.sha256(raw.encode('utf-8')).hexdigest()[:16]}"


def check_signal_divergence(
    cand_linkedin_or_keys: str | list[str] | set[str] | None,
    cand_email_or_keys: str | list[str] | set[str] | None = None,
    exist_linkedin: str | None = None,
    exist_email: str | None = None,
) -> bool:
    """Return True if candidate and existing record exhibit conflicting strong signals.
    
    Supports:
    1. check_signal_divergence(keys1, keys2)
    2. check_signal_divergence(cand_li, cand_em, exist_li, exist_em)
    """
    # Case 1: Called with lists/sets of identity keys
    if isinstance(cand_linkedin_or_keys, (list, set, tuple)) and isinstance(
        cand_email_or_keys, (list, set, tuple)
    ):
        keys1 = set(cand_linkedin_or_keys)
        keys2 = set(cand_email_or_keys)

        li1 = {k for k in keys1 if k.startswith("li:")}
        li2 = {k for k in keys2 if k.startswith("li:")}
        if li1 and li2 and not (li1 & li2):
            return True

        em1 = {k for k in keys1 if k.startswith("em:")}
        em2 = {k for k in keys2 if k.startswith("em:")}
        if em1 and em2 and not (em1 & em2):
            return True

        return False

    # Case 2: Called with individual linkedin/email strings
    cand_slug = extract_linkedin_vanity_slug(cand_linkedin_or_keys if isinstance(cand_linkedin_or_keys, str) else None)
    exist_slug = extract_linkedin_vanity_slug(exist_linkedin)
    if cand_slug and exist_slug and cand_slug != exist_slug:
        return True

    cand_em = normalize_email_address(cand_email_or_keys if isinstance(cand_email_or_keys, str) else None)
    exist_em = normalize_email_address(exist_email)
    if cand_em and exist_em and cand_em != exist_em:
        return True

    return False


def generate_ambiguity_discriminant_id(
    company_name: str,
    full_name: str,
    role_title: str | None = None,
    location: str | None = None,
    evidence_discriminant: str | None = None,
    linkedin_url: str | None = None,
    **kwargs,
) -> str:
    """Generate a collision-resistant discriminant ID for ambiguous identical-name profiles."""
    comp_key = normalize_company_key(company_name)
    norm_name = re.sub(r"[^a-z0-9]", "", (full_name or "").lower())
    clean_title = re.sub(r"[^a-z0-9]", "", (role_title or "role").lower())
    discriminator = evidence_discriminant or location or linkedin_url or kwargs.get("discriminator") or "distinct"
    clean_ev = re.sub(r"[^a-z0-9]", "", discriminator.lower())

    raw = f"ambig:{comp_key}:{norm_name}:{clean_title}:{clean_ev}"
    return f"cnt-ambig-{hashlib.sha256(raw.encode('utf-8')).hexdigest()[:14]}"
