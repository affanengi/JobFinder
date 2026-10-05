"""CLI script to run explicit, idempotent, version-aware profile migration in Firestore."""

import argparse
import logging
import sys

from app.db.firebase import get_firestore_client
from app.db.repositories.profile_repo import profile_repo
from app.schemas.profile import Profile
from app.services.profile_migration_service import profile_migration_service

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("migrate_verified_profile")


def run_migration(target_user_id: str | None = None, force: bool = False):
    """Run idempotent migration across all candidate profiles or a specific user profile."""
    client = get_firestore_client()
    profiles_col = client.collection("profiles")

    if target_user_id:
        doc = profiles_col.document(target_user_id).get()
        if not doc.exists:
            logger.error(f"Profile for user '{target_user_id}' does not exist in Firestore.")
            sys.exit(1)
        target_docs = [doc]
    else:
        target_docs = list(profiles_col.stream())

    logger.info(f"Discovered {len(target_docs)} profile document(s) in Firestore.")

    migrated_count = 0
    skipped_count = 0

    for doc in target_docs:
        raw_data = doc.to_dict() or {}
        raw_data.setdefault("userId", doc.id)
        try:
            profile = Profile.model_validate(raw_data)
        except Exception as e:
            logger.error(f"Error validating profile for user {doc.id}: {e}")
            skipped_count += 1
            continue

        # Safeguard: Do not migrate ephemeral test profiles in batch mode unless explicitly targeted
        if not target_user_id and (
            doc.id.startswith("test_multi_user_")
            or (not profile.personal.fullName and not profile.personal.email and doc.id != "user_default")
        ):
            skipped_count += 1
            logger.info(f"Skipping blank/test profile in batch migration: {doc.id}")
            continue

        updated_profile, has_changed = profile_migration_service.migrate_profile(profile, force=force)

        if has_changed:
            profile_repo.save(updated_profile)
            migrated_count += 1
            logger.info(f"Successfully migrated and saved profile for user: {doc.id}")
        else:
            skipped_count += 1
            logger.info(f"No changes required for profile: {doc.id}")

    logger.info(f"Migration completed. Migrated: {migrated_count}, Skipped/Unchanged: {skipped_count}.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Migrate Firestore profiles to canonical verified truth structure.")
    parser.add_argument("--user-id", type=str, default=None, help="Target specific user ID to migrate.")
    parser.add_argument("--force", action="store_true", help="Force re-run migration even if already marked applied.")
    args = parser.parse_args()

    run_migration(target_user_id=args.user_id, force=args.force)
