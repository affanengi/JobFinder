"""Tenant-scoped repository for encrypted Google OAuth tokens & distributed coordination.

Supports:
1. Multi-provider credential storage under users/{userId}/oauth_tokens/{provider}.
2. Atomic single-use state nonce consumption in Firestore transactions (oauth_states/{nonce}).
3. Distributed multi-worker token refresh lease coordination (users/{userId}/oauth_locks/{provider}).
4. In-memory thread-safe fallbacks for offline testing when Firestore is unavailable.
"""

import logging
import threading
from datetime import UTC, datetime
from typing import Any, Optional
from pydantic import BaseModel, Field

from app.core.oauth_crypto import (
    OAuthStateBindingError,
    OAuthStateError,
    OAuthStateExpiredError,
    OAuthStateReplayError,
    decrypt_oauth_token,
    encrypt_oauth_token,
)
from app.db.firebase import get_firestore_client

logger = logging.getLogger("jobFinder.repositories.oauth_token")


class EncryptedOAuthTokenRecord(BaseModel):
    """Authoritative persistent record of encrypted OAuth credentials for a user."""

    userId: str
    provider: str = "gmail"
    encryptedAccessToken: str
    encryptedRefreshToken: str | None = None
    tokenExpiry: str | None = None
    scope: str = "https://www.googleapis.com/auth/gmail.send"
    accountEmail: str | None = None
    gmailAddress: str | None = None  # Backward-compatible alias
    healthStatus: str = "OPERATIONAL"  # OPERATIONAL | NEEDS_REAUTHORIZATION | TOKEN_EXPIRED
    metadata: dict[str, Any] = Field(default_factory=dict)
    connectedAt: str = Field(default_factory=lambda: datetime.now(UTC).isoformat())
    updatedAt: str = Field(default_factory=lambda: datetime.now(UTC).isoformat())


class OAuthStateRecord(BaseModel):
    """Record for one-time OAuth state nonce verification."""

    nonce: str
    userId: str
    service: str
    expiresAt: str  # ISO 8601
    consumed: bool = False
    consumedAt: str | None = None
    createdAt: str = Field(default_factory=lambda: datetime.now(UTC).isoformat())


class OAuthLockRecord(BaseModel):
    """Distributed refresh lease document."""

    lockedBy: str
    lockedAt: str
    leaseExpiresAt: str  # ISO 8601


class OAuthTokenRepository:
    """Repository managing tenant-isolated OAuth credential records, leases, and state nonces."""

    def __init__(self, db_client=None):
        self._db = db_client
        self._cache: dict[str, EncryptedOAuthTokenRecord] = {}
        self._state_cache: dict[str, OAuthStateRecord] = {}
        self._lock_cache: dict[str, OAuthLockRecord] = {}
        self._mem_lock = threading.Lock()

    @property
    def db(self):
        if self._db is None:
            self._db = get_firestore_client()
        return self._db

    def _token_doc_ref(self, user_id: str, provider: str):
        return self.db.collection("users").document(user_id).collection("oauth_tokens").document(provider)

    def _state_doc_ref(self, nonce: str):
        return self.db.collection("oauth_states").document(nonce)

    def _lock_doc_ref(self, user_id: str, provider: str):
        return self.db.collection("users").document(user_id).collection("oauth_locks").document(provider)

    # -------------------------------------------------------------------------
    # Token Persistence & Retrieval
    # -------------------------------------------------------------------------

    def save_tokens(
        self,
        user_id: str,
        access_token: str,
        refresh_token: str | None,
        expiry: str | None,
        scope: str = "https://www.googleapis.com/auth/gmail.send",
        account_email: str | None = None,
        gmail_address: str | None = None,
        provider: str = "gmail",
        health_status: str = "OPERATIONAL",
        metadata: dict[str, Any] | None = None,
    ) -> EncryptedOAuthTokenRecord:
        """Encrypt and persist OAuth tokens for the given user and provider.

        Preserves existing refresh token if Google omits it in a refresh cycle.
        """
        enc_access = encrypt_oauth_token(access_token)
        enc_refresh = encrypt_oauth_token(refresh_token) if refresh_token else None

        email_val = account_email or gmail_address
        existing = self.get_record(user_id, provider=provider)

        # Retain existing refresh token if not provided in this update
        if not enc_refresh and existing and existing.encryptedRefreshToken:
            enc_refresh = existing.encryptedRefreshToken

        now_iso = datetime.now(UTC).isoformat()
        connected_at = existing.connectedAt if existing else now_iso
        meta = metadata if metadata is not None else (existing.metadata if existing else {})

        record = EncryptedOAuthTokenRecord(
            userId=user_id,
            provider=provider,
            encryptedAccessToken=enc_access,
            encryptedRefreshToken=enc_refresh,
            tokenExpiry=expiry,
            scope=scope,
            accountEmail=email_val,
            gmailAddress=email_val,
            healthStatus=health_status,
            metadata=meta,
            connectedAt=connected_at,
            updatedAt=now_iso,
        )

        cache_key = f"{user_id}:{provider}"
        with self._mem_lock:
            self._cache[cache_key] = record

        if self.db is not None:
            try:
                doc_ref = self._token_doc_ref(user_id, provider)
                doc_ref.set(record.model_dump())
            except Exception as e:
                logger.warning(f"Firestore unavailable for saving OAuth tokens; using in-memory: {e}")

        return record

    def update_health_status(self, user_id: str, provider: str, health_status: str) -> None:
        """Update integration health status (e.g. NEEDS_REAUTHORIZATION on invalid_grant)."""
        record = self.get_record(user_id, provider=provider)
        if record:
            record.healthStatus = health_status
            record.updatedAt = datetime.now(UTC).isoformat()
            cache_key = f"{user_id}:{provider}"
            with self._mem_lock:
                self._cache[cache_key] = record
            if self.db is not None:
                try:
                    self._token_doc_ref(user_id, provider).update({
                        "healthStatus": health_status,
                        "updatedAt": record.updatedAt,
                    })
                except Exception as e:
                    logger.warning(f"Firestore update failed for health status: {e}")

    def get_record(self, user_id: str, provider: str = "gmail") -> Optional[EncryptedOAuthTokenRecord]:
        """Retrieve the encrypted OAuth record for a user and provider."""
        cache_key = f"{user_id}:{provider}"
        with self._mem_lock:
            if cache_key in self._cache:
                return self._cache[cache_key]

        if self.db is not None:
            try:
                doc = self._token_doc_ref(user_id, provider).get()
                if doc.exists:
                    record = EncryptedOAuthTokenRecord.model_validate(doc.to_dict())
                    with self._mem_lock:
                        self._cache[cache_key] = record
                    return record
            except Exception as e:
                logger.warning(f"Firestore get failed for OAuth record {user_id}/{provider}: {e}")

        return None

    def get_decrypted_tokens(self, user_id: str, provider: str = "gmail") -> Optional[dict[str, Any]]:
        """Retrieve and safely decrypt OAuth tokens for authorized operations."""
        record = self.get_record(user_id, provider=provider)
        if not record:
            return None

        try:
            access_token = decrypt_oauth_token(record.encryptedAccessToken)
            refresh_token = (
                decrypt_oauth_token(record.encryptedRefreshToken)
                if record.encryptedRefreshToken
                else None
            )
            return {
                "accessToken": access_token,
                "refreshToken": refresh_token,
                "tokenExpiry": record.tokenExpiry,
                "scope": record.scope,
                "accountEmail": record.accountEmail or record.gmailAddress,
                "gmailAddress": record.gmailAddress or record.accountEmail,
                "healthStatus": record.healthStatus,
                "metadata": record.metadata,
                "connectedAt": record.connectedAt,
                "updatedAt": record.updatedAt,
            }
        except Exception as e:
            logger.error(f"Failed to decrypt OAuth tokens for {user_id}/{provider}: {e}")
            return None

    def disconnect(self, user_id: str, provider: str = "gmail") -> bool:
        """Safely delete encrypted OAuth tokens for a user and provider."""
        cache_key = f"{user_id}:{provider}"
        with self._mem_lock:
            self._cache.pop(cache_key, None)

        if self.db is not None:
            try:
                self._token_doc_ref(user_id, provider).delete()
            except Exception as e:
                logger.warning(f"Firestore delete failed for OAuth record {user_id}/{provider}: {e}")

        return True

    # -------------------------------------------------------------------------
    # Atomic State Nonce Management (oauth_states/{nonce})
    # -------------------------------------------------------------------------

    def save_state_nonce(self, nonce: str, user_id: str, service: str, expires_at_iso: str) -> None:
        """Record an issued OAuth state nonce with strict TTL."""
        record = OAuthStateRecord(
            nonce=nonce,
            userId=user_id,
            service=service,
            expiresAt=expires_at_iso,
            consumed=False,
        )
        with self._mem_lock:
            self._state_cache[nonce] = record

        if self.db is not None:
            try:
                self._state_doc_ref(nonce).set(record.model_dump())
            except Exception as e:
                logger.warning(f"Firestore save failed for state nonce {nonce}: {e}")

    def consume_state_nonce(self, nonce: str, expected_user_id: str, expected_service: str) -> None:
        """Atomically consume an OAuth state nonce inside a transaction.

        Guarantees:
        - Nonce cannot be consumed more than once (replay prevention).
        - Nonce must not be expired.
        - User ID and service must strictly match.
        """
        now = datetime.now(UTC)

        if self.db is not None:
            from google.cloud import firestore

            @firestore.transactional
            def _consume_txn(transaction):
                doc_ref = self._state_doc_ref(nonce)
                snapshot = doc_ref.get(transaction=transaction)
                if not snapshot.exists:
                    raise OAuthStateError("OAuth state nonce not found or unrecognized.")

                data = snapshot.to_dict() or {}
                if data.get("consumed", False):
                    raise OAuthStateReplayError("OAuth state nonce has already been consumed. Replay rejected.")

                expires_at = datetime.fromisoformat(data["expiresAt"])
                if now > expires_at:
                    raise OAuthStateExpiredError("OAuth state nonce has expired.")

                if data.get("userId") != expected_user_id or data.get("service") != expected_service:
                    raise OAuthStateBindingError(
                        f"OAuth state parameter mismatch: expected ({expected_user_id}, {expected_service}), "
                        f"got ({data.get('userId')}, {data.get('service')})."
                    )

                transaction.update(doc_ref, {
                    "consumed": True,
                    "consumedAt": now.isoformat(),
                })

            try:
                transaction = self.db.transaction()
                _consume_txn(transaction)
                # Keep memory cache in sync
                with self._mem_lock:
                    if nonce in self._state_cache:
                        self._state_cache[nonce].consumed = True
                        self._state_cache[nonce].consumedAt = now.isoformat()
                return
            except (OAuthStateError, OAuthStateReplayError, OAuthStateExpiredError, OAuthStateBindingError):
                raise
            except Exception as e:
                logger.warning(f"Firestore state transaction failed ({e}), evaluating in-memory fallback")

        # In-memory thread-safe fallback (offline testing / local dev)
        with self._mem_lock:
            if nonce not in self._state_cache:
                raise OAuthStateError("OAuth state nonce not found or unrecognized.")

            record = self._state_cache[nonce]
            if record.consumed:
                raise OAuthStateReplayError("OAuth state nonce has already been consumed. Replay rejected.")

            expires_at = datetime.fromisoformat(record.expiresAt)
            if now > expires_at:
                raise OAuthStateExpiredError("OAuth state nonce has expired.")

            if record.userId != expected_user_id or record.service != expected_service:
                raise OAuthStateBindingError(
                    f"OAuth state parameter mismatch: expected ({expected_user_id}, {expected_service}), "
                    f"got ({record.userId}, {record.service})."
                )

            record.consumed = True
            record.consumedAt = now.isoformat()

    # -------------------------------------------------------------------------
    # Distributed Token Refresh Lease Coordination (users/{userId}/oauth_locks/{provider})
    # -------------------------------------------------------------------------

    def acquire_refresh_lease(
        self,
        user_id: str,
        provider: str,
        worker_id: str,
        lease_duration_sec: int = 30,
    ) -> bool:
        """Acquire distributed refresh lease.

        Returns True if lease acquired or reclaimed after expiration.
        Returns False if an unexpired lease is held by another worker.
        """
        now = datetime.now(UTC)
        lease_exp_iso = datetime.fromtimestamp(now.timestamp() + lease_duration_sec, UTC).isoformat()
        lock_key = f"{user_id}:{provider}"

        if self.db is not None:
            from google.cloud import firestore

            @firestore.transactional
            def _acquire_txn(transaction):
                doc_ref = self._lock_doc_ref(user_id, provider)
                snapshot = doc_ref.get(transaction=transaction)

                if snapshot.exists:
                    data = snapshot.to_dict() or {}
                    try:
                        exp_dt = datetime.fromisoformat(data.get("leaseExpiresAt", ""))
                    except Exception:
                        exp_dt = now

                    # Active lease held by another worker
                    if now < exp_dt and data.get("lockedBy") != worker_id:
                        return False

                # Free or expired: take lease
                transaction.set(doc_ref, {
                    "lockedBy": worker_id,
                    "lockedAt": now.isoformat(),
                    "leaseExpiresAt": lease_exp_iso,
                })
                return True

            try:
                transaction = self.db.transaction()
                res = _acquire_txn(transaction)
                if res:
                    with self._mem_lock:
                        self._lock_cache[lock_key] = OAuthLockRecord(
                            lockedBy=worker_id,
                            lockedAt=now.isoformat(),
                            leaseExpiresAt=lease_exp_iso,
                        )
                return bool(res)
            except Exception as e:
                logger.warning(f"Firestore lease acquisition failed ({e}); falling back to memory lock.")

        # In-memory lock fallback
        with self._mem_lock:
            existing = self._lock_cache.get(lock_key)
            if existing:
                try:
                    exp_dt = datetime.fromisoformat(existing.leaseExpiresAt)
                except Exception:
                    exp_dt = now

                if now < exp_dt and existing.lockedBy != worker_id:
                    return False

            self._lock_cache[lock_key] = OAuthLockRecord(
                lockedBy=worker_id,
                lockedAt=now.isoformat(),
                leaseExpiresAt=lease_exp_iso,
            )
            return True

    def renew_refresh_lease(
        self,
        user_id: str,
        provider: str,
        worker_id: str,
        additional_sec: int = 15,
    ) -> bool:
        """Renew lease duration if worker_id is the active owner."""
        now = datetime.now(UTC)
        new_exp_iso = datetime.fromtimestamp(now.timestamp() + additional_sec, UTC).isoformat()
        lock_key = f"{user_id}:{provider}"

        if self.db is not None:
            from google.cloud import firestore

            @firestore.transactional
            def _renew_txn(transaction):
                doc_ref = self._lock_doc_ref(user_id, provider)
                snapshot = doc_ref.get(transaction=transaction)
                if not snapshot.exists:
                    return False
                data = snapshot.to_dict() or {}
                if data.get("lockedBy") != worker_id:
                    return False
                transaction.update(doc_ref, {"leaseExpiresAt": new_exp_iso})
                return True

            try:
                transaction = self.db.transaction()
                res = _renew_txn(transaction)
                if res:
                    with self._mem_lock:
                        if lock_key in self._lock_cache and self._lock_cache[lock_key].lockedBy == worker_id:
                            self._lock_cache[lock_key].leaseExpiresAt = new_exp_iso
                return bool(res)
            except Exception as e:
                logger.warning(f"Firestore lease renewal failed: {e}")

        with self._mem_lock:
            existing = self._lock_cache.get(lock_key)
            if existing and existing.lockedBy == worker_id:
                existing.leaseExpiresAt = new_exp_iso
                return True
            return False

    def release_refresh_lease(self, user_id: str, provider: str, worker_id: str) -> bool:
        """Safely release lease document only if lockedBy matches current worker."""
        lock_key = f"{user_id}:{provider}"

        if self.db is not None:
            from google.cloud import firestore

            @firestore.transactional
            def _release_txn(transaction):
                doc_ref = self._lock_doc_ref(user_id, provider)
                snapshot = doc_ref.get(transaction=transaction)
                if not snapshot.exists:
                    return True
                data = snapshot.to_dict() or {}
                if data.get("lockedBy") == worker_id:
                    transaction.delete(doc_ref)
                return True

            try:
                transaction = self.db.transaction()
                _release_txn(transaction)
            except Exception as e:
                logger.warning(f"Firestore lease release failed: {e}")

        with self._mem_lock:
            existing = self._lock_cache.get(lock_key)
            if existing and existing.lockedBy == worker_id:
                self._lock_cache.pop(lock_key, None)

        return True


oauth_token_repo = OAuthTokenRepository()
