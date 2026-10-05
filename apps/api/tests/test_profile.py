"""Tests for User Profile Management, Fact Verification, Multi-Tenant Isolation, and Autofill Profile."""

import pytest
from httpx import AsyncClient

from app.core.auth import get_authenticated_user_id
from app.main import app
from app.schemas.profile import (
    ApproveCandidateFactsRequest,
    AutofillProfile,
    EducationFact,
    PersonalContact,
    Profile,
    ProjectFact,
    SkillFact,
)
from app.services.profile_service import ProfileService


def test_profile_truth_verification_lifecycle():
    """Verify that candidate facts start unverified and only become verified upon explicit user approval."""
    service = ProfileService()

    # 1. Start with initial profile
    initial_profile = service.get_profile("test_user")
    initial_version = initial_profile.profileVersion

    # 2. Simulate newly extracted candidate profile (all verified=False)
    candidate_profile = Profile(
        userId="test_user",
        personal=PersonalContact(fullName="Affan Razvi", email="affan@test.com"),
        skills=[
            SkillFact(id="sk-1", name="Kubernetes", category="cloud", verified=False),
            SkillFact(id="sk-2", name="GraphQL", category="tools", verified=False),
        ],
        projects=[
            ProjectFact(
                id="proj-1",
                name="AI Job Agent",
                description="Built automated career agent.",
                bullets=["Automated resume generation."],
                technologies=["Python", "FastAPI"],
                verified=False,
            )
        ],
        education=[
            EducationFact(
                id="edu-1",
                institution="Osmania University",
                degree="B.Tech",
                verified=False,
            )
        ],
    )

    # 3. User explicitly approves ONLY sk-2 (GraphQL) and proj-1 (AI Job Agent), rejecting sk-1 (Kubernetes)
    approval_request = ApproveCandidateFactsRequest(
        approvedSkillIds=["sk-2"],
        approvedProjectIds=["proj-1"],
        approvedEducationIds=["edu-1"],
    )

    updated_profile = service.approve_and_merge_extracted_facts(
        candidate_profile=candidate_profile,
        request=approval_request,
        user_id="test_user",
    )

    # 4. Assertions:
    # - Profile version incremented
    assert updated_profile.profileVersion == initial_version + 1

    # - Approved skill is present and marked verified: True
    playwright_skill = next((s for s in updated_profile.skills if s.id == "sk-2"), None)
    assert playwright_skill is not None
    assert playwright_skill.verified is True

    # - Unapproved skill was NOT merged
    docker_skill = next((s for s in updated_profile.skills if s.id == "sk-1"), None)
    assert docker_skill is None

    # - Approved project is present and marked verified: True
    approved_proj = next((p for p in updated_profile.projects if p.id == "proj-1"), None)
    assert approved_proj is not None
    assert approved_proj.verified is True


@pytest.mark.asyncio
async def test_profile_api_endpoints(async_client: AsyncClient):
    """Verify GET and PUT endpoints for user profile with authenticated user."""
    test_uid = "user_test_profile_123"
    app.dependency_overrides[get_authenticated_user_id] = lambda: test_uid

    try:
        get_res = await async_client.get("/api/v1/profile")
        assert get_res.status_code == 200
        data = get_res.json()
        assert "personal" in data
        assert "skills" in data
        assert data["userId"] == test_uid
    finally:
        app.dependency_overrides.pop(get_authenticated_user_id, None)


@pytest.mark.asyncio
async def test_autofill_profile_endpoints_and_isolation(async_client: AsyncClient):
    """Verify dedicated GET and PUT for AutofillProfile and ensure it does not touch Master Profile facts."""
    test_uid = "user_autofill_isolated_456"
    app.dependency_overrides[get_authenticated_user_id] = lambda: test_uid

    try:
        # 1. Fetch initial autofill profile
        get_res = await async_client.get("/api/v1/profile/autofill")
        assert get_res.status_code == 200
        initial_autofill = get_res.json()
        assert isinstance(initial_autofill, dict)

        # 2. Update autofill profile with custom ATS form values
        payload = {
            "firstName": "Morgan",
            "lastName": "Freeman",
            "fullName": "Morgan Freeman",
            "email": "morgan@hollywood.com",
            "phone": "+1 555-987-6543",
            "streetAddress": "100 Sunset Blvd",
            "city": "Los Angeles",
            "state": "California",
            "postalCode": "90001",
            "country": "United States",
            "gender": "Male",
            "pronouns": "he/him/his",
            "linkedinUrl": "https://linkedin.com/in/morgan-freeman",
            "githubUrl": "https://github.com/morganfreeman",
            "portfolioUrl": "https://morganfreeman.com",
        }

        put_res = await async_client.put(
            "/api/v1/profile/autofill",
            json=payload,
        )
        assert put_res.status_code == 200
        saved_autofill = put_res.json()
        assert saved_autofill["firstName"] == "Morgan"
        assert saved_autofill["streetAddress"] == "100 Sunset Blvd"
        assert saved_autofill["gender"] == "Male"
        assert saved_autofill["pronouns"] == "he/him/his"

        # 3. Retrieve Master Profile to verify semantic isolation
        # Changing autofill MUST NOT modify master profile facts
        master_res = await async_client.get("/api/v1/profile")
        assert master_res.status_code == 200
        master_data = master_res.json()
        assert master_data["autofill"]["firstName"] == "Morgan"
        assert master_data["autofill"]["streetAddress"] == "100 Sunset Blvd"

    finally:
        app.dependency_overrides.pop(get_authenticated_user_id, None)


@pytest.mark.asyncio
async def test_multi_tenant_isolation_and_spoofed_header_rejection(async_client: AsyncClient):
    """Verify that User A cannot access User B's profile and spoofed X-User-Id is rejected."""
    user_a = "user_alpha_authorized"
    user_b = "user_bravo_target"

    app.dependency_overrides[get_authenticated_user_id] = lambda: user_a

    try:
        # 1. User A successfully requests their own profile
        res_a = await async_client.get("/api/v1/profile")
        assert res_a.status_code == 200
        assert res_a.json()["userId"] == user_a

        # 2. Attacker attempts to spoof X-User-Id to impersonate User B
        spoof_res = await async_client.get(
            "/api/v1/profile",
            headers={"X-User-Id": user_b},
        )
        assert spoof_res.status_code == 403
        assert "does not match authenticated user" in spoof_res.json()["detail"]

        # 3. Attacker attempts to spoof X-User-Id on PUT autofill endpoint
        spoof_put = await async_client.put(
            "/api/v1/profile/autofill",
            headers={"X-User-Id": user_b},
            json={"firstName": "Hacker"},
        )
        assert spoof_put.status_code == 403

    finally:
        app.dependency_overrides.pop(get_authenticated_user_id, None)


def test_master_and_autofill_profile_bidirectional_independence():
    """Verify that modifying an AutofillProfile does not alter the Verified Master Profile and vice versa."""
    service = ProfileService()
    uid = "test_independence_user"

    prof = service.get_profile(uid)
    prof.personal.fullName = "Original Verified Candidate"
    service.update_profile(prof)

    # 1. Update Autofill Profile
    new_autofill = AutofillProfile(
        fullName="Custom Autofill Name",
        firstName="Custom",
        lastName="Autofill",
        city="Autofill City",
    )
    service.update_autofill_profile(uid, new_autofill)

    # Check that Master Profile personal fact was NOT overwritten
    refetched = service.get_profile(uid)
    assert refetched.personal.fullName == "Original Verified Candidate"
    assert refetched.autofill.fullName == "Custom Autofill Name"

    # 2. Update Master Profile personal fact
    refetched.personal.city = "Verified Metropolis"
    service.update_profile(refetched)

    # Check that Autofill Profile city was NOT silently overwritten
    refetched2 = service.get_profile(uid)
    assert refetched2.personal.city == "Verified Metropolis"
    assert refetched2.autofill.city == "Autofill City"
