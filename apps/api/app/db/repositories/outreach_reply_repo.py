"""Cloud Firestore Repository for Outreach Inbound Replies and Intent Tracking (Phase 5).

Storage Pattern:
users/{userId}/outreach_replies/{replyId}
"""

import logging
from typing import Optional

from app.db.firebase import get_firestore_client
from app.schemas.outreach import OutreachReply

logger = logging.getLogger("jobFinder.db.outreach_reply_repo")


class OutreachReplyRepository:
    """Handles tenant-isolated persistence, caching, and idempotency for inbound replies."""

    COLLECTION = "outreach_replies"

    def __init__(self):
        # In-memory test cache: "{userId}:{replyId}" -> OutreachReply
        self._memory_cache: dict[str, OutreachReply] = {}

    def _cache_key(self, user_id: str, reply_id: str) -> str:
        return f"{user_id}:{reply_id}"

    def save_reply(self, reply: OutreachReply) -> OutreachReply:
        """Persist reply record partitioned strictly by tenant."""
        key = self._cache_key(reply.userId, reply.id)
        self._memory_cache[key] = reply

        client = get_firestore_client()
        if client:
            try:
                doc_ref = (
                    client.collection("users")
                    .document(reply.userId)
                    .collection(self.COLLECTION)
                    .document(reply.id)
                )
                doc_ref.set(reply.model_dump())
                logger.info(
                    f"Saved outreach reply {reply.id} for user={reply.userId} outreach={reply.outreachId}"
                )
            except Exception as e:
                logger.error(f"Error persisting outreach reply to Firestore: {e}")

        return reply

    def get_reply(self, user_id: str, reply_id: str) -> Optional[OutreachReply]:
        """Fetch reply ensuring strict tenant isolation."""
        key = self._cache_key(user_id, reply_id)
        if key in self._memory_cache:
            reply = self._memory_cache[key]
            if reply.userId == user_id:
                return reply
            return None

        client = get_firestore_client()
        if client:
            try:
                doc = (
                    client.collection("users")
                    .document(user_id)
                    .collection(self.COLLECTION)
                    .document(reply_id)
                    .get()
                )
                if doc.exists:
                    data = doc.to_dict()
                    if data:
                        reply = OutreachReply.model_validate(data)
                        if reply.userId == user_id:
                            self._memory_cache[key] = reply
                            return reply
            except Exception as e:
                logger.error(f"Error reading reply {reply_id} for user={user_id}: {e}")

        return None

    def get_by_gmail_message_id(self, user_id: str, gmail_message_id: str) -> Optional[OutreachReply]:
        """Find existing reply by Gmail message ID to prevent duplicate ingestion."""
        for reply in self._memory_cache.values():
            if reply.userId == user_id and reply.gmailMessageId == gmail_message_id:
                return reply

        client = get_firestore_client()
        if client:
            try:
                docs = (
                    client.collection("users")
                    .document(user_id)
                    .collection(self.COLLECTION)
                    .where("gmailMessageId", "==", gmail_message_id)
                    .stream()
                )
                for doc in docs:
                    data = doc.to_dict()
                    if data:
                        reply = OutreachReply.model_validate(data)
                        self._memory_cache[self._cache_key(user_id, reply.id)] = reply
                        return reply
            except Exception as e:
                logger.error(f"Error querying reply for gmail msg {gmail_message_id}: {e}")

        return None

    def list_replies_for_outreach(self, user_id: str, outreach_id: str) -> list[OutreachReply]:
        """List all inbound replies for an outreach message in chronological order."""
        replies: list[OutreachReply] = []
        for reply in self._memory_cache.values():
            if reply.userId == user_id and reply.outreachId == outreach_id:
                replies.append(reply)

        client = get_firestore_client()
        if client:
            try:
                docs = (
                    client.collection("users")
                    .document(user_id)
                    .collection(self.COLLECTION)
                    .where("outreachId", "==", outreach_id)
                    .stream()
                )
                firestore_items: dict[str, OutreachReply] = {}
                for doc in docs:
                    data = doc.to_dict()
                    if data:
                        item = OutreachReply.model_validate(data)
                        firestore_items[item.id] = item
                        self._memory_cache[self._cache_key(user_id, item.id)] = item
                if firestore_items:
                    replies = list(firestore_items.values())
            except Exception as e:
                logger.error(f"Error querying replies for outreach {outreach_id}: {e}")

        replies.sort(key=lambda r: r.receivedAt or r.createdAt)
        return replies

    def list_replies_for_opportunity(self, user_id: str, opportunity_id: str) -> list[OutreachReply]:
        """List all inbound replies for an opportunity."""
        replies: list[OutreachReply] = []
        for reply in self._memory_cache.values():
            if reply.userId == user_id and reply.opportunityId == opportunity_id:
                replies.append(reply)

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
                firestore_items: dict[str, OutreachReply] = {}
                for doc in docs:
                    data = doc.to_dict()
                    if data:
                        item = OutreachReply.model_validate(data)
                        firestore_items[item.id] = item
                        self._memory_cache[self._cache_key(user_id, item.id)] = item
                if firestore_items:
                    replies = list(firestore_items.values())
            except Exception as e:
                logger.error(f"Error querying replies for opp {opportunity_id}: {e}")

        replies.sort(key=lambda r: r.receivedAt or r.createdAt, reverse=True)
        return replies

    def delete_reply(self, user_id: str, reply_id: str) -> bool:
        """Delete a reply message for the authenticated user."""
        key = self._cache_key(user_id, reply_id)
        self._memory_cache.pop(key, None)

        client = get_firestore_client()
        if client:
            try:
                client.collection("users").document(user_id).collection(self.COLLECTION).document(
                    reply_id
                ).delete()
                return True
            except Exception as e:
                logger.error(f"Error deleting reply {reply_id}: {e}")
                return False
        return True


outreach_reply_repo = OutreachReplyRepository()
