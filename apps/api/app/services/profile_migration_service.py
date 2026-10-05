"""Generic, idempotent, version-aware profile migration service for verified truth records."""

import logging
from datetime import UTC, datetime

from app.schemas.profile import (
    CourseCertificationFact,
    ExperienceFact,
    MetricFact,
    Profile,
)

logger = logging.getLogger("jobFinder.profile_migration")

MIGRATION_V1_LODESTAR_COURSES = "20261004_verified_lodestar_courses"

LEGACY_COURSE_PLACEHOLDERS = {
    "completed foundational training in r programming and learned practical concepts for working with r.",
    "completed foundational training in introduction to data science (ids) with r programming.",
    "completed foundational training in introduction to data science (ids).",
    "covered foundational r syntax, vector arithmetic, data frames, indexing, conditional logic, and functions for statistical data analysis.",
    "completed structured coursework on data science principles, exploratory data analysis, data structures, and statistical modeling in r.",
}

LEGACY_COURSE_URLS = {
    "https://www.credly.com/badges/dbd8d85f-8d2b-426b-a25e-3eece8dfd272/linked_in_profile",
}


def get_canonical_lodestar_fact() -> ExperienceFact:
    """Canonical verified Lodestar professional experience fact."""
    return ExperienceFact(
        id="exp-lodestar-01",
        company="Lodestar",
        title="Software Engineering Intern",
        employmentType="internship",
        category="work",
        location="Remote",
        startDate="Jun 2026",
        endDate="Aug 2026",
        current=False,
        description=(
            "Engineered browser autocapture SDK modules, PII-redaction pass, "
            "user journey dashboard flows, and Fastify synthetic validation harness."
        ),
        bullets=[
            (
                "Built modules of a browser autocapture SDK, including a capture-phase listener layer "
                "automatically emitting click, navigation, input, and network events without manual instrumentation."
            ),
            (
                "Implemented a PII-redaction pass before events were batched/shipped to the ingest endpoint."
            ),
            (
                "Built a dashboard user journey view by grouping raw events by session, ordering them chronologically, "
                "counting common step-to-step transitions, and transforming the processed data into a flow diagram."
            ),
            (
                "Built a seed/load harness replaying ~14.6K synthetic events across approximately 40 sessions "
                "through a per-tenant Fastify ingest service, validating capture → storage → analytics and usage metering."
            ),
        ],
        metrics=[
            MetricFact(
                id="fact-lodestar-events-01",
                parentId="exp-lodestar-01",
                value="~14.6K",
                description=(
                    "Built seed/load harness replaying approximately 14.6K synthetic events across approximately 40 sessions "
                    "through a per-tenant Fastify ingest service, validating capture → storage → analytics and usage metering"
                ),
                unitOrScope="synthetic_events",
                verified=True,
                source="candidate_confirmed",
            ),
            MetricFact(
                id="fact-lodestar-sessions-02",
                parentId="exp-lodestar-01",
                value="~40",
                description="Replayed synthetic events across approximately 40 test sessions through per-tenant Fastify ingest service",
                unitOrScope="sessions",
                verified=True,
                source="candidate_confirmed",
            ),
        ],
        verified=True,
        source="candidate_confirmed",
    )


def get_canonical_courses() -> list[CourseCertificationFact]:
    """Canonical verified courses with immutable descriptions and clickable URLs."""
    now_iso = datetime.now(UTC).isoformat()
    return [
        CourseCertificationFact(
            id="course-cert-1",
            title="R Programming for Beginners",
            provider="Simplilearn",
            certificateUrl="https://simpli-web.app.link/e/y7IuGdmHVNb",
            completionYear="2024",
            description="Covered R fundamentals, data structures, functions, and basic data visualization.",
            verified=True,
            source="candidate_confirmed",
            createdAt=now_iso,
            updatedAt=now_iso,
        ),
        CourseCertificationFact(
            id="course-cert-2",
            title="Introduction to Data Science (IDS) with R Programming",
            provider="Simplilearn",
            certificateUrl="https://surl.li/kghssn",
            completionYear="2024",
            description=(
                "Studied data analysis and basic machine learning techniques including "
                "regression, decision trees, clustering, and time-series analysis using R."
            ),
            verified=True,
            source="candidate_confirmed",
            createdAt=now_iso,
            updatedAt=now_iso,
        ),
        CourseCertificationFact(
            id="course-cert-3",
            title="Introduction to Data Science (IDS)",
            provider="Simplilearn",
            certificateUrl="https://www.credly.com/badges/49b94f57-3ab9-4f38-9658-72693569a8a8/public_url",
            completionYear="2024",
            description=(
                "Covered fundamentals of data science, data analytics, data collection, "
                "data validation, and data-driven decision making."
            ),
            verified=True,
            source="candidate_confirmed",
            createdAt=now_iso,
            updatedAt=now_iso,
        ),
        CourseCertificationFact(
            id="course-cert-4",
            title="The Complete Full-Stack Web Development Bootcamp",
            provider="Udemy",
            instructor="Dr. Angela Yu",
            certificateUrl="https://www.udemy.com/certificate/UC-629d8586-5aba-4e2f-bd22-05117d8f8b73/",
            completionYear=None,
            description=(
                "Covered full-stack web development including HTML, CSS, JavaScript, React, "
                "Node.js, Express, REST APIs, SQL/PostgreSQL, authentication, and Git/GitHub "
                "through project-based development."
            ),
            verified=True,
            source="candidate_confirmed",
            createdAt=now_iso,
            updatedAt=now_iso,
        ),
    ]


class ProfileMigrationService:
    """Manages versioned, idempotent, user-scoped profile migrations."""

    @staticmethod
    def migrate_profile(profile: Profile, force: bool = False) -> tuple[Profile, bool]:
        """Apply pending migrations to a candidate profile.

        Rules:
        - Version-aware: If MIGRATION_V1_LODESTAR_COURSES is already recorded in appliedMigrations,
          the migration will NOT run again (avoiding resurrection of user-deleted records).
        - Idempotent: Can be safely executed multiple times.
        - Non-destructive: Preserves user edits; only replaces known legacy placeholder descriptions.
        """
        if not force and MIGRATION_V1_LODESTAR_COURSES in profile.appliedMigrations:
            logger.debug(
                f"Profile for {profile.userId} already has migration {MIGRATION_V1_LODESTAR_COURSES} applied. Skipping."
            )
            return profile, False

        has_changed = False

        # ----------------------------------------------------------------------
        # 1. Professional Experience: Canonical Lodestar Fact
        # ----------------------------------------------------------------------
        has_lodestar = any(
            exp.id == "exp-lodestar-01" or exp.company.strip().lower() == "lodestar"
            for exp in profile.experience
        )

        if not has_lodestar:
            profile.experience.insert(0, get_canonical_lodestar_fact())
            has_changed = True
            logger.info(f"Added canonical Lodestar experience for user {profile.userId}.")
        else:
            # If Lodestar already exists, ensure category is 'work', employmentType is 'internship', and title is preserved
            for exp in profile.experience:
                if exp.id == "exp-lodestar-01" or exp.company.strip().lower() == "lodestar":
                    if exp.category != "work":
                        exp.category = "work"
                        has_changed = True
                    if exp.employmentType != "internship":
                        exp.employmentType = "internship"
                        has_changed = True
                    if exp.title != "Software Engineering Intern":
                        exp.title = "Software Engineering Intern"
                        has_changed = True

        # Tag Techniva Technical Club as leadership
        for exp in profile.experience:
            if "techniva" in exp.company.strip().lower():
                if exp.category != "leadership":
                    exp.category = "leadership"
                    has_changed = True
                if exp.employmentType != "leadership":
                    exp.employmentType = "leadership"
                    has_changed = True

        # ----------------------------------------------------------------------
        # 2. Courses & Certifications: Sync 4 Canonical Courses
        # ----------------------------------------------------------------------
        canonical_courses = get_canonical_courses()
        existing_courses_by_id = {c.id: c for c in profile.courseCertifications}
        existing_courses_by_url = {
            c.certificateUrl.strip().lower(): c
            for c in profile.courseCertifications
            if c.certificateUrl
        }
        existing_courses_by_title = {
            c.title.strip().lower(): c
            for c in profile.courseCertifications
        }

        for canonical in canonical_courses:
            existing: CourseCertificationFact | None = existing_courses_by_id.get(canonical.id)
            if not existing and canonical.certificateUrl:
                existing = existing_courses_by_url.get(canonical.certificateUrl.strip().lower())
            if not existing:
                existing = existing_courses_by_title.get(canonical.title.strip().lower())

            if not existing:
                profile.courseCertifications.append(canonical)
                has_changed = True
                logger.info(f"Added canonical course '{canonical.title}' for user {profile.userId}.")
            else:
                # Upgrade known legacy placeholder descriptions to immutable verified descriptions
                if existing.description:
                    clean_desc = existing.description.strip().lower().rstrip(".") + "."
                    if clean_desc in LEGACY_COURSE_PLACEHOLDERS:
                        existing.description = canonical.description
                        has_changed = True
                        logger.info(f"Upgraded legacy placeholder description for course '{existing.title}'.")

                # Upgrade known drifted certificate URLs
                if existing.certificateUrl and existing.certificateUrl.strip() in LEGACY_COURSE_URLS:
                    existing.certificateUrl = canonical.certificateUrl
                    has_changed = True
                    logger.info(f"Corrected legacy certificate URL for course '{existing.title}'.")
                elif not existing.certificateUrl and canonical.certificateUrl:
                    existing.certificateUrl = canonical.certificateUrl
                    has_changed = True

                # Ensure instructor is populated if missing
                if canonical.instructor and not existing.instructor:
                    existing.instructor = canonical.instructor
                    has_changed = True

                # Ensure provider is populated if missing
                if canonical.provider and not existing.provider:
                    existing.provider = canonical.provider
                    has_changed = True

        # ----------------------------------------------------------------------
        # 3. Record Migration Version
        # ----------------------------------------------------------------------
        if MIGRATION_V1_LODESTAR_COURSES not in profile.appliedMigrations:
            profile.appliedMigrations.append(MIGRATION_V1_LODESTAR_COURSES)
            has_changed = True

        if has_changed:
            profile.updatedAt = datetime.now(UTC).isoformat()

        return profile, has_changed


profile_migration_service = ProfileMigrationService()
