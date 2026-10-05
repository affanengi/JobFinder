"""Job Ingestion and Multi-ATS Repository Coordination Service with Firestore persistence."""

import asyncio
import logging

from typing import cast

from app.db.repositories.job_repo import job_repo
from app.schemas.job import (
    CanonicalJob,
    CheckClipStatusResponse,
    ClipJobRequest,
    ClipJobResponse,
    JobSourceType,
)
from app.schemas.application import ApplicationStage, CreateApplicationRequest
from app.db.repositories.application_repo import application_repo
# application_service imported inside clip_job to avoid circular import
from app.sources.base import RawJobPayload
from app.services.job_normalization_service import job_normalization_service
from app.sources.ashby import AshbyAdapter
from app.sources.greenhouse import GreenhouseAdapter
from app.sources.lever import LeverAdapter
from app.sources.manual import ManualSourceManager
from app.sources.registry import TARGET_COMPANIES, get_target_by_slug

logger = logging.getLogger("jobFinder.services.job")


class JobService:
    """Service that coordinates Greenhouse, Lever, and Ashby ATS adapters, normalizes jobs, and persists them."""

    def __init__(self):
        self.greenhouse = GreenhouseAdapter()
        self.lever = LeverAdapter()
        self.ashby = AshbyAdapter()
        self.manual = ManualSourceManager()
        self.normalizer = job_normalization_service
        self.repo = job_repo
        self._jobs: dict[str, CanonicalJob] = {}
        self._initialized_from_db: bool = False

    def list_jobs(self, force_refresh: bool = False) -> list[CanonicalJob]:
        """Return all active canonical jobs sorted by creation time."""
        if not self._initialized_from_db or force_refresh:
            db_jobs = self.repo.list_all(limit=500)
            for j in db_jobs:
                self._jobs[j.id] = j
            self._initialized_from_db = True

        return sorted(self._jobs.values(), key=lambda j: j.createdAt, reverse=True)

    def get_job(self, job_id: str) -> CanonicalJob | None:
        """Get a specific canonical job by ID."""
        if job_id in self._jobs:
            return self._jobs[job_id]
        db_job = self.repo.get_by_id(job_id)
        if db_job:
            self._jobs[db_job.id] = db_job
            return db_job
        return None

    def save_job(self, job: CanonicalJob) -> CanonicalJob:
        """Store or update a canonical job in memory and Firestore."""
        self._jobs[job.id] = job
        self.repo.save(job)
        return job

    async def ingest_from_url(
        self, url: str, company_hint: str | None = None
    ) -> CanonicalJob | None:
        """Ingest and normalize a job from any URL."""
        raw_payload = await self.manual.fetch_job_by_url(url)
        if not raw_payload:
            return None

        if company_hint:
            raw_payload.companyName = company_hint

        canonical = self.normalizer.normalize(raw_payload)
        return self.save_job(canonical)

    async def ingest_from_text(
        self,
        title: str,
        company: str,
        text: str,
        url: str | None = None,
    ) -> CanonicalJob:
        """Ingest and normalize a raw job description."""
        raw_payload = await self.manual.ingest_raw_text(
            title=title,
            company=company,
            raw_text=text,
            url=url,
        )
        canonical = self.normalizer.normalize(raw_payload)
        return self.save_job(canonical)

    async def discover_company_board(
        self,
        slug: str,
        limit: int = 15,
    ) -> list[CanonicalJob]:
        """Fetch and normalize open positions for a target company."""
        target = get_target_by_slug(slug)
        raw_jobs = []

        if target:
            if target.atsType == "greenhouse":
                raw_jobs = await self.greenhouse.fetch_company_board(target.slug, limit=limit)
            elif target.atsType == "lever":
                raw_jobs = await self.lever.fetch_company_board(target.slug, limit=limit)
            elif target.atsType == "ashby":
                raw_jobs = await self.ashby.fetch_company_board(target.slug, limit=limit)
        else:
            raw_jobs = await self.ashby.fetch_company_board(slug, limit=limit)
            if not raw_jobs:
                raw_jobs = await self.greenhouse.fetch_company_board(slug, limit=limit)
            if not raw_jobs:
                raw_jobs = await self.lever.fetch_company_board(slug, limit=limit)

        ingested: list[CanonicalJob] = []
        for raw in raw_jobs:
            canonical = self.normalizer.normalize(raw)
            self.save_job(canonical)
            ingested.append(canonical)

        logger.info(f"Discovered and normalized {len(ingested)} jobs from {slug}")
        return ingested

    async def run_discovery_pipeline(
        self,
        target_slugs: list[str] | None = None,
        limit_per_company: int = 15,
    ) -> list[CanonicalJob]:
        """Run discovery across multi-provider target company boards concurrently."""
        targets = target_slugs or [t.slug for t in TARGET_COMPANIES]

        async def fetch_one(slug: str) -> list[CanonicalJob]:
            try:
                return await self.discover_company_board(slug, limit=limit_per_company)
            except Exception as e:
                logger.warning(f"Failed discovery for {slug}: {e}")
                return []

        results = await asyncio.gather(*[fetch_one(s) for s in targets])
        all_discovered: list[CanonicalJob] = []
        for res in results:
            all_discovered.extend(res)

        logger.info(
            f"Discovery pipeline complete: {len(all_discovered)} jobs ingested across {len(targets)} boards."
        )
        return all_discovered



    async def check_clip_status(self, user_id: str, url: str) -> CheckClipStatusResponse:
        """Lightweight check whether a given job URL is already clipped or tracked by user."""
        if not url:
            return CheckClipStatusResponse(isSaved=False)

        canonical_url = self.normalizer.canonicalize_url(url)
        import uuid
        computed_id = f"job-{uuid.uuid5(uuid.NAMESPACE_URL, canonical_url).hex[:10]}"
        job = (
            self.get_job(computed_id)
            or self.repo.get_by_source_url(canonical_url)
            or self.repo.get_by_source_url(url)
        )

        if not job:
            # Check if any user application matches this portal URL directly
            user_apps = application_repo.list_for_user(user_id=user_id)
            for user_app in user_apps:
                if user_app.portalUrl and (user_app.portalUrl == canonical_url or user_app.portalUrl == url):
                    return CheckClipStatusResponse(
                        isSaved=True,
                        jobId=user_app.jobId,
                        applicationId=user_app.id,
                        status=user_app.status.value if hasattr(user_app.status, "value") else str(user_app.status),
                        kanbanDeepLink=f"/applications?selected={user_app.id}",
                    )
            return CheckClipStatusResponse(isSaved=False)

        app = application_repo.get_by_user_and_job(user_id=user_id, job_id=job.id)
        if app:
            return CheckClipStatusResponse(
                isSaved=True,
                jobId=job.id,
                applicationId=app.id,
                status=app.status.value if hasattr(app.status, "value") else str(app.status),
                kanbanDeepLink=f"/applications?selected={app.id}",
            )

        return CheckClipStatusResponse(
            isSaved=False,
            jobId=job.id,
            status=None,
        )

    async def clip_job(
        self,
        user_id: str,
        req: ClipJobRequest,
    ) -> ClipJobResponse:
        """Process raw web clipper payload, normalize, deduplicate, persist, and add to Saved Kanban."""
        from app.services.application_service import application_service
        canonical_url = self.normalizer.canonicalize_url(req.sourceUrl)
        canonical_hash = self.normalizer.compute_canonical_hash(
            company=req.company,
            title=req.title,
            location=req.location,
        )

        # 1. Multi-factor deduplication check
        existing_job = (
            self.repo.get_by_source_url(canonical_url)
            or self.repo.get_by_source_url(req.sourceUrl)
            or self.repo.get_by_canonical_hash(canonical_hash)
        )

        if existing_job:
            self.repo.index_url(canonical_url, existing_job.id)
            self.repo.index_url(req.sourceUrl, existing_job.id)
            existing_app = application_repo.get_by_user_and_job(user_id=user_id, job_id=existing_job.id)
            if existing_app:
                status_label = existing_app.status.value.replace("_", " ").title() if hasattr(existing_app.status, "value") else str(existing_app.status).title()
                return ClipJobResponse(
                    jobId=existing_job.id,
                    applicationId=existing_app.id,
                    isDuplicate=True,
                    status="already_exists",
                    message=f"Already in JobFinder under '{status_label}'.",
                    kanbanDeepLink=f"/applications?selected={existing_app.id}",
                )

            # Job exists in system, but user has not tracked an application for it yet
            app_req = CreateApplicationRequest(
                jobId=existing_job.id,
                company=req.company or existing_job.company,
                jobTitle=req.title or existing_job.title,
                location=req.location or existing_job.location,
                portalUrl=canonical_url,
                salarySnippet=req.salaryRaw,
                initialStatus=ApplicationStage.SAVED,
                notes=req.candidateNotes or "",
                isExternal=True,
            )
            app_record = application_service.create_application(user_id=user_id, req=app_req)
            return ClipJobResponse(
                jobId=existing_job.id,
                applicationId=app_record.id,
                isDuplicate=False,
                status="created",
                message="Opportunity clipped and added to Saved Kanban.",
                kanbanDeepLink=f"/applications?selected={app_record.id}",
            )

        # 2. Ingest and normalize new raw payload
        platform = req.sourcePlatform.lower()
        valid_platforms = {
            "greenhouse", "lever", "ashby", "workday",
            "linkedin", "indeed", "wellfound", "ycombinator",
            "glassdoor", "web_clipper"
        }
        source_adapter = platform if platform in valid_platforms else "web_clipper"

        raw_payload = RawJobPayload(
            sourceType=cast(JobSourceType, source_adapter),
            companyName=req.company,
            url=canonical_url,
            rawTitle=req.title,
            rawLocation=req.location,
            rawDescription=req.descriptionText,
            rawCompensation=req.salaryRaw,
            rawCommitment=req.employmentType,
            metadata={
                "workplaceType": req.workMode,
                "isRemote": req.workMode == "remote",
                "candidateNotes": req.candidateNotes,
                "userEditedFields": req.userEditedFields,
                "rawText": req.descriptionText,
            }
        )

        canonical_job = self.normalizer.normalize(raw_payload)

        # Candidate edits take absolute precedence over heuristic normalization
        if req.title:
            canonical_job.title = req.title
        if req.company:
            canonical_job.company = req.company
        if req.location:
            canonical_job.location = req.location
        else:
            canonical_job.location = canonical_job.location or "Remote"
        if req.workMode:
            canonical_job.workMode = req.workMode
        else:
            canonical_job.workMode = canonical_job.workMode or "remote"
        if req.employmentType:
            canonical_job.employmentType = req.employmentType
        else:
            canonical_job.employmentType = canonical_job.employmentType or "full_time" 

        self.save_job(canonical_job)
        self.repo.index_url(canonical_url, canonical_job.id)
        self.repo.index_url(req.sourceUrl, canonical_job.id)

        # 3. Create initial application in SAVED stage
        app_req = CreateApplicationRequest(
            jobId=canonical_job.id,
            company=canonical_job.company,
            jobTitle=canonical_job.title,
            location=canonical_job.location,
            portalUrl=canonical_url,
            salarySnippet=req.salaryRaw,
            initialStatus=ApplicationStage.SAVED,
            notes=req.candidateNotes or "",
            isExternal=True,
        )
        app_record = application_service.create_application(user_id=user_id, req=app_req)

        return ClipJobResponse(
            jobId=canonical_job.id,
            applicationId=app_record.id,
            isDuplicate=False,
            status="created",
            message="Opportunity clipped and added to Saved Kanban.",
            kanbanDeepLink=f"/applications?selected={app_record.id}",
        )


job_service = JobService()
