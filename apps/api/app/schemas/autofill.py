import uuid
"""Pydantic models and lifecycle schemas for Phase 2 Deterministic Playwright Form Autofill."""

from datetime import datetime, timezone
from enum import Enum
from typing import Literal, Any
from pydantic import BaseModel, Field


class AutofillStatusEnum(str, Enum):
    """Lifecycle states for desktop browser autofill sessions."""
    CREATING = "CREATING"
    BROWSER_LAUNCHED = "BROWSER_LAUNCHED"
    PORTAL_LOADING = "PORTAL_LOADING"
    AUTHENTICATION_REQUIRED = "AUTHENTICATION_REQUIRED"
    DETECTING_APPLICATION_STATE = "DETECTING_APPLICATION_STATE"
    APPLY_CTA_AVAILABLE = "APPLY_CTA_AVAILABLE"
    APPLY_ACTION_IN_PROGRESS = "APPLY_ACTION_IN_PROGRESS"
    FORM_LOADING = "FORM_LOADING"
    FORM_READY = "FORM_READY"
    FILLING = "FILLING"
    MULTI_STEP_FORM = "MULTI_STEP_FORM"
    HUMAN_REVIEW_REQUIRED = "HUMAN_REVIEW_REQUIRED"
    READY_FOR_SUBMISSION = "READY_FOR_SUBMISSION"
    FORM_NOT_FOUND = "FORM_NOT_FOUND"
    APPLY_CTA_AMBIGUOUS = "APPLY_CTA_AMBIGUOUS"
    CROSS_ORIGIN_FRAME_BLOCKED = "CROSS_ORIGIN_FRAME_BLOCKED"
    CANCELLED = "CANCELLED"
    BROWSER_CLOSED = "BROWSER_CLOSED"
    EXPIRED = "EXPIRED"
    FAILED = "FAILED"
    COMPLETED = "COMPLETED"


class FieldSafetyCategory(str, Enum):
    """Safety classification for detected portal form inputs."""
    SAFE_AUTOFILL = "SAFE_AUTOFILL"
    RESUME_UPLOAD = "RESUME_UPLOAD"
    COVER_LETTER = "COVER_LETTER"
    UNKNOWN = "UNKNOWN"
    SENSITIVE = "SENSITIVE"
    LEGAL_OR_IMMIGRATION = "LEGAL_OR_IMMIGRATION"
    DEMOGRAPHIC = "DEMOGRAPHIC"
    CUSTOM_QUESTION = "CUSTOM_QUESTION"
    CAPTCHA = "CAPTCHA"
    MFA_OR_LOGIN = "MFA_OR_LOGIN"
    SUBMISSION_CONTROL = "SUBMISSION_CONTROL"


class DetectedFormFieldDTO(BaseModel):
    questionId: str = Field(..., description="Stable question session identifier (e.g. q_001)")
    selector: str = Field(..., description="Resilient selector descriptor")
    tag: str = "textarea"
    label: str
    category: str = "custom"
    maxLength: int | None = None
    currentValue: str = ""
    frameSelector: str | None = None


class AutofillEventDTO(BaseModel):
    """Live Server-Sent Event payload emitted to UI modal."""
    eventId: str = Field(default_factory=lambda: str(uuid.uuid4()))
    sessionId: str
    status: AutofillStatusEnum
    atsType: str
    step: str
    eventType: str = "INFO"
    message: str
    fieldsFilled: list[str] = Field(default_factory=list)
    fieldsSkipped: list[str] = Field(default_factory=list)
    fieldsRequiringReview: list[str] = Field(default_factory=list)
    detectedCustomQuestions: list[DetectedFormFieldDTO] = Field(default_factory=list)
    resumeAttached: bool = False
    captchaDetected: bool = False
    diagnostics: dict[str, Any] | None = None
    timestamp: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


class AutofillSessionDTO(BaseModel):
    """Authoritative in-memory session snapshot."""
    sessionId: str
    userId: str
    applicationId: str
    portalUrl: str
    atsType: str = "generic"
    status: AutofillStatusEnum = AutofillStatusEnum.CREATING
    createdAt: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    lastActivityAt: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    fieldsFilled: list[str] = Field(default_factory=list)
    fieldsSkipped: list[str] = Field(default_factory=list)
    fieldsRequiringReview: list[str] = Field(default_factory=list)
    detectedCustomQuestions: list[DetectedFormFieldDTO] = Field(default_factory=list)
    resumeAttached: bool = False
    captchaDetected: bool = False
    diagnostics: dict[str, Any] | None = None
    failureReason: str | None = None


class AutofillStartResponse(BaseModel):
    """Response returned when an autofill session is launched."""
    sessionId: str
    applicationId: str
    portalUrl: str
    atsType: str
    status: AutofillStatusEnum
    message: str


class ConfirmSubmissionRequest(BaseModel):
    """Request payload sent when candidate confirms manual external submission."""
    sessionId: str
    notes: str | None = "Submitted manually on portal"




class BatchFillAnswerDTO(BaseModel):
    questionId: str
    answerText: str


class BatchFillRequest(BaseModel):
    sessionId: str
    answers: list[BatchFillAnswerDTO]


class BatchFillResponse(BaseModel):
    sessionId: str
    filledCount: int
    failedQuestions: list[str] = Field(default_factory=list)
