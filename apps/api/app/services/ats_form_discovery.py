"""Deterministic ATS Form Discovery, Container Scoring & Application State Detection.

Guaranteed Invariants:
1. 100% Deterministic: Zero LLM / Zero External AI imports or calls.
2. Runtime Frame Safety: Handles child frames based on actual runtime accessibility.
3. Separation of Concerns:
   - Application State Detection: Determines if form exists, Apply CTA exists, or page is loading.
   - Form Root Discovery: Locates the exact frame & container hosting the application.
   - Form Readiness: Verifies minimum required fields are rendered and stable before autofill starts.
4. Human-in-the-Loop:
   - The engine NEVER clicks Submit automatically.
   - The engine NEVER clicks Next/Continue progression controls automatically.
   - Zero-field false success is strictly forbidden: 0 fields populated never reports READY_FOR_SUBMISSION.
"""

from __future__ import annotations
import asyncio
from dataclasses import dataclass, field
import logging
import re
from typing import Any, Literal
from playwright.async_api import Frame, Locator, Page

logger = logging.getLogger("jobFinder.services.form_discovery")

# Forbidden submission patterns (Hard defense-in-depth safety invariant)
FORBIDDEN_SUBMIT_PATTERN = re.compile(
    r"submit|complete\s+application|send\s+application|confirm\s+and\s+submit|file\s+application",
    re.IGNORECASE,
)

# Common non-terminal progression controls (Never clicked automatically)
NON_TERMINAL_PROGRESSION_PATTERN = re.compile(
    r"\b(next|continue|proceed|save\s+(and|&)\s+continue|review|continue\s+to\s+review|finish|next\s+step)\b",
    re.IGNORECASE,
)

# Core contact field attributes for identity scoring
CORE_CONTACT_PATTERNS = [
    re.compile(r"first[_\-]?name|given[_\-]?name", re.IGNORECASE),
    re.compile(r"last[_\-]?name|family[_\-]?name|surname", re.IGNORECASE),
    re.compile(r"email", re.IGNORECASE),
    re.compile(r"phone|tel|mobile", re.IGNORECASE),
    re.compile(r"city|location", re.IGNORECASE),
    re.compile(r"country", re.IGNORECASE),
    re.compile(r"resume|curriculum[_\-]?vitae", re.IGNORECASE),
    re.compile(r"linkedin", re.IGNORECASE),
]

# Exclusion / Anti-signal patterns for containers
SEARCH_CONTAINER_PATTERN = re.compile(r"search|lookup|filter", re.IGNORECASE)
COOKIE_CONTAINER_PATTERN = re.compile(r"onetrust|cookie|consent|banner", re.IGNORECASE)
NEWSLETTER_CONTAINER_PATTERN = re.compile(r"newsletter|subscribe|alert", re.IGNORECASE)

# High-intent Apply CTA patterns
HIGH_INTENT_APPLY_PATTERN = re.compile(
    r"^(apply\s+now|apply\s+for\s+this\s+job|apply\s+for\s+position|start\s+application|begin\s+application|apply\s+online|apply)$",
    re.IGNORECASE,
)
EXCLUDED_CTA_PATTERN = re.compile(
    r"save|share|sign\s+in|log\s+in|back\s+to|refer|print|newsletter|alert|filter|search",
    re.IGNORECASE,
)


class DiscoveryConfig:
    """Centralized, tunable heuristics for form discovery, scoring, and readiness."""
    # Confidence scoring weights
    WEIGHT_INPUT_DENSITY: int = 4            # Per interactable text/email/tel/select/textarea input (max 32)
    WEIGHT_CORE_CONTACT_MATCH: int = 15      # Per matched core field attribute
    WEIGHT_RESUME_UPLOAD_SIGNAL: int = 25    # Dedicated resume upload input or attach button
    WEIGHT_LABEL_SEMANTIC_MATCH: int = 8     # Labels matching core profile concepts
    BONUS_HTML_FORM_TAG: int = 10            # Container is a true <form> element

    # Negative penalties
    PENALTY_SEARCH_CONTAINER: int = -40      # Container has search input
    PENALTY_COOKIE_BANNER: int = -60         # Container belongs to cookie consent
    PENALTY_NEWSLETTER_SUBSCRIBE: int = -50  # Container is newsletter / alerts

    # Thresholds
    CONFIDENCE_THRESHOLD_MIN: int = 20       # Minimum score to qualify as candidate form root
    READINESS_MIN_CONTROLS: int = 2          # Minimum interactable controls required for readiness
    READINESS_TIMEOUT_SECONDS: float = 8.0   # Bounded observation timeout
    READINESS_POLL_INTERVAL_SEC: float = 0.3 # Polling interval for readiness


@dataclass
class FormRootContext:
    """Encapsulates the exact frame and container hosting the active application form."""
    frame: Frame
    container: Locator
    is_iframe: bool
    frame_selector: str | None = None
    frame_url: str = ""
    confidence_score: int = 0
    matched_signals: list[str] = field(default_factory=list)

    async def get_scoped_locator(self, selector: str) -> Locator:
        """Resolve a locator scoped to this form container or frame."""
        return self.container.locator(selector)


@dataclass
class ApplyCtaCandidate:
    """Represents an Apply CTA discovered on a job description page."""
    locator: Locator
    text: str
    is_button: bool
    href: str | None = None
    score: int = 0


@dataclass
class FormReadinessResult:
    """Result of form readiness evaluation."""
    is_ready: bool
    state: str  # 'ready', 'loading', 'incomplete', 'timeout'
    control_count: int
    matched_fields: list[str]
    is_terminal_step: bool | None = None  # True if terminal submit, False if multi-step, None if uncertain


class FormRootDetector:
    """Discovers and scores candidate form containers across main page and child frames."""

    @classmethod
    async def check_frame_queryable(cls, frame: Frame) -> tuple[bool, str]:
        """Safely test runtime queryability of a frame without assuming CORS state."""
        if frame.is_detached():
            return False, "detached"
        try:
            ready = await frame.evaluate("() => document.readyState")
            if ready:
                return True, "queryable"
        except Exception as ex:
            return False, f"inaccessible_or_sandboxed: {ex}"
        return False, "unknown"

    @classmethod
    async def score_container(cls, container: Locator, is_form_tag: bool = False) -> tuple[int, list[str]]:
        """Compute deterministic confidence score for a candidate container."""
        score = 0
        signals: list[str] = []

        # If the candidate container itself is hidden (e.g. display:none or hidden modal), it is not active
        try:
            is_vis = await container.is_visible()
            if not is_vis:
                return 0, ["hidden_container"]
        except Exception:
            pass

        if is_form_tag:
            score += DiscoveryConfig.BONUS_HTML_FORM_TAG
            signals.append("is_form_tag")

        # 1. Check for negative container attributes (cookie banner, newsletter, search)
        try:
            c_id = (await container.get_attribute("id") or "").lower()
            c_class = (await container.get_attribute("class") or "").lower()
            combined_attr = f"{c_id} {c_class}"

            if COOKIE_CONTAINER_PATTERN.search(combined_attr):
                score += DiscoveryConfig.PENALTY_COOKIE_BANNER
                signals.append("penalty_cookie_banner")
            if NEWSLETTER_CONTAINER_PATTERN.search(combined_attr):
                score += DiscoveryConfig.PENALTY_NEWSLETTER_SUBSCRIBE
                signals.append("penalty_newsletter")
        except Exception:
            pass

        # 2. Field Density (visible inputs)
        try:
            inputs = container.locator("input:not([type='hidden']), select, textarea")
            inp_count = await inputs.count()
            vis_count = 0
            for i in range(min(inp_count, 20)):
                if await inputs.nth(i).is_visible():
                    vis_count += 1

            if inp_count > 0 and vis_count == 0:
                # All inputs in this container are hidden
                return 0, ["all_inputs_hidden"]

            density_pts = min(vis_count * DiscoveryConfig.WEIGHT_INPUT_DENSITY, 32)
            if density_pts > 0:
                score += density_pts
                signals.append(f"field_density_{vis_count}")
        except Exception:
            inp_count = 0

        # 3. Core Contact Fields
        try:
            core_matches = 0
            for pat in CORE_CONTACT_PATTERNS:
                # Match input id, name, autocomplete, aria-label
                loc = container.locator(
                    f"input[name*='{pat.pattern}' i], input[id*='{pat.pattern}' i], "
                    f"input[autocomplete*='{pat.pattern}' i], input[aria-label*='{pat.pattern}' i]"
                )
                if await loc.count() > 0:
                    core_matches += 1
            if core_matches > 0:
                score += core_matches * DiscoveryConfig.WEIGHT_CORE_CONTACT_MATCH
                signals.append(f"core_contact_matches_{core_matches}")
        except Exception:
            pass

        # 4. Resume Upload Signal
        try:
            file_loc = container.locator("input[type='file'], button:has-text('Attach'), button:has-text('Upload Resume')")
            if await file_loc.count() > 0:
                score += DiscoveryConfig.WEIGHT_RESUME_UPLOAD_SIGNAL
                signals.append("resume_upload_control")
        except Exception:
            pass

        return score, signals

    @classmethod
    async def discover(cls, page: Page) -> tuple[FormRootContext | None, dict[str, Any]]:
        """Scan page and accessible child frames to discover the optimal FormRootContext."""
        telemetry: dict[str, Any] = {
            "totalFrames": len(page.frames),
            "accessibleFrames": 0,
            "inaccessibleFrames": 0,
            "candidateScores": [],
        }

        candidates: list[FormRootContext] = []

        # Enumerate main frame followed by child frames
        frames = [page.main_frame] + [f for f in page.frames if f != page.main_frame]

        for idx, frame in enumerate(frames):
            queryable, reason = await cls.check_frame_queryable(frame)
            if not queryable:
                telemetry["inaccessibleFrames"] += 1
                telemetry["candidateScores"].append({"frameIdx": idx, "status": reason})
                continue

            telemetry["accessibleFrames"] += 1
            is_child = frame != page.main_frame
            frame_url = frame.url or ""
            frame_name = frame.name or ""

            # Evaluate frame body as container
            try:
                body_loc = frame.locator("body")
                if await body_loc.count() > 0:
                    b_score, b_signals = await cls.score_container(body_loc, is_form_tag=False)
                    telemetry["candidateScores"].append({
                        "frameIdx": idx,
                        "isChild": is_child,
                        "frameName": frame_name,
                        "selector": "body",
                        "score": b_score,
                        "signals": b_signals,
                    })
                    if b_score >= DiscoveryConfig.CONFIDENCE_THRESHOLD_MIN:
                        # Determine stable frame selector if child frame
                        f_selector = None
                        if is_child:
                            if frame_name:
                                f_selector = f"iframe[name='{frame_name}'], iframe#{frame_name}"
                            else:
                                f_selector = f"iframe[src*='{frame_url[:40]}']" if frame_url else f"iframe >> nth={idx - 1}"

                        candidates.append(FormRootContext(
                            frame=frame,
                            container=body_loc,
                            is_iframe=is_child,
                            frame_selector=f_selector,
                            frame_url=frame_url,
                            confidence_score=b_score,
                            matched_signals=b_signals,
                        ))
            except Exception as e:
                logger.debug(f"Error inspecting body in frame {idx}: {e}")

            # Also check for explicit <form> or specific application container inside frame
            try:
                form_locs = frame.locator("form, div[id*='apply'], div[id*='grnhse'], div[class*='application']")
                form_cnt = await form_locs.count()
                for f_i in range(min(form_cnt, 5)):
                    sub_loc = form_locs.nth(f_i)
                    tag = await sub_loc.evaluate("el => el.tagName.toLowerCase()")
                    s_score, s_signals = await cls.score_container(sub_loc, is_form_tag=(tag == "form"))
                    if s_score >= DiscoveryConfig.CONFIDENCE_THRESHOLD_MIN:
                        f_selector = None
                        if is_child:
                            f_selector = f"iframe[name='{frame_name}'], iframe#{frame_name}" if frame_name else f"iframe >> nth={idx - 1}"
                        candidates.append(FormRootContext(
                            frame=frame,
                            container=sub_loc,
                            is_iframe=is_child,
                            frame_selector=f_selector,
                            frame_url=frame_url,
                            confidence_score=s_score,
                            matched_signals=s_signals,
                        ))
            except Exception as e:
                logger.debug(f"Error inspecting sub-forms in frame {idx}: {e}")

        if not candidates:
            return None, telemetry

        # Sort candidates descending by confidence score
        candidates.sort(key=lambda c: c.confidence_score, reverse=True)
        winner = candidates[0]
        telemetry["selectedScore"] = winner.confidence_score
        telemetry["selectedIsIframe"] = winner.is_iframe
        telemetry["selectedSignals"] = winner.matched_signals
        return winner, telemetry


class ApplyCtaDetector:
    """Discovers, scores, and disambiguates Apply CTAs on Job Description pages."""

    @classmethod
    async def detect(cls, page: Page) -> tuple[ApplyCtaCandidate | None, list[ApplyCtaCandidate], dict[str, Any]]:
        """Search for high-confidence application CTAs. Distinguishes single CTA vs ambiguous CTAs."""
        telemetry: dict[str, Any] = {"ctaCount": 0, "candidates": []}
        found_candidates: list[ApplyCtaCandidate] = []

        query = "button, a[role='button'], a[href], input[type='button']"
        locs = page.locator(query)
        count = await locs.count()

        for i in range(min(count, 40)):
            loc = locs.nth(i)
            try:
                is_vis = await loc.is_visible()
                if not is_vis:
                    continue

                text = (await loc.inner_text() or "").strip()
                if not text:
                    text = (await loc.get_attribute("aria-label") or "").strip()
                if not text:
                    continue

                # Hard exclusion: Never match submission controls or unwanted actions
                if FORBIDDEN_SUBMIT_PATTERN.search(text):
                    continue
                if EXCLUDED_CTA_PATTERN.search(text):
                    continue

                clean_text = re.sub(r"\s+", " ", text).strip()
                href = await loc.get_attribute("href")
                tag = await loc.evaluate("el => el.tagName.toLowerCase()")

                score = 0
                if HIGH_INTENT_APPLY_PATTERN.search(clean_text):
                    score += 90
                elif "apply" in clean_text.lower():
                    score += 70

                if href and ("apply" in href.lower() or "gh_jid=" in href.lower() or "#apply" in href.lower()):
                    score += 20

                if score >= 70:
                    cand = ApplyCtaCandidate(
                        locator=loc,
                        text=clean_text,
                        is_button=(tag in ("button", "input")),
                        href=href,
                        score=score,
                    )
                    found_candidates.append(cand)
                    telemetry["candidates"].append({"text": clean_text, "score": score, "href": href})
            except Exception:
                continue

        telemetry["ctaCount"] = len(found_candidates)

        if not found_candidates:
            return None, [], telemetry

        # Deduplicate candidates sharing identical text or href
        unique_cands: list[ApplyCtaCandidate] = []
        seen = set()
        for c in found_candidates:
            key = (c.text.lower(), c.href or "")
            if key not in seen:
                seen.add(key)
                unique_cands.append(c)

        if len(unique_cands) == 1:
            return unique_cands[0], unique_cands, telemetry

        # Multiple distinct CTAs detected (e.g. Apply with LinkedIn vs Apply on Company Site)
        unique_cands.sort(key=lambda c: c.score, reverse=True)
        return None, unique_cands, telemetry


class ApplicationStateDetector:
    """Orchestrates high-level application state detection, readiness, and terminal safety."""

    @classmethod
    async def evaluate_form_readiness(cls, context: FormRootContext) -> FormReadinessResult:
        """Verify that sufficient controls are rendered and determine step progression state."""
        try:
            inputs = context.container.locator("input:not([type='hidden']), select, textarea")
            control_count = await inputs.count()

            matched_fields: list[str] = []
            for pat in CORE_CONTACT_PATTERNS:
                loc = context.container.locator(
                    f"input[name*='{pat.pattern}' i], input[id*='{pat.pattern}' i], "
                    f"input[autocomplete*='{pat.pattern}' i]"
                )
                if await loc.count() > 0:
                    matched_fields.append(pat.pattern)

            # Check for non-terminal progression vs terminal submission controls
            buttons = context.container.locator("button, input[type='submit'], input[type='button'], a[role='button']")
            btn_count = await buttons.count()

            has_progression_control = False
            has_submit_control = False

            # Direct check for terminal submit controls
            submit_locators = context.container.locator(
                "input[type='submit'], button[type='submit'], [id*='submit' i], [name*='submit' i], button:has-text('Submit'), input[value*='Submit' i]"
            )
            submit_count = await submit_locators.count()
            for s_i in range(submit_count):
                s_el = submit_locators.nth(s_i)
                try:
                    s_text = (await s_el.get_attribute("value") or await s_el.inner_text() or "").strip()
                    s_id = (await s_el.get_attribute("id") or "").lower()
                    if FORBIDDEN_SUBMIT_PATTERN.search(s_text) or "submit" in s_text.lower() or "submit" in s_id:
                        has_submit_control = True
                        break
                except Exception:
                    continue

            for b_i in range(min(btn_count, 50)):
                btn = buttons.nth(b_i)
                try:
                    b_text = (await btn.inner_text() or "").strip()
                    if not b_text:
                        b_text = (await btn.get_attribute("aria-label") or "").strip()
                    if not b_text:
                        b_text = (await btn.get_attribute("value") or "").strip()
                    if not b_text:
                        continue

                    # Check for non-terminal progression vs terminal submission
                    if NON_TERMINAL_PROGRESSION_PATTERN.search(b_text):
                        has_progression_control = True
                    elif FORBIDDEN_SUBMIT_PATTERN.search(b_text) or "submit" in b_text.lower():
                        has_submit_control = True
                except Exception:
                    continue

            # Determine terminal step safety:
            # Rule: Only confident terminal if submit control exists AND no progression control exists.
            # Do NOT infer terminal solely because Next is absent.
            # If submit control is absent, or progression controls exist, prefer non-terminal (MULTI_STEP_FORM).
            if has_progression_control:
                is_terminal = False
            elif has_submit_control:
                is_terminal = True
            else:
                # Ambiguous: submit control was NOT found. Per safety rule, do NOT assume terminal!
                is_terminal = False

            is_ready = control_count >= DiscoveryConfig.READINESS_MIN_CONTROLS or len(matched_fields) >= 1
            state = "ready" if is_ready else "incomplete"

            return FormReadinessResult(
                is_ready=is_ready,
                state=state,
                control_count=control_count,
                matched_fields=matched_fields,
                is_terminal_step=is_terminal,
            )
        except Exception as ex:
            logger.debug(f"Readiness check failed: {ex}")
            return FormReadinessResult(
                is_ready=False,
                state="incomplete",
                control_count=0,
                matched_fields=[],
                is_terminal_step=False,
            )

    @classmethod
    async def wait_for_form_readiness(
        cls,
        page: Page,
        timeout_seconds: float = DiscoveryConfig.READINESS_TIMEOUT_SECONDS,
        poll_interval: float = DiscoveryConfig.READINESS_POLL_INTERVAL_SEC,
    ) -> tuple[FormRootContext | None, FormReadinessResult | None]:
        """Poll boundedly until form root is discovered and readiness criteria are satisfied."""
        start_time = asyncio.get_event_loop().time()
        best_context: FormRootContext | None = None
        best_readiness: FormReadinessResult | None = None

        while (asyncio.get_event_loop().time() - start_time) < timeout_seconds:
            context, _ = await FormRootDetector.discover(page)
            if context:
                best_context = context
                readiness = await cls.evaluate_form_readiness(context)
                best_readiness = readiness
                if readiness.is_ready:
                    # Fast path exit as soon as form is verified ready
                    return context, readiness

            await asyncio.sleep(poll_interval)

        return best_context, best_readiness
