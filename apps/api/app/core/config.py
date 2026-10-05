from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    ENVIRONMENT: str = "development"
    PROJECT_NAME: str = "Personal AI Job Agent API"
    API_V1_PREFIX: str = "/api/v1"
    PORT: int = 8000
    HOST: str = "0.0.0.0"
    ALLOWED_EXTENSION_IDS: list[str] = []
    CORS_ORIGINS: list[str] = [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:3000",
    ]

    # Gemini AI ($0 Free Tier - Key 1 for Master Profile & Parser)
    GEMINI_API_KEY: str = ""
    # Dedicated Gemini API Key for ATS Resume Generation & Tailoring (Key 2)
    RESUME_GEMINI_API_KEY: str = ""
    # Dedicated Gemini API Key for ATS Scanner & Grounded AI Bullet Rewrites (Key 3)
    SCANNER_GEMINI_API_KEY: str = ""
    # Dedicated Gemini API Key for ATS Custom Question Co-Pilot
    QA_COPILOT_GEMINI_API_KEY: str = ""

    GEMINI_MODEL: str = "gemini-3.5-flash-lite"
    GEMINI_EMBEDDING_MODEL: str = "text-embedding-004"

    # OpenRouter API ($0 Free Models & Pay-as-you-go)
    OPENROUTER_API_KEY: str = ""

    # Groq Cloud API ($0 Free Tier Ultra-Fast Inference)
    GROQ_API_KEY: str = ""

    # AI Hub AES-256-GCM Master Encryption Secret (Phase 1/4)
    AI_ENCRYPTION_SECRET: str = "jobfinder-master-encryption-secret-key-32bytes!"

    # Firebase ($0 Spark Plan)
    FIREBASE_PROJECT_ID: str = ""
    FIREBASE_CLIENT_EMAIL: str = ""
    FIREBASE_PRIVATE_KEY: str = ""

    # Playwright Automation
    PLAYWRIGHT_HEADLESS: bool = False
    PLAYWRIGHT_TIMEOUT_MS: int = 30000

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

import os

settings = Settings()

# Mirror AI_ENCRYPTION_SECRET from settings into os.environ for cryptographic routines
if settings.AI_ENCRYPTION_SECRET and "AI_ENCRYPTION_SECRET" not in os.environ:
    os.environ["AI_ENCRYPTION_SECRET"] = settings.AI_ENCRYPTION_SECRET
