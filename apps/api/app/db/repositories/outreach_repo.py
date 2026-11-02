"""Cloud Firestore Repository for Outreach Messages and Sending Lifecycle.

Storage Pattern:
users/{userId}/outreach_messages/{outreachId}
"""

import logging
from typing import Optional

from app.db.firebase import get_firestore_client
from app.schemas.outreach import OutreachMessage

logger = logging.getLogger("jobFinder.db.outreach_repo")


class OutreachRepository:
    """Handles tenant-isolated persistence and caching of outreach drafts and sent emails."""

    COLLECTION = "outreach_messages"

    def __init__(self):
        # In-memory test cache: "{userId}:{outreachId}" -> OutreachMessage
        self._memory_cache: dict[str, OutreachMessage] = {}

    def _cache_key(self, user_id: str, outreach_id: str) -> str:
        return f"{user_id}:{outreach_id}"

    def save_outreach(self, outreach: OutreachMessage) -> OutreachMessage:
        """Persist outreach message record partitioned by tenant."""
        key = self._cache_key(outreach.userId, outreach.id)
        self._memory_cache[key] = outreach

        client = get_firestore_client()
        if client:
            try:
                doc_ref = (
                    client.collection("users")
                    .document(outreach.userId)
                    .collection(self.COLLECTION)
                    .document(outreach.id)
                )
                doc_ref.set(outreach.model_dump())
                logger.info(
                    f"Saved outreach {outreach.id} for user={outreach.userId} contact={outreach.contactId}"
                )
            except Exception as e:
                logger.error(f"Error persisting outreach to Firestore: {e}")

        return outreach

    def get_outreach(self, user_id: str, outreach_id: str) -> Optional[OutreachMessage]:
        """Fetch outreach message ensuring strict tenant isolation."""
        key = self._cache_key(user_id, outreach_id)
        if key in self._memory_cache:
            outreach = self._memory_cache[key]
            if outreach.userId == user_id:
                return outreach
            return None

        client = get_firestore_client()
        if client:
            try:
                doc = (
                    client.collection("users")
                    .document(user_id)
                    .collection(self.COLLECTION)
                    .document(outreach_id)
                    .get()
                )
                if doc.exists:
                    data = doc.to_dict()
                    if data:
                        outreach = OutreachMessage.model_validate(data)
                        if outreach.userId == user_id:
                            self._memory_cache[key] = outreach
                            return outreach
            except Exception as e:
                logger.error(f"Error reading outreach {outreach_id} for user={user_id}: {e}")

        return None

    def get_by_contact(
        self,
        user_id: str,
        opportunity_id: str,
        contact_id: str,
    ) -> Optional[OutreachMessage]:
        """Find existing outreach draft for a specific opportunity and contact."""
        for outreach in self._memory_cache.values():
            if (
                outreach.userId == user_id
                and outreach.opportunityId == opportunity_id
                and outreach.contactId == contact_id
            ):
                return outreach

        client = get_firestore_client()
        if client:
            try:
                docs = (
                    client.collection("users")
                    .document(user_id)
                    .collection(self.COLLECTION)
                    .where("opportunityId", "==", opportunity_id)
                    .where("contactId", "==", contact_id)
                    .stream()
                )
                for doc in docs:
                    data = doc.to_dict()
                    if data:
                        outreach = OutreachMessage.model_validate(data)
                        self._memory_cache[self._cache_key(user_id, outreach.id)] = outreach
                        return outreach
            except Exception as e:
                logger.error(f"Error querying outreach for contact {contact_id}: {e}")

        return None

    def list_outreach_for_opportunity(
        self,
        user_id: str,
        opportunity_id: str,
    ) -> list[OutreachMessage]:
        """List all outreach records for an opportunity."""
        messages: list[OutreachMessage] = []
        for outreach in self._memory_cache.values():
            if outreach.userId == user_id and outreach.opportunityId == opportunity_id:
                messages.append(outreach)

        client = get_firestore_client()
        if client:
            try:
                docs = (
                    client.collection("users")
                    .document(user_id)
                    .collection(self.COLLECTION)
                    .where("opportunityId", "==", opportunity_id)
                    .stream()
                )
                firestore_items: dict[str, OutreachMessage] = {}
                for doc in docs:
                    data = doc.to_dict()
                    if data:
                        msg = OutreachMessage.model_validate(data)
                        firestore_items[msg.id] = msg
                        self._memory_cache[self._cache_key(user_id, msg.id)] = msg
                if firestore_items:
                    return list(firestore_items.values())
            except Exception as e:
                logger.error(f"Error querying outreach for opp {opportunity_id}: {e}")

        return messages

    def delete_outreach(self, user_id: str, outreach_id: str) -> bool:
        """Delete an outreach message for the authenticated user."""
        key = self._cache_key(user_id, outreach_id)
        self._memory_cache.pop(key, None)

        client = get_firestore_client()
        if client:
            try:
                client.collection("users").document(user_id).collection(self.COLLECTION).document(
                    outreach_id
                ).delete()
                return True
            except Exception as e:
                logger.error(f"Error deleting outreach {outreach_id}: {e}")
                return False
        return True


outreach_repo = OutreachRepository()
