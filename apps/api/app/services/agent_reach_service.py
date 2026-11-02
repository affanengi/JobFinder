"""Safe asynchronous subprocess wrapper and fallback handler for Agent Reach CLI."""

import asyncio
import json
import logging
import os
import re
import shutil
from dataclasses import dataclass, field
from html.parser import HTMLParser
from urllib.parse import urlparse

import httpx

logger = logging.getLogger("jobFinder.services.agent_reach")

DEFAULT_SEARCH_TIMEOUT_SECONDS = 6.0
DEFAULT_READ_TIMEOUT_SECONDS = 5.0
DEFAULT_HTTP_TIMEOUT_SECONDS = 5.0
DEFAULT_SUBPROCESS_TIMEOUT_SECONDS = 6.0
MAX_CONTENT_CHARS = 40000


@dataclass
class AgentReachResult:
    """Outcome of web content retrieval via Agent Reach or direct Jina fallback."""

    ok: bool
    url: str
    text: str = ""
    title: str | None = None
    source: str = "none"  # "agent_reach_cli" | "jina_direct_http" | "failed"
    error: str | None = None


@dataclass
class AgentReachSearchResultItem:
    """An individual search result item returned from Agent Reach web search."""

    title: str
    url: str
    snippet: str
    author: str | None = None
    published_at: str | None = None


@dataclass
class AgentReachSearchResult:
    """Outcome of web search via Agent Reach CLI."""

    ok: bool
    query: str
    items: list[AgentReachSearchResultItem] = field(default_factory=list)
    source: str = "none"  # "agent_reach_cli" | "failed"
    error: str | None = None


def sanitize_untrusted_web_content(raw_text: str) -> str:
    """Sanitize retrieved web text to neutralize adversarial prompt injection attempts."""
    if not raw_text:
        return ""

    # Truncate to maximum allowed context length
    text = raw_text[:MAX_CONTENT_CHARS]

    # Neutralize common indirect prompt injection payloads
    adversarial_patterns = [
        r"(?i)\bignore\s+(?:all\s+)?previous\s+instructions\b",
        r"(?i)\bsystem\s*:\s*you\s+are\s+now\b",
        r"(?i)\bdisregard\s+(?:all\s+)?prior\s+instructions\b",
        r"(?i)\boverride\s+system\s+prompt\b",
    ]
    for pattern in adversarial_patterns:
        text = re.sub(pattern, "[REDACTED_PROMPT_INJECTION_SIGNAL]", text)

    return text.strip()


class HTMLTextExtractor(HTMLParser):
    """Safe, fast HTML text extractor using Python standard library html.parser."""

    def __init__(self):
        super().__init__()
        self.texts: list[str] = []
        self.in_ignored = False

    def handle_starttag(self, tag: str, attrs):
        if tag.lower() in ("script", "style", "noscript", "svg"):
            self.in_ignored = True

    def handle_endtag(self, tag: str):
        if tag.lower() in ("script", "style", "noscript", "svg"):
            self.in_ignored = False

    def handle_data(self, data: str):
        if not self.in_ignored:
            cleaned = data.strip()
            if cleaned:
                self.texts.append(cleaned)


class AgentReachService:
    """Service providing bounded, non-blocking public web extraction via Agent Reach CLI, Jina fallback, and direct HTTP."""

    def __init__(self, cli_path: str | None = None):
        self._custom_cli_path = cli_path

    def _resolve_cli_path(self) -> str | None:
        """Locate the agent-reach executable in system PATH or standard user directories."""
        if self._custom_cli_path and os.path.exists(self._custom_cli_path):
            return self._custom_cli_path

        found = shutil.which("agent-reach")
        if found:
            return found

        standard_user_path = os.path.expanduser("~/.local/bin/agent-reach")
        if os.path.exists(standard_user_path) and os.access(standard_user_path, os.X_OK):
            return standard_user_path

        return None

    def is_search_available(self) -> bool:
        """Check whether the agent-reach CLI executable is present and executable."""
        return self._resolve_cli_path() is not None

    async def search_web(
        self,
        query: str,
        limit: int = 5,
        timeout: float = DEFAULT_SEARCH_TIMEOUT_SECONDS,
    ) -> AgentReachSearchResult:
        """Execute a web search via Agent Reach CLI and return structured results.
        
        Uses safe subprocess execution without a shell to prevent injection vulnerabilities.
        """
        clean_query = (query or "").replace("\x00", "").strip()
        if not clean_query:
            return AgentReachSearchResult(
                ok=False,
                query="",
                error="Search query cannot be empty.",
                source="failed",
            )

        cli_path = self._resolve_cli_path()
        if not cli_path:
            return AgentReachSearchResult(
                ok=False,
                query=clean_query,
                error="agent-reach CLI executable not found in PATH or ~/.local/bin",
                source="failed",
            )

        clamped_limit = max(1, min(limit, 10))

        try:
            logger.info(f"Executing Agent Reach web search: '{clean_query}' (limit={clamped_limit})")
            process = await asyncio.create_subprocess_exec(
                cli_path,
                "web",
                "search",
                clean_query,
                "--limit",
                str(clamped_limit),
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )

            try:
                stdout_bytes, stderr_bytes = await asyncio.wait_for(
                    process.communicate(), timeout=timeout
                )
            except TimeoutError:
                try:
                    process.kill()
                    await process.communicate()
                except Exception:
                    try:
                        await process.wait()
                    except Exception:
                        pass
                logger.warning(f"Agent Reach web search timed out after {timeout}s for query: {clean_query}")
                return AgentReachSearchResult(
                    ok=False,
                    query=clean_query,
                    error=f"agent-reach search timed out after {timeout}s",
                    source="failed",
                )

            stdout_str = stdout_bytes.decode("utf-8", errors="replace").strip()
            stderr_str = stderr_bytes.decode("utf-8", errors="replace").strip()

            if process.returncode != 0:
                error_msg = stderr_str or stdout_str or f"Process exited with code {process.returncode}"
                try:
                    data = json.loads(stdout_str)
                    if isinstance(data, dict) and data.get("error"):
                        err_obj = data["error"]
                        error_msg = err_obj.get("message") or err_obj.get("code") or error_msg
                except Exception:
                    pass
                logger.warning(f"Agent Reach search non-zero exit ({process.returncode}): {error_msg}")
                return AgentReachSearchResult(
                    ok=False,
                    query=clean_query,
                    error=f"CLI search failed: {error_msg}",
                    source="failed",
                )

            try:
                data = json.loads(stdout_str)
                if isinstance(data, dict):
                    # Check for explicit error response
                    if data.get("error"):
                        err_obj = data["error"]
                        msg = err_obj.get("message") if isinstance(err_obj, dict) else str(err_obj)
                        return AgentReachSearchResult(
                            ok=False,
                            query=clean_query,
                            error=f"CLI returned error: {msg}",
                            source="failed",
                        )

                    raw_items = data.get("items", [])
                    parsed_items: list[AgentReachSearchResultItem] = []
                    for item in raw_items:
                        if isinstance(item, dict):
                            title = str(item.get("title") or "").strip()
                            url = str(item.get("url") or "").strip()
                            text = str(item.get("text") or item.get("snippet") or "").strip()
                            if url:
                                parsed_items.append(
                                    AgentReachSearchResultItem(
                                        title=title,
                                        url=url,
                                        snippet=sanitize_untrusted_web_content(text),
                                        author=item.get("author"),
                                        published_at=item.get("published_at") or item.get("publishedAt"),
                                    )
                                )

                    return AgentReachSearchResult(
                        ok=True,
                        query=clean_query,
                        items=parsed_items,
                        source="agent_reach_cli",
                    )
            except json.JSONDecodeError as jde:
                logger.warning(f"Failed to parse Agent Reach search JSON output: {jde}")
                return AgentReachSearchResult(
                    ok=False,
                    query=clean_query,
                    error=f"Agent Reach CLI returned unparseable JSON: {str(jde)}",
                    source="failed",
                )

            return AgentReachSearchResult(
                ok=False,
                query=clean_query,
                error="agent-reach CLI returned empty or invalid payload structure",
                source="failed",
            )

        except Exception as e:
            logger.error(f"Unexpected exception during Agent Reach search: {e}", exc_info=True)
            return AgentReachSearchResult(
                ok=False,
                query=clean_query,
                error=f"Subprocess invocation exception: {str(e)}",
                source="failed",
            )

    @staticmethod
    def validate_url(url: str) -> bool:
        """Validate URL to ensure safe HTTP/HTTPS destination."""
        if not url or not isinstance(url, str):
            return False
        try:
            parsed = urlparse(url.strip())
            return parsed.scheme in ("http", "https") and bool(parsed.netloc)
        except Exception:
            return False

    async def fetch_page_content(
        self,
        url: str,
        timeout: float = DEFAULT_READ_TIMEOUT_SECONDS,
    ) -> AgentReachResult:
        """Retrieve clean markdown text from a target webpage using Agent Reach CLI or Jina fallback."""
        if not self.validate_url(url):
            return AgentReachResult(
                ok=False,
                url=url,
                error="Invalid or malformed URL. URL must start with http:// or https:// and include a valid domain.",
                source="failed",
            )

        clean_url = url.strip()

        # Step 1: Attempt Agent Reach CLI execution
        cli_result = await self._fetch_via_cli(clean_url, timeout=timeout)
        if cli_result.ok and cli_result.text:
            return cli_result

        logger.info(
            f"Agent Reach CLI unavailable or failed ({cli_result.error}). Attempting direct Jina Reader HTTP fallback for {clean_url}"
        )

        # Step 2: Attempt direct Jina Reader HTTP fallback
        jina_result = await self._fetch_via_jina_http(clean_url, timeout=DEFAULT_HTTP_TIMEOUT_SECONDS)
        if jina_result.ok and jina_result.text:
            return jina_result

        logger.info(
            f"Jina Reader fallback unavailable ({jina_result.error}). Attempting direct HTTP fallback for {clean_url}"
        )

        # Step 3: Attempt direct HTTP GET with browser headers fallback
        direct_result = await self._fetch_via_direct_http(clean_url, timeout=DEFAULT_HTTP_TIMEOUT_SECONDS)
        if direct_result.ok and direct_result.text:
            return direct_result

        # Step 4: All attempts failed; return structured failure
        combined_error = f"CLI: {cli_result.error or 'N/A'}; Jina: {jina_result.error or 'N/A'}; Direct: {direct_result.error or 'N/A'}"
        logger.warning(f"Public web extraction failed for {clean_url}: {combined_error}")
        return AgentReachResult(
            ok=False,
            url=clean_url,
            error=f"Could not retrieve webpage content. {combined_error}",
            source="failed",
        )

    async def _fetch_via_cli(self, url: str, timeout: float = DEFAULT_READ_TIMEOUT_SECONDS) -> AgentReachResult:
        """Execute agent-reach read command in a bounded subprocess."""
        cli_path = self._resolve_cli_path()
        if not cli_path:
            return AgentReachResult(
                ok=False,
                url=url,
                error="agent-reach CLI executable not found in PATH or ~/.local/bin",
                source="failed",
            )

        try:
            # Safe argument list without shell=True to prevent command injection
            process = await asyncio.create_subprocess_exec(
                cli_path,
                "read",
                url,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )

            try:
                stdout_bytes, stderr_bytes = await asyncio.wait_for(
                    process.communicate(), timeout=timeout
                )
            except TimeoutError:
                try:
                    process.kill()
                    await process.communicate()
                except Exception:
                    try:
                        await process.wait()
                    except Exception:
                        pass
                return AgentReachResult(
                    ok=False,
                    url=url,
                    error=f"agent-reach CLI timed out after {timeout}s",
                    source="failed",
                )

            stdout_str = stdout_bytes.decode("utf-8", errors="replace").strip()
            stderr_str = stderr_bytes.decode("utf-8", errors="replace").strip()

            if process.returncode != 0:
                # Attempt to parse structured error from JSON output if available
                error_msg = stderr_str or stdout_str or f"Process exited with code {process.returncode}"
                try:
                    data = json.loads(stdout_str)
                    if isinstance(data, dict) and data.get("error"):
                        err_obj = data["error"]
                        error_msg = err_obj.get("message") or err_obj.get("code") or error_msg
                except Exception:
                    pass
                return AgentReachResult(
                    ok=False,
                    url=url,
                    error=f"CLI execution failed: {error_msg}",
                    source="failed",
                )

            # Parse JSON output from Agent Reach
            try:
                data = json.loads(stdout_str)
                if isinstance(data, dict) and data.get("ok"):
                    items = data.get("items", [])
                    if items and isinstance(items[0], dict):
                        first_item = items[0]
                        text = sanitize_untrusted_web_content(first_item.get("text", ""))
                        title = first_item.get("title")
                        return AgentReachResult(
                            ok=True,
                            url=url,
                            text=text,
                            title=title,
                            source="agent_reach_cli",
                        )
            except json.JSONDecodeError:
                # If CLI returned raw markdown directly instead of JSON wrapper
                if stdout_str:
                    return AgentReachResult(
                        ok=True,
                        url=url,
                        text=sanitize_untrusted_web_content(stdout_str),
                        source="agent_reach_cli",
                    )

            return AgentReachResult(
                ok=False,
                url=url,
                error="agent-reach CLI returned empty or unparseable payload",
                source="failed",
            )

        except Exception as e:
            return AgentReachResult(
                ok=False,
                url=url,
                error=f"Subprocess invocation exception: {str(e)}",
                source="failed",
            )

    async def _fetch_via_jina_http(self, url: str, timeout: float) -> AgentReachResult:
        """Direct HTTPS fallback to Jina Reader (r.jina.ai) when CLI is unavailable."""
        jina_url = f"https://r.jina.ai/{url}"
        headers = {
            "User-Agent": "JobFinder-CompanyIntel/1.0",
            "X-No-Cache": "true",
            "Accept": "text/plain",
        }

        try:
            async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as client:
                response = await client.get(jina_url, headers=headers)
                if response.status_code == 200:
                    text = sanitize_untrusted_web_content(response.text)
                    if text:
                        return AgentReachResult(
                            ok=True,
                            url=url,
                            text=text,
                            source="jina_direct_http",
                        )
                    return AgentReachResult(
                        ok=False,
                        url=url,
                        error="Jina Reader returned empty body",
                        source="failed",
                    )
                return AgentReachResult(
                    ok=False,
                    url=url,
                    error=f"Jina Reader HTTP error: {response.status_code}",
                    source="failed",
                )
        except Exception as e:
            return AgentReachResult(
                ok=False,
                url=url,
                error=f"Jina Reader connection failed: {str(e)}",
                source="failed",
            )

    async def _fetch_via_direct_http(self, url: str, timeout: float) -> AgentReachResult:
        """Direct HTTPS fallback with browser User-Agent when CLI and proxy readers fail."""
        headers = {
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
            ),
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9",
        }
        try:
            async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as client:
                response = await client.get(url, headers=headers)
                if response.status_code == 200:
                    html_content = response.text
                    parser = HTMLTextExtractor()
                    parser.feed(html_content)
                    raw_text = " ".join(parser.texts)
                    clean_text = sanitize_untrusted_web_content(raw_text)
                    if clean_text:
                        return AgentReachResult(
                            ok=True,
                            url=str(response.url),
                            text=clean_text[:MAX_CONTENT_CHARS],
                            source="direct_http",
                        )
                    return AgentReachResult(
                        ok=False,
                        url=url,
                        error="Direct HTTP returned empty content body",
                        source="failed",
                    )
                return AgentReachResult(
                    ok=False,
                    url=url,
                    error=f"Direct HTTP returned status {response.status_code}",
                    source="failed",
                )
        except Exception as e:
            return AgentReachResult(
                ok=False,
                url=url,
                error=f"Direct HTTP connection failed: {str(e)}",
                source="failed",
            )


agent_reach_service = AgentReachService()
