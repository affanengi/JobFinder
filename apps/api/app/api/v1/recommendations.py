"""Recommendations and Opportunity Scoring Endpoints with persistent saved/applied job tracking."""

import logging

from fastapi import APIRouter, Header, HTTPException

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
    x_user_id: str | None = Header(default="user_default", alias="X-User-Id"),
    user_id: str | None = None,
):
    """Retrieve all active opportunities evaluated and scored against the user's verified facts with persistent statuses."""
    active_uid = user_id or x_user_id or "user_default"
    active_jobs = job_service.list_jobs()
    profile = profile_service.get_profile(user_id=active_uid)

    ranked = matching_engine.rank_all_opportunities(active_jobs, profile)

    # Fetch persistent user job statuses from Firestore
    user_statuses = user_job_repo.get_user_job_statuses(user_id=active_uid)

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
    x_user_id: str | None = Header(default="user_default", alias="X-User-Id"),
    user_id: str | None = None,
):
    """Persist user interaction with a job (save, apply, archive) in Cloud Firestore."""
    active_uid = user_id or x_user_id or "user_default"
    success = user_job_repo.set_job_status(
        user_id=active_uid,
        job_id=job_id,
        status=request.status,
    )
    if not success:
        raise HTTPException(status_code=500, detail="Failed to persist job status.")
    return {"jobId": job_id, "status": request.status, "userId": active_uid}
