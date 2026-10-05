"""Matching Engine Schemas adhering to SCHEMA.md."""

from typing import Literal

from pydantic import BaseModel, Field

from app.schemas.job import CanonicalJob, CompensationRange, JobCategory, JobDescriptionBlock, WorkMode

MatchTier = Literal["Strong", "Good", "Moderate", "Low", "Not a Match"]
JobInteractionStatus = Literal["recommended", "saved", "applied", "archived"]


class ScoredJobOpportunity(BaseModel):
    id: str
    title: str
    company: str
    location: str
    workMode: WorkMode
    category: JobCategory = "technical"
    employmentType: str
    seniority: str
    fitScore: int = Field(ge=0, le=100)
    matchTier: MatchTier
    fitReason: str
    matchedSkills: list[str] = Field(default_factory=list)
    missingSkills: list[str] = Field(default_factory=list)
    experienceYearsRequired: float | None = 0.0
    experienceText: str | None = "0 - 1 yrs (Fresher OK)"
    postedAt: str | None = None
    postedDateText: str | None = "Active posting"
    compensation: CompensationRange | None = None
    salaryText: str | None = None
    description: str
    descriptionBlocks: list[JobDescriptionBlock] = Field(default_factory=list)
    sourceUrl: str
    sourceAdapter: str
    status: JobInteractionStatus = "recommended"
    rawJob: CanonicalJob | None = None


class UpdateJobStatusRequest(BaseModel):
    status: JobInteractionStatus
