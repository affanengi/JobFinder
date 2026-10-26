"""FastAPI Endpoints for 100-Point ATS Resume Scanner, Bulk AI Bullet Optimization & Saved Reports."""

import hashlib
import logging
import uuid
import io
import time
import zipfile
from datetime import datetime, timezone
from typing import Any, Dict, List, Literal, Optional

from fastapi import APIRouter, Depends, File, Form, Header, HTTPException, Request, UploadFile, status

from pydantic import BaseModel

from app.ai.errors import (
    AIAuthenticationError,
    AIConfigurationError,
    AIOutputValidationError,
    AIProviderError,
    AIProviderUnavailableError,
)
from app.ai.hub.crypto import sanitize_text
from app.ai.hub.models import ExecutionRequest
from app.ai.hub.orchestrator import ai_orchestrator
from app.ai.hub.types import AITaskType
from app.core.auth import get_authenticated_user_id, get_optional_authenticated_user_id
from app.db.repositories.resume_repo import resume_repo
from app.db.repositories.scan_report_repo import scan_report_repo
from app.schemas.job_analysis import AtsEvidenceAuditReport
from app.schemas.scanner import (
    AiBulletRewriteRequest,
    AiBulletRewriteResponse,
    AtsAnalysisResult,
    AtsScanRequest,
    AtsScanResponse,
    AtsScanResult,
    BulkAiBulletRewriteRequest,
    BulkAiBulletRewriteResponse,
    CategoryScore,
    ChecklistItem,
    KeywordMatrix,
    SavedScanReportDTO,
    SaveScanReportRequest,
    ScanMetadata,
    ScanProvenanceMetadata,
    ScanTailoredRequest,
    TruthLockAuditReport,
)
from app.services.ats_evidence_auditor import ats_evidence_auditor
from app.services.ats_prompt_builder import AtsPromptBuilder
from app.services.ats_scanner_engine import ats_scanner_engine
from app.services.job_service import job_service
from app.services.profile_service import profile_service

logger = logging.getLogger("jobFinder.api.scanner")
router = APIRouter(prefix="/scanner", tags=["ATS Resume Scanner & Keyword Matcher"])

SCANNER_MAX_UPLOAD_BYTES = 5 * 1024 * 1024  # 5 MB
SCANNER_DOCX_MAX_UNCOMPRESSED_BYTES = 15 * 1024 * 1024  # 15 MB
SCANNER_DOCX_MAX_RATIO = 10.0  # 10:1 ratio
SCANNER_GUEST_MAX_UPLOADS_PER_HOUR = 5
SCANNER_GUEST_WINDOW_SECONDS = 3600

_guest_upload_timestamps: Dict[str, List[float]] = {}


def check_and_record_guest_upload(client_ip: str) -> None:
    now = time.time()
    history = _guest_upload_timestamps.get(client_ip, [])
    history = [t for t in history if now - t < SCANNER_GUEST_WINDOW_SECONDS]
    if len(history) >= SCANNER_GUEST_MAX_UPLOADS_PER_HOUR:
        _guest_upload_timestamps[client_ip] = history
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Guest file scan rate limit exceeded (maximum 5 uploads per hour). Please sign in or try again later.",
            headers={"Retry-After": "3600"},
        )
    history.append(now)
    _guest_upload_timestamps[client_ip] = history


def serialize_structured_resume_to_text(structured_content: Any) -> str:
    """Safely convert structured resume models or dictionaries into readable plain resume text."""
    if isinstance(structured_content, str):
        return structured_content

    lines: list[str] = []

    personal = getattr(structured_content, "personal", None) or (
        structured_content.get("personal") if isinstance(structured_content, dict) else None
    )
    if personal:
        name = getattr(personal, "fullName", None) or (
            personal.get("fullName") if isinstance(personal, dict) else ""
        )
        email = getattr(personal, "email", None) or (
            personal.get("email") if isinstance(personal, dict) else ""
        )
        if name or email:
            lines.append(f"{name} | {email}".strip(" |"))

    summary = getattr(structured_content, "summary", None) or (
        structured_content.get("summary") if isinstance(structured_content, dict) else ""
    )
    if summary:
        lines.append(f"\nSUMMARY\n{summary}")

    experience = getattr(structured_content, "experience", None) or (
        structured_content.get("experience") if isinstance(structured_content, dict) else []
    )
    if isinstance(experience, list):
        lines.append("\nEXPERIENCE")
        for exp in experience:
            title = getattr(exp, "title", None) or (exp.get("title") if isinstance(exp, dict) else "")
            company = getattr(exp, "company", None) or (exp.get("company") if isinstance(exp, dict) else "")
            bullets = getattr(exp, "bullets", None) or (exp.get("bullets") if isinstance(exp, dict) else [])
            lines.append(f"{title} at {company}".strip())
            if isinstance(bullets, list):
                for b in bullets:
                    b_text = getattr(b, "text", None) or (b.get("text") if isinstance(b, dict) else str(b))
                    lines.append(f"- {b_text}")

    projects = getattr(structured_content, "projects", None) or (
        structured_content.get("projects") if isinstance(structured_content, dict) else []
    )
    if isinstance(projects, list):
        lines.append("\nPROJECTS")
        for proj in projects:
            p_name = getattr(proj, "name", None) or (proj.get("name") if isinstance(proj, dict) else "")
            techs = getattr(proj, "technologies", None) or (proj.get("technologies") if isinstance(proj, dict) else [])
            p_bullets = getattr(proj, "bullets", None) or (proj.get("bullets") if isinstance(proj, dict) else [])
            tech_str = ", ".join(str(t) for t in techs) if isinstance(techs, list) else ""
            lines.append(f"{p_name} ({tech_str})".strip())
            if isinstance(p_bullets, list):
                for b in p_bullets:
                    b_text = getattr(b, "text", None) or (b.get("text") if isinstance(b, dict) else str(b))
                    lines.append(f"- {b_text}")

    skills = getattr(structured_content, "skills", None) or (
        structured_content.get("skills") if isinstance(structured_content, dict) else []
    )
    if isinstance(skills, list):
        lines.append("\nSKILLS")
        for s in skills:
            cat = getattr(s, "category", None) or (s.get("category") if isinstance(s, dict) else "")
            items = getattr(s, "items", None) or (s.get("items") if isinstance(s, dict) else [])
            item_str = ", ".join(str(i) for i in items) if isinstance(items, list) else ""
            lines.append(f"{cat}: {item_str}")

    education = getattr(structured_content, "education", None) or (
        structured_content.get("education") if isinstance(structured_content, dict) else []
    )
    if isinstance(education, list):
        lines.append("\nEDUCATION")
        for edu in education:
            deg = getattr(edu, "degree", None) or (edu.get("degree") if isinstance(edu, dict) else "")
            inst = getattr(edu, "institution", None) or (edu.get("institution") if isinstance(edu, dict) else "")
            lines.append(f"{deg} from {inst}".strip())

    certifications = getattr(structured_content, "course_certifications", None) or (
        structured_content.get("course_certifications") if isinstance(structured_content, dict) else []
    )
    if isinstance(certifications, list):
        lines.append("\nCERTIFICATIONS")
        for cert in certifications:
            c_title = getattr(cert, "title", None) or (cert.get("title") if isinstance(cert, dict) else "")
            lines.append(f"- {c_title}")

    return "\n".join(lines).strip()


@router.post("/scan", response_model=AtsScanResponse)
async def scan_resume_ai_first(
    req: AtsScanRequest,
    user_id: str = Depends(get_authenticated_user_id),
    x_user_id: Optional[str] = Header(default=None, alias="X-User-Id"),
) -> AtsScanResponse:
    """
    Primary Modernized AI-First ATS Resume Scanner Endpoint (Phase 5).

    Orchestrates:
    1. Strict tenant isolation & authorization checks.
    2. Input normalization and validation limits.
    3. Retrieval of verified Master Profile candidate facts.
    4. Task-specific prompt synthesis with AtsPromptBuilder.
    5. AI Hub routing & execution via AIOrchestrator for AITaskType.ATS_SCAN_ANALYSIS.
    6. Strict Pydantic structured output validation against AtsAnalysisResult.
    7. Deterministic truth-lock audit via AtsEvidenceAuditorService.
    8. Guaranteed preservation of original AI contextual score.
    9. Optional authorized persistence through scan_report_repo.
    """
    # 1. Authorization check
    if x_user_id and x_user_id != user_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Header X-User-Id does not match authenticated user.",
        )

    # 2. Resolve Resume Text
    resume_text = ""
    resume_dto = None
    if req.resume_id:
        resume_dto = resume_repo.get_tailored_resume(req.resume_id)
        if not resume_dto:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Tailored resume '{req.resume_id}' not found.",
            )
        if resume_dto.userId != user_id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Unauthorized access to resume.",
            )
        resume_text = serialize_structured_resume_to_text(resume_dto.structuredContent)
    elif req.raw_resume_text:
        resume_text = req.raw_resume_text.strip()
    else:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Either 'resume_id' or 'raw_resume_text' must be provided.",
        )

    if len(resume_text.strip()) < 50:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Resume content is too short (< 50 characters) to analyze.",
        )

    # 3. Resolve Target Job Description
    job_description = ""
    target_job_id = req.job_id or (
        resume_dto.jobId if resume_dto and resume_dto.jobId != "general" else None
    )
    job_title = None
    job_company = None

    if target_job_id:
        job = job_service.get_job(target_job_id)
        if not job and req.job_id:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Target job '{target_job_id}' not found.",
            )
        if job:
            job_title = job.title
            job_company = job.company
            job_description = (job.description or "").strip()
            if job_title and job_title not in job_description:
                job_description = f"Job Title: {job_title}\nCompany: {job_company or ''}\n\n{job_description}"

    if not job_description and req.job_description:
        job_description = req.job_description.strip()

    if len(job_description.strip()) < 20:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Job description is too short (< 20 characters) or missing.",
        )

    # 4. Load Verified Canonical Profile Facts
    candidate_facts: list[str] = []
    profile = None
    try:
        profile = profile_service.get_profile(user_id=user_id)
        if profile and profile.userId == user_id:
            for exp in profile.experience:
                for b in exp.bullets:
                    candidate_facts.append(f"Experience: {b}")
            for edu in profile.education:
                candidate_facts.append(f"Degree: {edu.degree} from {edu.institution}")
            for s in profile.skills:
                if s.verified:
                    candidate_facts.append(f"Verified Skill: {s.name}")
    except Exception as e:
        logger.warning(f"Could not load canonical profile for user {user_id}: {e}")

    # 5. Build AI Prompt using AtsPromptBuilder
    system_instruction = AtsPromptBuilder.build_system_instruction()
    prompt = AtsPromptBuilder.build_analysis_prompt(
        resume_text=resume_text,
        job_description=job_description,
        candidate_facts=candidate_facts,
        role_category=req.role_category,
    )

    # 6. AI Hub Execution via Orchestrator with Tracked Operation ID
    scan_op_id = f"op_{uuid.uuid4().hex[:12]}"
    execution_req = ExecutionRequest(
        task=AITaskType.ATS_SCAN_ANALYSIS,
        user_id=user_id,
        operation_id=scan_op_id,
        prompt=prompt,
        system_instruction=system_instruction,
        schema_cls=AtsAnalysisResult,
        temperature=0.1,
    )

    try:
        response = await ai_orchestrator.execute(request=execution_req)
    except AIAuthenticationError as e:
        logger.error(f"AI Hub authentication failure during scan: {e}")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="AI credential authentication failed. Please verify provider settings.",
        ) from e
    except AIConfigurationError as e:
        logger.error(f"AI Hub routing configuration error: {e}")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="No eligible AI model route available matching task requirements or cost policy.",
        ) from e
    except AIProviderUnavailableError as e:
        logger.warning(f"AI Provider unavailable or in cooldown: {e}")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="AI service is temporarily unavailable. Please retry in a few moments.",
        ) from e
    except AIOutputValidationError as e:
        logger.error(f"AI output validation error: {e}")
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="AI analysis returned invalid or unparseable structured response.",
        ) from e
    except AIProviderError as e:
        err_msg = str(e).lower()
        if "quota" in err_msg or "429" in err_msg or "rate limit" in err_msg:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="AI provider rate limit or quota exceeded. Please try again later.",
            ) from e
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"AI provider error: {sanitize_text(str(e))}",
        ) from e
    except Exception as e:
        logger.error(f"Unexpected error during AI Hub execution: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="An unexpected error occurred during AI ATS analysis.",
        ) from e

    # 7. Extract validated Pydantic model
    analysis: AtsAnalysisResult
    if isinstance(response.structured_data, AtsAnalysisResult):
        analysis = response.structured_data
    elif response.structured_data:
        analysis = AtsAnalysisResult.model_validate(response.structured_data)
    elif response.text:
        analysis = AtsAnalysisResult.model_validate_json(response.text)
    else:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="AI model generated empty analysis output.",
        )

    # 8. Deterministic Truth-Lock Evidence Audit
    audit_report = ats_evidence_auditor.audit_contextual_analysis(
        analysis=analysis,
        raw_resume_text=resume_text,
        profile=profile,
        job_description=job_description,
        authenticated_user_id=user_id,
    )

    # 9. Scan Provenance Construction
    provenance = ScanProvenanceMetadata(
        scoring_version="v2_ai_first",
        operation_id=scan_op_id,
        provider_used=str(
            response.provider_used.value
            if hasattr(response.provider_used, "value")
            else response.provider_used
        ),
        model_used=response.model_used,
        credential_id_used=response.credential_id_used,
        latency_ms=round(response.latency_ms, 2),
        timestamp=datetime.now(timezone.utc).isoformat(),
        tenant_isolated=True,
        truth_lock_passed=audit_report.is_valid,
    )

    # 10. Optional Report Persistence (strictly guarded by acceptance policy)
    saved_report_id = None
    if req.save_report and audit_report.is_valid:
        try:
            rep_id = f"scan-rep-{uuid.uuid4().hex[:10]}"
            now_iso = datetime.now(timezone.utc).isoformat()
            grade_val: Literal["A+", "A", "B", "C", "D"] = (
                "A+" if analysis.overall_score >= 90
                else "A" if analysis.overall_score >= 80
                else "B" if analysis.overall_score >= 70
                else "C" if analysis.overall_score >= 60
                else "D"
            )
            ov = float(analysis.overall_score)
            p1_score = min(25.0, round(25.0 * (ov / 100.0), 1))
            p2_score = min(30.0, round(30.0 * (ov / 100.0), 1))
            p3_score = min(25.0, round(25.0 * (ov / 100.0), 1))
            rem = ov - (p1_score + p2_score + p3_score)
            p4_score = min(20.0, max(0.0, round(rem, 1) if rem > 0 else round(20.0 * (ov / 100.0), 1)))

            cat_scores = {
                "parseability": CategoryScore(
                    name="ATS Parseability & Format",
                    score=p1_score,
                    max_score=25.0,
                    percentage=round((p1_score / 25.0) * 100.0, 1),
                    status="pass" if p1_score >= 20.0 else ("warning" if p1_score >= 15.0 else "fail"),
                    summary="Evaluates standard headers, typographic hierarchy, contact details, and glyph safety.",
                    checks=[],
                ),
                "keyword_match": CategoryScore(
                    name="Technical Keyword & Competency Alignment",
                    score=p2_score,
                    max_score=30.0,
                    percentage=round((p2_score / 30.0) * 100.0, 1),
                    status="pass" if p2_score >= 24.0 else ("warning" if p2_score >= 18.0 else "fail"),
                    summary="Matches technical taxonomy terms against target role requirements.",
                    checks=[],
                ),
                "impact_verbs": CategoryScore(
                    name="Impact, Action Verbs & Quantified Metrics",
                    score=p3_score,
                    max_score=25.0,
                    percentage=round((p3_score / 25.0) * 100.0, 1),
                    status="pass" if p3_score >= 20.0 else ("warning" if p3_score >= 15.0 else "fail"),
                    summary="Audits bullet points for strong power verbs, quantifiable metrics, and active phrasing.",
                    checks=[],
                ),
                "structural_integrity": CategoryScore(
                    name="Structural Integrity & Content Density",
                    score=p4_score,
                    max_score=20.0,
                    percentage=round((p4_score / 20.0) * 100.0, 1),
                    status="pass" if p4_score >= 16.0 else ("warning" if p4_score >= 12.0 else "fail"),
                    summary="Checks professional summary depth, bullet scannability, and section completeness.",
                    checks=[],
                ),
            }

            # Create synthetic AtsScanResult for backward-compatible storage
            scan_result_payload = AtsScanResult(
                overall_score=analysis.overall_score,
                grade=grade_val,
                summary=analysis.executive_summary,
                category_scores=cat_scores,
                keyword_matrix=KeywordMatrix(),
                bullet_audits=[],
                actionable_checklist=[],
                analysis_mode="contextual_ai",
                metadata=ScanMetadata(
                    resume_id=req.resume_id,
                    job_id=target_job_id,
                    source_type="tailored_resume" if req.resume_id else "file_upload",
                    scoring_version="v2_ai_first",
                ),
            )
            rep_dto = SavedScanReportDTO(
                id=rep_id,
                userId=user_id,
                reportName=req.report_name or f"AI ATS Scan — {job_title or 'Target Role'}",
                sourceType="tailored_resume" if req.resume_id else "file_upload",
                resumeId=req.resume_id,
                jobId=target_job_id,
                jobTitle=job_title,
                jobCompany=job_company,
                overallScore=analysis.overall_score,
                grade=grade_val,
                scanResult=scan_result_payload,
                scoring_version="v2_ai_first",
                ai_analysis=analysis,
                audit_report=audit_report,
                provenance=provenance,
                createdAt=now_iso,
                updatedAt=now_iso,
            )
            scan_report_repo.save_report(rep_dto)
            saved_report_id = rep_id
        except Exception as e:
            logger.error(f"Failed to persist verified scan report: {e}")

    return AtsScanResponse(
        analysis=analysis,
        audit_report=audit_report,
        provenance=provenance,
        saved_report_id=saved_report_id,
    )


@router.post("/scan-tailored", response_model=AtsScanResult)
async def scan_tailored_resume(
    req: ScanTailoredRequest,
    user_id: str = Depends(get_authenticated_user_id),
    x_user_id: Optional[str] = Header(default=None, alias="X-User-Id"),
) -> AtsScanResult:
    """
    Perform a 100% deterministic 100-Point ATS Scan on an existing saved tailored resume.
    Zero AI calls, sub-second execution.

    Legacy v1_heuristic scoring retained for backward compatibility.
    For AI-First contextual scanning with truth integrity, use POST /api/v1/scanner/scan.
    """
    if x_user_id and x_user_id != user_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Header X-User-Id does not match authenticated user.",
        )
    resume = resume_repo.get_tailored_resume(req.resume_id)
    if not resume:
        raise HTTPException(
            status_code=404,
            detail=f"Tailored resume '{req.resume_id}' not found.",
        )
    if resume.userId != user_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Unauthorized access to resume.",
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
    request: Request,
    file: UploadFile = File(...),
    job_id: Optional[str] = Form(default=None),
    job_description: Optional[str] = Form(default=None),
    user_id: Optional[str] = Depends(get_optional_authenticated_user_id),
    x_user_id: Optional[str] = Header(default=None, alias="X-User-Id"),
) -> AtsScanResult:
    """
    Scan an uploaded raw PDF, DOCX, or TXT resume against an optional target job description.
    Enforces authentication checks, guest rate limits, file size caps, magic bytes, and DOCX explosion protection.
    Deterministic text extraction and taxonomy evaluation: 100% ephemeral and tenant-safe.
    """
    # 1. Enforce guest rate limits for unauthenticated users (5 uploads per hour)
    if user_id is None:
        client_ip = request.headers.get("x-forwarded-for") or (request.client.host if request.client else "unknown")
        client_ip = client_ip.split(",")[0].strip()
        check_and_record_guest_upload(client_ip)

    # 2. Enforce file size limit (5 MB)
    file_bytes = await file.read()
    if not file_bytes:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Uploaded file is empty.")
    if len(file_bytes) > SCANNER_MAX_UPLOAD_BYTES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Uploaded file exceeds maximum allowed size of 5 MB ({len(file_bytes)} bytes).",
        )

    # 3. Magic byte format validation
    magic_slice = file_bytes[:2048]
    is_pdf = b"%PDF-" in magic_slice
    is_docx = file_bytes.startswith(b"PK\x03\x04") or file_bytes.startswith(b"PK\x05\x06")
    is_text = False

    if not is_pdf and not is_docx:
        try:
            if b"\x00" not in file_bytes[:4096]:
                file_bytes.decode("utf-8")
                is_text = True
        except UnicodeDecodeError:
            is_text = False

    if not (is_pdf or is_docx or is_text):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Unsupported or invalid file format. Only PDF, DOCX, and TXT files are accepted (verified by file contents).",
        )

    # 4. DOCX decompression explosion / zip-bomb defenses
    if is_docx:
        try:
            with zipfile.ZipFile(io.BytesIO(file_bytes)) as zf:
                names = zf.namelist()
                if not any(n.startswith("word/") or n == "[Content_Types].xml" for n in names):
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail="Invalid DOCX file: missing document content structure.",
                    )
                total_uncompressed = sum(info.file_size for info in zf.infolist())
                if total_uncompressed > SCANNER_DOCX_MAX_UNCOMPRESSED_BYTES:
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail=f"DOCX uncompressed payload ({total_uncompressed} bytes) exceeds safety limit of 15 MB.",
                    )
                ratio = total_uncompressed / max(1, len(file_bytes))
                if ratio > SCANNER_DOCX_MAX_RATIO:
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail=f"DOCX compression ratio ({ratio:.1f}:1) exceeds decompression safety limit of 10:1.",
                    )
        except zipfile.BadZipFile as e:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Corrupt or malformed DOCX file: {e}",
            )

    try:
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

        if result.metadata.word_count < 10:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Uploaded document contains no readable text. Scanned images, encrypted, or password-protected files are not supported.",
            )

        return result
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error processing uploaded resume file: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
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
    user_id: str = Depends(get_authenticated_user_id),
    x_user_id: Optional[str] = Header(default=None, alias="X-User-Id"),
) -> SavedScanReportDTO:
    """Save an immutable snapshot of an ATS scan result to Cloud Firestore."""
    if x_user_id and x_user_id != user_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Header X-User-Id does not match authenticated user.",
        )
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
        userId=user_id,
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
        scoring_version=req.scoring_version or "v1_heuristic",
        ai_analysis=req.ai_analysis,
        audit_report=req.audit_report,
        provenance=req.provenance,
        createdAt=now_iso,
        updatedAt=now_iso,
    )

    saved = scan_report_repo.save_report(report_dto)
    return saved


@router.get("/reports", response_model=List[SavedScanReportDTO])
async def list_saved_scan_reports(
    user_id: str = Depends(get_authenticated_user_id),
    x_user_id: Optional[str] = Header(default=None, alias="X-User-Id"),
) -> List[SavedScanReportDTO]:
    """List all saved ATS scan reports for authenticated candidate."""
    if x_user_id and x_user_id != user_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Header X-User-Id does not match authenticated user.",
        )
    return scan_report_repo.list_reports_for_user(user_id=user_id)


@router.get("/reports/{report_id}", response_model=SavedScanReportDTO)
async def get_saved_scan_report(
    report_id: str,
    user_id: str = Depends(get_authenticated_user_id),
    x_user_id: Optional[str] = Header(default=None, alias="X-User-Id"),
) -> SavedScanReportDTO:
    """Retrieve a single immutable saved ATS scan report."""
    if x_user_id and x_user_id != user_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Header X-User-Id does not match authenticated user.",
        )
    report = scan_report_repo.get_report_by_id(report_id)
    if not report:
        raise HTTPException(
            status_code=404,
            detail=f"Saved ATS scan report '{report_id}' not found.",
        )
    if report.userId != user_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Unauthorized access to scan report.",
        )
    return report


@router.delete("/reports/{report_id}")
async def delete_saved_scan_report(
    report_id: str,
    user_id: str = Depends(get_authenticated_user_id),
    x_user_id: Optional[str] = Header(default=None, alias="X-User-Id"),
) -> dict:
    """Delete a saved ATS scan report."""
    if x_user_id and x_user_id != user_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Header X-User-Id does not match authenticated user.",
        )
    report = scan_report_repo.get_report_by_id(report_id)
    if not report:
        raise HTTPException(
            status_code=404,
            detail=f"Saved ATS scan report '{report_id}' not found.",
        )
    if report.userId != user_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Unauthorized access to scan report.",
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
    user_id: str = Depends(get_authenticated_user_id),
    x_user_id: Optional[str] = Header(default=None, alias="X-User-Id"),
) -> AtsEvidenceAuditReport:
    """Audit ATS Evidence and decouple ATS Compatibility Score from Truth Integrity."""
    if x_user_id and x_user_id != user_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Header X-User-Id does not match authenticated user.",
        )
    resume = resume_repo.get_tailored_resume(req.resume_id)
    if not resume:
        raise HTTPException(status_code=404, detail=f"Tailored resume '{req.resume_id}' not found.")
    if resume.userId != user_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Unauthorized access to resume.",
        )

    target_job_id = req.job_id or resume.jobId
    if not target_job_id or target_job_id == "general":
        raise HTTPException(status_code=400, detail="Target job ID is required for ATS Evidence Audit.")

    job = job_service.get_job(target_job_id)
    if not job:
        raise HTTPException(status_code=404, detail=f"Target job '{target_job_id}' not found.")

    from app.services.job_analysis_service import job_analysis_service
    from app.services.ats_evidence_auditor import ats_evidence_auditor
    from app.services.profile_service import profile_service

    job_analysis = await job_analysis_service.analyze_job(job=job, user_id=user_id)
    profile = profile_service.get_profile(user_id=user_id)

    return ats_evidence_auditor.audit_ats_evidence(
        resume=resume.structuredContent,
        job_analysis=job_analysis,
        profile=profile,
        resume_id=resume.id,
    )

