"""Phase 4 Mandatory Security & Integration Test Suite.

Verifies:
1. Authenticated user can create credential
2. Unauthenticated user cannot create credential (401)
3. User A cannot read User B credential (isolation / 404)
4. User A cannot update User B credential (isolation / 404)
5. User A cannot delete User B credential (isolation / 404)
6. Raw API key never appears in any API response
7. Raw API key never appears in logs or error messages
8. Stored Firestore value is encrypted with v1: nonce:tag:ciphertext
9. Encryption/decryption uses existing Phase 1 AES-256-GCM crypto
10. Tampered encrypted credential is rejected / safely skipped
11. Disabled credential is not selected by router
12. Deleted credential is not selected by router
13. FREE_ONLY blocks paid models
14. FREE_ONLY blocks unknown-cost models
15. FREE_PREFERRED requires explicit allowPaidFallback permission
16. Authenticated UID comes from verified token / auth dependency
17. Client-supplied UID cannot override authenticated UID
18. Credential provider validation rejects invalid/malformed providers
19. Credential update does not unnecessarily replace unchanged secrets
20. Safe masked-key formatting functions correctly
21. Firestore failure does not produce false success (returns 500)
22. AIOrchestrator loads and utilizes persisted credentials correctly
23. Existing Gemini intra-model fallback works with persisted credentials
24. Cross-provider fallback (OpenRouter/Groq) works with persisted credentials
25. AI settings CRUD and routing preferences persist accurately
"""

import logging
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from app.ai.adapters.gemini_adapter import GeminiAdapter
from app.ai.adapters.openrouter_adapter import OpenRouterAdapter
from app.ai.errors import AIRateLimitError
from app.ai.hub.crypto import (
    CryptoError,
    decrypt_api_key,
    encrypt_api_key,
    mask_api_key,
    sanitize_text,
)
from app.ai.hub.models import (
    ExecutionRequest,
    ProjectScope,
    UserCredential,
    evaluate_cost_policy,
)
from app.ai.hub.orchestrator import AIOrchestrator
from app.ai.hub.router import CandidateRoute
from app.ai.hub.types import (
    AITaskType,
    CostPolicy,
    CostTier,
    CredentialTier,
    ProviderType,
)
from app.core.auth import get_authenticated_user_id
from app.core.config import settings
from app.db.repositories.ai_credential_repo import AICredentialRepository, ai_credential_repo
from app.main import app
from app.schemas.ai_settings import (
    CredentialCreateRequest,
    CredentialUpdateRequest,
)
from app.services.ai_settings_service import ai_settings_service

client = TestClient(app)

USER_A = "user_alpha_111"
USER_B = "user_bravo_222"
SECRET_KEY_A = "AIzaSySecretTestKeyAlpha12345"
SECRET_KEY_B = "AIzaSySecretTestKeyBravo67890"


@pytest.fixture(autouse=True)
def setup_isolated_env(monkeypatch):
    """Ensure in-memory repository is active and clean before every test."""
    monkeypatch.setenv("AI_ENCRYPTION_SECRET", "jobfinder-master-encryption-secret-key-32bytes!")
    original_in_mem = ai_credential_repo._in_memory
    ai_credential_repo._in_memory = True
    ai_credential_repo.clear_memory()
    app.dependency_overrides.clear()
    yield
    ai_credential_repo.clear_memory()
    ai_credential_repo._in_memory = original_in_mem
    app.dependency_overrides.clear()


# ==============================================================================
# 1. Authenticated user can create credential
# ==============================================================================
def test_01_authenticated_user_can_create_credential():
    """Verify an authenticated user can register a new credential and receive safe metadata."""
    app.dependency_overrides[get_authenticated_user_id] = lambda: USER_A

    payload = {
        "provider": "gemini",
        "friendlyName": "My Work Gemini",
        "apiKey": SECRET_KEY_A,
        "costTier": "FREE_TIER",
        "enabled": True,
    }
    response = client.post("/api/v1/ai/credentials", json=payload)
    assert response.status_code == 201
    data = response.json()
    assert data["friendlyName"] == "My Work Gemini"
    assert data["provider"] == "gemini"
    assert data["userId"] == USER_A
    assert data["enabled"] is True
    assert "credentialId" in data
    assert data["maskedApiKey"].startswith("AIza")
    assert SECRET_KEY_A not in str(data)


# ==============================================================================
# 2. Unauthenticated user cannot create credential
# ==============================================================================
def test_02_unauthenticated_user_cannot_create_credential():
    """Verify unauthenticated requests without authorization are rejected."""
    # Temporarily set environment to production to enforce strict auth
    orig_env = settings.ENVIRONMENT
    settings.ENVIRONMENT = "production"
    try:
        payload = {
            "provider": "gemini",
            "friendlyName": "Sneaky Key",
            "apiKey": "AIzaSyUnauthorizedKey999",
        }
        response = client.post("/api/v1/ai/credentials", json=payload)
        assert response.status_code == 401
    finally:
        settings.ENVIRONMENT = orig_env


# ==============================================================================
# 3. User A cannot read User B credential
# ==============================================================================
def test_03_user_a_cannot_read_user_b_credential():
    """Verify User A cannot access User B's credential by ID or via list."""
    # Create credential as User B
    ai_credential_repo.clear_memory()
    app.dependency_overrides[get_authenticated_user_id] = lambda: USER_B
    b_resp = client.post(
        "/api/v1/ai/credentials",
        json={
            "provider": "openrouter",
            "friendlyName": "User B OpenRouter",
            "apiKey": "sk-or-v1-secretuserbkey12345",
        },
    )
    assert b_resp.status_code == 201
    b_cred_id = b_resp.json()["credentialId"]

    # Now switch to User A
    app.dependency_overrides[get_authenticated_user_id] = lambda: USER_A

    # Try to read User B's credential directly
    read_resp = client.get(f"/api/v1/ai/credentials/{b_cred_id}")
    assert read_resp.status_code == 404

    # List credentials as User A: User B's credential must not appear
    list_resp = client.get("/api/v1/ai/credentials")
    assert list_resp.status_code == 200
    cred_ids = [c["credentialId"] for c in list_resp.json()]
    assert b_cred_id not in cred_ids


# ==============================================================================
# 4. User A cannot update User B credential
# ==============================================================================
def test_04_user_a_cannot_update_user_b_credential():
    """Verify User A cannot modify User B's credential metadata or key."""
    # Create as User B
    app.dependency_overrides[get_authenticated_user_id] = lambda: USER_B
    b_resp = client.post(
        "/api/v1/ai/credentials",
        json={
            "provider": "groq",
            "friendlyName": "User B Groq",
            "apiKey": "gsk_secretuserbkey12345",
        },
    )
    b_cred_id = b_resp.json()["credentialId"]

    # Switch to User A and attempt update
    app.dependency_overrides[get_authenticated_user_id] = lambda: USER_A
    update_resp = client.put(
        f"/api/v1/ai/credentials/{b_cred_id}",
        json={"friendlyName": "Hijacked Name"},
    )
    assert update_resp.status_code == 404

    # Also test status patch
    patch_resp = client.patch(
        f"/api/v1/ai/credentials/{b_cred_id}/status",
        json={"enabled": False},
    )
    assert patch_resp.status_code == 404


# ==============================================================================
# 5. User A cannot delete User B credential
# ==============================================================================
def test_05_user_a_cannot_delete_user_b_credential():
    """Verify User A cannot delete User B's credential."""
    app.dependency_overrides[get_authenticated_user_id] = lambda: USER_B
    b_resp = client.post(
        "/api/v1/ai/credentials",
        json={
            "provider": "gemini",
            "friendlyName": "User B Gemini",
            "apiKey": SECRET_KEY_B,
        },
    )
    b_cred_id = b_resp.json()["credentialId"]

    # Switch to User A and attempt delete
    app.dependency_overrides[get_authenticated_user_id] = lambda: USER_A
    del_resp = client.delete(f"/api/v1/ai/credentials/{b_cred_id}")
    assert del_resp.status_code == 404

    # Verify credential still exists under User B
    app.dependency_overrides[get_authenticated_user_id] = lambda: USER_B
    check_resp = client.get(f"/api/v1/ai/credentials/{b_cred_id}")
    assert check_resp.status_code == 200


# ==============================================================================
# 6. Raw API key never appears in API responses
# ==============================================================================
def test_06_raw_api_key_never_appears_in_api_responses():
    """Verify raw secret is completely excluded from create, read, list, update, and patch responses."""
    app.dependency_overrides[get_authenticated_user_id] = lambda: USER_A

    # 1. Create
    create_res = client.post(
        "/api/v1/ai/credentials",
        json={
            "provider": "gemini",
            "friendlyName": "Secrecy Test",
            "apiKey": SECRET_KEY_A,
        },
    )
    assert SECRET_KEY_A not in create_res.text
    cred_id = create_res.json()["credentialId"]

    # 2. Get
    get_res = client.get(f"/api/v1/ai/credentials/{cred_id}")
    assert SECRET_KEY_A not in get_res.text

    # 3. List
    list_res = client.get("/api/v1/ai/credentials")
    assert SECRET_KEY_A not in list_res.text

    # 4. Update
    new_secret = "AIzaSyNewSuperSecretKey998877"
    update_res = client.put(
        f"/api/v1/ai/credentials/{cred_id}",
        json={"apiKey": new_secret, "friendlyName": "Updated Secret"},
    )
    assert new_secret not in update_res.text
    assert SECRET_KEY_A not in update_res.text

    # 5. Patch status
    patch_res = client.patch(
        f"/api/v1/ai/credentials/{cred_id}/status",
        json={"enabled": False},
    )
    assert new_secret not in patch_res.text


# ==============================================================================
# 7. Raw API key never appears in logs/errors
# ==============================================================================
def test_07_raw_api_key_never_appears_in_logs_or_errors(caplog):
    """Verify validation and internal errors never echo or log the raw secret key."""
    app.dependency_overrides[get_authenticated_user_id] = lambda: USER_A
    caplog.set_level(logging.DEBUG)

    sensitive_key = "AIzaSyVerySensitiveKeyNeverLogMe123"

    # Attempt create with invalid provider
    invalid_res = client.post(
        "/api/v1/ai/credentials",
        json={
            "provider": "unsupported_provider_xyz",
            "friendlyName": "Bad Key",
            "apiKey": sensitive_key,
        },
    )
    assert invalid_res.status_code == 422
    assert sensitive_key not in invalid_res.text
    assert sensitive_key not in caplog.text


# ==============================================================================
# 8. Stored Firestore value is encrypted
# ==============================================================================
def test_08_stored_firestore_value_is_encrypted():
    """Verify raw secret is encrypted at rest in Firestore repository before save."""
    app.dependency_overrides[get_authenticated_user_id] = lambda: USER_A

    res = client.post(
        "/api/v1/ai/credentials",
        json={
            "provider": "gemini",
            "friendlyName": "Encrypted Test",
            "apiKey": SECRET_KEY_A,
        },
    )
    cred_id = res.json()["credentialId"]

    # Directly inspect raw document from repository
    stored = ai_credential_repo.get_credential(USER_A, cred_id)
    assert stored is not None
    assert SECRET_KEY_A not in str(stored)
    encrypted_payload = stored.get("encryptedApiKey")
    assert encrypted_payload is not None
    # Payload format: v1:nonce:tag:ciphertext
    assert encrypted_payload.startswith("v1:")
    parts = encrypted_payload.split(":")
    assert len(parts) == 4


# ==============================================================================
# 9. Encryption/decryption uses existing Phase 1 crypto
# ==============================================================================
def test_09_encryption_decryption_uses_existing_crypto_vault():
    """Verify encrypt_api_key and decrypt_api_key roundtrip safely."""
    raw = "test-secret-value-phase4-crypto"
    encrypted = encrypt_api_key(raw)
    assert encrypted != raw
    assert encrypted.startswith("v1:")
    decrypted = decrypt_api_key(encrypted)
    assert decrypted == raw


# ==============================================================================
# 10. Tampered encrypted credential is rejected
# ==============================================================================
@pytest.mark.asyncio
async def test_10_tampered_encrypted_credential_is_rejected():
    """Verify tampered ciphertext or authentication tag raises CryptoError and is safely excluded."""
    # 1. Direct crypto check
    valid_enc = encrypt_api_key("valid-key")
    parts = valid_enc.split(":")
    # Tamper with ciphertext
    tampered_enc = f"{parts[0]}:{parts[1]}:{parts[2]}:tampereddata=="
    with pytest.raises(CryptoError):
        decrypt_api_key(tampered_enc)

    # 2. Service level: tampered credential in database is safely excluded from loaded profile
    ai_credential_repo.save_credential(
        USER_A,
        "cred_tampered_1",
        {
            "credentialId": "cred_tampered_1",
            "userId": USER_A,
            "provider": "gemini",
            "friendlyName": "Tampered Cred",
            "encryptedApiKey": tampered_enc,
            "maskedApiKey": "AIzaSy••••tampered",
            "enabled": True,
        },
    )

    profile = await ai_settings_service.load_user_ai_profile(USER_A)
    loaded_ids = [c.id for c in profile.credentials]
    assert "cred_tampered_1" not in loaded_ids


# ==============================================================================
# 11. Disabled credential is not selected by router
# ==============================================================================
@pytest.mark.asyncio
async def test_11_disabled_credential_is_not_selected_by_router():
    """Verify credentials marked enabled=False are omitted from loaded profile and router candidates."""
    # Create enabled and disabled credentials
    app.dependency_overrides[get_authenticated_user_id] = lambda: USER_A

    res1 = client.post(
        "/api/v1/ai/credentials",
        json={
            "provider": "gemini",
            "friendlyName": "Active Cred",
            "apiKey": SECRET_KEY_A,
            "enabled": True,
        },
    )
    active_id = res1.json()["credentialId"]

    res2 = client.post(
        "/api/v1/ai/credentials",
        json={
            "provider": "gemini",
            "friendlyName": "Disabled Cred",
            "apiKey": SECRET_KEY_B,
            "enabled": False,
        },
    )
    disabled_id = res2.json()["credentialId"]

    profile = await ai_settings_service.load_user_ai_profile(USER_A)
    cred_ids = [c.id for c in profile.credentials]
    assert active_id in cred_ids
    assert disabled_id not in cred_ids


# ==============================================================================
# 12. Deleted credential is not selected
# ==============================================================================
@pytest.mark.asyncio
async def test_12_deleted_credential_is_not_selected():
    """Verify deleted credentials are completely removed from execution consideration."""
    app.dependency_overrides[get_authenticated_user_id] = lambda: USER_A

    create_res = client.post(
        "/api/v1/ai/credentials",
        json={
            "provider": "gemini",
            "friendlyName": "Ephemeral Cred",
            "apiKey": SECRET_KEY_A,
        },
    )
    cred_id = create_res.json()["credentialId"]

    # Delete it
    del_res = client.delete(f"/api/v1/ai/credentials/{cred_id}")
    assert del_res.status_code == 200

    profile = await ai_settings_service.load_user_ai_profile(USER_A)
    assert all(c.id != cred_id for c in profile.credentials)


# ==============================================================================
# 13. FREE_ONLY blocks paid models
# ==============================================================================
def test_13_cost_policy_free_only_blocks_paid_models():
    """Verify evaluate_cost_policy rejects PAID tier when policy is FREE_ONLY."""
    assert evaluate_cost_policy(CostPolicy.FREE_ONLY, True, CostTier.PAID).allowed is False
    assert evaluate_cost_policy(CostPolicy.FREE_ONLY, False, CostTier.FREE).allowed is True


# ==============================================================================
# 14. FREE_ONLY blocks unknown-cost models
# ==============================================================================
def test_14_cost_policy_free_only_blocks_unknown_cost_models():
    """Verify evaluate_cost_policy rejects UNKNOWN cost under FREE_ONLY."""
    assert evaluate_cost_policy(CostPolicy.FREE_ONLY, True, CostTier.UNKNOWN).allowed is False


# ==============================================================================
# 15. FREE_PREFERRED requires explicit paid fallback permission
# ==============================================================================
def test_15_free_preferred_requires_explicit_allow_paid_fallback():
    """Verify FREE_PREFERRED only admits paid models when allowPaidFallback is True."""
    # Blocked without explicit permission
    assert evaluate_cost_policy(CostPolicy.FREE_PREFERRED, False, CostTier.PAID).allowed is False
    # Allowed with explicit permission
    assert evaluate_cost_policy(CostPolicy.FREE_PREFERRED, True, CostTier.PAID).allowed is True
    # Free tier always admitted
    assert evaluate_cost_policy(CostPolicy.FREE_PREFERRED, False, CostTier.FREE).allowed is True


# ==============================================================================
# 16. Authenticated UID comes from verified token / auth dependency
# ==============================================================================
@pytest.mark.asyncio
async def test_16_authenticated_uid_comes_from_verified_token():
    """Verify get_authenticated_user_id extracts UID from verified Firebase token."""
    with patch(
        "app.core.auth.firebase_auth.verify_id_token", return_value={"uid": "token_user_999"}
    ):
        uid = await get_authenticated_user_id(
            authorization="Bearer valid-mock-token", x_user_id=None
        )
        assert uid == "token_user_999"


# ==============================================================================
# 17. Client-supplied UID cannot override authenticated UID
# ==============================================================================
@pytest.mark.asyncio
async def test_17_client_supplied_uid_cannot_override_authenticated_uid():
    """Verify client-supplied X-User-Id conflicting with verified token UID is rejected with 403."""
    with patch(
        "app.core.auth.firebase_auth.verify_id_token", return_value={"uid": "real_verified_uid"}
    ):
        with pytest.raises(HTTPException) as exc_info:
            await get_authenticated_user_id(
                authorization="Bearer valid-mock-token",
                x_user_id="attacker_supplied_uid",
            )
        assert exc_info.value.status_code == 403
        assert "conflicts" in exc_info.value.detail.lower()


# ==============================================================================
# 18. Credential provider validation works
# ==============================================================================
def test_18_credential_provider_validation_works():
    """Verify invalid provider enums are rejected by schema validation."""
    app.dependency_overrides[get_authenticated_user_id] = lambda: USER_A

    res = client.post(
        "/api/v1/ai/credentials",
        json={
            "provider": "nonexistent_provider_foo",
            "friendlyName": "Invalid Provider",
            "apiKey": SECRET_KEY_A,
        },
    )
    assert res.status_code == 422


# ==============================================================================
# 19. Credential update does not unnecessarily replace unchanged secrets
# ==============================================================================
def test_19_credential_update_does_not_unnecessarily_replace_unchanged_secrets():
    """Verify metadata updates leave existing encryptedApiKey untouched."""
    app.dependency_overrides[get_authenticated_user_id] = lambda: USER_A

    created = client.post(
        "/api/v1/ai/credentials",
        json={
            "provider": "gemini",
            "friendlyName": "Original Name",
            "apiKey": SECRET_KEY_A,
        },
    ).json()
    cred_id = created["credentialId"]

    # Initial encrypted key from Firestore
    initial_doc = ai_credential_repo.get_credential(USER_A, cred_id)
    assert initial_doc is not None
    original_enc_key = initial_doc["encryptedApiKey"]

    # Update only friendlyName without providing apiKey
    update_res = client.put(
        f"/api/v1/ai/credentials/{cred_id}",
        json={"friendlyName": "Renamed Without Key Change"},
    )
    assert update_res.status_code == 200

    updated_doc = ai_credential_repo.get_credential(USER_A, cred_id)
    assert updated_doc is not None
    assert updated_doc["friendlyName"] == "Renamed Without Key Change"
    # Encrypted key should remain identical
    assert updated_doc["encryptedApiKey"] == original_enc_key


# ==============================================================================
# 20. Safe masked-key response works
# ==============================================================================
def test_20_safe_masked_key_response_works():
    """Verify mask_api_key returns properly formatted safe string."""
    assert mask_api_key("AIzaSy1234567890abcdef") == "AIzaSy...cdef"
    assert mask_api_key("short") == "***"
    assert mask_api_key("sk-or-v1-abcdef123456") == "sk-or-...3456"


# ==============================================================================
# 21. Firestore failure does not produce false success
# ==============================================================================
def test_21_firestore_failure_does_not_produce_false_success():
    """Verify that if Firestore raises an error, the API returns HTTP 500."""
    app.dependency_overrides[get_authenticated_user_id] = lambda: USER_A

    with patch.object(
        ai_credential_repo,
        "save_credential",
        side_effect=RuntimeError("Firestore connection refused"),
    ):
        res = client.post(
            "/api/v1/ai/credentials",
            json={
                "provider": "gemini",
                "friendlyName": "Will Fail",
                "apiKey": SECRET_KEY_A,
            },
        )
        assert res.status_code == 500
        assert "Database error" in res.json()["detail"]


# ==============================================================================
# 22. AIOrchestrator receives persisted credentials correctly
# ==============================================================================
@pytest.mark.asyncio
async def test_22_orchestrator_receives_persisted_credentials():
    """Verify AIOrchestrator auto-loads user profile from persistence and executes."""
    ai_settings_service.create_credential(
        USER_A,
        CredentialCreateRequest(
            provider=ProviderType.GEMINI,
            friendlyName="Persisted Gemini",
            apiKey="AIzaSyPersistedKeyAlpha12345",
            costTier=CredentialTier.FREE_TIER,
            enabled=True,
        ),
    )

    adapter = GeminiAdapter()
    adapter.generate_text = AsyncMock(return_value="Success from persisted credential")

    orchestrator = AIOrchestrator(register_defaults=False)
    orchestrator.register_adapter(adapter)

    req = ExecutionRequest(
        task=AITaskType.RESUME_TAILORING,
        prompt="Test prompt",
        user_id=USER_A,
    )

    result = await orchestrator.execute(req)
    assert result.text == "Success from persisted credential"
    adapter.generate_text.assert_called_once()
    call_kwargs = adapter.generate_text.call_args[1]
    assert call_kwargs["api_key"] == "AIzaSyPersistedKeyAlpha12345"


# ==============================================================================
# 23. Existing Gemini fallback still works with persisted credentials
# ==============================================================================
@pytest.mark.asyncio
async def test_23_existing_gemini_fallback_with_persisted_credentials():
    """Verify Gemini model fallback triggers seamlessly using persisted credentials."""
    ai_settings_service.create_credential(
        USER_A,
        CredentialCreateRequest(
            provider=ProviderType.GEMINI,
            friendlyName="Gemini Cred",
            apiKey=SECRET_KEY_A,
            costTier=CredentialTier.FREE_TIER,
            enabled=True,
        ),
    )

    adapter = GeminiAdapter()
    adapter.generate_text = AsyncMock(
        side_effect=[
            AIRateLimitError(
                "ResourceExhausted: 429 quota exceeded", model="gemini-2.5-flash-lite"
            ),
            "Failover model output",
        ]
    )

    orchestrator = AIOrchestrator(register_defaults=False)
    orchestrator.register_adapter(adapter)

    req = ExecutionRequest(
        task=AITaskType.RESUME_TAILORING,
        prompt="Tailor resume",
        user_id=USER_A,
    )

    res = await orchestrator.execute(req)
    assert res.text == "Failover model output"
    assert adapter.generate_text.call_count == 2


# ==============================================================================
# 24. Existing OpenRouter/Groq provider fallback works with persisted credentials
# ==============================================================================
@pytest.mark.asyncio
async def test_24_openrouter_and_groq_fallback_with_persisted_credentials():
    """Verify cross-provider fallback from Gemini to OpenRouter occurs with persisted credentials."""
    ai_settings_service.create_credential(
        USER_A,
        CredentialCreateRequest(
            provider=ProviderType.GEMINI,
            friendlyName="Gemini Cred",
            apiKey=SECRET_KEY_A,
            costTier=CredentialTier.FREE_TIER,
            enabled=True,
        ),
    )
    ai_settings_service.create_credential(
        USER_A,
        CredentialCreateRequest(
            provider=ProviderType.OPENROUTER,
            friendlyName="OpenRouter Cred",
            apiKey="sk-or-v1-persistedopenrouterkey",
            costTier=CredentialTier.FREE_TIER,
            enabled=True,
        ),
    )

    gemini_adapter = GeminiAdapter()
    gemini_adapter.generate_text = AsyncMock(
        side_effect=AIRateLimitError("All Gemini quota exhausted", model="gemini-2.5-flash-lite")
    )

    openrouter_adapter = OpenRouterAdapter()
    openrouter_adapter.generate_text = AsyncMock(return_value="Output from OpenRouter fallback")

    orchestrator = AIOrchestrator(register_defaults=False)
    orchestrator.register_adapter(gemini_adapter)
    orchestrator.register_adapter(openrouter_adapter)

    req = ExecutionRequest(
        task=AITaskType.RESUME_TAILORING,
        prompt="Tailor resume",
        user_id=USER_A,
    )

    res = await orchestrator.execute(req)
    assert res.text == "Output from OpenRouter fallback"
    assert res.provider_used == ProviderType.OPENROUTER
    openrouter_adapter.generate_text.assert_called_once()
    assert (
        openrouter_adapter.generate_text.call_args[1]["api_key"]
        == "sk-or-v1-persistedopenrouterkey"
    )


# ==============================================================================
# 25. AI settings CRUD and preferences persistence
# ==============================================================================
def test_25_ai_settings_crud_and_preferences_persistence():
    """Verify getting and updating AI settings (cost policy, paid fallback) persists accurately."""
    app.dependency_overrides[get_authenticated_user_id] = lambda: USER_A

    # Default settings
    get_res = client.get("/api/v1/ai/settings")
    assert get_res.status_code == 200
    defaults = get_res.json()
    assert defaults["costPolicy"] == "FREE_ONLY"
    assert defaults["allowPaidFallback"] is False

    # Update settings
    put_res = client.put(
        "/api/v1/ai/settings",
        json={
            "costPolicy": "FREE_PREFERRED",
            "allowPaidFallback": True,
            "providerPriority": ["gemini", "groq", "openrouter"],
        },
    )
    assert put_res.status_code == 200
    updated = put_res.json()
    assert updated["costPolicy"] == "FREE_PREFERRED"
    assert updated["allowPaidFallback"] is True
    assert updated["providerPriority"] == ["gemini", "groq", "openrouter"]

    # Refetch to confirm persistence
    refetch = client.get("/api/v1/ai/settings").json()
    assert refetch["costPolicy"] == "FREE_PREFERRED"
    assert refetch["allowPaidFallback"] is True
    assert refetch["providerPriority"] == ["gemini", "groq", "openrouter"]


# ==============================================================================
# 26. Domain models and request schemas never expose keys in repr or model_dump
# ==============================================================================
def test_26_repr_and_dump_never_expose_secrets():
    """Verify repr() and model_dump() on UserCredential, CandidateRoute, and Requests omit secrets."""
    secret = "AIzaSySuperSecretKey1234567890123456"

    # UserCredential
    cred = UserCredential(
        id="cred_test_01",
        user_id=USER_A,
        provider=ProviderType.GEMINI,
        friendly_name="Test Key",
        encrypted_api_key="v1:encrypted_blob",
        masked_key="AIza...3456",
        project_scope=ProjectScope(scope_id="scope_01"),
        cost_tier=CredentialTier.FREE_TIER,
        decrypted_key=secret,
    )
    # repr must not show decrypted_key or encrypted_api_key
    assert secret not in repr(cred)
    assert "v1:encrypted_blob" not in repr(cred)
    # model_dump must not contain decrypted_key
    dumped = cred.model_dump()
    assert "decrypted_key" not in dumped

    # CandidateRoute
    route = CandidateRoute(
        provider=ProviderType.GEMINI,
        model_id="gemini-2.5-flash",
        api_key=secret,
        adapter=MagicMock(),
    )
    assert secret not in repr(route)
    route_dump = route.model_dump()
    assert "api_key" not in route_dump

    # CredentialCreateRequest & CredentialUpdateRequest
    req = CredentialCreateRequest(
        provider=ProviderType.GEMINI,
        friendlyName="Key",
        apiKey=secret,
    )
    assert secret not in repr(req)
    update_req = CredentialUpdateRequest(apiKey=secret)
    assert secret not in repr(update_req)


# ==============================================================================
# 27. sanitize_text scrubs raw keys, bearer tokens, and URLs
# ==============================================================================
def test_27_sanitize_text_scrubs_keys_and_patterns():
    """Verify sanitize_text successfully masks explicit keys and pattern-matched credentials."""
    explicit_secret = "my-custom-unusual-secret-key-12345"
    text = f"Connection failed using {explicit_secret} at https://api.service.com"
    clean = sanitize_text(text, [explicit_secret])
    assert explicit_secret not in clean
    assert "***" in clean or "my-c" in clean

    # Pattern matches
    gemini_key = "AIzaSy" + ("0123456789" * 3) + "abc"
    openrouter_key = "sk-" + "or-v1-" + ("0123456789abcdef" * 4)
    groq_key = "gsk_" + ("mockkey" * 4)
    bearer_token = "Bearer secret-bearer-token-123456789"
    url_key = "https://generativelanguage.googleapis.com/v1beta?key=AIzaSySecretParam"

    sample = f"Errors: {gemini_key}, {openrouter_key}, {groq_key}, {bearer_token}, {url_key}"
    scrubbed = sanitize_text(sample)

    assert gemini_key not in scrubbed
    assert openrouter_key not in scrubbed
    assert groq_key not in scrubbed
    assert bearer_token not in scrubbed
    assert "AIzaSySecretParam" not in scrubbed
    assert "Bearer [REDACTED]" in scrubbed
    assert "?key=[REDACTED]" in scrubbed


# ==============================================================================
# 28. Production Firestore failure raises cleanly without silent in-memory fallback
# ==============================================================================
def test_28_production_firestore_failure_raises_cleanly(monkeypatch):
    """Verify that in production mode, Firestore initialization failure raises RuntimeError."""
    orig_env = settings.ENVIRONMENT
    settings.ENVIRONMENT = "production"
    repo = AICredentialRepository(in_memory=False)

    try:
        with patch(
            "app.db.repositories.ai_credential_repo.get_firestore_client",
            side_effect=Exception("Firestore unavailable in prod"),
        ):
            with pytest.raises(RuntimeError) as exc_info:
                repo.get_credential("user_123", "cred_123")
            assert "Cloud Firestore connection failed in production" in str(exc_info.value)
    finally:
        settings.ENVIRONMENT = orig_env


# ==============================================================================
# 29. Repository does not duplicate cache into memory when Firestore is active
# ==============================================================================
def test_29_repository_does_not_cache_in_memory_when_firestore_active():
    """Verify that when Firestore is active, save_credential does NOT populate _memory_credentials."""
    repo = AICredentialRepository(in_memory=False)
    mock_db = MagicMock()
    mock_doc = MagicMock()
    mock_db.collection.return_value.document.return_value.collection.return_value.document.return_value = mock_doc

    with patch.object(repo, "_get_db", return_value=mock_db):
        record = {
            "credentialId": "cred_live_01",
            "userId": "user_live",
            "encryptedApiKey": "v1:enc",
            "maskedApiKey": "AIza...1234",
        }
        res = repo.save_credential("user_live", "cred_live_01", record)
        mock_doc.set.assert_called_once()
        assert res["credentialId"] == "cred_live_01"
        # Must NOT exist in _memory_credentials
        assert ("user_live", "cred_live_01") not in repo._memory_credentials


# ==============================================================================
# 30. Repository purges raw key fields before saving
# ==============================================================================
def test_30_repository_purges_raw_key_fields_before_persistence():
    """Verify that any accidental raw key fields passed to save_credential are automatically stripped."""
    repo = AICredentialRepository(in_memory=True)
    dirty_record = {
        "credentialId": "cred_dirty_01",
        "userId": USER_A,
        "apiKey": "RAW_KEY_THAT_MUST_BE_PURGED",
        "decryptedKey": "RAW_DECRYPTED_KEY_PURGED",
        "rawKey": "ANOTHER_RAW_KEY",
        "encryptedApiKey": "v1:safe_cipher",
        "maskedApiKey": "AIza...9999",
    }
    saved = repo.save_credential(USER_A, "cred_dirty_01", dirty_record)
    assert "apiKey" not in saved
    assert "decryptedKey" not in saved
    assert "rawKey" not in saved
    assert saved["encryptedApiKey"] == "v1:safe_cipher"

    # Verify what was stored in memory
    retrieved = repo.get_credential(USER_A, "cred_dirty_01")
    assert retrieved is not None
    assert "apiKey" not in retrieved
    assert "decryptedKey" not in retrieved
    assert "rawKey" not in retrieved


# ==============================================================================
# 31. Upstream error containing API key is scrubbed in classify_error and attempted_hops
# ==============================================================================
@pytest.mark.asyncio
async def test_31_adapter_error_sanitization_prevents_key_leakage_in_hops():
    """Verify that an upstream exception containing an API key is scrubbed in attempted_hops."""
    leaked_raw_key = "AIzaSyLeakedRawSecretInErrorMessage12"

    ai_settings_service.create_credential(
        USER_A,
        CredentialCreateRequest(
            provider=ProviderType.GEMINI,
            friendlyName="Gemini Cred",
            apiKey=leaked_raw_key,
            costTier=CredentialTier.FREE_TIER,
            enabled=True,
        ),
    )

    # Simulate upstream exception echoing the raw key in its error message
    class LeakyProviderException(Exception):
        pass

    gemini_adapter = GeminiAdapter()
    gemini_adapter.generate_text = AsyncMock(
        side_effect=LeakyProviderException(
            f"403 Forbidden: Request with key {leaked_raw_key} refused by upstream"
        )
    )

    openrouter_adapter = OpenRouterAdapter()
    openrouter_adapter.generate_text = AsyncMock(return_value="Recovered on OpenRouter")

    orchestrator = AIOrchestrator(register_defaults=False)
    orchestrator.register_adapter(gemini_adapter)
    orchestrator.register_adapter(openrouter_adapter)

    # Register fallback openrouter key
    ai_settings_service.create_credential(
        USER_A,
        CredentialCreateRequest(
            provider=ProviderType.OPENROUTER,
            friendlyName="OpenRouter Fallback",
            apiKey="sk-or-v1-fallbackopenrouterkey12345",
            costTier=CredentialTier.FREE_TIER,
            enabled=True,
        ),
    )

    req = ExecutionRequest(
        task=AITaskType.RESUME_TAILORING,
        prompt="Test prompt",
        user_id=USER_A,
    )

    res = await orchestrator.execute(req)
    assert res.text == "Recovered on OpenRouter"

    # Inspect attempted_hops for first failed hop
    failed_hop = res.attempted_hops[0]
    assert failed_hop["status"] == "FAILED"
    # The raw key MUST NOT appear in the hop error message
    assert leaked_raw_key not in failed_hop["error"]
    assert str(failed_hop).find(leaked_raw_key) == -1
