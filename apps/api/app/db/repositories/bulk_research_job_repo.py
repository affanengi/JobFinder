"""Cloud Firestore Repository for Persistent Bulk Corporate Research Jobs.

Storage Pattern:
users/{userId}/bulk_research_jobs/{jobId}
"""

import logging
from datetime import UTC, datetime, timedelta
from typing import Optional

from app.db.firebase import get_firestore_client
from app.schemas.company import BulkResearchJobDocument
from google.cloud.firestore_v1.base_query import FieldFilter

logger = logging.getLogger("jobFinder.db.bulk_research_job_repo")


class BulkResearchJobRepository:
    """Handles tenant-isolated persistence, leasing, and recovery of asynchronous bulk research jobs."""

    COLLECTION = "bulk_research_jobs"

    def __init__(self):
        # In-memory test and local cache: "{userId}:{jobId}" -> BulkResearchJobDocument
        self._memory_cache: dict[str, BulkResearchJobDocument] = {}

    def _cache_key(self, user_id: str, job_id: str) -> str:
        return f"{user_id}:{job_id}"

    def save_job(self, job: BulkResearchJobDocument) -> BulkResearchJobDocument:
        """Persist bulk research job partitioned by user and job ID."""
        now_iso = datetime.now(UTC).isoformat()
        job.updatedAt = now_iso

        key = self._cache_key(job.userId, job.jobId)
        self._memory_cache[key] = job

        client = get_firestore_client()
        if client:
            try:
                doc_ref = (
                    client.collection("users")
                    .document(job.userId)
                    .collection(self.COLLECTION)
                    .document(job.jobId)
                )
                doc_ref.set(job.model_dump())
                logger.info(
                    f"Saved bulk research job {job.jobId} (status={job.status}, stage={job.progressStage}) for user={job.userId}"
                )
            except Exception as e:
                logger.error(f"Error persisting bulk research job to Firestore: {e}")

        return job

    def get_job(self, user_id: str, job_id: str) -> Optional[BulkResearchJobDocument]:
        """Fetch bulk research job ensuring strict tenant isolation."""
        key = self._cache_key(user_id, job_id)
        if key in self._memory_cache:
            job = self._memory_cache[key]
            if job.userId == user_id:
                return job
            return None

        client = get_firestore_client()
        if client:
            try:
                doc = (
                    client.collection("users")
                    .document(user_id)
                    .collection(self.COLLECTION)
                    .document(job_id)
                    .get()
                )
                if doc.exists:
                    data = doc.to_dict()
                    if data:
                        job = BulkResearchJobDocument.model_validate(data)
                        if job.userId == user_id:
                            self._memory_cache[key] = job
                            return job
            except Exception as e:
                logger.error(f"Error reading bulk job {job_id} for user={user_id}: {e}")

        return None

    def get_active_job(self, user_id: str) -> Optional[BulkResearchJobDocument]:
        """Retrieve the latest active (non-completed, non-failed) bulk job for user."""
        active_statuses = {"QUEUED", "HARVESTING", "SYNTHESIZING", "SAVING"}

        # 1. Check in-memory cache
        for key, job in list(self._memory_cache.items()):
            if job.userId == user_id and job.status in active_statuses:
                return job

        # 2. Check Firestore
        client = get_firestore_client()
        if client:
            try:
                docs = (
                    client.collection("users")
                    .document(user_id)
                    .collection(self.COLLECTION)
                    .where(filter=FieldFilter("status", "in", list(active_statuses)))
                    .stream()
                )
                for doc in docs:
                    data = doc.to_dict()
                    if data:
                        job = BulkResearchJobDocument.model_validate(data)
                        self._memory_cache[self._cache_key(user_id, job.jobId)] = job
                        return job
            except Exception as e:
                logger.error(f"Error reading active bulk jobs for user={user_id}: {e}")

        return None

    def claim_job_lease(
        self,
        user_id: str,
        job_id: str,
        worker_id: str,
        lease_duration_seconds: int = 120,
    ) -> bool:
        """Atomically claim execution lease to prevent multiple workers from executing concurrently."""
        job = self.get_job(user_id, job_id)
        if not job:
            return False

        now = datetime.now(UTC)
        now_iso = now.isoformat()

        # Check if currently leased by someone else with active lease
        if job.workerId and job.workerId != worker_id and job.leaseExpiresAt:
            try:
                expires = datetime.fromisoformat(job.leaseExpiresAt)
                if expires > now:
                    logger.warning(
                        f"Job {job_id} is already leased to worker {job.workerId} until {job.leaseExpiresAt}. Claim rejected."
                    )
                    return False
            except Exception:
                pass

        # Grant or renew lease
        lease_expires = (now + timedelta(seconds=lease_duration_seconds)).isoformat()
        job.workerId = worker_id
        job.leaseExpiresAt = lease_expires
        self.save_job(job)
        return True

    def release_job_lease(self, user_id: str, job_id: str, worker_id: str) -> bool:
        """Release lease upon successful completion or graceful exit."""
        job = self.get_job(user_id, job_id)
        if not job:
            return False

        if job.workerId == worker_id:
            job.workerId = None
            job.leaseExpiresAt = None
            self.save_job(job)
        return True

    def recover_stale_jobs(self, user_id: str, stale_timeout_seconds: int = 180) -> list[BulkResearchJobDocument]:
        """Detect and recover jobs stuck in running state across process restarts."""
        stale_threshold = datetime.now(UTC) - timedelta(seconds=stale_timeout_seconds)
        recovered: list[BulkResearchJobDocument] = []
        active_statuses = {"QUEUED", "HARVESTING", "SYNTHESIZING", "SAVING"}

        # Query Firestore if available to sync active jobs
        client = get_firestore_client()
        if client:
            try:
                docs = (
                    client.collection("users")
                    .document(user_id)
                    .collection(self.COLLECTION)
                    .where(filter=FieldFilter("status", "in", list(active_statuses)))
                    .stream()
                )
                for doc in docs:
                    data = doc.to_dict()
                    if data:
                        job = BulkResearchJobDocument.model_validate(data)
                        self._memory_cache[self._cache_key(user_id, job.jobId)] = job
            except Exception as e:
                logger.error(f"Error querying active jobs for recovery in Firestore: {e}")

        for key, job in list(self._memory_cache.items()):
            if job.userId == user_id and job.status in active_statuses:
                try:
                    updated = datetime.fromisoformat(job.updatedAt)
                    if updated < stale_threshold:
                        job.status = "FAILED"
                        job.progressStage = "error"
                        job.errorMessage = (
                            f"Execution timed out or interrupted by backend restart (stale for >{stale_timeout_seconds}s). "
                            "Please re-launch bulk research."
                        )
                        self.save_job(job)
                        recovered.append(job)
                except Exception:
                    pass

        return recovered


bulk_research_job_repo = BulkResearchJobRepository()
