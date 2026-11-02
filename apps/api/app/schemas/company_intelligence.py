"""Schemas for Company Intelligence and Scam Shield Engine."""

from datetime import UTC, datetime
from typing import Literal
from pydantic import BaseModel, Field

CompanyRiskTier = Literal[
    "NO_OBVIOUS_RED_FLAGS_FOUND",
    "NEEDS_VERIFICATION",
    "SIGNIFICANT_RED_FLAGS",
    "INSUFFICIENT_EVIDENCE",
]

DimensionStatus = Literal["PASS", "WARN", "FAIL", "INSUFFICIENT_EVIDENCE"]


class EvaluatedDimensionItem(BaseModel):
    """Specific signal assessment within the multi-dimensional legitimacy framework."""

    status: DimensionStatus
    evidence: str
    confidence: float = Field(default=1.0, ge=0.0, le=1.0)


class CompanyScamAssessmentOutput(BaseModel):
    """Structured Pydantic output requested from Gemini Flash via AI Hub."""

    riskTier: CompanyRiskTier
    overview: str | None = Field(
        default=None,
        description="Informative corporate overview describing what the company does, its core products, and business category grounded strictly in public evidence.",
    )
    summary: str
    officialDomain: str | None = None
    domainConsistency: EvaluatedDimensionItem
    paymentSolicitations: EvaluatedDimensionItem
    communicationChannels: EvaluatedDimensionItem
    publicScamReports: EvaluatedDimensionItem
    requisitionConsistency: EvaluatedDimensionItem
    redFlags: list[str] = Field(default_factory=list)
    positiveSignals: list[str] = Field(default_factory=list)
    productsAndServices: list[str] = Field(
        default_factory=list,
        description="Key products, platforms, or services developed by the company (from public evidence).",
    )
    industry: str | None = Field(
        default=None,
        description="Primary industry or business category (e.g. Cloud Infrastructure, Developer Tools).",
    )
    companySize: str | None = Field(
        default=None,
        description="Reported employee count/range if verified in evidence, otherwise None.",
    )
    headquarters: str | None = Field(
        default=None,
        description="Headquarters city/country if verified in evidence, otherwise None.",
    )
    evidenceStatus: str = Field(
        default="SUFFICIENT",
        description="Status of public corporate evidence, e.g. 'SUFFICIENT' or 'INSUFFICIENT_EVIDENCE'.",
    )


class BatchCompanyScamItem(BaseModel):
    """Assessment for a single company within the single-request batch response."""

    companyKey: str = Field(description="Normalized lowercase company slug, e.g. 'cloudflare'")
    companyName: str = Field(description="Official corporate name")
    officialDomain: str | None = Field(default=None, description="Verified corporate domain")
    riskTier: CompanyRiskTier
    overview: str | None = Field(
        default=None,
        description="Informative corporate overview describing what the company does, its core products, and business category based strictly on public evidence.",
    )
    summary: str = Field(description="Scam Shield executive verdict on hiring legitimacy.")
    domainConsistency: EvaluatedDimensionItem
    paymentSolicitations: EvaluatedDimensionItem
    communicationChannels: EvaluatedDimensionItem
    publicScamReports: EvaluatedDimensionItem
    requisitionConsistency: EvaluatedDimensionItem
    redFlags: list[str] = Field(default_factory=list)
    positiveSignals: list[str] = Field(default_factory=list)
    productsAndServices: list[str] = Field(
        default_factory=list,
        description="Key products, platforms, or services developed by the company.",
    )
    industry: str | None = Field(
        default=None,
        description="Primary industry or business category.",
    )
    companySize: str | None = Field(
        default=None,
        description="Reported employee count/range if verified in evidence, otherwise None.",
    )
    headquarters: str | None = Field(
        default=None,
        description="Headquarters city/country if verified in evidence, otherwise None.",
    )
    evidenceStatus: str = Field(
        default="SUFFICIENT",
        description="Status of public corporate evidence, e.g. 'SUFFICIENT' or 'INSUFFICIENT_EVIDENCE'.",
    )


class BulkCompanyIntelligenceOutput(BaseModel):
    """Root Pydantic schema for single-request Gemini multi-company output."""

    companies: list[BatchCompanyScamItem] = Field(
        default_factory=list,
        description="List of evaluated companies matching the requested company keys exactly.",
    )


class CompanyIntelligenceResult(BaseModel):
    """Authoritative persistent record of company & vacancy legitimacy research."""

    id: str
    userId: str
    opportunityId: str
    companyName: str
    officialDomain: str | None = None
    careersUrl: str
    riskTier: CompanyRiskTier
    overview: str | None = None
    summary: str
    evaluatedDimensions: dict[str, EvaluatedDimensionItem]
    redFlags: list[str] = Field(default_factory=list)
    positiveSignals: list[str] = Field(default_factory=list)
    sourceUrls: list[str] = Field(default_factory=list)
    researchedAt: str = Field(default_factory=lambda: datetime.now(UTC).isoformat())
    ttlExpiresAt: str
    disclaimer: str = (
        "Absence of detected red flags does not constitute a legal guarantee of employer legitimacy, "
        "and absence of public evidence does not establish suspicion. "
        "Always verify offers independently before sharing sensitive personal data or financial information."
    )
    rawContentSnippet: str | None = None
    productsAndServices: list[str] = Field(default_factory=list)
    industry: str | None = None
    companySize: str | None = None
    headquarters: str | None = None
    evidenceStatus: str = "SUFFICIENT"


class ResearchOpportunityRequest(BaseModel):
    """Optional payload when requesting research for an opportunity."""

    forceRefresh: bool = False

