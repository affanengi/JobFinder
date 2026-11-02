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
from app.schemas.company_intelligence import (
    CompanyIntelligenceResult,
    ResearchOpportunityRequest,
)
from app.schemas.outreach import (
    ApproveOutreachRequest,
    GenerateOutreachRequest,
    ManualReviewReplyRequest,
    OutreachMessage,
    OutreachReply,
    SaveOutreachDraftRequest,
    SendOutreachResponse,
    SyncRepliesResponse,
    ThreadTimelineResponse,
)
from app.schemas.opportunity_contact import (
    ContactDiscoveryResponse,
    ContactDismissRequest,
    ContactReviewRequest,
    DiscoverContactsRequest,
    DiscoveredContact,
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
async def discover_jobs(
    request: DiscoveryRequest | None = None,
    user_id: str = Depends(get_authenticated_user_id),
):
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


@router.post("/{job_id}/research", response_model=CompanyIntelligenceResult)
async def research_job_company(
    job_id: str,
    request: ResearchOpportunityRequest | None = None,
    user_id: str = Depends(get_authenticated_user_id),
):
    """Trigger or refresh Company Intelligence & Scam Shield research for a job."""
    from app.services.company_intelligence_service import company_intelligence_service

    force_refresh = request.forceRefresh if request else False
    try:
        return await company_intelligence_service.research_opportunity(
            opportunity_id=job_id,
            user_id=user_id,
            force_refresh=force_refresh,
        )
    except ValueError as ve:
        raise HTTPException(status_code=404, detail=str(ve)) from ve
    except Exception as e:
        logger.error(f"Error researching company for job {job_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Company intelligence research failed: {str(e)}") from e


@router.get("/{job_id}/intelligence", response_model=CompanyIntelligenceResult)
async def get_job_company_intelligence(
    job_id: str,
    user_id: str = Depends(get_authenticated_user_id),
):
    """Retrieve existing cached company intelligence record for a job."""
    from app.services.company_intelligence_service import company_intelligence_service

    intel = company_intelligence_service.get_intelligence(
        opportunity_id=job_id,
        user_id=user_id,
    )
    if not intel:
        raise HTTPException(
            status_code=404,
            detail="Company intelligence has not yet been generated for this job.",
        )
    return intel


@router.post("/{job_id}/contacts/discover")
async def discover_job_contacts(
    job_id: str,
    request: DiscoverContactsRequest | None = None,
    user_id: str = Depends(get_authenticated_user_id),
):
    """Discover, classify, rank, and persist public professional contacts for a job."""
    from app.services.contact_discovery_service import contact_discovery_service

    force_refresh = request.forceRefresh if request else False
    try:
        return await contact_discovery_service.discover_contacts(
            user_id=user_id,
            opportunity_id=job_id,
            force_refresh=force_refresh,
        )
    except ValueError as ve:
        raise HTTPException(status_code=404, detail=str(ve)) from ve
    except Exception as e:
        logger.error(f"Error discovering contacts for job {job_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Contact discovery failed: {str(e)}") from e


@router.get("/{job_id}/contacts")
async def list_job_contacts(
    job_id: str,
    user_id: str = Depends(get_authenticated_user_id),
):
    """Retrieve all discovered professional contacts associated with a job."""
    from app.services.contact_discovery_service import contact_discovery_service

    return contact_discovery_service.get_contacts(
        user_id=user_id,
        opportunity_id=job_id,
    )


@router.patch("/{job_id}/contacts/{contact_id}/dismiss")
async def update_job_contact_dismissal(
    job_id: str,
    contact_id: str,
    request: ContactDismissRequest,
    user_id: str = Depends(get_authenticated_user_id),
):
    """Update contact dismissal status for a job (tenant isolated)."""
    from app.services.contact_discovery_service import contact_discovery_service

    updated = contact_discovery_service.update_contact_status(
        user_id=user_id,
        contact_id=contact_id,
        is_dismissed=request.isDismissed,
    )
    if not updated or updated.opportunityId != job_id:
        raise HTTPException(
            status_code=404,
            detail="Contact not found or does not belong to the authenticated user.",
        )
    return updated


@router.patch("/{job_id}/contacts/{contact_id}/review")
async def update_job_contact_review(
    job_id: str,
    contact_id: str,
    request: ContactReviewRequest,
    user_id: str = Depends(get_authenticated_user_id),
):
    """Toggle contact reviewed status for a job (tenant isolated)."""
    from app.services.contact_discovery_service import contact_discovery_service

    updated = contact_discovery_service.update_contact_status(
        user_id=user_id,
        contact_id=contact_id,
        is_reviewed=request.isReviewed,
    )
    if not updated or updated.opportunityId != job_id:
        raise HTTPException(
            status_code=404,
            detail="Contact not found or does not belong to the authenticated user.",
        )
    return updated


# --- Phase 3: Truth-Lock Outreach Mirror Endpoints ---


@router.post(
    "/{job_id}/contacts/{contact_id}/outreach/generate",
    response_model=OutreachMessage,
    status_code=status.HTTP_200_OK,
)
async def generate_job_outreach_draft(
    job_id: str,
    contact_id: str,
    request: GenerateOutreachRequest,
    user_id: str = Depends(get_authenticated_user_id),
):
    """Generate a personalized, Truth-Locked outreach draft for a job contact."""
    from app.services.outreach_orchestration_service import outreach_orchestration_service

    try:
        return await outreach_orchestration_service.generate_outreach_draft(
            user_id=user_id,
            opportunity_id=job_id,
            contact_id=contact_id,
            notes=request.notes,
            tone=request.tone,
            resume_attachment_id=request.resumeAttachmentId,
        )
    except ValueError as ve:
        raise HTTPException(status_code=404, detail=str(ve)) from ve
    except Exception as e:
        logger.error(f"Error generating outreach draft for job contact {contact_id}: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"Outreach generation failed: {str(e)}",
        ) from e


@router.post(
    "/{job_id}/contacts/{contact_id}/outreach",
    response_model=OutreachMessage,
    status_code=status.HTTP_200_OK,
)
async def save_job_contact_outreach_draft(
    job_id: str,
    contact_id: str,
    request: SaveOutreachDraftRequest,
    user_id: str = Depends(get_authenticated_user_id),
):
    """Save or update an outreach draft for a contact, running Truth-Lock audit."""
    from app.services.outreach_orchestration_service import outreach_orchestration_service

    try:
        return outreach_orchestration_service.save_manual_draft(
            user_id=user_id,
            opportunity_id=job_id,
            contact_id=contact_id,
            subject=request.subject,
            body=request.body,
            resume_attachment_id=request.resumeAttachmentId,
        )
    except ValueError as ve:
        raise HTTPException(status_code=404, detail=str(ve)) from ve
    except Exception as e:
        logger.error(f"Error saving outreach draft for job contact {contact_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Saving draft failed: {str(e)}") from e


@router.get(
    "/{job_id}/contacts/{contact_id}/outreach",
    response_model=OutreachMessage | None,
    status_code=status.HTTP_200_OK,
)
async def get_job_contact_outreach(
    job_id: str,
    contact_id: str,
    user_id: str = Depends(get_authenticated_user_id),
):
    """Get active outreach draft for a job contact if one exists."""
    from app.services.outreach_orchestration_service import outreach_orchestration_service

    return outreach_orchestration_service.get_by_contact(
        user_id=user_id,
        opportunity_id=job_id,
        contact_id=contact_id,
    )


@router.put(
    "/{job_id}/outreach/{outreach_id}",
    response_model=OutreachMessage,
    status_code=status.HTTP_200_OK,
)
async def update_job_outreach_draft(
    job_id: str,
    outreach_id: str,
    request: SaveOutreachDraftRequest,
    user_id: str = Depends(get_authenticated_user_id),
):
    """Update an outreach draft by ID, invalidating prior approval on modification."""
    from app.services.outreach_orchestration_service import outreach_orchestration_service

    try:
        msg = outreach_orchestration_service.get_outreach(user_id=user_id, outreach_id=outreach_id)
        if not msg or msg.opportunityId != job_id:
            raise HTTPException(
                status_code=404,
                detail="Outreach draft not found or does not belong to this opportunity.",
            )
        return outreach_orchestration_service.update_draft(
            user_id=user_id,
            outreach_id=outreach_id,
            subject=request.subject,
            body=request.body,
            resume_attachment_id=request.resumeAttachmentId,
        )
    except HTTPException:
        raise
    except ValueError as ve:
        raise HTTPException(status_code=404, detail=str(ve)) from ve
    except Exception as e:
        logger.error(f"Error updating outreach draft {outreach_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Updating draft failed: {str(e)}") from e


@router.post(
    "/{job_id}/outreach/{outreach_id}/approve",
    response_model=OutreachMessage,
    status_code=status.HTTP_200_OK,
)
async def approve_job_outreach_draft(
    job_id: str,
    outreach_id: str,
    request: ApproveOutreachRequest,
    user_id: str = Depends(get_authenticated_user_id),
):
    """Explicitly approve an outreach draft for sending (or revoke approval)."""
    from app.services.outreach_orchestration_service import outreach_orchestration_service

    try:
        msg = outreach_orchestration_service.get_outreach(user_id=user_id, outreach_id=outreach_id)
        if not msg or msg.opportunityId != job_id:
            raise HTTPException(
                status_code=404,
                detail="Outreach draft not found or does not belong to this opportunity.",
            )
        return outreach_orchestration_service.set_approval_status(
            user_id=user_id,
            outreach_id=outreach_id,
            is_approved=request.isApproved,
        )
    except HTTPException:
        raise
    except ValueError as ve:
        raise HTTPException(status_code=404, detail=str(ve)) from ve
    except Exception as e:
        logger.error(f"Error approving outreach draft {outreach_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Approval status update failed: {str(e)}") from e


@router.post(
    "/{job_id}/outreach/{outreach_id}/send",
    response_model=SendOutreachResponse,
    status_code=status.HTTP_200_OK,
)
async def send_job_outreach_message(
    job_id: str,
    outreach_id: str,
    user_id: str = Depends(get_authenticated_user_id),
):
    """Dispatch an explicitly approved outreach message for a job via authorized Gmail account."""
    from app.services.gmail_sending_service import (
        AmbiguousSendError,
        DuplicateSendError,
        GmailNotConnectedError,
        IneligibleRecipientError,
        UnapprovedDraftError,
        gmail_sending_service,
    )

    try:
        return await gmail_sending_service.send_approved_outreach(
            user_id=user_id,
            opportunity_id=job_id,
            outreach_id=outreach_id,
        )
    except UnapprovedDraftError as ude:
        raise HTTPException(status_code=400, detail=str(ude)) from ude
    except IneligibleRecipientError as ire:
        raise HTTPException(status_code=400, detail=str(ire)) from ire
    except GmailNotConnectedError as gnc:
        raise HTTPException(status_code=400, detail=str(gnc)) from gnc
    except DuplicateSendError as dse:
        raise HTTPException(status_code=409, detail=str(dse)) from dse
    except ValueError as ve:
        raise HTTPException(status_code=404, detail=str(ve)) from ve
    except Exception as e:
        logger.error(f"Error sending outreach message {outreach_id}: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"Sending failed: {str(e)}",
        ) from e


@router.post(
    "/{job_id}/outreach/{outreach_id}/reconcile",
    response_model=OutreachMessage,
    status_code=status.HTTP_200_OK,
)
async def reconcile_job_outreach_message(
    job_id: str,
    outreach_id: str,
    user_id: str = Depends(get_authenticated_user_id),
):
    """Reconcile an ambiguous outreach message outcome for a job."""
    from app.services.gmail_sending_service import gmail_sending_service

    try:
        return await gmail_sending_service.reconcile_outreach_status(
            user_id=user_id,
            opportunity_id=job_id,
            outreach_id=outreach_id,
        )
    except ValueError as ve:
        raise HTTPException(status_code=404, detail=str(ve)) from ve
    except Exception as e:
        logger.error(f"Error reconciling outreach message {outreach_id}: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"Reconciliation failed: {str(e)}",
        ) from e


# --- Phase 5: Mirrored Reply Tracking Endpoints for Jobs ---


@router.post(
    "/{job_id}/outreach/{outreach_id}/sync-replies",
    response_model=SyncRepliesResponse,
    status_code=status.HTTP_200_OK,
)
async def sync_job_outreach_replies(
    job_id: str,
    outreach_id: str,
    user_id: str = Depends(get_authenticated_user_id),
):
    """Synchronize inbound replies from Gmail for a specific outreach thread."""
    from app.services.reply_tracking_service import (
        GmailReadPermissionRequiredError,
        ReplySyncError,
        reply_tracking_service,
    )

    try:
        replies = await reply_tracking_service.sync_replies_for_outreach(
            user_id=user_id,
            opportunity_id=job_id,
            outreach_id=outreach_id,
        )
        return SyncRepliesResponse(
            outreachId=outreach_id,
            newRepliesCount=len(replies),
            totalRepliesCount=len(replies),
            replies=replies,
            hasReadPermission=True,
            message=f"Successfully synced {len(replies)} reply(ies).",
        )
    except GmailReadPermissionRequiredError as rpe:
        return SyncRepliesResponse(
            outreachId=outreach_id,
            newRepliesCount=0,
            totalRepliesCount=0,
            replies=[],
            hasReadPermission=False,
            message=str(rpe),
        )
    except ValueError as ve:
        raise HTTPException(status_code=404, detail=str(ve)) from ve
    except ReplySyncError as rse:
        raise HTTPException(status_code=502, detail=str(rse)) from rse
    except Exception as e:
        logger.error(f"Unexpected error syncing replies for outreach {outreach_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Reply sync failed: {str(e)}") from e


@router.get(
    "/{job_id}/outreach/{outreach_id}/timeline",
    response_model=ThreadTimelineResponse,
    status_code=status.HTTP_200_OK,
)
async def get_job_outreach_thread_timeline(
    job_id: str,
    outreach_id: str,
    user_id: str = Depends(get_authenticated_user_id),
):
    """Retrieve full thread timeline (outreach + replies + classifications) for a job outreach message."""
    from app.services.reply_tracking_service import reply_tracking_service

    try:
        return reply_tracking_service.get_thread_timeline(
            user_id=user_id,
            opportunity_id=job_id,
            outreach_id=outreach_id,
        )
    except ValueError as ve:
        raise HTTPException(status_code=404, detail=str(ve)) from ve
    except Exception as e:
        logger.error(f"Error fetching thread timeline for outreach {outreach_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Fetching timeline failed: {str(e)}") from e


@router.post(
    "/{job_id}/outreach/{outreach_id}/replies/{reply_id}/manual-review",
    response_model=OutreachReply,
    status_code=status.HTTP_200_OK,
)
async def manual_review_job_reply(
    job_id: str,
    outreach_id: str,
    reply_id: str,
    request: ManualReviewReplyRequest,
    user_id: str = Depends(get_authenticated_user_id),
):
    """Manually review an ambiguous or misclassified reply."""
    from app.services.reply_tracking_service import reply_tracking_service

    try:
        return reply_tracking_service.manual_review_reply(
            user_id=user_id,
            opportunity_id=job_id,
            outreach_id=outreach_id,
            reply_id=reply_id,
            req=request,
        )
    except ValueError as ve:
        raise HTTPException(status_code=404, detail=str(ve)) from ve
    except Exception as e:
        logger.error(f"Error during manual review for reply {reply_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Manual review failed: {str(e)}") from e


@router.get(
    "/{job_id}/replies",
    response_model=list[OutreachReply],
    status_code=status.HTTP_200_OK,
)
async def list_job_replies(
    job_id: str,
    user_id: str = Depends(get_authenticated_user_id),
):
    """List all replies received for any outreach message associated with this job."""
    from app.db.repositories.outreach_reply_repo import outreach_reply_repo

    return outreach_reply_repo.list_replies_for_opportunity(
        user_id=user_id,
        opportunity_id=job_id,
    )





