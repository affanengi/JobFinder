"""Tests for Bulk AI Bullet Rewrites and Saved ATS Scan Reports."""

import pytest
from httpx import ASGITransport, AsyncClient
from app.main import app
from app.schemas.scanner import BulkBulletInput, BulkAiBulletRewriteRequest, AtsScanResult, SaveScanReportRequest


@pytest.mark.asyncio
async def test_bulk_ai_bullet_rewrite_endpoint():
    """Test 1-shot bulk AI bullet rewriting (Set A / Set B format)."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        req_payload = {
            "bullets": [
                {
                    "id": "exp_0_0",
                    "section": "Experience",
                    "role_or_project": "Software Engineer at Tech Corp",
                    "original_text": "Worked on backend APIs using FastAPI and PostgreSQL."
                },
                {
                    "id": "proj_0_0",
                    "section": "Projects",
                    "role_or_project": "Cloud Autoscaler",
                    "original_text": "Helped with Kubernetes cluster autoscaling scripts."
                }
            ],
            "job_title": "Senior Backend Engineer",
            "job_description": "Proficiency in Python, FastAPI, and Kubernetes."
        }

        response = await client.post(
            "/api/v1/scanner/bulk-ai-bullet-rewrite",
            json=req_payload,
            headers={"X-User-Id": "user_default"}
        )

        assert response.status_code == 200
        data = response.json()
        assert data["total_processed"] == 2
        assert len(data["set_a"]) == 2
        assert len(data["set_b"]) == 2

        # Verify Set A has 1-to-1 matching IDs
        assert data["set_a"][0]["bullet_id"] == "exp_0_0"
        assert data["set_a"][1]["bullet_id"] == "proj_0_0"
        assert data["set_a"][0]["has_action_verb"] is True

        # Verify Set B has 1-to-1 matching IDs
        assert data["set_b"][0]["bullet_id"] == "exp_0_0"
        assert data["set_b"][1]["bullet_id"] == "proj_0_0"
        assert data["set_b"][0]["has_action_verb"] is True


@pytest.mark.asyncio
async def test_saved_scan_reports_lifecycle():
    """Test saving, listing, retrieving, and deleting ATS scan reports."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # 1. Create a dummy scan result payload
        dummy_scan_result = {
            "overall_score": 85,
            "grade": "A",
            "summary": "Strong ATS Candidate.",
            "category_scores": {
                "parseability": {
                    "name": "ATS Parseability",
                    "score": 25.0,
                    "max_score": 25.0,
                    "percentage": 100.0,
                    "status": "pass",
                    "summary": "Clean format.",
                    "checks": []
                },
                "keyword_match": {
                    "name": "Keywords",
                    "score": 24.0,
                    "max_score": 30.0,
                    "percentage": 80.0,
                    "status": "pass",
                    "summary": "Matched skills.",
                    "checks": []
                },
                "impact_verbs": {
                    "name": "Impact",
                    "score": 18.0,
                    "max_score": 25.0,
                    "percentage": 72.0,
                    "status": "warning",
                    "summary": "Good verbs.",
                    "checks": []
                },
                "structural_integrity": {
                    "name": "Structure",
                    "score": 18.0,
                    "max_score": 20.0,
                    "percentage": 90.0,
                    "status": "pass",
                    "summary": "Dense summary.",
                    "checks": []
                }
            },
            "keyword_matrix": {
                "matched": [],
                "missing": [],
                "transferable": [],
                "match_percentage": 100.0,
                "total_jd_keywords": 4,
                "matched_count": 4,
                "missing_count": 0,
                "transferable_count": 5
            },
            "bullet_audits": [
                {
                    "id": "exp_0_0",
                    "section": "Experience",
                    "role_or_project": "Engineer",
                    "text": "Architected distributed microservices in FastAPI.",
                    "score": 100,
                    "status": "strong",
                    "has_action_verb": True,
                    "has_metric": False,
                    "has_weak_opener": False,
                    "verb": "architected",
                    "word_count": 6,
                    "issues": []
                }
            ],
            "actionable_checklist": [],
            "metadata": {
                "source_type": "file_upload",
                "file_name": "candidate_resume.pdf",
                "word_count": 350,
                "taxonomy_version": "1.0.0"
            }
        }

        # 2. Save report
        save_resp = await client.post(
            "/api/v1/scanner/reports",
            json={"reportName": "Test Customer Support Scan", "scanResult": dummy_scan_result},
            headers={"X-User-Id": "user_test_reports"}
        )
        assert save_resp.status_code == 200
        saved_data = save_resp.json()
        report_id = saved_data["id"]
        assert saved_data["overallScore"] == 85
        assert saved_data["grade"] == "A"
        assert saved_data["reportName"] == "Test Customer Support Scan"

        # 3. List reports
        list_resp = await client.get(
            "/api/v1/scanner/reports",
            headers={"X-User-Id": "user_test_reports"}
        )
        assert list_resp.status_code == 200
        reports_list = list_resp.json()
        assert any(r["id"] == report_id for r in reports_list)

        # 4. Get report by ID
        get_resp = await client.get(
            f"/api/v1/scanner/reports/{report_id}",
            headers={"X-User-Id": "user_test_reports"}
        )
        assert get_resp.status_code == 200
        assert get_resp.json()["id"] == report_id

        # 5. Delete report
        del_resp = await client.delete(
            f"/api/v1/scanner/reports/{report_id}",
            headers={"X-User-Id": "user_test_reports"}
        )
        assert del_resp.status_code == 200
        assert del_resp.json()["status"] == "deleted"

        # 6. Verify 404 after delete
        get_deleted_resp = await client.get(
            f"/api/v1/scanner/reports/{report_id}",
            headers={"X-User-Id": "user_test_reports"}
        )
        assert get_deleted_resp.status_code == 404

@pytest.mark.asyncio
async def test_bulk_ai_bullet_rewrite_20_bullets():
    """Test bulk AI bullet rewriting with 20 selected bullets (verifying max_length >= 20)."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        req_payload = {
            "bullets": [
                {
                    "id": f"bullet_{i}",
                    "section": "Experience" if i < 4 else "Projects",
                    "role_or_project": f"Role/Project {i}",
                    "original_text": f"Handled engineering task {i} with Python and PostgreSQL."
                }
                for i in range(20)
            ],
            "job_title": "Senior Full-Stack Engineer",
            "job_description": "FastAPI, React, PostgreSQL, Cloud."
        }

        response = await client.post(
            "/api/v1/scanner/bulk-ai-bullet-rewrite",
            json=req_payload,
            headers={"X-User-Id": "user_default"}
        )

        assert response.status_code == 200
        data = response.json()
        assert data["total_processed"] == 20
        assert len(data["set_a"]) == 20
        assert len(data["set_b"]) == 20
