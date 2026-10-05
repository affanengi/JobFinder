"""FastAPI Endpoints for AI Resume Tailoring, Deterministic Validation, and ReportLab PDF Rendering."""

import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Header, HTTPException, Response

from app.db.repositories.resume_repo import resume_repo
from app.schemas.resume import (
    ResumeValidationResult,
    StructuredResumeContent,
    TailoredResumeDTO,
    TailorResumeRequest,
    ValidateAndRenderRequest,
)
from app.services.job_service import job_service
from app.services.latex_template import latex_engine
from app.services.profile_service import profile_service
from app.services.reportlab_renderer import reportlab_renderer
from app.services.resume_generator import resume_generator
from app.services.resume_validator import resume_validator

logger = logging.getLogger("jobFinder.api.resumes")
router = APIRouter(prefix="/resumes", tags=["AI Resumes & Validation"])


@router.post("/tailor", response_model=TailoredResumeDTO)
async def tailor_resume(
    req: TailorResumeRequest,
    x_user_id: str | None = Header(default=None, alias="X-User-Id"),
    user_id: str | None = None,
) -> TailoredResumeDTO:
    """Tailor an ATS-optimized resume for a target job with 1-shot Gemini intelligence and deterministic validation."""
    active_uid = user_id or req.user_id or x_user_id or "user_default"
    logger.info(f"Tailoring resume for active user ID: {active_uid}")
    profile = profile_service.get_profile(user_id=active_uid)
    job = job_service.get_job(req.job_id)

    if not job:
        raise HTTPException(
            status_code=404,
            detail=f"Job opportunity with ID '{req.job_id}' not found.",
        )

    try:
        dto = await resume_generator.tailor_resume_for_job(
            job=job,
            profile=profile,
            custom_instructions=req.custom_instructions,
        )
        dto.userId = active_uid
        resume_repo.save_tailored_resume(dto)
        return dto
    except Exception as e:
        logger.error(f"Error tailoring resume: {e}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail=f"Failed to generate tailored resume: {e}",
        ) from e


@router.post("/validate-and-render")
@router.post("/validate-direct")
async def validate_and_render(
    content_or_req: StructuredResumeContent | ValidateAndRenderRequest,
    x_user_id: str | None = Header(default=None, alias="X-User-Id"),
    user_id: str | None = None,
) -> dict:
    """Validate user-edited structured resume content and produce updated LaTeX and validation status."""
    active_uid = user_id or x_user_id or "user_default"
    profile = profile_service.get_profile(user_id=active_uid)
    
    if isinstance(content_or_req, ValidateAndRenderRequest):
        structured = content_or_req.structured_content
    else:
        structured = content_or_req

    val_result: ResumeValidationResult = resume_validator.validate(structured, profile)
    latex_code = latex_engine.generate_latex(structured)

    return {
        "validationResult": val_result.model_dump(),
        "latexCode": latex_code,
    }


@router.post("/render-pdf-direct")
async def render_pdf_direct(
    content: StructuredResumeContent,
) -> Response:
    """Render StructuredResumeContent directly to streaming binary PDF bytes using ReportLab."""
    try:
        pdf_bytes = reportlab_renderer.render_to_pdf_bytes(content)
        return Response(
            content=pdf_bytes,
            media_type="application/pdf",
            headers={"Content-Disposition": "inline; filename=tailored_resume.pdf"},
        )
    except Exception as e:
        logger.error(f"ReportLab PDF rendering error: {e}")
        raise HTTPException(status_code=500, detail=f"PDF rendering error: {e}") from e


@router.put("/{resume_id}", response_model=TailoredResumeDTO)
async def update_resume(
    resume_id: str,
    content: StructuredResumeContent,
    x_user_id: str | None = Header(default=None, alias="X-User-Id"),
    user_id: str | None = None,
) -> TailoredResumeDTO:
    """Save manual edits to structured resume content in Firestore (Zero AI cost)."""
    active_uid = user_id or x_user_id or "user_default"
    existing = resume_repo.get_tailored_resume(resume_id)
    if not existing:
        raise HTTPException(status_code=404, detail=f"Resume '{resume_id}' not found.")

    profile = profile_service.get_profile(user_id=active_uid)
    val_result: ResumeValidationResult = resume_validator.validate(content, profile)
    latex_code = latex_engine.generate_latex(content)
    now_iso = datetime.now(timezone.utc).isoformat()

    updated_dto = TailoredResumeDTO(
        id=existing.id,
        userId=existing.userId,
        jobId=existing.jobId,
        jobTitle=existing.jobTitle,
        jobCompany=existing.jobCompany,
        structuredContent=content,
        validationResult=val_result,
        latexCode=latex_code,
        createdAt=existing.createdAt,
        updatedAt=now_iso,
    )

    resume_repo.save_tailored_resume(updated_dto)
    return updated_dto


@router.get("/{resume_id}/pdf")
async def get_resume_pdf(
    resume_id: str,
    x_user_id: str | None = Header(default=None, alias="X-User-Id"),
) -> Response:
    """Download or view compiled canonical ATS PDF by resume ID."""
    resume = resume_repo.get_tailored_resume(resume_id)
    if not resume:
        raise HTTPException(status_code=404, detail=f"Resume '{resume_id}' not found.")

    try:
        pdf_bytes = reportlab_renderer.render_to_pdf_bytes(resume.structuredContent)
        safe_co = resume.jobCompany.replace(" ", "_")
        return Response(
            content=pdf_bytes,
            media_type="application/pdf",
            headers={"Content-Disposition": f"inline; filename={safe_co}_{resume_id}.pdf"},
        )
    except Exception as e:
        logger.error(f"Error rendering PDF for resume {resume_id}: {e}")
        raise HTTPException(status_code=500, detail="Failed to render PDF.") from e


@router.get("/{resume_id}/tex")
async def get_resume_latex(
    resume_id: str,
    x_user_id: str | None = Header(default=None, alias="X-User-Id"),
) -> Response:
    """Download clean standalone LaTeX (.tex) source file."""
    resume = resume_repo.get_tailored_resume(resume_id)
    if not resume:
        raise HTTPException(status_code=404, detail=f"Resume '{resume_id}' not found.")

    safe_co = resume.jobCompany.replace(" ", "_")
    return Response(
        content=resume.latexCode,
        media_type="text/plain; charset=utf-8",
        headers={"Content-Disposition": f"attachment; filename={safe_co}_{resume_id}.tex"},
    )


@router.get("/job/{job_id}", response_model=TailoredResumeDTO | None)
async def get_resume_for_job(
    job_id: str,
    x_user_id: str | None = Header(default="user_default", alias="X-User-Id"),
    user_id: str | None = None,
):
    """Retrieve existing tailored resume for a specific job from Firestore (Zero AI calls)."""
    active_uid = user_id or x_user_id or "user_default"
    return resume_repo.get_resume_for_job(user_id=active_uid, job_id=job_id)


@router.get("", response_model=list[TailoredResumeDTO])
async def list_resumes(
    x_user_id: str | None = Header(default=None, alias="X-User-Id"),
    user_id: str | None = None,
) -> list[TailoredResumeDTO]:
    """List all saved tailored resumes for the authenticated candidate."""
    active_uid = user_id or x_user_id or "user_default"
    return resume_repo.list_user_resumes(user_id=active_uid)


@router.delete("/{resume_id}")
async def delete_resume(
    resume_id: str,
    x_user_id: str | None = Header(default=None, alias="X-User-Id"),
    user_id: str | None = None,
) -> dict:
    """Delete a tailored resume from Firestore."""
    active_uid = user_id or x_user_id or "user_default"
    success = resume_repo.delete_tailored_resume(resume_id=resume_id, user_id=active_uid)
    if not success:
        raise HTTPException(status_code=500, detail="Failed to delete resume from Firestore.")
    return {"status": "deleted", "id": resume_id}
