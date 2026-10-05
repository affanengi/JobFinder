"""Unified Application Artifacts schemas for multi-document generation."""

from typing import Literal
from pydantic import BaseModel, Field

from app.schemas.cover_letter import CoverLetterContent, CoverLetterTone, TailoredCoverLetterDTO
from app.schemas.resume import StructuredResumeContent, TailoredResumeDTO

GenerationMode = Literal["both", "resume", "cover_letter"]


class UnifiedApplicationArtifacts(BaseModel):
    """Pydantic model passed to Gemini structured output to generate both documents in a single request."""

    resume: StructuredResumeContent
    cover_letter: CoverLetterContent


class GenerateArtifactsRequest(BaseModel):
    """Request model for generating application documents."""

    jobId: str
    mode: GenerationMode = "both"
    coverLetterTone: CoverLetterTone = "professional"
    customInstructions: str | None = None
    forceRegenerate: bool = False


class GenerateArtifactsResponse(BaseModel):
    """Response containing generated or cached application documents."""

    mode: GenerationMode
    resume: TailoredResumeDTO | None = None
    coverLetter: TailoredCoverLetterDTO | None = None
    fromCache: bool = False
