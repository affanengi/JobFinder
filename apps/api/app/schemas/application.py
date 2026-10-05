"""Pydantic schemas and lifecycle contracts for Application Tracker & Pipeline Management."""

from datetime import datetime, timezone
from enum import Enum
from typing import Literal
from uuid import uuid4
from pydantic import BaseModel, Field, model_validator


class ApplicationStage(str, Enum):
    SAVED = "saved"
    READY = "ready"
    APPLIED = "applied"
    INTERVIEWING = "interviewing"
    OFFER = "offer"
    REJECTED = "rejected"
    ARCHIVED = "archived"


class EventSource(str, Enum):
    CANDIDATE = "candidate"
    EMPLOYER = "employer"
    SYSTEM_SYNC = "system_sync"


class OfferOutcome(str, Enum):
    ACCEPTED = "accepted"
    DECLINED = "declined"
    EXPIRED = "expired"
    PENDING = "pending"


class StageTransitionEvent(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid4()))
    fromStage: ApplicationStage | None = None
    toStage: ApplicationStage
    eventName: str  # e.g. "APPLICATION_CREATED", "READY_APPROVED", "APPLICATION_SUBMITTED"
    authorizedActor: str = "candidate"  # Always candidate in jobFinder
    eventSource: EventSource = EventSource.CANDIDATE  # Catalyst source
    timestamp: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    note: str | None = None


class ResumeArtifactSnapshot(BaseModel):
    resumeId: str
    version: int = 1
    jobId: str
    targetRole: str
    skillsUsed: list[str] = Field(default_factory=list)
    bulletCount: int = 0
    pdfRenderHash: str | None = None
    approvedAt: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


class CoverLetterSnapshot(BaseModel):
    coverLetterId: str
    approvedAt: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


class AtsScoreSnapshot(BaseModel):
    overallScore: int  # 0-100
    evaluatedAt: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    scannerVersion: str = "v1.0-independent"
    breakdown: dict[str, int] = Field(default_factory=dict)


class InterviewRoundEvent(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid4()))
    round: str  # e.g. "Recruiter Screen", "Technical Round 1"
    scheduledAt: str | None = None  # ISO date/time
    interviewer: str | None = None
    meetingLink: str | None = None
    feedback: str | None = None
    notes: str | None = None



class QuestionCategory(str, Enum):
    TECHNICAL_CHALLENGE = "technical_challenge"
    LEADERSHIP_TEAMWORK = "leadership_teamwork"
    WHY_COMPANY = "why_company"
    WHY_ROLE = "why_role"
    TECHNICAL_EXPERIENCE = "technical_experience"
    STRENGTHS = "strengths"
    FAILURE_LEARNING = "failure_learning"
    COMPENSATION = "compensation"
    AVAILABILITY = "availability"
    CUSTOM = "custom"


class QuestionConstraintsDTO(BaseModel):
    targetWordCount: int | None = Field(default=None, ge=10, le=1000)
    maxCharacters: int | None = Field(default=None, ge=30, le=5000)
    tone: Literal["concise", "technical", "enthusiastic", "leadership"] = "concise"


class QuestionInputDTO(BaseModel):
    questionId: str = Field(..., description="Stable session or form field identifier (e.g. q_001)")
    questionText: str = Field(..., min_length=3, max_length=1500)
    category: QuestionCategory | None = None
    constraints: QuestionConstraintsDTO = Field(default_factory=QuestionConstraintsDTO)


class BatchGenerateRequest(BaseModel):
    questions: list[QuestionInputDTO] = Field(..., min_length=1, max_length=15)
    sessionId: str | None = Field(None, description="Optional active Playwright autofill session ID")
    includeJobContext: bool = True
    optionalJobDescription: str | None = None
    optionalCompany: str | None = None
    optionalJobTitle: str | None = None


class QuestionAnswerResultDTO(BaseModel):
    questionId: str
    status: Literal["VERIFIED", "REQUIRES_REVIEW", "MISSING_REQUIRED_FACTS", "REJECTED"]
    answer: str | None = None
    isDeterministic: bool = False
    groundedFactIds: list[str] = Field(default_factory=list)
    missingFacts: list[str] = Field(default_factory=list)
    violations: list[str] = Field(default_factory=list)
    characterCount: int = 0
    wordCount: int = 0


class BatchGenerateResponse(BaseModel):
    answers: list[QuestionAnswerResultDTO]
    modelUsed: str
    generatedAt: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


class CustomQuestionAnswerDTO(BaseModel):
    qaId: str = Field(default_factory=lambda: str(uuid4()))
    questionId: str
    questionText: str
    category: QuestionCategory
    constraints: QuestionConstraintsDTO
    generatedAnswer: str
    currentAnswer: str
    userEdited: bool = False
    status: Literal["VERIFIED", "REQUIRES_REVIEW", "MISSING_REQUIRED_FACTS", "REJECTED"]
    groundedFactIds: list[str] = Field(default_factory=list)
    missingFactsDetected: list[str] = Field(default_factory=list)
    characterCount: int
    wordCount: int
    profileVersion: int
    jobContextUsed: bool = False
    modelUsed: str
    createdAt: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    updatedAt: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


class UpdateQuestionAnswerRequest(BaseModel):
    answerText: str = Field(..., min_length=1, max_length=10000)


class ApplicationRecordDTO(BaseModel):
    id: str  # "app_{userId}_{jobId}" or "app_{userId}_{uuid}"
    userId: str
    jobId: str | None = None
    isExternal: bool = False

    # Historical Opportunity Snapshot (immutable once created)
    company: str
    jobTitle: str
    location: str = "Remote"
    portalUrl: str | None = None
    salarySnippet: str | None = None

    # Lifecycle State
    status: ApplicationStage = ApplicationStage.SAVED
    stageTimestamps: dict[str, str] = Field(default_factory=dict)
    appliedAt: str | None = None
    offerOutcome: OfferOutcome | None = None

    # Immutable Artifact & Evaluation Snapshots
    tailoredResumeId: str | None = None
    resumeSnapshot: ResumeArtifactSnapshot | None = None
    coverLetterSnapshot: CoverLetterSnapshot | None = None
    atsScoreSnapshot: AtsScoreSnapshot | None = None

    # Candidate Workspace
    notes: str = ""
    interviewEvents: list[InterviewRoundEvent] = Field(default_factory=list)
    history: list[StageTransitionEvent] = Field(default_factory=list)
    customQuestions: list[CustomQuestionAnswerDTO] = Field(default_factory=list)

    createdAt: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    updatedAt: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


# Request Models
class CreateApplicationRequest(BaseModel):
    jobId: str | None = None
    isExternal: bool = False
    company: str
    jobTitle: str
    location: str = "Remote"
    portalUrl: str | None = None
    salarySnippet: str | None = None
    initialStatus: ApplicationStage = ApplicationStage.SAVED
    appliedDate: str | None = None  # Required if initialStatus == "applied"
    notes: str = ""


class UpdateApplicationStatusRequest(BaseModel):
    newStatus: ApplicationStage
    expectedStatus: ApplicationStage | None = None  # For concurrency check
    note: str | None = None
    eventSource: EventSource = EventSource.CANDIDATE
    offerOutcome: OfferOutcome | None = None
    appliedDate: str | None = None


class ApprovePackageRequest(BaseModel):
    jobId: str
    tailoredResumeId: str | None = None
    resumeId: str | None = None
    coverLetterId: str | None = None
    note: str | None = None

    @model_validator(mode="after")
    def validate_and_normalize_resume_id(self):
        if self.tailoredResumeId and self.resumeId:
            if self.tailoredResumeId != self.resumeId:
                raise ValueError("Contradictory resumeId and tailoredResumeId values provided.")
        elif self.resumeId and not self.tailoredResumeId:
            self.tailoredResumeId = self.resumeId

        if not self.tailoredResumeId:
            raise ValueError("Either tailoredResumeId or resumeId is required.")
        return self


class UpdateApplicationNotesRequest(BaseModel):
    notes: str


class AddInterviewRoundRequest(BaseModel):
    round: str
    scheduledAt: str | None = None
    interviewer: str | None = None
    meetingLink: str | None = None
    notes: str | None = None
