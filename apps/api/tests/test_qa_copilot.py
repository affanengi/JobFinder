"""Comprehensive unit and integration test suite for ATS Custom Question Co-Pilot."""

import pytest
from unittest.mock import AsyncMock, MagicMock
from app.schemas.profile import (
    Profile,
    PersonalContact,
    PersonalLinks,
    ProjectFact,
    ExperienceFact,
    SkillFact,
    Preferences,
)
from app.schemas.application import (
    ApplicationRecordDTO,
    BatchGenerateRequest,
    QuestionCategory,
    QuestionConstraintsDTO,
    QuestionInputDTO,
)
from app.services.qa_copilot_service import QACopilotService, BatchAnswersOutput, SingleGeneratedAnswer
from app.services.qa_claim_validator import qa_claim_validator


@pytest.fixture
def sample_profile():
    return Profile(
        userId="user_test_qa",
        personal=PersonalContact(
            fullName="Mohammed Affan Razvi",
            email="affan@example.com",
            phone="+91 9876543210",
            links=PersonalLinks(github="https://github.com/affan"),
        ),
        preferences=Preferences(
            minSalary=25000,
            maxSalary=35000,
            salaryCurrency="INR",
            salaryPeriod="month",
            noticePeriod="Immediate",
        ),
        projects=[
            ProjectFact(
                id="proj_webpilot",
                name="WebPilot (AI Agent)",
                description="Built AI browser automation system using Redis and Playwright.",
                bullets=[
                    "Engineered streaming pipeline processing 1500 concurrent events.",
                    "Reduced latency by 25% across test runs.",
                ],
                technologies=["Python", "FastAPI", "Redis", "Playwright", "Docker"],
            )
        ],
        experience=[
            ExperienceFact(
                id="exp_give",
                company="Give Grants",
                title="Software Intern",
                startDate="2024",
                endDate="2025",
                bullets=["Automated grant verification across 500 partner organizations."],
            )
        ],
        skills=[
            SkillFact(id="sk_py", name="Python"),
            SkillFact(id="sk_fastapi", name="FastAPI"),
            SkillFact(id="sk_docker", name="Docker"),
            SkillFact(id="sk_playwright", name="Playwright"),
        ],
    )


def test_question_classification():
    service = QACopilotService(ai_provider=MagicMock())
    assert service.classify_question("What is your expected salary?") == QuestionCategory.COMPENSATION
    assert service.classify_question("What is your earliest start date or notice period?") == QuestionCategory.AVAILABILITY
    assert service.classify_question("Why do you want to join our company?") == QuestionCategory.WHY_COMPANY
    assert service.classify_question("Why are you a fit for this position?") == QuestionCategory.WHY_ROLE
    assert service.classify_question("Describe a difficult architectural challenge you solved.") == QuestionCategory.TECHNICAL_CHALLENGE
    assert service.classify_question("Tell us about your leadership or teamwork experience.") == QuestionCategory.LEADERSHIP_TEAMWORK
    assert service.classify_question("What experience do you have with Docker?") == QuestionCategory.TECHNICAL_EXPERIENCE
    assert service.classify_question("What is your greatest strength?") == QuestionCategory.STRENGTHS
    assert service.classify_question("Tell us about a time you failed.") == QuestionCategory.FAILURE_LEARNING
    assert service.classify_question("Provide your favorite quote.") == QuestionCategory.CUSTOM


def test_deterministic_compensation_preserves_period(sample_profile):
    service = QACopilotService(ai_provider=MagicMock())
    q = QuestionInputDTO(
        questionId="q_sal",
        questionText="What is your expected pay?",
        category=QuestionCategory.COMPENSATION,
    )

    # 1. Monthly period
    res = service._resolve_deterministic_question(q, sample_profile)
    assert res.status == "VERIFIED"
    assert res.answer is not None
    assert "25,000 - 35,000" in res.answer
    assert "INR" in res.answer
    assert "per month" in res.answer

    # 2. Annual period
    sample_profile.preferences.salaryPeriod = "year"
    sample_profile.preferences.salaryCurrency = "USD"
    sample_profile.preferences.minSalary = 120000
    sample_profile.preferences.maxSalary = 140000
    res2 = service._resolve_deterministic_question(q, sample_profile)
    assert res2.status == "VERIFIED"
    assert res2.answer is not None
    assert "120,000 - 140,000" in res2.answer
    assert "USD" in res2.answer
    assert "per year" in res2.answer

    # 3. Missing compensation preference
    sample_profile.preferences.minSalary = None
    res3 = service._resolve_deterministic_question(q, sample_profile)
    assert res3.status == "MISSING_REQUIRED_FACTS"
    assert res3.answer is None
    assert "compensation_preference" in res3.missingFacts


def test_deterministic_notice_period(sample_profile):
    service = QACopilotService(ai_provider=MagicMock())
    q = QuestionInputDTO(
        questionId="q_avail",
        questionText="What is your notice period?",
        category=QuestionCategory.AVAILABILITY,
    )

    # 1. Immediate (verifies no contradictory text like 'with zero notice period')
    sample_profile.preferences.noticePeriod = "Immediate"
    res1 = service._resolve_deterministic_question(q, sample_profile)
    assert res1.status == "VERIFIED"
    assert res1.answer == "I am available to start immediately."

    # 2. 15 days
    sample_profile.preferences.noticePeriod = "15 days"
    res2 = service._resolve_deterministic_question(q, sample_profile)
    assert res2.status == "VERIFIED"
    assert res2.answer == "My notice period is 15 days."

    # 3. Missing notice period
    sample_profile.preferences.noticePeriod = None
    res3 = service._resolve_deterministic_question(q, sample_profile)
    assert res3.status == "MISSING_REQUIRED_FACTS"
    assert res3.answer is None
    assert "availability_notice_period" in res3.missingFacts


def test_truth_lock_unsupported_technology(sample_profile):
    # Answer claims unverified technology: Kubernetes
    unverified_answer = "At my previous role, I deployed production workloads on Kubernetes and AWS EKS."
    status, violations, fact_ids = qa_claim_validator.validate_answer(unverified_answer, sample_profile)
    assert status == "REJECTED"
    assert any("kubernetes" in v.lower() for v in violations)

    # Truthful answer acknowledging lack of Kubernetes with Docker
    truthful_answer = "While I do not have direct production experience with Kubernetes, I have extensive experience containerizing applications using Docker and FastAPI in WebPilot."
    status2, violations2, fact_ids2 = qa_claim_validator.validate_answer(truthful_answer, sample_profile)
    assert status2 == "VERIFIED"
    assert len(violations2) == 0


def test_truth_lock_unsupported_metrics(sample_profile):
    # Answer claims hallucinated metric (e.g., 99% or 5000 users) not in profile
    hallucinated_answer = "In WebPilot, I optimized real-time streaming to achieve a 99% reduction in latency for 5000 clients."
    status, violations, fact_ids = qa_claim_validator.validate_answer(hallucinated_answer, sample_profile)
    assert status == "REJECTED"
    assert any("quantitative metrics" in v.lower() for v in violations)

    # Answer citing actual verified metric (25% reduction, 1500 events)
    verified_answer = "In WebPilot, I designed a Redis streaming architecture processing 1500 concurrent events, reducing latency by 25%."
    status2, violations2, fact_ids2 = qa_claim_validator.validate_answer(verified_answer, sample_profile)
    assert status2 == "VERIFIED"
    assert len(violations2) == 0


@pytest.mark.asyncio
async def test_batch_generation_with_question_isolation(sample_profile, monkeypatch):
    # Mock profile repository
    from app.db.repositories.profile_repo import profile_repo
    monkeypatch.setattr(profile_repo, "get_by_user_id", lambda uid: sample_profile)

    # Mock Gemini AI Provider to generate answer for generative question
    mock_ai = MagicMock()
    mock_ai.generate_structured = AsyncMock(return_value=BatchAnswersOutput(
        answers=[
            SingleGeneratedAnswer(
                questionId="q_003",
                answer="At WebPilot, I built an AI browser pipeline using Docker and FastAPI processing 1500 events."
            )
        ]
    ))
    mock_ai.last_model_used = "gemini-3.5-flash-lite"

    service = QACopilotService(ai_provider=mock_ai)

    req = BatchGenerateRequest(
        questions=[
            QuestionInputDTO(questionId="q_001", questionText="What are your salary expectations?", category=QuestionCategory.COMPENSATION),
            QuestionInputDTO(questionId="q_002", questionText="What is your notice period?", category=QuestionCategory.AVAILABILITY),
            QuestionInputDTO(questionId="q_003", questionText="Describe an engineering challenge you solved.", category=QuestionCategory.TECHNICAL_CHALLENGE),
        ]
    )

    res = await service.batch_generate(user_id="user_test_qa", application_id=None, req=req)

    assert len(res.answers) == 3
    # Check stable question IDs and original ordering
    assert res.answers[0].questionId == "q_001"
    assert res.answers[0].status == "VERIFIED"
    assert res.answers[0].isDeterministic is True
    assert res.answers[0].answer is not None
    assert "25,000" in res.answers[0].answer

    assert res.answers[1].questionId == "q_002"
    assert res.answers[1].status == "VERIFIED"
    assert res.answers[1].isDeterministic is True
    assert res.answers[1].answer is not None
    assert "available to start immediately" in res.answers[1].answer

    assert res.answers[2].questionId == "q_003"
    assert res.answers[2].status == "VERIFIED"
    assert res.answers[2].isDeterministic is False
    assert res.answers[2].answer is not None
    assert "WebPilot" in res.answers[2].answer


@pytest.mark.asyncio
async def test_rest_api_crud_and_user_edit_authority(sample_profile, monkeypatch, async_client):
    from app.db.repositories.profile_repo import profile_repo
    from app.db.repositories.application_repo import application_repo
    from app.core.auth import get_authenticated_user_id
    from app.main import app

    app.dependency_overrides[get_authenticated_user_id] = lambda: "user_test_qa"

    # Seed application
    app_rec = ApplicationRecordDTO(
        id="app_test_qa_01",
        userId="user_test_qa",
        company="Give Grants",
        jobTitle="Software Intern",
        location="Remote",
        status="saved",
    )
    application_repo._memory_cache[app_rec.id] = app_rec
    monkeypatch.setattr(profile_repo, "get_by_user_id", lambda uid: sample_profile)

    # 1. Batch generate deterministic question
    payload = {
        "questions": [
            {
                "questionId": "q_001",
                "questionText": "What are your salary expectations?",
                "category": "compensation"
            }
        ]
    }
    resp = await async_client.post(
        f"/api/v1/applications/{app_rec.id}/qa/batch-generate",
        json=payload,
    )
    assert resp.status_code == 200
    data = resp.json()
    assert len(data["answers"]) == 1
    assert data["answers"][0]["status"] == "VERIFIED"
    assert "25,000" in data["answers"][0]["answer"]

    # Verify saved in application record
    saved_app = application_repo.get_by_id("user_test_qa", app_rec.id)
    assert saved_app is not None
    assert len(saved_app.customQuestions) == 1
    qa_entry = saved_app.customQuestions[0]
    assert qa_entry.questionId == "q_001"
    assert qa_entry.userEdited is False

    # 2. Patch user edit to verify User Edit Authority
    patch_resp = await async_client.patch(
        f"/api/v1/applications/{app_rec.id}/qa/{qa_entry.qaId}",
        json={"answerText": "My updated candidate preference is strictly INR 35,000/month."},
    )
    assert patch_resp.status_code == 200
    patched_data = patch_resp.json()
    assert patched_data["userEdited"] is True
    assert patched_data["currentAnswer"] == "My updated candidate preference is strictly INR 35,000/month."

    # 3. List Q&A entries
    list_resp = await async_client.get(f"/api/v1/applications/{app_rec.id}/qa")
    assert list_resp.status_code == 200
    assert len(list_resp.json()) == 1

    # 4. Security test: unauthorized user cannot access
    app.dependency_overrides[get_authenticated_user_id] = lambda: "attacker_user"
    unauth_resp = await async_client.get(f"/api/v1/applications/{app_rec.id}/qa")
    assert unauth_resp.status_code == 404 or unauth_resp.status_code == 403

    # Clean up overrides
    app.dependency_overrides.clear()
