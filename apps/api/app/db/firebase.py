"""Firebase Admin SDK and Cloud Firestore Database Provider."""

import logging
import os
from pathlib import Path

import firebase_admin
from firebase_admin import credentials, firestore
from google.cloud.firestore import Client

logger = logging.getLogger("jobFinder.db.firebase")

_firestore_client: Client | None = None
_client_initialized: bool = False


def get_firestore_client() -> Client | None:
    """Initialize Firebase Admin and return the Cloud Firestore client singleton."""
    global _firestore_client, _client_initialized
    if _client_initialized:
        return _firestore_client

    key_path = os.getenv("FIREBASE_SERVICE_ACCOUNT_PATH", "serviceAccountKey.json")
    project_id = os.getenv("FIREBASE_PROJECT_ID", "jobfinder-c88b5")

    # Check relative to app root or current directory
    resolved_path = Path(key_path)
    if not resolved_path.is_absolute():
        app_dir = Path(__file__).resolve().parent.parent.parent
        if (app_dir / key_path).exists():
            resolved_path = app_dir / key_path

    # If running in CI or test runner and credentials do not exist, immediately skip probing GCP metadata
    is_testing = bool(os.getenv("CI") or os.getenv("PYTEST_CURRENT_TEST") or os.getenv("TESTING"))
    if not resolved_path.exists() and not os.getenv("GOOGLE_APPLICATION_CREDENTIALS") and is_testing:
        logger.info("Running in testing/CI mode without GCP credentials. Firestore operating in in-memory mode.")
        _client_initialized = True
        _firestore_client = None
        return None

    try:
        if resolved_path.exists():
            logger.info(f"Initializing Firebase Admin with Service Account at {resolved_path}")
            cred = credentials.Certificate(str(resolved_path))
            try:
                firebase_admin.get_app()
            except ValueError:
                firebase_admin.initialize_app(cred, {"projectId": project_id})
        else:
            logger.warning(
                f"Service account not found at {resolved_path}. Falling back to default credentials."
            )
            try:
                firebase_admin.get_app()
            except ValueError:
                firebase_admin.initialize_app(options={"projectId": project_id})

        client: Client = firestore.client()
        _firestore_client = client
        _client_initialized = True
        return client
    except Exception as e:
        logger.warning(
            f"Could not initialize Cloud Firestore client ({e}). Operating in in-memory mode."
        )
        _firestore_client = None
        _client_initialized = True
        return None


db = get_firestore_client
