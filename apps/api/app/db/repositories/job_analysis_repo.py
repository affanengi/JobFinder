"""Cloud Firestore Repository for Job Analyses and Application Profile Snapshots."""

import logging
from typing import Optional

from app.db.firebase import get_firestore_client
from app.schemas.job_analysis import ApplicationProfileSnapshot, JobAnalysisResult

logger = logging.getLogger("jobFinder.db.job_analysis_repo")


class JobAnalysisRepository:
    """Handles persistence and retrieval of job analysis and application snapshots."""

    def __init__(self):
        self.analyses_collection = "job_analyses"
        self.snapshots_collection = "application_snapshots"
        self._analysis_cache: dict[str, JobAnalysisResult] = {}
        self._snapshot_cache: dict[str, ApplicationProfileSnapshot] = {}

    def save_analysis(self, analysis: JobAnalysisResult) -> JobAnalysisResult:
        """Persist structured job analysis."""
        self._analysis_cache[analysis.jobId] = analysis

        db = get_firestore_client()
        if db:
            try:
                doc_ref = db.collection(self.analyses_collection).document(analysis.jobId)
                doc_ref.set(analysis.model_dump())
                logger.info(f"Saved job analysis {analysis.id} for job {analysis.jobId} to Firestore")
            except Exception as e:
                logger.error(f"Error persisting job analysis to Firestore: {e}")

        return analysis

    def get_analysis_by_job_id(self, job_id: str) -> Optional[JobAnalysisResult]:
        """Fetch cached job analysis for a specific job."""
        if job_id in self._analysis_cache:
            return self._analysis_cache[job_id]

        db = get_firestore_client()
        if db:
            try:
                doc = db.collection(self.analyses_collection).document(job_id).get()
                if doc.exists:
                    data = doc.to_dict()
                    if data:
                        analysis = JobAnalysisResult.model_validate(data)
                        self._analysis_cache[job_id] = analysis
                        return analysis
            except Exception as e:
                logger.error(f"Error reading job analysis for {job_id} from Firestore: {e}")

        return None

    def save_snapshot(self, snapshot: ApplicationProfileSnapshot) -> ApplicationProfileSnapshot:
        """Persist derived application profile snapshot."""
        key = f"{snapshot.userId}:{snapshot.jobId}"
        self._snapshot_cache[key] = snapshot

        db = get_firestore_client()
        if db:
            try:
                doc_ref = db.collection(self.snapshots_collection).document(snapshot.id)
                doc_ref.set(snapshot.model_dump())
                logger.info(f"Saved application snapshot {snapshot.id} for user {snapshot.userId}")
            except Exception as e:
                logger.error(f"Error persisting application snapshot to Firestore: {e}")

        return snapshot

    def get_snapshot(self, user_id: str, job_id: str) -> Optional[ApplicationProfileSnapshot]:
        """Fetch application snapshot by user_id and job_id."""
        key = f"{user_id}:{job_id}"
        if key in self._snapshot_cache:
            return self._snapshot_cache[key]

        db = get_firestore_client()
        if db:
            try:
                docs = (
                    db.collection(self.snapshots_collection)
                    .where("userId", "==", user_id)
                    .where("jobId", "==", job_id)
                    .limit(1)
                    .stream()
                )
                for doc in docs:
                    data = doc.to_dict()
                    if data:
                        snap = ApplicationProfileSnapshot.model_validate(data)
                        self._snapshot_cache[key] = snap
                        return snap
            except Exception as e:
                logger.error(f"Error reading application snapshot for {user_id}/{job_id}: {e}")

        return None


job_analysis_repo = JobAnalysisRepository()
