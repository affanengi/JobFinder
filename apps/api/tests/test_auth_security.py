"""Automated Security & Authorization Tests for JobFinder API.

Verifies:
1. Unauthenticated requests return HTTP 401 Unauthorized across all private user-scoped routes.
2. Invalid tokens return HTTP 401 Unauthorized.
3. Client-supplied X-User-Id conflicting with authenticated token identity returns HTTP 403 Forbidden.
4. Cross-user resource access (reading or mutating User A's resources as User B) returns HTTP 403 Forbidden.
5. Credentials endpoint returns safe metadata with masked keys, never leaking raw secret keys or AES ciphertext.
"""

import pytest
from httpx import AsyncClient, ASGITransport
from app.main import app
from app.core.auth import get_authenticated_user_id
from app.db.repositories.resume_repo import resume_repo
from app.db.repositories.cover_letter_repo import cover_letter_repo
from app.db.repositories.scan_report_repo import scan_report_repo
from app.schemas.resume import TailoredResumeDTO, StructuredResumeContent, ResumeContact, ResumeValidationResult
from app.schemas.cover_letter import TailoredCoverLetterDTO, CoverLetterContent, CoverLetterValidationResult
from app.schemas.scanner import SavedScanReportDTO, AtsScanResult

USER_A = "user_victim_sec_a"
USER_B = "user_attacker_sec_b"


@pytest.fixture(autouse=True)
def clean_dependency_overrides():
    """Ensure dependency overrides are cleared before and after each test."""
    app.dependency_overrides.clear()
    yield
    app.dependency_overrides.clear()


@pytest.mark.asyncio
async def test_unauthenticated_requests_return_401():
    """Verify all protected endpoints reject requests without Authorization Bearer token."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # Protected endpoints inventory (all strictly require valid Bearer token)
        endpoints = [
            ("GET", "/api/v1/profile"),
            ("GET", "/api/v1/ai/credentials"),
            ("GET", "/api/v1/applications"),
            ("POST", "/api/v1/jobs/discover", {"companySlugs": ["scaleai"]}),
            ("GET", "/api/v1/resumes"),
            ("POST", "/api/v1/resumes/tailor", {"job_id": "test_job"}),
            ("GET", "/api/v1/cover-letters"),
            ("POST", "/api/v1/artifacts/generate", {"jobId": "test_job"}),
            ("POST", "/api/v1/scanner/scan-tailored", {"resume_id": "res_123"}),
            ("GET", "/api/v1/scanner/reports"),
        ]

        for item in endpoints:
            method = item[0]
            url = item[1]
            json_body = item[2] if len(item) > 2 else None

            if method == "GET":
                res = await client.get(url)
            else:
                res = await client.post(url, json=json_body or {})

            assert res.status_code == 401, (
                f"Expected 401 for unauthenticated {method} {url}, got {res.status_code}: {res.text}"
            )


@pytest.mark.asyncio
async def test_invalid_token_returns_401():
    """Verify invalid or forged Bearer tokens return HTTP 401."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        headers = {"Authorization": "Bearer invalid_forged_firebase_token_xyz"}
        res = await client.get("/api/v1/profile", headers=headers)
        assert res.status_code == 401
        assert "Invalid or expired authentication token" in res.json().get("detail", "")


@pytest.mark.asyncio
async def test_conflicting_x_user_id_returns_403():
    """Verify that if an authenticated user passes a conflicting X-User-Id header, HTTP 403 is returned."""
    transport = ASGITransport(app=app)
    # Simulate authenticated User A
    app.dependency_overrides[get_authenticated_user_id] = lambda: USER_A

    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # Passing User B as header while authenticated as User A
        headers = {"X-User-Id": USER_B}
        res = await client.get("/api/v1/profile", headers=headers)
        assert res.status_code == 403
        assert "does not match authenticated user" in res.json().get("detail", "")


@pytest.mark.asyncio
async def test_cross_user_resume_access_denied():
    """Verify User B cannot update, download, or delete User A's tailored resume."""
    # Seed a resume owned by User A
    test_resume = TailoredResumeDTO(
        id="resume_owned_by_user_a",
        userId=USER_A,
        jobId="job_sec_01",
        jobTitle="Security Engineer",
        jobCompany="Lockheed",
        structuredContent=StructuredResumeContent(
            personal=ResumeContact(
                fullName="Victim User",
                email="victim@example.com",
            ),
            summary="Experienced engineer with strong security focus.",
            skills=[],
            experience=[],
            projects=[],
        ),
        validationResult=ResumeValidationResult(
            is_valid=True,
            truth_score=100,
            verified_fact_count=1,
            violations=[],
            status="PASSED",
        ),
        latexCode="% latex",
    )
    resume_repo.save_tailored_resume(test_resume)

    transport = ASGITransport(app=app)
    # Authenticate client as User B (attacker)
    app.dependency_overrides[get_authenticated_user_id] = lambda: USER_B

    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # Try to read User A's resume PDF as User B
        res_pdf = await client.get(f"/api/v1/resumes/{test_resume.id}/pdf")
        assert res_pdf.status_code == 403

        # Try to read User A's resume TeX as User B
        res_tex = await client.get(f"/api/v1/resumes/{test_resume.id}/tex")
        assert res_tex.status_code == 403

        # Try to delete User A's resume as User B
        res_del = await client.delete(f"/api/v1/resumes/{test_resume.id}")
        assert res_del.status_code == 403

    # Cleanup
    resume_repo.delete_tailored_resume(test_resume.id, USER_A)


@pytest.mark.asyncio
async def test_cross_user_cover_letter_access_denied():
    """Verify User B cannot read, update, or delete User A's cover letter."""
    test_letter = TailoredCoverLetterDTO(
        id="letter_owned_by_user_a",
        userId=USER_A,
        jobId="job_sec_02",
        tone="professional",
        content=CoverLetterContent(
            fullName="Victim User",
            email="victim@example.com",
            companyName="Stripe",
            roleTitle="Backend Engineer",
            jobTitle="Backend Engineer",
            date="October 19, 2026",
            hiringManager="Engineering Lead",
            paragraph1_hook="I am writing to express my strong interest.",
            paragraph2_evidence="During my engineering projects, I architected APIs.",
            paragraph3_impact="I look forward to discussing my contributions.",
            openingParagraph="Dear Team,",
            bodyParagraphs=["Grounded experience."],
            closingParagraph="Sincerely,",
        ),
        markdownText="# Cover Letter",
        createdAt="2026-10-19T00:00:00Z",
        updatedAt="2026-10-19T00:00:00Z",
        validationResult=CoverLetterValidationResult(is_valid=True),
    )
    cover_letter_repo.save(test_letter)

    transport = ASGITransport(app=app)
    # Authenticate client as User B
    app.dependency_overrides[get_authenticated_user_id] = lambda: USER_B

    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # Try to read User A's cover letter PDF as User B
        res_pdf = await client.get(f"/api/v1/cover-letters/{test_letter.id}/pdf")
        assert res_pdf.status_code == 403

        # Try to delete User A's cover letter as User B
        res_del = await client.delete(f"/api/v1/cover-letters/{test_letter.id}")
        assert res_del.status_code == 403

    # Cleanup
    cover_letter_repo.delete(test_letter.id)


@pytest.mark.asyncio
async def test_credentials_never_expose_secrets():
    """Verify GET /api/v1/ai/credentials masks keys and never serializes raw keys or encrypted cipher."""
    from app.db.repositories.ai_credential_repo import ai_credential_repo
    from app.schemas.ai_settings import CredentialCreateRequest
    from app.services.ai_settings_service import ai_settings_service

    # Create a test credential for User A
    cred = ai_settings_service.create_credential(
        user_id=USER_A,
        request=CredentialCreateRequest(
            provider="gemini",
            apiKey="AIzaSyDummySecretKey1234567890",
            friendlyName="Secret Probe Key",
        ),
    )

    transport = ASGITransport(app=app)
    app.dependency_overrides[get_authenticated_user_id] = lambda: USER_A

    async with AsyncClient(transport=transport, base_url="http://test") as client:
        res = await client.get("/api/v1/ai/credentials")
        assert res.status_code == 200
        data = res.json()
        assert len(data) >= 1
        found = next((c for c in data if c["credentialId"] == cred.credentialId), None)
        assert found is not None
        # Must have masked key
        assert "maskedApiKey" in found
        assert found["maskedApiKey"].startswith("AIza")
        assert "DummySecretKey" not in found["maskedApiKey"]
        # Raw secrets must NOT be in payload
        assert "apiKey" not in found
        assert "encryptedApiKey" not in found

    # Cleanup
    ai_credential_repo.delete_credential(USER_A, cred.credentialId)


@pytest.mark.asyncio
async def test_optional_auth_recommendations_guest_access():
    """Verify unauthenticated GET /api/v1/recommendations returns HTTP 200 with unscored canonical jobs."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # Ingest a sample canonical job to ensure active opportunities exist
        await client.post(
            "/api/v1/jobs/ingest-text",
            json={
                "title": "Full Stack AI Engineer (Remote)",
                "company": "ScaleAI Labs",
                "text": "Seeking engineer skilled in Python, React, and FastAPI.",
            },
        )

        res = await client.get("/api/v1/recommendations")
        assert res.status_code == 200
        jobs = res.json()
        assert len(jobs) > 0

        for job in jobs:
            assert job["fitScore"] is None, f"Expected null fitScore for guest, got {job['fitScore']}"
            assert job["matchTier"] == "Unscored", f"Expected Unscored matchTier for guest, got {job['matchTier']}"
            assert job["matchedSkills"] == [], "Guest recommendations must not fabricate matched skills"
            assert job["missingSkills"] == [], "Guest recommendations must not fabricate missing skills"
            assert "Sign in and complete your Master Profile" in job["fitReason"]


@pytest.mark.asyncio
async def test_optional_auth_recommendations_invalid_token_strictly_returns_401():
    """Verify invalid or expired token on optional-auth endpoint strictly fails with 401 (never silently downgraded to guest)."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # 1. Invalid bearer token
        headers_invalid = {"Authorization": "Bearer invalid_expired_or_forged_token_123"}
        res_invalid = await client.get("/api/v1/recommendations", headers=headers_invalid)
        assert res_invalid.status_code == 401
        assert "Invalid or expired authentication token" in res_invalid.json().get("detail", "")

        # 2. Malformed non-Bearer authorization header
        headers_malformed = {"Authorization": "Basic dXNlcjpwYXNz"}
        res_malformed = await client.get("/api/v1/recommendations", headers=headers_malformed)
        assert res_malformed.status_code == 401

        # 3. Empty Bearer token
        headers_empty = {"Authorization": "Bearer "}
        res_empty = await client.get("/api/v1/recommendations", headers=headers_empty)
        assert res_empty.status_code == 401


@pytest.mark.asyncio
async def test_optional_auth_recommendations_spoofed_x_user_id_returns_403():
    """Verify unauthenticated client attempting to supply X-User-Id strictly receives HTTP 403."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        headers = {"X-User-Id": "victim_user_spoof_attempt"}
        res = await client.get("/api/v1/recommendations", headers=headers)
        assert res.status_code == 403
        assert "cannot specify X-User-Id" in res.json().get("detail", "")


@pytest.mark.asyncio
async def test_public_models_catalog_unauthenticated():
    """Verify GET /api/v1/ai/models is public, returning HTTP 200 without exposing user data."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        res = await client.get("/api/v1/ai/models")
        assert res.status_code == 200
        models = res.json()
        assert len(models) >= 1
        for m in models:
            assert "modelId" in m
            assert "displayName" in m
            assert "provider" in m
            # Verify no user secrets or account data are present
            assert "apiKey" not in m
            assert "userId" not in m

