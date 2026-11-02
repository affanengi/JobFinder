"""Schemas for Professional Contact Discovery, Email Evidence Classification, and Persistence."""

from datetime import UTC, datetime
from typing import Any, Literal
from pydantic import BaseModel, Field, model_validator

StakeholderTier = Literal[
    "RECRUITER",
    "HIRING_MANAGER",
    "TECH_LEAD",
    "REGIONAL_LEAD",
    "OTHER",
]

ContactType = Literal[
    "INDIVIDUAL",
    "ORGANIZATION_CHANNEL",
]

ChannelPurpose = Literal[
    "INDIVIDUAL_REPRESENTATIVE",
    "GENERAL_CAREERS_INBOX",
    "HR_SHARED_INBOX",
    "ACCOMMODATIONS_ONLY",
    "PRESS_INVESTOR_RELATIONS",
    "UNSPECIFIED",
]

ContactabilityStatus = Literal[
    "PROFILE_ONLY",
    "DIRECT_EMAIL_FOUND",
    "GENERIC_INBOX_FOUND",
    "MULTIPLE_PUBLIC_CHANNELS_FOUND",
    "INSUFFICIENT_EVIDENCE",
]

RoleEvidenceStatus = Literal[
    "CURRENT_CONFIRMED",
    "LIKELY_CURRENT",
    "FORMER_ROLE",
    "UNCLEAR_ASSOCIATION",
]

# The 6 authoritative evidence classifications defined in JobFinder Phase 2
EmailEvidenceClassification = Literal[
    "PUBLICLY_LISTED",
    "PROVIDER_VERIFIED",
    "PATTERN_INFERRED",
    "DOMAIN_MAIL_ENABLED",
    "UNVERIFIED",
    "INVALID_OR_UNSUPPORTED",
]

MXRecordStatus = Literal[
    "VALID_MX",
    "NO_MX",
    "UNCHECKED",
    "ERROR",
]


class ContactSearchLink(BaseModel):
    """Pre-formatted browser search query link ($0 free fallback when API search is unavailable)."""

    title: str
    query: str
    url: str
    platform: Literal["google", "linkedin", "careers"]


class DiscoveredContact(BaseModel):
    """Authoritative persistent record of a discovered professional contact."""

    id: str
    userId: str
    opportunityId: str
    companyName: str
    fullName: str
    roleTitle: str
    stakeholderTier: StakeholderTier = "OTHER"
    contactType: ContactType = "INDIVIDUAL"
    channelPurpose: ChannelPurpose = "INDIVIDUAL_REPRESENTATIVE"

    # Primary Channel Fields
    email: str | None = None
    emailClassification: EmailEvidenceClassification = "UNVERIFIED"
    emailEvidenceSummary: str | None = None
    mxStatus: MXRecordStatus = "UNCHECKED"

    # Multi-Channel Profile Links (First-Class Citizens)
    linkedinUrl: str | None = None
    githubUrl: str | None = None
    portfolioUrl: str | None = None

    # Overall Contactability & Role Evidence Taxonomy
    contactabilityStatus: ContactabilityStatus = "PROFILE_ONLY"
    roleEvidenceStatus: RoleEvidenceStatus = "LIKELY_CURRENT"

    # Provenance & Tracking
    location: str | None = None
    isHyderabad: bool = False
    sourceUrls: list[str] = Field(default_factory=list)
    evidenceSnippets: list[str] = Field(default_factory=list)
    searchProviderUsed: str = "fallback_links"
    confidenceScore: float = Field(default=0.5, ge=0.0, le=1.0)
    rankingScore: int = 0
    rankingReason: str = ""
    isDismissed: bool = False
    isReviewed: bool = False
    doNotContact: bool = False
    suppressionState: Literal["NONE", "JOB_SPECIFIC_SUPPRESSION", "GLOBAL_STAKEHOLDER_SUPPRESSION"] = "NONE"
    suppressionReason: str | None = None
    suppressionUpdatedAt: str | None = None
    # Cross-Opportunity & Identity Resolution Fields
    companyKey: str = ""
    associatedOpportunityIds: list[str] = Field(default_factory=list)
    identityKeys: list[str] = Field(default_factory=list)

    # Soft-Deletion & Tombstoning
    isDeleted: bool = False
    deletedAt: str | None = None
    deletedByReason: str | None = None
    archivedAsDuplicateOf: str | None = None

    # Ambiguity Protection
    isAmbiguousMatch: bool = False
    ambiguityReason: str | None = None

    discoveredAt: str = Field(default_factory=lambda: datetime.now(UTC).isoformat())
    lastCheckedAt: str | None = None

    @model_validator(mode="before")
    @classmethod
    def _validate_legacy_and_channels(cls, data: Any) -> Any:
        if isinstance(data, dict):
            # 1. Backfill linkedinUrl from sourceUrls if missing
            if not data.get("linkedinUrl"):
                source_urls = data.get("sourceUrls") or []
                for url in source_urls:
                    if isinstance(url, str) and ("linkedin.com/in/" in url or "linkedin.com/pub/" in url):
                        data["linkedinUrl"] = url
                        break

            # 2. Derive companyKey if missing
            if not data.get("companyKey"):
                from app.utils.contact_identity import normalize_company_key
                data["companyKey"] = normalize_company_key(data.get("companyName") or "")

            # 3. Maintain associatedOpportunityIds
            opp_id = data.get("opportunityId")
            associated = data.get("associatedOpportunityIds")
            if associated is None:
                associated = [opp_id] if opp_id else []
                data["associatedOpportunityIds"] = associated
            elif opp_id and opp_id not in associated:
                associated.append(opp_id)
                data["associatedOpportunityIds"] = associated

            # 4. Generate identityKeys if missing
            if not data.get("identityKeys"):
                from app.utils.contact_identity import generate_candidate_identity_keys
                data["identityKeys"] = generate_candidate_identity_keys(
                    company_name=data.get("companyName") or "",
                    full_name=data.get("fullName") or "",
                    role_title=data.get("roleTitle"),
                    linkedin_url=data.get("linkedinUrl"),
                    email=data.get("email"),
                )

            # 5. Derive honest contactabilityStatus if missing from legacy records
            if "contactabilityStatus" not in data or data["contactabilityStatus"] is None:
                email = data.get("email")
                has_linkedin = bool(data.get("linkedinUrl"))
                has_github = bool(data.get("githubUrl"))
                has_portfolio = bool(data.get("portfolioUrl"))
                channels_count = sum([has_linkedin, has_github, has_portfolio])

                if email:
                    email_lower = str(email).lower()
                    generic_prefixes = (
                        "hr@",
                        "careers@",
                        "recruiting@",
                        "jobs@",
                        "talent@",
                        "info@",
                        "contact@",
                        "accommodations@",
                    )
                    if any(email_lower.startswith(prefix) for prefix in generic_prefixes):
                        data["contactabilityStatus"] = "GENERIC_INBOX_FOUND"
                        if "contactType" not in data or data["contactType"] is None:
                            data["contactType"] = "ORGANIZATION_CHANNEL"
                        if "channelPurpose" not in data or data["channelPurpose"] is None:
                            data["channelPurpose"] = (
                                "HR_SHARED_INBOX" if "hr@" in email_lower else "GENERAL_CAREERS_INBOX"
                            )
                    elif channels_count > 0:
                        data["contactabilityStatus"] = "MULTIPLE_PUBLIC_CHANNELS_FOUND"
                    else:
                        data["contactabilityStatus"] = "DIRECT_EMAIL_FOUND"
                elif channels_count >= 2:
                    data["contactabilityStatus"] = "MULTIPLE_PUBLIC_CHANNELS_FOUND"
                elif has_linkedin or has_github or has_portfolio:
                    data["contactabilityStatus"] = "PROFILE_ONLY"
                else:
                    data["contactabilityStatus"] = "INSUFFICIENT_EVIDENCE"

            # 6. Defaults for missing legacy fields
            if "contactType" not in data or data["contactType"] is None:
                data["contactType"] = "INDIVIDUAL"
            if "channelPurpose" not in data or data["channelPurpose"] is None:
                data["channelPurpose"] = "INDIVIDUAL_REPRESENTATIVE"
            if "roleEvidenceStatus" not in data or data["roleEvidenceStatus"] is None:
                data["roleEvidenceStatus"] = "LIKELY_CURRENT"
        return data


class ContactDiscoveryResponse(BaseModel):
    """API response model for contact discovery."""

    opportunityId: str
    companyName: str
    contacts: list[DiscoveredContact]
    searchLinks: list[ContactSearchLink]
    providerUsed: str
    costPolicyEnforced: str = "FREE_ONLY"
    message: str

    # Honest Discovery Telemetry Metrics
    totalExamined: int = 0
    newDiscovered: int = 0
    existingRefreshed: int = 0
    tombstonesSuppressed: int = 0
    attemptedAngles: list[str] = Field(default_factory=list)
    cached: bool = False


class DiscoverContactsRequest(BaseModel):
    """Request payload to trigger contact discovery."""

    forceRefresh: bool = False


class ContactDismissRequest(BaseModel):
    """Request payload to dismiss/restore a contact."""

    isDismissed: bool = True


class ContactReviewRequest(BaseModel):
    """Request payload to toggle reviewed status."""

    isReviewed: bool = True
