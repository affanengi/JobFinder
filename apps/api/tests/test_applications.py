"""Comprehensive Test Suite for Application Tracker & Pipeline Management."""

import pytest
from fastapi.testclient import TestClient
from uuid import uuid4

from app.main import app
from app.db.repositories.application_repo import application_repo
from app.db.repositories.resume_repo import resume_repo
from app.db.repositories.user_job_repo import user_job_repo
from app.schemas.application import (
    ApplicationRecordDTO,
    ApplicationStage,
    EventSource,
    OfferOutcome,
)
from app.schemas.resume import (
    ResumeBullet,
    ResumeContact,
    ResumeEducationItem,
    ResumeExperienceItem,
    ResumeProjectItem,
    ResumeSkillCategory,
    ResumeValidationResult,
    StructuredResumeContent,
    TailoredResumeDTO,
)

client = TestClient(app)

TEST_UID_1 = "test_user_alpha"
TEST_UID_2 = "test_user_beta"


@pytest.fixture(autouse=True)
def clean_state():
    """Clear memory caches between tests."""
    application_repo._memory_cache.clear()
    resume_repo._memory_cache.clear()
    user_job_repo._memory_cache.clear() if hasattr(user_job_repo, "_memory_cache") else None


def _create_mock_resume(user_id: str, job_id: str) -> TailoredResumeDTO:
    """Helper to create a valid mock tailored resume."""
    resume_id = f"res_{uuid4().hex[:8]}"
    dto = TailoredResumeDTO(
        id=resume_id,
        userId=user_id,
        jobId=job_id,
        jobTitle="AI Workflow Intern",
        jobCompany="ScaleAI Innovations",
        structuredContent=StructuredResumeContent(
            personal=ResumeContact(fullName="Test Candidate", email="test@example.com", city="Remote"),
            summary="Experienced engineer with Python and React.",
            skills=[
                ResumeSkillCategory(category="Technical", items=["Python", "FastAPI", "React"])
            ],
            experience=[
                ResumeExperienceItem(
                    company="Tech Club",
                    title="Lead",
                    startDate="2024",
                    endDate="2026",
                    bullets=[ResumeBullet(text="Organized 10+ technical workshops.")],
                )
            ],
            projects=[],
            education=[ResumeEducationItem(institution="University", degree="B.Tech", endDate="2026")],
        ),
        latexCode="\\documentclass{article}",
        validationResult=ResumeValidationResult(is_valid=True, truth_score=95, verified_fact_count=10),
    )
    return resume_repo.save_tailored_resume(dto)


def test_create_application_success():
    """Test standard application creation."""
    payload = {
        "company": "ScaleAI Innovations",
        "jobTitle": "AI Operations Intern",
        "location": "Remote",
        "portalUrl": "https://scaleai.com/jobs/123",
        "initialStatus": "saved",
        "notes": "Spoke with recruiter on LinkedIn.",
    }
    resp = client.post("/api/v1/applications", json=payload, headers={"X-User-Id": TEST_UID_1})
    assert resp.status_code == 201
    data = resp.json()
    assert data["company"] == "ScaleAI Innovations"
    assert data["status"] == "saved"
    assert data["userId"] == TEST_UID_1
    assert len(data["history"]) == 1
    assert data["history"][0]["eventName"] == "APPLICATION_CREATED"
    assert data["history"][0]["authorizedActor"] == "candidate"


def test_prevent_duplicate_application_for_same_job():
    """Test that creating an application for the same job is idempotent."""
    job_id = "job-dup-01"
    payload = {
        "jobId": job_id,
        "company": "Acme Corp",
        "jobTitle": "Backend Engineer",
    }
    resp1 = client.post("/api/v1/applications", json=payload, headers={"X-User-Id": TEST_UID_1})
    assert resp1.status_code == 201
    app_id_1 = resp1.json()["id"]

    resp2 = client.post("/api/v1/applications", json=payload, headers={"X-User-Id": TEST_UID_1})
    assert resp2.status_code == 201
    assert resp2.json()["id"] == app_id_1


def test_legal_status_transitions():
    """Test linear progression: saved -> ready -> applied -> interviewing -> offer."""
    job_id = f"job-linear-{uuid4().hex[:8]}"
    resume = _create_mock_resume(TEST_UID_1, job_id)

    # 1. Create saved
    app_resp = client.post(
        "/api/v1/applications",
        json={"jobId": job_id, "company": "Linear Labs", "jobTitle": "AI Dev"},
        headers={"X-User-Id": TEST_UID_1},
    )
    app_id = app_resp.json()["id"]

    # 2. Approve package -> ready
    appr_resp = client.post(
        "/api/v1/applications/approve-package",
        json={"jobId": job_id, "tailoredResumeId": resume.id},
        headers={"X-User-Id": TEST_UID_1},
    )
    assert appr_resp.status_code == 200
    assert appr_resp.json()["status"] == "ready"

    # 3. Move to applied
    app_res = client.patch(
        f"/api/v1/applications/{app_id}/status",
        json={"newStatus": "applied", "note": "Applied directly via portal"},
        headers={"X-User-Id": TEST_UID_1},
    )
    assert app_res.status_code == 200
    assert app_res.json()["status"] == "applied"
    assert app_res.json()["appliedAt"] is not None

    # 4. Move to interviewing
    int_res = client.patch(
        f"/api/v1/applications/{app_id}/status",
        json={"newStatus": "interviewing", "eventSource": "employer", "note": "Recruiter screen scheduled"},
        headers={"X-User-Id": TEST_UID_1},
    )
    assert int_res.status_code == 200
    assert int_res.json()["status"] == "interviewing"

    # 5. Move to offer
    off_res = client.patch(
        f"/api/v1/applications/{app_id}/status",
        json={"newStatus": "offer", "eventSource": "employer", "note": "Formal offer extended"},
        headers={"X-User-Id": TEST_UID_1},
    )
    assert off_res.status_code == 200
    assert off_res.json()["status"] == "offer"


def test_illegal_status_transitions_rejected():
    """Verify state machine blocks invalid skips and reversals."""
    app_resp = client.post(
        "/api/v1/applications",
        json={"company": "Strict Rules Inc", "jobTitle": "Software Intern"},
        headers={"X-User-Id": TEST_UID_1},
    )
    app_id = app_resp.json()["id"]

    # Cannot jump from saved to offer
    bad1 = client.patch(
        f"/api/v1/applications/{app_id}/status",
        json={"newStatus": "offer"},
        headers={"X-User-Id": TEST_UID_1},
    )
    assert bad1.status_code == 400
    assert "Illegal state transition" in bad1.json()["detail"]

    # Cannot jump from saved to applied without approval or submission data
    bad2 = client.patch(
        f"/api/v1/applications/{app_id}/status",
        json={"newStatus": "applied"},
        headers={"X-User-Id": TEST_UID_1},
    )
    assert bad2.status_code == 400


def test_actor_and_event_source_logging():
    """Verify authorizedActor is candidate and eventSource correctly records catalyst."""
    job_id = f"job-actor-{uuid4().hex[:8]}"
    resume = _create_mock_resume(TEST_UID_1, job_id)

    app = client.post(
        "/api/v1/applications/approve-package",
        json={"jobId": job_id, "tailoredResumeId": resume.id},
        headers={"X-User-Id": TEST_UID_1},
    ).json()

    # Move to applied
    client.patch(
        f"/api/v1/applications/{app['id']}/status",
        json={"newStatus": "applied", "eventSource": "candidate"},
        headers={"X-User-Id": TEST_UID_1},
    )

    # Employer advances candidate to interviewing
    updated = client.patch(
        f"/api/v1/applications/{app['id']}/status",
        json={"newStatus": "interviewing", "eventSource": "employer", "note": "Recruiter phone call"},
        headers={"X-User-Id": TEST_UID_1},
    ).json()

    last_event = updated["history"][-1]
    assert last_event["eventName"] == "INTERVIEW_SCHEDULED"
    assert last_event["authorizedActor"] == "candidate"
    assert last_event["eventSource"] == "employer"


def test_status_conflict_expected_status():
    """Verify 409 Conflict if expectedStatus does not match current status."""
    app = client.post(
        "/api/v1/applications",
        json={"company": "Race Condition Co", "jobTitle": "Dev"},
        headers={"X-User-Id": TEST_UID_1},
    ).json()

    conflict_resp = client.patch(
        f"/api/v1/applications/{app['id']}/status",
        json={"newStatus": "archived", "expectedStatus": "interviewing"},
        headers={"X-User-Id": TEST_UID_1},
    )
    assert conflict_resp.status_code == 409
    assert "Status conflict" in conflict_resp.json()["detail"]


def test_user_isolation():
    """Verify User A cannot read or mutate User B's applications."""
    app_a = client.post(
        "/api/v1/applications",
        json={"company": "User A Company", "jobTitle": "Dev A"},
        headers={"X-User-Id": TEST_UID_1},
    ).json()

    # User B attempts to read User A's app
    read_resp = client.get(f"/api/v1/applications/{app_a['id']}", headers={"X-User-Id": TEST_UID_2})
    assert read_resp.status_code == 404

    # User B attempts to mutate User A's app
    mutate_resp = client.patch(
        f"/api/v1/applications/{app_a['id']}/status",
        json={"newStatus": "archived"},
        headers={"X-User-Id": TEST_UID_2},
    )
    assert mutate_resp.status_code == 404


def test_sync_saved_jobs_idempotent_and_no_downgrade():
    """Verify sync creates saved applications without downgrading advanced states."""
    job_id_1 = f"job-sync-1-{uuid4().hex[:8]}"
    job_id_2 = f"job-sync-2-{uuid4().hex[:8]}"

    # Set user saved statuses in user_job_repo
    user_job_repo.set_job_status(user_id=TEST_UID_1, job_id=job_id_1, status="saved")
    user_job_repo.set_job_status(user_id=TEST_UID_1, job_id=job_id_2, status="saved")

    # Run initial sync
    sync_resp1 = client.post("/api/v1/applications/sync-from-saved", headers={"X-User-Id": TEST_UID_1})
    assert sync_resp1.status_code == 200
    apps = sync_resp1.json()
    assert len(apps) >= 2

    # Manually promote job 1 to applied (via legal path: attach resume -> ready -> applied)
    app1 = next(a for a in apps if a["jobId"] == job_id_1)
    resume = _create_mock_resume(TEST_UID_1, job_id_1)
    client.post(
        "/api/v1/applications/approve-package",
        json={"jobId": job_id_1, "tailoredResumeId": resume.id},
        headers={"X-User-Id": TEST_UID_1},
    )
    client.patch(
        f"/api/v1/applications/{app1['id']}/status",
        json={"newStatus": "applied"},
        headers={"X-User-Id": TEST_UID_1},
    )

    # Re-run sync: verify job 1 stays applied (NOT downgraded to saved)
    sync_resp2 = client.post("/api/v1/applications/sync-from-saved", headers={"X-User-Id": TEST_UID_1})
    assert sync_resp2.status_code == 200
    apps_after = sync_resp2.json()
    app1_after = next(a for a in apps_after if a["jobId"] == job_id_1)
    assert app1_after["status"] == "applied"


def test_resume_snapshot_immutability():
    """Verify subsequent changes to resume do not mutate historical application snapshot."""
    job_id = f"job-snap-{uuid4().hex[:8]}"
    resume = _create_mock_resume(TEST_UID_1, job_id)

    app = client.post(
        "/api/v1/applications/approve-package",
        json={"jobId": job_id, "tailoredResumeId": resume.id},
        headers={"X-User-Id": TEST_UID_1},
    ).json()

    approved_snapshot = app["resumeSnapshot"]
    assert approved_snapshot is not None
    assert approved_snapshot["targetRole"] == "AI Workflow Intern"
    orig_approved_at = approved_snapshot["approvedAt"]

    # Mutate resume in repo (simulate subsequent regeneration)
    resume.jobTitle = "Senior Architect"
    resume_repo.save_tailored_resume(resume)

    # Fetch application again: historical snapshot must remain unchanged
    app_refetched = client.get(f"/api/v1/applications/{app['id']}", headers={"X-User-Id": TEST_UID_1}).json()
    assert app_refetched["resumeSnapshot"]["targetRole"] == "AI Workflow Intern"
    assert app_refetched["resumeSnapshot"]["approvedAt"] == orig_approved_at


def test_soft_archive_preserves_data():
    """Verify DELETE performs soft archive without deleting notes or artifacts."""
    app = client.post(
        "/api/v1/applications",
        json={"company": "Archive Test", "jobTitle": "QA", "notes": "Important candidate notes"},
        headers={"X-User-Id": TEST_UID_1},
    ).json()

    del_resp = client.delete(f"/api/v1/applications/{app['id']}", headers={"X-User-Id": TEST_UID_1})
    assert del_resp.status_code == 200
    archived = del_resp.json()
    assert archived["status"] == "archived"
    assert archived["notes"] == "Important candidate notes"
    assert len(archived["history"]) == 2
    assert archived["history"][-1]["eventName"] == "APPLICATION_ARCHIVED"


def test_offer_outcome_logging():
    """Verify offerOutcome can be recorded when concluding an offer."""
    job_id = f"job-offer-{uuid4().hex[:8]}"
    resume = _create_mock_resume(TEST_UID_1, job_id)
    app = client.post(
        "/api/v1/applications/approve-package",
        json={"jobId": job_id, "tailoredResumeId": resume.id},
        headers={"X-User-Id": TEST_UID_1},
    ).json()

    client.patch(f"/api/v1/applications/{app['id']}/status", json={"newStatus": "applied"}, headers={"X-User-Id": TEST_UID_1})
    client.patch(f"/api/v1/applications/{app['id']}/status", json={"newStatus": "interviewing"}, headers={"X-User-Id": TEST_UID_1})
    client.patch(f"/api/v1/applications/{app['id']}/status", json={"newStatus": "offer"}, headers={"X-User-Id": TEST_UID_1})

    # Archive offer as accepted
    archived_offer = client.patch(
        f"/api/v1/applications/{app['id']}/status",
        json={"newStatus": "archived", "offerOutcome": "accepted", "note": "Accepted formal offer!"},
        headers={"X-User-Id": TEST_UID_1},
    ).json()

    assert archived_offer["status"] == "archived"
    assert archived_offer["offerOutcome"] == "accepted"


def test_notes_and_interview_rounds_persistence():
    """Verify candidate scratchpad and structured interview rounds save cleanly."""
    app = client.post(
        "/api/v1/applications",
        json={"company": "Interview Test", "jobTitle": "Full Stack Dev"},
        headers={"X-User-Id": TEST_UID_1},
    ).json()

    # Update notes
    notes_resp = client.patch(
        f"/api/v1/applications/{app['id']}/notes",
        json={"notes": "Recruiter: Sarah. Salary Range: $90k-$110k."},
        headers={"X-User-Id": TEST_UID_1},
    )
    assert notes_resp.status_code == 200
    assert notes_resp.json()["notes"] == "Recruiter: Sarah. Salary Range: $90k-$110k."

    # Add structured interview round
    round_payload = {
        "round": "Technical Assessment",
        "scheduledAt": "2026-09-15T14:00:00Z",
        "interviewer": "John Doe",
        "meetingLink": "https://meet.google.com/abc-def-ghi",
        "notes": "Focus on FastAPI microservices and algorithms.",
    }
    round_resp = client.post(
        f"/api/v1/applications/{app['id']}/interview",
        json=round_payload,
        headers={"X-User-Id": TEST_UID_1},
    )
    assert round_resp.status_code == 200
    app_with_round = round_resp.json()
    assert len(app_with_round["interviewEvents"]) == 1
    assert app_with_round["interviewEvents"][0]["round"] == "Technical Assessment"
    assert app_with_round["interviewEvents"][0]["interviewer"] == "John Doe"


def test_cover_letter_optional_for_ready():
    """Verify application qualifies for ready without a cover letter."""
    job_id = f"job-nocl-{uuid4().hex[:8]}"
    resume = _create_mock_resume(TEST_UID_1, job_id)
    app = client.post(
        "/api/v1/applications/approve-package",
        json={"jobId": job_id, "tailoredResumeId": resume.id, "coverLetterId": None},
        headers={"X-User-Id": TEST_UID_1},
    ).json()

    assert app["status"] == "ready"
    assert app["resumeSnapshot"] is not None
    assert app["coverLetterSnapshot"] is None


def test_demote_ready_to_saved():
    """Verify candidate can demote a ready application back to saved to revise."""
    job_id = f"job-demote-{uuid4().hex[:8]}"
    resume = _create_mock_resume(TEST_UID_1, job_id)
    app = client.post(
        "/api/v1/applications/approve-package",
        json={"jobId": job_id, "tailoredResumeId": resume.id},
        headers={"X-User-Id": TEST_UID_1},
    ).json()
    assert app["status"] == "ready"

    demoted = client.patch(
        f"/api/v1/applications/{app['id']}/status",
        json={"newStatus": "saved", "note": "Unapproved to revise bullets"},
        headers={"X-User-Id": TEST_UID_1},
    ).json()

    assert demoted["status"] == "saved"
    assert demoted["history"][-1]["eventName"] == "DEMOTED_TO_SAVED"


def test_reactivate_archived_to_saved():
    """Verify candidate can restore an archived application back to active saved pipeline."""
    app = client.post(
        "/api/v1/applications",
        json={"company": "Restore Co", "jobTitle": "Dev"},
        headers={"X-User-Id": TEST_UID_1},
    ).json()

    # Archive
    client.delete(f"/api/v1/applications/{app['id']}", headers={"X-User-Id": TEST_UID_1})

    # Restore
    restored = client.patch(
        f"/api/v1/applications/{app['id']}/status",
        json={"newStatus": "saved", "note": "Reactivated opportunity"},
        headers={"X-User-Id": TEST_UID_1},
    ).json()

    assert restored["status"] == "saved"
    assert restored["history"][-1]["eventName"] == "APPLICATION_RESTORED"


def test_external_application_with_applied_status():
    """Verify creating an external application directly with applied status sets appliedAt."""
    payload = {
        "company": "External Portal Corp",
        "jobTitle": "Lead Engineer",
        "isExternal": True,
        "initialStatus": "applied",
        "appliedDate": "2026-09-01T10:00:00Z",
        "portalUrl": "https://careers.external.com/jobs/999",
        "notes": "Submitted via employee referral.",
    }
    resp = client.post("/api/v1/applications", json=payload, headers={"X-User-Id": TEST_UID_1})
    assert resp.status_code == 201
    data = resp.json()
    assert data["status"] == "applied"
    assert data["isExternal"] is True
    assert data["appliedAt"] == "2026-09-01T10:00:00Z"
    assert data["history"][0]["eventName"] == "APPLICATION_CREATED"


def test_transition_to_ready_blocked_without_approved_resume_snapshot():
    """Verify transitioning to ready is strictly rejected if no approved resume snapshot exists."""
    payload = {
        "company": "Security Corp",
        "jobTitle": "Full Stack Gate Test",
        "isExternal": True,
        "initialStatus": "saved",
    }
    create_resp = client.post("/api/v1/applications", json=payload, headers={"X-User-Id": TEST_UID_1})
    assert create_resp.status_code == 201
    app_id = create_resp.json()["id"]

    # Attempt to transition to ready without snapshot
    patch_resp = client.patch(
        f"/api/v1/applications/{app_id}/status",
        json={"newStatus": "ready"},
        headers={"X-User-Id": TEST_UID_1},
    )
    assert patch_resp.status_code == 400
    assert "Cannot move to 'Ready to Apply' without an approved tailored resume" in patch_resp.json()["detail"]


def test_reverse_transition_from_interviewing_to_applied():
    """Verify candidate can reverse an application from interviewing back to applied (e.g. on mistake)."""
    payload = {
        "company": "Reverse Test Corp",
        "jobTitle": "Automation Lead",
        "isExternal": True,
        "initialStatus": "applied",
    }
    app = client.post("/api/v1/applications", json=payload, headers={"X-User-Id": TEST_UID_1}).json()
    assert app["status"] == "applied"

    # Move applied -> interviewing
    interviewing_app = client.patch(
        f"/api/v1/applications/{app['id']}/status",
        json={"newStatus": "interviewing", "note": "Moved to interviewing"},
        headers={"X-User-Id": TEST_UID_1},
    ).json()
    assert interviewing_app["status"] == "interviewing"

    # Reverse interviewing -> applied
    reversed_app = client.patch(
        f"/api/v1/applications/{app['id']}/status",
        json={"newStatus": "applied", "note": "Reversed back to applied"},
        headers={"X-User-Id": TEST_UID_1},
    ).json()
    assert reversed_app["status"] == "applied"
    assert reversed_app["history"][-1]["eventName"] == "RETURNED_TO_APPLIED"
