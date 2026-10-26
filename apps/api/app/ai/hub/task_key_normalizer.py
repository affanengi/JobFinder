"""Bidirectional normalization and aliasing for AI task keys.

Ensures seamless compatibility between legacy keys (e.g. resume_generation,
cover_letter_generation) and canonical keys (resume_tailoring, cover_letter_gen).
"""

from app.ai.hub.types import AITaskType

TASK_KEY_CANONICAL_MAP: dict[str, str] = {
    "resume_generation": AITaskType.RESUME_TAILORING.value,
    "resume_tailoring": AITaskType.RESUME_TAILORING.value,
    "cover_letter_generation": AITaskType.COVER_LETTER_GEN.value,
    "cover_letter_gen": AITaskType.COVER_LETTER_GEN.value,
    "dual_artifact_generation": AITaskType.DUAL_ARTIFACT_GEN.value,
    "dual_artifact_gen": AITaskType.DUAL_ARTIFACT_GEN.value,
    "ats_bullet_rewrite": AITaskType.ATS_BULLET_REWRITE.value,
    "ats_bulk_rewrite": AITaskType.ATS_BULK_REWRITE.value,
    "qa_copilot": AITaskType.QA_COPILOT.value,
    "resume_parsing": AITaskType.RESUME_PARSING.value,
    "job_ingestion": AITaskType.JOB_INGESTION.value,
    "job_analysis": AITaskType.JOB_ANALYSIS.value,
    "ats_scan_analysis": AITaskType.ATS_SCAN_ANALYSIS.value,
    "ats_scanner": AITaskType.ATS_SCAN_ANALYSIS.value,
    "ats_scan": AITaskType.ATS_SCAN_ANALYSIS.value,
}


def normalize_task_key(task: str | AITaskType | None) -> str:
    """Normalize a task key to its canonical AITaskType string value.

    If the task key is not in the map, returns the raw stripped string (or empty string if None).
    """
    if task is None:
        return ""
    raw = task.value if hasattr(task, "value") else str(task)
    raw = raw.strip()
    return TASK_KEY_CANONICAL_MAP.get(raw, raw)


def get_task_aliases(task: str | AITaskType | None) -> list[str]:
    """Return a list containing the canonical task key and all recognized legacy aliases.

    Useful for querying databases where historical records might contain legacy keys.
    """
    if task is None:
        return []
    canonical = normalize_task_key(task)
    if not canonical:
        return []
    aliases = {canonical}
    for alias, mapped_canonical in TASK_KEY_CANONICAL_MAP.items():
        if mapped_canonical == canonical:
            aliases.add(alias)
    return sorted(aliases)
