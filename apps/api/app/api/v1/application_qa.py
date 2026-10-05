"""FastAPI Router for ATS Custom Question Co-Pilot & Autofill Bridge."""

import logging
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, status

from app.core.auth import get_authenticated_user_id
from app.db.repositories.application_repo import application_repo
from app.schemas.application import (
    BatchGenerateRequest,
    BatchGenerateResponse,
    CustomQuestionAnswerDTO,
    UpdateQuestionAnswerRequest,
)
from app.schemas.autofill import BatchFillRequest, BatchFillResponse
from app.services.qa_copilot_service import qa_copilot_service
from app.services.playwright_autofill_engine import playwright_autofill_engine

logger = logging.getLogger("jobFinder.api.application_qa")

router = APIRouter(prefix="/applications", tags=["application_qa"])


@router.post(
    "/{application_id}/qa/batch-generate",
    response_model=BatchGenerateResponse,
    status_code=status.HTTP_200_OK,
)
async def batch_generate_questions(
    application_id: str,
    request: BatchGenerateRequest,
    user_id: str = Depends(get_authenticated_user_id),
):
    """Generate structured, truth-locked answers for a batch of selected custom questions."""
    app_record = application_repo.get_by_id(user_id, application_id)
    if not app_record:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Application {application_id} not found.",
        )
    if app_record.userId != user_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Unauthorized access to application.",
        )

    try:
        return await qa_copilot_service.batch_generate(
            user_id=user_id,
            application_id=application_id,
            req=request,
        )
    except Exception as e:
        logger.error(f"Batch question generation failed: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to generate custom question answers: {str(e)}",
        )


@router.post(
    "/qa/batch-generate",
    response_model=BatchGenerateResponse,
    status_code=status.HTTP_200_OK,
)
async def standalone_batch_generate_questions(
    request: BatchGenerateRequest,
    user_id: str = Depends(get_authenticated_user_id),
):
    """Standalone batch generation without requiring an existing application card."""
    try:
        return await qa_copilot_service.batch_generate(
            user_id=user_id,
            application_id=None,
            req=request,
        )
    except Exception as e:
        logger.error(f"Standalone batch question generation failed: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to generate custom question answers: {str(e)}",
        )


@router.post(
    "/{application_id}/qa/batch-fill",
    response_model=BatchFillResponse,
    status_code=status.HTTP_200_OK,
)
async def batch_fill_answers(
    application_id: str,
    request: BatchFillRequest,
    user_id: str = Depends(get_authenticated_user_id),
):
    """Bridge generated Q&A answers directly into live Playwright form fields."""
    session = playwright_autofill_engine.get_session(request.sessionId)
    if not session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Autofill session {request.sessionId} not found or expired.",
        )
    if session.userId != user_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Unauthorized access to autofill session.",
        )

    try:
        return await playwright_autofill_engine.fill_custom_answers(
            session_id=request.sessionId,
            answers=request.answers,
        )
    except Exception as e:
        logger.error(f"Failed to populate custom answers in session {request.sessionId}: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to fill answers: {str(e)}",
        )


@router.get(
    "/{application_id}/qa",
    response_model=list[CustomQuestionAnswerDTO],
    status_code=status.HTTP_200_OK,
)
async def list_application_questions(
    application_id: str,
    user_id: str = Depends(get_authenticated_user_id),
):
    """Retrieve all persisted Q&A entries for an application record."""
    app_record = application_repo.get_by_id(user_id, application_id)
    if not app_record:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Application not found.")
    if app_record.userId != user_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Unauthorized access.")

    return app_record.customQuestions


@router.patch(
    "/{application_id}/qa/{qa_id}",
    response_model=CustomQuestionAnswerDTO,
    status_code=status.HTTP_200_OK,
)
async def update_question_answer(
    application_id: str,
    qa_id: str,
    request: UpdateQuestionAnswerRequest,
    user_id: str = Depends(get_authenticated_user_id),
):
    """Update current answer with candidate manual edits, marking userEdited=True."""
    app_record = application_repo.get_by_id(user_id, application_id)
    if not app_record:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Application not found.")
    if app_record.userId != user_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Unauthorized access.")

    matched = next((q for q in app_record.customQuestions if q.qaId == qa_id), None)
    if not matched:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Q&A item {qa_id} not found.")

    matched.currentAnswer = request.answerText.strip()
    matched.userEdited = True
    matched.characterCount = len(matched.currentAnswer)
    matched.wordCount = len(matched.currentAnswer.split())

    application_repo.save(app_record)
    return matched


@router.delete(
    "/{application_id}/qa/{qa_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_question_answer(
    application_id: str,
    qa_id: str,
    user_id: str = Depends(get_authenticated_user_id),
):
    """Remove a Q&A item from an application record."""
    app_record = application_repo.get_by_id(user_id, application_id)
    if not app_record:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Application not found.")
    if app_record.userId != user_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Unauthorized access.")

    initial_len = len(app_record.customQuestions)
    app_record.customQuestions = [q for q in app_record.customQuestions if q.qaId != qa_id]

    if len(app_record.customQuestions) == initial_len:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Q&A item {qa_id} not found.")

    application_repo.save(app_record)
    return None
