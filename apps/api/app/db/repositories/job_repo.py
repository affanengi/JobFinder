"""Firestore Repository for Canonical Jobs adhering to SCHEMA.md with in-memory caching and deduplication lookups."""

import logging
from typing import Optional

from app.db.firebase import get_firestore_client
from app.schemas.job import CanonicalJob

logger = logging.getLogger("jobFinder.db.job_repo")


class JobRepository:
    """Manages storage and retrieval of CanonicalJob entities in Cloud Firestore."""

    COLLECTION = "jobs"

    def __init__(self):
        self._cache: dict[str, CanonicalJob] = {}
        self._url_index: dict[str, str] = {}
        self._hash_index: dict[str, str] = {}

    def index_url(self, url: str, job_id: str) -> None:
        """Map a source/canonical URL to a canonical job ID in memory."""
        if url and job_id:
            self._url_index[url] = job_id

    def get_by_id(self, job_id: str) -> Optional[CanonicalJob]:
        """Fetch a canonical job by its ID from memory or Firestore."""
        if job_id in self._cache:
            return self._cache[job_id]

        try:
            client = get_firestore_client()
            doc_ref = client.collection(self.COLLECTION).document(job_id)
            doc = doc_ref.get()
            if doc.exists:
                data = doc.to_dict() or {}
                job = CanonicalJob.model_validate(data)
                self._cache[job.id] = job
                if job.sourceRef and job.sourceRef.originalUrl:
                    self._url_index[job.sourceRef.originalUrl] = job.id
                if job.canonicalHash:
                    self._hash_index[job.canonicalHash] = job.id
                return job
        except Exception as e:
            logger.error(f"Error reading job {job_id} from Firestore: {e}")
        return None

    def get_by_canonical_hash(self, canonical_hash: str) -> Optional[CanonicalJob]:
        """Find an existing job by its canonical fingerprint hash."""
        if not canonical_hash:
            return None

        if canonical_hash in self._hash_index:
            job = self.get_by_id(self._hash_index[canonical_hash])
            if job:
                return job

        # Check in-memory cache
        for job in self._cache.values():
            if job.canonicalHash == canonical_hash:
                self._hash_index[canonical_hash] = job.id
                return job

        try:
            client = get_firestore_client()
            docs = (
                client.collection(self.COLLECTION)
                .where("canonicalHash", "==", canonical_hash)
                .limit(1)
                .stream()
            )
            for doc in docs:
                data = doc.to_dict() or {}
                job = CanonicalJob.model_validate(data)
                self._cache[job.id] = job
                self._hash_index[canonical_hash] = job.id
                if job.sourceRef and job.sourceRef.originalUrl:
                    self._url_index[job.sourceRef.originalUrl] = job.id
                return job
        except Exception as e:
            logger.debug(f"Firestore canonicalHash lookup query returned: {e}")
        return None

    def get_by_source_url(self, source_url: str) -> Optional[CanonicalJob]:
        """Find an existing job by exact source URL."""
        if not source_url:
            return None

        if source_url in self._url_index:
            job = self.get_by_id(self._url_index[source_url])
            if job:
                return job

        # Check in-memory cache
        for job in self._cache.values():
            if job.sourceRef and job.sourceRef.originalUrl == source_url:
                self._url_index[source_url] = job.id
                return job

        try:
            client = get_firestore_client()
            docs = (
                client.collection(self.COLLECTION)
                .where("sourceRef.originalUrl", "==", source_url)
                .limit(1)
                .stream()
            )
            for doc in docs:
                data = doc.to_dict() or {}
                job = CanonicalJob.model_validate(data)
                self._cache[job.id] = job
                self._url_index[source_url] = job.id
                if job.canonicalHash:
                    self._hash_index[job.canonicalHash] = job.id
                return job
        except Exception as e:
            logger.debug(f"Firestore sourceRef.originalUrl lookup query returned: {e}")
        return None

    def save(self, job: CanonicalJob) -> CanonicalJob:
        """Store or update a canonical job in Firestore and in-memory cache."""
        self._cache[job.id] = job
        if job.sourceRef and job.sourceRef.originalUrl:
            self._url_index[job.sourceRef.originalUrl] = job.id
        if job.canonicalHash:
            self._hash_index[job.canonicalHash] = job.id
        try:
            client = get_firestore_client()
            doc_ref = client.collection(self.COLLECTION).document(job.id)
            data = job.model_dump(mode="json")
            doc_ref.set(data)
        except Exception as e:
            logger.error(f"Error persisting job {job.id} to Firestore: {e}")
        return job

    def list_all(self, limit: int = 500) -> list[CanonicalJob]:
        """Retrieve active canonical jobs from Firestore or cache."""
        jobs: list[CanonicalJob] = []
        try:
            client = get_firestore_client()
            docs = (
                client.collection(self.COLLECTION)
                .order_by("createdAt", direction="DESCENDING")
                .limit(limit)
                .stream()
            )
            for doc in docs:
                data = doc.to_dict()
                if data:
                    j = CanonicalJob.model_validate(data)
                    self._cache[j.id] = j
                    if j.sourceRef and j.sourceRef.originalUrl:
                        self._url_index[j.sourceRef.originalUrl] = j.id
                    if j.canonicalHash:
                        self._hash_index[j.canonicalHash] = j.id
                    jobs.append(j)
        except Exception as e:
            logger.error(f"Error querying jobs from Firestore: {e}")
            jobs = sorted(self._cache.values(), key=lambda j: j.createdAt, reverse=True)[:limit]

        return jobs


job_repo = JobRepository()
