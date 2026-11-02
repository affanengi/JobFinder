"""Cloud Firestore Repository for Opportunity Discovered Contacts.

Storage Pattern:
users/{userId}/opportunity_contacts/{contactId}
"""

import logging
from datetime import UTC, datetime
from typing import Optional

from app.db.firebase import get_firestore_client
from app.schemas.opportunity_contact import DiscoveredContact
from app.utils.contact_identity import normalize_company_key
from google.cloud.firestore_v1.base_query import FieldFilter

logger = logging.getLogger("jobFinder.db.opportunity_contact_repo")


class OpportunityContactRepository:
    """Handles tenant-isolated persistence, caching, and state management of discovered contacts."""

    COLLECTION = "opportunity_contacts"
    TOMBSTONES_COLLECTION = "contact_tombstones"

    def __init__(self):
        # In-memory fallback and test cache: "{userId}:{contactId}" -> DiscoveredContact
        self._memory_cache: dict[str, DiscoveredContact] = {}
        # Tombstones cache: "{userId}:{companyKey}:{identityKey}" -> bool
        self._tombstones_cache: dict[str, bool] = {}

    def _cache_key(self, user_id: str, contact_id: str) -> str:
        return f"{user_id}:{contact_id}"

    def _tombstone_cache_key(self, user_id: str, company_key: str, identity_key: str) -> str:
        return f"{user_id}:{company_key}:{identity_key}"

    def save_contact(self, contact: DiscoveredContact) -> DiscoveredContact:
        """Persist discovered contact partitioned by user and contact ID."""
        if not contact.companyKey:
            contact.companyKey = normalize_company_key(contact.companyName)

        key = self._cache_key(contact.userId, contact.id)
        self._memory_cache[key] = contact

        # If contact is marked deleted, update tombstone cache
        if contact.isDeleted:
            for ident_key in contact.identityKeys:
                t_key = self._tombstone_cache_key(contact.userId, contact.companyKey, ident_key)
                self._tombstones_cache[t_key] = True

        client = get_firestore_client()
        if client:
            try:
                doc_ref = (
                    client.collection("users")
                    .document(contact.userId)
                    .collection(self.COLLECTION)
                    .document(contact.id)
                )
                doc_ref.set(contact.model_dump())
                logger.info(
                    f"Saved contact {contact.id} ({contact.fullName}) for user={contact.userId} opp={contact.opportunityId}"
                )
            except Exception as e:
                logger.error(f"Error persisting contact to Firestore: {e}")

        return contact

    def get_contact(self, user_id: str, contact_id: str) -> Optional[DiscoveredContact]:
        """Fetch contact ensuring strict tenant isolation."""
        key = self._cache_key(user_id, contact_id)
        if key in self._memory_cache:
            contact = self._memory_cache[key]
            # Verify tenant match
            if contact.userId == user_id:
                return contact
            return None

        client = get_firestore_client()
        if client:
            try:
                doc = (
                    client.collection("users")
                    .document(user_id)
                    .collection(self.COLLECTION)
                    .document(contact_id)
                    .get()
                )
                if doc.exists:
                    data = doc.to_dict()
                    if data:
                        contact = DiscoveredContact.model_validate(data)
                        if contact.userId == user_id:
                            self._memory_cache[key] = contact
                            return contact
            except Exception as e:
                logger.error(f"Error reading contact {contact_id} for user={user_id}: {e}")

        return None

    def get_contact_any_user(self, contact_id: str) -> Optional[DiscoveredContact]:
        """Fetch contact by contactId across memory cache or Firestore for security/authorization checks."""
        for key, contact in self._memory_cache.items():
            if contact.id == contact_id:
                return contact

        client = get_firestore_client()
        if client:
            try:
                docs = (
                    client.collection_group(self.COLLECTION)
                    .where(filter=FieldFilter("id", "==", contact_id))
                    .limit(1)
                    .stream()
                )
                for doc in docs:
                    data = doc.to_dict()
                    if data:
                        contact = DiscoveredContact.model_validate(data)
                        self._memory_cache[self._cache_key(contact.userId, contact.id)] = contact
                        return contact
            except Exception as e:
                logger.error(f"Error querying contact {contact_id} across users: {e}")

        return None

    def list_contacts_for_opportunity(self, user_id: str, opportunity_id: str) -> list[DiscoveredContact]:
        """Retrieve all active (non-deleted) contacts associated with a specific opportunity for the authenticated tenant."""
        contacts_dict: dict[str, DiscoveredContact] = {}

        # Pull matching records from in-memory cache
        for key, contact in list(self._memory_cache.items()):
            if contact.userId == user_id and not contact.isDeleted:
                if contact.opportunityId == opportunity_id or opportunity_id in getattr(contact, "associatedOpportunityIds", []):
                    contacts_dict[contact.id] = contact

        client = get_firestore_client()
        if client:
            try:
                # Query by primary opportunityId
                docs_primary = (
                    client.collection("users")
                    .document(user_id)
                    .collection(self.COLLECTION)
                    .where(filter=FieldFilter("opportunityId", "==", opportunity_id))
                    .where(filter=FieldFilter("isDeleted", "==", False))
                    .stream()
                )
                for doc in docs_primary:
                    data = doc.to_dict()
                    if data:
                        c = DiscoveredContact.model_validate(data)
                        contacts_dict[c.id] = c
                        self._memory_cache[self._cache_key(user_id, c.id)] = c

                # Query by associatedOpportunityIds array-contains
                docs_assoc = (
                    client.collection("users")
                    .document(user_id)
                    .collection(self.COLLECTION)
                    .where(filter=FieldFilter("associatedOpportunityIds", "array_contains", opportunity_id))
                    .where(filter=FieldFilter("isDeleted", "==", False))
                    .stream()
                )
                for doc in docs_assoc:
                    data = doc.to_dict()
                    if data:
                        c = DiscoveredContact.model_validate(data)
                        contacts_dict[c.id] = c
                        self._memory_cache[self._cache_key(user_id, c.id)] = c

            except Exception as e:
                logger.error(f"Error listing contacts for user={user_id} opp={opportunity_id}: {e}")

        return list(contacts_dict.values())

    def list_active_contacts_for_company(self, user_id: str, company_name_or_key: str) -> list[DiscoveredContact]:
        """Retrieve all active (non-deleted) contacts for a company across all user opportunities."""
        norm_key = normalize_company_key(company_name_or_key)
        contacts_dict: dict[str, DiscoveredContact] = {}

        # 1. Check in-memory cache
        for key, contact in list(self._memory_cache.items()):
            if contact.userId == user_id and not contact.isDeleted:
                c_key = contact.companyKey or normalize_company_key(contact.companyName)
                if c_key == norm_key:
                    contacts_dict[contact.id] = contact

        # 2. Check Firestore
        client = get_firestore_client()
        if client:
            try:
                docs = (
                    client.collection("users")
                    .document(user_id)
                    .collection(self.COLLECTION)
                    .where(filter=FieldFilter("companyKey", "==", norm_key))
                    .where(filter=FieldFilter("isDeleted", "==", False))
                    .stream()
                )
                for doc in docs:
                    data = doc.to_dict()
                    if data:
                        c = DiscoveredContact.model_validate(data)
                        contacts_dict[c.id] = c
                        self._memory_cache[self._cache_key(user_id, c.id)] = c
            except Exception as e:
                logger.error(f"Error listing company contacts for user={user_id} company={norm_key}: {e}")

        return list(contacts_dict.values())

    def list_company_tombstones(self, user_id: str, company_name_or_key: str) -> list[DiscoveredContact]:
        """Retrieve all tombstoned (soft-deleted) contacts for a company."""
        norm_key = normalize_company_key(company_name_or_key)
        tombstones_dict: dict[str, DiscoveredContact] = {}

        # 1. Check in-memory cache
        for key, contact in list(self._memory_cache.items()):
            if contact.userId == user_id and contact.isDeleted:
                c_key = contact.companyKey or normalize_company_key(contact.companyName)
                if c_key == norm_key:
                    tombstones_dict[contact.id] = contact

        # 2. Check Firestore
        client = get_firestore_client()
        if client:
            try:
                docs = (
                    client.collection("users")
                    .document(user_id)
                    .collection(self.COLLECTION)
                    .where(filter=FieldFilter("companyKey", "==", norm_key))
                    .where(filter=FieldFilter("isDeleted", "==", True))
                    .stream()
                )
                for doc in docs:
                    data = doc.to_dict()
                    if data:
                        c = DiscoveredContact.model_validate(data)
                        tombstones_dict[c.id] = c
                        self._memory_cache[self._cache_key(user_id, c.id)] = c
            except Exception as e:
                logger.error(f"Error listing tombstones for user={user_id} company={norm_key}: {e}")

        return list(tombstones_dict.values())

    def is_identity_tombstoned(self, user_id: str, company_name_or_key: str, identity_keys: list[str]) -> bool:
        """Fast check whether any identity key has a soft-deletion tombstone."""
        norm_key = normalize_company_key(company_name_or_key)

        # 1. Fast in-memory check
        for ident_key in identity_keys:
            t_key = self._tombstone_cache_key(user_id, norm_key, ident_key)
            if self._tombstones_cache.get(t_key):
                return True

        # 2. Check loaded tombstones
        tombstones = self.list_company_tombstones(user_id, norm_key)
        for t in tombstones:
            if set(identity_keys).intersection(set(t.identityKeys)):
                for k in t.identityKeys:
                    self._tombstones_cache[self._tombstone_cache_key(user_id, norm_key, k)] = True
                return True

        # 3. Direct Firestore deterministic tombstone documents check
        client = get_firestore_client()
        if client:
            try:
                for ident_key in identity_keys:
                    safe_doc_id = ident_key.replace(":", "_").replace("/", "_")
                    doc = (
                        client.collection("users")
                        .document(user_id)
                        .collection(self.TOMBSTONES_COLLECTION)
                        .document(safe_doc_id)
                        .get()
                    )
                    if doc.exists:
                        self._tombstones_cache[self._tombstone_cache_key(user_id, norm_key, ident_key)] = True
                        return True
            except Exception as e:
                logger.error(f"Error checking deterministic tombstone for user={user_id}: {e}")

        return False

    def soft_delete_contact(
        self,
        user_id: str,
        contact_id: str,
        reason: str = "USER_MANUAL_DELETE",
    ) -> bool:
        """Soft-delete a contact by setting isDeleted=True and indexing deterministic tombstones."""
        contact = self.get_contact(user_id, contact_id)
        if not contact:
            return False

        if contact.isDeleted:
            # Already deleted: idempotent success
            return True

        now_iso = datetime.now(UTC).isoformat()
        contact.isDeleted = True
        contact.deletedAt = now_iso
        contact.deletedByReason = reason

        norm_key = contact.companyKey or normalize_company_key(contact.companyName)

        # 1. Update in-memory cache and tombstone index
        self.save_contact(contact)
        for ident_key in contact.identityKeys:
            t_key = self._tombstone_cache_key(user_id, norm_key, ident_key)
            self._tombstones_cache[t_key] = True

        # 2. Write deterministic tombstone documents in Firestore for race-condition safety
        client = get_firestore_client()
        if client:
            try:
                for ident_key in contact.identityKeys:
                    safe_doc_id = ident_key.replace(":", "_").replace("/", "_")
                    client.collection("users").document(user_id).collection(
                        self.TOMBSTONES_COLLECTION
                    ).document(safe_doc_id).set({
                        "identityKey": ident_key,
                        "companyKey": norm_key,
                        "contactId": contact_id,
                        "deletedAt": now_iso,
                        "reason": reason,
                    })
            except Exception as e:
                logger.error(f"Error writing deterministic tombstones for {contact_id}: {e}")

        return True

    def update_contact_status(
        self,
        user_id: str,
        contact_id: str,
        is_dismissed: Optional[bool] = None,
        is_reviewed: Optional[bool] = None,
    ) -> Optional[DiscoveredContact]:
        """Update dismissal or review status of a contact with tenant verification."""
        contact = self.get_contact(user_id, contact_id)
        if not contact:
            return None

        updated_dict = contact.model_dump()
        if is_dismissed is not None:
            updated_dict["isDismissed"] = is_dismissed
        if is_reviewed is not None:
            updated_dict["isReviewed"] = is_reviewed

        updated_contact = DiscoveredContact.model_validate(updated_dict)
        return self.save_contact(updated_contact)

    def delete_contact(self, user_id: str, contact_id: str) -> bool:
        """Permanently delete a contact for the authenticated user (legacy)."""
        key = self._cache_key(user_id, contact_id)
        self._memory_cache.pop(key, None)

        client = get_firestore_client()
        if client:
            try:
                client.collection("users").document(user_id).collection(self.COLLECTION).document(
                    contact_id
                ).delete()
                return True
            except Exception as e:
                logger.error(f"Error deleting contact {contact_id}: {e}")
                return False
        return True

    def get_contact_counts_by_company_and_opp(self, user_id: str) -> dict[str, int]:
        """Batch load active contact counts grouped by companyKey and opportunityId in a single query."""
        counts: dict[str, int] = {}
        client = get_firestore_client()
        if client:
            try:
                docs = (
                    client.collection("users")
                    .document(user_id)
                    .collection(self.COLLECTION)
                    .where(filter=FieldFilter("isDeleted", "==", False))
                    .stream()
                )
                for doc in docs:
                    data = doc.to_dict()
                    if data:
                        c = DiscoveredContact.model_validate(data)
                        self._memory_cache[self._cache_key(user_id, c.id)] = c
                        ck = c.companyKey or normalize_company_key(c.companyName)
                        if ck:
                            counts[ck] = counts.get(ck, 0) + 1
                        if c.opportunityId:
                            counts[c.opportunityId] = counts.get(c.opportunityId, 0) + 1
            except Exception as e:
                logger.error(f"Error streaming active contact counts for user={user_id}: {e}")
        else:
            for contact in self._memory_cache.values():
                if contact.userId == user_id and not contact.isDeleted:
                    ck = contact.companyKey or normalize_company_key(contact.companyName)
                    if ck:
                        counts[ck] = counts.get(ck, 0) + 1
                    if contact.opportunityId:
                        counts[contact.opportunityId] = counts.get(contact.opportunityId, 0) + 1

        return counts

    def list_contacts_for_company_detail(
        self,
        user_id: str,
        company_keys: list[str],
        opportunity_ids: set[str],
        company_name: str,
    ) -> list[DiscoveredContact]:
        """Fast batch retrieval and deduplication of contacts for a company across opportunities in a single pass."""
        clean_keys = {k.strip().lower() for k in company_keys if k and k.strip()}
        norm_name_lower = (company_name or "").strip().lower()
        candidates: dict[str, DiscoveredContact] = {}

        # 1. Check in-memory cache
        for contact in list(self._memory_cache.values()):
            if contact.userId == user_id and not contact.isDeleted:
                c_key = (contact.companyKey or normalize_company_key(contact.companyName)).lower()
                c_name = (contact.companyName or "").strip().lower()
                matches_key = c_key in clean_keys
                matches_opp = contact.opportunityId in opportunity_ids
                matches_assoc = any(op in opportunity_ids for op in (contact.associatedOpportunityIds or []))
                matches_name = bool(norm_name_lower and c_name == norm_name_lower)

                if matches_key or matches_opp or matches_assoc or matches_name:
                    candidates[contact.id] = contact

        # 2. Check Firestore (single query for active contacts for user)
        client = get_firestore_client()
        if client:
            try:
                docs = (
                    client.collection("users")
                    .document(user_id)
                    .collection(self.COLLECTION)
                    .where(filter=FieldFilter("isDeleted", "==", False))
                    .stream()
                )
                for doc in docs:
                    data = doc.to_dict()
                    if data:
                        c = DiscoveredContact.model_validate(data)
                        self._memory_cache[self._cache_key(user_id, c.id)] = c
                        c_key = (c.companyKey or normalize_company_key(c.companyName)).lower()
                        c_name = (c.companyName or "").strip().lower()
                        matches_key = c_key in clean_keys
                        matches_opp = c.opportunityId in opportunity_ids
                        matches_assoc = any(op in opportunity_ids for op in (c.associatedOpportunityIds or []))
                        matches_name = bool(norm_name_lower and c_name == norm_name_lower)

                        if matches_key or matches_opp or matches_assoc or matches_name:
                            candidates[c.id] = c
            except Exception as e:
                logger.error(f"Error fetching contacts for company detail user={user_id}: {e}")

        # 3. Deduplicate by contact id and strong keys (LinkedIn vanity, email)
        deduped: list[DiscoveredContact] = []
        seen_contact_ids = set()
        seen_strong_keys = set()

        for contact in candidates.values():
            if contact.isDeleted or contact.id in seen_contact_ids:
                continue

            c_strong = {k for k in (contact.identityKeys or []) if k.startswith(("li:", "em:"))}
            if c_strong and (c_strong & seen_strong_keys):
                continue

            seen_contact_ids.add(contact.id)
            seen_strong_keys.update(c_strong)
            deduped.append(contact)

        deduped.sort(key=lambda c: c.rankingScore, reverse=True)
        return deduped


opportunity_contact_repo = OpportunityContactRepository()

