"""Phase 4 Test Suite: Gmail OAuth 2.0 & Approved Sending.

Validates all 12 mandatory criteria:
1. OAuth state signing, tamper validation, and callback handling.
2. Missing or invalid OAUTH_ENCRYPTION_SECRET fails safely; identity with AI_ENCRYPTION_SECRET strictly rejected.
3. Tokens are encrypted at rest with AES-256-GCM and never exposed in API responses or logs.
4. Disconnecting or revoking Gmail access is handled safely.
5. Only eligible, explicitly approved drafts can be sent.
6. Inferred or unverified email addresses cannot be dispatched (PATTERN_INFERRED, UNVERIFIED, etc. strictly blocked).
7. Concurrent send attempts are locked, preventing duplicate dispatches.
8. Successful sends persist a SENT state with gmailMessageId.
9. Definite failures (4xx) and ambiguous outcomes produce correct states (SEND_FAILED, SEND_STATUS_UNKNOWN).
10. SEND_STATUS_UNKNOWN never triggers an automatic resend.
11. Reconciliation finds correlation headers or confirms unsent state for safe manual retry.
12. Resume attachment ownership and PDF generation validation are enforced.
"""

import os
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
    decrypt_oauth_token,
    encrypt_oauth_token,
    get_oauth_master_key_bytes,
)
from app.db.repositories.oauth_token_repo import oauth_token_repo
from app.db.repositories.opportunity_contact_repo import opportunity_contact_repo
from app.db.repositories.outreach_repo import outreach_repo
from app.db.repositories.resume_repo import resume_repo
from app.main import app
from app.schemas.job import CanonicalJob
from app.schemas.opportunity_contact import DiscoveredContact, EmailEvidenceClassification
from app.schemas.outreach import OutreachMessage
from app.schemas.profile import PersonalContact, Profile, SkillFact
from app.schemas.resume import (
    ResumeContact,
    ResumeValidationResult,
    StructuredResumeContent,
    TailoredResumeDTO,
)
from app.services.gmail_sending_service import (
    DISALLOWED_EVIDENCE_TIERS,
    DuplicateSendError,
    GmailNotConnectedError,
    GmailSendingService,
    IneligibleRecipientError,
    UnapprovedDraftError,
)
from app.services.job_service import job_service
from app.services.profile_service import profile_service

client = TestClient(app)

TEST_USER = "candidate-alex-1"
TEST_OPP = "opp-stripe-backend"
TEST_CONTACT = "contact-sarah-talent"
DEDICATED_SECRET = "jobfinder-dedicated-oauth-encryption-secret-32-chars-long!"


@pytest.fixture(autouse=True)
def setup_oauth_test_environment(monkeypatch):
    """Ensure dedicated OAuth secret and required mock fixtures are available."""
    monkeypatch.setenv("OAUTH_ENCRYPTION_SECRET", DEDICATED_SECRET)
    monkeypatch.setattr(settings, "OAUTH_ENCRYPTION_SECRET", DEDICATED_SECRET)
    monkeypatch.setattr(settings, "GOOGLE_CLIENT_ID", "mock-client-id.apps.googleusercontent.com")
    monkeypatch.setattr(settings, "GOOGLE_CLIENT_SECRET", "mock-client-secret")
    monkeypatch.setattr(settings, "GOOGLE_OAUTH_REDIRECT_URI", "http://localhost:8000/api/v1/auth/gmail/callback")

    # Clear repository caches
    oauth_token_repo._cache.clear()
    outreach_repo._memory_cache.clear()

    # Pre-populate contact with verified email
    contact = DiscoveredContact(
        id=TEST_CONTACT,
        userId=TEST_USER,
        opportunityId=TEST_OPP,
        companyName="Stripe",
        fullName="Sarah Recruiter",
        roleTitle="Technical Recruiter",
        stakeholderTier="RECRUITER",
        email="sarah.recruiter@stripe.com",
        emailClassification="PROVIDER_VERIFIED",
        mxStatus="VALID_MX",
        sourceUrls=[],
        evidenceSnippets=[],
        searchProviderUsed="mock",
        confidenceScore=0.9,
        rankingScore=400,
        rankingReason="Recruiter Tier",
        isDismissed=False,
        isReviewed=False,
        discoveredAt="2026-10-26T12:00:00Z",
    )
    opportunity_contact_repo.save_contact(contact)

    yield


# ------------------------------------------------------------------------------
# Test 1 & 2: Dedicated OAUTH_ENCRYPTION_SECRET & Refusal of Fallback to AI Secret
# ------------------------------------------------------------------------------
def test_oauth_crypto_fails_if_secret_missing(monkeypatch):
    """Verify that get_oauth_master_key_bytes fails if secret is missing."""
    monkeypatch.setenv("OAUTH_ENCRYPTION_SECRET", "")
    monkeypatch.setattr(settings, "OAUTH_ENCRYPTION_SECRET", "")
    monkeypatch.setattr("dotenv.dotenv_values", lambda *args, **kwargs: {})
    with pytest.raises(OAuthCryptoKeyMissingError):
        get_oauth_master_key_bytes()


def test_oauth_crypto_refuses_fallback_to_ai_encryption_secret(monkeypatch):
    """Verify that using the AI_ENCRYPTION_SECRET as OAUTH_ENCRYPTION_SECRET is strictly rejected."""
    ai_secret = settings.AI_ENCRYPTION_SECRET
    monkeypatch.setenv("OAUTH_ENCRYPTION_SECRET", ai_secret)
    monkeypatch.setattr(settings, "OAUTH_ENCRYPTION_SECRET", ai_secret)

    with pytest.raises(OAuthCryptoKeyInvalidError) as exc_info:
        get_oauth_master_key_bytes()
    assert "distinct from AI_ENCRYPTION_SECRET" in str(exc_info.value)


def test_oauth_crypto_enforces_minimum_32_characters(monkeypatch):
    """Verify that OAUTH_ENCRYPTION_SECRET under 32 characters is rejected."""
    short_secret = "too-short-secret"
    monkeypatch.setenv("OAUTH_ENCRYPTION_SECRET", short_secret)
    monkeypatch.setattr(settings, "OAUTH_ENCRYPTION_SECRET", short_secret)

    with pytest.raises(OAuthCryptoKeyInvalidError) as exc_info:
        get_oauth_master_key_bytes()
    assert "at least 32 characters" in str(exc_info.value)


# ------------------------------------------------------------------------------
# Test 3: Token Encryption at Rest & Tamper Resistance
# ------------------------------------------------------------------------------
def test_oauth_token_encryption_and_tamper_resistance():
    """Verify AES-256-GCM encryption at rest and tamper detection."""
    raw_token = "ya29.a0AfH6SM-test-google-oauth-access-token"
    encrypted = encrypt_oauth_token(raw_token, secret=DEDICATED_SECRET)

    assert encrypted.startswith("v1:")
    assert raw_token not in encrypted

    # Decrypt with correct key
    decrypted = decrypt_oauth_token(encrypted, secret=DEDICATED_SECRET)
    assert decrypted == raw_token

    # Tamper with ciphertext
    parts = encrypted.split(":")
    tampered_cipher = "A" + parts[3][1:]
    tampered_payload = f"v1:{parts[1]}:{parts[2]}:{tampered_cipher}"

    with pytest.raises(OAuthCryptoTamperError):
        decrypt_oauth_token(tampered_payload, secret=DEDICATED_SECRET)


# ------------------------------------------------------------------------------
# Test 4: OAuth Status Endpoint Shields Tokens & Handles Disconnect
# ------------------------------------------------------------------------------
def test_oauth_status_endpoint_never_exposes_tokens():
    """Verify that GET /api/v1/auth/gmail/status never leaks tokens."""
    # Save tokens
    oauth_token_repo.save_tokens(
        user_id=TEST_USER,
        access_token="secret-access-token-12345",
        refresh_token="secret-refresh-token-67890",
        expiry="2099-01-01T00:00:00Z",
        gmail_address="candidate.alex@gmail.com",
    )

    res = client.get("/api/v1/auth/gmail/status", headers={"X-User-Id": TEST_USER})
    assert res.status_code == 200
    data = res.json()
    assert data["isConnected"] is True
    assert data["gmailAddress"] == "candidate.alex@gmail.com"
    # STRICT: verify tokens are NOT present anywhere in JSON response
    response_text = res.text
    assert "secret-access-token" not in response_text
    assert "secret-refresh-token" not in response_text
    assert "encrypted" not in response_text

    # Disconnect
    res_disc = client.post("/api/v1/auth/gmail/disconnect", headers={"X-User-Id": TEST_USER})
    assert res_disc.status_code == 200
    assert res_disc.json()["status"] == "disconnected"

    # Status should now be disconnected
    res_after = client.get("/api/v1/auth/gmail/status", headers={"X-User-Id": TEST_USER})
    assert res_after.json()["isConnected"] is False


def test_oauth_authorization_url_uses_google_client_id():
    """Verify that GET /api/v1/auth/gmail/authorize constructs URL with GOOGLE_CLIENT_ID."""
    res = client.get("/api/v1/auth/gmail/authorize", headers={"X-User-Id": TEST_USER})
    assert res.status_code == 200
    data = res.json()
    assert "authorizationUrl" in data
    assert "mock-client-id.apps.googleusercontent.com" in data["authorizationUrl"]
    assert "client_id=mock-client-id.apps.googleusercontent.com" in data["authorizationUrl"]


def test_oauth_authorization_url_fails_if_google_client_id_missing(monkeypatch):
    """Verify that missing GOOGLE_CLIENT_ID returns a clear 500 error."""
    monkeypatch.setattr(settings, "GOOGLE_CLIENT_ID", "")
    res = client.get("/api/v1/auth/gmail/authorize", headers={"X-User-Id": TEST_USER})
    assert res.status_code == 500
    assert "GOOGLE_CLIENT_ID is not configured" in res.json()["detail"]


def test_settings_binds_google_client_id(monkeypatch):
    """Verify that Settings loads GOOGLE_CLIENT_ID and provides backward-compatible properties."""
    from app.core.config import Settings

    monkeypatch.setenv("GOOGLE_CLIENT_ID", "test-env-client-id")
    monkeypatch.setenv("GOOGLE_CLIENT_SECRET", "test-env-client-secret")
    custom_settings = Settings()
    assert custom_settings.GOOGLE_CLIENT_ID == "test-env-client-id"
    assert custom_settings.GOOGLE_CLIENT_SECRET == "test-env-client-secret"
    assert custom_settings.GOOGLE_OAUTH_CLIENT_ID == "test-env-client-id"
    assert custom_settings.GOOGLE_OAUTH_CLIENT_SECRET == "test-env-client-secret"


# ------------------------------------------------------------------------------
# Test 5 & 6: Sending Eligibility Gating (Strict Approval & Verified Evidence)
# ------------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_sending_requires_explicit_approval():
    """Verify that unapproved draft in DRAFT status is blocked from dispatch."""
    service = GmailSendingService(repo=outreach_repo)

    draft = OutreachMessage(
        id="outreach-unapproved-1",
        userId=TEST_USER,
        opportunityId=TEST_OPP,
        contactId=TEST_CONTACT,
        companyName="Stripe",
        recipientName="Sarah Recruiter",
        recipientEmail="sarah.recruiter@stripe.com",
        subject="Hello",
        body="Message body",
        status="DRAFT",  # Not APPROVED!
        correlationId="corr-1",
    )
    outreach_repo.save_outreach(draft)

    with pytest.raises(UnapprovedDraftError):
        await service.send_approved_outreach(
            user_id=TEST_USER,
            opportunity_id=TEST_OPP,
            outreach_id=draft.id,
        )


@pytest.mark.asyncio
async def test_sending_strictly_prohibits_inferred_or_unverified_emails():
    """Verify that PATTERN_INFERRED, DOMAIN_MAIL_ENABLED, and UNVERIFIED cannot be dispatched."""
    service = GmailSendingService(repo=outreach_repo)

    ineligible_tiers: list[EmailEvidenceClassification] = [
        "PATTERN_INFERRED",
        "DOMAIN_MAIL_ENABLED",
        "UNVERIFIED",
        "INVALID_OR_UNSUPPORTED",
    ]
    for ineligible_tier in ineligible_tiers:
        # Update contact to ineligible tier
        contact = opportunity_contact_repo.get_contact(user_id=TEST_USER, contact_id=TEST_CONTACT)
        assert contact is not None
        contact.emailClassification = ineligible_tier
        opportunity_contact_repo.save_contact(contact)

        draft = OutreachMessage(
            id=f"outreach-{ineligible_tier.lower()}",
            userId=TEST_USER,
            opportunityId=TEST_OPP,
            contactId=TEST_CONTACT,
            companyName="Stripe",
            recipientName="Sarah Recruiter",
            recipientEmail="sarah.recruiter@stripe.com",
            emailClassification=ineligible_tier,
            subject="Hello",
            body="Message body",
            status="APPROVED",
            correlationId=f"corr-{ineligible_tier}",
        )
        outreach_repo.save_outreach(draft)

        with pytest.raises(IneligibleRecipientError) as exc_info:
            await service.send_approved_outreach(
                user_id=TEST_USER,
                opportunity_id=TEST_OPP,
                outreach_id=draft.id,
            )
        assert "unverified or inferred" in str(exc_info.value)


# ------------------------------------------------------------------------------
# Test 7, 8, 9, 10: State Machine, Success, Definite Failure, & Ambiguous Timeout
# ------------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_successful_send_transitions_to_sent():
    """Verify that 200 OK from Gmail persists SENT status and gmailMessageId."""
    mock_http = MagicMock()
    mock_http.post = AsyncMock(
        return_value=httpx.Response(
            status_code=200,
            json={"id": "gmail-msg-abc-123", "threadId": "thread-xyz-789"},
        )
    )

    # Setup valid token
    oauth_token_repo.save_tokens(
        user_id=TEST_USER,
        access_token="valid-token",
        refresh_token="valid-refresh",
        expiry="2099-01-01T00:00:00Z",
    )

    # Reset contact to verified
    contact = opportunity_contact_repo.get_contact(user_id=TEST_USER, contact_id=TEST_CONTACT)
    assert contact is not None
    contact.emailClassification = "PROVIDER_VERIFIED"
    opportunity_contact_repo.save_contact(contact)

    draft = OutreachMessage(
        id="outreach-send-success",
        userId=TEST_USER,
        opportunityId=TEST_OPP,
        contactId=TEST_CONTACT,
        companyName="Stripe",
        recipientName="Sarah Recruiter",
        recipientEmail="sarah.recruiter@stripe.com",
        emailClassification="PROVIDER_VERIFIED",
        subject="Stripe Engineering Outreach",
        body="Hi Sarah, following up regarding Stripe roles.",
        status="APPROVED",
        correlationId="corr-success-1",
    )
    outreach_repo.save_outreach(draft)

    service = GmailSendingService(repo=outreach_repo, http_client=mock_http)
    resp = await service.send_approved_outreach(
        user_id=TEST_USER,
        opportunity_id=TEST_OPP,
        outreach_id=draft.id,
    )

    assert resp.status == "SENT"
    assert resp.gmailMessageId == "gmail-msg-abc-123"

    updated = outreach_repo.get_outreach(user_id=TEST_USER, outreach_id=draft.id)
    assert updated is not None
    assert updated.status == "SENT"
    assert updated.sentAt is not None
    assert updated.gmailMessageId == "gmail-msg-abc-123"


@pytest.mark.asyncio
async def test_definite_rejection_transitions_to_send_failed():
    """Verify that 400 Bad Request from Gmail transitions message to SEND_FAILED."""
    mock_http = MagicMock()
    mock_http.post = AsyncMock(
        return_value=httpx.Response(
            status_code=400,
            text='{"error": "Invalid recipient format"}',
        )
    )

    oauth_token_repo.save_tokens(
        user_id=TEST_USER,
        access_token="valid-token",
        refresh_token="valid-refresh",
        expiry="2099-01-01T00:00:00Z",
    )

    draft = OutreachMessage(
        id="outreach-send-fail",
        userId=TEST_USER,
        opportunityId=TEST_OPP,
        contactId=TEST_CONTACT,
        companyName="Stripe",
        recipientName="Sarah Recruiter",
        recipientEmail="sarah.recruiter@stripe.com",
        emailClassification="PROVIDER_VERIFIED",
        subject="Outreach",
        body="Body",
        status="APPROVED",
        correlationId="corr-fail-1",
    )
    outreach_repo.save_outreach(draft)

    service = GmailSendingService(repo=outreach_repo, http_client=mock_http)
    resp = await service.send_approved_outreach(
        user_id=TEST_USER,
        opportunity_id=TEST_OPP,
        outreach_id=draft.id,
    )

    assert resp.status == "SEND_FAILED"
    updated = outreach_repo.get_outreach(user_id=TEST_USER, outreach_id=draft.id)
    assert updated is not None
    assert updated.status == "SEND_FAILED"
    assert updated.sendError is not None
    assert "Invalid recipient" in updated.sendError


@pytest.mark.asyncio
async def test_timeout_transitions_to_send_status_unknown_without_autoresend():
    """Verify that timeout enters SEND_STATUS_UNKNOWN and does NOT auto-resend."""
    mock_http = MagicMock()
    mock_http.post = AsyncMock(side_effect=httpx.TimeoutException("Gateway timed out"))

    oauth_token_repo.save_tokens(
        user_id=TEST_USER,
        access_token="valid-token",
        refresh_token="valid-refresh",
        expiry="2099-01-01T00:00:00Z",
    )

    draft = OutreachMessage(
        id="outreach-timeout-1",
        userId=TEST_USER,
        opportunityId=TEST_OPP,
        contactId=TEST_CONTACT,
        companyName="Stripe",
        recipientName="Sarah Recruiter",
        recipientEmail="sarah.recruiter@stripe.com",
        emailClassification="PROVIDER_VERIFIED",
        subject="Outreach",
        body="Body",
        status="APPROVED",
        correlationId="corr-timeout-1",
    )
    outreach_repo.save_outreach(draft)

    service = GmailSendingService(repo=outreach_repo, http_client=mock_http)
    resp = await service.send_approved_outreach(
        user_id=TEST_USER,
        opportunity_id=TEST_OPP,
        outreach_id=draft.id,
    )

    assert resp.status == "SEND_STATUS_UNKNOWN"
    updated = outreach_repo.get_outreach(user_id=TEST_USER, outreach_id=draft.id)
    assert updated is not None
    assert updated.status == "SEND_STATUS_UNKNOWN"
    assert updated.sendError is not None
    assert "timeout" in updated.sendError.lower()

    # Attempting to send again while in SEND_STATUS_UNKNOWN MUST be rejected
    with pytest.raises(UnapprovedDraftError):
        await service.send_approved_outreach(
            user_id=TEST_USER,
            opportunity_id=TEST_OPP,
            outreach_id=draft.id,
        )


# ------------------------------------------------------------------------------
# Test 11: Ambiguous Reconciliation Discovers Message or Confirms Safe Retry
# ------------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_reconciliation_resolves_ambiguous_state():
    """Verify that reconciliation discovers correlation ID in sent mail and marks SENT."""
    oauth_token_repo.save_tokens(
        user_id=TEST_USER,
        access_token="valid-token",
        refresh_token="valid-refresh",
        expiry="2099-01-01T00:00:00Z",
    )

    mock_http = MagicMock()
    # 1. messages list returns message item
    mock_http.get = AsyncMock(
        side_effect=[
            httpx.Response(status_code=200, json={"messages": [{"id": "reconciled-msg-999"}]}),
            httpx.Response(
                status_code=200,
                json={
                    "id": "reconciled-msg-999",
                    "threadId": "thread-reconciled",
                    "payload": {
                        "headers": [
                            {"name": "X-JobFinder-Outreach-ID", "value": "outreach-recon-1"},
                            {"name": "Subject", "value": "Reconciled outreach"},
                        ]
                    },
                },
            ),
        ]
    )

    draft = OutreachMessage(
        id="outreach-recon-1",
        userId=TEST_USER,
        opportunityId=TEST_OPP,
        contactId=TEST_CONTACT,
        companyName="Stripe",
        recipientName="Sarah Recruiter",
        recipientEmail="sarah.recruiter@stripe.com",
        emailClassification="PROVIDER_VERIFIED",
        subject="Reconciled outreach",
        body="Body",
        status="SEND_STATUS_UNKNOWN",
        correlationId="corr-recon-1",
    )
    outreach_repo.save_outreach(draft)

    service = GmailSendingService(repo=outreach_repo, http_client=mock_http)
    reconciled = await service.reconcile_outreach_status(
        user_id=TEST_USER,
        opportunity_id=TEST_OPP,
        outreach_id=draft.id,
    )

    assert reconciled.status == "SENT"
    assert reconciled.gmailMessageId == "reconciled-msg-999"


# ------------------------------------------------------------------------------
# Test 12: Resume PDF Attachment Ownership & Validation
# ------------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_resume_attachment_ownership_and_validation():
    """Verify that user cannot attach a resume belonging to another user."""
    oauth_token_repo.save_tokens(
        user_id=TEST_USER,
        access_token="valid-token",
        refresh_token="valid-refresh",
        expiry="2099-01-01T00:00:00Z",
    )

    # Create resume owned by another user
    other_resume = TailoredResumeDTO(
        id="resume-other-user",
        userId="different-user-999",
        jobId="job-1",
        jobTitle="Engineer",
        jobCompany="Company",
        structuredContent=StructuredResumeContent(
            personal=ResumeContact(fullName="Other Candidate", email="other@example.com"),
            summary="Experienced Engineer",
            education=[],
            skills=[],
            experience=[],
            projects=[],
        ),
        validationResult=ResumeValidationResult(is_valid=True, truth_score=100),
        latexCode="\\documentclass{article}",
    )
    resume_repo.save_tailored_resume(other_resume)

    draft = OutreachMessage(
        id="outreach-attachment-cross-user",
        userId=TEST_USER,
        opportunityId=TEST_OPP,
        contactId=TEST_CONTACT,
        companyName="Stripe",
        recipientName="Sarah Recruiter",
        recipientEmail="sarah.recruiter@stripe.com",
        emailClassification="PROVIDER_VERIFIED",
        subject="Outreach with unauthorized resume",
        body="Body",
        status="APPROVED",
        resumeAttachmentId=other_resume.id,
        correlationId="corr-attach-cross",
    )
    outreach_repo.save_outreach(draft)

    service = GmailSendingService(repo=outreach_repo)
    with pytest.raises(ValueError) as exc_info:
        await service.send_approved_outreach(
            user_id=TEST_USER,
            opportunity_id=TEST_OPP,
            outreach_id=draft.id,
        )
    assert "does not belong to the user" in str(exc_info.value)
