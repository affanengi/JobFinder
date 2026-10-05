"""Canonical Job Schemas adhering to SCHEMA.md."""

from datetime import UTC, datetime
from typing import Literal

from pydantic import BaseModel, Field

JobSourceType = Literal[
    "greenhouse",
    "lever",
    "ashby",
    "workday",
    "linkedin",
    "indeed",
    "wellfound",
    "ycombinator",
    "glassdoor",
    "web_clipper",
    "manual_url",
    "manual_text",
]
WorkMode = Literal["remote", "hybrid", "onsite"]
EmploymentType = Literal["internship", "full_time", "part_time", "contract", "temporary"]
SeniorityLevel = Literal["internship", "entry", "junior", "mid", "senior", "lead", "executive"]
JobCategory = Literal["technical", "data", "qa", "non_technical"]


class CompensationRange(BaseModel):
    min: float | None = None
    max: float | None = None
    currency: str = "USD"
    interval: Literal["year", "month", "hour"] = "year"
    rawString: str | None = None


class JobDescriptionBlock(BaseModel):
    """Semantic block representation of job description content."""

    type: Literal["heading", "paragraph", "bullet_list", "ordered_list"]
    text: str | None = None
    level: int | None = 3
    items: list[str] | None = None


class JobSourceRef(BaseModel):
    adapter: JobSourceType
    originalUrl: str
    sourceJobId: str | None = None
    companySlug: str | None = None
    fetchedAt: str = Field(default_factory=lambda: datetime.now(UTC).isoformat())


class CanonicalJob(BaseModel):
    """The authoritative Canonical Job Opportunity Model adhering to SCHEMA.md."""

    id: str
    title: str
    company: str
    location: str
    workMode: WorkMode = "remote"
    category: JobCategory = "technical"
    employmentType: EmploymentType = "full_time"
    seniority: SeniorityLevel = "junior"
    compensation: CompensationRange | None = None
    description: str
    descriptionBlocks: list[JobDescriptionBlock] = Field(default_factory=list)
    requiredSkills: list[str] = Field(default_factory=list)
    preferredSkills: list[str] = Field(default_factory=list)
    experienceYearsRequired: float | None = 0.0
    experienceText: str | None = "0 - 1 yrs (Fresher OK)"
    educationLevelRequired: str | None = None
    department: str | None = None
    postedAt: str | None = None
    postedDateText: str | None = "Active posting"
    sourceRef: JobSourceRef
    status: Literal["active", "expired", "archived"] = "active"
    canonicalHash: str | None = None
    createdAt: str = Field(default_factory=lambda: datetime.now(UTC).isoformat())
    updatedAt: str = Field(default_factory=lambda: datetime.now(UTC).isoformat())


class IngestUrlRequest(BaseModel):
    url: str
    companyHint: str | None = None


class IngestTextRequest(BaseModel):
    title: str
    company: str
    text: str
    url: str | None = None


class CompanyBoardTarget(BaseModel):
    name: str
    atsType: JobSourceType
    slug: str
    active: bool = True
    tags: list[str] = Field(default_factory=list)


class DiscoveryRequest(BaseModel):
    companySlugs: list[str] | None = None
    keywordFilter: str | None = None
    limitPerCompany: int = 10


class ClipJobRequest(BaseModel):
    title: str = Field(..., min_length=2, max_length=200)
    company: str = Field(..., min_length=1, max_length=150)
    location: str | None = "Remote"
    workMode: WorkMode | None = "remote"
    employmentType: EmploymentType | None = "full_time"
    salaryRaw: str | None = None
    sourceUrl: str
    sourcePlatform: str = "web_clipper"
    descriptionText: str = Field(..., min_length=20)
    descriptionHtml: str | None = Field(None, max_length=100000)
    candidateNotes: str | None = None
    userEditedFields: list[str] = Field(default_factory=list)


class ClipJobResponse(BaseModel):
    jobId: str
    applicationId: str
    isDuplicate: bool
    status: Literal["created", "already_exists"]
    message: str
    kanbanDeepLink: str


class CheckClipStatusResponse(BaseModel):
    isSaved: bool
    jobId: str | None = None
    applicationId: str | None = None
    status: str | None = None
    kanbanDeepLink: str | None = None
