"""Unit tests for Agent Reach Service Subprocess Reliability, Timeouts, and Error Handling.

Phase 1 Verification:
1. TC-02: Search subprocess timeouts and clean termination (kill + communicate pipe drain).
2. Missing executable handling (returns clean failure, no unhandled exception).
3. Non-zero exit code handling (handles upstream errors like UPSTREAM_BROKEN gracefully).
4. Differentiation between successful empty results (ok=True, items=[]) and failed searches (ok=False).
5. Malformed JSON handling.
6. Safe argument execution without shell injection.
"""

import asyncio
import json
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from app.services.agent_reach_service import (
    DEFAULT_READ_TIMEOUT_SECONDS,
    DEFAULT_SEARCH_TIMEOUT_SECONDS,
    AgentReachResult,
    AgentReachSearchResult,
    AgentReachService,
    sanitize_untrusted_web_content,
)


@pytest.fixture
def agent_reach_service():
    """Service instance with mocked or real CLI path."""
    svc = AgentReachService(cli_path="/mock/bin/agent-reach")
    with patch.object(svc, "_resolve_cli_path", return_value="/mock/bin/agent-reach"):
        yield svc


@pytest.mark.asyncio
async def test_search_web_successful_results(agent_reach_service):
    """Verify successful execution returns structured search results with items."""
    mock_payload = {
        "ok": True,
        "items": [
            {
                "title": "Scott McCamish - Recruiter",
                "url": "https://linkedin.com/in/scottmccamish",
                "snippet": "Talent Acquisition Specialist at Canonical",
                "author": "Scott",
            }
        ],
    }

    mock_process = AsyncMock()
    mock_process.returncode = 0
    mock_process.communicate.return_value = (
        json.dumps(mock_payload).encode("utf-8"),
        b"",
    )

    with patch("os.path.exists", return_value=True), patch("asyncio.create_subprocess_exec", return_value=mock_process) as mock_exec:
        result = await agent_reach_service.search_web("Canonical recruiter", limit=5)

        assert result.ok is True
        assert len(result.items) == 1
        assert result.items[0].title == "Scott McCamish - Recruiter"
        assert result.items[0].url == "https://linkedin.com/in/scottmccamish"
        assert result.source == "agent_reach_cli"
        assert result.error is None

        # Verify safe argument-based invocation
        mock_exec.assert_called_once()
        args = mock_exec.call_args[0]
        assert args[0] == "/mock/bin/agent-reach"
        assert args[1] == "web"
        assert args[2] == "search"
        assert args[3] == "Canonical recruiter"
        assert args[4] == "--limit"
        assert args[5] == "5"


@pytest.mark.asyncio
async def test_search_web_successful_empty_results(agent_reach_service):
    """Verify that a successful query returning 0 results returns ok=True and empty items list."""
    mock_payload = {
        "ok": True,
        "items": [],
    }

    mock_process = AsyncMock()
    mock_process.returncode = 0
    mock_process.communicate.return_value = (
        json.dumps(mock_payload).encode("utf-8"),
        b"",
    )

    with patch("asyncio.create_subprocess_exec", return_value=mock_process):
        result = await agent_reach_service.search_web("obscure company talent lead")

        # Crucial Phase 1 requirement: empty successful result != failed search
        assert result.ok is True
        assert result.items == []
        assert result.error is None
        assert result.source == "agent_reach_cli"


@pytest.mark.asyncio
async def test_search_web_non_zero_exit_upstream_broken(agent_reach_service):
    """Verify non-zero exit code (such as Exa UPSTREAM_BROKEN) returns ok=False without raising an exception."""
    mock_error_payload = {
        "schema_version": 1,
        "ok": False,
        "channel": "web",
        "action": "search",
        "error": {
            "code": "UPSTREAM_BROKEN",
            "message": "Exa returned no recognizable search results",
        },
    }

    mock_process = AsyncMock()
    mock_process.returncode = 1
    mock_process.communicate.return_value = (
        json.dumps(mock_error_payload).encode("utf-8"),
        b"Error: Exa provider failure\n",
    )

    with patch("asyncio.create_subprocess_exec", return_value=mock_process):
        result = await agent_reach_service.search_web("Canonical recruiting")

        assert result.ok is False
        assert result.items == []
        assert result.error is not None
        assert "UPSTREAM_BROKEN" in result.error or "Exa" in result.error
        assert result.source == "failed"


@pytest.mark.asyncio
async def test_search_web_subprocess_timeout_cleanup(agent_reach_service):
    """Verify TC-02: Subprocess exceeding timeout is killed and pipes are drained cleanly."""
    mock_process = MagicMock()
    mock_process.kill = MagicMock()
    # communicate raises TimeoutError first, then returns empty bytes on drain
    mock_process.communicate = AsyncMock(
        side_effect=[asyncio.TimeoutError(), (b"", b"")]
    )

    with patch("asyncio.create_subprocess_exec", return_value=mock_process):
        with patch("asyncio.wait_for", side_effect=asyncio.TimeoutError()):
            result = await agent_reach_service.search_web(
                "Cloudflare engineering manager", timeout=DEFAULT_SEARCH_TIMEOUT_SECONDS
            )

            assert result.ok is False
            assert result.items == []
            assert result.error is not None
            assert "timed out" in result.error
            assert result.source == "failed"

            # Verify subprocess termination and cleanup
            mock_process.kill.assert_called_once()
            assert mock_process.communicate.await_count >= 1


@pytest.mark.asyncio
async def test_search_web_missing_executable():
    """Verify service handles missing agent-reach CLI binary gracefully."""
    service = AgentReachService(cli_path=None)

    with patch("shutil.which", return_value=None):
        with patch("os.path.exists", return_value=False):
            result = await service.search_web("Any query")

            assert result.ok is False
            assert result.error is not None
            assert "executable not found" in result.error
            assert result.source == "failed"


@pytest.mark.asyncio
async def test_search_web_malformed_json_output(agent_reach_service):
    """Verify service handles corrupt / non-JSON CLI stdout without crashing."""
    mock_process = AsyncMock()
    mock_process.returncode = 0
    mock_process.communicate.return_value = (
        b"<html>Fatal 502 Bad Gateway from proxy</html>",
        b"",
    )

    with patch("asyncio.create_subprocess_exec", return_value=mock_process):
        result = await agent_reach_service.search_web("Google recruiters")

        assert result.ok is False
        assert result.items == []
        assert result.error is not None
        assert "unparseable JSON" in result.error
        assert result.source == "failed"


@pytest.mark.asyncio
async def test_search_web_query_sanitization(agent_reach_service):
    """Verify null bytes and control characters are stripped from query."""
    mock_process = AsyncMock()
    mock_process.returncode = 0
    mock_process.communicate.return_value = (
        b'{"ok": true, "items": []}',
        b"",
    )

    with patch("asyncio.create_subprocess_exec", return_value=mock_process) as mock_exec:
        await agent_reach_service.search_web("Canonical\x00 recruiter \t ")

        mock_exec.assert_called_once()
        query_arg = mock_exec.call_args[0][3]
        assert query_arg == "Canonical recruiter"
        assert "\x00" not in query_arg


@pytest.mark.asyncio
async def test_fetch_page_content_timeout_and_fallback(agent_reach_service):
    """Verify fetch_page_content terminates timed out CLI and falls back to Jina."""
    mock_process = MagicMock()
    mock_process.kill = MagicMock()
    mock_process.communicate = AsyncMock(
        side_effect=[asyncio.TimeoutError(), (b"", b"")]
    )

    # Mock CLI read timeout
    with patch("asyncio.create_subprocess_exec", return_value=mock_process):
        with patch("asyncio.wait_for", side_effect=asyncio.TimeoutError()):
            # Mock Jina HTTP fallback success
            with patch.object(
                agent_reach_service,
                "_fetch_via_jina_http",
                return_value=AgentReachResult(
                    ok=True,
                    url="https://canonical.com",
                    text="Fallback corporate text",
                    source="jina_direct_http",
                ),
            ):
                result = await agent_reach_service.fetch_page_content(
                    "https://canonical.com", timeout=DEFAULT_READ_TIMEOUT_SECONDS
                )

                assert result.ok is True
                assert result.text == "Fallback corporate text"
                assert result.source == "jina_direct_http"
                mock_process.kill.assert_called_once()
