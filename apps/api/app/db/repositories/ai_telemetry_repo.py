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

    def list_executions_paginated(
        self,
        user_id: str,
        limit: int = 20,
        cursor: str | None = None,
        task: str | None = None,
        provider: str | None = None,
    ) -> dict[str, Any]:
        """Fetch paginated execution telemetry records using cursor-based pagination."""
        from app.ai.hub.task_key_normalizer import get_task_aliases

        task_aliases = get_task_aliases(task) if task else []

        db = self._get_db()
        if db is not None:
            try:
                coll_ref = (
                    db.collection("users")
                    .document(user_id)
                    .collection("ai_telemetry")
                )
                query = coll_ref
                if task_aliases:
                    if len(task_aliases) == 1:
                        query = query.where("task", "==", task_aliases[0])
                    else:
                        query = query.where("task", "in", task_aliases[:10])
                if provider:
                    # In Firestore, providerUsed is stored lowercase (e.g. "gemini")
                    query = query.where("providerUsed", "==", provider.lower())

                query = query.order_by("timestamp", direction="DESCENDING")
                if cursor:
                    query = query.start_after([cursor])

                docs = list(query.limit(limit + 1).stream())
                has_more = len(docs) > limit
                items_docs = docs[:limit]
                items = [d.to_dict() for d in items_docs if d.to_dict()]
                next_cursor = items[-1].get("timestamp") if (has_more and items) else None

                return {
                    "items": items,
                    "next_cursor": next_cursor,
                    "has_more": has_more,
                }
            except Exception as e:
                logger.error(f"Firestore error querying paginated telemetry for user {user_id}: {e}")
                raise RuntimeError(f"Database error querying telemetry: {e}") from e

        # In-memory fallback
        user_records = [v for (uid, _eid), v in self._memory_telemetry.items() if uid == user_id]
        if task_aliases:
            user_records = [r for r in user_records if r.get("task") in task_aliases]
        if provider:
            user_records = [
                r for r in user_records if str(r.get("providerUsed", "")).lower() == provider.lower()
            ]

        user_records.sort(key=lambda r: r.get("timestamp", ""), reverse=True)

        if cursor:
            start_idx = 0
            for i, r in enumerate(user_records):
                if r.get("timestamp") == cursor:
                    start_idx = i + 1
                    break
                elif r.get("timestamp", "") < cursor:
                    start_idx = i
                    break
            user_records = user_records[start_idx:]

        has_more = len(user_records) > limit
        items = user_records[:limit]
        next_cursor = items[-1].get("timestamp") if (has_more and items) else None

        return {
            "items": items,
            "next_cursor": next_cursor,
            "has_more": has_more,
        }

    def get_telemetry_summary_aggregate(
        self,
        user_id: str,
        task: str | None = None,
        provider: str | None = None,
    ) -> dict[str, Any]:
        """Compute aggregated statistics across full user history using bounded-memory streaming projection."""
        from app.ai.hub.task_key_normalizer import get_task_aliases, normalize_task_key
        from app.ai.hub.telemetry_classifier import classify_execution_result

        task_aliases = get_task_aliases(task) if task else []
        norm_provider = provider.lower() if provider else None

        total_requests = 0
        successful_requests = 0
        failed_requests = 0
        indeterminate_requests = 0
        latency_sum = 0.0
        valid_latency_count = 0
        fallback_count = 0
        provider_distribution: dict[str, int] = {}
        task_distribution: dict[str, int] = {}

        db = self._get_db()
        if db is not None:
            try:
                coll_ref = (
                    db.collection("users")
                    .document(user_id)
                    .collection("ai_telemetry")
                )
                query = coll_ref
                if task_aliases:
                    if len(task_aliases) == 1:
                        query = query.where("task", "==", task_aliases[0])
                    else:
                        query = query.where("task", "in", task_aliases[:10])
                if norm_provider:
                    query = query.where("providerUsed", "==", norm_provider)

                # Server-side field projection strips heavy prompt/raw output data
                query = query.select(
                    ["success", "latencyMs", "fallbackLevel", "hopsCount", "providerUsed", "task", "attemptedHops"]
                )

                docs_stream = query.stream()
                for doc in docs_stream:
                    data = doc.to_dict()
                    if not data:
                        continue

                    total_requests += 1

                    # 1. Result classification
                    result = classify_execution_result(data.get("success"), data.get("attemptedHops"))
                    if result == "SUCCESS":
                        successful_requests += 1
                    elif result == "FAILURE":
                        failed_requests += 1
                    else:
                        indeterminate_requests += 1

                    # 2. Latency handling (strictly exclude missing/nonpositive)
                    lat = data.get("latencyMs")
                    if lat is not None and isinstance(lat, (int, float)) and not isinstance(lat, bool) and lat > 0:
                        latency_sum += float(lat)
                        valid_latency_count += 1

                    # 3. Fallback count
                    f_level = data.get("fallbackLevel")
                    h_count = data.get("hopsCount")
                    is_f_fallback = isinstance(f_level, int) and not isinstance(f_level, bool) and f_level > 0
                    is_h_fallback = isinstance(h_count, int) and not isinstance(h_count, bool) and h_count > 1
                    if is_f_fallback or is_h_fallback:
                        fallback_count += 1

                    # 4. Distributions
                    p_key = str(data.get("providerUsed", "unknown")).lower()
                    provider_distribution[p_key] = provider_distribution.get(p_key, 0) + 1

                    t_key = normalize_task_key(str(data.get("task", "unknown")))
                    task_distribution[t_key] = task_distribution.get(t_key, 0) + 1

            except Exception as e:
                logger.error(f"Firestore error calculating streaming summary for user {user_id}: {e}")
                raise RuntimeError(f"Database error aggregating telemetry: {e}") from e
        else:
            # In-memory storage iteration
            user_records = [v for (uid, _eid), v in self._memory_telemetry.items() if uid == user_id]
            for data in user_records:
                # Apply task and provider filters in memory
                if task_aliases and data.get("task") not in task_aliases:
                    continue
                if norm_provider and str(data.get("providerUsed", "")).lower() != norm_provider:
                    continue

                total_requests += 1

                result = classify_execution_result(data.get("success"), data.get("attemptedHops"))
                if result == "SUCCESS":
                    successful_requests += 1
                elif result == "FAILURE":
                    failed_requests += 1
                else:
                    indeterminate_requests += 1

                lat = data.get("latencyMs")
                if lat is not None and isinstance(lat, (int, float)) and not isinstance(lat, bool) and lat > 0:
                    latency_sum += float(lat)
                    valid_latency_count += 1

                f_level = data.get("fallbackLevel")
                h_count = data.get("hopsCount")
                is_f_fallback = isinstance(f_level, int) and not isinstance(f_level, bool) and f_level > 0
                is_h_fallback = isinstance(h_count, int) and not isinstance(h_count, bool) and h_count > 1
                if is_f_fallback or is_h_fallback:
                    fallback_count += 1

                p_key = str(data.get("providerUsed", "unknown")).lower()
                provider_distribution[p_key] = provider_distribution.get(p_key, 0) + 1

                t_key = normalize_task_key(str(data.get("task", "unknown")))
                task_distribution[t_key] = task_distribution.get(t_key, 0) + 1

        # Denominator isolation: successRate is computed strictly over known outcomes
        known_outcomes = successful_requests + failed_requests
        success_rate = (
            round((successful_requests / known_outcomes) * 100.0, 1)
            if known_outcomes > 0
            else 0.0
        )
        avg_latency = (
            round(latency_sum / valid_latency_count, 1)
            if valid_latency_count > 0
            else 0.0
        )

        return {
            "totalRequests": total_requests,
            "successfulRequests": successful_requests,
            "failedRequests": failed_requests,
            "indeterminateRequests": indeterminate_requests,
            "successRate": success_rate,
            "averageLatencyMs": avg_latency,
            "fallbackCount": fallback_count,
            "providerDistribution": provider_distribution,
            "taskDistribution": task_distribution,
        }

    def clear_memory(self) -> None:
        """Clear in-memory telemetry storage (for testing)."""
        self._memory_telemetry.clear()


ai_telemetry_repo = AITelemetryRepository()
