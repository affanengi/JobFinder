"""Centralized Company Identity, Normalization, and Deduplication Service.

Provides deterministic canonical company resolution using verified domains,
ATS board slugs, official company registries, and suffix-safe normalization.
"""

import re
import urllib.parse
from typing import Optional


# Authoritative registry of known tech organizations with verified domains and board slugs
CANONICAL_COMPANIES: dict[str, dict] = {
    "scale-ai": {
        "key": "scale-ai",
        "name": "Scale AI",
        "domain": "scale.com",
        "aliases": {
            "scale ai",
            "scaleai",
            "scaleai labs",
            "scale ai inc",
            "scale ai, inc.",
            "scale ai technologies",
            "scale-ai",
            "scale",
        },
        "domains": {"scale.com", "scaleai.com"},
        "board_slugs": {"scaleai", "scale"},
    },
    "figma": {
        "key": "figma",
        "name": "Figma",
        "domain": "figma.com",
        "aliases": {
            "figma",
            "figma inc",
            "figma inc.",
            "figma, inc.",
            "figma-inc",
            "figma technologies",
        },
        "domains": {"figma.com"},
        "board_slugs": {"figma"},
    },
    "stripe": {
        "key": "stripe",
        "name": "Stripe",
        "domain": "stripe.com",
        "aliases": {"stripe", "stripe inc", "stripe inc.", "stripe, inc.", "stripe-inc"},
        "domains": {"stripe.com"},
        "board_slugs": {"stripe"},
    },
    "databricks": {
        "key": "databricks",
        "name": "Databricks",
        "domain": "databricks.com",
        "aliases": {"databricks", "databricks inc", "databricks inc.", "data bricks"},
        "domains": {"databricks.com"},
        "board_slugs": {"databricks"},
    },
    "openai": {
        "key": "openai",
        "name": "OpenAI",
        "domain": "openai.com",
        "aliases": {"openai", "open ai", "openai llc", "openai inc"},
        "domains": {"openai.com"},
        "board_slugs": {"openai"},
    },
    "mongodb": {
        "key": "mongodb",
        "name": "MongoDB",
        "domain": "mongodb.com",
        "aliases": {"mongodb", "mongo db", "mongodb inc", "mongodb inc."},
        "domains": {"mongodb.com"},
        "board_slugs": {"mongodb"},
    },
    "canonical": {
        "key": "canonical",
        "name": "Canonical",
        "domain": "canonical.com",
        "aliases": {"canonical", "canonical ltd", "canonical group", "canonical group limited"},
        "domains": {"canonical.com"},
        "board_slugs": {"canonical"},
    },
    "gitlab": {
        "key": "gitlab",
        "name": "GitLab",
        "domain": "gitlab.com",
        "aliases": {"gitlab", "git lab", "gitlab inc", "gitlab b.v."},
        "domains": {"gitlab.com"},
        "board_slugs": {"gitlab"},
    },
    "notion": {
        "key": "notion",
        "name": "Notion",
        "domain": "notion.so",
        "aliases": {"notion", "notion labs", "notion labs inc"},
        "domains": {"notion.so"},
        "board_slugs": {"notion"},
    },
    "linear": {
        "key": "linear",
        "name": "Linear",
        "domain": "linear.app",
        "aliases": {"linear", "linear app", "linear orbit"},
        "domains": {"linear.app"},
        "board_slugs": {"linear"},
    },
    "sentry": {
        "key": "sentry",
        "name": "Sentry",
        "domain": "sentry.io",
        "aliases": {"sentry", "functional software inc", "sentry.io"},
        "domains": {"sentry.io"},
        "board_slugs": {"sentry"},
    },
    "supabase": {
        "key": "supabase",
        "name": "Supabase",
        "domain": "supabase.com",
        "aliases": {"supabase", "supabase inc"},
        "domains": {"supabase.com"},
        "board_slugs": {"supabase"},
    },
    "ramp": {
        "key": "ramp",
        "name": "Ramp",
        "domain": "ramp.com",
        "aliases": {"ramp", "ramp business corporation", "ramp financial"},
        "domains": {"ramp.com"},
        "board_slugs": {"ramp"},
    },
    "cloudflare": {
        "key": "cloudflare",
        "name": "Cloudflare",
        "domain": "cloudflare.com",
        "aliases": {"cloudflare", "cloudflare inc", "cloudflare, inc."},
        "domains": {"cloudflare.com"},
        "board_slugs": {"cloudflare"},
    },
    "elastic": {
        "key": "elastic",
        "name": "Elastic",
        "domain": "elastic.co",
        "aliases": {"elastic", "elasticsearch", "elastic n.v."},
        "domains": {"elastic.co"},
        "board_slugs": {"elastic"},
    },
    "thoughtworks": {
        "key": "thoughtworks",
        "name": "Thoughtworks",
        "domain": "thoughtworks.com",
        "aliases": {"thoughtworks", "thoughtworks inc"},
        "domains": {"thoughtworks.com"},
        "board_slugs": {"thoughtworks"},
    },
    "palantir": {
        "key": "palantir",
        "name": "Palantir",
        "domain": "palantir.com",
        "aliases": {"palantir", "palantir technologies", "palantir technologies inc"},
        "domains": {"palantir.com"},
        "board_slugs": {"palantir"},
    },
    "meesho": {
        "key": "meesho",
        "name": "Meesho",
        "domain": "meesho.io",
        "aliases": {"meesho", "fashnear technologies"},
        "domains": {"meesho.io"},
        "board_slugs": {"meesho"},
    },
    "cred": {
        "key": "cred",
        "name": "CRED",
        "domain": "cred.club",
        "aliases": {"cred", "dreamplug technologies"},
        "domains": {"cred.club"},
        "board_slugs": {"cred"},
    },
    "spotify": {
        "key": "spotify",
        "name": "Spotify",
        "domain": "spotify.com",
        "aliases": {"spotify", "spotify ab", "spotify usa inc"},
        "domains": {"spotify.com"},
        "board_slugs": {"spotify"},
    },
    "datadog": {
        "key": "datadog",
        "name": "Datadog",
        "domain": "datadoghq.com",
        "aliases": {"datadog", "datadog inc", "data dog"},
        "domains": {"datadoghq.com", "datadog.com"},
        "board_slugs": {"datadog"},
    },
    "google": {
        "key": "google",
        "name": "Google",
        "domain": "google.com",
        "aliases": {"google", "google llc", "alphabet"},
        "domains": {"google.com", "careers.google.com"},
        "board_slugs": {"google"},
    },
}

# Pre-computed fast lookup indices
_ALIAS_INDEX: dict[str, dict] = {}
_BOARD_SLUG_INDEX: dict[str, dict] = {}
_DOMAIN_INDEX: dict[str, dict] = {}

for comp in CANONICAL_COMPANIES.values():
    _ALIAS_INDEX[comp["key"]] = comp
    _ALIAS_INDEX[comp["name"].lower()] = comp
    for alias in comp.get("aliases", set()):
        _ALIAS_INDEX[alias.lower()] = comp
    for slug in comp.get("board_slugs", set()):
        _BOARD_SLUG_INDEX[slug.lower()] = comp
    for dom in comp.get("domains", set()):
        _DOMAIN_INDEX[dom.lower()] = comp


def extract_ats_board_slug(url: str | None) -> Optional[str]:
    """Extract ATS board slug from a URL if present (Ashby, Greenhouse, Lever)."""
    if not url or not isinstance(url, str):
        return None
    clean = url.strip()

    # 1. Ashby: jobs.ashbyhq.com/{slug}/...
    ashby_match = re.search(r"jobs\.ashbyhq\.com/([a-zA-Z0-9_\-]+)", clean)
    if ashby_match:
        return ashby_match.group(1).lower()

    # 2. Greenhouse: boards.greenhouse.io/{slug}/... or job-boards.greenhouse.io/{slug}/...
    gh_match = re.search(r"(?:boards|job-boards)\.greenhouse\.io/(?:v1/boards/)?([a-zA-Z0-9_\-]+)", clean)
    if gh_match:
        slug = gh_match.group(1).lower()
        if slug not in ("embed", "v1", "boards"):
            return slug

    # 3. Lever: jobs.lever.co/{slug}/...
    lever_match = re.search(r"jobs\.lever\.co/([a-zA-Z0-9_\-]+)", clean)
    if lever_match:
        return lever_match.group(1).lower()

    return None


def extract_domain_from_url(url: str | None) -> Optional[str]:
    """Extract cleaned hostname or official company domain from a URL."""
    if not url or not isinstance(url, str) or not url.startswith("http"):
        return None
    try:
        parsed = urllib.parse.urlparse(url.strip())
        netloc = parsed.netloc.lower()
        # Strip port
        netloc = netloc.split(":")[0]
        # Strip leading www.
        if netloc.startswith("www."):
            netloc = netloc[4:]
        # Skip generic portals/aggregators
        generic_hosts = (
            "linkedin.com",
            "indeed.com",
            "glassdoor.com",
            "greenhouse.io",
            "lever.co",
            "ashbyhq.com",
            "workday.com",
            "wellfound.com",
        )
        if any(netloc == gh or netloc.endswith("." + gh) for gh in generic_hosts):
            return None
        return netloc or None
    except Exception:
        return None


def clean_corporate_suffixes(raw_name: str) -> str:
    """Strip standard corporate legal suffixes while preserving the root brand name."""
    cleaned = re.sub(r"[\.,]", " ", raw_name)
    cleaned = re.sub(
        r"\b(inc|incorporated|corp|corporation|llc|ltd|limited|technologies|technology|tech|labs|co|ab|b\.v\.|private limited|pvt ltd)\b",
        "",
        cleaned,
        flags=re.IGNORECASE,
    )
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    return cleaned


def normalize_company(raw_name: str | None, url: str | None = None) -> tuple[str, str, str]:
    """Normalize raw company name and/or job URL into canonical (key, canonical_name, domain).
    
    Returns:
        (canonical_key, canonical_display_name, canonical_domain)
    """
    # 1. Strong Evidence: ATS Board Slug extracted from verified ATS URL
    if url:
        board_slug = extract_ats_board_slug(url)
        if board_slug and board_slug in _BOARD_SLUG_INDEX:
            canonical = _BOARD_SLUG_INDEX[board_slug]
            return canonical["key"], canonical["name"], canonical["domain"]

        custom_domain = extract_domain_from_url(url)
        if custom_domain and custom_domain in _DOMAIN_INDEX:
            canonical = _DOMAIN_INDEX[custom_domain]
            return canonical["key"], canonical["name"], canonical["domain"]

    # 2. Strong Evidence: Exact alias / brand match
    if not raw_name or not isinstance(raw_name, str):
        return "unknown", "Unknown Company", "unknown.com"

    trimmed = raw_name.strip()
    lower_name = trimmed.lower()

    if lower_name in _ALIAS_INDEX:
        canonical = _ALIAS_INDEX[lower_name]
        return canonical["key"], canonical["name"], canonical["domain"]

    # Check slugified variant against alias index
    slug_variant = re.sub(r"[^a-z0-9]+", "-", lower_name).strip("-")
    if slug_variant in _ALIAS_INDEX:
        canonical = _ALIAS_INDEX[slug_variant]
        return canonical["key"], canonical["name"], canonical["domain"]

    # 3. Strong Evidence: Match after stripping harmless corporate legal suffixes
    cleaned_root = clean_corporate_suffixes(lower_name)
    if cleaned_root and cleaned_root in _ALIAS_INDEX:
        canonical = _ALIAS_INDEX[cleaned_root]
        return canonical["key"], canonical["name"], canonical["domain"]

    cleaned_root_slug = re.sub(r"[^a-z0-9]+", "-", cleaned_root).strip("-")
    if cleaned_root_slug and cleaned_root_slug in _ALIAS_INDEX:
        canonical = _ALIAS_INDEX[cleaned_root_slug]
        return canonical["key"], canonical["name"], canonical["domain"]

    # 4. Unknown / Custom Company Fallback
    # Strip common corporate suffixes for clean key slug, matching normalize_company_key
    clean_key = cleaned_root_slug or slug_variant or "unknown"
    custom_domain = extract_domain_from_url(url)
    if not custom_domain:
        clean_domain = f"{re.sub(r'[^a-z0-9]', '', clean_key)}.com"
    else:
        clean_domain = custom_domain

    title_name = " ".join(word.capitalize() for word in trimmed.split())
    return clean_key, title_name, clean_domain


def is_same_company(name1: str, name2: str, url1: str | None = None, url2: str | None = None) -> bool:
    """Determine whether two company records represent the same canonical organization."""
    k1, _, _ = normalize_company(name1, url=url1)
    k2, _, _ = normalize_company(name2, url=url2)
    return bool(k1 and k2 and k1 == k2)
