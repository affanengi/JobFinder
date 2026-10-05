"""Firestore repository for Tailored Cover Letters adhering to SCHEMA.md."""

import logging
from app.db.firebase import get_firestore_client
from app.schemas.cover_letter import TailoredCoverLetterDTO

logger = logging.getLogger("jobFinder.db.cover_letter_repo")


class CoverLetterRepository:
    """Manages persistence and retrieval of Tailored Cover Letters in Cloud Firestore."""

    COLLECTION = "cover_letters"

    def __init__(self):
        self._memory_cache: dict[str, TailoredCoverLetterDTO] = {}

    def get_by_id(self, letter_id: str) -> TailoredCoverLetterDTO | None:
        """Fetch a tailored cover letter by ID."""
        if letter_id in self._memory_cache:
            return self._memory_cache[letter_id]

        try:
            client = get_firestore_client()
            if client:
                doc_ref = client.collection(self.COLLECTION).document(letter_id)
                doc = doc_ref.get()
                if doc.exists:
                    data = doc.to_dict() or {}
                    letter = TailoredCoverLetterDTO.model_validate(data)
                    self._memory_cache[letter_id] = letter
                    return letter
        except Exception as e:
            logger.error(f"Error reading cover letter {letter_id} from Firestore: {e}")
        return None

    def get_cover_letter_for_job(self, user_id: str, job_id: str) -> TailoredCoverLetterDTO | None:
        return self.get_by_user_and_job(user_id=user_id, job_id=job_id)

    def get_by_user_and_job(self, user_id: str, job_id: str) -> TailoredCoverLetterDTO | None:
        """Fetch the most recent tailored cover letter for a specific user and target job."""
        matched: list[TailoredCoverLetterDTO] = [
            l for l in self._memory_cache.values() if l.userId == user_id and l.jobId == job_id
        ]

        try:
            client = get_firestore_client()
            if client:
                docs = (
                    client.collection(self.COLLECTION)
                    .where("userId", "==", user_id)
                    .where("jobId", "==", job_id)
                    .stream()
                )
                for doc in docs:
                    data = doc.to_dict()
                    if data:
                        letter = TailoredCoverLetterDTO.model_validate(data)
                        self._memory_cache[letter.id] = letter
                        if not any(x.id == letter.id for x in matched):
                            matched.append(letter)
        except Exception as e:
            logger.error(f"Error reading cover letter for user {user_id} and job {job_id}: {e}")

        if not matched:
            return None

        # Sort descending by updatedAt or createdAt in memory (avoids composite index requirement)
        matched.sort(key=lambda x: str(x.updatedAt or x.createdAt or ""), reverse=True)
        return matched[0]

    def save(self, letter: TailoredCoverLetterDTO) -> TailoredCoverLetterDTO:
        """Persist or update a tailored cover letter in memory and Firestore."""
        self._memory_cache[letter.id] = letter
        try:
            client = get_firestore_client()
            if client:
                doc_ref = client.collection(self.COLLECTION).document(letter.id)
                data = letter.model_dump(mode="json")
                doc_ref.set(data)
                logger.info(f"Persisted cover letter {letter.id} for job {letter.jobId} in Firestore.")
        except Exception as e:
            logger.error(f"Error persisting cover letter {letter.id}: {e}")
        return letter

    def list_for_user(self, user_id: str, limit: int = 50) -> list[TailoredCoverLetterDTO]:
        """List all tailored cover letters for a user, sorted in-memory by updatedAt descending."""
        letters: list[TailoredCoverLetterDTO] = [l for l in self._memory_cache.values() if l.userId == user_id]
        try:
            client = get_firestore_client()
            if client:
                docs = (
                    client.collection(self.COLLECTION)
                    .where("userId", "==", user_id)
                    .stream()
                )
                for doc in docs:
                    data = doc.to_dict()
                    if data:
                        dto = TailoredCoverLetterDTO.model_validate(data)
                        self._memory_cache[dto.id] = dto
                        if not any(x.id == dto.id for x in letters):
                            letters.append(dto)
        except Exception as e:
            logger.error(f"Error querying cover letters for user {user_id}: {e}")

        # In-memory sorting (avoids composite index requirement in Firestore)
        letters.sort(key=lambda x: str(x.updatedAt or x.createdAt or ""), reverse=True)
        return letters[:limit]

    def delete(self, letter_id: str) -> bool:
        """Delete a cover letter from Firestore."""
        if letter_id in self._memory_cache:
            del self._memory_cache[letter_id]
        try:
            client = get_firestore_client()
            if client:
                client.collection(self.COLLECTION).document(letter_id).delete()
                return True
        except Exception as e:
            logger.error(f"Error deleting cover letter {letter_id}: {e}")
            return False
        return True


cover_letter_repo = CoverLetterRepository()
