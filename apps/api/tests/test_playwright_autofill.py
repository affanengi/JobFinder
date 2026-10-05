from httpx import AsyncClient, ASGITransport
import asyncio
"""Comprehensive unit and integration test suite for Phase 2 Deterministic Form Autofill."""

import ast
import os
import shutil
import tempfile
import pytest
from datetime import datetime, timezone
from fastapi.testclient import TestClient

from app.main import app
from app.db.repositories.application_repo import application_repo
from app.db.repositories.resume_repo import resume_repo
from app.schemas.application import (
    ApplicationRecordDTO,
    ApplicationStage,
    ResumeArtifactSnapshot,
)
from app.schemas.autofill import AutofillStatusEnum
from app.schemas.profile import AutofillProfile, EducationEntry, EducationFact, PersonalContact, PersonalLinks, Profile
from app.schemas.resume import ResumeContact, ResumeValidationResult, StructuredResumeContent, TailoredResumeDTO
from app.services.ats_form_discovery import ApplicationStateDetector, FormRootContext
from app.services.playwright_autofill_engine import (
    resolve_intended_work_location,
    SAFE_ALLOWLIST_KEYS,
    PlaywrightAutofillEngine,
    extract_safe_profile_values,
    fill_experience_questions,
    playwright_autofill_engine,
)

FIXTURES_DIR = os.path.join(os.path.dirname(__file__), "fixtures", "mock_portals")
client = TestClient(app)
TEST_USER = "test_candidate_user_001"
HEADERS = {"X-User-Id": TEST_USER}


@pytest.fixture(autouse=True)
def clean_sessions():
    """Ensure clean active session state before and after each test."""
    playwright_autofill_engine._active_sessions.clear()
    playwright_autofill_engine._temp_dirs.clear()
    playwright_autofill_engine._browser_contexts.clear()
    # Force headless in automated test environment
    playwright_autofill_engine.headless_override = True
    yield
    playwright_autofill_engine._active_sessions.clear()
    for d in list(playwright_autofill_engine._temp_dirs.values()):
        if os.path.exists(d):
            shutil.rmtree(d, ignore_errors=True)
    playwright_autofill_engine._temp_dirs.clear()


def make_test_profile(full_name="Mohammed Affan", first_name=None, last_name=None) -> Profile:
    return Profile(
        userId=TEST_USER,
        personal=PersonalContact(
            fullName=full_name,
            firstName=first_name,
            lastName=last_name,
            email="affan.dev@example.com",
            phone="+91 9876543210",
            city="Hyderabad",
            country="India",
            links=PersonalLinks(
                linkedin="https://linkedin.com/in/affan-razvi",
                github="https://github.com/affanengi",
                portfolio="https://affan.dev",
            ),
        ),
    )


def seed_ready_application(app_id="app_test_af_01", portal_url=None):
    if portal_url is None:
        portal_url = f"file://{os.path.abspath(os.path.join(FIXTURES_DIR, 'mock_greenhouse.html'))}"
    now_iso = datetime.now(timezone.utc).isoformat()
    # Ensure tailored resume exists for ReportLab compilation
    res_dto = TailoredResumeDTO(
        id=f"res_{app_id}",
        userId=TEST_USER,
        jobId="job_demo_101",
        jobTitle="AI Software Engineer",
        jobCompany="TechCorp AI",
        structuredContent=StructuredResumeContent(
            personal=ResumeContact(fullName="Mohammed Affan", email="affan@example.com", phone="+91 9876543210"),
            summary="AI Engineer with extensive experience building autonomous agents.",
        ),
        validationResult=ResumeValidationResult(
            is_valid=True,
            truth_score=100,
            verified_fact_count=5,
            violations=[],
            status="PASSED",
        ),
        latexCode="",
        createdAt=now_iso,
        updatedAt=now_iso,
    )
    resume_repo.save_tailored_resume(res_dto)

    app_dto = ApplicationRecordDTO(
        id=app_id,
        userId=TEST_USER,
        jobId="job_demo_101",
        company="TechCorp AI",
        jobTitle="AI Software Engineer",
        location="Remote",
        portalUrl=portal_url,
        status=ApplicationStage.READY,
        resumeSnapshot=ResumeArtifactSnapshot(
            resumeId=f"res_{app_id}",
            version=1,
            jobId="job_demo_101",
            targetRole="AI Software Engineer",
            skillsUsed=["Python", "FastAPI"],
            bulletCount=16,
            approvedAt=now_iso,
        ),
        createdAt=now_iso,
        updatedAt=now_iso,
    )
    application_repo.save(app_dto)
    return app_dto


# ---------------------------------------------------------------------------
# 1. Deterministic & Zero-LLM Invariant Tests
# ---------------------------------------------------------------------------

def test_ast_verification_zero_ai_imports():
    """Verify that playwright_autofill_engine.py contains ZERO imports of any AI SDKs."""
    engine_file = os.path.join(
        os.path.dirname(os.path.dirname(__file__)), "app", "services", "playwright_autofill_engine.py"
    )
    with open(engine_file, "r") as f:
        tree = ast.parse(f.read())

    imports = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for n in node.names:
                imports.append(n.name.lower())
        elif isinstance(node, ast.ImportFrom):
            if node.module:
                imports.append(node.module.lower())

    for imp in imports:
        assert "genai" not in imp, f"Forbidden AI import detected: {imp}"
        assert "gemini" not in imp, f"Forbidden AI import detected: {imp}"
        assert "openai" not in imp, f"Forbidden AI import detected: {imp}"
        assert "anthropic" not in imp, f"Forbidden AI import detected: {imp}"


def test_no_submit_method_on_engine():
    """Assert that PlaywrightAutofillEngine class exposes NO submit method."""
    public_methods = [m for m in dir(PlaywrightAutofillEngine) if not m.startswith("_")]
    for m in public_methods:
        assert "submit" not in m.lower(), f"Forbidden submit method found: {m}"


def test_detect_ats_type():
    engine = PlaywrightAutofillEngine()
    assert engine.detect_ats_type("https://boards.greenhouse.io/databricks/jobs/123") == "greenhouse"
    assert engine.detect_ats_type("https://jobs.lever.co/scale/abc") == "lever"
    assert engine.detect_ats_type("https://jobs.ashbyhq.com/linear/456") == "ashby"
    assert engine.detect_ats_type("https://careers.company.com/openings/789") == "generic"


# ---------------------------------------------------------------------------
# 2. Allowlist and Culturally Robust Name Splitting Tests
# ---------------------------------------------------------------------------

def test_safe_profile_mapping_unambiguous_two_tokens():
    profile = make_test_profile(full_name="Mohammed Affan")
    facts = extract_safe_profile_values(profile)
    assert facts["first_name"] == "Mohammed"
    assert facts["last_name"] == "Affan"
    assert facts["full_name"] == "Mohammed Affan"
    assert facts["email"] == "affan.dev@example.com"
    assert facts["phone"] == "9876543210"  # National digits without duplicate dial code
    assert facts["phone_country_code"] == "+91"
    assert facts["phone_raw"] == "+91 9876543210"
    assert facts["linkedin_url"] == "https://linkedin.com/in/affan-razvi"


def test_safe_profile_mapping_three_token_name_splits_first_and_compound_last():
    """3+ token names split first token as first_name and remaining tokens as compound last_name."""
    profile = make_test_profile(full_name="Mohammed Affan Razvi")
    facts = extract_safe_profile_values(profile)
    assert facts["full_name"] == "Mohammed Affan Razvi"
    assert facts["first_name"] == "Mohammed"
    assert facts["last_name"] == "Affan Razvi"
    assert facts["phone_national"] == "9876543210"



def test_safe_profile_mapping_explicit_first_and_last_preferred():
    """Explicit verified first/last are always preferred over splitting."""
    profile = make_test_profile(full_name="Dr. Mohammed Affan Razvi", first_name="Affan", last_name="Razvi")
    facts = extract_safe_profile_values(profile)
    assert facts["first_name"] == "Affan"
    assert facts["last_name"] == "Razvi"


def test_safe_profile_mapping_phone_strips_leading_zero():
    """Verify phone parsing strictly strips any leading zero from national number."""
    profile = make_test_profile(full_name="Mohammed Affan")
    profile.personal.phone = "+91 08978293087"
    facts = extract_safe_profile_values(profile)
    assert facts["phone_national"] == "8978293087"
    assert facts["phone"] == "8978293087"
    assert facts["phone_country_code"] == "+91"


def test_safe_profile_mapping_education_extraction():
    """Verify education entries are extracted deterministically into allowlisted keys."""
    from app.schemas.profile import EducationFact
    profile = make_test_profile(full_name="Mohammed Affan")
    profile.education = [
        EducationFact(
            id="edu_1",
            institution="Global Institute of Engineering & Technology (JNTU Hyderabad)",
            degree="Bachelor of Technology (B.Tech)",
            field="Computer Science & Engineering (Data Science)",
            verified=True,
            source="user",
        )
    ]
    facts = extract_safe_profile_values(profile)
    assert facts["education_school"] == "Global Institute of Engineering & Technology"
    assert facts["education_degree"] == "Bachelor of Technology (B.Tech)"
    assert facts["education_discipline"] == "Computer Science & Engineering (Data Science)"


# ---------------------------------------------------------------------------
# 3. Local Mock Browser Integration Tests
# ---------------------------------------------------------------------------

async def wait_for_session(session_id: str, max_seconds: float = 12.0):
    steps = int(max_seconds / 0.25)
    for _ in range(steps):
        await asyncio.sleep(0.25)
        cur = playwright_autofill_engine.get_session(session_id)
        if cur and cur.status in (AutofillStatusEnum.READY_FOR_SUBMISSION, AutofillStatusEnum.FAILED, AutofillStatusEnum.COMPLETED):
            return cur
    return playwright_autofill_engine.get_session(session_id)


@pytest.mark.asyncio
async def test_playwright_greenhouse_mock_integration():
    mock_url = f"file://{os.path.abspath(os.path.join(FIXTURES_DIR, 'mock_greenhouse.html'))}"
    app = seed_ready_application("app_gh_test", portal_url=mock_url)
    profile = make_test_profile(full_name="Mohammed Affan")

    session = await playwright_autofill_engine.start_autofill_session(
        user_id=TEST_USER,
        application=app,
        profile=profile,
        portal_url=mock_url,
    )

    try:
        current_session = await wait_for_session(session.sessionId)
        assert current_session is not None
        assert current_session.status == AutofillStatusEnum.READY_FOR_SUBMISSION
        assert "first_name" in current_session.fieldsFilled
        assert "last_name" in current_session.fieldsFilled
        assert "email" in current_session.fieldsFilled
        assert "phone" in current_session.fieldsFilled
        assert current_session.resumeAttached is True
        assert any("custom textarea" in s for s in current_session.fieldsSkipped)
    finally:
        await playwright_autofill_engine.cleanup_session(session.sessionId)


@pytest.mark.asyncio
async def test_playwright_lever_mock_integration():
    mock_url = f"file://{os.path.abspath(os.path.join(FIXTURES_DIR, 'mock_lever.html'))}"
    app = seed_ready_application("app_lever_test", portal_url=mock_url)
    profile = make_test_profile(full_name="Mohammed Affan")

    session = await playwright_autofill_engine.start_autofill_session(
        user_id=TEST_USER,
        application=app,
        profile=profile,
        portal_url=mock_url,
    )

    try:
        current_session = await wait_for_session(session.sessionId)
        assert current_session is not None
        assert current_session.status == AutofillStatusEnum.READY_FOR_SUBMISSION
        assert "full_name" in current_session.fieldsFilled
        assert "email" in current_session.fieldsFilled
        assert "phone" in current_session.fieldsFilled
        assert current_session.resumeAttached is True
        assert "linkedin_url" in current_session.fieldsFilled
    finally:
        await playwright_autofill_engine.cleanup_session(session.sessionId)


@pytest.mark.asyncio
async def test_playwright_generic_fallback_integration():
    mock_url = f"file://{os.path.abspath(os.path.join(FIXTURES_DIR, 'mock_generic.html'))}"
    app = seed_ready_application("app_gen_test", portal_url=mock_url)
    profile = make_test_profile(full_name="Mohammed Affan")

    session = await playwright_autofill_engine.start_autofill_session(
        user_id=TEST_USER,
        application=app,
        profile=profile,
        portal_url=mock_url,
    )

    try:
        current_session = await wait_for_session(session.sessionId)
        assert current_session is not None
        assert current_session.status == AutofillStatusEnum.READY_FOR_SUBMISSION
        assert "email" in current_session.fieldsFilled
        assert "phone" in current_session.fieldsFilled
        assert current_session.resumeAttached is True
    finally:
        await playwright_autofill_engine.cleanup_session(session.sessionId)


# ---------------------------------------------------------------------------
# 4. API Endpoints & State Machine Integration Tests
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_start_autofill_endpoint_blocks_without_approved_resume():
    now_iso = datetime.now(timezone.utc).isoformat()
    app_no_res = ApplicationRecordDTO(
        id="app_no_res_01",
        userId=TEST_USER,
        jobId="job_demo_102",
        company="NoResume Corp",
        jobTitle="Junior Dev",
        location="Remote",
        portalUrl=f"file://{os.path.abspath(os.path.join(FIXTURES_DIR, 'mock_greenhouse.html'))}",
        status=ApplicationStage.SAVED,
        resumeSnapshot=None,
        createdAt=now_iso,
        updatedAt=now_iso,
    )
    application_repo.save(app_no_res)

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        res = await ac.post(f"/api/v1/applications/{app_no_res.id}/autofill/start", headers=HEADERS)
        assert res.status_code == 400
        assert "ready" in res.json()["detail"].lower()


@pytest.mark.asyncio
async def test_start_autofill_duplicate_session_returns_409():
    app_record = seed_ready_application("app_dup_test")
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        res1 = await ac.post(f"/api/v1/applications/{app_record.id}/autofill/start", headers=HEADERS)
        assert res1.status_code == 200
        session_id = res1.json()["sessionId"]

        # Try duplicate launch
        res2 = await ac.post(f"/api/v1/applications/{app_record.id}/autofill/start", headers=HEADERS)
        assert res2.status_code == 409
        assert "already running" in res2.json()["detail"]

        # Clean up
        await ac.post(f"/api/v1/applications/{app_record.id}/autofill/cancel?session_id={session_id}", headers=HEADERS)


@pytest.mark.asyncio
async def test_human_confirm_submission_advances_to_applied():
    app_record = seed_ready_application("app_confirm_test")
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        res1 = await ac.post(f"/api/v1/applications/{app_record.id}/autofill/start", headers=HEADERS)
        assert res1.status_code == 200
        session_id = res1.json()["sessionId"]

        # Human confirms submission
        confirm_res = await ac.post(
            f"/api/v1/applications/{app_record.id}/autofill/confirm-submission",
            json={"sessionId": session_id, "notes": "Candidate manually clicked submit on portal"},
            headers=HEADERS,
        )
        assert confirm_res.status_code == 200
        updated = confirm_res.json()
        assert updated["status"] == "applied"
        assert updated["appliedAt"] is not None

        # Verify transition event was logged
        app_after = application_repo.get_by_id(TEST_USER, app_record.id)
        assert app_after is not None
        assert app_after.status == ApplicationStage.APPLIED
        assert any(h.eventName == "APPLICATION_SUBMITTED" for h in app_after.history)


@pytest.mark.asyncio
async def test_cross_user_isolation_blocks_unauthorized_access():
    app_record = seed_ready_application("app_iso_test")
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        res1 = await ac.post(f"/api/v1/applications/{app_record.id}/autofill/start", headers=HEADERS)
        assert res1.status_code == 200
        session_id = res1.json()["sessionId"]

        # Attacker user attempts to cancel or access
        attacker_headers = {"X-User-Id": "malicious_user_999"}
        res_cancel = await ac.post(
            f"/api/v1/applications/{app_record.id}/autofill/cancel?session_id={session_id}",
            headers=attacker_headers,
        )
        assert res_cancel.status_code in (403, 404)

        await ac.post(f"/api/v1/applications/{app_record.id}/autofill/cancel?session_id={session_id}", headers=HEADERS)


# ---------------------------------------------------------------------------
# 4. Verified Profile Authority, URL Integrity & Location Determinism Tests
# ---------------------------------------------------------------------------

def test_missing_verified_facts_remain_untouched():
    """When profile does not contain city, country, or URLs, they must NOT be emitted."""
    profile = Profile(
        userId="test_empty_facts_user",
        personal=PersonalContact(
            fullName="Mohammed Affan",
            email="affan@example.com",
            phone="+91 9876543210",
            city=None,
            country=None,
            links=PersonalLinks(linkedin=None, github=None, portfolio=None),
        ),
    )
    facts = extract_safe_profile_values(profile)
    assert "city" not in facts
    assert "country" not in facts
    assert "linkedin_url" not in facts
    assert "portfolio_url" not in facts
    assert "github_url" not in facts


def test_no_hardcoded_personal_fallbacks_in_engine():
    """The autofill engine must NEVER contain hardcoded personal fallback defaults."""
    import inspect
    from app.services import playwright_autofill_engine as engine_mod

    func_source = inspect.getsource(engine_mod.extract_safe_profile_values)
    # Ensure no 'or "Hyderabad"' or 'or "India"' fallback patterns exist
    assert 'or "Hyderabad"' not in func_source
    assert 'or "India"' not in func_source
    assert 'or "https://' not in func_source


def test_url_integrity_and_no_cross_substitution():
    """Verified URLs must remain exact and never substitute cross-field."""
    profile = make_test_profile(full_name="Mohammed Affan")
    facts = extract_safe_profile_values(profile)
    assert facts["linkedin_url"] == "https://linkedin.com/in/affan-razvi"
    assert facts["portfolio_url"] == "https://affan.dev"
    assert facts["github_url"] == "https://github.com/affanengi"
    assert facts["linkedin_url"] != facts["portfolio_url"]
    assert facts["github_url"] != facts["portfolio_url"]


def test_approved_candidate_demographic_facts():
    """Demographic and personal facts are dynamically extracted from profile.autofill and never hardcoded."""
    from app.schemas.profile import AutofillProfile

    # Case 1: Autofill profile with custom demographics
    profile_with_demographics = make_test_profile(full_name="Alex Taylor")
    profile_with_demographics.autofill = AutofillProfile(
        firstName="Alex",
        lastName="Taylor",
        fullName="Alex Taylor",
        gender="Non-binary",
        pronouns="they/them",
        streetAddress="742 Evergreen Terrace",
        state="Oregon",
        postalCode="97477",
    )
    facts = extract_safe_profile_values(profile_with_demographics)
    assert facts["preferred_first_name"] == "Alex"
    assert facts["pronouns"] == "they/them"
    assert facts["gender"] == "Non-binary"
    assert facts["street_address"] == "742 Evergreen Terrace"
    assert facts["state"] == "Oregon"
    assert facts["postal_code"] == "97477"

    # Case 2: Clean profile with no demographics set - must safely omit, NEVER fabricate
    clean_profile = make_test_profile(full_name="Sarah Connor")
    clean_profile.autofill = AutofillProfile(
        firstName="Sarah",
        lastName="Connor",
        fullName="Sarah Connor",
    )
    clean_facts = extract_safe_profile_values(clean_profile)
    assert clean_facts["preferred_first_name"] == "Sarah"
    assert "gender" not in clean_facts
    assert "pronouns" not in clean_facts
    assert "street_address" not in clean_facts
    assert "state" not in clean_facts
    assert "postal_code" not in clean_facts


def test_unsupported_sensitive_fields_remain_untouched():
    """Unsupported demographic, legal, and authorization questions are never in safe allowlist."""
    forbidden_keys = {
        "race", "ethnicity", "veteran", "disability", "religion",
        "sexual_orientation", "salary", "work_authorization", "citizenship",
        "ssn", "criminal_record", "gender_identity"
    }
    for key in forbidden_keys:
        assert key not in SAFE_ALLOWLIST_KEYS


def test_intended_work_location_priority_and_ambiguity():
    """Test deterministic intended work location classification hierarchy."""
    # 1. Structured Indian city -> Corresponding Indian city + India
    assert resolve_intended_work_location(application_location="Bengaluru, India") == "Bengaluru, India"
    assert resolve_intended_work_location(application_location="Bangalore") == "Bengaluru, India"
    assert resolve_intended_work_location(application_location="Hyderabad") == "Hyderabad, India"
    assert resolve_intended_work_location(application_location="Chennai") == "Chennai, India"
    assert resolve_intended_work_location(application_location="Mumbai") == "Mumbai, India"
    assert resolve_intended_work_location(application_location="Pune") == "Pune, India"
    assert resolve_intended_work_location(application_location="Delhi NCR") == "Delhi, India"
    assert resolve_intended_work_location(application_location="Gurgaon") == "Gurugram, India"
    assert resolve_intended_work_location(application_location="Noida") == "Noida, India"
    assert resolve_intended_work_location(application_location="Kolkata") == "Kolkata, India"

    # 2. Structured Foreign Country / International City -> Remote
    assert resolve_intended_work_location(structured_job_country="United States") == "Remote"
    assert resolve_intended_work_location(structured_job_country="United Kingdom") == "Remote"
    assert resolve_intended_work_location(application_location="San Francisco, CA") == "Remote"
    assert resolve_intended_work_location(application_location="New York, NY") == "Remote"
    assert resolve_intended_work_location(application_location="London, UK") == "Remote"

    # 3. Explicit Remote
    assert resolve_intended_work_location(structured_is_remote=True) == "Remote"
    assert resolve_intended_work_location(application_location="Remote - Worldwide") == "Remote"
    assert resolve_intended_work_location(application_location="Work from home") == "Remote"

    # 4. Conflicting or Ambiguous Metadata -> None (untouched)
    assert resolve_intended_work_location(application_location="Bengaluru / New York") is None
    assert resolve_intended_work_location(application_location="India / US") is None
    assert resolve_intended_work_location(application_location="Multiple locations") is None
    assert resolve_intended_work_location(application_location="") is None
    assert resolve_intended_work_location() is None

    # 5. Priority: Structured application location overrides foreign mention in page title
    result = resolve_intended_work_location(
        application_location="Bengaluru, India",
        portal_page_title="Figma, headquartered in San Francisco",
    )
    assert result == "Bengaluru, India"


def test_extract_safe_profile_values_education_and_experience():
    """Verify deterministic extraction of education credentials and experience levels."""
    profile = Profile(
        userId=TEST_USER,
        personal=PersonalContact(fullName="Mohammed Affan Razvi", email="affan@test.com"),
        education=[
            EducationFact(
                id="edu-1",
                institution="Global Institute of Engineering & Technology",
                degree="B.Tech",
                field="Computer Science & Engineering",
                startDate="2022",
                endDate="2026",
            )
        ],
        autofill=AutofillProfile(
            school="Global Institute of Engineering and Technology",
            degree="Bachelor's Degree",
            discipline="Computer Science",
            startYear="2022",
            endYear="2026",
            experienceLevel="4_years",
            yearsOfExperience=4.0,
        ),
    )

    facts = extract_safe_profile_values(profile)
    assert facts["education_school"] == "Global Institute of Engineering and Technology"
    assert facts["education_degree"] == "Bachelor's Degree"
    assert facts["education_discipline"] == "Computer Science"
    assert facts["education_start_year"] == "2022"
    assert facts["education_end_year"] == "2026"
    assert facts["experience_level"] == "4_years"
    assert facts["years_of_experience"] == "4.0"


@pytest.mark.asyncio
async def test_experience_threshold_evaluation_logic():
    """Test answering threshold experience question ('Do you have more than 5 years of experience?')."""
    from playwright.async_api import async_playwright

    engine = PlaywrightAutofillEngine()
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page()

        # HTML with experience question
        html_content = """
        <html>
            <body>
                <form id="app_form">
                    <label for="exp_select">Do you have more than 5 years of experience? *</label>
                    <select id="exp_select">
                        <option value="">Select..</option>
                        <option value="yes">Yes</option>
                        <option value="no">No</option>
                    </select>
                </form>
            </body>
        </html>
        """
        await page.set_content(html_content)

        # Test Candidate with 4 years of experience (4 > 5 is False -> No)
        safe_facts_4yr = {"years_of_experience": "4.0", "experience_level": "4_years"}
        filled = []
        await fill_experience_questions(page, page, safe_facts_4yr, filled)
        val = await page.locator("#exp_select").input_value()
        assert val == "no"
        assert "years_of_experience" in filled

        # Reset and test candidate with 6 years of experience (6 > 5 is True -> Yes)
        await page.locator("#exp_select").select_option(value="")
        filled = []
        safe_facts_6yr = {"years_of_experience": "6.0", "experience_level": "6_plus_years"}
        await fill_experience_questions(page, page, safe_facts_6yr, filled)
        val = await page.locator("#exp_select").input_value()
        assert val == "yes"
        assert "years_of_experience" in filled

        await browser.close()


@pytest.mark.asyncio
async def test_terminal_submit_detection_with_many_buttons():
    """Verify that submit control is correctly identified even when form has over 20 buttons."""
    from playwright.async_api import async_playwright

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page()

        # Generate HTML with 22 dummy buttons (Attach, Remove, Add Another) and a submit button at the end
        dummy_buttons = "".join(f"<button type='button'>Dummy Action {i}</button>" for i in range(22))
        html_content = f"""
        <html>
            <body>
                <form id="job_application">
                    <input id="first_name" name="first_name" value="" />
                    <input id="email" name="email" value="" />
                    {dummy_buttons}
                    <input type="submit" id="submit_app" value="Submit Application" />
                </form>
            </body>
        </html>
        """
        await page.set_content(html_content)

        form_root = FormRootContext(
            frame=page.main_frame,
            container=page.locator("#job_application"),
            is_iframe=False,
            confidence_score=100,
        )

        readiness = await ApplicationStateDetector.evaluate_form_readiness(form_root)
        assert readiness.is_ready is True
        assert readiness.is_terminal_step is True

        await browser.close()


def test_multi_education_extraction():
    """Verify that multiple education entries are deterministically extracted without hardcoded fallbacks."""
    profile = Profile(
        userId="candidate_multi_edu_001",
        personal=PersonalContact(fullName="Sarah Connor", email="sarah@example.com"),
        autofill=AutofillProfile(
            educations=[
                EducationEntry(
                    id="edu-1",
                    school="California Institute of Technology",
                    degree="Master of Science",
                    discipline="Computer Science",
                    startYear="2020",
                    endYear="2022",
                ),
                EducationEntry(
                    id="edu-2",
                    school="Pasadena City College",
                    degree="Associate Degree",
                    discipline="Mathematics",
                    startYear="2018",
                    endYear="2020",
                ),
            ]
        ),
    )

    facts = extract_safe_profile_values(profile)
    # Primary degree (index 0)
    assert facts["education_school"] == "California Institute of Technology"
    assert facts["education_degree"] == "Master of Science"
    assert facts["education_discipline"] == "Computer Science"
    assert facts["education_start_year"] == "2020"
    assert facts["education_end_year"] == "2022"

    # Secondary degree (index 1)
    assert facts["education_1_school"] == "Pasadena City College"
    assert facts["education_1_degree"] == "Associate Degree"
    assert facts["education_1_discipline"] == "Mathematics"
    assert facts["education_1_start_year"] == "2018"
    assert facts["education_1_end_year"] == "2020"


def test_new_multi_user_profile_has_no_hardcoded_defaults():
    """A newly registered multi-user candidate must receive a clean, blank profile without hardcoded facts."""
    from app.services.profile_service import profile_service

    new_user_id = f"test_multi_user_{datetime.now(timezone.utc).timestamp()}"
    profile = profile_service.get_profile(new_user_id)

    # Must NOT inherit user_default's personal details
    assert profile.personal.fullName == ""
    assert profile.personal.email == ""
    assert profile.education == []
    assert profile.experience == []
    assert profile.projects == []
    assert profile.skills == []
    assert profile.autofill.school is None
    assert profile.autofill.degree is None
    assert profile.autofill.startYear is None
    assert profile.autofill.endYear is None
    assert profile.autofill.educations == []

