"""Firestore Repository for User Profiles and Verified Facts adhering to SCHEMA.md."""

import logging

from app.db.firebase import get_firestore_client
from app.schemas.profile import Profile

logger = logging.getLogger("jobFinder.db.profile_repo")


class ProfileRepository:
    """Manages CRUD operations for Profile models in Cloud Firestore."""

    COLLECTION = "profiles"

    def get_by_user_id(self, user_id: str) -> Profile | None:
        """Fetch user profile from Firestore."""
        try:
            client = get_firestore_client()
            doc_ref = client.collection(self.COLLECTION).document(user_id)
            doc = doc_ref.get()
            if doc.exists:
                data = doc.to_dict() or {}
                return Profile.model_validate(data)
        except Exception as e:
            logger.error(f"Error fetching profile for user {user_id} from Firestore: {e}")
        return None

    def save(self, profile: Profile) -> Profile:
        """Save or update user profile in Firestore."""
        try:
            client = get_firestore_client()
            doc_ref = client.collection(self.COLLECTION).document(profile.userId)
            data = profile.model_dump(mode="json")
            doc_ref.set(data)
            logger.info(f"Persisted profile for user {profile.userId} to Firestore.")
        except Exception as e:
            logger.error(f"Error saving profile for user {profile.userId} to Firestore: {e}")
        return profile


profile_repo = ProfileRepository()
