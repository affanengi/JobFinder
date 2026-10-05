from contextlib import asynccontextmanager
import logging
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.v1.router import api_router
from app.core.config import settings
from app.services.playwright_autofill_engine import playwright_autofill_engine

@asynccontextmanager
async def lifespan(app: FastAPI):
    zombies_cleaned = playwright_autofill_engine.cleanup_zombies_on_startup()
    if zombies_cleaned > 0:
        logging.getLogger("jobFinder.main").info(f"Purged {zombies_cleaned} orphaned autofill sessions/processes.")
    yield

app = FastAPI(
    title=settings.PROJECT_NAME,
    openapi_url=f"{settings.API_V1_PREFIX}/openapi.json",
    docs_url=f"{settings.API_V1_PREFIX}/docs",
    redoc_url=f"{settings.API_V1_PREFIX}/redoc",
    lifespan=lifespan,
)

# CORS Middleware
cors_origins = list(settings.CORS_ORIGINS)
if getattr(settings, "ALLOWED_EXTENSION_IDS", None):
    cors_origins.extend([f"chrome-extension://{ext_id}" for ext_id in settings.ALLOWED_EXTENSION_IDS])

cors_origin_regex = (
    r"^chrome-extension://[a-z]{32}$"
    if settings.ENVIRONMENT == "development"
    else None
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_origin_regex=cors_origin_regex,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount API Routers
app.include_router(api_router, prefix=settings.API_V1_PREFIX)


@app.get("/")
async def root():
    return {
        "message": "Welcome to the Personal AI Job Agent API",
        "docs": f"{settings.API_V1_PREFIX}/docs",
        "health": f"{settings.API_V1_PREFIX}/health",
    }
