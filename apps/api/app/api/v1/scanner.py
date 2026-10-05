"""FastAPI Endpoints for 100-Point ATS Resume Scanner, Bulk AI Bullet Optimization & Saved Reports."""

import hashlib
import logging
import uuid
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, File, Form, Header, HTTPException, UploadFile

from pydantic import BaseModel

from app.db.repositories.resume_repo import resume_repo
from app.db.repositories.scan_report_repo import scan_report_repo
from app.schemas.job_analysis import AtsEvidenceAuditReport
from app.schemas.scanner import (
    AiBulletRewriteRequest,
    AiBulletRewriteResponse,
    AtsScanResult,
    BulkAiBulletRewriteRequest,
    BulkAiBulletRewriteResponse,
    SavedScanReportDTO,
    SaveScanReportRequest,
    ScanTailoredRequest,
)
from app.services.ats_scanner_engine import ats_scanner_engine
from app.services.job_service import job_service

logger = logging.getLogger("jobFinder.api.scanner")
router = APIRouter(prefix="/scanner", tags=["ATS Resume Scanner & Keyword Matcher"])


@router.post("/scan-tailored", response_model=AtsScanResult)
async def scan_tailored_resume(
    req: ScanTailoredRequest,
    x_user_id: Optional[str] = Header(default=None, alias="X-User-Id"),
    user_id: Optional[str] = None,
) -> AtsScanResult:
    """
    Perform a 100% deterministic 100-Point ATS Scan on an existing saved tailored resume.
    Zero AI calls, sub-second execution.
    """
    active_uid = user_id or x_user_id or "user_default"
    resume = resume_repo.get_tailored_resume(req.resume_id)
    if not resume:
        raise HTTPException(
            status_code=404,
            detail=f"Tailored resume '{req.resume_id}' not found.",
        )

    # Resolve target job if specified or linked on resume
    target_job_id = req.job_id or resume.jobId
    job_data = None
    if target_job_id and target_job_id != "general":
        job = job_service.get_job(target_job_id)
        if job:
            job_data = job.model_dump()

    # Convert resume DTO to structured dict for scanner
    resume_dict = {
        "id": resume.id,
        "jobId": resume.jobId,
        "targetRole": resume.jobTitle,
        "content": resume.structuredContent.model_dump() if hasattr(resume.structuredContent, "model_dump") else resume.structuredContent
    }

    try:
        result = ats_scanner_engine.scan_tailored_resume(resume_dict, job_data)
        return result
    except Exception as e:
        logger.error(f"Error during ATS scan: {e}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail=f"Failed to scan resume: {e}",
        ) from e


@router.post("/scan-file", response_model=AtsScanResult)
async def scan_raw_file(
    file: UploadFile = File(...),
    job_id: Optional[str] = Form(default=None),
    job_description: Optional[str] = Form(default=None),
) -> AtsScanResult:
    """
    Scan an uploaded raw PDF, DOCX, or TXT resume against an optional target job description.
    Deterministic text extraction and taxonomy evaluation.
    """
    try:
        file_bytes = await file.read()
        if not file_bytes:
            raise HTTPException(status_code=400, detail="Uploaded file is empty.")

        resolved_jd = job_description or ""
        if job_id and job_id != "general" and not resolved_jd:
            job = job_service.get_job(job_id)
            if job:
                resolved_jd = f"{job.title}\n{job.description}\n{' '.join(job.requiredSkills)}"

        result = ats_scanner_engine.scan_raw_resume_bytes(
            file_bytes=file_bytes,
            filename=file.filename or "resume.pdf",
            content_type=file.content_type or "application/pdf",
            job_description=resolved_jd if resolved_jd else None,
        )
        return result
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error processing uploaded resume file: {e}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail=f"Failed to process and scan resume file: {e}",
        ) from e


@router.post("/ai-bullet-rewrite", response_model=AiBulletRewriteResponse)
async def ai_bullet_rewrite(
    req: AiBulletRewriteRequest,
) -> AiBulletRewriteResponse:
    """
    Generate 3 high-impact, grounded ATS bullet point rewrites for a single bullet.
    Invoked ONLY on explicit user request.
    """
    try:
        response = await ats_scanner_engine.generate_ai_bullet_suggestions(
            bullet_text=req.bullet_text,
            role_or_project=req.role_or_project,
            section=req.section,
            job_title=req.job_title,
            job_description=req.job_description,
        )
        return response
    except Exception as e:
        logger.error(f"Error generating AI bullet rewrites: {e}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail=f"Failed to generate bullet suggestions: {e}",
        ) from e


@router.post("/bulk-ai-bullet-rewrite", response_model=BulkAiBulletRewriteResponse)
async def bulk_ai_bullet_rewrite(
    req: BulkAiBulletRewriteRequest,
) -> BulkAiBulletRewriteResponse:
    """
    Generate Set A and Set B grounded ATS bullet point rewrites for N selected bullets in 1 single Gemini request.
    Strictly enforced: N in -> N in Set A, N in Set B. Zero hallucination/fabrication.
    """
    try:
        response = await ats_scanner_engine.generate_bulk_ai_bullet_suggestions(
            bullets=req.bullets,
            job_title=req.job_title,
            job_description=req.job_description,
        )
        return response
    except Exception as e:
        logger.error(f"Error generating bulk AI bullet rewrites: {e}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail=f"Failed to generate bulk bullet suggestions: {e}",
        ) from e


# =========================================================================
# SAVED ATS SCAN REPORT ENDPOINTS
# =========================================================================

@router.post("/reports", response_model=SavedScanReportDTO)
async def save_scan_report(
    req: SaveScanReportRequest,
    x_user_id: Optional[str] = Header(default=None, alias="X-User-Id"),
    user_id: Optional[str] = None,
) -> SavedScanReportDTO:
    """Save an immutable snapshot of an ATS scan result to Cloud Firestore."""
    active_uid = user_id or x_user_id or "user_default"
    now_iso = datetime.now(timezone.utc).isoformat()
    report_id = f"scan-rep-{uuid.uuid4().hex[:10]}"

    res_id = req.scanResult.metadata.resume_id
    source_type = req.scanResult.metadata.source_type
    job_id = req.scanResult.metadata.job_id

    # Compute a deterministic content hash if tailored resume
    content_hash = None
    job_title = None
    job_company = None

    if res_id:
        resume = resume_repo.get_tailored_resume(res_id)
        if resume:
            job_title = resume.jobTitle
            job_company = resume.jobCompany
            raw_str = f"{resume.id}_{resume.updatedAt}_{req.scanResult.overall_score}"
            content_hash = hashlib.sha256(raw_str.encode()).hexdigest()[:16]

    default_name = req.reportName
    if not default_name:
        if job_title:
            default_name = f"{job_company or 'Company'} — {job_title}"
        elif req.scanResult.metadata.file_name:
            default_name = f"Uploaded: {req.scanResult.metadata.file_name}"
        else:
            default_name = f"ATS Scan Report ({req.scanResult.grade} - {req.scanResult.overall_score} pts)"

    report_dto = SavedScanReportDTO(
        id=report_id,
        userId=active_uid,
        reportName=default_name,
        sourceType=source_type,
        resumeId=res_id,
        resumeContentHash=content_hash,
        jobId=job_id,
        jobTitle=job_title,
        jobCompany=job_company,
        overallScore=req.scanResult.overall_score,
        grade=req.scanResult.grade,
        scanResult=req.scanResult,
        taxonomyVersion=req.scanResult.metadata.taxonomy_version or "1.0.0",
        createdAt=now_iso,
        updatedAt=now_iso,
    )

    saved = scan_report_repo.save_report(report_dto)
    return saved


@router.get("/reports", response_model=List[SavedScanReportDTO])
async def list_saved_scan_reports(
    x_user_id: Optional[str] = Header(default=None, alias="X-User-Id"),
    user_id: Optional[str] = None,
) -> List[SavedScanReportDTO]:
    """List all saved ATS scan reports for authenticated candidate."""
    active_uid = user_id or x_user_id or "user_default"
    return scan_report_repo.list_reports_for_user(user_id=active_uid)


@router.get("/reports/{report_id}", response_model=SavedScanReportDTO)
async def get_saved_scan_report(
    report_id: str,
    x_user_id: Optional[str] = Header(default=None, alias="X-User-Id"),
    user_id: Optional[str] = None,
) -> SavedScanReportDTO:
    """Retrieve a single immutable saved ATS scan report."""
    active_uid = user_id or x_user_id or "user_default"
    report = scan_report_repo.get_report_by_id(report_id)
    if not report:
        raise HTTPException(
            status_code=404,
            detail=f"Saved ATS scan report '{report_id}' not found.",
        )
    return report


@router.delete("/reports/{report_id}")
async def delete_saved_scan_report(
    report_id: str,
    x_user_id: Optional[str] = Header(default=None, alias="X-User-Id"),
    user_id: Optional[str] = None,
) -> dict:
    """Delete a saved ATS scan report."""
    active_uid = user_id or x_user_id or "user_default"
    report = scan_report_repo.get_report_by_id(report_id)
    if not report:
        raise HTTPException(
            status_code=404,
            detail=f"Saved ATS scan report '{report_id}' not found.",
        )
    success = scan_report_repo.delete_report(report_id)
    if not success:
        raise HTTPException(status_code=500, detail="Failed to delete scan report.")
    return {"status": "deleted", "id": report_id}


class ScanAtsEvidenceRequest(BaseModel):
    resume_id: str
    job_id: Optional[str] = None


@router.post("/ats-evidence", response_model=AtsEvidenceAuditReport)
async def audit_ats_evidence_endpoint(
    req: ScanAtsEvidenceRequest,
    x_user_id: Optional[str] = Header(default=None, alias="X-User-Id"),
    user_id: Optional[str] = None,
) -> AtsEvidenceAuditReport:
    """Audit ATS Evidence and decouple ATS Compatibility Score from Truth Integrity."""
    active_uid = user_id or x_user_id or "user_default"
    resume = resume_repo.get_tailored_resume(req.resume_id)
    if not resume:
        raise HTTPException(status_code=404, detail=f"Tailored resume '{req.resume_id}' not found.")

    target_job_id = req.job_id or resume.jobId
    if not target_job_id or target_job_id == "general":
        raise HTTPException(status_code=400, detail="Target job ID is required for ATS Evidence Audit.")

    job = job_service.get_job(target_job_id)
    if not job:
        raise HTTPException(status_code=404, detail=f"Target job '{target_job_id}' not found.")

    from app.services.job_analysis_service import job_analysis_service
    from app.services.ats_evidence_auditor import ats_evidence_auditor
    from app.services.profile_service import profile_service

    job_analysis = await job_analysis_service.analyze_job(job=job, user_id=active_uid)
    profile = profile_service.get_profile(user_id=active_uid)

    return ats_evidence_auditor.audit_ats_evidence(
        resume=resume.structuredContent,
        job_analysis=job_analysis,
        profile=profile,
        resume_id=resume.id,
    )

