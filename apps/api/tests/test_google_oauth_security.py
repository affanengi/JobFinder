"""Comprehensive test suite for Google Third-Party Connections (v3.0).

Validates:
1. HKDF domain separation deriving independent AES-256 vault and HMAC state keys.
2. Tamper-evident, short-lived, signed OAuth state and atomic single-use nonce consumption.
3. Multi-worker concurrent callback safety (replay rejection).
4. Multi-worker distributed token refresh lease coordination and abandoned lock recovery.
5. Refresh token preservation and invalid_grant status transitions.
6. Provider isolation: separate OAuth client IDs; disconnecting one does not affect siblings.
7. Truthful two-phase disconnect statuses (200 OK -> DISCONNECTED_AND_REVOKED, 400 -> DISCONNECTED_ALREADY_INACTIVE, timeout -> DISCONNECTED_LOCAL_ONLY_WARNING).
"""

import asyncio
import concurrent.futures
from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock, patch
import httpx
import pytest
from fastapi.testclient import TestClient

from app.core.config import settings
from app.core.oauth_crypto import (
    OAuthCryptoError,
    OAuthCryptoKeyInvalidError,
    OAuthCryptoKeyMissingError,
    OAuthCryptoTamperError,
    OAuthStateBindingError,
    OAuthStateError,
    OAuthStateExpiredError,
    OAuthStateReplayError,
    OAuthStateSignatureError,
    decrypt_oauth_token,
    derive_oauth_subkeys,
    encrypt_oauth_token,
    get_oauth_master_key_bytes,
    sign_oauth_state,
    verify_oauth_state,
)
from app.db.repositories.oauth_token_repo import oauth_token_repo
from app.main import app
from app.services.google_oauth_service import (
    GoogleNotConnectedError,
    GoogleOAuthConfigError,
    GoogleOAuthService,
    GoogleReauthorizationRequiredError,
    GoogleTokenRefreshError,
    google_oauth_service,
)

client = TestClient(app)
TEST_SECRET = "a-dedicated-test-oauth-secret-key-at-least-32-chars-long!"
TEST_USER = "user_oauth_test_tenant_42"


@pytest.fixture(autouse=True)
def setup_test_env(monkeypatch):
    """Ensure dedicated OAuth test secret and provider clients are configured."""
    monkeypatch.setattr(settings, "OAUTH_ENCRYPTION_SECRET", TEST_SECRET)
    monkeypatch.setattr(settings, "GOOGLE_GMAIL_CLIENT_ID", "gmail_client_id.apps.googleusercontent.com")
    monkeypatch.setattr(settings, "GOOGLE_GMAIL_CLIENT_SECRET", "gmail_client_secret")
    monkeypatch.setattr(settings, "GOOGLE_CALENDAR_CLIENT_ID", "calendar_client_id.apps.googleusercontent.com")
    monkeypatch.setattr(settings, "GOOGLE_CALENDAR_CLIENT_SECRET", "calendar_client_secret")
    monkeypatch.setattr(settings, "GOOGLE_DRIVE_CLIENT_ID", "drive_client_id.apps.googleusercontent.com")
    monkeypatch.setattr(settings, "GOOGLE_DRIVE_CLIENT_SECRET", "drive_client_secret")
    # Clean up token caches
    oauth_token_repo._cache.clear()
    oauth_token_repo._state_cache.clear()
    oauth_token_repo._lock_cache.clear()
    if oauth_token_repo.db is not None:
        try:
            for svc in ["gmail", "calendar", "drive"]:
                oauth_token_repo.db.collection("users").document(TEST_USER).collection("oauth_locks").document(svc).delete()
                oauth_token_repo.db.collection("users").document(TEST_USER).collection("oauth_tokens").document(svc).delete()
        except Exception:
            pass


# ==============================================================================
# 1. Cryptographic Domain Separation & Vault Security
# ==============================================================================

def test_hkdf_domain_separation_derives_distinct_keys():
    """Verify HKDF-SHA256 derives two independent 32-byte keys for vault and state signing."""
    aes_key, signing_key = derive_oauth_subkeys(TEST_SECRET)
    assert len(aes_key) == 32
    assert len(signing_key) == 32
    assert aes_key != signing_key
    assert aes_key != TEST_SECRET.encode("utf-8")
    assert signing_key != TEST_SECRET.encode("utf-8")


def test_reject_fallback_or_identity_with_ai_secret(monkeypatch):
    """Verify OAUTH_ENCRYPTION_SECRET cannot match or fall back to AI_ENCRYPTION_SECRET."""
    shared_secret = "identical-secret-value-that-violates-isolation-32b!"
    monkeypatch.setattr(settings, "AI_ENCRYPTION_SECRET", shared_secret)
    monkeypatch.setattr(settings, "OAUTH_ENCRYPTION_SECRET", shared_secret)
    monkeypatch.setenv("AI_ENCRYPTION_SECRET", shared_secret)
    monkeypatch.setenv("OAUTH_ENCRYPTION_SECRET", shared_secret)

    with pytest.raises(OAuthCryptoKeyInvalidError, match="must be dedicated and distinct"):
        derive_oauth_subkeys(shared_secret)


def test_encryption_decryption_and_tamper_detection():
    """Verify AES-256-GCM token encryption and authentication tag tamper detection."""
    token = "ya29.a0AfH6SMTestAccessToken1234567890"
    encrypted = encrypt_oauth_token(token)
    assert encrypted.startswith("v1:")

    decrypted = decrypt_oauth_token(encrypted)
    assert decrypted == token

    # Tamper with 1 byte of the payload
    parts = encrypted.split(":")
    tampered_cipher = parts[3][:-4] + "AAAA"
    tampered_payload = f"{parts[0]}:{parts[1]}:{parts[2]}:{tampered_cipher}"

    with pytest.raises(OAuthCryptoTamperError):
        decrypt_oauth_token(tampered_payload)


# ==============================================================================
# 2. State Signing, Expiration, and Atomic Nonce Consumption
# ==============================================================================

def test_state_signature_and_tamper_rejection():
    """Verify state signing uses derived HMAC key and rejects modified state parameters."""
    nonce = "testnonce123456"
    exp_ts = datetime.now(UTC).timestamp() + 300
    state = sign_oauth_state(TEST_USER, "gmail", nonce, exp_ts)

    verified = verify_oauth_state(state, expected_service="gmail")
    assert verified["userId"] == TEST_USER
    assert verified["service"] == "gmail"
    assert verified["nonce"] == nonce

    # Tamper with state (change service to drive)
    parts = state.split(":")
    tampered_state = f"{parts[0]}:drive:{parts[2]}:{parts[3]}:{parts[4]}"
    with pytest.raises(OAuthStateSignatureError):
        verify_oauth_state(tampered_state)


def test_expired_state_rejected():
    """Verify state parameters exceeding TTL are rejected."""
    nonce = "expired_nonce_123"
    expired_ts = datetime.now(UTC).timestamp() - 10  # 10s in past
    state = sign_oauth_state(TEST_USER, "calendar", nonce, expired_ts)

    with pytest.raises(OAuthStateExpiredError):
        verify_oauth_state(state, expected_service="calendar")


def test_service_binding_mismatch_rejected():
    """Verify state signed for gmail cannot be redeemed for calendar."""
    nonce = "binding_nonce_123"
    exp_ts = datetime.now(UTC).timestamp() + 300
    state = sign_oauth_state(TEST_USER, "gmail", nonce, exp_ts)

    with pytest.raises(OAuthStateBindingError):
        verify_oauth_state(state, expected_service="calendar")


def test_atomic_nonce_consumption_and_replay_rejection():
    """Verify state nonces can only be consumed once."""
    nonce = "replay_nonce_abc"
    exp_iso = datetime.fromtimestamp(datetime.now(UTC).timestamp() + 300, UTC).isoformat()

    oauth_token_repo.save_state_nonce(nonce, TEST_USER, "drive", exp_iso)

    # First consumption succeeds
    oauth_token_repo.consume_state_nonce(nonce, TEST_USER, "drive")

    # Second consumption must be rejected with OAuthStateReplayError
    with pytest.raises(OAuthStateReplayError):
        oauth_token_repo.consume_state_nonce(nonce, TEST_USER, "drive")


def test_concurrent_state_consumption_multi_worker():
    """Simulate 5 concurrent worker threads consuming the same nonce simultaneously."""
    nonce = "concurrent_nonce_xyz"
    exp_iso = datetime.fromtimestamp(datetime.now(UTC).timestamp() + 300, UTC).isoformat()
    oauth_token_repo.save_state_nonce(nonce, TEST_USER, "gmail", exp_iso)

    success_count = 0
    replay_count = 0

    def attempt_consume():
        try:
            oauth_token_repo.consume_state_nonce(nonce, TEST_USER, "gmail")
            return "SUCCESS"
        except OAuthStateReplayError:
            return "REPLAY"

    with concurrent.futures.ThreadPoolExecutor(max_workers=5) as executor:
        futures = [executor.submit(attempt_consume) for _ in range(5)]
        results = [f.result() for f in futures]

    for r in results:
        if r == "SUCCESS":
            success_count += 1
        elif r == "REPLAY":
            replay_count += 1

    assert success_count == 1, f"Expected exactly 1 success, got {success_count}"
    assert replay_count == 4, f"Expected 4 replay rejections, got {replay_count}"


# ==============================================================================
# 3. Multi-Worker Distributed Token Refresh Lease
# ==============================================================================

def test_distributed_refresh_lease_coordination():
    """Verify only 1 worker acquires lease while others detect active lock."""
    worker_1 = "worker_pid_101"
    worker_2 = "worker_pid_102"

    acquired_1 = oauth_token_repo.acquire_refresh_lease(TEST_USER, "gmail", worker_1, lease_duration_sec=30)
    assert acquired_1 is True

    # Worker 2 attempts while lease is active
    acquired_2 = oauth_token_repo.acquire_refresh_lease(TEST_USER, "gmail", worker_2, lease_duration_sec=30)
    assert acquired_2 is False

    # Worker 1 releases lease
    oauth_token_repo.release_refresh_lease(TEST_USER, "gmail", worker_1)

    # Worker 2 can now acquire lease
    acquired_2_retry = oauth_token_repo.acquire_refresh_lease(TEST_USER, "gmail", worker_2, lease_duration_sec=30)
    assert acquired_2_retry is True
    oauth_token_repo.release_refresh_lease(TEST_USER, "gmail", worker_2)


def test_abandoned_lease_recovery():
    """Verify an expired lease (e.g. from crashed worker) is reclaimed safely by another worker."""
    worker_crashed = "worker_dead_pid"
    worker_recovering = "worker_alive_pid"

    # Set lease that expires immediately
    oauth_token_repo.acquire_refresh_lease(TEST_USER, "calendar", worker_crashed, lease_duration_sec=-5)

    # Recovering worker attempts acquisition
    recovered = oauth_token_repo.acquire_refresh_lease(TEST_USER, "calendar", worker_recovering, lease_duration_sec=30)
    assert recovered is True
    oauth_token_repo.release_refresh_lease(TEST_USER, "calendar", worker_recovering)


def test_lease_release_only_by_owner():
    """Verify a worker cannot release a lease owned by another worker."""
    worker_owner = "worker_owner_1"
    worker_intruder = "worker_intruder_2"

    oauth_token_repo.acquire_refresh_lease(TEST_USER, "drive", worker_owner, lease_duration_sec=30)

    # Intruder tries to release
    oauth_token_repo.release_refresh_lease(TEST_USER, "drive", worker_intruder)

    # Owner still holds lock
    intruder_acquire = oauth_token_repo.acquire_refresh_lease(TEST_USER, "drive", worker_intruder, lease_duration_sec=30)
    assert intruder_acquire is False
    oauth_token_repo.release_refresh_lease(TEST_USER, "drive", worker_owner)


# ==============================================================================
# 4. Token Refresh Invariants & Preservation
# ==============================================================================

@pytest.mark.asyncio
async def test_refresh_preserves_existing_refresh_token():
    """When Google omits refresh_token during a refresh cycle, the existing refresh token is preserved."""
    # Seed stored credentials
    oauth_token_repo.save_tokens(
        user_id=TEST_USER,
        access_token="old_access_token",
        refresh_token="stored_permanent_refresh_token_123",
        expiry=datetime.now(UTC).isoformat(),  # Expired
        provider="gmail",
    )

    mock_response = httpx.Response(
        200,
        json={"access_token": "new_refreshed_access_token", "expires_in": 3600},
        request=httpx.Request("POST", "https://oauth2.googleapis.com/token"),
    )

    with patch.object(httpx.AsyncClient, "post", new_callable=AsyncMock) as mock_post:
        mock_post.return_value = mock_response
        valid_token = await google_oauth_service.get_valid_access_token(TEST_USER, "gmail")

        assert valid_token == "new_refreshed_access_token"

        # Verify stored refresh token is still present and unchanged
        stored = oauth_token_repo.get_decrypted_tokens(TEST_USER, provider="gmail")
        assert stored is not None
        assert stored["refreshToken"] == "stored_permanent_refresh_token_123"
        assert stored["accessToken"] == "new_refreshed_access_token"
        assert stored["healthStatus"] == "OPERATIONAL"


@pytest.mark.asyncio
async def test_refresh_invalid_grant_transitions_to_needs_reauth():
    """Google returning 400 invalid_grant marks status as NEEDS_REAUTHORIZATION."""
    oauth_token_repo.save_tokens(
        user_id=TEST_USER,
        access_token="old_access_token",
        refresh_token="revoked_refresh_token",
        expiry=datetime.now(UTC).isoformat(),
        provider="calendar",
    )

    mock_response = httpx.Response(
        400,
        json={"error": "invalid_grant", "error_description": "Token has been expired or revoked."},
        request=httpx.Request("POST", "https://oauth2.googleapis.com/token"),
    )

    with patch.object(httpx.AsyncClient, "post", new_callable=AsyncMock) as mock_post:
        mock_post.return_value = mock_response

        with pytest.raises(GoogleReauthorizationRequiredError):
            await google_oauth_service.get_valid_access_token(TEST_USER, "calendar")

        record = oauth_token_repo.get_record(TEST_USER, provider="calendar")
        assert record is not None
        assert record.healthStatus == "NEEDS_REAUTHORIZATION"


# ==============================================================================
# 5. Provider Isolation (Separate Clients & Grants)
# ==============================================================================

@pytest.mark.asyncio
async def test_provider_credentials_isolated():
    """Verify Gmail, Calendar, and Drive credentials are independently vaulted and isolated."""
    # Seed 3 distinct services
    oauth_token_repo.save_tokens(TEST_USER, "gmail_acc", "gmail_ref", None, provider="gmail")
    oauth_token_repo.save_tokens(TEST_USER, "cal_acc", "cal_ref", None, provider="calendar")
    oauth_token_repo.save_tokens(TEST_USER, "drive_acc", "drive_ref", None, provider="drive")

    assert oauth_token_repo.get_decrypted_tokens(TEST_USER, "gmail")["accessToken"] == "gmail_acc"
    assert oauth_token_repo.get_decrypted_tokens(TEST_USER, "calendar")["accessToken"] == "cal_acc"
    assert oauth_token_repo.get_decrypted_tokens(TEST_USER, "drive")["accessToken"] == "drive_acc"

    # Disconnect Calendar with confirmed Google revocation
    with patch.object(httpx.AsyncClient, "post", new_callable=AsyncMock) as mock_post:
        mock_post.return_value = httpx.Response(200, request=httpx.Request("POST", "https://oauth2.googleapis.com/revoke"))
        res = await google_oauth_service.disconnect_service(TEST_USER, "calendar")

        assert res["status"] == "DISCONNECTED_AND_REVOKED"

    # Calendar is now purged, but Gmail and Drive are 100% untouched
    assert oauth_token_repo.get_decrypted_tokens(TEST_USER, "calendar") is None
    assert oauth_token_repo.get_decrypted_tokens(TEST_USER, "gmail")["accessToken"] == "gmail_acc"
    assert oauth_token_repo.get_decrypted_tokens(TEST_USER, "drive")["accessToken"] == "drive_acc"


# ==============================================================================
# 6. Truthful Disconnect State Machine & Remote Failures
# ==============================================================================

@pytest.mark.asyncio
async def test_disconnect_already_inactive_google_400():
    """When Google returns 400 invalid_token, status reflects DISCONNECTED_ALREADY_INACTIVE."""
    oauth_token_repo.save_tokens(TEST_USER, "token_acc", "token_ref", None, provider="drive")

    with patch.object(httpx.AsyncClient, "post", new_callable=AsyncMock) as mock_post:
        mock_post.return_value = httpx.Response(
            400,
            json={"error": "invalid_token"},
            request=httpx.Request("POST", "https://oauth2.googleapis.com/revoke"),
        )
        res = await google_oauth_service.disconnect_service(TEST_USER, "drive")

        assert res["status"] == "DISCONNECTED_ALREADY_INACTIVE"
        assert "already inactive" in res["message"].lower()

    # Local credentials purged
    assert oauth_token_repo.get_decrypted_tokens(TEST_USER, "drive") is None


@pytest.mark.asyncio
async def test_disconnect_network_timeout_returns_warning_banner():
    """When Google revocation times out, local tokens are still purged and warning status returned."""
    oauth_token_repo.save_tokens(TEST_USER, "token_acc", "token_ref", None, provider="gmail")

    with patch.object(httpx.AsyncClient, "post", new_callable=AsyncMock) as mock_post:
        mock_post.side_effect = httpx.TimeoutException("Google network timed out")
        res = await google_oauth_service.disconnect_service(TEST_USER, "gmail")

        assert res["status"] == "DISCONNECTED_LOCAL_ONLY_WARNING"
        assert "could not reach google" in res["message"].lower()

    # Local credentials purged for candidate privacy
    assert oauth_token_repo.get_decrypted_tokens(TEST_USER, "gmail") is None


# ==============================================================================
# 7. Connections API Routes Integration
# ==============================================================================

def test_api_authorize_url_generation():
    """Verify GET /api/v1/connections/google/{service}/authorize returns signed URL."""
    headers = {"Authorization": f"Bearer {TEST_USER}"}
    response = client.get("/api/v1/connections/google/gmail/authorize", headers=headers)
    assert response.status_code == 200
    data = response.json()
    assert "authorizationUrl" in data
    assert "accounts.google.com" in data["authorizationUrl"]
    assert "state=" in data["authorizationUrl"]
    assert data["service"] == "gmail"


def test_api_status_endpoint():
    """Verify GET /api/v1/connections/google/{service}/status returns safe status response."""
    oauth_token_repo.save_tokens(
        user_id=TEST_USER,
        access_token="test_acc",
        refresh_token="test_ref",
        expiry=None,
        account_email="recruiter.candidate@gmail.com",
        scope=f"{settings.GMAIL_SEND_SCOPE} {settings.GMAIL_READ_SCOPE}",
        provider="gmail",
    )

    headers = {"Authorization": f"Bearer {TEST_USER}"}
    response = client.get("/api/v1/connections/google/gmail/status", headers=headers)
    assert response.status_code == 200
    data = response.json()
    assert data["isConnected"] is True
    assert data["accountEmail"] == "recruiter.candidate@gmail.com"
    assert data["hasSendPermission"] is True
    assert data["hasReadPermission"] is True
    # Zero token leakage
    assert "access_token" not in data
    assert "refreshToken" not in data
