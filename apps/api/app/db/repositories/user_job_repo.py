"""Firestore Repository for User Job Interactions (Saved, Applied, Archived)."""

import logging
from datetime import UTC, datetime

from app.db.firebase import get_firestore_client

logger = logging.getLogger("jobFinder.db.user_job_repo")


class UserJobStatusRepository:
    """Manages saving, applying, and archiving job statuses per user in Cloud Firestore."""

    COLLECTION = "user_job_statuses"

    def __init__(self):
        self._memory_cache: dict[str, dict[str, str]] = {}

    def get_user_job_statuses(self, user_id: str) -> dict[str, str]:
        """Fetch all job status overrides (saved, applied, archived) for a specific user."""
        statuses: dict[str, str] = {}
        for key, val in self._memory_cache.items():
            if val.get("userId") == user_id and val.get("jobId") and val.get("status"):
                statuses[val["jobId"]] = val["status"]

        try:
            client = get_firestore_client()
            docs = client.collection(self.COLLECTION).where("userId", "==", user_id).stream()
            for doc in docs:
                data = doc.to_dict() or {}
                job_id = data.get("jobId")
                status = data.get("status")
                if job_id and status:
                    statuses[job_id] = status
                    self._memory_cache[f"{user_id}_{job_id}"] = {"userId": user_id, "jobId": job_id, "status": status}
        except Exception as e:
            logger.error(f"Error reading job statuses for user {user_id} from Firestore: {e}")
        return statuses

    def set_job_status(self, user_id: str, job_id: str, status: str) -> bool:
        """Persist a job status for a user (e.g. saved, applied, archived)."""
        self._memory_cache[f"{user_id}_{job_id}"] = {"userId": user_id, "jobId": job_id, "status": status}
        try:
            client = get_firestore_client()
            doc_id = f"{user_id}_{job_id}"
            client.collection(self.COLLECTION).document(doc_id).set(
                {
                    "userId": user_id,
                    "jobId": job_id,
                    "status": status,
                    "updatedAt": datetime.now(UTC).isoformat(),
                }
            )
            logger.info(
                f"Persisted status '{status}' for job {job_id} (user: {user_id}) in Firestore."
            )
            return True
        except Exception as e:
            logger.error(f"Error persisting job status for {job_id}: {e}")
            return True


user_job_repo = UserJobStatusRepository()
