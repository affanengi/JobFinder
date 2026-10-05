"""Canonical User Profile & Fact Schemas adhering to SCHEMA.md."""

from datetime import UTC, datetime
from typing import Literal

from pydantic import BaseModel, Field


class PersonalLinks(BaseModel):
    linkedin: str | None = None
    github: str | None = None
    portfolio: str | None = None
    other: list[str] = Field(default_factory=list)


class PersonalContact(BaseModel):
    fullName: str
    firstName: str | None = None
    lastName: str | None = None
    email: str
    phone: str | None = None
    city: str | None = None
    country: str | None = None
    links: PersonalLinks = Field(default_factory=PersonalLinks)


class MetricFact(BaseModel):
    id: str
    parentId: str | None = None
    value: str
    description: str
    unitOrScope: str | None = None
    verified: bool = True
    source: str = "candidate_confirmed"


class EducationFact(BaseModel):
    id: str
    institution: str
    degree: str
    field: str | None = None
    startDate: str | None = None
    endDate: str | None = None
    grade: str | None = None
    location: str | None = None
    verified: bool = False
    source: str = "imported_resume"


class ExperienceFact(BaseModel):
    id: str
    company: str
    title: str
    employmentType: str | None = None
    location: str | None = None
    startDate: str | None = None
    endDate: str | None = None
    current: bool = False
    description: str | None = None
    bullets: list[str] = Field(default_factory=list)
    metrics: list[str | MetricFact] = Field(default_factory=list)
    verified: bool = False
    source: str = "imported_resume"
    category: str | None = None


class ProjectFact(BaseModel):
    id: str
    name: str
    description: str
    bullets: list[str] = Field(default_factory=list)
    technologies: list[str] = Field(default_factory=list)
    url: str | None = None
    startDate: str | None = None
    endDate: str | None = None
    metrics: list[str | MetricFact] = Field(default_factory=list)
    verified: bool = False
    source: str = "imported_resume"
    embedding: list[float] | None = None


SkillCategory = Literal[
    "programming",
    "languages",
    "frontend",
    "web",
    "backend",
    "database",
    "data",
    "ai_ml",
    "automation",
    "cloud",
    "tools",
    "productivity",
    "engineering",
    "soft",
    "languages_spoken",
    "other",
]

SkillProficiency = Literal["beginner", "intermediate", "advanced"]


class SkillFact(BaseModel):
    id: str
    name: str
    category: SkillCategory = "other"
    proficiency: SkillProficiency = "intermediate"
    verified: bool = True
    source: str = "candidate_confirmed"


class CertificationFact(BaseModel):
    id: str
    name: str
    issuer: str
    issueDate: str | None = None
    expiryDate: str | None = None
    url: str | None = None
    verified: bool = False
    source: str = "imported_resume"


class CourseCertificationFact(BaseModel):
    id: str
    title: str
    certificateUrl: str | None = None
    completionYear: str | None = None
    description: str | None = None
    provider: str | None = None
    instructor: str | None = None
    credentialId: str | None = None
    skills: list[str] = Field(default_factory=list)
    verified: bool = True
    source: str = "candidate_confirmed"
    createdAt: str = Field(default_factory=lambda: datetime.now(UTC).isoformat())
    updatedAt: str = Field(default_factory=lambda: datetime.now(UTC).isoformat())


WorkModeLiteral = Literal["remote", "hybrid", "onsite"]
EmploymentTypeLiteral = Literal["internship", "full_time", "part_time", "contract", "temporary"]


def default_work_modes() -> list[WorkModeLiteral]:
    return ["remote", "hybrid"]


def default_employment_types() -> list[EmploymentTypeLiteral]:
    return ["internship", "full_time"]


class Preferences(BaseModel):
    desiredRoles: list[str] = Field(default_factory=list)
    excludedRoles: list[str] = Field(default_factory=list)
    preferredLocations: list[str] = Field(default_factory=list)
    excludedLocations: list[str] = Field(default_factory=list)
    workModes: list[WorkModeLiteral] = Field(default_factory=default_work_modes)
    employmentTypes: list[EmploymentTypeLiteral] = Field(default_factory=default_employment_types)
    minSalary: float | None = None
    maxSalary: float | None = None
    salaryCurrency: str | None = None
    salaryPeriod: Literal["year", "month", "hour", "day"] | None = None
    noticePeriod: str | None = None
    dailyRecommendationTarget: int = 10
    updatedAt: str = Field(default_factory=lambda: datetime.now(UTC).isoformat())


class EducationEntry(BaseModel):
    """Single education credential entry for multi-education candidate profiles."""

    id: str | None = None
    school: str = ""
    degree: str = ""
    discipline: str = ""
    startYear: str = ""
    endYear: str = ""


class AutofillProfile(BaseModel):
    """User-managed convenience data used strictly for deterministic ATS form filling.

    NOTE: This data is NOT candidate evidence, NOT truth-verified facts,
    and must NEVER be used by Truth-Lock or Q&A Co-pilot.
    """

    firstName: str | None = None
    lastName: str | None = None
    fullName: str | None = None
    email: str | None = None
    phone: str | None = None
    streetAddress: str | None = None
    city: str | None = None
    state: str | None = None
    postalCode: str | None = None
    country: str | None = None
    gender: str | None = None
    pronouns: str | None = None
    linkedinUrl: str | None = None
    githubUrl: str | None = None
    portfolioUrl: str | None = None
    school: str | None = None
    degree: str | None = None
    discipline: str | None = None
    startYear: str | None = None
    endYear: str | None = None
    educations: list[EducationEntry] = Field(default_factory=list)
    experienceLevel: str | None = None
    yearsOfExperience: float | None = None
    updatedAt: str = Field(default_factory=lambda: datetime.now(UTC).isoformat())


class Profile(BaseModel):
    """The authoritative Canonical User Profile."""

    userId: str
    personal: PersonalContact
    education: list[EducationFact] = Field(default_factory=list)
    experience: list[ExperienceFact] = Field(default_factory=list)
    projects: list[ProjectFact] = Field(default_factory=list)
    skills: list[SkillFact] = Field(default_factory=list)
    certifications: list[CertificationFact] = Field(default_factory=list)
    courseCertifications: list[CourseCertificationFact] = Field(default_factory=list)
    preferences: Preferences = Field(default_factory=Preferences)
    autofill: AutofillProfile = Field(default_factory=AutofillProfile)
    summary: str | None = None
    appliedMigrations: list[str] = Field(default_factory=list)
    profileVersion: int = 1
    createdAt: str = Field(default_factory=lambda: datetime.now(UTC).isoformat())
    updatedAt: str = Field(default_factory=lambda: datetime.now(UTC).isoformat())


# ==============================================================================
# Ingestion / Extraction DTOs
# ==============================================================================


class RawExtractedEducation(BaseModel):
    institution: str
    degree: str
    field: str | None = None
    startDate: str | None = None
    endDate: str | None = None
    grade: str | None = None
    location: str | None = None


class RawExtractedExperience(BaseModel):
    company: str
    title: str
    employmentType: str | None = None
    location: str | None = None
    startDate: str | None = None
    endDate: str | None = None
    current: bool = False
    description: str | None = None
    bullets: list[str] = Field(default_factory=list)


class RawExtractedProject(BaseModel):
    name: str
    description: str
    bullets: list[str] = Field(default_factory=list)
    technologies: list[str] = Field(default_factory=list)
    url: str | None = None
    metrics: list[str | MetricFact] = Field(default_factory=list)


class RawExtractedSkill(BaseModel):
    name: str
    category: SkillCategory = "other"
    proficiency: SkillProficiency = "intermediate"


class ExtractedResumeData(BaseModel):
    """Structured extraction output returned by AI from a resume document."""

    fullName: str
    email: str
    phone: str | None = None
    city: str | None = None
    country: str | None = None
    linkedin: str | None = None
    github: str | None = None
    portfolio: str | None = None
    summary: str | None = None
    education: list[RawExtractedEducation] = Field(default_factory=list)
    experience: list[RawExtractedExperience] = Field(default_factory=list)
    projects: list[RawExtractedProject] = Field(default_factory=list)
    skills: list[RawExtractedSkill] = Field(default_factory=list)


class ApproveCandidateFactsRequest(BaseModel):
    """Request payload when the user approves candidate extracted facts into their verified profile."""

    approvedEducationIds: list[str] = Field(default_factory=list)
    approvedExperienceIds: list[str] = Field(default_factory=list)
    approvedProjectIds: list[str] = Field(default_factory=list)
    approvedSkillIds: list[str] = Field(default_factory=list)
    personalEdits: PersonalContact | None = None
    summaryEdit: str | None = None
