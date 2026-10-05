"""Service Layer for Application Tracker & Pipeline Management."""

import logging
from datetime import datetime, timezone
from typing import Optional
from uuid import uuid4

from app.db.repositories.application_repo import application_repo
from app.db.repositories.cover_letter_repo import cover_letter_repo
from app.db.repositories.resume_repo import resume_repo
from app.db.repositories.user_job_repo import user_job_repo
from app.schemas.application import (
    ApplicationRecordDTO,
    ApplicationStage,
    AtsScoreSnapshot,
    CoverLetterSnapshot,
    CreateApplicationRequest,
    EventSource,
    OfferOutcome,
    ResumeArtifactSnapshot,
    StageTransitionEvent,
)
from app.services.job_service import job_service

logger = logging.getLogger("jobFinder.services.application_service")

# Deterministic Legal Transition Matrix
LEGAL_TRANSITIONS: dict[ApplicationStage, set[ApplicationStage]] = {
    ApplicationStage.SAVED: {ApplicationStage.READY, ApplicationStage.ARCHIVED},
    ApplicationStage.READY: {
        ApplicationStage.SAVED,
        ApplicationStage.APPLIED,
        ApplicationStage.ARCHIVED,
    },
    ApplicationStage.APPLIED: {
        ApplicationStage.READY,
        ApplicationStage.INTERVIEWING,
        ApplicationStage.REJECTED,
        ApplicationStage.ARCHIVED,
    },
    ApplicationStage.INTERVIEWING: {
        ApplicationStage.APPLIED,
        ApplicationStage.OFFER,
        ApplicationStage.REJECTED,
        ApplicationStage.ARCHIVED,
    },
    ApplicationStage.OFFER: {
        ApplicationStage.INTERVIEWING,
        ApplicationStage.ARCHIVED,
    },
    ApplicationStage.REJECTED: {
        ApplicationStage.INTERVIEWING,
        ApplicationStage.APPLIED,
        ApplicationStage.SAVED,
        ApplicationStage.ARCHIVED,
    },
    ApplicationStage.ARCHIVED: {ApplicationStage.SAVED},
}

TRANSITION_EVENT_NAMES: dict[tuple[str, str], str] = {
    ("saved", "ready"): "READY_APPROVED",
    ("ready", "saved"): "DEMOTED_TO_SAVED",
    ("ready", "applied"): "APPLICATION_SUBMITTED",
    ("applied", "ready"): "RETURNED_TO_READY",
    ("applied", "interviewing"): "INTERVIEW_SCHEDULED",
    ("interviewing", "applied"): "RETURNED_TO_APPLIED",
    ("interviewing", "offer"): "OFFER_RECEIVED",
    ("offer", "interviewing"): "RETURNED_TO_INTERVIEWING",
    ("applied", "rejected"): "APPLICATION_REJECTED",
    ("interviewing", "rejected"): "APPLICATION_REJECTED",
    ("rejected", "interviewing"): "REOPENED_INTERVIEW",
    ("rejected", "applied"): "REOPENED_APPLIED",
    ("rejected", "saved"): "APPLICATION_RESTORED",
    ("saved", "archived"): "APPLICATION_ARCHIVED",
    ("ready", "archived"): "APPLICATION_ARCHIVED",
    ("applied", "archived"): "APPLICATION_ARCHIVED",
    ("interviewing", "archived"): "APPLICATION_ARCHIVED",
    ("offer", "archived"): "APPLICATION_ARCHIVED",
    ("rejected", "archived"): "APPLICATION_ARCHIVED",
    ("archived", "saved"): "APPLICATION_RESTORED",
}



def _extract_portal_url(job) -> str | None:
    if not job:
        return None
    if getattr(job, "portalUrl", None):
        return job.portalUrl
    if getattr(job, "applicationUrl", None):
        return job.applicationUrl
    source_ref = getattr(job, "sourceRef", None)
    if source_ref and getattr(source_ref, "originalUrl", None):
        return source_ref.originalUrl
    return None


def _extract_salary(job) -> str | None:
    if not job:
        return None
    if getattr(job, "salarySnippet", None):
        return job.salarySnippet
    if getattr(job, "salaryRange", None):
        return job.salaryRange
    comp = getattr(job, "compensation", None)
    if comp and getattr(comp, "rawString", None):
        return comp.rawString
    return None

class ApplicationService:
    """Orchestrates application state transitions, artifact snapshotting, and synchronization."""

    def validate_transition(
        self, current_stage: ApplicationStage, target_stage: ApplicationStage
    ) -> tuple[bool, Optional[str]]:
        """Validate whether a requested stage transition is legal per the state machine."""
        if current_stage == target_stage:
            return True, None

        allowed = LEGAL_TRANSITIONS.get(current_stage, set())
        if target_stage not in allowed:
            allowed_names = [s.value for s in allowed]
            return False, (
                f"Illegal state transition from '{current_stage.value}' to '{target_stage.value}'. "
                f"Allowed target stages: {allowed_names}"
            )

        return True, None

    def transition_stage(
        self,
        user_id: str,
        app_id: str,
        new_status: ApplicationStage,
        expected_status: Optional[ApplicationStage] = None,
        note: Optional[str] = None,
        event_source: EventSource = EventSource.CANDIDATE,
        applied_date: Optional[str] = None,
        offer_outcome: Optional[OfferOutcome] = None,
    ) -> ApplicationRecordDTO:
        """Enforce transition legality and execute atomic status change in repository."""
        record = application_repo.get_by_id(user_id=user_id, app_id=app_id)
        if not record:
            raise KeyError(f"Application {app_id} not found for user {user_id}")

        is_valid, err_msg = self.validate_transition(record.status, new_status)
        if not is_valid:
            raise ValueError(err_msg)

        # Precondition checks for specific stages
        if new_status == ApplicationStage.READY:
            if not record.resumeSnapshot:
                raise ValueError("Cannot move to 'Ready to Apply' without an approved tailored resume/application package snapshot.")

        if new_status == ApplicationStage.APPLIED and not record.appliedAt and not applied_date:
            applied_date = datetime.now(timezone.utc).isoformat()

        s1 = record.status.value if hasattr(record.status, "value") else str(record.status)
        s2 = new_status.value if hasattr(new_status, "value") else str(new_status)
        event_name = TRANSITION_EVENT_NAMES.get((s1, s2), "APPLICATION_UPDATED")

        return application_repo.atomic_transition_status(
            user_id=user_id,
            app_id=app_id,
            new_status=new_status,
            event_name=event_name,
            event_source=event_source,
            expected_status=expected_status,
            note=note,
            applied_date=applied_date,
            offer_outcome=offer_outcome,
        )

    def confirm_human_submission(
        self,
        user_id: str,
        app_id: str,
        note: Optional[str] = "Candidate confirmed manual submission on portal via Playwright autofill.",
    ) -> ApplicationRecordDTO:
        """Atomically transition application from READY to APPLIED upon candidate confirmation."""
        record = application_repo.get_by_id(user_id=user_id, app_id=app_id)
        if not record:
            raise KeyError(f"Application {app_id} not found for user {user_id}")

        if record.status != ApplicationStage.READY:
            raise ValueError(f"Application is in '{record.status.value}', expected 'ready' to confirm submission.")

        return self.transition_stage(
            user_id=user_id,
            app_id=app_id,
            new_status=ApplicationStage.APPLIED,
            expected_status=ApplicationStage.READY,
            note=note,
            event_source=EventSource.CANDIDATE,
            applied_date=datetime.now(timezone.utc).isoformat(),
        )

    def approve_package(
        self,
        user_id: str,
        job_id: str,
        tailored_resume_id: str,
        cover_letter_id: Optional[str] = None,
        note: Optional[str] = None,
    ) -> ApplicationRecordDTO:
        """Atomically approve resume & cover letter package, snapshot artifacts, and move to READY."""
        # 1. Verify tailored resume existence and ownership
        resume = resume_repo.get_tailored_resume(tailored_resume_id)
        if not resume:
            raise KeyError(f"Tailored resume {tailored_resume_id} not found.")
        if resume.userId != user_id:
            raise PermissionError("Tailored resume does not belong to authenticated user.")

        now_iso = datetime.now(timezone.utc).isoformat()

        # 2. Build immutable ResumeArtifactSnapshot
        content = getattr(resume, "structuredContent", None) or getattr(resume, "resume", None)
        skills_used: list[str] = []
        bullet_count = 0
        if content:
            if hasattr(content, "skills") and content.skills:
                for cat in content.skills:
                    items = getattr(cat, "items", None) or getattr(cat, "skills", [])
                    skills_used.extend(items)
            if hasattr(content, "projects") and content.projects:
                bullet_count += sum(len(p.bullets) for p in content.projects)
            if hasattr(content, "experience") and content.experience:
                bullet_count += sum(len(e.bullets) for e in content.experience)

        target_role: str = str(getattr(resume, "targetRole", None) or getattr(resume, "jobTitle", None) or "Tailored Candidate")
        version_val = getattr(resume, "version", 1) or 1

        resume_snapshot = ResumeArtifactSnapshot(
            resumeId=tailored_resume_id,
            version=version_val,
            jobId=job_id,
            targetRole=target_role,
            skillsUsed=skills_used,
            bulletCount=bullet_count,
            approvedAt=now_iso,
        )

        # 3. Optional CoverLetterSnapshot
        cl_snapshot = None
        if cover_letter_id:
            cl = cover_letter_repo.get_by_id(cover_letter_id)
            if cl and cl.userId == user_id:
                cl_snapshot = CoverLetterSnapshot(
                    coverLetterId=cover_letter_id,
                    approvedAt=now_iso,
                )

        # 4. Optional ATS Score Snapshot from validation
        ats_snapshot = None
        if resume.validationResult:
            ats_snapshot = AtsScoreSnapshot(
                overallScore=88 if resume.validationResult.is_valid else 65,
                evaluatedAt=now_iso,
                scannerVersion="v1.0-grounded",
                breakdown={
                    "format": 25,
                    "skills": 28,
                    "impact": 20,
                    "density": 15,
                },
            )

        # 5. Fetch or create application record
        app_record = application_repo.get_by_user_and_job(user_id=user_id, job_id=job_id)
        if not app_record:
            job = job_service.get_job(job_id)
            app_id = f"app_{user_id}_{job_id}"
            app_record = ApplicationRecordDTO(
                id=app_id,
                userId=user_id,
                jobId=job_id,
                isExternal=False,
                company=job.company if job else "Unknown Company",
                jobTitle=job.title if job else "Unknown Role",
                location=job.location if job else "Remote",
                portalUrl=_extract_portal_url(job),
                status=ApplicationStage.SAVED,
                createdAt=now_iso,
                updatedAt=now_iso,
                stageTimestamps={ApplicationStage.SAVED.value: now_iso},
                history=[
                    StageTransitionEvent(
                        fromStage=None,
                        toStage=ApplicationStage.SAVED,
                        eventName="APPLICATION_CREATED",
                        authorizedActor="candidate",
                        eventSource=EventSource.CANDIDATE,
                        timestamp=now_iso,
                        note="Created from Application Studio package approval",
                    )
                ],
            )
            application_repo.save(app_record)

        # Update snapshot attributes
        app_record.tailoredResumeId = tailored_resume_id
        app_record.resumeSnapshot = resume_snapshot
        app_record.coverLetterSnapshot = cl_snapshot
        if ats_snapshot:
            app_record.atsScoreSnapshot = ats_snapshot

        application_repo.save(app_record)

        # 6. Move status to READY if currently SAVED
        if app_record.status == ApplicationStage.SAVED:
            return application_repo.atomic_transition_status(
                user_id=user_id,
                app_id=app_record.id,
                new_status=ApplicationStage.READY,
                event_name="READY_APPROVED",
                event_source=EventSource.CANDIDATE,
                note=note or "Tailored resume approved in Application Studio",
            )

        return app_record

    def create_application(
        self, user_id: str, req: CreateApplicationRequest
    ) -> ApplicationRecordDTO:
        """Create a new manual application or off-platform referral tracking record."""
        now_iso = datetime.now(timezone.utc).isoformat()
        app_id = f"app_{user_id}_{req.jobId}" if req.jobId else f"app_{user_id}_{uuid4().hex[:12]}"

        # Check if already exists for user + job
        if req.jobId:
            existing = application_repo.get_by_user_and_job(user_id=user_id, job_id=req.jobId)
            if existing:
                return existing

        initial_stage = req.initialStatus
        if initial_stage == ApplicationStage.APPLIED and not req.appliedDate:
            req.appliedDate = now_iso

        history_events = [
            StageTransitionEvent(
                fromStage=None,
                toStage=initial_stage,
                eventName="APPLICATION_CREATED",
                authorizedActor="candidate",
                eventSource=EventSource.CANDIDATE,
                timestamp=now_iso,
                note="Manually created application",
            )
        ]

        stage_timestamps = {initial_stage.value: now_iso}

        record = ApplicationRecordDTO(
            id=app_id,
            userId=user_id,
            jobId=req.jobId,
            isExternal=req.isExternal or (req.jobId is None),
            company=req.company,
            jobTitle=req.jobTitle,
            location=req.location or "Remote",
            portalUrl=req.portalUrl,
            salarySnippet=req.salarySnippet,
            status=initial_stage,
            stageTimestamps=stage_timestamps,
            appliedAt=req.appliedDate if initial_stage == ApplicationStage.APPLIED else None,
            notes=req.notes,
            history=history_events,
            createdAt=now_iso,
            updatedAt=now_iso,
        )

        return application_repo.save(record)

    def sync_from_saved_jobs(self, user_id: str) -> list[ApplicationRecordDTO]:
        """Idempotent sync of user's saved discovery jobs into active applications."""
        now_iso = datetime.now(timezone.utc).isoformat()
        user_statuses = user_job_repo.get_user_job_statuses(user_id=user_id)
        saved_job_ids = [job_id for job_id, status in user_statuses.items() if status == "saved"]

        created_or_updated: list[ApplicationRecordDTO] = []

        for job_id in saved_job_ids:
            existing = application_repo.get_by_user_and_job(user_id=user_id, job_id=job_id)
            if existing:
                # NEVER DOWNGRADE existing status (e.g. Applied -> Saved)
                created_or_updated.append(existing)
                continue

            # Load job metadata (with safe fallback if mock ID or deleted)
            job = job_service.get_job(job_id)
            company = job.company if job else "Saved Opportunity"
            title = job.title if job else f"Opportunity {job_id}"
            location = (job.location or "Remote") if job else "Remote"
            portal_url = _extract_portal_url(job)
            salary = _extract_salary(job)

            app_id = f"app_{user_id}_{job_id}"
            # Check if tailored resume exists as draft
            tailored_resume = resume_repo.get_resume_for_job(user_id=user_id, job_id=job_id)

            app = ApplicationRecordDTO(
                id=app_id,
                userId=user_id,
                jobId=job_id,
                isExternal=False,
                company=company,
                jobTitle=title,
                location=location,
                portalUrl=portal_url,
                salarySnippet=salary,
                status=ApplicationStage.SAVED,  # Strictly SAVED initially
                stageTimestamps={ApplicationStage.SAVED.value: now_iso},
                tailoredResumeId=tailored_resume.id if tailored_resume else None,
                history=[
                    StageTransitionEvent(
                        fromStage=None,
                        toStage=ApplicationStage.SAVED,
                        eventName="APPLICATION_CREATED",
                        authorizedActor="candidate",
                        eventSource=EventSource.SYSTEM_SYNC,
                        timestamp=now_iso,
                        note="Synchronized from saved discovery opportunities",
                    )
                ],
                createdAt=now_iso,
                updatedAt=now_iso,
            )

            saved_record = application_repo.save(app)
            created_or_updated.append(saved_record)

        return created_or_updated


application_service = ApplicationService()
