"""Authoritative domain classification engine for AI telemetry.

Classifies telemetry records across four orthogonal dimensions:
1. Trace Status (RECORDED_DIRECT, RECORDED_MULTI_HOP, INCOMPLETE_MULTI_HOP, TRACE_UNAVAILABLE, CONTRADICTORY_TELEMETRY)
2. Routing Preference Evidence (CONFIRMED_PREFERRED_ATTEMPTED, CONFIRMED_PREFERRED_SKIPPED_REASON, etc.)
3. Execution Result (SUCCESS, FAILURE, INDETERMINATE_RESULT, CONTRADICTORY_RESULT)
4. Route Classification (DIRECT_ROUTE, FALLBACK_ROUTE, UNKNOWN_ROUTE, CONTRADICTORY_ROUTE)
and synthesizes a backward-compatible composite Execution Outcome.
"""

from typing import Any, TypeGuard


def is_valid_int(val: Any) -> TypeGuard[int]:
    """Returns True ONLY for true non-boolean integers.

    Python's bool subclasses int, so isinstance(True, int) is True.
    This validator explicitly excludes booleans.
    """
    return isinstance(val, int) and not isinstance(val, bool)


def is_valid_hop_entry(h: Any) -> bool:
    """Validates that an attempted hop entry is a well-formed dictionary with diagnostic metadata."""
    if not isinstance(h, dict):
        return False
    return bool(h.get("credential_id") or h.get("model") or h.get("provider") or h.get("status"))


def classify_trace_status(hops_count: Any, fallback_level: Any, attempted_hops: Any) -> str:
    """Classifies hop trace completeness and data integrity with deterministic precedence."""
    # 1. Hop List Structure Validation
    hops_list: list[dict] | None = None
    if attempted_hops is not None:
        if not isinstance(attempted_hops, list):
            return "CONTRADICTORY_TELEMETRY"
        for h in attempted_hops:
            if not is_valid_hop_entry(h):
                return "CONTRADICTORY_TELEMETRY"
        hops_list = attempted_hops

    len_hops = len(hops_list) if hops_list is not None else 0

    # 2. Strict Integer Validation
    h_count = hops_count if is_valid_int(hops_count) else None
    f_level = fallback_level if is_valid_int(fallback_level) else None

    # Check for invalid types where a value was provided but is invalid (e.g. bool, str, negative)
    if hops_count is not None:
        if not is_valid_int(hops_count) or hops_count < 0:
            return "CONTRADICTORY_TELEMETRY"
    if fallback_level is not None:
        if not is_valid_int(fallback_level) or fallback_level < 0:
            return "CONTRADICTORY_TELEMETRY"

    # 3. Contradictory Telemetry Checks
    # 3a. Hop list longer than claimed count
    if hops_list is not None and h_count is not None and len_hops > h_count:
        return "CONTRADICTORY_TELEMETRY"

    # 3b. Direct count (h_count == 1) but multiple hops recorded or fallback level > 0
    if h_count == 1 and (len_hops > 1 or (f_level is not None and f_level > 0)):
        return "CONTRADICTORY_TELEMETRY"

    # 3c. Direct attempt claimed (len_hops == 1, h_count == 1) but fallback claimed (f_level > 0)
    if len_hops == 1 and h_count == 1 and f_level is not None and f_level > 0:
        return "CONTRADICTORY_TELEMETRY"

    # 3d. Zero hops claimed but hop list is non-empty
    if h_count == 0 and len_hops > 0:
        return "CONTRADICTORY_TELEMETRY"

    # 4. Verified Complete Multi-Hop Trace (RECORDED_MULTI_HOP)
    if h_count is not None and h_count > 1 and hops_list is not None and len_hops == h_count:
        return "RECORDED_MULTI_HOP"

    # 5. Verified Complete Direct Trace (RECORDED_DIRECT)
    if h_count == 1 and hops_list is not None and len_hops == 1 and (f_level == 0 or f_level is None):
        return "RECORDED_DIRECT"

    # 6. Known Multi-Hop with Missing or Partial Detail (INCOMPLETE_MULTI_HOP)
    if h_count is not None and h_count > 1:
        return "INCOMPLETE_MULTI_HOP"
    if f_level is not None and f_level > 0:
        return "INCOMPLETE_MULTI_HOP"
    if len_hops > 1:
        return "INCOMPLETE_MULTI_HOP"

    # 7. Trace Unavailable / Unrecorded (TRACE_UNAVAILABLE)
    return "TRACE_UNAVAILABLE"


def classify_preference_status(
    pref_conf: Any,
    pref_id: Any,
    pref_skip: Any,
    pref_reason: Any,
    hops: Any,
) -> str:
    """Classifies routing preference evidence independently of execution outcome."""
    # 1. Historical / Missing Preference Metadata
    if pref_conf is None:
        return "PREFERENCE_NOT_RECORDED"

    # Strict type validation for pref_conf
    if not isinstance(pref_conf, bool):
        return "PREFERENCE_CONTRADICTORY_EVIDENCE"

    # 2. Explicitly Recorded Absence of Preference
    if pref_conf is False:
        # Contradiction: Explicitly unpinned, but contains credential ID or marked skipped
        if pref_id is not None or pref_skip is True:
            return "PREFERENCE_CONTRADICTORY_EVIDENCE"
        return "CONFIRMED_NO_PREFERENCE"

    # 3. Preference Configured (pref_conf is True)
    # Contradiction: Configured flag is True, but preferredCredentialId is missing or empty
    if not pref_id or not isinstance(pref_id, str) or not pref_id.strip():
        return "PREFERENCE_CONTRADICTORY_EVIDENCE"

    clean_id = pref_id.strip()

    # Route was marked skipped
    if pref_skip is True:
        # Contradiction: Route marked skipped, but Hop 1 actually attempted preferred key
        if isinstance(hops, list) and len(hops) > 0 and isinstance(hops[0], dict):
            if hops[0].get("credential_id") == clean_id:
                return "PREFERENCE_CONTRADICTORY_EVIDENCE"

        if pref_reason and isinstance(pref_reason, str) and pref_reason.strip():
            return "CONFIRMED_PREFERRED_SKIPPED_REASON"
        return "CONFIRMED_PREFERRED_SKIPPED_NO_REASON"

    # Route was NOT marked skipped (pref_skip is False or None)
    if pref_skip is False or pref_skip is None:
        # Hop trace missing or empty
        if not isinstance(hops, list) or len(hops) == 0:
            return "CONFIRMED_PREFERRED_UNVERIFIED"

        if not isinstance(hops[0], dict):
            return "CONFIRMED_PREFERRED_UNVERIFIED"

        first_hop_cred = hops[0].get("credential_id")
        if first_hop_cred == clean_id:
            return "CONFIRMED_PREFERRED_ATTEMPTED"
        return "PREFERRED_FIRST_HOP_MISMATCH"

    return "PREFERENCE_CONTRADICTORY_EVIDENCE"


def classify_execution_result(success: Any, hops: Any) -> str:
    """Classifies overall execution result (SUCCESS, FAILURE, INDETERMINATE_RESULT, CONTRADICTORY_RESULT)."""
    if success is None or not isinstance(success, bool):
        return "INDETERMINATE_RESULT"

    # Validate against final hop status if present
    if isinstance(hops, list) and len(hops) > 0 and isinstance(hops[-1], dict):
        final_status = hops[-1].get("status")
        if success is True and final_status == "FAILED":
            return "CONTRADICTORY_RESULT"
        if success is False and final_status == "SUCCESS":
            return "CONTRADICTORY_RESULT"

    return "SUCCESS" if success is True else "FAILURE"


def classify_route_classification(
    hops_count: Any,
    fallback_level: Any,
    hops: Any,
    trace_status: str,
) -> str:
    """Classifies route type (DIRECT_ROUTE, FALLBACK_ROUTE, UNKNOWN_ROUTE, CONTRADICTORY_ROUTE)."""
    if trace_status == "CONTRADICTORY_TELEMETRY":
        return "CONTRADICTORY_ROUTE"

    h_count = hops_count if (is_valid_int(hops_count) and hops_count >= 0) else None
    f_level = fallback_level if (is_valid_int(fallback_level) and fallback_level >= 0) else None
    len_hops = len(hops) if isinstance(hops, list) else 0

    # Confirmed fallback
    if (f_level is not None and f_level > 0) or (h_count is not None and h_count > 1) or len_hops > 1:
        return "FALLBACK_ROUTE"

    # Confirmed direct
    if h_count == 1 and (f_level == 0 or f_level is None) and (len_hops <= 1):
        return "DIRECT_ROUTE"

    # Route metadata absent or unrecorded
    if h_count is None and (f_level == 0 or f_level is None) and (len_hops == 0):
        return "UNKNOWN_ROUTE"

    return "UNKNOWN_ROUTE"


def derive_composite_execution_outcome(result: str, route: str) -> str:
    """Derives backward-compatible executionOutcome without fabricating direct route on unknown metadata."""
    if result == "INDETERMINATE_RESULT":
        return "INDETERMINATE_OUTCOME"
    if result == "CONTRADICTORY_RESULT" or route == "CONTRADICTORY_ROUTE":
        return "CONTRADICTORY_OUTCOME"

    if result == "SUCCESS":
        if route == "DIRECT_ROUTE":
            return "DIRECT_SUCCESS"
        if route == "FALLBACK_ROUTE":
            return "FALLBACK_SUCCESS"
        return "SUCCESS_UNKNOWN_ROUTE"

    if result == "FAILURE":
        if route == "DIRECT_ROUTE":
            return "DIRECT_FAILURE"
        if route == "FALLBACK_ROUTE":
            return "FALLBACK_FAILURE"
        return "FAILURE_UNKNOWN_ROUTE"

    return "INDETERMINATE_OUTCOME"
