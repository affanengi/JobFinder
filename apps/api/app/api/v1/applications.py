from fastapi.responses import StreamingResponse
from app.schemas.autofill import (
    AutofillEventDTO,
    AutofillSessionDTO,
    AutofillStartResponse,
    ConfirmSubmissionRequest,
)
from app.services.playwright_autofill_engine import playwright_autofill_engine
from app.services.profile_service import profile_service
"""FastAPI Router for Application Tracker & Pipeline Management."""

import logging
from typing import Optional
from fastapi import APIRouter, Depends, Header, HTTPException, Query, status
from firebase_admin import auth as firebase_auth

from app.core.config import settings
from app.db.repositories.application_repo import application_repo
from app.schemas.application import (
    AddInterviewRoundRequest,
    ApplicationRecordDTO,
    ApplicationStage,
    ApprovePackageRequest,
    CreateApplicationRequest,
    InterviewRoundEvent,
    UpdateApplicationNotesRequest,
    UpdateApplicationStatusRequest,
)
from app.services.application_service import application_service

logger = logging.getLogger("jobFinder.api.applications")

router = APIRouter()


async def get_authenticated_user_id(
    authorization: Optional[str] = Header(default=None),
    x_user_id: Optional[str] = Header(default=None, alias="X-User-Id"),
) -> str:
    """Extract authoritative user identity from Firebase Auth token or safe dev fallback."""
    if authorization and authorization.startswith("Bearer "):
        token = authorization.split("Bearer ")[1].strip()
        if token:
            try:
                decoded_token = firebase_auth.verify_id_token(token)
                uid = decoded_token.get("uid")
                if uid:
                    return uid
            except Exception as e:
                logger.debug(f"Firebase token verification failed: {e}")
                if settings.ENVIRONMENT != "development":
                    raise HTTPException(
                        status_code=status.HTTP_401_UNAUTHORIZED,
                        detail="Invalid or expired authentication token.",
                    )

    # In local development mode, allow fallback to verified user or header
    if settings.ENVIRONMENT == "development":
        return x_user_id or "Sf0isG4mUuXwTQTWWwG1Wf4aIM82"

    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Missing or invalid authentication credentials.",
    )


@router.get("", response_model=list[ApplicationRecordDTO])
async def list_applications(
    status: Optional[ApplicationStage] = None,
    user_id: str = Depends(get_authenticated_user_id),
):
    """List all application records for the authenticated user, optionally filtered by stage."""
    return application_repo.list_for_user(user_id=user_id, status=status)


@router.post("", response_model=ApplicationRecordDTO, status_code=status.HTTP_201_CREATED)
async def create_application(
    req: CreateApplicationRequest,
    user_id: str = Depends(get_authenticated_user_id),
):
    """Create a manual application or log an off-platform application."""
    try:
        return application_service.create_application(user_id=user_id, req=req)
    except Exception as e:
        logger.error(f"Error creating application: {e}")
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))


@router.get("/{app_id}", response_model=ApplicationRecordDTO)
async def get_application(
    app_id: str,
    user_id: str = Depends(get_authenticated_user_id),
):
    """Retrieve single application record, verifying user ownership."""
    record = application_repo.get_by_id(user_id=user_id, app_id=app_id)
    if not record:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Application '{app_id}' not found.",
        )
    return record


@router.post("/approve-package", response_model=ApplicationRecordDTO)
async def approve_package(
    req: ApprovePackageRequest,
    user_id: str = Depends(get_authenticated_user_id),
):
    """Approve resume & cover letter package from Application Studio, moving application to READY."""
    resume_id = req.tailoredResumeId or req.resumeId
    if not resume_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="tailoredResumeId or resumeId is required to approve package.",
        )
    try:
        return application_service.approve_package(
            user_id=user_id,
            job_id=req.jobId,
            tailored_resume_id=resume_id,
            cover_letter_id=req.coverLetterId,
            note=req.note,
        )
    except KeyError as ke:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(ke))
    except PermissionError as pe:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(pe))
    except Exception as e:
        logger.error(f"Error approving package for job {req.jobId}: {e}")
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))


@router.patch("/{app_id}/status", response_model=ApplicationRecordDTO)
async def update_status(
    app_id: str,
    req: UpdateApplicationStatusRequest,
    user_id: str = Depends(get_authenticated_user_id),
):
    """Execute a validated stage transition enforced by the backend state machine."""
    try:
        return application_service.transition_stage(
            user_id=user_id,
            app_id=app_id,
            new_status=req.newStatus,
            expected_status=req.expectedStatus,
            note=req.note,
            event_source=req.eventSource,
            applied_date=req.appliedDate,
            offer_outcome=req.offerOutcome,
        )
    except KeyError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Application '{app_id}' not found.",
        )
    except ValueError as ve:
        err_msg = str(ve)
        if "Status conflict" in err_msg:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=err_msg)
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=err_msg)
    except Exception as e:
        logger.error(f"Error updating status for application {app_id}: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))


@router.patch("/{app_id}/notes", response_model=ApplicationRecordDTO)
async def update_notes(
    app_id: str,
    req: UpdateApplicationNotesRequest,
    user_id: str = Depends(get_authenticated_user_id),
):
    """Update candidate scratchpad notes for an application."""
    record = application_repo.update_notes(user_id=user_id, app_id=app_id, notes=req.notes)
    if not record:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Application '{app_id}' not found.",
        )
    return record


@router.post("/{app_id}/interview", response_model=ApplicationRecordDTO)
async def add_interview_round(
    app_id: str,
    req: AddInterviewRoundRequest,
    user_id: str = Depends(get_authenticated_user_id),
):
    """Append a structured interview event and automatically transition to interviewing if applied."""
    round_event = InterviewRoundEvent(
        round=req.round,
        scheduledAt=req.scheduledAt,
        interviewer=req.interviewer,
        meetingLink=req.meetingLink,
        notes=req.notes,
    )
    record = application_repo.add_interview_round(
        user_id=user_id, app_id=app_id, round_event=round_event
    )
    if not record:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Application '{app_id}' not found.",
        )
    return record


@router.post("/sync-from-saved", response_model=list[ApplicationRecordDTO])
async def sync_from_saved(
    user_id: str = Depends(get_authenticated_user_id),
):
    """Idempotently sync saved discovery jobs into active applications."""
    try:
        return application_service.sync_from_saved_jobs(user_id=user_id)
    except Exception as e:
        logger.error(f"Error syncing saved jobs for user {user_id}: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))


@router.delete("/{app_id}", response_model=ApplicationRecordDTO)
async def soft_archive_application(
    app_id: str,
    user_id: str = Depends(get_authenticated_user_id),
):
    """Soft-archive an application record, preserving historical evidence and notes."""
    record = application_repo.soft_archive(user_id=user_id, app_id=app_id)
    if not record:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Application '{app_id}' not found.",
        )
    return record


# ---------------------------------------------------------------------------
# Phase 2 Playwright Form Autofill Endpoints
# ---------------------------------------------------------------------------

@router.post("/{app_id}/autofill/start", response_model=AutofillStartResponse)
async def start_autofill(
    app_id: str,
    user_id: str = Depends(get_authenticated_user_id),
):
    """Start a local headed desktop browser autofill session for a ready application."""
    record = application_repo.get_by_id(user_id=user_id, app_id=app_id)
    if not record:
        raise HTTPException(status_code=404, detail=f"Application '{app_id}' not found.")

    if record.status != ApplicationStage.READY:
        raise HTTPException(
            status_code=400,
            detail=f"Autofill is only available for applications in 'ready' stage. Current stage: '{record.status.value}'.",
        )

    if not record.resumeSnapshot:
        raise HTTPException(
            status_code=400,
            detail="Cannot start autofill without an approved tailored resume snapshot.",
        )

    active_session = playwright_autofill_engine.get_active_session_for_app(app_id)
    if active_session:
        raise HTTPException(
            status_code=409,
            detail=f"An active autofill session ({active_session.sessionId}) is already running for this application.",
        )

    profile = profile_service.get_profile(user_id)
    try:
        session = await playwright_autofill_engine.start_autofill_session(
            user_id=user_id,
            application=record,
            profile=profile,
        )
        return AutofillStartResponse(
            sessionId=session.sessionId,
            applicationId=session.applicationId,
            portalUrl=session.portalUrl,
            atsType=session.atsType,
            status=session.status,
            message="Desktop browser launched successfully.",
        )
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as e:
        logger.error(f"Failed to start autofill session for application {app_id}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to launch autofill: {e}")


@router.get("/{app_id}/autofill/events")
async def stream_autofill_events(
    app_id: str,
    session_id: str,
    user_id: Optional[str] = Query(default=None),
    x_user_id: Optional[str] = Header(default=None, alias="X-User-Id"),
):
    """Stream real-time Server-Sent Events (SSE) for an active autofill session."""
    session = playwright_autofill_engine.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail=f"Session '{session_id}' not found.")
    effective_user_id = user_id or x_user_id
    if effective_user_id and session.userId != effective_user_id:
        raise HTTPException(status_code=403, detail="Unauthorized access to this autofill session.")
    if session.applicationId != app_id:
        raise HTTPException(status_code=400, detail="Mismatched application ID for this session.")

    async def event_stream():
        async for event in playwright_autofill_engine.subscribe_events(session_id):
            yield f"data: {event.model_dump_json()}\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.get("/{app_id}/autofill/session", response_model=AutofillSessionDTO)
async def get_autofill_session(
    app_id: str,
    session_id: Optional[str] = None,
    user_id: str = Depends(get_authenticated_user_id),
):
    """Get current autofill session status snapshot for recovery or polling."""
    session = None
    if session_id:
        session = playwright_autofill_engine.get_session(session_id)
    else:
        session = playwright_autofill_engine.get_active_session_for_app(app_id)

    if not session:
        raise HTTPException(status_code=404, detail="No active or matching autofill session found.")
    if session.userId != user_id or session.applicationId != app_id:
        raise HTTPException(status_code=403, detail="Unauthorized access to this autofill session.")

    return session


@router.post("/{app_id}/autofill/cancel", response_model=AutofillSessionDTO)
async def cancel_autofill_session(
    app_id: str,
    session_id: str,
    user_id: str = Depends(get_authenticated_user_id),
):
    """Cancel an ongoing autofill session and close the desktop browser."""
    session = playwright_autofill_engine.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail=f"Session '{session_id}' not found.")
    if session.userId != user_id or session.applicationId != app_id:
        raise HTTPException(status_code=403, detail="Unauthorized access to this autofill session.")

    try:
        return await playwright_autofill_engine.cancel_session(session_id=session_id, user_id=user_id)
    except Exception as e:
        logger.error(f"Error cancelling autofill session {session_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to cancel session: {e}")


@router.post("/{app_id}/autofill/confirm-submission", response_model=ApplicationRecordDTO)
async def confirm_submission(
    app_id: str,
    req: ConfirmSubmissionRequest,
    user_id: str = Depends(get_authenticated_user_id),
):
    """Atomically advance application from Ready to Applied upon candidate manual submission."""
    session = playwright_autofill_engine.get_session(req.sessionId)
    if session:
        if session.userId != user_id or session.applicationId != app_id:
            raise HTTPException(status_code=403, detail="Unauthorized session confirmation.")
        # Best-effort cleanup of browser context
        await playwright_autofill_engine.cleanup_session(req.sessionId)

    try:
        return application_service.confirm_human_submission(
            user_id=user_id,
            app_id=app_id,
            note=req.notes or "Submitted manually on portal via Playwright autofill.",
        )
    except KeyError as ke:
        raise HTTPException(status_code=404, detail=str(ke))
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as e:
        logger.error(f"Error confirming submission for application {app_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Submission confirmation failed: {e}")
