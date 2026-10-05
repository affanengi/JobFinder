"""Tests for Playwright Autofill Engine Hardening:
- Session PID Registry in active_sessions.json
- Startup zombie process and stale temporary directory cleanup
- Inactivity watchdog triggering EXPIRED status
"""

import asyncio
import json
import os
import shutil
import tempfile
import pytest
from unittest.mock import patch, MagicMock

from app.schemas.autofill import AutofillStatusEnum, AutofillSessionDTO
from app.services.playwright_autofill_engine import (
    PlaywrightAutofillEngine,
    _get_descendant_pids,
)


@pytest.fixture
def temp_scratch(tmp_path):
    scratch = tmp_path / "scratch"
    scratch.mkdir()
    registry_file = scratch / "active_sessions.json"
    return str(registry_file)


def test_session_registry_and_unregistration(temp_scratch):
    engine = PlaywrightAutofillEngine(registry_file=temp_scratch)
    assert engine.cleanup_zombies_on_startup() == 0

    session_id = "sess-test-123"
    temp_dir = tempfile.mkdtemp(prefix="test_temp_")

    # Register session
    engine._register_session(session_id, "app-1", [999999], temp_dir)
    reg = engine._load_registry()
    assert session_id in reg
    assert reg[session_id]["applicationId"] == "app-1"
    assert reg[session_id]["pids"] == [999999]
    assert reg[session_id]["tempDir"] == temp_dir

    # Unregister session
    engine._unregister_session(session_id)
    reg_after = engine._load_registry()
    assert session_id not in reg_after

    if os.path.exists(temp_dir):
        os.rmdir(temp_dir)


def test_cleanup_zombies_on_startup(temp_scratch):
    engine = PlaywrightAutofillEngine(registry_file=temp_scratch)

    # Create dummy stale temp directory
    stale_temp = tempfile.mkdtemp(prefix="stale_test_dir_")
    assert os.path.exists(stale_temp)

    # Put a mock session into registry with dead PID and stale temp dir
    dead_pid = 999998
    engine._save_registry({
        "sess-zombie-1": {
            "sessionId": "sess-zombie-1",
            "applicationId": "app-zombie",
            "pids": [dead_pid],
            "tempDir": stale_temp,
        }
    })

    cleaned = engine.cleanup_zombies_on_startup()
    assert cleaned == 1
    assert not os.path.exists(stale_temp)
    assert engine._load_registry() == {}


@pytest.mark.asyncio
async def test_inactivity_watchdog_expires_session(temp_scratch):
    engine = PlaywrightAutofillEngine(registry_file=temp_scratch)
    engine.inactivity_timeout_seconds = 1  # 1 second for rapid test

    session_id = "sess-inactivity-test"
    mock_session = AutofillSessionDTO(
        sessionId=session_id,
        applicationId="app-timeout",
        userId="user-timeout",
        status=AutofillStatusEnum.READY_FOR_SUBMISSION,
        atsType="generic",
        portalUrl="https://example.com/apply",
        fieldsFilled=["first_name"],
        fieldsSkipped=[],
        fieldsRequiringReview=[],
    )
    engine._active_sessions[session_id] = mock_session

    events_received = []
    async def listen():
        async for ev in engine.subscribe_events(session_id):
            events_received.append(ev)
            if ev.status == AutofillStatusEnum.EXPIRED:
                break

    listen_task = asyncio.create_task(listen())

    # Trigger watchdog directly
    await engine._inactivity_watchdog(session_id, timeout_seconds=1)
    await asyncio.sleep(0.1)

    assert mock_session.status == AutofillStatusEnum.EXPIRED
    listen_task.cancel()
