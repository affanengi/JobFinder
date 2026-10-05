"""Comprehensive unit and integration test suite for ATS Form Discovery, Multi-Frame Support & State Detection."""

import os
import shutil
import asyncio
import pytest
from datetime import datetime, timezone
from playwright.async_api import async_playwright

from app.db.repositories.application_repo import application_repo
from app.db.repositories.resume_repo import resume_repo
from app.schemas.application import ApplicationRecordDTO, ApplicationStage, ResumeArtifactSnapshot
from app.schemas.autofill import AutofillStatusEnum, DetectedFormFieldDTO, BatchFillAnswerDTO
from app.schemas.profile import PersonalContact, PersonalLinks, Profile
from app.schemas.resume import ResumeContact, ResumeValidationResult, StructuredResumeContent, TailoredResumeDTO
from app.services.ats_form_discovery import (
    DiscoveryConfig,
    FormRootDetector,
    ApplyCtaDetector,
    ApplicationStateDetector,
    FORBIDDEN_SUBMIT_PATTERN,
    NON_TERMINAL_PROGRESSION_PATTERN,
)
from app.services.playwright_autofill_engine import (
    PlaywrightAutofillEngine,
    playwright_autofill_engine,
)

FIXTURES_DIR = os.path.join(os.path.dirname(__file__), "fixtures", "mock_portals")
TEST_USER = "test_discovery_user_001"


@pytest.fixture(autouse=True)
def clean_sessions():
    """Ensure clean active session state before and after each test."""
    playwright_autofill_engine._active_sessions.clear()
    playwright_autofill_engine._temp_dirs.clear()
    playwright_autofill_engine._browser_contexts.clear()
    playwright_autofill_engine._session_form_contexts.clear()
    playwright_autofill_engine._session_custom_fields.clear()
    playwright_autofill_engine.headless_override = True
    yield
    playwright_autofill_engine._active_sessions.clear()
    for d in list(playwright_autofill_engine._temp_dirs.values()):
        if os.path.exists(d):
            shutil.rmtree(d, ignore_errors=True)
    playwright_autofill_engine._temp_dirs.clear()
    playwright_autofill_engine._session_form_contexts.clear()
    playwright_autofill_engine._session_custom_fields.clear()


def make_test_profile() -> Profile:
    return Profile(
        userId=TEST_USER,
        personal=PersonalContact(
            fullName="Mohammed Affan",
            firstName="Mohammed",
            lastName="Affan",
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


def seed_ready_application(app_id="app_discovery_01", portal_url=None) -> ApplicationRecordDTO:
    if portal_url is None:
        portal_url = f"file://{os.path.abspath(os.path.join(FIXTURES_DIR, 'mock_split_iframe.html'))}"
    now_iso = datetime.now(timezone.utc).isoformat()

    res_dto = TailoredResumeDTO(
        id=f"res_{app_id}",
        userId=TEST_USER,
        jobId="job_split_01",
        jobTitle="Staff Software Engineer",
        jobCompany="Databricks",
        structuredContent=StructuredResumeContent(
            personal=ResumeContact(fullName="Mohammed Affan", email="affan@example.com", phone="+91 9876543210"),
            summary="Staff Engineer with distributed systems expertise.",
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
        jobId="job_split_01",
        company="Databricks",
        jobTitle="Staff Software Engineer",
        location="San Francisco, CA",
        portalUrl=portal_url,
        status=ApplicationStage.READY,
        resumeSnapshot=ResumeArtifactSnapshot(
            resumeId=f"res_{app_id}",
            version=1,
            jobId="job_split_01",
            targetRole="Staff Software Engineer",
            skillsUsed=["Distributed Systems", "Python"],
            bulletCount=12,
            approvedAt=now_iso,
        ),
        createdAt=now_iso,
        updatedAt=now_iso,
    )
    application_repo.save(app_dto)
    return app_dto


# ==============================================================================
# 1. UNIT TESTS: PATTERNS & HEURISTICS
# ==============================================================================

def test_forbidden_submit_pattern():
    """Verify that submit button variations match the forbidden submission pattern."""
    assert FORBIDDEN_SUBMIT_PATTERN.search("Submit Application")
    assert FORBIDDEN_SUBMIT_PATTERN.search("submit")
    assert FORBIDDEN_SUBMIT_PATTERN.search("Complete Application")
    assert FORBIDDEN_SUBMIT_PATTERN.search("Confirm and Submit")
    assert FORBIDDEN_SUBMIT_PATTERN.search("Send Application")
    # Progression controls must NOT match submit
    assert not FORBIDDEN_SUBMIT_PATTERN.search("Next")
    assert not FORBIDDEN_SUBMIT_PATTERN.search("Save and Continue")
    assert not FORBIDDEN_SUBMIT_PATTERN.search("Continue")


def test_progression_control_pattern():
    """Verify non-terminal progression controls (Next, Continue, Save and Continue, Review)."""
    assert NON_TERMINAL_PROGRESSION_PATTERN.search("Next")
    assert NON_TERMINAL_PROGRESSION_PATTERN.search("Continue")
    assert NON_TERMINAL_PROGRESSION_PATTERN.search("Proceed")
    assert NON_TERMINAL_PROGRESSION_PATTERN.search("Save and Continue")
    assert NON_TERMINAL_PROGRESSION_PATTERN.search("Save & Continue")
    assert NON_TERMINAL_PROGRESSION_PATTERN.search("Review")
    assert NON_TERMINAL_PROGRESSION_PATTERN.search("Continue to Review")
    assert NON_TERMINAL_PROGRESSION_PATTERN.search("Next Step")
    # Submit must NOT match progression
    assert not NON_TERMINAL_PROGRESSION_PATTERN.search("Submit Application")


# ==============================================================================
# 2. INTEGRATION TESTS: MULTI-FRAME DISCOVERY (DATABRICKS SPLIT LAYOUT)
# ==============================================================================

@pytest.mark.asyncio
async def test_frame_discovery_databricks_split_layout():
    """Test that FormRootDetector inspects child iframes and correctly selects the embedded Greenhouse form."""
    split_url = f"file://{os.path.abspath(os.path.join(FIXTURES_DIR, 'mock_split_iframe.html'))}"

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page()
        await page.goto(split_url, wait_until="domcontentloaded")
        await page.wait_for_timeout(500)

        # Confirm child iframe exists on page
        assert len(page.frames) > 1

        form_root, telemetry = await FormRootDetector.discover(page)
        assert form_root is not None
        assert form_root.is_iframe is True
        assert form_root.confidence_score >= DiscoveryConfig.CONFIDENCE_THRESHOLD_MIN
        assert "core_contact_matches_" in str(form_root.matched_signals)
        assert telemetry["accessibleFrames"] >= 2
        assert telemetry["selectedIsIframe"] is True

        await browser.close()


@pytest.mark.asyncio
async def test_end_to_end_split_iframe_autofill_success():
    """Proves the Databricks root cause fix: autofill scopes to iframe container and populates fields successfully."""
    split_url = f"file://{os.path.abspath(os.path.join(FIXTURES_DIR, 'mock_split_iframe.html'))}"
    app = seed_ready_application(app_id="app_split_e2e_01", portal_url=split_url)
    profile = make_test_profile()

    session = await playwright_autofill_engine.start_autofill_session(
        user_id=TEST_USER,
        application=app,
        profile=profile,
        portal_url=split_url,
    )

    # Subscribe to events and wait for terminal or review state
    final_status = None
    filled_fields = []
    custom_qs = []
    resume_attached = False

    async for ev in playwright_autofill_engine.subscribe_events(session.sessionId):
        final_status = ev.status
        if ev.fieldsFilled:
            filled_fields = ev.fieldsFilled
        if ev.detectedCustomQuestions:
            custom_qs = ev.detectedCustomQuestions
        if ev.resumeAttached:
            resume_attached = True
        if ev.status in (
            AutofillStatusEnum.READY_FOR_SUBMISSION,
            AutofillStatusEnum.MULTI_STEP_FORM,
            AutofillStatusEnum.FORM_NOT_FOUND,
            AutofillStatusEnum.FAILED,
        ):
            break

    # ZERO-FIELD HARD INVARIANT: Must NOT report 0 fields filled
    assert len(filled_fields) > 0, "Hard invariant failed: 0 fields populated on split layout"
    assert "First Name" in filled_fields or "First Name *" in filled_fields or "first_name" in filled_fields or any("Name" in f for f in filled_fields)
    assert resume_attached is True
    assert final_status in (AutofillStatusEnum.READY_FOR_SUBMISSION, AutofillStatusEnum.MULTI_STEP_FORM)

    await playwright_autofill_engine.cleanup_session(session.sessionId)


# ==============================================================================
# 3. APPLY-BEFORE-FORM FLOW & DISCOVERY
# ==============================================================================

@pytest.mark.asyncio
async def test_apply_cta_detector_on_job_description_page():
    """Verify ApplyCtaDetector identifies high-intent Apply button and excludes unwanted controls."""
    apply_url = f"file://{os.path.abspath(os.path.join(FIXTURES_DIR, 'mock_apply_flow.html'))}"

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page()
        await page.goto(apply_url, wait_until="domcontentloaded")

        cta, candidates, telemetry = await ApplyCtaDetector.detect(page)
        assert cta is not None
        assert "Apply" in cta.text
        # Ensure Share button was excluded
        assert not any("share" in c.text.lower() for c in candidates)

        await browser.close()


@pytest.mark.asyncio
async def test_end_to_end_apply_flow_reveals_and_populates_form():
    """Verify full lifecycle: starts on JD page, clicks Apply CTA, waits boundedly for form, and populates it."""
    apply_url = f"file://{os.path.abspath(os.path.join(FIXTURES_DIR, 'mock_apply_flow.html'))}"
    app = seed_ready_application(app_id="app_apply_flow_01", portal_url=apply_url)
    profile = make_test_profile()

    session = await playwright_autofill_engine.start_autofill_session(
        user_id=TEST_USER,
        application=app,
        profile=profile,
        portal_url=apply_url,
    )

    statuses_seen = []
    filled_fields = []

    async for ev in playwright_autofill_engine.subscribe_events(session.sessionId):
        statuses_seen.append(ev.status)
        if ev.fieldsFilled:
            filled_fields = ev.fieldsFilled
        if ev.status in (
            AutofillStatusEnum.READY_FOR_SUBMISSION,
            AutofillStatusEnum.MULTI_STEP_FORM,
            AutofillStatusEnum.FORM_NOT_FOUND,
            AutofillStatusEnum.FAILED,
        ):
            break

    # Must have seen Apply CTA discovery and form loading
    assert AutofillStatusEnum.APPLY_CTA_AVAILABLE in statuses_seen or AutofillStatusEnum.DETECTING_APPLICATION_STATE in statuses_seen
    assert len(filled_fields) > 0

    await playwright_autofill_engine.cleanup_session(session.sessionId)


# ==============================================================================
# 4. MULTI-STEP & TERMINAL SAFETY CLARIFICATION
# ==============================================================================

@pytest.mark.asyncio
async def test_multistep_detection_and_non_terminal_safety():
    """Verify that multi-step forms with progression controls (Save and Continue) transition to MULTI_STEP_FORM."""
    multistep_url = f"file://{os.path.abspath(os.path.join(FIXTURES_DIR, 'mock_multistep.html'))}"
    app = seed_ready_application(app_id="app_multistep_01", portal_url=multistep_url)
    profile = make_test_profile()

    session = await playwright_autofill_engine.start_autofill_session(
        user_id=TEST_USER,
        application=app,
        profile=profile,
        portal_url=multistep_url,
    )

    final_status = None
    filled_fields = []

    async for ev in playwright_autofill_engine.subscribe_events(session.sessionId):
        final_status = ev.status
        if ev.fieldsFilled:
            filled_fields = ev.fieldsFilled
        if ev.status in (
            AutofillStatusEnum.READY_FOR_SUBMISSION,
            AutofillStatusEnum.MULTI_STEP_FORM,
            AutofillStatusEnum.FORM_NOT_FOUND,
            AutofillStatusEnum.FAILED,
        ):
            break

    # SAFETY CHECK: Must be MULTI_STEP_FORM, NOT READY_FOR_SUBMISSION
    assert final_status == AutofillStatusEnum.MULTI_STEP_FORM
    assert len(filled_fields) > 0

    await playwright_autofill_engine.cleanup_session(session.sessionId)


@pytest.mark.asyncio
async def test_terminal_safety_clarification_no_submit_no_next():
    """Verify safety clarification: A form without a Next button is NOT marked terminal if no submit button exists either."""
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page()
        # Page with inputs but NO submit button and NO next button (only a "Draft" button)
        await page.set_content("""
        <html><body>
          <form id="draft_form">
            <input type="text" name="first_name" id="first_name">
            <input type="text" name="last_name" id="last_name">
            <input type="email" name="email" id="email">
            <button type="button">Save Draft</button>
          </form>
        </body></html>
        """)

        form_root, _ = await FormRootDetector.discover(page)
        assert form_root is not None
        readiness = await ApplicationStateDetector.evaluate_form_readiness(form_root)
        # Invariant: Neither submit nor next -> is_terminal_step must be False
        assert readiness.is_terminal_step is False

        await browser.close()


# ==============================================================================
# 5. SANDBOXED / RESTRICTED FRAME HANDLING
# ==============================================================================

@pytest.mark.asyncio
async def test_sandboxed_iframe_graceful_handling():
    """Verify that sandboxed or inaccessible iframes are safely bypassed without crashing discovery."""
    sandbox_url = f"file://{os.path.abspath(os.path.join(FIXTURES_DIR, 'mock_sandboxed_iframe.html'))}"

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page()
        await page.goto(sandbox_url, wait_until="domcontentloaded")

        form_root, telemetry = await FormRootDetector.discover(page)
        # Should cleanly discover the accessible form on the main page
        assert form_root is not None
        assert form_root.is_iframe is False
        assert form_root.confidence_score >= DiscoveryConfig.CONFIDENCE_THRESHOLD_MIN

        await browser.close()


# ==============================================================================
# 6. ZERO-FIELD INVARIANT ENFORCEMENT
# ==============================================================================

@pytest.mark.asyncio
async def test_zero_field_guard_triggers_form_not_found():
    """If a page has 0 fields matched and 0 custom questions, status must become FORM_NOT_FOUND."""
    zero_url = f"file://{os.path.abspath(os.path.join(FIXTURES_DIR, 'mock_zero_field.html'))}"
    app = seed_ready_application(app_id="app_zero_field_01", portal_url=zero_url)
    profile = make_test_profile()

    session = await playwright_autofill_engine.start_autofill_session(
        user_id=TEST_USER,
        application=app,
        profile=profile,
        portal_url=zero_url,
    )

    final_status = None
    async for ev in playwright_autofill_engine.subscribe_events(session.sessionId):
        final_status = ev.status
        if ev.status in (
            AutofillStatusEnum.READY_FOR_SUBMISSION,
            AutofillStatusEnum.MULTI_STEP_FORM,
            AutofillStatusEnum.FORM_NOT_FOUND,
            AutofillStatusEnum.FAILED,
        ):
            break

    # Zero fields populated must NEVER report READY_FOR_SUBMISSION
    assert final_status == AutofillStatusEnum.FORM_NOT_FOUND

    await playwright_autofill_engine.cleanup_session(session.sessionId)


# ==============================================================================
# 7. CUSTOM QUESTIONS IN CHILD IFRAME
# ==============================================================================

@pytest.mark.asyncio
async def test_custom_questions_detected_and_filled_in_iframe():
    """Verify custom question textareas inside child iframe receive frameSelector and fill properly."""
    split_url = f"file://{os.path.abspath(os.path.join(FIXTURES_DIR, 'mock_split_iframe.html'))}"

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context()
        page = await context.new_page()
        await page.goto(split_url, wait_until="domcontentloaded")
        await page.wait_for_timeout(500)

        form_root, _ = await FormRootDetector.discover(page)
        assert form_root is not None
        assert form_root.is_iframe is True

        custom_qs = await playwright_autofill_engine._detect_custom_questions(
            target=form_root.container,
            frame_selector=form_root.frame_selector,
        )

        assert len(custom_qs) >= 1
        essay_q = next((q for q in custom_qs if "why databricks" in q.label.lower()), None)
        assert essay_q is not None
        assert essay_q.frameSelector is not None
        assert "iframe" in essay_q.frameSelector

        # Test filling custom answer
        session_id = "test_custom_iframe_session"
        playwright_autofill_engine._browser_contexts[session_id] = {
            "page": page,
            "browser": browser,
            "context": context,
        }
        playwright_autofill_engine._session_form_contexts[session_id] = form_root
        playwright_autofill_engine._session_custom_fields[session_id] = {essay_q.questionId: essay_q}

        resp = await playwright_autofill_engine.fill_custom_answers(
            session_id=session_id,
            answers=[
                BatchFillAnswerDTO(
                    questionId=essay_q.questionId,
                    answerText="I am excited to build high-scale distributed systems.",
                )
            ],
        )

        assert resp.filledCount == 1
        assert len(resp.failedQuestions) == 0

        # Verify textarea actually contains the filled text
        child_frame = form_root.frame
        val = await child_frame.locator(essay_q.selector).input_value()
        assert "excited to build high-scale" in val

        await browser.close()
