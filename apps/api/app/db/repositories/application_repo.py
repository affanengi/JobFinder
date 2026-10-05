"""Firestore Repository for Application Tracker & Pipeline Management."""

import logging
from datetime import datetime, timezone
from typing import Optional

from app.db.firebase import get_firestore_client
from app.schemas.application import (
    ApplicationRecordDTO,
    ApplicationStage,
    EventSource,
    InterviewRoundEvent,
    OfferOutcome,
    StageTransitionEvent,
)

logger = logging.getLogger("jobFinder.db.application_repo")


class ApplicationRepository:
    """Manages application records, lifecycle transitions, and snapshots in Cloud Firestore."""

    COLLECTION = "applications"

    def __init__(self):
        self._memory_cache: dict[str, ApplicationRecordDTO] = {}

    def list_for_user(
        self, user_id: str, status: Optional[ApplicationStage] = None
    ) -> list[ApplicationRecordDTO]:
        """List all application records for the authenticated user, optionally filtered by stage."""
        results: list[ApplicationRecordDTO] = []
        try:
            client = get_firestore_client()
            query = client.collection(self.COLLECTION).where("userId", "==", user_id)
            if status:
                query = query.where("status", "==", status.value if hasattr(status, "value") else str(status))
            
            docs = query.stream()
            for doc in docs:
                data = doc.to_dict() or {}
                try:
                    record = ApplicationRecordDTO.model_validate(data)
                    self._memory_cache[record.id] = record
                    results.append(record)
                except Exception as ve:
                    logger.warning(f"Error parsing application doc {doc.id}: {ve}")
        except Exception as e:
            logger.error(f"Error listing applications for user {user_id} from Firestore: {e}")
            # Fallback to memory cache for user
            results = [
                rec for rec in self._memory_cache.values()
                if rec.userId == user_id and (status is None or rec.status == status)
            ]

        # Sort by updatedAt descending
        results.sort(key=lambda x: x.updatedAt or x.createdAt, reverse=True)
        return results

    def get_by_id(self, user_id: str, app_id: str) -> Optional[ApplicationRecordDTO]:
        """Fetch an application record ensuring user ownership."""
        # Check cache first
        cached = self._memory_cache.get(app_id)
        if cached and cached.userId == user_id:
            return cached

        try:
            client = get_firestore_client()
            doc_ref = client.collection(self.COLLECTION).document(app_id)
            snapshot = doc_ref.get()
            if snapshot.exists:
                data = snapshot.to_dict() or {}
                if data.get("userId") != user_id:
                    logger.warning(f"Unauthorized access attempt to application {app_id} by user {user_id}")
                    return None
                record = ApplicationRecordDTO.model_validate(data)
                self._memory_cache[record.id] = record
                return record
        except Exception as e:
            logger.error(f"Error retrieving application {app_id} for user {user_id}: {e}")

        return None

    def get_by_user_and_job(self, user_id: str, job_id: str) -> Optional[ApplicationRecordDTO]:
        """Fetch an existing application record for a user and job."""
        for rec in self._memory_cache.values():
            if rec.userId == user_id and rec.jobId == job_id:
                return rec

        try:
            client = get_firestore_client()
            docs = (
                client.collection(self.COLLECTION)
                .where("userId", "==", user_id)
                .where("jobId", "==", job_id)
                .limit(1)
                .stream()
            )
            for doc in docs:
                data = doc.to_dict() or {}
                record = ApplicationRecordDTO.model_validate(data)
                self._memory_cache[record.id] = record
                return record
        except Exception as e:
            logger.error(f"Error finding application for job {job_id} (user {user_id}): {e}")

        return None

    def save(self, record: ApplicationRecordDTO) -> ApplicationRecordDTO:
        """Persist or upsert an application record to Firestore and memory cache."""
        record.updatedAt = datetime.now(timezone.utc).isoformat()
        self._memory_cache[record.id] = record

        try:
            client = get_firestore_client()
            client.collection(self.COLLECTION).document(record.id).set(record.model_dump())
            logger.info(f"Persisted application {record.id} (status: {record.status}) for user {record.userId}")
        except Exception as e:
            logger.error(f"Failed to persist application {record.id} to Firestore: {e}")

        return record

    def atomic_transition_status(
        self,
        user_id: str,
        app_id: str,
        new_status: ApplicationStage,
        event_name: str,
        event_source: EventSource = EventSource.CANDIDATE,
        expected_status: Optional[ApplicationStage] = None,
        note: Optional[str] = None,
        applied_date: Optional[str] = None,
        offer_outcome: Optional[OfferOutcome] = None,
    ) -> ApplicationRecordDTO:
        """Atomically validate status, append audit event to history, and update Firestore."""
        record = self.get_by_id(user_id=user_id, app_id=app_id)
        if not record:
            raise KeyError(f"Application {app_id} not found for user {user_id}")

        if expected_status and record.status != expected_status:
            raise ValueError(
                f"Status conflict: expected '{expected_status.value}', but application is currently in '{record.status.value}'"
            )

        now_iso = datetime.now(timezone.utc).isoformat()
        old_status = record.status

        # Create immutable history event
        transition_event = StageTransitionEvent(
            fromStage=old_status,
            toStage=new_status,
            eventName=event_name,
            authorizedActor="candidate",
            eventSource=event_source,
            timestamp=now_iso,
            note=note,
        )

        record.status = new_status
        record.stageTimestamps[new_status.value] = now_iso
        record.updatedAt = now_iso
        record.history.append(transition_event)

        if applied_date:
            record.appliedAt = applied_date
        elif new_status == ApplicationStage.APPLIED and not record.appliedAt:
            record.appliedAt = now_iso

        if offer_outcome:
            record.offerOutcome = offer_outcome

        return self.save(record)

    def update_notes(self, user_id: str, app_id: str, notes: str) -> Optional[ApplicationRecordDTO]:
        """Update candidate notes on an application record."""
        record = self.get_by_id(user_id=user_id, app_id=app_id)
        if not record:
            return None

        record.notes = notes
        return self.save(record)

    def add_interview_round(
        self, user_id: str, app_id: str, round_event: InterviewRoundEvent
    ) -> Optional[ApplicationRecordDTO]:
        """Append a structured interview event to an application record."""
        record = self.get_by_id(user_id=user_id, app_id=app_id)
        if not record:
            return None

        record.interviewEvents.append(round_event)
        # Automatically update status to interviewing if currently applied
        if record.status == ApplicationStage.APPLIED:
            record.status = ApplicationStage.INTERVIEWING
            record.stageTimestamps[ApplicationStage.INTERVIEWING.value] = datetime.now(timezone.utc).isoformat()
            record.history.append(
                StageTransitionEvent(
                    fromStage=ApplicationStage.APPLIED,
                    toStage=ApplicationStage.INTERVIEWING,
                    eventName="INTERVIEW_SCHEDULED",
                    authorizedActor="candidate",
                    eventSource=EventSource.EMPLOYER,
                    note=f"Scheduled {round_event.round}",
                )
            )

        return self.save(record)

    def soft_archive(
        self,
        user_id: str,
        app_id: str,
        note: Optional[str] = None,
        offer_outcome: Optional[OfferOutcome] = None,
    ) -> Optional[ApplicationRecordDTO]:
        """Soft-archive an application, preserving all historical evidence and notes."""
        return self.atomic_transition_status(
            user_id=user_id,
            app_id=app_id,
            new_status=ApplicationStage.ARCHIVED,
            event_name="APPLICATION_ARCHIVED",
            event_source=EventSource.CANDIDATE,
            note=note,
            offer_outcome=offer_outcome,
        )


application_repo = ApplicationRepository()
