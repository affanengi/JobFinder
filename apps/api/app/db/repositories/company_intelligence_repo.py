"""Cloud Firestore Repository for Company Intelligence and Scam Shield records."""

import logging
from typing import Optional

from app.db.firebase import get_firestore_client
from app.schemas.company_intelligence import CompanyIntelligenceResult

logger = logging.getLogger("jobFinder.db.company_intelligence_repo")


class CompanyIntelligenceRepository:
    """Handles tenant-isolated persistence and caching of company research records."""

    COLLECTION = "company_intelligence"

    def __init__(self):
        # Key: "{userId}:{opportunityId}" -> CompanyIntelligenceResult
        self._memory_cache: dict[str, CompanyIntelligenceResult] = {}

    def _cache_key(self, user_id: str, opportunity_id: str) -> str:
        return f"{user_id}:{opportunity_id}"

    def save_intelligence(self, intel: CompanyIntelligenceResult) -> CompanyIntelligenceResult:
        """Persist company intelligence record partitioned by user and opportunity."""
        key = self._cache_key(intel.userId, intel.opportunityId)
        self._memory_cache[key] = intel

        client = get_firestore_client()
        if client:
            try:
                # Strictly isolate tenant data under user's document path
                doc_ref = (
                    client.collection("users")
                    .document(intel.userId)
                    .collection(self.COLLECTION)
                    .document(intel.opportunityId)
                )
                doc_ref.set(intel.model_dump())
                logger.info(
                    f"Saved company intelligence {intel.id} for user={intel.userId} opp={intel.opportunityId}"
                )
            except Exception as e:
                logger.error(f"Error persisting company intelligence to Firestore: {e}")

        return intel

    def get_intelligence(
        self, user_id: str, opportunity_id: str
    ) -> Optional[CompanyIntelligenceResult]:
        """Fetch cached company intelligence record ensuring strict tenant isolation."""
        key = self._cache_key(user_id, opportunity_id)
        if key in self._memory_cache:
            return self._memory_cache[key]

        client = get_firestore_client()
        if client:
            try:
                doc = (
                    client.collection("users")
                    .document(user_id)
                    .collection(self.COLLECTION)
                    .document(opportunity_id)
                    .get()
                )
                if doc.exists:
                    data = doc.to_dict()
                    if data:
                        intel = CompanyIntelligenceResult.model_validate(data)
                        self._memory_cache[key] = intel
                        return intel
            except Exception as e:
                logger.error(
                    f"Error reading company intelligence for user={user_id} opp={opportunity_id} from Firestore: {e}"
                )

        return None

    def delete_intelligence(self, user_id: str, opportunity_id: str) -> bool:
        """Delete company intelligence record."""
        key = self._cache_key(user_id, opportunity_id)
        self._memory_cache.pop(key, None)

        client = get_firestore_client()
        if client:
            try:
                client.collection("users").document(user_id).collection(self.COLLECTION).document(
                    opportunity_id
                ).delete()
                return True
            except Exception as e:
                logger.error(f"Error deleting company intelligence: {e}")
                return False
        return True

    def get_all_intelligence_for_user(self, user_id: str) -> dict[str, CompanyIntelligenceResult]:
        """Fetch all company intelligence records for a user in a single query."""
        results: dict[str, CompanyIntelligenceResult] = {}

        # 1. First check in-memory cache
        for cache_key, intel in self._memory_cache.items():
            if cache_key.startswith(f"{user_id}:"):
                results[intel.opportunityId] = intel
                if intel.companyName:
                    results[intel.companyName.lower()] = intel

        # 2. Check Firestore
        client = get_firestore_client()
        if client:
            try:
                docs = (
                    client.collection("users")
                    .document(user_id)
                    .collection(self.COLLECTION)
                    .stream()
                )
                for doc in docs:
                    data = doc.to_dict()
                    if data:
                        intel = CompanyIntelligenceResult.model_validate(data)
                        self._memory_cache[self._cache_key(user_id, intel.opportunityId)] = intel
                        results[intel.opportunityId] = intel
                        if intel.companyName:
                            results[intel.companyName.lower()] = intel
            except Exception as e:
                logger.error(f"Error streaming all intelligence for user={user_id}: {e}")

        return results

    def get_intelligence_for_company(
        self, user_id: str, company_name: str, opportunity_ids: set[str]
    ) -> Optional[CompanyIntelligenceResult]:
        """Retrieve company intelligence matching any opportunity ID or the company name in a single efficient check."""
        # 1. Fast in-memory check
        for opp_id in opportunity_ids:
            key = self._cache_key(user_id, opp_id)
            if key in self._memory_cache:
                return self._memory_cache[key]

        # 2. Check all user intelligence in single batch
        user_intel_map = self.get_all_intelligence_for_user(user_id)
        for opp_id in opportunity_ids:
            if opp_id in user_intel_map:
                return user_intel_map[opp_id]

        if company_name and company_name.lower() in user_intel_map:
            return user_intel_map[company_name.lower()]

        return None


company_intelligence_repo = CompanyIntelligenceRepository()
