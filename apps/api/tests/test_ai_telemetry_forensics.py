"""Forensic unit and integration tests for AI execution telemetry.

Validates the four mandatory implementation concerns from v2.4.0:
1. Concern A: Trace classification type-safety, truth table, and route classification agreement.
2. Concern B: Preference classification across missing, partial, and contradictory evidence.
3. Concern C: Decoupling execution results from routing metadata (composite outcomes).
4. Concern D: Evidence-backed fallback narrative invariants.
5. Metrics & Scalability: Bounded streaming aggregation, denominator isolation, latency exclusion,
   task key aliasing, and provider case-insensitivity.
"""

import pytest
from app.ai.hub.task_key_normalizer import get_task_aliases, normalize_task_key
from app.ai.hub.telemetry_classifier import (
    classify_execution_result,
    classify_preference_status,
    classify_route_classification,
    classify_trace_status,
    derive_composite_execution_outcome,
    is_valid_hop_entry,
    is_valid_int,
)
from app.ai.hub.types import AITaskType
from app.db.repositories.ai_telemetry_repo import AITelemetryRepository
from app.services.ai_settings_service import AISettingsService


# ============================================================================
# CONCERN A: TRACE CLASSIFICATION & INPUT VALIDATION (TRUTH TABLE)
# ============================================================================

def test_is_valid_int_strictly_excludes_booleans():
    assert is_valid_int(1) is True
    assert is_valid_int(0) is True
    assert is_valid_int(42) is True
    # Python bool subclasses int; must be strictly rejected
    assert is_valid_int(True) is False
    assert is_valid_int(False) is False
    assert is_valid_int("1") is False
    assert is_valid_int(None) is False
    assert is_valid_int(1.0) is False


def test_is_valid_hop_entry_validation():
    assert is_valid_hop_entry({"credential_id": "cred_1", "status": "SUCCESS"}) is True
    assert is_valid_hop_entry({"model": "gemini-2.5-flash"}) is True
    assert is_valid_hop_entry("not_a_dict") is False
    assert is_valid_hop_entry({}) is False
    assert is_valid_hop_entry(None) is False


@pytest.mark.parametrize(
    "hops_count,fallback_level,attempted_hops,expected_trace,expected_route",
    [
        # 1. Verified Complete Direct
        (
            1,
            0,
            [{"credential_id": "c1", "status": "SUCCESS"}],
            "RECORDED_DIRECT",
            "DIRECT_ROUTE",
        ),
        # 2. Verified Complete Multi-Hop
        (
            2,
            1,
            [
                {"credential_id": "c1", "status": "FAILED"},
                {"credential_id": "c2", "status": "SUCCESS"},
            ],
            "RECORDED_MULTI_HOP",
            "FALLBACK_ROUTE",
        ),
        # 3. Incomplete Multi-Hop (Count > 1, empty hop list)
        (2, 1, [], "INCOMPLETE_MULTI_HOP", "FALLBACK_ROUTE"),
        # 4. Incomplete Multi-Hop (Count > 1, hops is None)
        (3, 2, None, "INCOMPLETE_MULTI_HOP", "FALLBACK_ROUTE"),
        # 5. Incomplete Multi-Hop (Count > len(hops))
        (
            3,
            2,
            [{"credential_id": "c1", "status": "FAILED"}],
            "INCOMPLETE_MULTI_HOP",
            "FALLBACK_ROUTE",
        ),
        # 6. Trace Unavailable (Count=None, hops=None)
        (None, 0, None, "TRACE_UNAVAILABLE", "UNKNOWN_ROUTE"),
        # 7. Trace Unavailable (Count=None, hops=[])
        (None, 0, [], "TRACE_UNAVAILABLE", "UNKNOWN_ROUTE"),
        # 8. Contradictory: Count=1, but 2 hops recorded
        (
            1,
            0,
            [
                {"credential_id": "c1", "status": "FAILED"},
                {"credential_id": "c2", "status": "SUCCESS"},
            ],
            "CONTRADICTORY_TELEMETRY",
            "CONTRADICTORY_ROUTE",
        ),
        # 9. Contradictory: Count=1, but fallback_level=2
        (
            1,
            2,
            [{"credential_id": "c1", "status": "SUCCESS"}],
            "CONTRADICTORY_TELEMETRY",
            "CONTRADICTORY_ROUTE",
        ),
        # 10. Contradictory: Count=0, but hops list non-empty
        (
            0,
            0,
            [{"credential_id": "c1", "status": "SUCCESS"}],
            "CONTRADICTORY_TELEMETRY",
            "CONTRADICTORY_ROUTE",
        ),
        # 11. Contradictory: hops_count is bool True
        (
            True,
            0,
            [{"credential_id": "c1", "status": "SUCCESS"}],
            "CONTRADICTORY_TELEMETRY",
            "CONTRADICTORY_ROUTE",
        ),
        # 12. Contradictory: negative hops_count
        (-1, 0, [], "CONTRADICTORY_TELEMETRY", "CONTRADICTORY_ROUTE"),
        # 13. Contradictory: malformed hop entry
        (
            1,
            0,
            ["not_a_valid_dict"],
            "CONTRADICTORY_TELEMETRY",
            "CONTRADICTORY_ROUTE",
        ),
        # 14. Incomplete Multi-Hop via fallback_level alone (hops_count unrecorded)
        (None, 2, None, "INCOMPLETE_MULTI_HOP", "FALLBACK_ROUTE"),
    ],
)
def test_trace_status_and_route_classification_truth_table(
    hops_count, fallback_level, attempted_hops, expected_trace, expected_route
):
    trace_status = classify_trace_status(hops_count, fallback_level, attempted_hops)
    assert trace_status == expected_trace

    route_class = classify_route_classification(
        hops_count, fallback_level, attempted_hops, trace_status
    )
    assert route_class == expected_route


# ============================================================================
# CONCERN B: PREFERENCE CLASSIFICATION ACROSS INCOMPLETE & CONFLICTING EVIDENCE
# ============================================================================

def test_preference_not_recorded_for_historical_records():
    # Historical records completely lack preferenceConfigured
    status = classify_preference_status(
        pref_conf=None,
        pref_id=None,
        pref_skip=None,
        pref_reason=None,
        hops=None,
    )
    assert status == "PREFERENCE_NOT_RECORDED"


def test_confirmed_no_preference():
    status = classify_preference_status(
        pref_conf=False,
        pref_id=None,
        pref_skip=False,
        pref_reason=None,
        hops=None,
    )
    assert status == "CONFIRMED_NO_PREFERENCE"


def test_confirmed_preferred_attempted():
    hops = [{"credential_id": "cred_target", "status": "SUCCESS"}]
    status = classify_preference_status(
        pref_conf=True,
        pref_id="cred_target",
        pref_skip=False,
        pref_reason=None,
        hops=hops,
    )
    assert status == "CONFIRMED_PREFERRED_ATTEMPTED"


def test_confirmed_preferred_skipped_with_and_without_reason():
    # With reason
    status1 = classify_preference_status(
        pref_conf=True,
        pref_id="cred_target",
        pref_skip=True,
        pref_reason="QUOTA_EXHAUSTED",
        hops=[{"credential_id": "cred_backup", "status": "SUCCESS"}],
    )
    assert status1 == "CONFIRMED_PREFERRED_SKIPPED_REASON"

    # Without reason
    status2 = classify_preference_status(
        pref_conf=True,
        pref_id="cred_target",
        pref_skip=True,
        pref_reason=None,
        hops=[{"credential_id": "cred_backup", "status": "SUCCESS"}],
    )
    assert status2 == "CONFIRMED_PREFERRED_SKIPPED_NO_REASON"


def test_preferred_first_hop_mismatch():
    # Pinned cred_target, but Hop 1 attempted cred_other without marked skip
    hops = [{"credential_id": "cred_other", "status": "FAILED"}]
    status = classify_preference_status(
        pref_conf=True,
        pref_id="cred_target",
        pref_skip=False,
        pref_reason=None,
        hops=hops,
    )
    assert status == "PREFERRED_FIRST_HOP_MISMATCH"


def test_preference_contradictory_evidence():
    # 1. Configured True, but preferredCredentialId is None or empty
    assert classify_preference_status(True, None, False, None, []) == "PREFERENCE_CONTRADICTORY_EVIDENCE"
    assert classify_preference_status(True, "   ", False, None, []) == "PREFERENCE_CONTRADICTORY_EVIDENCE"

    # 2. Configured False, but contains preferred ID
    assert classify_preference_status(False, "cred_1", False, None, []) == "PREFERENCE_CONTRADICTORY_EVIDENCE"

    # 3. Configured False, but marked skipped
    assert classify_preference_status(False, None, True, "REASON", []) == "PREFERENCE_CONTRADICTORY_EVIDENCE"

    # 4. Marked skipped, but Hop 1 actually attempted preferred key
    hops = [{"credential_id": "cred_target", "status": "FAILED"}]
    assert classify_preference_status(True, "cred_target", True, "QUOTA", hops) == "PREFERENCE_CONTRADICTORY_EVIDENCE"

    # 5. Invalid type for pref_conf
    assert classify_preference_status("true", "cred_target", False, None, []) == "PREFERENCE_CONTRADICTORY_EVIDENCE"


# ============================================================================
# CONCERN C: EXECUTION RESULT DECOUPLING & COMPOSITE OUTCOMES
# ============================================================================

def test_execution_result_independent_of_route():
    # Known success with missing route metadata
    res = classify_execution_result(success=True, hops=None)
    assert res == "SUCCESS"

    # Known failure with missing route metadata
    res_fail = classify_execution_result(success=False, hops=None)
    assert res_fail == "FAILURE"

    # Indeterminate when success is None or non-bool
    assert classify_execution_result(success=None, hops=[]) == "INDETERMINATE_RESULT"
    assert classify_execution_result(success="true", hops=[]) == "INDETERMINATE_RESULT"

    # Contradictory outcome
    contradictory_success = classify_execution_result(
        success=True,
        hops=[{"credential_id": "c1", "status": "FAILED"}],
    )
    assert contradictory_success == "CONTRADICTORY_RESULT"

    contradictory_fail = classify_execution_result(
        success=False,
        hops=[{"credential_id": "c1", "status": "SUCCESS"}],
    )
    assert contradictory_fail == "CONTRADICTORY_RESULT"


def test_composite_execution_outcomes():
    # Success with unknown route NEVER becomes DIRECT_SUCCESS
    assert derive_composite_execution_outcome("SUCCESS", "UNKNOWN_ROUTE") == "SUCCESS_UNKNOWN_ROUTE"
    assert derive_composite_execution_outcome("FAILURE", "UNKNOWN_ROUTE") == "FAILURE_UNKNOWN_ROUTE"

    # Confirmed direct and fallback
    assert derive_composite_execution_outcome("SUCCESS", "DIRECT_ROUTE") == "DIRECT_SUCCESS"
    assert derive_composite_execution_outcome("SUCCESS", "FALLBACK_ROUTE") == "FALLBACK_SUCCESS"
    assert derive_composite_execution_outcome("FAILURE", "DIRECT_ROUTE") == "DIRECT_FAILURE"
    assert derive_composite_execution_outcome("FAILURE", "FALLBACK_ROUTE") == "FALLBACK_FAILURE"

    # Indeterminate and contradictory
    assert derive_composite_execution_outcome("INDETERMINATE_RESULT", "DIRECT_ROUTE") == "INDETERMINATE_OUTCOME"
    assert derive_composite_execution_outcome("CONTRADICTORY_RESULT", "DIRECT_ROUTE") == "CONTRADICTORY_OUTCOME"
    assert derive_composite_execution_outcome("SUCCESS", "CONTRADICTORY_ROUTE") == "CONTRADICTORY_OUTCOME"


# ============================================================================
# CONCERN D: TASK NORMALIZATION & ALIASING
# ============================================================================

def test_task_key_normalization():
    assert normalize_task_key("resume_generation") == AITaskType.RESUME_TAILORING.value
    assert normalize_task_key("resume_tailoring") == AITaskType.RESUME_TAILORING.value
    assert normalize_task_key("cover_letter_generation") == AITaskType.COVER_LETTER_GEN.value
    assert normalize_task_key("cover_letter_gen") == AITaskType.COVER_LETTER_GEN.value
    assert normalize_task_key(AITaskType.JOB_ANALYSIS) == AITaskType.JOB_ANALYSIS.value

    # Aliases
    aliases = get_task_aliases("resume_generation")
    assert "resume_generation" in aliases
    assert "resume_tailoring" in aliases


# ============================================================================
# METRICS, STREAMING AGGREGATION & DENOMINATOR ISOLATION
# ============================================================================

def test_telemetry_repository_summary_aggregate():
    repo = AITelemetryRepository(in_memory=True)
    user_id = "test_user_metrics"

    # 1. Successful direct execution
    repo.record_execution(
        user_id=user_id,
        record={
            "executionId": "e1",
            "task": "resume_tailoring",
            "providerUsed": "gemini",
            "modelUsed": "gemini-2.5-flash",
            "credentialIdUsed": "c1",
            "success": True,
            "latencyMs": 200.0,
            "hopsCount": 1,
            "fallbackLevel": 0,
            "timestamp": "2026-10-06T10:00:00Z",
        },
    )

    # 2. Failed fallback execution
    repo.record_execution(
        user_id=user_id,
        record={
            "executionId": "e2",
            "task": "cover_letter_gen",
            "providerUsed": "openrouter",
            "modelUsed": "llama-3.3-70b",
            "credentialIdUsed": "c2",
            "success": False,
            "latencyMs": 400.0,
            "hopsCount": 2,
            "fallbackLevel": 1,
            "timestamp": "2026-10-06T10:05:00Z",
        },
    )

    # 3. Indeterminate execution (legacy record with unrecorded success)
    repo.record_execution(
        user_id=user_id,
        record={
            "executionId": "e3",
            "task": "resume_generation",  # Legacy alias for resume_tailoring
            "providerUsed": "gemini",
            "modelUsed": "gemini-2.5-flash",
            "credentialIdUsed": "c1",
            "success": None,
            "latencyMs": 0.0,  # Invalid latency; should be excluded from avg
            "hopsCount": 1,
            "timestamp": "2026-10-06T09:00:00Z",
        },
    )

    # Compute overall summary
    summary = repo.get_telemetry_summary_aggregate(user_id=user_id)
    assert summary["totalRequests"] == 3
    assert summary["successfulRequests"] == 1
    assert summary["failedRequests"] == 1
    assert summary["indeterminateRequests"] == 1

    # Denominator isolation: successRate = 1 / (1 + 1) = 50.0% (not 1 / 3)
    assert summary["successRate"] == 50.0

    # Latency exclusion: 0.0 excluded, avg = (200 + 400) / 2 = 300.0
    assert summary["averageLatencyMs"] == 300.0
    assert summary["fallbackCount"] == 1

    # Task distribution normalizes resume_generation to resume_tailoring
    assert summary["taskDistribution"]["resume_tailoring"] == 2
    assert summary["taskDistribution"]["cover_letter_gen"] == 1

    # Filter by task alias 'resume_tailoring' matches both e1 and e3
    task_summary = repo.get_telemetry_summary_aggregate(user_id=user_id, task="resume_tailoring")
    assert task_summary["totalRequests"] == 2
    assert task_summary["successfulRequests"] == 1
    assert task_summary["indeterminateRequests"] == 1

    # Case-insensitive provider filter matches e1 and e3
    prov_summary = repo.get_telemetry_summary_aggregate(user_id=user_id, provider="GEMINI")
    assert prov_summary["totalRequests"] == 2
    assert prov_summary["providerDistribution"]["gemini"] == 2


def test_empty_telemetry_summary():
    repo = AITelemetryRepository(in_memory=True)
    summary = repo.get_telemetry_summary_aggregate(user_id="empty_user")
    assert summary["totalRequests"] == 0
    assert summary["successfulRequests"] == 0
    assert summary["failedRequests"] == 0
    assert summary["indeterminateRequests"] == 0
    assert summary["successRate"] == 0.0
    assert summary["averageLatencyMs"] == 0.0
    assert summary["fallbackCount"] == 0


def test_ai_settings_service_mapping():
    service = AISettingsService()
    user_id = "test_user_service"

    # Historical record with missing preference fields and missing hops
    raw_doc = {
        "executionId": "hist_001",
        "task": "resume_generation",
        "providerUsed": "gemini",
        "modelUsed": "gemini-2.5-flash",
        "credentialIdUsed": "cred_123",
        "success": True,
        "latencyMs": 350.5,
        "hopsCount": 1,
        "fallbackLevel": 0,
        "timestamp": "2026-10-04T12:00:00Z",
    }

    dto = service._map_execution_record_to_dto(raw_doc, user_id)
    assert dto is not None
    assert dto.executionId == "hist_001"
    assert dto.task == AITaskType.RESUME_TAILORING
    assert dto.preferenceStatus == "PREFERENCE_NOT_RECORDED"
    assert dto.traceStatus == "TRACE_UNAVAILABLE"
    assert dto.routeClassification == "DIRECT_ROUTE"
    assert dto.executionOutcome == "DIRECT_SUCCESS"
    assert dto.attemptedHops is None  # Strictly preserves None when unrecorded
