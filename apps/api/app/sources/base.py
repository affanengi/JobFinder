"""Base Protocol and Dataclasses for Job Source Adapters."""

from typing import Any, Protocol

from pydantic import BaseModel, Field

from app.schemas.job import JobSourceRef, JobSourceType


class RawJobPayload(BaseModel):
    """Container holding raw job data from an ATS or web source."""

    sourceType: JobSourceType
    sourceId: str | None = None
    companyName: str
    companySlug: str | None = None
    url: str
    rawTitle: str
    rawLocation: str | None = None
    rawDepartment: str | None = None
    rawDescription: str
    rawCompensation: str | None = None
    rawCommitment: str | None = None
    rawPostedAt: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)

    def to_source_ref(self) -> JobSourceRef:
        return JobSourceRef(
            adapter=self.sourceType,
            originalUrl=self.url,
            sourceJobId=self.sourceId,
            companySlug=self.companySlug,
        )


class JobSourceAdapter(Protocol):
    """Protocol that all ATS and web source adapters must implement."""

    async def fetch_job_by_url(self, url: str) -> RawJobPayload | None:
        """Fetch a single job posting by URL."""
        ...

    async def fetch_company_board(
        self,
        company_slug: str,
        limit: int = 50,
    ) -> list[RawJobPayload]:
        """Fetch active job postings for a company board."""
        ...
