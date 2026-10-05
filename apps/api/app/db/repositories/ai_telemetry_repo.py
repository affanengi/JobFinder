"""Cloud Firestore Repository for User AI Execution Telemetry."""

import logging
from typing import Any

from app.core.config import settings
from app.db.firebase import get_firestore_client

logger = logging.getLogger("jobFinder.db.ai_telemetry_repo")


class AITelemetryRepository:
    """Manages persistence and retrieval of execution telemetry records in Cloud Firestore.

    Strict User Scoping: `users/{userId}/ai_telemetry/{executionId}`
    """

    def __init__(self, in_memory: bool = False):
        self._in_memory = in_memory
        # Key: (userId, executionId) -> dict[str, Any]
        self._memory_telemetry: dict[tuple[str, str], dict[str, Any]] = {}

    def _get_db(self):
        if self._in_memory:
            return None
        try:
            return get_firestore_client()
        except Exception as e:
            if settings.ENVIRONMENT == "production":
                logger.critical(
                    f"Cloud Firestore is required in production but failed to initialize: {e}"
                )
                raise RuntimeError(f"Cloud Firestore connection failed in production: {e}") from e
            logger.warning(
                f"Cloud Firestore unavailable in {settings.ENVIRONMENT} ({e}). Falling back to isolated in-memory telemetry store."
            )
            return None

    def record_execution(self, user_id: str, record: dict[str, Any]) -> dict[str, Any]:
        """Save a new execution telemetry record scoped strictly to the authenticated user."""
        execution_id = record.get("executionId")
        if not execution_id:
            raise ValueError("Execution record must include an 'executionId'.")

        # Guarantee no secrets or prompts are stored
        sanitized = {
            k: v
            for k, v in record.items()
            if k
            not in (
                "prompt",
                "system_instruction",
                "text",
                "structured_data",
                "apiKey",
                "api_key",
                "decrypted_key",
                "decryptedKey",
                "rawKey",
            )
        }

        db = self._get_db()
        if db is not None:
            try:
                doc_ref = (
                    db.collection("users")
                    .document(user_id)
                    .collection("ai_telemetry")
                    .document(execution_id)
                )
                doc_ref.set(sanitized)
                logger.debug(
                    f"Recorded telemetry event {execution_id} for user {user_id} ({sanitized.get('providerUsed')}:{sanitized.get('modelUsed')})"
                )
                return sanitized
            except Exception as e:
                logger.error(f"Firestore error persisting telemetry for user {user_id}: {e}")
                # Don't break the application, but raise to allow caller handling
                raise RuntimeError(f"Database error persisting telemetry: {e}") from e

        # In-memory storage for test/dev environments
        self._memory_telemetry[(user_id, execution_id)] = sanitized
        return sanitized

    def list_executions(self, user_id: str, limit: int = 50) -> list[dict[str, Any]]:
        """Fetch recent execution telemetry records for the authenticated user."""
        db = self._get_db()
        if db is not None:
            try:
                coll_ref = (
                    db.collection("users")
                    .document(user_id)
                    .collection("ai_telemetry")
                    .order_by("timestamp", direction="DESCENDING")
                    .limit(limit)
                )
                docs = coll_ref.stream()
                results = []
                for doc in docs:
                    data = doc.to_dict()
                    if data:
                        results.append(data)
                return results
            except Exception as e:
                logger.error(f"Firestore error querying telemetry for user {user_id}: {e}")
                raise RuntimeError(f"Database error querying telemetry: {e}") from e

        # In-memory fallback
        user_records = [v for (uid, _eid), v in self._memory_telemetry.items() if uid == user_id]
        user_records.sort(key=lambda r: r.get("timestamp", ""), reverse=True)
        return user_records[:limit]

    def clear_memory(self) -> None:
        """Clear in-memory telemetry storage (for testing)."""
        self._memory_telemetry.clear()


ai_telemetry_repo = AITelemetryRepository()
