"""Phase 5 Mandatory Verification & Test Suite.

Verifies:
1. Controlled server-side credential probe (`POST /api/v1/ai/credentials/{id}/probe`) succeeds safely
2. Credential probe catches 401 and updates HealthRegistry to INVALID_KEY without leaking secrets
3. Credential probe catches rate limit and updates HealthRegistry to COOLDOWN
4. Credential probe multi-user isolation: User A cannot probe User B credential (404)
5. Credential probe 404 on nonexistent credential
6. Credential probe response NEVER contains raw API key or authorization headers
7. Live health diagnostics endpoint (`GET /api/v1/ai/health`) returns real provider and credential counts
8. Health diagnostics multi-user cooldown isolation (User A cooldown invisible to User B)
9. Model catalog endpoint (`GET /api/v1/ai/models`) aggregates real descriptors from all registered adapters
10. Telemetry initial empty state returns 0 requests without fake placeholders
11. Telemetry records real AI execution on orchestrator success
12. Telemetry records fallback events with correct fallbackLevel and hopsCount
13. Telemetry multi-user isolation (User A cannot view User B executions)
14. Telemetry persistence resilience (telemetry database write failure NEVER breaks AI execution)
15. Telemetry sanitization (prompts, completions, auth headers, and raw keys strictly stripped)
16. Task routing preferences in settings prioritize preferred provider for the designated task
17. Task routing strictly respects cost policy (FREE_ONLY rejects paid preferred providers)
18. GeminiProvider facade forwards user_id and records telemetry under the authenticated user
"""

from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient

from app.ai.errors import (
    AIAuthenticationError,
    AIRateLimitError,
    AITransientError,
)
from app.ai.gemini import GeminiProvider
from app.ai.hub.models import ExecutionRequest, UserAIProfile
from app.ai.hub.orchestrator import ai_orchestrator
from app.ai.hub.router import AIRouter
from app.ai.hub.types import (
    AITaskType,
    CostPolicy,
    CostTier,
    CredentialHealth,
    ProviderType,
)
from app.core.auth import get_authenticated_user_id
from app.db.repositories.ai_credential_repo import ai_credential_repo
from app.db.repositories.ai_telemetry_repo import ai_telemetry_repo
from app.main import app

client = TestClient(app)

USER_A = "user_alpha_555"
USER_B = "user_bravo_666"
SECRET_KEY_A = "AIzaSySecretPhase5KeyAlpha999"
SECRET_KEY_B = "AIzaSySecretPhase5KeyBravo888"


@pytest.fixture(autouse=True)
def setup_isolated_env(monkeypatch):
    """Ensure in-memory repository is active and clean before every test."""
    monkeypatch.setenv("AI_ENCRYPTION_SECRET", "jobfinder-master-encryption-secret-key-32bytes!")
    original_cred_in_mem = ai_credential_repo._in_memory
    original_tele_in_mem = ai_telemetry_repo._in_memory
    ai_credential_repo._in_memory = True
    ai_telemetry_repo._in_memory = True
    ai_credential_repo.clear_memory()
    ai_telemetry_repo.clear_memory()
    ai_orchestrator.health_registry.reset()
    app.dependency_overrides.clear()
    yield
    ai_credential_repo.clear_memory()
    ai_telemetry_repo.clear_memory()
    ai_orchestrator.health_registry.reset()
    ai_credential_repo._in_memory = original_cred_in_mem
    ai_telemetry_repo._in_memory = original_tele_in_mem
    app.dependency_overrides.clear()


# ==============================================================================
# 1. Controlled Credential Probe Succeeded
# ==============================================================================
@pytest.mark.asyncio
async def test_01_probe_credential_success():
    """Verify testing a valid credential connection returns safe diagnostic response."""
    app.dependency_overrides[get_authenticated_user_id] = lambda: USER_A

    # 1. Create a credential
    create_res = client.post(
        "/api/v1/ai/credentials",
        json={
            "provider": "gemini",
            "friendlyName": "Probe Test Gemini",
            "apiKey": SECRET_KEY_A,
            "costTier": "FREE_TIER",
            "enabled": True,
        },
    )
    assert create_res.status_code == 201
    cred_id = create_res.json()["credentialId"]

    # 2. Mock adapter execution to succeed
    adapter = ai_orchestrator.get_adapter(ProviderType.GEMINI)
    assert adapter is not None
    with patch.object(adapter, "generate_text", new_callable=AsyncMock) as mock_gen:
        mock_gen.return_value = "pong"
        probe_res = client.post(
            f"/api/v1/ai/credentials/{cred_id}/probe",
            json={"customPrompt": "ping"},
        )

        assert probe_res.status_code == 200
        data = probe_res.json()
        assert data["credentialId"] == cred_id
        assert data["provider"] == "gemini"
        assert data["success"] is True
        assert data["healthStatus"] == "HEALTHY"
        assert data["latencyMs"] >= 0
        assert SECRET_KEY_A not in str(data)

    assert ai_orchestrator.health_registry.is_credential_healthy(USER_A, cred_id)


# ==============================================================================
# 2. Credential Probe Authentication Failure (401)
# ==============================================================================
@pytest.mark.asyncio
async def test_02_probe_credential_authentication_failure():
    """Verify an invalid API key caught during probe sets INVALID_KEY and does not leak key."""
    app.dependency_overrides[get_authenticated_user_id] = lambda: USER_A

    create_res = client.post(
        "/api/v1/ai/credentials",
        json={
            "provider": "gemini",
            "friendlyName": "Bad Key Gemini",
            "apiKey": "AIzaSyInvalidKeyTest123",
            "costTier": "FREE_TIER",
            "enabled": True,
        },
    )
    cred_id = create_res.json()["credentialId"]

    adapter = ai_orchestrator.get_adapter(ProviderType.GEMINI)
    assert adapter is not None

    with patch.object(adapter, "generate_text", new_callable=AsyncMock) as mock_gen:
        mock_gen.side_effect = AIAuthenticationError(
            "API_KEY_INVALID: API key not valid. Please pass a valid API key."
        )
        probe_res = client.post(
            f"/api/v1/ai/credentials/{cred_id}/probe",
            json={"customPrompt": "ping"},
        )

        assert probe_res.status_code == 200
        data = probe_res.json()
        assert data["credentialId"] == cred_id
        assert data["success"] is False
        assert data["healthStatus"] == "INVALID_KEY"
        assert "Authentication failed" in data["message"]
        assert "AIzaSyInvalidKeyTest123" not in str(data)

    assert (
        ai_orchestrator.health_registry.get_credential_health(USER_A, cred_id)
        == CredentialHealth.INVALID_KEY
    )


# ==============================================================================
# 3. Credential Probe Rate Limited (429)
# ==============================================================================
@pytest.mark.asyncio
async def test_03_probe_credential_rate_limited():
    """Verify rate limit during probe sets COOLDOWN on HealthRegistry."""
    app.dependency_overrides[get_authenticated_user_id] = lambda: USER_A

    create_res = client.post(
        "/api/v1/ai/credentials",
        json={
            "provider": "gemini",
            "friendlyName": "Rate Limited Gemini",
            "apiKey": SECRET_KEY_A,
            "costTier": "FREE_TIER",
            "enabled": True,
        },
    )
    cred_id = create_res.json()["credentialId"]

    adapter = ai_orchestrator.get_adapter(ProviderType.GEMINI)
    assert adapter is not None

    with patch.object(adapter, "generate_text", new_callable=AsyncMock) as mock_gen:
        mock_gen.side_effect = AIRateLimitError("Resource has been exhausted (e.g. check quota).")
        probe_res = client.post(
            f"/api/v1/ai/credentials/{cred_id}/probe",
            json={"customPrompt": "ping"},
        )

        assert probe_res.status_code == 200
        data = probe_res.json()
        assert data["success"] is False
        assert data["healthStatus"] == "COOLDOWN"

    assert (
        ai_orchestrator.health_registry.get_credential_health(USER_A, cred_id)
        == CredentialHealth.COOLDOWN
    )


# ==============================================================================
# 4. Multi-User Isolation on Probe Endpoint
# ==============================================================================
def test_04_probe_credential_multi_user_isolation():
    """Verify User A cannot probe User B's credential (returns 404)."""
    # Create credential under USER_B
    app.dependency_overrides[get_authenticated_user_id] = lambda: USER_B
    create_res = client.post(
        "/api/v1/ai/credentials",
        json={
            "provider": "groq",
            "friendlyName": "User B Groq Key",
            "apiKey": SECRET_KEY_B,
            "costTier": "FREE_TIER",
            "enabled": True,
        },
    )
    user_b_cred_id = create_res.json()["credentialId"]

    # Now attempt probe as USER_A
    app.dependency_overrides[get_authenticated_user_id] = lambda: USER_A
    probe_res = client.post(f"/api/v1/ai/credentials/{user_b_cred_id}/probe")
    assert probe_res.status_code == 404


# ==============================================================================
# 5. Probe Nonexistent Credential
# ==============================================================================
def test_05_probe_nonexistent_credential():
    """Verify probing an unknown credential ID returns 404."""
    app.dependency_overrides[get_authenticated_user_id] = lambda: USER_A
    probe_res = client.post("/api/v1/ai/credentials/cred_doesnotexist/probe")
    assert probe_res.status_code == 404


# ==============================================================================
# 6. Live Health Diagnostics Endpoint
# ==============================================================================
def test_06_health_diagnostics_live_state():
    """Verify GET /api/v1/ai/health returns live provider adapter and credential stats."""
    app.dependency_overrides[get_authenticated_user_id] = lambda: USER_A

    # Register 1 credential for user A
    client.post(
        "/api/v1/ai/credentials",
        json={
            "provider": "gemini",
            "friendlyName": "Health Test Key",
            "apiKey": SECRET_KEY_A,
            "costTier": "FREE_TIER",
            "enabled": True,
        },
    )

    res = client.get("/api/v1/ai/health")
    assert res.status_code == 200
    data = res.json()

    assert "providers" in data
    assert len(data["providers"]) == 3
    provider_names = [p["provider"] for p in data["providers"]]
    assert "gemini" in provider_names
    assert "openrouter" in provider_names
    assert "groq" in provider_names

    for p in data["providers"]:
        assert p["operational"] is True
        assert p["registeredModelsCount"] > 0

    assert data["totalCredentialsCount"] == 1
    assert data["healthyCredentialsCount"] == 1
    assert data["activeCooldowns"] == []


# ==============================================================================
# 7. Health Diagnostics Cooldown Multi-User Isolation
# ==============================================================================
def test_07_health_diagnostics_cooldown_multi_user_isolation():
    """Verify active cooldowns for User A do not appear in User B's health diagnostics."""
    # Put model into cooldown for USER_A
    ai_orchestrator.health_registry.set_model_cooldown(
        user_id=USER_A,
        credential_id="cred_alpha",
        model_id="gemini-3.5-flash-lite",
        duration_seconds=60.0,
    )

    # Check USER_A
    app.dependency_overrides[get_authenticated_user_id] = lambda: USER_A
    res_a = client.get("/api/v1/ai/health")
    data_a = res_a.json()
    assert len(data_a["activeCooldowns"]) == 1
    assert data_a["activeCooldowns"][0]["modelId"] == "gemini-3.5-flash-lite"

    # Check USER_B
    app.dependency_overrides[get_authenticated_user_id] = lambda: USER_B
    res_b = client.get("/api/v1/ai/health")
    data_b = res_b.json()
    assert len(data_b["activeCooldowns"]) == 0


# ==============================================================================
# 8. Model Catalog Endpoint
# ==============================================================================
def test_08_models_catalog_endpoint():
    """Verify GET /api/v1/ai/models returns all supported models across registered adapters."""
    app.dependency_overrides[get_authenticated_user_id] = lambda: USER_A

    res = client.get("/api/v1/ai/models")
    assert res.status_code == 200
    models = res.json()
    assert len(models) >= 10

    providers = {m["provider"] for m in models}
    assert "gemini" in providers
    assert "openrouter" in providers
    assert "groq" in providers

    for m in models:
        assert "modelId" in m
        assert "displayName" in m
        assert "capabilities" in m
        assert "contextWindow" in m
        assert "costTier" in m
        assert m["contextWindow"] > 0


# ==============================================================================
# 9. Telemetry Initial Empty State
# ==============================================================================
def test_09_telemetry_summary_empty_state():
    """Verify GET /api/v1/ai/telemetry and alias /telemetry/summary return true empty summary without fake data."""
    app.dependency_overrides[get_authenticated_user_id] = lambda: USER_A

    res = client.get("/api/v1/ai/telemetry")
    assert res.status_code == 200
    data = res.json()
    summary = data["summary"]
    assert summary["totalRequests"] == 0
    assert summary["successfulRequests"] == 0
    assert summary["failedRequests"] == 0
    assert summary["successRate"] == 0.0
    assert summary["fallbackCount"] == 0
    assert data["recentExecutions"] == []

    # Also verify the /telemetry/summary alias endpoint
    alias_res = client.get("/api/v1/ai/telemetry/summary")
    assert alias_res.status_code == 200
    assert alias_res.json()["summary"] == summary
    assert alias_res.json()["recentExecutions"] == data["recentExecutions"]


# ==============================================================================
# 10. Telemetry Recorded on Orchestrator Execution
# ==============================================================================
@pytest.mark.asyncio
async def test_10_telemetry_recorded_on_orchestrator_execution():
    """Verify a completed AI execution records telemetry without leaking secrets or prompt text."""
    app.dependency_overrides[get_authenticated_user_id] = lambda: USER_A

    # Execute request through orchestrator
    adapter = ai_orchestrator.get_adapter(ProviderType.GEMINI)
    assert adapter is not None

    with patch.object(adapter, "generate_text", new_callable=AsyncMock) as mock_gen:
        mock_gen.return_value = "Generated resume content"
        req = ExecutionRequest(
            task=AITaskType.RESUME_TAILORING,
            user_id=USER_A,
            prompt="Draft bullet point for software engineer",
        )
        res = await ai_orchestrator.execute(request=req)
        assert res.text == "Generated resume content"

    # Verify telemetry endpoint reflects the execution
    tele_res = client.get("/api/v1/ai/telemetry")
    assert tele_res.status_code == 200
    tele_data = tele_res.json()
    summary = tele_data["summary"]
    assert summary["totalRequests"] == 1
    assert summary["successfulRequests"] == 1
    assert summary["failedRequests"] == 0
    assert summary["successRate"] == 100.0

    recent = tele_data["recentExecutions"]
    assert len(recent) == 1
    exec_record = recent[0]
    assert exec_record["task"] == "resume_tailoring"
    assert exec_record["providerUsed"] == "gemini"
    assert exec_record["success"] is True
    assert exec_record["fallbackLevel"] == 0
    assert exec_record["hopsCount"] == 1

    # Security check: prompt and completion must NOT be in telemetry
    raw_tele_str = str(tele_data)
    assert "Draft bullet point" not in raw_tele_str
    assert "Generated resume content" not in raw_tele_str


# ==============================================================================
# 11. Telemetry Records Fallback Events
# ==============================================================================
@pytest.mark.asyncio
async def test_11_telemetry_records_fallback_events():
    """Verify intra-model fallback is recorded accurately in telemetry with hops and fallbackLevel."""
    app.dependency_overrides[get_authenticated_user_id] = lambda: USER_A

    adapter = ai_orchestrator.get_adapter(ProviderType.GEMINI)
    assert adapter is not None

    # First model fails with transient error, second model succeeds
    call_count = 0

    async def mock_fail_then_succeed(*args, **kwargs):
        nonlocal call_count
        call_count += 1
        if call_count == 1:
            raise AITransientError("Temporary upstream timeout")
        return "Fallback text succeeded"

    with patch.object(adapter, "generate_text", side_effect=mock_fail_then_succeed):
        req = ExecutionRequest(
            task=AITaskType.JOB_INGESTION,
            user_id=USER_A,
            prompt="Parse job posting",
        )
        res = await ai_orchestrator.execute(request=req)
        assert res.text == "Fallback text succeeded"

    tele_res = client.get("/api/v1/ai/telemetry")
    tele_data = tele_res.json()
    assert tele_data["summary"]["fallbackCount"] == 1

    recent = tele_data["recentExecutions"]
    assert len(recent) == 1
    assert recent[0]["fallbackLevel"] == 1  # Model fallback
    assert recent[0]["hopsCount"] == 2


# ==============================================================================
# 12. Telemetry Multi-User Isolation
# ==============================================================================
def test_12_telemetry_multi_user_isolation():
    """Verify User A's execution history is completely invisible to User B."""
    # Record execution directly under USER_A
    ai_telemetry_repo.record_execution(
        user_id=USER_A,
        record={
            "executionId": "exec_alpha_001",
            "userId": USER_A,
            "task": "resume_tailoring",
            "providerUsed": "gemini",
            "modelUsed": "gemini-3.5-flash-lite",
            "credentialIdUsed": "server_gemini_credential",
            "success": True,
            "latencyMs": 150.0,
            "fallbackLevel": 0,
            "hopsCount": 1,
            "timestamp": "2026-09-29T12:00:00Z",
        },
    )

    # Check as USER_B
    app.dependency_overrides[get_authenticated_user_id] = lambda: USER_B
    res_b = client.get("/api/v1/ai/telemetry")
    assert res_b.status_code == 200
    assert res_b.json()["summary"]["totalRequests"] == 0
    assert res_b.json()["recentExecutions"] == []

    # Check as USER_A
    app.dependency_overrides[get_authenticated_user_id] = lambda: USER_A
    res_a = client.get("/api/v1/ai/telemetry")
    assert res_a.status_code == 200
    assert res_a.json()["summary"]["totalRequests"] == 1
    assert len(res_a.json()["recentExecutions"]) == 1


# ==============================================================================
# 13. Telemetry Resilience (DB Write Failure Does Not Fail AI Execution)
# ==============================================================================
@pytest.mark.asyncio
async def test_13_telemetry_failure_resilience():
    """Verify AIOrchestrator succeeds even if telemetry persistence throws an unexpected error."""
    adapter = ai_orchestrator.get_adapter(ProviderType.GEMINI)
    assert adapter is not None

    with patch.object(adapter, "generate_text", new_callable=AsyncMock) as mock_gen:
        mock_gen.return_value = "Resilient AI output"
        with patch.object(
            ai_telemetry_repo, "record_execution", side_effect=RuntimeError("Firestore down")
        ):
            req = ExecutionRequest(
                task=AITaskType.JOB_INGESTION,
                user_id=USER_A,
                prompt="Resilience test prompt",
            )
            # Must NOT raise RuntimeError
            res = await ai_orchestrator.execute(request=req)
            assert res.text == "Resilient AI output"


# ==============================================================================
# 14. Task Routing Provider Preference Prioritization
# ==============================================================================
def test_14_task_routing_provider_preference_prioritization():
    """Verify taskRouting configuration in UserAIProfile gives candidate priority bonus to preferred provider."""
    router = AIRouter()

    # Create profile with taskRouting: resume_tailoring -> groq
    profile = UserAIProfile(
        user_id=USER_A,
        cost_policy=CostPolicy.ANY_CONFIGURED,
        allow_paid_fallback=True,
        provider_priority=[ProviderType.GEMINI, ProviderType.OPENROUTER, ProviderType.GROQ],
        task_routing={"resume_tailoring": "groq"},
    )

    req = ExecutionRequest(
        task=AITaskType.RESUME_TAILORING,
        user_id=USER_A,
        prompt="Test task routing",
    )

    candidates = router.resolve_candidates(
        request=req,
        profile=profile,
        registered_adapters=ai_orchestrator._adapters,
    )

    assert len(candidates) > 0
    # First candidate must be from Groq because of the -5000 task routing bonus
    assert candidates[0].provider == ProviderType.GROQ


# ==============================================================================
# 15. Task Routing Strictly Respects Cost Policy
# ==============================================================================
def test_15_task_routing_cost_safety_maintained():
    """Verify FREE_ONLY blocks paid models even if that provider is preferred in taskRouting."""
    router = AIRouter()

    # User set FREE_ONLY and task routing prefers a provider
    profile = UserAIProfile(
        user_id=USER_A,
        cost_policy=CostPolicy.FREE_ONLY,
        allow_paid_fallback=False,
        provider_priority=[ProviderType.GEMINI, ProviderType.OPENROUTER, ProviderType.GROQ],
        task_routing={"resume_tailoring": "groq"},
    )

    req = ExecutionRequest(
        task=AITaskType.RESUME_TAILORING,
        user_id=USER_A,
        prompt="Test cost safety",
    )

    candidates = router.resolve_candidates(
        request=req,
        profile=profile,
        registered_adapters=ai_orchestrator._adapters,
    )

    # All candidate routes MUST be FREE tier
    for c in candidates:
        assert c.cost_tier == CostTier.FREE


# ==============================================================================
# 16. GeminiProvider Facade Forwards user_id & Generates Telemetry
# ==============================================================================
@pytest.mark.asyncio
async def test_16_gemini_facade_forwards_user_and_records_telemetry():
    """Verify GeminiProvider compatibility facade forwards caller user_id to AIOrchestrator."""
    provider = GeminiProvider(user_id=USER_A)
    assert provider.user_id == USER_A

    with patch.object(provider._adapter, "generate_text", new_callable=AsyncMock) as mock_gen:
        mock_gen.return_value = "Facade response"
        text = await provider.generate_text(
            prompt="Hello from facade",
            task=AITaskType.ATS_BULK_REWRITE,
        )
        assert text == "Facade response"

    # Verify telemetry is logged under USER_A
    executions = ai_telemetry_repo.list_executions(USER_A)
    assert len(executions) >= 1
    assert executions[0]["userId"] == USER_A
    assert executions[0]["task"] == "ats_bulk_rewrite"


# ==============================================================================
# 17. Credential-Level Task Routing Prioritizes Specific Credential
# ==============================================================================
def test_17_credential_level_task_routing():
    """Verify taskRouting to a specific credential ID prioritizes that exact credential first."""
    from app.ai.hub.models import ProjectScope, UserCredential
    from app.ai.hub.types import CredentialTier, ScopeType

    router = AIRouter()
    scope = ProjectScope(scope_id="proj_1", scope_type=ScopeType.UNVERIFIED_UNIQUE, verified=False)

    cred_gemini_1 = UserCredential(
        id="cred_gemini_1",
        user_id=USER_A,
        provider=ProviderType.GEMINI,
        friendly_name="Gemini Key 1",
        encrypted_api_key="enc1",
        masked_key="AIza...111",
        project_scope=scope,
        cost_tier=CredentialTier.FREE_TIER,
        is_active=True,
        health_status=CredentialHealth.HEALTHY,
        decrypted_key="dec1",
    )
    cred_gemini_2 = UserCredential(
        id="cred_gemini_2",
        user_id=USER_A,
        provider=ProviderType.GEMINI,
        friendly_name="Gemini Key 2",
        encrypted_api_key="enc2",
        masked_key="AIza...222",
        project_scope=scope,
        cost_tier=CredentialTier.FREE_TIER,
        is_active=True,
        health_status=CredentialHealth.HEALTHY,
        decrypted_key="dec2",
    )
    cred_openrouter_1 = UserCredential(
        id="cred_or_1",
        user_id=USER_A,
        provider=ProviderType.OPENROUTER,
        friendly_name="OR Key 1",
        encrypted_api_key="enc3",
        masked_key="sk-or...333",
        project_scope=scope,
        cost_tier=CredentialTier.FREE_TIER,
        is_active=True,
        health_status=CredentialHealth.HEALTHY,
        decrypted_key="dec3",
    )

    # Route specifically to cred_gemini_2
    profile = UserAIProfile(
        user_id=USER_A,
        cost_policy=CostPolicy.ANY_CONFIGURED,
        allow_paid_fallback=True,
        provider_priority=[ProviderType.GEMINI, ProviderType.OPENROUTER, ProviderType.GROQ],
        task_routing={"resume_tailoring": "cred_gemini_2"},
        credentials=[cred_gemini_1, cred_gemini_2, cred_openrouter_1],
    )

    req = ExecutionRequest(
        task=AITaskType.RESUME_TAILORING,
        user_id=USER_A,
        prompt="Test credential routing",
    )

    candidates = router.resolve_candidates(
        request=req,
        profile=profile,
        registered_adapters=ai_orchestrator._adapters,
    )

    assert len(candidates) > 0
    # First candidate MUST use the exact preferred credential
    assert candidates[0].credential_id == "cred_gemini_2"
    # Sibling Gemini credentials (cred_gemini_1) come before OpenRouter credentials
    gemini_1_idx = next(i for i, c in enumerate(candidates) if c.credential_id == "cred_gemini_1")
    or_idx = next(i for i, c in enumerate(candidates) if c.credential_id == "cred_or_1")
    assert gemini_1_idx < or_idx


# ==============================================================================
# 18. Server-Authoritative Default Credential Names
# ==============================================================================
def test_18_server_authoritative_default_credential_names():
    """Verify omitting friendlyName generates sequential provider defaults."""
    from app.schemas.ai_settings import CredentialCreateRequest
    from app.services.ai_settings_service import ai_settings_service

    # First Gemini credential
    c1 = ai_settings_service.create_credential(
        user_id="user_naming_test",
        request=CredentialCreateRequest(
            provider=ProviderType.GEMINI,
            friendlyName="",
            apiKey="AIzaSyTest111",
        ),
    )
    assert c1.friendlyName == "Gemini API Key 1"

    # Second Gemini credential
    c2 = ai_settings_service.create_credential(
        user_id="user_naming_test",
        request=CredentialCreateRequest(
            provider=ProviderType.GEMINI,
            friendlyName="   ",
            apiKey="AIzaSyTest222",
        ),
    )
    assert c2.friendlyName == "Gemini API Key 2"

    # First OpenRouter credential
    c3 = ai_settings_service.create_credential(
        user_id="user_naming_test",
        request=CredentialCreateRequest(
            provider=ProviderType.OPENROUTER,
            friendlyName="",
            apiKey="sk-or-v1-test333",
        ),
    )
    assert c3.friendlyName == "OpenRouter Key 1"

    # First Groq credential
    c4 = ai_settings_service.create_credential(
        user_id="user_naming_test",
        request=CredentialCreateRequest(
            provider=ProviderType.GROQ,
            friendlyName="",
            apiKey="gsk_test444",
        ),
    )
    assert c4.friendlyName == "Groq Key 1"


# ==============================================================================
# 19. Cross-User Credential Routing Rejected with 400
# ==============================================================================
def test_19_cross_user_credential_routing_rejected():
    """Verify user cannot route a task to another user's credential ID."""
    from fastapi import HTTPException

    from app.schemas.ai_settings import AISettingsUpdateRequest, CredentialCreateRequest
    from app.services.ai_settings_service import ai_settings_service

    # User A creates a credential
    cred_a = ai_settings_service.create_credential(
        user_id="user_owner_a",
        request=CredentialCreateRequest(
            provider=ProviderType.GEMINI,
            friendlyName="User A Key",
            apiKey="AIzaSyOwnerAKey",
        ),
    )

    # User B attempts to route to User A's credential
    with pytest.raises(HTTPException) as exc_info:
        ai_settings_service.update_settings(
            user_id="user_attacker_b",
            request=AISettingsUpdateRequest(
                taskRouting={"resume_tailoring": cred_a.credentialId},
            ),
        )
    assert exc_info.value.status_code == 400
    assert "does not exist or does not belong to user" in exc_info.value.detail


# ==============================================================================
# 20. Deleted Credential Automatically Cleaned from Task Routing
# ==============================================================================
def test_20_deleted_credential_cleaned_from_task_routing():
    """Verify deleting a credential removes its reference from task routing."""
    from app.schemas.ai_settings import AISettingsUpdateRequest, CredentialCreateRequest
    from app.services.ai_settings_service import ai_settings_service

    uid = "user_cleanup_test"
    cred = ai_settings_service.create_credential(
        user_id=uid,
        request=CredentialCreateRequest(
            provider=ProviderType.GEMINI,
            friendlyName="Will Be Deleted",
            apiKey="AIzaSyWillBeDeleted",
        ),
    )

    # Route task to this credential
    ai_settings_service.update_settings(
        user_id=uid,
        request=AISettingsUpdateRequest(
            taskRouting={"resume_tailoring": cred.credentialId},
        ),
    )
    settings_before = ai_settings_service.get_settings(uid)
    assert settings_before.taskRouting.get("resume_tailoring") == cred.credentialId

    # Delete the credential
    ai_settings_service.delete_credential(uid, cred.credentialId)

    # Task routing must have cleaned up the reference
    settings_after = ai_settings_service.get_settings(uid)
    assert "resume_tailoring" not in settings_after.taskRouting


# ==============================================================================
# 21. Route Removal / Reset to Auto Persists
# ==============================================================================
def test_21_route_removal_and_reset_to_auto_persists():
    """Verify that removing a route or setting to auto deletes the route from preferences."""
    from app.schemas.ai_settings import AISettingsUpdateRequest, CredentialCreateRequest
    from app.services.ai_settings_service import ai_settings_service

    uid = "user_reset_auto_test"
    cred = ai_settings_service.create_credential(
        user_id=uid,
        request=CredentialCreateRequest(
            provider=ProviderType.GEMINI,
            friendlyName="Resume Key",
            apiKey="AIzaSyResumeKey12345",
        ),
    )

    # 1. User configures two routes
    ai_settings_service.update_settings(
        user_id=uid,
        request=AISettingsUpdateRequest(
            taskRouting={
                "resume_generation": cred.credentialId,
                "cover_letter_generation": "openrouter",
            },
        ),
    )
    s1 = ai_settings_service.get_settings(uid)
    assert s1.taskRouting["resume_generation"] == cred.credentialId
    assert s1.taskRouting["cover_letter_generation"] == "openrouter"

    # 2. User resets cover_letter_generation to auto (omitted from request, mimicking frontend delete)
    ai_settings_service.update_settings(
        user_id=uid,
        request=AISettingsUpdateRequest(
            taskRouting={
                "resume_generation": cred.credentialId,
            },
        ),
    )
    s2 = ai_settings_service.get_settings(uid)
    assert s2.taskRouting["resume_generation"] == cred.credentialId
    assert "cover_letter_generation" not in s2.taskRouting

    # 3. User explicitly resets resume_generation with 'auto'
    ai_settings_service.update_settings(
        user_id=uid,
        request=AISettingsUpdateRequest(
            taskRouting={
                "resume_generation": "auto",
            },
        ),
    )
    s3 = ai_settings_service.get_settings(uid)
    assert "resume_generation" not in s3.taskRouting
    assert len(s3.taskRouting) == 0


# ==============================================================================
# 22. Credential Persistence and Raw Key Protection
# ==============================================================================
def test_22_credential_persistence_and_raw_key_protection():
    """Verify raw API keys are never stored in plaintext or returned in responses."""
    from app.db.repositories.ai_credential_repo import ai_credential_repo
    from app.schemas.ai_settings import CredentialCreateRequest
    from app.services.ai_settings_service import ai_settings_service

    uid = "user_sec_vault_test"
    raw_key = "AIzaSySuperSecretKeyNotForBrowsers"

    resp = ai_settings_service.create_credential(
        user_id=uid,
        request=CredentialCreateRequest(
            provider=ProviderType.GEMINI,
            friendlyName="Secure Vault Key",
            apiKey=raw_key,
        ),
    )

    # Public response never exposes raw key
    assert resp.maskedApiKey != raw_key
    assert (
        "..." in resp.maskedApiKey
        or "•" in resp.maskedApiKey
        or resp.maskedApiKey.startswith("AIza")
    )
    assert not hasattr(resp, "apiKey")

    # Stored record has encryptedApiKey, sanitized against raw key fields
    stored = ai_credential_repo.get_credential(uid, resp.credentialId)
    assert stored is not None
    assert "apiKey" not in stored
    assert "rawKey" not in stored
    assert stored["encryptedApiKey"].startswith("v1:")
    assert stored["encryptedApiKey"] != raw_key
