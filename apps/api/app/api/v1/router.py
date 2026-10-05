from fastapi import APIRouter

from app.api.v1.ai_settings import router as ai_settings_router
from app.api.v1.application_qa import router as application_qa_router
from app.api.v1.applications import router as applications_router
from app.api.v1.cover_letters import router as cover_letters_router
from app.api.v1.jobs import router as jobs_router
from app.api.v1.profile import router as profile_router
from app.api.v1.recommendations import router as recommendations_router
from app.api.v1.resumes import router as resumes_router
from app.api.v1.scanner import router as scanner_router

api_router = APIRouter()


@api_router.get("/health", tags=["Health"])
async def health_check():
    """Health check endpoint to verify backend status."""
    return {
        "status": "ok",
        "service": "job-finder-api",
        "version": "0.1.0",
    }


# Mount Sub-Routers
api_router.include_router(profile_router)
api_router.include_router(jobs_router)
api_router.include_router(recommendations_router)
api_router.include_router(resumes_router)
api_router.include_router(cover_letters_router)
api_router.include_router(scanner_router)
api_router.include_router(applications_router, prefix="/applications", tags=["Applications"])
api_router.include_router(application_qa_router)
api_router.include_router(ai_settings_router)
