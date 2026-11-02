import os
from pathlib import Path
from pydantic import AliasChoices, Field
from pydantic_settings import BaseSettings, SettingsConfigDict

_config_path = Path(__file__).resolve()
_api_env_path = _config_path.parents[2] / ".env"
_root_env_path = _config_path.parents[4] / ".env"


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
    # Dedicated Gemini API Key for Company Analysis & Scam Shield (Key 5)
    GEMINI_COMPANY_ANALYSIS_API_KEY: str = ""
    COMPANY_ANALYSIS_GEMINI_API_KEY: str = ""

    GEMINI_MODEL: str = "gemini-3.5-flash-lite"
    GEMINI_EMBEDDING_MODEL: str = "text-embedding-004"

    # OpenRouter API ($0 Free Models & Pay-as-you-go)
    OPENROUTER_API_KEY: str = ""

    # Groq Cloud API ($0 Free Tier Ultra-Fast Inference)
    GROQ_API_KEY: str = ""

    # Phase 2 Search Providers (Optional Free Tiers / Credits; Degrades to Browser Links)
    EXA_API_KEY: str = ""
    BRAVE_SEARCH_API_KEY: str = ""
    SEARCH_COST_POLICY: str = "FREE_ONLY"

    # AI Hub AES-256-GCM Master Encryption Secret (Phase 1/4)
    AI_ENCRYPTION_SECRET: str = "jobfinder-master-encryption-secret-key-32bytes!"

    # Dedicated Google Third-Party Connections OAuth Secrets & Client IDs
    OAUTH_ENCRYPTION_SECRET: str = ""
    GOOGLE_OAUTH_REDIRECT_URI_BASE: str = "http://localhost:8000"

    # Gmail OAuth Client (Isolated)
    GOOGLE_GMAIL_CLIENT_ID: str = ""
    GOOGLE_GMAIL_CLIENT_SECRET: str = ""

    # Calendar OAuth Client (Isolated)
    GOOGLE_CALENDAR_CLIENT_ID: str = ""
    GOOGLE_CALENDAR_CLIENT_SECRET: str = ""

    # Drive OAuth Client (Isolated)
    GOOGLE_DRIVE_CLIENT_ID: str = ""
    GOOGLE_DRIVE_CLIENT_SECRET: str = ""

    # Legacy Gmail OAuth Fallback
    GOOGLE_CLIENT_ID: str = Field(
        default="",
        validation_alias=AliasChoices("GOOGLE_CLIENT_ID", "GOOGLE_OAUTH_CLIENT_ID"),
    )
    GOOGLE_CLIENT_SECRET: str = Field(
        default="",
        validation_alias=AliasChoices("GOOGLE_CLIENT_SECRET", "GOOGLE_OAUTH_CLIENT_SECRET"),
    )
    GOOGLE_OAUTH_REDIRECT_URI: str = "http://localhost:8000/api/v1/auth/gmail/callback"

    # OAuth Scope URIs
    GMAIL_SEND_SCOPE: str = "https://www.googleapis.com/auth/gmail.send"
    GMAIL_READ_SCOPE: str = "https://www.googleapis.com/auth/gmail.readonly"
    CALENDAR_EVENTS_SCOPE: str = "https://www.googleapis.com/auth/calendar.events"
    DRIVE_FILE_SCOPE: str = "https://www.googleapis.com/auth/drive.file"

    @property
    def GOOGLE_OAUTH_CLIENT_ID(self) -> str:
        return self.GOOGLE_GMAIL_CLIENT_ID or self.GOOGLE_CLIENT_ID

    @property
    def GOOGLE_OAUTH_CLIENT_SECRET(self) -> str:
        return self.GOOGLE_GMAIL_CLIENT_SECRET or self.GOOGLE_CLIENT_SECRET

    def get_google_client_id(self, service: str) -> str:
        """Retrieve client ID for specific service with backward-compatible fallback for Gmail."""
        svc = service.lower().strip()
        val = ""
        if svc == "gmail":
            val = self.GOOGLE_GMAIL_CLIENT_ID or self.GOOGLE_CLIENT_ID
        elif svc == "calendar":
            val = self.GOOGLE_CALENDAR_CLIENT_ID
        elif svc == "drive":
            val = self.GOOGLE_DRIVE_CLIENT_ID

        if not val:
            try:
                from dotenv import dotenv_values
                env_vals = dotenv_values(".env")
                if svc == "gmail":
                    val = env_vals.get("GOOGLE_GMAIL_CLIENT_ID") or env_vals.get("GOOGLE_CLIENT_ID") or ""
                elif svc == "calendar":
                    val = env_vals.get("GOOGLE_CALENDAR_CLIENT_ID") or ""
                elif svc == "drive":
                    val = env_vals.get("GOOGLE_DRIVE_CLIENT_ID") or ""
            except Exception:
                pass
        return val

    def get_google_client_secret(self, service: str) -> str:
        """Retrieve client secret for specific service with backward-compatible fallback for Gmail."""
        svc = service.lower().strip()
        val = ""
        if svc == "gmail":
            val = self.GOOGLE_GMAIL_CLIENT_SECRET or self.GOOGLE_CLIENT_SECRET
        elif svc == "calendar":
            val = self.GOOGLE_CALENDAR_CLIENT_SECRET
        elif svc == "drive":
            val = self.GOOGLE_DRIVE_CLIENT_SECRET

        if not val:
            try:
                from dotenv import dotenv_values
                env_vals = dotenv_values(".env")
                if svc == "gmail":
                    val = env_vals.get("GOOGLE_GMAIL_CLIENT_SECRET") or env_vals.get("GOOGLE_CLIENT_SECRET") or ""
                elif svc == "calendar":
                    val = env_vals.get("GOOGLE_CALENDAR_CLIENT_SECRET") or ""
                elif svc == "drive":
                    val = env_vals.get("GOOGLE_DRIVE_CLIENT_SECRET") or ""
            except Exception:
                pass
        return val

    # Firebase ($0 Spark Plan)
    FIREBASE_PROJECT_ID: str = ""
    FIREBASE_CLIENT_EMAIL: str = ""
    FIREBASE_PRIVATE_KEY: str = ""

    # Playwright Automation
    PLAYWRIGHT_HEADLESS: bool = False
    PLAYWRIGHT_TIMEOUT_MS: int = 30000

    model_config = SettingsConfigDict(
        env_file=(_root_env_path, _api_env_path, ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

settings = Settings()

# Mirror AI_ENCRYPTION_SECRET from settings into os.environ for cryptographic routines
if settings.AI_ENCRYPTION_SECRET and "AI_ENCRYPTION_SECRET" not in os.environ:
    os.environ["AI_ENCRYPTION_SECRET"] = settings.AI_ENCRYPTION_SECRET
