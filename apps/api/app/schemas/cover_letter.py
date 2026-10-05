"""Cover Letter schemas adhering to SCHEMA.md."""

from typing import Literal
from pydantic import BaseModel, Field


CoverLetterTone = Literal["professional", "enthusiastic", "technical", "concise"]


class CoverLetterContent(BaseModel):
    """Structured ATS-compliant cover letter body strictly grounded in Master Profile facts."""

    recipientName: str = Field(default="Hiring Team", description="Target recipient or hiring committee name")
    companyName: str = Field(..., description="Target company name")
    jobTitle: str = Field(..., description="Target job title")
    date: str = Field(..., description="Date of application (e.g. September 4, 2026)")
    greeting: str = Field(default="Dear Hiring Team,", description="Formal salutation")
    subject: str | None = Field(default=None, description="Formal application subject line")
    paragraph1_hook: str = Field(
        ...,
        description="Introduction hook expressing role interest, referencing company mission, and summarizing candidate core background.",
    )
    paragraph2_evidence: str = Field(
        ...,
        description="Core body paragraph citing verified technical projects, achievements, and concrete skills solving the job requirements.",
    )
    paragraph3_impact: str = Field(
        ...,
        description="Concluding paragraph highlighting transferable value, culture alignment, enthusiasm, and forward-looking call to action.",
    )
    signOff: str = Field(default="Sincerely,", description="Formal sign-off")
    fullName: str = Field(..., description="Candidate full name")
    email: str = Field(..., description="Candidate email")
    phone: str | None = Field(default=None, description="Candidate contact phone number")
    city: str | None = Field(default=None, description="Candidate city location")
    country: str | None = Field(default="India", description="Candidate country location")
    linkedin: str | None = Field(default=None, description="Candidate LinkedIn profile URL")
    github: str | None = Field(default=None, description="Candidate GitHub profile URL")
    portfolio: str | None = Field(default=None, description="Candidate portfolio or website URL")
    sourceFactIds: list[str] = Field(
        default_factory=list,
        description="List of verified Master Profile fact IDs used to compose this letter.",
    )


class CoverLetterValidationResult(BaseModel):
    """Deterministic validation result for generated cover letters."""

    is_valid: bool = True
    violations: list[str] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)


class TailoredCoverLetterDTO(BaseModel):
    """Full tailored cover letter entity persisted in Firestore."""

    id: str
    userId: str
    jobId: str
    tone: CoverLetterTone = "professional"
    content: CoverLetterContent
    markdownText: str
    pdfUrl: str | None = None
    validationResult: CoverLetterValidationResult = Field(default_factory=CoverLetterValidationResult)
    createdAt: str
    updatedAt: str


class UpdateCoverLetterRequest(BaseModel):
    """Request model for manual cover letter edits (Zero AI calls)."""

    content: CoverLetterContent
    tone: CoverLetterTone = "professional"
