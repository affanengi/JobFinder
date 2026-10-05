"""Cloud Firestore Repository for Encrypted AI Credentials and User Settings."""

import logging
from typing import Any

from app.core.config import settings
from app.db.firebase import get_firestore_client

logger = logging.getLogger("jobFinder.db.ai_credential_repo")


class AICredentialRepository:
    """Manages persistence of encrypted credentials and AI preferences in Cloud Firestore.

    Strict Data Partitioning:
    - Credentials: `users/{userId}/ai_credentials/{credentialId}`
    - Preferences: `users/{userId}/ai_settings/preferences`
    """

    def __init__(self, in_memory: bool = False):
        self._in_memory = in_memory
        # In-memory storage for test/mock environments only
        self._memory_credentials: dict[tuple[str, str], dict[str, Any]] = {}
        self._memory_settings: dict[str, dict[str, Any]] = {}

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
                f"Cloud Firestore unavailable in {settings.ENVIRONMENT} ({e}). Falling back to isolated in-memory store for dev/testing."
            )
            return None

    def list_credentials(self, user_id: str) -> list[dict[str, Any]]:
        """Fetch all credentials registered to the authenticated user."""
        db = self._get_db()
        if db is not None:
            try:
                coll_ref = db.collection("users").document(user_id).collection("ai_credentials")
                docs = coll_ref.stream()
                results = []
                for doc in docs:
                    data = doc.to_dict()
                    if data:
                        results.append(data)
                return results
            except Exception as e:
                logger.error(f"Firestore error listing credentials for user {user_id}: {e}")
                raise RuntimeError(f"Database error listing credentials: {e}") from e

        # In-memory storage for test/mock environments
        return [v for (uid, _cid), v in self._memory_credentials.items() if uid == user_id]

    def get_credential(self, user_id: str, credential_id: str) -> dict[str, Any] | None:
        """Fetch a specific credential for the authenticated user."""
        db = self._get_db()
        if db is not None:
            try:
                doc_ref = (
                    db.collection("users")
                    .document(user_id)
                    .collection("ai_credentials")
                    .document(credential_id)
                )
                doc = doc_ref.get()
                if doc.exists:
                    return doc.to_dict()
                return None
            except Exception as e:
                logger.error(
                    f"Firestore error fetching credential {credential_id} for user {user_id}: {e}"
                )
                raise RuntimeError(f"Database error fetching credential: {e}") from e

        return self._memory_credentials.get((user_id, credential_id))

    def save_credential(
        self, user_id: str, credential_id: str, data: dict[str, Any]
    ) -> dict[str, Any]:
        """Save a new or updated encrypted credential record to Firestore."""
        # Belt-and-suspenders: Purge any raw key fields before saving to prevent accidental persistence
        sanitized_data = {
            k: v
            for k, v in data.items()
            if k not in ("apiKey", "decryptedKey", "decrypted_key", "rawKey", "key")
        }

        db = self._get_db()
        if db is not None:
            try:
                # Ensure the parent user document exists so it is browsable in Firestore console
                user_doc_ref = db.collection("users").document(user_id)
                user_doc_ref.set(
                    {"userId": user_id, "updatedAt": sanitized_data.get("updatedAt")},
                    merge=True,
                )

                doc_ref = user_doc_ref.collection("ai_credentials").document(credential_id)
                doc_ref.set(sanitized_data)
                logger.info(f"Persisted encrypted credential {credential_id} for user {user_id}")
                return sanitized_data
            except Exception as e:
                logger.error(
                    f"Firestore error saving credential {credential_id} for user {user_id}: {e}"
                )
                raise RuntimeError(f"Database error persisting credential: {e}") from e

        # Isolated in-memory fallback for test environments only
        self._memory_credentials[(user_id, credential_id)] = sanitized_data
        return sanitized_data

    def delete_credential(self, user_id: str, credential_id: str) -> bool:
        """Delete an existing credential scoped strictly to the authenticated user."""
        db = self._get_db()
        if db is not None:
            try:
                doc_ref = (
                    db.collection("users")
                    .document(user_id)
                    .collection("ai_credentials")
                    .document(credential_id)
                )
                doc = doc_ref.get()
                if not doc.exists:
                    return False
                doc_ref.delete()
                logger.info(f"Deleted credential {credential_id} for user {user_id}")
                return True
            except Exception as e:
                logger.error(
                    f"Firestore error deleting credential {credential_id} for user {user_id}: {e}"
                )
                raise RuntimeError(f"Database error deleting credential: {e}") from e

        existed = (user_id, credential_id) in self._memory_credentials
        self._memory_credentials.pop((user_id, credential_id), None)
        return existed

    def get_settings(self, user_id: str) -> dict[str, Any] | None:
        """Fetch AI routing and cost preferences for the authenticated user."""
        db = self._get_db()
        if db is not None:
            try:
                doc_ref = (
                    db.collection("users")
                    .document(user_id)
                    .collection("ai_settings")
                    .document("preferences")
                )
                doc = doc_ref.get()
                if doc.exists:
                    return doc.to_dict()
                return None
            except Exception as e:
                logger.error(f"Firestore error fetching AI settings for user {user_id}: {e}")
                raise RuntimeError(f"Database error fetching AI settings: {e}") from e

        return self._memory_settings.get(user_id)

    def save_settings(self, user_id: str, data: dict[str, Any]) -> dict[str, Any]:
        """Save AI preferences for the authenticated user, replacing preferences document."""
        db = self._get_db()
        if db is not None:
            try:
                # Ensure parent user document exists in Firestore
                user_doc_ref = db.collection("users").document(user_id)
                user_doc_ref.set(
                    {"userId": user_id, "updatedAt": data.get("updatedAt")},
                    merge=True,
                )

                doc_ref = user_doc_ref.collection("ai_settings").document("preferences")
                # Overwrite entire preferences document so reset/removed routes are deleted
                doc_ref.set(data)
                logger.info(f"Persisted AI settings for user {user_id}")
                return data
            except Exception as e:
                logger.error(f"Firestore error saving AI settings for user {user_id}: {e}")
                raise RuntimeError(f"Database error persisting AI settings: {e}") from e

        # In-memory storage for test/mock environments (full replacement to support route removal)
        self._memory_settings[user_id] = dict(data)
        return self._memory_settings[user_id]

    def clear_memory(self) -> None:
        """Clear in-memory storage (for testing)."""
        self._memory_credentials.clear()
        self._memory_settings.clear()


ai_credential_repo = AICredentialRepository()
