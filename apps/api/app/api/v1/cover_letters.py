"""Cover Letter & Unified Application Artifacts API Endpoints."""

import io
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Header, HTTPException, Response
from fastapi.responses import StreamingResponse

from app.db.repositories.cover_letter_repo import cover_letter_repo
from app.schemas.application_artifacts import (
    GenerateArtifactsRequest,
    GenerateArtifactsResponse,
)
from app.schemas.cover_letter import (
    CoverLetterContent,
    TailoredCoverLetterDTO,
    UpdateCoverLetterRequest,
)
from app.services.cover_letter_latex_template import cover_letter_latex_engine
from app.services.cover_letter_validator import cover_letter_validator
from app.services.job_service import job_service
from app.services.profile_service import profile_service
from app.services.reportlab_cover_letter_renderer import reportlab_cover_letter_renderer
from app.services.resume_generator import format_cover_letter_markdown, resume_generator

logger = logging.getLogger("jobFinder.api.cover_letters")
router = APIRouter(tags=["Cover Letters & Application Artifacts"])


@router.post("/artifacts/generate", response_model=GenerateArtifactsResponse)
async def generate_application_artifacts(
    request: GenerateArtifactsRequest,
    x_user_id: str | None = Header(default="user_default", alias="X-User-Id"),
    user_id: str | None = None,
):
    """Generate or retrieve ATS Resume and Cover Letter for target job.
    
    Adheres strictly to Quota Rules:
    - If already generated and forceRegenerate=False, loads saved docs from Firestore (0 Gemini calls).
    - If mode='both' and generation needed, generates BOTH documents in a single 1-shot Gemini request.
    """
    active_uid = user_id or x_user_id or "user_default"
    job = job_service.get_job(request.jobId)
    if not job:
        raise HTTPException(status_code=404, detail=f"Job opportunity '{request.jobId}' not found.")

    profile = profile_service.get_profile(user_id=active_uid)
    if not profile:
        raise HTTPException(status_code=404, detail="Master Profile not found. Please create your profile first.")

    try:
        response = await resume_generator.generate_application_artifacts(
            job=job,
            profile=profile,
            mode=request.mode,
            tone=request.coverLetterTone,
            custom_instructions=request.customInstructions,
            force_regenerate=request.forceRegenerate,
        )
        return response
    except Exception as e:
        logger.error(f"Error generating artifacts for job {request.jobId}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Artifact generation failed: {str(e)}")


@router.get("/cover-letters", response_model=list[TailoredCoverLetterDTO])
async def list_cover_letters(
    x_user_id: str | None = Header(default="user_default", alias="X-User-Id"),
    user_id: str | None = None,
):
    """List all tailored cover letters saved for the authenticated candidate."""
    active_uid = user_id or x_user_id or "user_default"
    return cover_letter_repo.list_for_user(user_id=active_uid)


@router.get("/cover-letters/job/{job_id}", response_model=TailoredCoverLetterDTO | None)
async def get_cover_letter_for_job(
    job_id: str,
    x_user_id: str | None = Header(default="user_default", alias="X-User-Id"),
    user_id: str | None = None,
):
    """Retrieve existing tailored cover letter from Firestore without AI call."""
    active_uid = user_id or x_user_id or "user_default"
    letter = cover_letter_repo.get_by_user_and_job(user_id=active_uid, job_id=job_id)
    return letter


@router.put("/cover-letters/{letter_id}", response_model=TailoredCoverLetterDTO)
async def update_cover_letter(
    letter_id: str,
    request: UpdateCoverLetterRequest,
    x_user_id: str | None = Header(default="user_default", alias="X-User-Id"),
    user_id: str | None = None,
):
    """Save manual edits to a cover letter (Zero AI calls)."""
    active_uid = user_id or x_user_id or "user_default"
    existing = cover_letter_repo.get_by_id(letter_id)
    if not existing:
        raise HTTPException(status_code=404, detail=f"Cover letter '{letter_id}' not found.")

    profile = profile_service.get_profile(user_id=active_uid)
    val_result = cover_letter_validator.validate(request.content, profile)
    markdown_text = format_cover_letter_markdown(request.content)
    now_iso = datetime.now(timezone.utc).isoformat()

    updated_dto = TailoredCoverLetterDTO(
        id=existing.id,
        userId=existing.userId,
        jobId=existing.jobId,
        tone=request.tone,
        content=request.content,
        markdownText=markdown_text,
        validationResult=val_result,
        createdAt=existing.createdAt,
        updatedAt=now_iso,
    )

    saved = cover_letter_repo.save(updated_dto)
    return saved


@router.delete("/cover-letters/{letter_id}")
async def delete_cover_letter(
    letter_id: str,
    x_user_id: str | None = Header(default="user_default", alias="X-User-Id"),
    user_id: str | None = None,
):
    """Delete a tailored cover letter from Firestore."""
    active_uid = user_id or x_user_id or "user_default"
    existing = cover_letter_repo.get_by_id(letter_id)
    if not existing:
        raise HTTPException(status_code=404, detail=f"Cover letter '{letter_id}' not found.")
    
    success = cover_letter_repo.delete(letter_id)
    if not success:
        raise HTTPException(status_code=500, detail="Failed to delete cover letter.")
    return {"status": "deleted", "id": letter_id}


@router.get("/cover-letters/{letter_id}/pdf")
async def download_cover_letter_pdf(letter_id: str):
    """Render and stream deterministic ATS Cover Letter PDF using ReportLab (bash local cost)."""
    letter = cover_letter_repo.get_by_id(letter_id)
    if not letter:
        raise HTTPException(status_code=404, detail=f"Cover letter '{letter_id}' not found.")

    try:
        pdf_bytes = reportlab_cover_letter_renderer.render_to_bytes(letter.content)
        sanitized_company = "".join(c for c in letter.content.companyName if c.isalnum() or c in ("-", "_")).strip()
        filename = f"Cover_Letter_{sanitized_company or 'Application'}.pdf"

        return StreamingResponse(
            io.BytesIO(pdf_bytes),
            media_type="application/pdf",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )
    except Exception as e:
        logger.error(f"Error rendering ReportLab Cover Letter PDF: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"PDF rendering error: {str(e)}")


@router.get("/cover-letters/{letter_id}/tex")
async def download_cover_letter_latex(letter_id: str):
    """Generate and download Overleaf-compatible LaTeX (.tex) source code (bash local cost)."""
    letter = cover_letter_repo.get_by_id(letter_id)
    if not letter:
        raise HTTPException(status_code=404, detail=f"Cover letter '{letter_id}' not found.")

    try:
        latex_code = cover_letter_latex_engine.generate_latex(letter.content)
        sanitized_company = "".join(c for c in letter.content.companyName if c.isalnum() or c in ("-", "_")).strip()
        filename = f"Cover_Letter_{sanitized_company or 'Application'}.tex"

        return Response(
            content=latex_code,
            media_type="text/plain; charset=utf-8",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )
    except Exception as e:
        logger.error(f"Error generating Cover Letter LaTeX: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"LaTeX generation error: {str(e)}")


@router.get("/cover-letters/{letter_id}/markdown")
async def download_cover_letter_markdown(letter_id: str):
    """Download tailored cover letter as clean Markdown."""
    letter = cover_letter_repo.get_by_id(letter_id)
    if not letter:
        raise HTTPException(status_code=404, detail=f"Cover letter '{letter_id}' not found.")

    sanitized_company = "".join(c for c in letter.content.companyName if c.isalnum() or c in ("-", "_")).strip()
    filename = f"Cover_Letter_{sanitized_company or 'Application'}.md"

    return Response(
        content=letter.markdownText,
        media_type="text/markdown",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("/cover-letters/render-pdf-direct")
async def render_cover_letter_pdf_direct(content: CoverLetterContent):
    """Render CoverLetterContent directly to streaming binary PDF bytes using ReportLab (bash local cost)."""
    try:
        pdf_bytes = reportlab_cover_letter_renderer.render_to_bytes(content)
        return Response(
            content=pdf_bytes,
            media_type="application/pdf",
            headers={"Content-Disposition": "inline; filename=cover_letter.pdf"},
        )
    except Exception as e:
        logger.error(f"ReportLab Cover Letter PDF direct rendering error: {e}")
        raise HTTPException(status_code=500, detail=f"PDF rendering error: {e}") from e
