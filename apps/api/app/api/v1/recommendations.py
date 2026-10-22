"""Recommendations and Opportunity Scoring Endpoints with persistent saved/applied job tracking."""

import logging

from fastapi import APIRouter, Depends, Header, HTTPException, status

from app.core.auth import get_authenticated_user_id, get_optional_authenticated_user_id
from app.db.repositories.user_job_repo import user_job_repo
from app.matching.engine import matching_engine
from app.schemas.job import JobCategory
from app.schemas.matching import ScoredJobOpportunity, UpdateJobStatusRequest
from app.services.job_service import job_service
from app.services.profile_service import profile_service

logger = logging.getLogger("jobFinder.api.recommendations")
router = APIRouter(prefix="/recommendations", tags=["Recommendations & Matching"])


@router.get("", response_model=list[ScoredJobOpportunity])
async def get_recommended_opportunities(
    category: JobCategory | None = None,
    work_mode: str | None = None,
    user_id: str | None = Depends(get_optional_authenticated_user_id),
    x_user_id: str | None = Header(default=None, alias="X-User-Id"),
):
    """Retrieve all active opportunities evaluated and scored against the user's verified facts with persistent statuses.

    If the request is unauthenticated (guest mode), returns canonical opportunities with fitScore: null and
    matchTier: 'Unscored' without accessing or falling back to any stored profile.
    """
    if user_id:
        if x_user_id and x_user_id != user_id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Header X-User-Id does not match authenticated user.",
            )
        profile = profile_service.get_profile(user_id=user_id)
        user_statuses = user_job_repo.get_user_job_statuses(user_id=user_id)
    else:
        profile = None
        user_statuses = {}

    active_jobs = job_service.list_jobs()
    ranked = matching_engine.rank_all_opportunities(active_jobs, profile=profile)

    if user_statuses:
        for job in ranked:
            if job.id in user_statuses:
                job.status = user_statuses[job.id]  # type: ignore

    if category:
        ranked = [j for j in ranked if j.category == category]
    if work_mode and work_mode != "all":
        ranked = [j for j in ranked if j.workMode == work_mode]

    return ranked


@router.post("/{job_id}/status", response_model=dict[str, str])
async def update_job_status(
    job_id: str,
    request: UpdateJobStatusRequest,
    user_id: str = Depends(get_authenticated_user_id),
    x_user_id: str | None = Header(default=None, alias="X-User-Id"),
):
    """Persist user interaction with a job (save, apply, archive) in Cloud Firestore."""
    if x_user_id and x_user_id != user_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Header X-User-Id does not match authenticated user.",
        )
    success = user_job_repo.set_job_status(
        user_id=user_id,
        job_id=job_id,
        status=request.status,
    )
    if not success:
        raise HTTPException(status_code=500, detail="Failed to persist job status.")
    return {"jobId": job_id, "status": request.status, "userId": user_id}
