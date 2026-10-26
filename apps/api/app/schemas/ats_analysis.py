"""Pydantic schemas for AI-First Contextual ATS Analysis.

Defines type-safe, validated structured output contracts for contextual fit evaluation,
requirement mapping, section findings, keyword coverage, and grounded rewrite proposals.
"""

from enum import StrEnum
from typing import Literal
from pydantic import BaseModel, ConfigDict, Field


class RequirementCriticality(StrEnum):
    """Criticality level of a job requirement."""
    MANDATORY = "mandatory"
    PREFERRED = "preferred"
    BONUS = "bonus"


class RequirementMatchStatus(StrEnum):
    """Evaluation status of a job requirement against candidate evidence."""
    MEETS = "MEETS"
    PARTIAL = "PARTIAL"
    MISSING = "MISSING"


class KeywordCoverageStatus(StrEnum):
    """Contextual coverage status of target keywords in the resume."""
    PRESENT_AND_RELEVANT = "present_and_relevant"
    PRESENT_WEAK = "present_weak"
    NOT_FOUND = "not_found"


class SectionName(StrEnum):
    """Standard recognized resume section categories."""
    SUMMARY = "summary"
    EXPERIENCE = "experience"
    PROJECTS = "projects"
    SKILLS = "skills"
    EDUCATION = "education"
    CERTIFICATIONS = "certifications"
    OTHER = "other"


class RewriteValidationStatus(StrEnum):
    """Grounding status for proposed resume bullet rewrites."""
    GROUNDED = "grounded"
    UNVERIFIED = "unverified"
    PENDING_REVIEW = "pending_review"


class JobRequirementAnalysisItem(BaseModel):
    """Structured evaluation of a single job requirement against candidate resume."""
    model_config = ConfigDict(extra="ignore")

    requirement_description: str = Field(
        ...,
        description="Faithful summary of the requirement from the job description.",
        min_length=3,
        max_length=500,
    )
    criticality: RequirementCriticality = Field(
        default=RequirementCriticality.MANDATORY,
        description="Whether the requirement is mandatory, preferred, or bonus.",
    )
    match_status: RequirementMatchStatus = Field(
        ...,
        description="MEETS (strong evidence), PARTIAL (weak or adjacent evidence), or MISSING (no resume evidence).",
    )
    supporting_evidence: list[str] = Field(
        default_factory=list,
        description="Direct quotes or concise references from the resume demonstrating this requirement.",
    )
    explanation: str = Field(
        ...,
        description="Concise justification of the match status distinguishing lack of resume evidence from candidate inability.",
        max_length=1000,
    )
    missing_evidence: bool = Field(
        default=False,
        description="True if the match status is based on missing resume evidence rather than verified disqualification.",
    )


class ResumeSectionAnalysisItem(BaseModel):
    """Structured assessment of a specific resume section present in the candidate submission."""
    model_config = ConfigDict(extra="ignore")

    section_name: str = Field(
        ...,
        description="Section name (e.g. summary, experience, projects, skills, education, certifications).",
        min_length=2,
        max_length=100,
    )
    findings: list[str] = Field(
        default_factory=list,
        description="Key factual strengths and substantive observations regarding this section.",
    )
    supporting_evidence: list[str] = Field(
        default_factory=list,
        description="Cited bullet points or excerpts from this section.",
    )
    gaps: list[str] = Field(
        default_factory=list,
        description="Presentation or evidence deficiencies identified within this section.",
    )
    recommendations: list[str] = Field(
        default_factory=list,
        description="Actionable improvements grounded in the candidate's existing background.",
    )


class ContextualKeywordItem(BaseModel):
    """Contextual analysis of an important job-description skill or keyword."""
    model_config = ConfigDict(extra="ignore")

    keyword: str = Field(
        ...,
        description="Job-description keyword or technical competency.",
        min_length=1,
        max_length=100,
    )
    status: KeywordCoverageStatus = Field(
        ...,
        description="present_and_relevant, present_weak, or not_found.",
    )
    explanation: str = Field(
        ...,
        description="Contextual explanation of how the keyword is used or why it is weakly demonstrated.",
        max_length=500,
    )
    supporting_evidence: str | None = Field(
        default=None,
        description="Quoted excerpt from resume where the keyword appears in context.",
        max_length=500,
    )


class GroundedRewriteProposalItem(BaseModel):
    """Proposal for rewriting a resume bullet to improve clarity, impact, and job alignment without fabrication."""
    model_config = ConfigDict(extra="ignore")

    original_text: str = Field(
        ...,
        description="Original text from the candidate's submitted resume.",
        min_length=5,
        max_length=1000,
    )
    proposed_text: str = Field(
        ...,
        description="Enhanced proposal strictly preserving the scope, truth, and facts of the original evidence.",
        min_length=5,
        max_length=1000,
    )
    explanation: str = Field(
        ...,
        description="Why the revision improves presentation, action verbs, or role relevance.",
        max_length=500,
    )
    factual_basis: str = Field(
        ...,
        description="Specific source facts from the original bullet justifying every detail in the proposed rewrite.",
        max_length=500,
    )
    validation_status: RewriteValidationStatus = Field(
        default=RewriteValidationStatus.PENDING_REVIEW,
        description="Grounding validation status (pending user review / validation).",
    )


class AtsAnalysisResult(BaseModel):
    """Complete AI-First Contextual ATS Analysis Result adhering to AI Hub structured generation contracts."""
    model_config = ConfigDict(extra="ignore")

    overall_score: int = Field(
        ...,
        ge=0,
        le=100,
        description="Holistic contextual match score strictly bounded between 0 and 100.",
    )
    overall_explanation: str = Field(
        ...,
        description="Comprehensive role-specific explanation of the candidate's evidence-backed fit.",
        min_length=10,
        max_length=2000,
    )
    executive_summary: str = Field(
        ...,
        description="High-level synthesis of candidate strengths and principal qualification gaps for the target role.",
        min_length=10,
        max_length=2000,
    )
    requirements: list[JobRequirementAnalysisItem] = Field(
        default_factory=list,
        description="Structured evaluation of job requirements.",
    )
    section_analysis: list[ResumeSectionAnalysisItem] = Field(
        default_factory=list,
        description="Section-by-section analysis for sections actually present in the resume.",
    )
    keyword_analysis: list[ContextualKeywordItem] = Field(
        default_factory=list,
        description="Contextual keyword coverage analysis.",
    )
    strengths: list[str] = Field(
        default_factory=list,
        description="Evidence-backed candidate strengths relevant to the job opening.",
    )
    gaps: list[str] = Field(
        default_factory=list,
        description="Concrete gaps between resume evidence and job requirements.",
    )
    recommendations: list[str] = Field(
        default_factory=list,
        description="Actionable recommendations for improving resume presentation without fabricating qualifications.",
    )
    rewrite_proposals: list[GroundedRewriteProposalItem] = Field(
        default_factory=list,
        description="Optional grounded rewrite proposals for weak or unquantified resume bullets.",
    )


# =========================================================================
# PHASE 4: TRUTH-LOCK EVIDENCE VALIDATION CONTRACTS
# =========================================================================

class ValidationStatus(StrEnum):
    """Aggregate or item-level validation outcome status."""
    PASS = "pass"
    FAIL = "fail"
    REVIEW_REQUIRED = "review_required"


class EvidenceViolationSeverity(StrEnum):
    """Severity classification of an evidence integrity violation."""
    BLOCKING = "blocking"
    ADVISORY = "advisory"


class EvidenceAuditFinding(BaseModel):
    """Typed finding produced during deterministic Truth-Lock evidence auditing."""
    model_config = ConfigDict(extra="ignore")

    target_type: Literal["requirement", "rewrite_proposal", "keyword", "section", "general"] = Field(
        ...,
        description="Type of finding or proposal evaluated.",
    )
    target_identifier: str = Field(
        ...,
        description="Description, key, or reference identifier of the item under audit.",
    )
    status: ValidationStatus = Field(
        ...,
        description="Evaluation outcome for this finding (pass, fail, or review_required).",
    )
    severity: EvidenceViolationSeverity = Field(
        default=EvidenceViolationSeverity.ADVISORY,
        description="Whether this issue is blocking acceptance or advisory feedback.",
    )
    evidence_source: Literal["resume", "profile", "job_description", "unknown"] = Field(
        ...,
        description="Permitted source against which the claim or citation was verified.",
    )
    cited_text: str | None = Field(
        default=None,
        description="Quoted text or proposed claim evaluated.",
    )
    reason: str = Field(
        ...,
        description="Deterministic justification for the validation outcome.",
    )
    is_blocking: bool = Field(
        default=False,
        description="Convenience boolean flag for blocking violations.",
    )


class TruthLockAuditReport(BaseModel):
    """Deterministic Truth-Lock Audit Report strictly decoupled from AI score calculation."""
    model_config = ConfigDict(extra="ignore")

    is_valid: bool = Field(
        ...,
        description="True if zero blocking violations were detected.",
    )
    status: ValidationStatus = Field(
        ...,
        description="Overall validation status: pass, fail, or review_required.",
    )
    total_checks: int = Field(default=0, ge=0)
    passed_checks: int = Field(default=0, ge=0)
    blocking_violations_count: int = Field(default=0, ge=0)
    advisory_warnings_count: int = Field(default=0, ge=0)
    findings: list[EvidenceAuditFinding] = Field(default_factory=list)
    original_ai_score: int = Field(
        ...,
        ge=0,
        le=100,
        description="Strictly preserved AI-generated contextual fit score (never modified by auditor).",
    )
    summary: str = Field(
        ...,
        description="Summary of evidence audit outcomes, verified citations, and violations.",
    )
    audited_at: str = Field(
        ...,
        description="ISO 8601 timestamp of evidence audit execution.",
    )


# =========================================================================
# PHASE 5: MODERNIZED SCAN ENDPOINT RESPONSE CONTRACT
# =========================================================================

class ScanProvenanceMetadata(BaseModel):
    """Metadata detailing analysis version, model execution, and tenant safety."""
    model_config = ConfigDict(extra="ignore")

    scoring_version: str = "v2_ai_first"
    operation_id: str | None = Field(
        default=None,
        description="Correlated unique 1-shot operation identifier (e.g. op_7e59a45ea5ff).",
    )
    provider_used: str = "gemini"
    model_used: str = "gemini-3.5-flash-lite"
    credential_id_used: str = "server_gemini_credential"
    latency_ms: float = 0.0
    timestamp: str = ""
    tenant_isolated: bool = True
    truth_lock_passed: bool = True


class AtsScanRequest(BaseModel):
    """Request contract for primary AI-First ATS scan endpoint POST /api/v1/scanner/scan."""
    model_config = ConfigDict(extra="ignore")

    resume_id: str | None = Field(default=None, description="Optional ID of saved tailored resume.")
    raw_resume_text: str | None = Field(default=None, description="Optional raw resume text.", max_length=100000)
    job_id: str | None = Field(default=None, description="Optional target job ID.")
    job_description: str | None = Field(default=None, description="Optional raw job description text.", max_length=100000)
    role_category: str | None = Field(default=None, description="Optional role category hint (e.g. software_engineering, product, sales).")
    save_report: bool = Field(default=False, description="Whether to persist the verified scan report.")
    report_name: str | None = Field(default=None, description="Optional custom name for saved report.")


class AtsScanResponse(BaseModel):
    """Complete response contract for modernized primary scan endpoint POST /api/v1/scanner/scan."""
    model_config = ConfigDict(extra="ignore")

    analysis: AtsAnalysisResult
    audit_report: TruthLockAuditReport
    provenance: ScanProvenanceMetadata
    saved_report_id: str | None = None

