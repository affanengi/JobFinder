"""Job Analysis, Traceable Profile Matching, and Application Snapshot Schemas.

Adheres strictly to Phase 2 Truth-Locked requirements:
- ApplicationProfileSnapshot is a derived read-only view with canonical fact references.
- ATS Evidence Audit strictly separates ATS Compatibility Score from Truth Integrity.
"""

from datetime import UTC, datetime
from typing import Literal

from pydantic import BaseModel, Field

JobRequirementType = Literal[
    "skill_technical",
    "skill_soft",
    "responsibility",
    "qualification_experience",
    "qualification_education",
    "domain_context",
]

RequirementImportance = Literal["critical", "high", "medium", "low"]
RequirementCategory = Literal["required", "preferred"]
MatchLevel = Literal["strong", "transferable", "weak", "missing"]


class JobRequirementItem(BaseModel):
    """An individual atomic job requirement extracted from the JD."""

    id: str = Field(description="Unique requirement ID (e.g., req-1)")
    type: JobRequirementType = Field(default="skill_technical")
    text: str = Field(description="Specific requirement text")
    category: RequirementCategory = Field(default="required")
    keywords: list[str] = Field(default_factory=list)
    importance: RequirementImportance = Field(default="high")
    contextSnippet: str | None = None


class JobAnalysisResult(BaseModel):
    """Authoritative semantic analysis of a target job description."""

    id: str
    jobId: str
    jobTitle: str
    company: str
    roleCategory: str = Field(
        default="software_engineering",
        description="Broad category e.g. software_engineering, data_analytics, qa_testing, privacy_security, product_operations, general_technical",
    )
    roleFocus: str = Field(
        default="",
        description="Specific technical and evidence priorities for this specific JD",
    )
    summary: str = Field(description="2-3 sentence executive synopsis of what the role requires")
    requirements: list[JobRequirementItem] = Field(default_factory=list)
    requiredSkills: list[str] = Field(default_factory=list)
    preferredSkills: list[str] = Field(default_factory=list)
    responsibilities: list[str] = Field(default_factory=list)
    qualifications: list[str] = Field(default_factory=list)
    keywords: list[str] = Field(default_factory=list)
    softSkills: list[str] = Field(default_factory=list)
    domainContext: list[str] = Field(default_factory=list)
    analyzedAt: str = Field(default_factory=lambda: datetime.now(UTC).isoformat())
    modelUsed: str | None = None
    confidence: Literal["high", "medium", "low"] = "high"
    source: Literal["ai_structured", "deterministic_fallback"] = "ai_structured"


class RequirementMatchEvidence(BaseModel):
    """Traceable evidence linking a specific job requirement to verified profile facts."""

    requirementId: str
    requirementText: str
    requirementType: str
    matchLevel: MatchLevel
    verifiedFactIds: list[str] = Field(default_factory=list)
    matchedTerms: list[str] = Field(default_factory=list)
    candidateEvidence: str = Field(
        description="Specific verified fact summary (e.g. 'Lodestar -> Fastify API & session grouping')"
    )
    rationale: str = Field(
        description="Explainable reasoning distinguishing direct match vs transferable adjacent capability"
    )


class ProfileJobMatchResult(BaseModel):
    """Deterministic comparison of canonical verified profile facts against job requirements."""

    jobId: str
    userId: str
    roleCategory: str
    overallScore: float = Field(ge=0.0, le=100.0)
    matches: list[RequirementMatchEvidence] = Field(default_factory=list)
    strongMatches: list[RequirementMatchEvidence] = Field(default_factory=list)
    transferableMatches: list[RequirementMatchEvidence] = Field(default_factory=list)
    weakMatches: list[RequirementMatchEvidence] = Field(default_factory=list)
    missingRequirements: list[RequirementMatchEvidence] = Field(default_factory=list)
    recommendedRoleFocus: str = ""
    recommendedSkillPriorities: list[str] = Field(default_factory=list)
    recommendedProjectIds: list[str] = Field(default_factory=list)
    recommendedCourseIds: list[str] = Field(default_factory=list)
    matchedAt: str = Field(default_factory=lambda: datetime.now(UTC).isoformat())


class ApplicationProfileSnapshot(BaseModel):
    """Derived, read-only application view pointing back to canonical profile facts.

    Never mutates or duplicates candidate truth.
    """

    id: str
    userId: str
    jobId: str
    sourceProfileVersion: int | None = None
    roleCategory: str
    selectedFactIds: list[str] = Field(default_factory=list)
    selectedProjectIds: list[str] = Field(default_factory=list)
    selectedCourseIds: list[str] = Field(default_factory=list)
    prioritizedSkillNames: list[str] = Field(default_factory=list)
    matchEvidence: list[RequirementMatchEvidence] = Field(default_factory=list)
    createdAt: str = Field(default_factory=lambda: datetime.now(UTC).isoformat())
    isStale: bool = False


# --- ATS Evidence Audit Models (Pillars & Separation of Truth from ATS Score) ---

AtsEvidenceStatus = Literal[
    "KEYWORD_MATCH",
    "EVIDENCE_MATCH",
    "OMITTED_OPPORTUNITY",
    "UNSUPPORTED_KEYWORD",
    "MISSING_REQUIREMENT",
]


class AtsEvidenceItem(BaseModel):
    """Evaluation of an individual terminology/competency item across Resume, Job, and Profile."""

    keyword: str
    status: AtsEvidenceStatus
    inResume: bool
    inJob: bool
    isVerifiedInProfile: bool
    verifiedFactIds: list[str] = Field(default_factory=list)
    category: str = "technical"
    details: str = ""


class AtsEvidenceAuditReport(BaseModel):
    """Comprehensive ATS audit distinguishing keyword match rate from Truth Integrity."""

    resumeId: str | None = None
    jobId: str
    atsScore: int = Field(ge=0, le=100)
    truthIntegrityStatus: Literal["VERIFIED", "VIOLATIONS_DETECTED"]
    items: list[AtsEvidenceItem] = Field(default_factory=list)
    keywordMatches: list[str] = Field(default_factory=list)
    evidenceMatches: list[str] = Field(default_factory=list)
    omittedOpportunities: list[str] = Field(default_factory=list)
    unsupportedKeywords: list[str] = Field(default_factory=list)
    missingRequirements: list[str] = Field(default_factory=list)
    summary: str = ""
    auditedAt: str = Field(default_factory=lambda: datetime.now(UTC).isoformat())
