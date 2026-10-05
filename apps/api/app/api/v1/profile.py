"""Profile and Resume Ingestion API Endpoints with User-Scoped Firestore persistence."""

import logging

from fastapi import APIRouter, Depends, File, Header, HTTPException, UploadFile, status

from app.core.auth import get_authenticated_user_id
from app.schemas.profile import ApproveCandidateFactsRequest, AutofillProfile, Profile
from app.services.profile_service import profile_service
from app.services.resume_parser import ResumeParserService

logger = logging.getLogger("jobFinder.api.profile")
router = APIRouter(prefix="/profile", tags=["Profile & Resume"])

resume_parser_service = ResumeParserService()


@router.get("", response_model=Profile)
async def get_profile(
    user_id: str = Depends(get_authenticated_user_id),
    x_user_id: str | None = Header(default=None, alias="X-User-Id"),
):
    """Retrieve the authoritative master profile for the authenticated user."""
    if x_user_id and x_user_id != user_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Header X-User-Id does not match authenticated user.",
        )
    return profile_service.get_profile(user_id=user_id)


@router.post("/migrate", response_model=Profile)
async def migrate_profile(
    user_id: str = Depends(get_authenticated_user_id),
    x_user_id: str | None = Header(default=None, alias="X-User-Id"),
):
    """Explicit on-demand migration to persist verified Lodestar experience and canonical courses to Firestore."""
    if x_user_id and x_user_id != user_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Header X-User-Id does not match authenticated user.",
        )
    profile, _ = profile_service.sync_verified_profile(user_id=user_id)
    return profile


@router.put("", response_model=Profile)
async def update_profile(
    profile: Profile,
    user_id: str = Depends(get_authenticated_user_id),
    x_user_id: str | None = Header(default=None, alias="X-User-Id"),
):
    """Update profile facts and increment version for the authenticated user."""
    if x_user_id and x_user_id != user_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Header X-User-Id does not match authenticated user.",
        )
    profile.userId = user_id
    return profile_service.update_profile(profile)


@router.get("/autofill", response_model=AutofillProfile)
async def get_autofill_profile(
    user_id: str = Depends(get_authenticated_user_id),
    x_user_id: str | None = Header(default=None, alias="X-User-Id"),
):
    """Retrieve user-managed autofill configuration for deterministic form filling."""
    if x_user_id and x_user_id != user_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Header X-User-Id does not match authenticated user.",
        )
    return profile_service.get_autofill_profile(user_id=user_id)


@router.put("/autofill", response_model=AutofillProfile)
async def update_autofill_profile(
    autofill: AutofillProfile,
    user_id: str = Depends(get_authenticated_user_id),
    x_user_id: str | None = Header(default=None, alias="X-User-Id"),
):
    """Update user-managed autofill configuration.

    This endpoint NEVER updates or modifies the Verified Master Profile or candidate facts.
    """
    if x_user_id and x_user_id != user_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Header X-User-Id does not match authenticated user.",
        )
    return profile_service.update_autofill_profile(user_id=user_id, autofill_data=autofill)


@router.post("/upload-resume", response_model=Profile)
async def upload_and_parse_resume(
    file: UploadFile = File(...),
    user_id: str = Depends(get_authenticated_user_id),
    x_user_id: str | None = Header(default=None, alias="X-User-Id"),
):
    """Upload any resume PDF and extract candidate profile facts with unverified status."""
    if x_user_id and x_user_id != user_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Header X-User-Id does not match authenticated user.",
        )
    if not file.filename or not file.filename.lower().endswith((".pdf", ".docx", ".txt")):
        raise HTTPException(
            status_code=400,
            detail="Only .pdf, .docx, and .txt files are supported for resume import.",
        )

    try:
        contents = await file.read()
        candidate_profile = await resume_parser_service.parse_resume_to_candidate_profile(
            pdf_bytes=contents,
            filename=file.filename,
        )
        candidate_profile.userId = user_id
        return candidate_profile
    except Exception as e:
        logger.error(f"Error parsing uploaded resume: {e}")
        raise HTTPException(status_code=500, detail=f"Resume extraction failed: {str(e)}") from e


@router.post("/approve-extracted", response_model=Profile)
async def approve_and_merge_extracted_facts(
    candidate_profile: Profile,
    request: ApproveCandidateFactsRequest,
    user_id: str = Depends(get_authenticated_user_id),
    x_user_id: str | None = Header(default=None, alias="X-User-Id"),
):
    """Explicit user approval action to promote and cumulatively merge selected candidate facts to verified master facts."""
    if x_user_id and x_user_id != user_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Header X-User-Id does not match authenticated user.",
        )
    candidate_profile.userId = user_id
    return profile_service.approve_and_merge_extracted_facts(
        candidate_profile=candidate_profile,
        request=request,
        user_id=user_id,
    )
