"""Cloud Firestore Repository for Tailored Resumes."""

import logging

from app.db.firebase import get_firestore_client
from app.schemas.resume import TailoredResumeDTO

logger = logging.getLogger("jobFinder.db.resume_repo")


class ResumeRepository:
    """Repository handling persistence of tailored resume metadata and structured data in Firestore."""

    def __init__(self):
        self.collection_name = "tailored_resumes"
        self._memory_cache: dict[str, TailoredResumeDTO] = {}

    def save_tailored_resume(self, resume: TailoredResumeDTO) -> TailoredResumeDTO:
        """Save a tailored resume to Firestore."""
        self._memory_cache[resume.id] = resume

        db = get_firestore_client()
        if db:
            try:
                doc_ref = db.collection(self.collection_name).document(resume.id)
                doc_ref.set(resume.model_dump())
                logger.info(
                    f"Saved tailored resume {resume.id} to Firestore for user {resume.userId}"
                )
            except Exception as e:
                logger.error(f"Error persisting resume to Firestore: {e}")

        return resume

    def get_by_id(self, resume_id: str) -> TailoredResumeDTO | None:
        return self.get_tailored_resume(resume_id)

    def get_tailored_resume(self, resume_id: str) -> TailoredResumeDTO | None:
        """Retrieve a tailored resume by ID."""
        if resume_id in self._memory_cache:
            return self._memory_cache[resume_id]

        db = get_firestore_client()
        if db:
            try:
                doc = db.collection(self.collection_name).document(resume_id).get()
                if doc.exists:
                    data = doc.to_dict()
                    if data:
                        resume = TailoredResumeDTO.model_validate(data)
                        self._memory_cache[resume_id] = resume
                        return resume
            except Exception as e:
                logger.error(f"Error fetching resume {resume_id} from Firestore: {e}")

        return None

    def list_user_resumes(self, user_id: str = "user_default") -> list[TailoredResumeDTO]:
        """List all tailored resumes for a specific user."""
        resumes = [r for r in self._memory_cache.values() if r.userId == user_id]

        db = get_firestore_client()
        if db:
            try:
                query = db.collection(self.collection_name).where("userId", "==", user_id).stream()
                for doc in query:
                    data = doc.to_dict()
                    if data:
                        r = TailoredResumeDTO.model_validate(data)
                        self._memory_cache[r.id] = r
                        if not any(x.id == r.id for x in resumes):
                            resumes.append(r)
            except Exception as e:
                logger.error(f"Error querying resumes from Firestore: {e}")

        return sorted(
            resumes,
            key=lambda x: str(x.updatedAt or x.createdAt or ""),
            reverse=True,
        )

    def delete_tailored_resume(self, resume_id: str, user_id: str = "user_default") -> bool:
        """Delete a tailored resume from memory cache and Firestore."""
        if resume_id in self._memory_cache:
            del self._memory_cache[resume_id]

        db = get_firestore_client()
        if db:
            try:
                db.collection(self.collection_name).document(resume_id).delete()
                logger.info(f"Deleted tailored resume {resume_id} from Firestore.")
                return True
            except Exception as e:
                logger.error(f"Error deleting resume {resume_id} from Firestore: {e}")
                return False

        return True


    def get_resume_for_job(self, user_id: str, job_id: str) -> TailoredResumeDTO | None:
        """Fetch the latest existing tailored resume for a specific user and job."""
        matched = [r for r in self._memory_cache.values() if r.userId == user_id and r.jobId == job_id]

        db = get_firestore_client()
        if db:
            try:
                query = (
                    db.collection(self.collection_name)
                    .where("userId", "==", user_id)
                    .where("jobId", "==", job_id)
                    .stream()
                )
                for doc in query:
                    data = doc.to_dict()
                    if data:
                        r = TailoredResumeDTO.model_validate(data)
                        self._memory_cache[r.id] = r
                        if not any(x.id == r.id for x in matched):
                            matched.append(r)
            except Exception as e:
                logger.error(f"Error querying resume for job {job_id}: {e}")

        if not matched:
            return None

        matched.sort(key=lambda x: str(x.updatedAt or x.createdAt or ""), reverse=True)
        return matched[0]


resume_repo = ResumeRepository()
