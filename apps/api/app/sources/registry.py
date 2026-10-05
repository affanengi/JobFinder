"""Target Tech Companies Configuration and Multi-ATS Registry (Greenhouse, Lever, Ashby)."""

from app.schemas.job import CompanyBoardTarget

TARGET_COMPANIES: list[CompanyBoardTarget] = [
    # --- Lever Public Boards (Bangalore, India Hubs & Remote) ---
    CompanyBoardTarget(
        name="Meesho",
        atsType="lever",
        slug="meesho",
        tags=["E-commerce", "Bangalore", "QA", "Data", "Engineering"],
    ),
    CompanyBoardTarget(
        name="CRED",
        atsType="lever",
        slug="cred",
        tags=["Fintech", "Bangalore", "Hyderabad", "Operations"],
    ),
    CompanyBoardTarget(
        name="Spotify", atsType="lever", slug="spotify", tags=["Media", "Music", "Global"]
    ),
    CompanyBoardTarget(
        name="Palantir", atsType="lever", slug="palantir", tags=["Data", "Analytics", "Solutions"]
    ),
    # --- Ashby Public Boards (100% Global Remote & Tech Hubs) ---
    CompanyBoardTarget(
        name="Supabase",
        atsType="ashby",
        slug="supabase",
        tags=["Database", "Open Source", "Remote"],
    ),
    CompanyBoardTarget(
        name="Linear", atsType="ashby", slug="linear", tags=["Productivity", "Web", "Remote"]
    ),
    CompanyBoardTarget(
        name="Notion", atsType="ashby", slug="notion", tags=["Productivity", "AI", "Remote"]
    ),
    CompanyBoardTarget(
        name="Sentry", atsType="ashby", slug="sentry", tags=["Monitoring", "DevTools", "Remote"]
    ),
    CompanyBoardTarget(name="Ramp", atsType="ashby", slug="ramp", tags=["Fintech", "Remote"]),
    CompanyBoardTarget(
        name="OpenAI", atsType="ashby", slug="openai", tags=["AI", "Research", "Remote"]
    ),
    # --- Greenhouse Public Boards (India Hubs & Remote) ---
    CompanyBoardTarget(
        name="Canonical",
        atsType="greenhouse",
        slug="canonical",
        tags=["Linux", "QA", "Data", "Cloud", "Remote"],
    ),
    CompanyBoardTarget(
        name="Thoughtworks",
        atsType="greenhouse",
        slug="thoughtworks",
        tags=["Consulting", "Bangalore", "Hyderabad", "Pune", "QA", "Data"],
    ),
    CompanyBoardTarget(
        name="Elastic", atsType="greenhouse", slug="elastic", tags=["Search", "Data", "Remote"]
    ),
    CompanyBoardTarget(
        name="MongoDB",
        atsType="greenhouse",
        slug="mongodb",
        tags=["Database", "Bangalore", "Gurgaon", "Remote"],
    ),
    CompanyBoardTarget(
        name="GitLab", atsType="greenhouse", slug="gitlab", tags=["DevOps", "QA", "Data", "Remote"]
    ),
    CompanyBoardTarget(
        name="Databricks", atsType="greenhouse", slug="databricks", tags=["AI", "Data", "Bangalore"]
    ),
    CompanyBoardTarget(
        name="Scale AI", atsType="greenhouse", slug="scaleai", tags=["AI", "Data", "Remote"]
    ),
    CompanyBoardTarget(
        name="Stripe", atsType="greenhouse", slug="stripe", tags=["Fintech", "Remote", "India"]
    ),
    CompanyBoardTarget(
        name="Figma", atsType="greenhouse", slug="figma", tags=["Product", "Design", "Remote"]
    ),
    CompanyBoardTarget(
        name="Cloudflare",
        atsType="greenhouse",
        slug="cloudflare",
        tags=["Cloud", "Systems", "Remote"],
    ),
]


def get_target_by_slug(slug: str) -> CompanyBoardTarget | None:
    """Find company board target by slug."""
    for target in TARGET_COMPANIES:
        if target.slug.lower() == slug.lower():
            return target
    return None
