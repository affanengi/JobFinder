from datetime import UTC, datetime
from typing import Optional
from pydantic import BaseModel, ConfigDict, Field

from app.schemas.company_intelligence import CompanyIntelligenceResult
from app.schemas.opportunity_contact import DiscoveredContact


class CompanyOpportunitySummary(BaseModel):
    """Concise representation of an opportunity associated with a company."""

    id: str
    title: str
    location: str
    workMode: str
    category: str
    sourceUrl: str
    status: str = "recommended"


class CompanySummary(BaseModel):
    """Company summary representation for the Company Directory grid."""

    key: str
    name: str
    domain: str
    opportunityCount: int = 1
    primaryOpportunityId: str
    opportunities: list[CompanyOpportunitySummary] = Field(default_factory=list)
    hasIntelligence: bool = False
    intelligenceStatus: str = "NOT_RESEARCHED"
    contactsCount: int = 0


class CompanyDetail(BaseModel):
    """Full Company Profile representation including intelligence, opportunities, and contacts."""

    key: str
    name: str
    domain: str
    careersUrl: Optional[str] = None
    primaryOpportunityId: str
    opportunities: list[CompanyOpportunitySummary] = Field(default_factory=list)
    intelligence: Optional[CompanyIntelligenceResult] = None
    contacts: list[DiscoveredContact] = Field(default_factory=list)


class BulkCompanyResearchRequest(BaseModel):
    """Request payload to initiate research on up to 5 companies."""

    companyKeys: list[str] = Field(
        min_length=1,
        max_length=5,
        description="List of 1 to 5 unique company keys to research.",
    )
    forceRefresh: bool = Field(
        default=False,
        description="If True, bypasses cache and re-runs live harvesting and Gemini synthesis.",
    )


class BulkCompanyExecutionMetrics(BaseModel):
    """Operational telemetry returned with the bulk research response."""

    totalRequested: int
    cachedCount: int
    liveHarvestedCount: int
    geminiRequestsIssued: int = 1
    totalContactsDiscovered: int
    contactsWithDirectEmail: int
    contactsWithProfileOnly: int
    durationSeconds: float


class BulkCompanyResearchItemResult(BaseModel):
    """Per-company execution outcome."""

    companyKey: str
    companyName: str
    status: str = Field(description="SUCCESS, PARTIAL_SUCCESS, or ERROR")
    intelligence: Optional[CompanyIntelligenceResult] = None
    contacts: list[DiscoveredContact] = Field(default_factory=list)
    error: Optional[str] = None


class BulkCompanyResearchResponse(BaseModel):
    """Full API response for bulk company research."""

    operationId: str
    status: str = Field(description="COMPLETED, PARTIAL_FAILURE, or FAILED")
    metrics: BulkCompanyExecutionMetrics
    results: list[BulkCompanyResearchItemResult]


class BulkResearchJobDocument(BaseModel):
    """Authoritative persistent record of an asynchronous bulk corporate research job."""

    model_config = ConfigDict(extra="allow")

    jobId: str
    userId: str
    status: str = "QUEUED"  # QUEUED, HARVESTING, SYNTHESIZING, SAVING, COMPLETED, FAILED
    progressStage: str = "harvesting"  # harvesting, synthesizing, saving, completed, error
    progressPct: int = 0
    companyKeys: list[str] = Field(default_factory=list)
    totalCompanies: int = 0
    processedCompanies: int = 0
    currentStageDescription: str = "Initiating corporate research..."
    workerId: Optional[str] = None
    leaseExpiresAt: Optional[str] = None
    results: list[BulkCompanyResearchItemResult] = Field(default_factory=list)
    metrics: Optional[BulkCompanyExecutionMetrics] = None
    responsePayload: Optional[BulkCompanyResearchResponse] = None
    errorMessage: Optional[str] = None
    createdAt: str = Field(default_factory=lambda: datetime.now(UTC).isoformat())
    updatedAt: str = Field(default_factory=lambda: datetime.now(UTC).isoformat())
    completedAt: Optional[str] = None


class BulkResearchJobCreateResponse(BaseModel):
    """HTTP 202 Accepted response for background research job."""

    jobId: str
    status: str
    progressStage: str = "queued"
    message: str

