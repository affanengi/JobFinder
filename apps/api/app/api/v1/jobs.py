"""Job Ingestion & Discovery API Endpoints."""

import logging

from fastapi import APIRouter, HTTPException

from fastapi import Depends, Response, status
from app.core.auth import get_authenticated_user_id
from app.schemas.job import (
    CanonicalJob,
    CheckClipStatusResponse,
    ClipJobRequest,
    ClipJobResponse,
    CompanyBoardTarget,
    DiscoveryRequest,
    IngestTextRequest,
    IngestUrlRequest,
)
from app.schemas.job_analysis import (
    ApplicationProfileSnapshot,
    JobAnalysisResult,
    ProfileJobMatchResult,
)
from app.services.job_service import job_service
from app.sources.registry import TARGET_COMPANIES

logger = logging.getLogger("jobFinder.api.jobs")
router = APIRouter(prefix="/jobs", tags=["Jobs & Ingestion"])


@router.get("", response_model=list[CanonicalJob])
async def list_jobs():
    """List all normalized canonical jobs."""
    return job_service.list_jobs()


@router.get("/targets", response_model=list[CompanyBoardTarget])
async def list_target_companies():
    """List supported tech companies and their public ATS configurations."""
    return TARGET_COMPANIES


@router.get("/{job_id}", response_model=CanonicalJob)
async def get_job(job_id: str):
    """Retrieve a single normalized job opportunity by ID."""
    job = job_service.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job opportunity not found.")
    return job


@router.post("/ingest-url", response_model=CanonicalJob)
async def ingest_job_from_url(request: IngestUrlRequest):
    """Ingest and normalize a job from any public URL (Greenhouse, Lever, Ashby, or careers page)."""
    try:
        job = await job_service.ingest_from_url(
            url=request.url,
            company_hint=request.companyHint,
        )
        if not job:
            raise HTTPException(
                status_code=400,
                detail="Could not extract job posting from the provided URL. Please check the URL or paste the job description.",
            )
        return job
    except Exception as e:
        logger.error(f"Failed to ingest job from {request.url}: {e}")
        raise HTTPException(status_code=500, detail=f"Ingestion failed: {str(e)}") from e


@router.post("/ingest-text", response_model=CanonicalJob)
async def ingest_job_from_text(request: IngestTextRequest):
    """Ingest and normalize a raw job description."""
    try:
        return await job_service.ingest_from_text(
            title=request.title,
            company=request.company,
            text=request.text,
            url=request.url,
        )
    except Exception as e:
        logger.error(f"Failed to ingest raw job text: {e}")
        raise HTTPException(status_code=500, detail=f"Ingestion failed: {str(e)}") from e


@router.post("/discover", response_model=list[CanonicalJob])
async def discover_jobs(request: DiscoveryRequest | None = None):
    """Fetch active jobs from public tech company ATS boards."""
    slugs = request.companySlugs if request else None
    limit = request.limitPerCompany if request else 10
    try:
        return await job_service.run_discovery_pipeline(
            target_slugs=slugs,
            limit_per_company=limit,
        )
    except Exception as e:
        logger.error(f"Discovery error: {e}")
        raise HTTPException(status_code=500, detail=f"Discovery failed: {str(e)}") from e


@router.get("/clip/status", response_model=CheckClipStatusResponse)
async def check_clip_status(
    url: str,
    user_id: str = Depends(get_authenticated_user_id),
):
    """Check if a target URL has already been clipped by the authenticated candidate."""
    return await job_service.check_clip_status(user_id=user_id, url=url)


@router.post("/clip", response_model=ClipJobResponse, status_code=status.HTTP_201_CREATED)
async def clip_job(
    request: ClipJobRequest,
    response: Response,
    user_id: str = Depends(get_authenticated_user_id),
):
    """Ingest, normalize, deduplicate, and add a web clipper job directly into the Saved Kanban column."""
    try:
        res = await job_service.clip_job(user_id=user_id, req=request)
        if res.isDuplicate:
            response.status_code = status.HTTP_200_OK
        return res
    except Exception as e:
        logger.error(f"Failed to clip job from {request.sourceUrl}: {e}")
        raise HTTPException(status_code=500, detail=f"Clipping failed: {str(e)}") from e


@router.post("/{job_id}/analyze", response_model=JobAnalysisResult)
async def analyze_job_requirements(
    job_id: str,
    force_regenerate: bool = False,
    user_id: str = Depends(get_authenticated_user_id),
):
    """Analyze a job opportunity into atomic requirements with AI Hub and deterministic fallback."""
    job = job_service.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail=f"Job '{job_id}' not found.")

    from app.services.job_analysis_service import job_analysis_service
    return await job_analysis_service.analyze_job(
        job=job,
        user_id=user_id,
        force_regenerate=force_regenerate,
    )


@router.get("/{job_id}/analysis", response_model=JobAnalysisResult)
async def get_job_analysis(
    job_id: str,
    user_id: str = Depends(get_authenticated_user_id),
):
    """Retrieve structured job requirements analysis (reads cache or computes if missing)."""
    job = job_service.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail=f"Job '{job_id}' not found.")

    from app.services.job_analysis_service import job_analysis_service
    return await job_analysis_service.analyze_job(
        job=job,
        user_id=user_id,
        force_regenerate=False,
    )


@router.get("/{job_id}/match", response_model=ProfileJobMatchResult)
async def get_job_profile_match(
    job_id: str,
    user_id: str = Depends(get_authenticated_user_id),
):
    """Deterministically match canonical profile facts against structured job requirements."""
    job = job_service.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail=f"Job '{job_id}' not found.")

    from app.services.job_analysis_service import job_analysis_service
    from app.services.profile_job_matching_service import profile_job_matcher
    from app.services.profile_service import profile_service

    job_analysis = await job_analysis_service.analyze_job(job=job, user_id=user_id)
    profile = profile_service.get_profile(user_id=user_id)
    return profile_job_matcher.compute_match(profile=profile, job_analysis=job_analysis)


@router.post("/{job_id}/snapshot", response_model=ApplicationProfileSnapshot)
async def create_job_application_snapshot(
    job_id: str,
    user_id: str = Depends(get_authenticated_user_id),
):
    """Generate a derived, read-only application snapshot referencing canonical profile facts."""
    job = job_service.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail=f"Job '{job_id}' not found.")

    from app.services.job_analysis_service import job_analysis_service
    from app.services.profile_job_matching_service import profile_job_matcher
    from app.services.profile_service import profile_service

    job_analysis = await job_analysis_service.analyze_job(job=job, user_id=user_id)
    profile = profile_service.get_profile(user_id=user_id)
    match_result = profile_job_matcher.compute_match(profile=profile, job_analysis=job_analysis)
    return profile_job_matcher.create_application_snapshot(profile, job_analysis, match_result)

