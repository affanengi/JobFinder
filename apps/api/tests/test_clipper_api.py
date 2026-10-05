"""Unit and integration tests for JobFinder Web Clipper API endpoints (POST /jobs/clip, GET /jobs/clip/status)."""

import uuid
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.db.repositories.job_repo import job_repo
from app.db.repositories.application_repo import application_repo
from app.schemas.application import ApplicationStage

client = TestClient(app)


@pytest.fixture
def test_user():
    return f"test_clipper_{uuid.uuid4().hex[:8]}"


def test_clip_job_success(test_user):
    headers = {"X-User-Id": test_user}
    rand_id = uuid.uuid4().hex[:8]
    payload = {
        "title": "Senior Distributed Systems Engineer",
        "company": "Databricks",
        "location": "Bengaluru, Karnataka, India",
        "workMode": "hybrid",
        "employmentType": "full_time",
        "salaryRaw": "₹35,00,000 - ₹50,00,000 / yr",
        "sourceUrl": f"https://boards.greenhouse.io/databricks/jobs/{rand_id}?gh_src=test_ref",
        "sourcePlatform": "greenhouse",
        "descriptionText": "We are looking for a Senior Distributed Systems Engineer to scale our Lakehouse platform. Experience with Python, Kubernetes, and Spark required.",
        "descriptionHtml": "<h3>Role Overview</h3><p>We are looking for a Senior Distributed Systems Engineer.</p>",
        "candidateNotes": "Strong match for my Apache Spark and cloud data background.",
        "userEditedFields": [],
    }

    res = client.post("/api/v1/jobs/clip", json=payload, headers=headers)
    assert res.status_code == 201, f"Expected 201 Created, got {res.status_code}: {res.text}"

    data = res.json()
    assert data["isDuplicate"] is False
    assert data["status"] == "created"
    assert data["jobId"].startswith("job-")
    assert data["applicationId"].startswith(f"app_{test_user}_")

    # Verify canonical job stored in repository
    job = job_repo.get_by_id(data["jobId"])
    assert job is not None
    assert job.company == "Databricks"
    assert job.canonicalHash is not None

    # Verify application created in SAVED stage
    app_record = application_repo.get_by_id(user_id=test_user, app_id=data["applicationId"])
    assert app_record is not None
    assert app_record.status == ApplicationStage.SAVED
    assert app_record.notes == "Strong match for my Apache Spark and cloud data background."


def test_clip_job_candidate_edits_precedence(test_user):
    headers = {"X-User-Id": test_user}
    rand_id = uuid.uuid4().hex[:8]
    payload = {
        "title": "Lead AI / Python Architect (Candidate Custom Title)",
        "company": "Figma Inc.",
        "location": "Hyderabad, Telangana, India",
        "workMode": "remote",
        "employmentType": "full_time",
        "salaryRaw": "80k - 20k",
        "sourceUrl": f"https://job-boards.greenhouse.io/figma/jobs/{rand_id}",
        "sourcePlatform": "greenhouse",
        "descriptionText": "Looking for a Lead AI Engineer to architect agent workflows.",
        "candidateNotes": "Tailor for AI Agent Architecture.",
        "userEditedFields": ["title", "location"],
    }

    res = client.post("/api/v1/jobs/clip", json=payload, headers=headers)
    assert res.status_code == 201
    data = res.json()

    job = job_repo.get_by_id(data["jobId"])
    assert job is not None
    assert job.title == "Lead AI / Python Architect (Candidate Custom Title)"
    assert job.location == "Hyderabad, Telangana, India"


def test_clip_job_deduplication_via_normalized_url_and_hash(test_user):
    headers = {"X-User-Id": test_user}
    rand_id = uuid.uuid4().hex[:8]
    base_url = f"https://www.linkedin.com/jobs/view/{rand_id}"
    first_payload = {
        "title": "Cloud Security Engineer",
        "company": "Stripe",
        "location": "Remote",
        "workMode": "remote",
        "employmentType": "full_time",
        "sourceUrl": f"{base_url}/?utm_source=linkedin&refId=abc12345&trk=public_jobs",
        "sourcePlatform": "linkedin",
        "descriptionText": "Build high-scale security infrastructure for payment processing.",
    }

    res1 = client.post("/api/v1/jobs/clip", json=first_payload, headers=headers)
    assert res1.status_code == 201
    data1 = res1.json()
    assert data1["isDuplicate"] is False

    # Second clip with completely different marketing query params on the exact same posting
    second_payload = {
        "title": "Cloud Security Engineer",
        "company": "Stripe",
        "location": "Remote",
        "workMode": "remote",
        "employmentType": "full_time",
        "sourceUrl": f"{base_url}?utm_campaign=winter2026&session_id=98765",
        "sourcePlatform": "linkedin",
        "descriptionText": "Build high-scale security infrastructure for payment processing.",
    }

    res2 = client.post("/api/v1/jobs/clip", json=second_payload, headers=headers)
    assert res2.status_code == 200, f"Expected 200 for duplicate, got {res2.status_code}: {res2.text}"
    data2 = res2.json()
    assert data2["isDuplicate"] is True
    assert data2["status"] == "already_exists"
    assert data2["jobId"] == data1["jobId"]
    assert data2["applicationId"] == data1["applicationId"]
    assert "Already in JobFinder" in data2["message"]


def test_check_clip_status_endpoint(test_user):
    headers = {"X-User-Id": test_user}
    rand_id = uuid.uuid4().hex[:8]
    target_url = f"https://jobs.ashbyhq.com/scaleai/{rand_id}"
    # Before clipping
    check_before = client.get(f"/api/v1/jobs/clip/status?url={target_url}", headers=headers)
    assert check_before.status_code == 200
    assert check_before.json()["isSaved"] is False

    # Clip the job
    clip_payload = {
        "title": f"Evaluation Engineer {rand_id}",
        "company": "Scale AI",
        "location": "San Francisco, CA",
        "workMode": "onsite",
        "sourceUrl": target_url,
        "sourcePlatform": "ashby",
        "descriptionText": "Evaluate foundation models across safety and reasoning metrics.",
    }
    clip_res = client.post("/api/v1/jobs/clip", json=clip_payload, headers=headers)
    assert clip_res.status_code == 201

    # After clipping
    check_after = client.get(f"/api/v1/jobs/clip/status?url={target_url}", headers=headers)
    assert check_after.status_code == 200
    res_data = check_after.json()
    assert res_data["isSaved"] is True
    assert res_data["jobId"] == clip_res.json()["jobId"]
    assert res_data["status"] == "saved"


def test_clip_job_validation_errors():
    # Missing required title
    invalid_payload = {
        "title": "",
        "company": "Meta",
        "sourceUrl": "https://careers.meta.com/jobs/1",
        "descriptionText": "Short description",
    }
    res = client.post("/api/v1/jobs/clip", json=invalid_payload, headers={"X-User-Id": "test"})
    assert res.status_code == 422
