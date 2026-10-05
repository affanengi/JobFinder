"""Phase 2 Deterministic Playwright Human-in-the-Loop Form Autofill Engine.

Guaranteed Invariants:
1. 100% Deterministic: Zero LLM / Zero External AI calls. Operates at $0 cost and 0 API quota.
2. No Submit Operation: The engine exposes NO submit method. Submission is strictly candidate-executed.
3. Verified Facts Only: Only allowlist fields from verified profile facts are populated.
4. Temporary File Safety: Per-session 0700 temporary directories cleaned up on all terminal states.
5. Local Desktop Execution: Launches headed Chromium directly on the candidate's active display.
"""

import asyncio
from datetime import datetime, timezone
import logging
import json
import os
import re
import signal
import shutil
import tempfile
from typing import Any, AsyncGenerator

from playwright.async_api import Browser, BrowserContext, Frame, Locator, Page, async_playwright

from app.schemas.application import ApplicationRecordDTO
from app.schemas.autofill import (
    BatchFillAnswerDTO,
    BatchFillResponse,
    DetectedFormFieldDTO,
    AutofillEventDTO,
    AutofillSessionDTO,
    AutofillStatusEnum,
    FieldSafetyCategory,
)
from app.schemas.profile import Profile
from app.services.reportlab_renderer import reportlab_renderer
from app.services.ats_form_discovery import (
    ApplicationStateDetector,
    ApplyCtaCandidate,
    ApplyCtaDetector,
    DiscoveryConfig,
    FormReadinessResult,
    FormRootContext,
    FormRootDetector,
)

logger = logging.getLogger("jobFinder.services.autofill")

HONORIFICS = {"mr", "mr.", "ms", "ms.", "mrs", "mrs.", "dr", "dr.", "prof", "prof."}
SUFFIXES = {"jr", "jr.", "sr", "sr.", "ii", "iii", "iv"}

SAFE_ALLOWLIST_KEYS = {
    "first_name",
    "last_name",
    "full_name",
    "email",
    "phone",
    "phone_raw",
    "phone_national",
    "phone_country_code",
    "phone_country_name",
    "street_address",
    "city",
    "state",
    "postal_code",
    "country",
    "preferred_first_name",
    "pronouns",
    "gender",
    "intended_work_location",
    "linkedin_url",
    "github_url",
    "portfolio_url",
    "education_school",
    "education_school_full",
    "education_degree",
    "education_discipline",
    "education_start_year",
    "education_end_year",
    *(f"education_{i}_school" for i in range(5)),
    *(f"education_{i}_degree" for i in range(5)),
    *(f"education_{i}_discipline" for i in range(5)),
    *(f"education_{i}_start_year" for i in range(5)),
    *(f"education_{i}_end_year" for i in range(5)),
    "experience_level",
    "years_of_experience",
}

INDIAN_METROS_MAP = {
    "bengaluru": "Bengaluru, India",
    "bangalore": "Bengaluru, India",
    "hyderabad": "Hyderabad, India",
    "chennai": "Chennai, India",
    "mumbai": "Mumbai, India",
    "pune": "Pune, India",
    "delhi": "Delhi, India",
    "gurgaon": "Gurugram, India",
    "gurugram": "Gurugram, India",
    "noida": "Noida, India",
    "kolkata": "Kolkata, India",
}


def resolve_intended_work_location(
    structured_job_location: str | None = None,
    structured_job_country: str | None = None,
    structured_is_remote: bool | None = None,
    application_location: str | None = None,
    portal_page_title: str | None = None,
    candidate_city: str | None = None,
    candidate_country: str | None = None,
) -> str | None:
    """Deterministically classify intended work location following priority hierarchy:
    1. Structured job location / country / remote metadata
    2. Structured application location
    3. Portal page title / primary role header
    Returns Indian city if Indian location, 'Remote' if foreign/remote, or candidate preferred location.
    """
    if structured_is_remote is True:
        return "Remote"

    candidates: list[str] = []
    if structured_job_location and structured_job_location.strip():
        candidates.append(structured_job_location.strip())
    if application_location and application_location.strip():
        candidates.append(application_location.strip())
    if portal_page_title and portal_page_title.strip():
        candidates.append(portal_page_title.strip())

    if not candidates and not structured_job_country:
        return None

    candidate_pref = None
    if candidate_city and candidate_city.strip():
        c_city = candidate_city.strip()
        c_country = candidate_country.strip() if candidate_country and candidate_country.strip() else ""
        candidate_pref = f"{c_city}, {c_country}" if c_country else c_city

    primary_text = candidates[0] if candidates else ""
    primary_lower = primary_text.lower()

    if any(r in primary_lower for r in ["remote", "work from home", "anywhere", "worldwide"]):
        return "Remote"

    if "/" in primary_text or " or " in primary_lower or "multiple" in primary_lower:
        has_india = "india" in primary_lower or any(c in primary_lower for c in INDIAN_METROS_MAP)
        has_foreign = any(w in primary_lower for w in ["us", "usa", "uk", "new york", "san francisco", "london", "singapore", "europe", "emea", "apac"])
        if has_india and has_foreign:
            return None
        if "multiple" in primary_lower or "various" in primary_lower:
            return None

    if structured_job_country:
        s_country = structured_job_country.strip().lower()
        if s_country == "india":
            for key, formatted in INDIAN_METROS_MAP.items():
                if re.search(rf"\b{key}\b", primary_lower):
                    return formatted
            return candidate_pref or "Remote"
        else:
            return "Remote"

    found_metro = None
    for key, formatted in INDIAN_METROS_MAP.items():
        if re.search(rf"\b{key}\b", primary_lower):
            if found_metro and found_metro != formatted:
                return None
            found_metro = formatted

    if found_metro:
        return found_metro

    if "india" in primary_lower:
        return candidate_pref or "Remote"

    foreign_indicators = [
        "san francisco", "new york", "london", "seattle", "austin", "chicago", "boston",
        "united states", "usa", "u.s.", "united kingdom", "uk", "canada", "germany",
        "singapore", "australia", "ireland", "france", "netherlands", "california", "texas"
    ]
    if any(re.search(rf"\b{re.escape(w)}\b", primary_lower) for w in foreign_indicators):
        return "Remote"

    return None



def extract_safe_profile_values(profile: Profile) -> dict[str, str]:
    """Extract facts adhering strictly to the safe allowlist, prioritizing user-managed AutofillProfile.

    Empty or missing optional values are omitted from the returned dictionary.
    No values are fabricated.
    """
    values: dict[str, str] = {}
    autofill = getattr(profile, "autofill", None)
    personal = getattr(profile, "personal", None)

    # 1. Names
    first_name = ""
    last_name = ""
    full_name = ""

    if autofill:
        first_name = (getattr(autofill, "firstName", None) or "").strip()
        last_name = (getattr(autofill, "lastName", None) or "").strip()
        full_name = (getattr(autofill, "fullName", None) or "").strip()

    if not first_name and personal:
        first_name = (getattr(personal, "firstName", None) or "").strip()
    if not last_name and personal:
        last_name = (getattr(personal, "lastName", None) or "").strip()
    if not full_name and personal:
        full_name = (getattr(personal, "fullName", None) or "").strip()

    if first_name:
        values["first_name"] = first_name
        values["preferred_first_name"] = first_name
    if last_name:
        values["last_name"] = last_name

    if full_name:
        values["full_name"] = full_name
        # Tokenize full name into first and last name if not explicitly set
        if "first_name" not in values or "last_name" not in values:
            tokens = [t for t in full_name.split() if t]
            clean_tokens = [t for t in tokens if t.lower() not in HONORIFICS and t.lower() not in SUFFIXES]
            if len(clean_tokens) >= 2:
                values.setdefault("first_name", clean_tokens[0])
                values.setdefault("preferred_first_name", clean_tokens[0])
                values.setdefault("last_name", " ".join(clean_tokens[1:]))
            elif len(clean_tokens) == 1:
                values.setdefault("first_name", clean_tokens[0])
                values.setdefault("preferred_first_name", clean_tokens[0])
                values.setdefault("last_name", "")

    # 2. Email
    raw_email = ""
    if autofill and getattr(autofill, "email", None):
        raw_email = autofill.email.strip()
    elif personal and getattr(personal, "email", None):
        raw_email = personal.email.strip()
    if raw_email:
        values["email"] = raw_email

    # 3. Phone (with smart parsing)
    raw_phone = ""
    if autofill and getattr(autofill, "phone", None):
        raw_phone = autofill.phone.strip()
    elif personal and getattr(personal, "phone", None):
        raw_phone = personal.phone.strip()

    if raw_phone:
        raw_phone = raw_phone.strip()
        values["phone_raw"] = raw_phone
        digits = re.sub(r"\D", "", raw_phone)
        if raw_phone.startswith("+91") or (digits.startswith("91") and len(digits) >= 12):
            national = digits[-10:] if len(digits) >= 10 else re.sub(r"^\+?91[\s\-]?", "", raw_phone).strip()
            clean_national = re.sub(r"^0+", "", national).strip()
            values["phone"] = clean_national
            values["phone_national"] = clean_national
            values["phone_country_code"] = "+91"
            values["phone_country_name"] = "India"
        elif raw_phone.startswith("+1") or (digits.startswith("1") and len(digits) == 11):
            national = digits[-10:]
            values["phone"] = national
            values["phone_national"] = national
            values["phone_country_code"] = "+1"
            values["phone_country_name"] = "United States"
        elif raw_phone.startswith("+"):
            m = re.match(r"^\+(\d{1,4})[\s\-]?(.*)$", raw_phone)
            if m:
                values["phone_country_code"] = f"+{m.group(1)}"
                clean_nat = re.sub(r"^\+\d{1,4}[\s\-]?", "", raw_phone).strip()
                values["phone_national"] = clean_nat
                values["phone"] = clean_nat
            else:
                values["phone"] = raw_phone
                values["phone_national"] = raw_phone
        else:
            values["phone"] = raw_phone
            values["phone_national"] = raw_phone

    # 4. Address fields
    if autofill and getattr(autofill, "streetAddress", None) and autofill.streetAddress.strip():
        values["street_address"] = autofill.streetAddress.strip()

    raw_city = ""
    if autofill and getattr(autofill, "city", None):
        raw_city = autofill.city.strip()
    elif personal and getattr(personal, "city", None):
        raw_city = personal.city.strip()
    if raw_city:
        values["city"] = raw_city

    if autofill and getattr(autofill, "state", None) and autofill.state.strip():
        values["state"] = autofill.state.strip()

    if autofill and getattr(autofill, "postalCode", None) and autofill.postalCode.strip():
        values["postal_code"] = autofill.postalCode.strip()

    raw_country = ""
    if autofill and getattr(autofill, "country", None):
        raw_country = autofill.country.strip()
    elif personal and getattr(personal, "country", None):
        raw_country = personal.country.strip()
    if raw_country:
        values["country"] = raw_country

    # 5. Demographics (Gender, Pronouns) - User-managed, omitted if empty
    if autofill and getattr(autofill, "gender", None) and autofill.gender.strip():
        values["gender"] = autofill.gender.strip()

    if autofill and getattr(autofill, "pronouns", None) and autofill.pronouns.strip():
        values["pronouns"] = autofill.pronouns.strip()

    # 6. Links
    raw_linkedin = ""
    if autofill and getattr(autofill, "linkedinUrl", None):
        raw_linkedin = autofill.linkedinUrl.strip()
    elif personal and getattr(personal, "links", None) and getattr(personal.links, "linkedin", None):
        raw_linkedin = personal.links.linkedin.strip()
    if raw_linkedin:
        values["linkedin_url"] = raw_linkedin

    raw_github = ""
    if autofill and getattr(autofill, "githubUrl", None):
        raw_github = autofill.githubUrl.strip()
    elif personal and getattr(personal, "links", None) and getattr(personal.links, "github", None):
        raw_github = personal.links.github.strip()
    if raw_github:
        values["github_url"] = raw_github

    raw_portfolio = ""
    if autofill and getattr(autofill, "portfolioUrl", None):
        raw_portfolio = autofill.portfolioUrl.strip()
    elif personal and getattr(personal, "links", None) and getattr(personal.links, "portfolio", None):
        raw_portfolio = personal.links.portfolio.strip()
    if raw_portfolio:
        values["portfolio_url"] = raw_portfolio

    # 7. Extract education details (prefer user autofill configuration, fallback to profile.education)
    edus = getattr(profile, "education", [])
    autofill_edus = getattr(autofill, "educations", []) if autofill else []
    first_autofill_edu = autofill_edus[0] if autofill_edus else None

    # Primary School
    school_val = ""
    if first_autofill_edu and getattr(first_autofill_edu, "school", None):
        school_val = first_autofill_edu.school.strip()
    elif autofill and getattr(autofill, "school", None):
        school_val = autofill.school.strip()
    elif edus:
        inst = getattr(edus[0], "institution", "") or ""
        clean_inst = re.sub(r"\s*\([^)]*\)", "", inst).strip()
        school_val = clean_inst or inst
    if school_val:
        values["education_school"] = school_val
        values["education_school_full"] = school_val

    # Primary Degree
    deg_val = ""
    if first_autofill_edu and getattr(first_autofill_edu, "degree", None):
        deg_val = first_autofill_edu.degree.strip()
    elif autofill and getattr(autofill, "degree", None):
        deg_val = autofill.degree.strip()
    elif edus:
        deg_val = getattr(edus[0], "degree", "") or ""
    if deg_val:
        values["education_degree"] = deg_val

    # Primary Discipline
    field_val = ""
    if first_autofill_edu and getattr(first_autofill_edu, "discipline", None):
        field_val = first_autofill_edu.discipline.strip()
    elif autofill and getattr(autofill, "discipline", None):
        field_val = autofill.discipline.strip()
    elif edus:
        field_val = getattr(edus[0], "field", "") or ""
    if field_val:
        values["education_discipline"] = field_val

    # Primary Start Date Year & End Date Year
    start_yr = ""
    if first_autofill_edu and getattr(first_autofill_edu, "startYear", None):
        start_yr = str(first_autofill_edu.startYear).strip()
    elif autofill and getattr(autofill, "startYear", None):
        start_yr = str(autofill.startYear).strip()
    elif edus and getattr(edus[0], "startDate", None):
        start_yr = str(edus[0].startDate).strip()
    if start_yr:
        values["education_start_year"] = start_yr

    end_yr = ""
    if first_autofill_edu and getattr(first_autofill_edu, "endYear", None):
        end_yr = str(first_autofill_edu.endYear).strip()
    elif autofill and getattr(autofill, "endYear", None):
        end_yr = str(autofill.endYear).strip()
    elif edus and getattr(edus[0], "endDate", None):
        end_yr = str(edus[0].endDate).strip()
    if end_yr:
        values["education_end_year"] = end_yr

    # Map indexed entries for multi-education candidate credentials
    if autofill_edus:
        for i, a_edu in enumerate(autofill_edus[:5]):
            if getattr(a_edu, "school", None):
                values[f"education_{i}_school"] = a_edu.school.strip()
            if getattr(a_edu, "degree", None):
                values[f"education_{i}_degree"] = a_edu.degree.strip()
            if getattr(a_edu, "discipline", None):
                values[f"education_{i}_discipline"] = a_edu.discipline.strip()
            if getattr(a_edu, "startYear", None):
                values[f"education_{i}_start_year"] = str(a_edu.startYear).strip()
            if getattr(a_edu, "endYear", None):
                values[f"education_{i}_end_year"] = str(a_edu.endYear).strip()
    elif edus:
        for i, m_edu in enumerate(edus[:5]):
            inst_i = getattr(m_edu, "institution", "") or ""
            clean_i = re.sub(r"\s*\([^)]*\)", "", inst_i).strip()
            if clean_i or inst_i:
                values[f"education_{i}_school"] = clean_i or inst_i
            if getattr(m_edu, "degree", None):
                values[f"education_{i}_degree"] = str(m_edu.degree).strip()
            if getattr(m_edu, "field", None):
                values[f"education_{i}_discipline"] = str(m_edu.field).strip()
            if getattr(m_edu, "startDate", None):
                values[f"education_{i}_start_year"] = str(m_edu.startDate).strip()
            if getattr(m_edu, "endDate", None):
                values[f"education_{i}_end_year"] = str(m_edu.endDate).strip()

    # 8. Experience Level & Numeric Years of Experience
    exp_lvl = ""
    if autofill and getattr(autofill, "experienceLevel", None):
        exp_lvl = str(autofill.experienceLevel).strip()
    if exp_lvl:
        values["experience_level"] = exp_lvl

    years_exp = None
    if autofill and getattr(autofill, "yearsOfExperience", None) is not None:
        years_exp = float(autofill.yearsOfExperience)
    elif exp_lvl == "fresher":
        years_exp = 0.0
    if years_exp is not None:
        values["years_of_experience"] = str(years_exp)

    return values



def _get_descendant_pids(parent_pid: int) -> list[int]:
    """Retrieve child and descendant OS PIDs using Linux /proc filesystem."""
    descendants: list[int] = []
    to_visit = [parent_pid]
    visited = set()
    while to_visit:
        curr = to_visit.pop()
        if curr in visited:
            continue
        visited.add(curr)
        task_children_path = f"/proc/{curr}/task/{curr}/children"
        if os.path.exists(task_children_path):
            try:
                with open(task_children_path) as f:
                    children = [int(p) for p in f.read().split() if p.isdigit()]
                    for child in children:
                        descendants.append(child)
                        to_visit.append(child)
            except Exception:
                pass
    return descendants


async def fill_experience_questions(
    target: Page | Frame | Locator,
    page: Page,
    safe_facts: dict[str, str],
    filled: list[str],
) -> None:
    """Deterministically answer experience threshold questions (e.g. 'Do you have more than 5 years of experience?')."""
    try:
        years_str = safe_facts.get("years_of_experience")
        years_exp = float(years_str) if years_str is not None else 0.0

        exp_labels = target.locator(
            "label:has-text('experience'), label:has-text('Experience'), "
            ".select__label:has-text('experience'), .field__label:has-text('experience')"
        )
        exp_count = await exp_labels.count()
        for e_i in range(exp_count):
            lbl = exp_labels.nth(e_i)
            raw_text = (await lbl.inner_text() or "").strip()
            raw_clean = re.sub(r"[\*\:]+$", "", raw_text).strip()
            lower_q = raw_clean.lower()

            # Match threshold questions: "more than X years", "over X years", "at least X years", "X+ years"
            thresh_m = re.search(r"(?:more than|over|\>)\s*(\d+(?:\.\d+)?)\s*(?:\+)?\s*(?:years?|yrs?)", lower_q)
            is_at_least = False
            if not thresh_m:
                thresh_m = re.search(r"(?:at least|\>\=|\+)\s*(\d+(?:\.\d+)?)\s*(?:\+)?\s*(?:years?|yrs?)", lower_q)
                if thresh_m:
                    is_at_least = True
            if not thresh_m:
                thresh_m = re.search(r"(\d+(?:\.\d+)?)\s*\+\s*(?:years?|yrs?)", lower_q)
                if thresh_m:
                    is_at_least = True

            if thresh_m:
                thresh = float(thresh_m.group(1))
                ans_bool = (years_exp >= thresh) if is_at_least else (years_exp > thresh)
                target_ans = "Yes" if ans_bool else "No"

                # Locate associated control
                for_id = await lbl.get_attribute("for")
                control = None
                if for_id:
                    c_loc = target.locator(f"#{for_id}")
                    if await c_loc.count() > 0:
                        control = c_loc.first
                if not control:
                    parent = lbl.locator("xpath=..")
                    c_loc = parent.locator("select, input, [role='combobox'], [role='listbox'], .select")
                    if await c_loc.count() > 0:
                        control = c_loc.first

                if control:
                    tag = (await control.evaluate("el => el.tagName")).lower()
                    if tag == "select":
                        # Native select
                        opts = control.locator("option")
                        opt_cnt = await opts.count()
                        chosen_val = None
                        for o_idx in range(opt_cnt):
                            o_txt = (await opts.nth(o_idx).inner_text()).strip().lower()
                            if o_txt.startswith(target_ans.lower()):
                                chosen_val = await opts.nth(o_idx).get_attribute("value")
                                break
                        if chosen_val is not None:
                            await control.select_option(value=chosen_val)
                            filled.append("years_of_experience")
                            logger.info(f"Answered experience threshold question '{raw_clean}': {target_ans}")
                    else:
                        # React-select or custom combobox
                        try:
                            await control.scroll_into_view_if_needed(timeout=2000)
                            await control.click()
                            await page.wait_for_timeout(400)
                            menu_opts = target.locator("div[id*='-option-'], div[class*='-option'], div[role='option'], .select__option")
                            if await menu_opts.count() == 0 and page != target:
                                menu_opts = page.locator("div[id*='-option-'], div[class*='-option'], div[role='option'], .select__option")
                            m_cnt = await menu_opts.count()
                            matched_opt = None
                            for m_i in range(m_cnt):
                                m_txt = (await menu_opts.nth(m_i).inner_text()).strip().lower()
                                if m_txt.startswith(target_ans.lower()):
                                    matched_opt = menu_opts.nth(m_i)
                                    break
                            if matched_opt:
                                await matched_opt.dispatch_event("mousedown")
                                await matched_opt.click(force=True)
                                filled.append("years_of_experience")
                                logger.info(f"Selected option for experience threshold question '{raw_clean}': {target_ans}")
                            else:
                                await page.keyboard.press("Control+A")
                                await page.keyboard.press("Backspace")
                                await page.keyboard.type(target_ans, delay=30)
                                await page.wait_for_timeout(200)
                                await page.keyboard.press("Enter")
                                filled.append("years_of_experience")
                                logger.info(f"Typed answer for experience threshold question '{raw_clean}': {target_ans}")
                            await page.keyboard.press("Escape")
                            await page.wait_for_timeout(200)
                        except Exception as ex:
                            logger.debug(f"Could not fill experience dropdown: {ex}")
    except Exception as ex:
        logger.debug(f"Note during experience questions evaluation: {ex}")


class PlaywrightAutofillEngine:
    """Manages headed desktop browser sessions, deterministic ATS adapters, and human-in-the-loop checkpoints."""

    def __init__(self, registry_file: str | None = None):
        self._active_sessions: dict[str, AutofillSessionDTO] = {}
        self._session_locks: dict[str, asyncio.Lock] = {}
        self._event_queues: dict[str, list[asyncio.Queue]] = {}
        self._browser_contexts: dict[str, dict[str, Any]] = {}
        self._session_tasks: dict[str, asyncio.Task] = {}
        self._temp_dirs: dict[str, str] = {}
        self._session_custom_fields: dict[str, dict[str, DetectedFormFieldDTO]] = {}
        self._session_form_contexts: dict[str, FormRootContext] = {}
        self._inactivity_tasks: dict[str, asyncio.Task] = {}
        self.headless_override: bool | None = None  # Used for testing/CI
        self.inactivity_timeout_seconds: int = 1800  # 30-minute inactivity limit

        # Registry persistence
        if registry_file:
            self._registry_path = registry_file
        else:
            scratch_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..", "scratch"))
            os.makedirs(scratch_dir, exist_ok=True)
            self._registry_path = os.path.join(scratch_dir, "active_sessions.json")

        try:
            self.cleanup_zombies_on_startup()
        except Exception as e:
            logger.debug(f"Initial zombie cleanup handled: {e}")

    def _load_registry(self) -> dict[str, Any]:
        if os.path.exists(self._registry_path):
            try:
                with open(self._registry_path, "r") as f:
                    return json.load(f)
            except Exception:
                return {}
        return {}

    def _save_registry(self, data: dict[str, Any]):
        try:
            with open(self._registry_path, "w") as f:
                json.dump(data, f, indent=2)
        except Exception as e:
            logger.debug(f"Failed writing session registry: {e}")

    def _register_session(self, session_id: str, app_id: str, pids: list[int], temp_dir: str):
        try:
            reg = self._load_registry()
            reg[session_id] = {
                "sessionId": session_id,
                "applicationId": app_id,
                "pids": pids,
                "tempDir": temp_dir,
                "registeredAt": datetime.now(timezone.utc).isoformat(),
            }
            self._save_registry(reg)
        except Exception as e:
            logger.warning(f"Failed to write session {session_id} to registry: {e}")

    def _unregister_session(self, session_id: str):
        try:
            reg = self._load_registry()
            if session_id in reg:
                del reg[session_id]
                self._save_registry(reg)
        except Exception as e:
            logger.debug(f"Failed to unregister session {session_id}: {e}")

    def cleanup_zombies_on_startup(self) -> int:
        """Scan active_sessions.json on startup, kill orphaned PIDs, delete stale temp directories."""
        cleaned_count = 0
        registry = self._load_registry()
        if not registry:
            return 0

        for session_id, data in list(registry.items()):
            pids = data.get("pids", [])
            temp_dir = data.get("tempDir")

            for pid in pids:
                if isinstance(pid, int) and os.path.exists(f"/proc/{pid}"):
                    try:
                        os.kill(pid, signal.SIGTERM)
                        logger.info(f"Terminated orphaned PID {pid} for session {session_id}")
                    except Exception:
                        try:
                            os.kill(pid, signal.SIGKILL)
                        except Exception:
                            pass

            if temp_dir and os.path.exists(temp_dir):
                try:
                    shutil.rmtree(temp_dir, ignore_errors=True)
                    logger.info(f"Purged stale temp dir {temp_dir} for session {session_id}")
                except Exception as e:
                    logger.debug(f"Could not delete stale temp dir {temp_dir}: {e}")

            cleaned_count += 1

        self._save_registry({})
        return cleaned_count

    async def _inactivity_watchdog(self, session_id: str, timeout_seconds: int):
        """Monitors session at READY_FOR_SUBMISSION and expires it if inactive for timeout_seconds."""
        try:
            await asyncio.sleep(timeout_seconds)
            session = self._active_sessions.get(session_id)
            if session and session.status == AutofillStatusEnum.READY_FOR_SUBMISSION:
                logger.info(f"Session {session_id} reached {timeout_seconds}s inactivity limit. Expiring.")
                await self.broadcast_event(
                    session_id,
                    AutofillEventDTO(
                        sessionId=session_id,
                        status=AutofillStatusEnum.EXPIRED,
                        atsType=session.atsType,
                        step="expired",
                        message=f"Session automatically closed after {timeout_seconds // 60} minutes of inactivity.",
                    ),
                )
                await self.cleanup_session(session_id)
        except asyncio.CancelledError:
            pass

    def get_session(self, session_id: str) -> AutofillSessionDTO | None:
        return self._active_sessions.get(session_id)

    def get_active_session_for_app(self, app_id: str) -> AutofillSessionDTO | None:
        for s in self._active_sessions.values():
            if s.applicationId == app_id and s.status not in (
                AutofillStatusEnum.COMPLETED,
                AutofillStatusEnum.CANCELLED,
                AutofillStatusEnum.BROWSER_CLOSED,
                AutofillStatusEnum.EXPIRED,
                AutofillStatusEnum.FAILED,
            ):
                return s
        return None

    async def broadcast_event(self, session_id: str, event: AutofillEventDTO):
        """Send live SSE events to connected subscribers."""
        session = self._active_sessions.get(session_id)
        if session:
            session.lastActivityAt = datetime.now(timezone.utc).isoformat()
            session.status = event.status
            session.fieldsFilled = list(dict.fromkeys(session.fieldsFilled + event.fieldsFilled))
            session.fieldsSkipped = list(dict.fromkeys(session.fieldsSkipped + event.fieldsSkipped))
            session.fieldsRequiringReview = list(dict.fromkeys(session.fieldsRequiringReview + event.fieldsRequiringReview))
            if event.detectedCustomQuestions:
                session.detectedCustomQuestions = event.detectedCustomQuestions
            if event.resumeAttached:
                session.resumeAttached = True
            if event.captchaDetected:
                session.captchaDetected = True

        queues = self._event_queues.get(session_id, [])
        for q in list(queues):
            try:
                await q.put(event)
            except Exception as e:
                logger.debug(f"Queue delivery failure: {e}")

    async def subscribe_events(self, session_id: str) -> AsyncGenerator[AutofillEventDTO, None]:
        """Subscribe to real-time events for a specific session."""
        q: asyncio.Queue = asyncio.Queue()
        if session_id not in self._event_queues:
            self._event_queues[session_id] = []
        self._event_queues[session_id].append(q)

        try:
            # Emit current snapshot as initial event
            session = self._active_sessions.get(session_id)
            if session:
                init_event = AutofillEventDTO(
                    sessionId=session.sessionId,
                    status=session.status,
                    atsType=session.atsType,
                    step="connected",
                    message=f"Connected to session ({session.status.value})",
                    fieldsFilled=session.fieldsFilled,
                    fieldsSkipped=session.fieldsSkipped,
                    fieldsRequiringReview=session.fieldsRequiringReview,
                    detectedCustomQuestions=session.detectedCustomQuestions,
                    resumeAttached=session.resumeAttached,
                    captchaDetected=session.captchaDetected,
                )
                yield init_event

            while True:
                event = await q.get()
                yield event
                if event.status in (
                    AutofillStatusEnum.COMPLETED,
                    AutofillStatusEnum.CANCELLED,
                    AutofillStatusEnum.BROWSER_CLOSED,
                    AutofillStatusEnum.EXPIRED,
                    AutofillStatusEnum.FAILED,
                ):
                    break
        finally:
            if session_id in self._event_queues and q in self._event_queues[session_id]:
                self._event_queues[session_id].remove(q)

    def detect_ats_type(self, url: str) -> str:
        """Classify ATS platform deterministically from URL structure."""
        url_lower = (url or "").lower()
        if "greenhouse.io" in url_lower or "gh_jid=" in url_lower or "greenhouse" in url_lower:
            return "greenhouse"
        if "lever.co" in url_lower or "lever" in url_lower:
            return "lever"
        if "ashbyhq.com" in url_lower or "ashby" in url_lower:
            return "ashby"
        return "generic"

    async def start_autofill_session(
        self,
        user_id: str,
        application: ApplicationRecordDTO,
        profile: Profile,
        portal_url: str | None = None,
    ) -> AutofillSessionDTO:
        """Initiate desktop headed Playwright autofill session."""
        if not application.resumeSnapshot:
            raise ValueError("Application must have an approved tailored resume snapshot before launching autofill.")

        active = self.get_active_session_for_app(application.id)
        if active:
            raise ValueError(f"Active autofill session {active.sessionId} is already running for this application.")

        session_id = f"af-{os.urandom(4).hex()}"
        target_url = portal_url or application.portalUrl
        if not target_url:
            raise ValueError("No portal URL available for this application.")

        ats_type = self.detect_ats_type(target_url)

        session = AutofillSessionDTO(
            sessionId=session_id,
            userId=user_id,
            applicationId=application.id,
            portalUrl=target_url,
            atsType=ats_type,
            status=AutofillStatusEnum.CREATING,
        )
        self._active_sessions[session_id] = session

        # Launch background execution task
        task = asyncio.create_task(
            self._execute_session_lifecycle(session_id, application, profile, target_url, ats_type)
        )
        self._session_tasks[session_id] = task
        return session

    async def _execute_session_lifecycle(
        self,
        session_id: str,
        application: ApplicationRecordDTO,
        profile: Profile,
        target_url: str,
        ats_type: str,
    ):
        """Asynchronous execution task managing the Playwright browser context and DOM population."""
        temp_dir = None
        playwright_mgr = None
        browser = None
        context = None

        try:
            # 1. Render approved PDF bytes and write to secure per-session temporary directory (0700)
            temp_dir = tempfile.mkdtemp(prefix=f"jobfinder_af_{session_id}_")
            os.chmod(temp_dir, 0o700)
            self._temp_dirs[session_id] = temp_dir

            safe_co = re.sub(r"[^a-zA-Z0-9_\-]", "_", application.company or "Company")
            pdf_path = os.path.join(temp_dir, f"{safe_co}_Tailored_Resume.pdf")

            # Deterministically render exact approved PDF snapshot
            snapshot = application.resumeSnapshot
            resume_content = None
            if snapshot:
                resume_content = getattr(snapshot, "structuredContent", None)
                if not resume_content and snapshot.resumeId:
                    # If structuredContent is stored in full resume record or resume repo
                    from app.db.repositories.resume_repo import resume_repo
                    full_res = resume_repo.get_tailored_resume(snapshot.resumeId)
                    if full_res and getattr(full_res, "structuredContent", None):
                        resume_content = full_res.structuredContent
            elif application.tailoredResumeId:
                from app.db.repositories.resume_repo import resume_repo
                full_res = resume_repo.get_tailored_resume(application.tailoredResumeId)
                if full_res and getattr(full_res, "structuredContent", None):
                    resume_content = full_res.structuredContent

            if resume_content:
                pdf_bytes = reportlab_renderer.render_to_pdf_bytes(resume_content)
                with open(pdf_path, "wb") as f:
                    f.write(pdf_bytes)
            else:
                raise ValueError("Could not load structured content for approved resume snapshot.")

            # 2. Extract safe allowlist facts
            safe_facts = extract_safe_profile_values(profile)

            # 3. Launch Local Headed Chromium Browser
            await self.broadcast_event(
                session_id,
                AutofillEventDTO(
                    sessionId=session_id,
                    status=AutofillStatusEnum.BROWSER_LAUNCHED,
                    atsType=ats_type,
                    step="browser_launch",
                    message="Launching desktop browser session...",
                ),
            )

            is_headless = False if self.headless_override is None else self.headless_override

            playwright_mgr = await async_playwright().start()
            browser = await playwright_mgr.chromium.launch(
                headless=is_headless,
                args=["--start-maximized"] if not is_headless else [],
            )
            context = await browser.new_context(viewport=None if not is_headless else {"width": 1280, "height": 800})
            page = await context.new_page()

            self._browser_contexts[session_id] = {
                "playwright": playwright_mgr,
                "browser": browser,
                "context": context,
                "page": page,
            }

            my_pid = os.getpid()
            descendant_pids = _get_descendant_pids(my_pid)
            self._register_session(
                session_id=session_id,
                app_id=application.id,
                pids=descendant_pids,
                temp_dir=temp_dir,
            )

            # Listen for candidate closing browser window directly
            page.on("close", lambda p: asyncio.create_task(self._handle_browser_closed(session_id)))

            # 4. Navigate to portal
            await self.broadcast_event(
                session_id,
                AutofillEventDTO(
                    sessionId=session_id,
                    status=AutofillStatusEnum.PORTAL_LOADING,
                    atsType=ats_type,
                    step="navigating",
                    message=f"Loading portal: {target_url}",
                ),
            )

            await page.goto(target_url, wait_until="domcontentloaded", timeout=45000)
            await page.wait_for_timeout(1500)

            # 5. Check for Authentication / Login Walls with bounded 5-minute recovery
            login_detected = await self._detect_login_wall(page)
            if login_detected:
                await self.broadcast_event(
                    session_id,
                    AutofillEventDTO(
                        sessionId=session_id,
                        status=AutofillStatusEnum.AUTHENTICATION_REQUIRED,
                        atsType=ats_type,
                        step="authentication_required",
                        message="Portal requires login. Please log in manually in the opened browser window.",
                    ),
                )
                authenticated = await self._await_authentication(page, timeout_seconds=300)
                if not authenticated:
                    await self.broadcast_event(
                        session_id,
                        AutofillEventDTO(
                            sessionId=session_id,
                            status=AutofillStatusEnum.HUMAN_REVIEW_REQUIRED,
                            atsType=ats_type,
                            step="auth_timeout",
                            message="Authentication window expired. Automation stopped. You may continue manually.",
                        ),
                    )
                    return

            # 6. Check for CAPTCHAs
            captcha_detected = await self._detect_captcha(page)
            if captcha_detected:
                await self.broadcast_event(
                    session_id,
                    AutofillEventDTO(
                        sessionId=session_id,
                        status=AutofillStatusEnum.HUMAN_REVIEW_REQUIRED,
                        atsType=ats_type,
                        step="captcha_detected",
                        message="CAPTCHA detected. Please solve the verification in the browser window.",
                        captchaDetected=True,
                    ),
                )

            # 7. Form Discovery & Application State Detection
            await self.broadcast_event(
                session_id,
                AutofillEventDTO(
                    sessionId=session_id,
                    status=AutofillStatusEnum.DETECTING_APPLICATION_STATE,
                    atsType=ats_type,
                    step="detecting_state",
                    message="Analyzing portal layout and application form structure...",
                ),
            )

            # Discover form root across main document and accessible frames
            form_root, telemetry = await FormRootDetector.discover(page)
            readiness: FormReadinessResult | None = None

            if not form_root:
                # No immediate form fields found. Check for actionable Apply CTA on Job Description page
                apply_cta, cta_candidates, cta_telemetry = await ApplyCtaDetector.detect(page)
                if not apply_cta and len(cta_candidates) > 1:
                    # Ambiguous application methods detected (e.g. multiple distinct options)
                    await self.broadcast_event(
                        session_id,
                        AutofillEventDTO(
                            sessionId=session_id,
                            status=AutofillStatusEnum.APPLY_CTA_AMBIGUOUS,
                            atsType=ats_type,
                            step="apply_cta_ambiguous",
                            message=f"Found {len(cta_candidates)} application options on page. Please click your preferred application method.",
                            diagnostics={"candidates": [c.text for c in cta_candidates], **telemetry},
                        ),
                    )
                    return
                elif apply_cta:
                    # Single high-confidence Apply CTA found. Trigger controlled transition to reveal form.
                    await self.broadcast_event(
                        session_id,
                        AutofillEventDTO(
                            sessionId=session_id,
                            status=AutofillStatusEnum.APPLY_CTA_AVAILABLE,
                            atsType=ats_type,
                            step="apply_cta_found",
                            message=f"Discovered application button: '{apply_cta.text}'. Opening form...",
                            diagnostics={"cta": apply_cta.text, "href": apply_cta.href},
                        ),
                    )
                    await self.broadcast_event(
                        session_id,
                        AutofillEventDTO(
                            sessionId=session_id,
                            status=AutofillStatusEnum.APPLY_ACTION_IN_PROGRESS,
                            atsType=ats_type,
                            step="clicking_apply",
                            message=f"Clicking '{apply_cta.text}' to open application form...",
                        ),
                    )
                    try:
                        await apply_cta.locator.scroll_into_view_if_needed(timeout=3000)
                        await apply_cta.locator.click()
                        await page.wait_for_timeout(1000)
                    except Exception as e:
                        logger.warning(f"Error clicking Apply CTA: {e}")

                    # Bounded wait for form to render post-click
                    await self.broadcast_event(
                        session_id,
                        AutofillEventDTO(
                            sessionId=session_id,
                            status=AutofillStatusEnum.FORM_LOADING,
                            atsType=ats_type,
                            step="waiting_for_form",
                            message="Observing page for application form rendering...",
                        ),
                    )
                    form_root, readiness = await ApplicationStateDetector.wait_for_form_readiness(page)

            # If form root discovered, check readiness stability
            if form_root and (not readiness or not readiness.is_ready):
                readiness = await ApplicationStateDetector.evaluate_form_readiness(form_root)
                if not readiness.is_ready:
                    await self.broadcast_event(
                        session_id,
                        AutofillEventDTO(
                            sessionId=session_id,
                            status=AutofillStatusEnum.FORM_LOADING,
                            atsType=ats_type,
                            step="form_loading",
                            message="Form container detected. Waiting for form controls to stabilize...",
                        ),
                    )
                    form_root, readiness = await ApplicationStateDetector.wait_for_form_readiness(page)

            # Failure check: Form not found or incomplete
            if not form_root or not readiness or not readiness.is_ready:
                logger.warning(f"Form discovery failed for session {session_id}. Telemetry: {telemetry}")
                await self.broadcast_event(
                    session_id,
                    AutofillEventDTO(
                        sessionId=session_id,
                        status=AutofillStatusEnum.FORM_NOT_FOUND,
                        atsType=ats_type,
                        step="form_not_found",
                        message="Application form could not be detected on this page. Please inspect the portal manually.",
                        diagnostics=telemetry,
                    ),
                )
                return

            # Store active form root context for session
            self._session_form_contexts[session_id] = form_root
            form_type_desc = "embedded iframe" if form_root.is_iframe else "page container"

            await self.broadcast_event(
                session_id,
                AutofillEventDTO(
                    sessionId=session_id,
                    status=AutofillStatusEnum.FORM_READY,
                    atsType=ats_type,
                    step="form_ready",
                    message=f"Application form ready ({form_type_desc}, confidence score: {form_root.confidence_score}). Populating fields...",
                    diagnostics={"formScore": form_root.confidence_score, "isIframe": form_root.is_iframe},
                ),
            )

            # 8. Execute Deterministic Field Population & Resume Attachment
            await self.broadcast_event(
                session_id,
                AutofillEventDTO(
                    sessionId=session_id,
                    status=AutofillStatusEnum.FILLING,
                    atsType=ats_type,
                    step="filling_fields",
                    message="Populating safe allowlist fields...",
                ),
            )

            # Deterministically compute intended work location if asked on portal
            try:
                page_title = await page.title()
                resolved_loc = resolve_intended_work_location(
                    structured_job_location=None,
                    structured_job_country=None,
                    structured_is_remote=None,
                    application_location=getattr(application, "location", None),
                    portal_page_title=page_title,
                    candidate_city=safe_facts.get("city"),
                    candidate_country=safe_facts.get("country"),
                )
                if resolved_loc:
                    safe_facts["intended_work_location"] = resolved_loc
            except Exception as e:
                logger.debug(f"Note computing intended work location: {e}")

            # Populate form scoped to form_root.container
            filled, skipped, needs_review, resume_attached = await self._populate_form(
                page=page,
                target=form_root.container,
                ats_type=ats_type,
                safe_facts=safe_facts,
                pdf_path=pdf_path,
            )

            # 9. Inject visual temporary green outline & top review banner
            await self._inject_review_styling(page)

            # 10. Detect unfilled custom application questions for Q&A Co-Pilot
            custom_questions: list[DetectedFormFieldDTO] = []
            try:
                custom_questions = await self._detect_custom_questions(
                    target=form_root.container,
                    frame_selector=form_root.frame_selector,
                )
                self._session_custom_fields[session_id] = {q.questionId: q for q in custom_questions}
                session = self._active_sessions.get(session_id)
                if session:
                    session.detectedCustomQuestions = custom_questions
                logger.info(f"Autofill session {session_id}: Detected {len(custom_questions)} custom question(s)")
            except Exception as e:
                logger.error(f"Custom question detection error on session {session_id}: {e}", exc_info=True)

            # 11. HARD INVARIANT: Zero-field false-success prevention
            if len(filled) == 0 and len(custom_questions) == 0:
                logger.warning(f"Autofill session {session_id}: 0 fields filled and 0 custom questions detected.")
                await self.broadcast_event(
                    session_id,
                    AutofillEventDTO(
                        sessionId=session_id,
                        status=AutofillStatusEnum.FORM_NOT_FOUND,
                        atsType=ats_type,
                        step="no_fields_populated",
                        message="Form structure was detected but no fields could be matched or populated. Please inspect manually.",
                        fieldsFilled=[],
                        fieldsSkipped=skipped,
                        fieldsRequiringReview=needs_review,
                        diagnostics={"error": "zero_fields_populated", **telemetry},
                    ),
                )
                return

            # 12. TERMINAL SAFETY CLARIFICATION
            # Do NOT infer terminal step solely because Next is absent.
            # Only reach READY_FOR_SUBMISSION when confidently terminal.
            is_terminal = readiness.is_terminal_step is True

            final_status = AutofillStatusEnum.READY_FOR_SUBMISSION if is_terminal else AutofillStatusEnum.MULTI_STEP_FORM

            if is_terminal:
                review_msg = (
                    f"Autofill finished! Populated {len(filled)} verified fields and attached resume. "
                    "Review all fields and manually click Submit when ready."
                )
                step_name = "ready_for_review"
            else:
                review_msg = (
                    f"Step populated! Populated {len(filled)} verified fields. "
                    "Review your information and click Continue / Next on the employer portal to proceed to next step."
                )
                step_name = "multi_step_paused"

            await self.broadcast_event(
                session_id,
                AutofillEventDTO(
                    sessionId=session_id,
                    status=final_status,
                    atsType=ats_type,
                    step=step_name,
                    message=review_msg,
                    fieldsFilled=filled,
                    fieldsSkipped=skipped,
                    fieldsRequiringReview=needs_review,
                    detectedCustomQuestions=custom_questions,
                    resumeAttached=resume_attached,
                    captchaDetected=captcha_detected,
                    diagnostics={
                        "isTerminal": is_terminal,
                        "fieldsFilledCount": len(filled),
                        "customQuestionsCount": len(custom_questions),
                        "formRootScore": form_root.confidence_score,
                        "isIframe": form_root.is_iframe,
                    },
                ),
            )

            # Session is now ready for candidate review on external portal.
            # Browser context remains open in self._browser_contexts until user cancels or confirms submission.
            logger.info(f"Autofill lifecycle complete for session {session_id}. Awaiting candidate review.")

            if self.inactivity_timeout_seconds > 0:
                self._inactivity_tasks[session_id] = asyncio.create_task(
                    self._inactivity_watchdog(session_id, self.inactivity_timeout_seconds)
                )

        except asyncio.CancelledError:
            logger.info(f"Autofill session {session_id} cancelled.")
        except Exception as e:
            logger.error(f"Error in autofill lifecycle for session {session_id}: {e}", exc_info=True)
            await self.broadcast_event(
                session_id,
                AutofillEventDTO(
                    sessionId=session_id,
                    status=AutofillStatusEnum.FAILED,
                    atsType=ats_type,
                    step="failed",
                    message=f"Autofill stopped safely: {str(e)}",
                ),
            )
            # Preserve browser context if open so candidate can finish manually

    async def _detect_login_wall(self, page: Page) -> bool:
        """Detect if portal is gated behind a login screen."""
        try:
            auth_indicators = [
                'input[type="password"]',
                'button:has-text("Sign in")',
                'button:has-text("Log in")',
                'a:has-text("Sign in to apply")',
            ]
            for sel in auth_indicators:
                if await page.locator(sel).count() > 0:
                    # Verify it is not just an optional account creation field
                    if await page.locator('input[type="email"], input[name*="user"]').count() > 0:
                        return True
        except Exception:
            pass
        return False

    async def _await_authentication(self, page: Page, timeout_seconds: int = 300) -> bool:
        """Poll boundedly for application form to appear post-login."""
        start_time = asyncio.get_event_loop().time()
        form_indicators = [
            '#application_form',
            'form[action*="apply"]',
            'input[name*="first_name"], #first_name',
            'input[name="name"]',
            'input[type="file"]',
        ]
        while asyncio.get_event_loop().time() - start_time < timeout_seconds:
            try:
                for sel in form_indicators:
                    if await page.locator(sel).count() > 0:
                        return True
            except Exception:
                pass
            await asyncio.sleep(2)
        return False

    async def _detect_captcha(self, page: Page) -> bool:
        """Detect presence of CAPTCHA iframes."""
        try:
            captcha_selectors = [
                'iframe[src*="recaptcha"]',
                'iframe[src*="hcaptcha"]',
                'iframe[src*="cloudflare"]',
                'div.g-recaptcha',
                'div.h-captcha',
            ]
            for sel in captcha_selectors:
                if await page.locator(sel).count() > 0:
                    return True
        except Exception:
            pass
        return False

    async def _populate_form(
        self,
        page: Page,
        target: Page | Frame | Locator,
        ats_type: str,
        safe_facts: dict[str, str],
        pdf_path: str,
    ) -> tuple[list[str], list[str], list[str], bool]:
        """Perform deterministic selector matching, field filling, and resume attachment."""
        filled: list[str] = []
        skipped: list[str] = []
        needs_review: list[str] = []
        resume_attached = False

        # Forbidden control selectors (defense-in-depth)
        forbidden_regex = re.compile(r"submit|apply|send\s+application", re.I)

        # Helper to safely fill an input with value and highlight
        async def safe_fill_input(locator, field_name: str, value: str) -> bool:
            if not value:
                return False
            try:
                # Check for submission button safeguard
                tag = await locator.evaluate("el => el.tagName.toLowerCase()")
                el_type = await locator.evaluate("el => el.getAttribute('type') || ''")
                if el_type.lower() == "submit" or tag in ("button", "submit"):
                    return False

                await locator.scroll_into_view_if_needed(timeout=3000)
                await locator.fill(value)
                # Apply temporary green outline highlight
                await locator.evaluate("el => { el.style.outline = '2px solid #10B981'; el.style.backgroundColor = 'rgba(16, 185, 129, 0.08)'; }")
                filled.append(field_name)
                logger.info(f"Populated SAFE_AUTOFILL: {field_name}")
                return True
            except Exception as ex:
                logger.debug(f"Could not fill field {field_name}: {ex}")
                return False

        # Helper to attach resume PDF
        async def safe_attach_file(file_locator) -> bool:
            try:
                await file_locator.set_input_files(pdf_path)
                await file_locator.evaluate("el => { el.style.outline = '2px solid #10B981'; }")
                logger.info("Attached approved tailored resume PDF snapshot")
                return True
            except Exception as ex:
                logger.warning(f"Failed to attach resume file: {ex}")
                return False

        # -------------------------------------------------------------
        # 1. Greenhouse Adapter
        # -------------------------------------------------------------
        if ats_type == "greenhouse":
            # First Name (resilient selector)
            fn_loc = target.locator("#first_name, input[name='first_name'], input[autocomplete='given-name'], input[aria-label*='First Name' i], input[data-qa='first-name']")
            if await fn_loc.count() > 0:
                if "first_name" in safe_facts and safe_facts["first_name"]:
                    await safe_fill_input(fn_loc.first, "first_name", safe_facts["first_name"])
                else:
                    needs_review.append("first_name")

            # Last Name (resilient selector)
            ln_loc = target.locator("#last_name, input[name='last_name'], input[autocomplete='family-name'], input[aria-label*='Last Name' i], input[data-qa='last-name']")
            if await ln_loc.count() > 0:
                if "last_name" in safe_facts and safe_facts["last_name"]:
                    await safe_fill_input(ln_loc.first, "last_name", safe_facts["last_name"])
                else:
                    needs_review.append("last_name")

            # Email
            em_loc = target.locator("#email, input[name='email'], input[type='email']")
            if await em_loc.count() > 0:
                await safe_fill_input(em_loc.first, "email", safe_facts.get("email", ""))

            # Country Code Dropdown (Greenhouse react-select #country)
            target_country_code = safe_facts.get("phone_country_code", "+91")
            try:
                c_input = target.locator("input#country, input[name='country']")
                if await c_input.count() > 0:
                    c_container = target.locator(".phone-input__country")
                    curr_c_text = await c_container.inner_text() if await c_container.count() > 0 else ""
                    if "+91" not in curr_c_text and "India" not in curr_c_text:
                        await c_input.first.scroll_into_view_if_needed(timeout=3000)
                        await c_input.first.focus()
                        await c_input.first.press_sequentially("+91", delay=40)
                        await page.wait_for_timeout(300)
                        india_opt = target.locator("div[id*='-option-']:has-text('+91'), div[id*='-option-']:has-text('India')")
                        if await india_opt.count() == 0 and page != target:
                            india_opt = page.locator("div[id*='-option-']:has-text('+91'), div[id*='-option-']:has-text('India')")
                        if await india_opt.count() > 0:
                            await india_opt.first.click()
                            logger.info("Selected India (+91) in Greenhouse country dropdown")
                        else:
                            await c_input.first.press("Enter")
                        await page.keyboard.press("Escape")
                        await page.wait_for_timeout(300)
            except Exception as e:
                logger.debug(f"Country dropdown interaction note: {e}")

            # Phone (National digits only, strictly stripping duplicate +91 and any leading zero)
            ph_loc = target.locator("#phone, input[name='phone'], input[autocomplete='tel'], input[type='tel']")
            if await ph_loc.count() > 0:
                raw_phone_val = safe_facts.get("phone_national") or safe_facts.get("phone", "")
                phone_val = re.sub(r"^\+?91[\s\-]?", "", raw_phone_val).strip()
                phone_val = re.sub(r"^0+", "", phone_val).strip()
                await safe_fill_input(ph_loc.first, "phone", phone_val)
                # Safeguard against library auto-formatting adding a leading zero
                try:
                    await ph_loc.first.evaluate("""el => {
                        if (el.value.startsWith('0')) {
                            el.value = el.value.replace(/^0+/, '');
                        }
                        el.dispatchEvent(new Event('input', { bubbles: true }));
                        el.dispatchEvent(new Event('change', { bubbles: true }));
                    }""")
                except Exception:
                    pass

            # Label-driven input finder helper
            async def find_input_by_label_patterns(patterns: list[str]):
                for pat in patterns:
                    lbl = target.locator(f"label:has-text('{pat}'), .select__label:has-text('{pat}')")
                    cnt = await lbl.count()
                    if cnt > 0:
                        for i in range(cnt):
                            for_id = await lbl.nth(i).get_attribute("for")
                            if for_id:
                                inp = target.locator(f"#{for_id}")
                                if await inp.count() > 0:
                                    return inp.first
                            parent = lbl.nth(i).locator("xpath=..")
                            inp = parent.locator("input, select, textarea")
                            if await inp.count() > 0:
                                return inp.first
                return None

            # Education Fields (School, Degree, Discipline via Greenhouse react-select)
            async def fill_gh_react_select(field_id: str, fact_key: str, primary_query: str, fallback_query: str | None = None) -> bool:
                try:
                    inp = target.locator(f"input#{field_id}, input[id*='{field_id}']")
                    if await inp.count() == 0:
                        return False
                    await inp.first.scroll_into_view_if_needed(timeout=3000)
                    await inp.first.focus()
                    await page.keyboard.press("Control+A")
                    await page.keyboard.press("Backspace")
                    await inp.first.press_sequentially(primary_query, delay=35)
                    await page.wait_for_timeout(700)

                    async def pick_best_matching_option(target_term: str) -> bool:
                        opts = target.locator("div[id*='-option-'], div[class*='-option'], div[role='option'], .select__option, [class*='menu'] [role='option']")
                        if await opts.count() == 0 and page != target:
                            opts = page.locator("div[id*='-option-'], div[class*='-option'], div[role='option'], .select__option, [class*='menu'] [role='option']")
                        cnt = await opts.count()
                        if cnt == 0:
                            return False
                        # Priority 1: Exact text match (e.g. "Other" or "Computer Science")
                        for i in range(cnt):
                            t = (await opts.nth(i).inner_text()).strip()
                            if t.lower() == target_term.lower():
                                await opts.nth(i).dispatch_event("mousedown")
                                await opts.nth(i).click(force=True)
                                return True
                        # Priority 2: Starts with target query
                        for i in range(cnt):
                            t = (await opts.nth(i).inner_text()).strip()
                            if t.lower().startswith(target_term.lower()):
                                await opts.nth(i).dispatch_event("mousedown")
                                await opts.nth(i).click(force=True)
                                return True
                        # Priority 3: Contains target query
                        for i in range(cnt):
                            t = (await opts.nth(i).inner_text()).strip()
                            if target_term.lower() in t.lower():
                                await opts.nth(i).dispatch_event("mousedown")
                                await opts.nth(i).click(force=True)
                                return True
                        await opts.first.dispatch_event("mousedown")
                        await opts.first.click(force=True)
                        return True

                    selected = await pick_best_matching_option(primary_query)
                    if not selected and fallback_query:
                        await inp.first.focus()
                        await page.keyboard.press("Control+A")
                        await page.keyboard.press("Backspace")
                        await inp.first.press_sequentially(fallback_query, delay=35)
                        await page.wait_for_timeout(700)
                        selected = await pick_best_matching_option(fallback_query)

                    if selected:
                        filled.append(fact_key)
                        logger.info(f"Populated SAFE_AUTOFILL {fact_key}: '{primary_query}'")
                    else:
                        await inp.first.press("Enter")
                        filled.append(fact_key)

                    await page.keyboard.press("Escape")
                    await page.wait_for_timeout(300)
                    return True
                except Exception as ex:
                    logger.debug(f"Could not fill react-select {field_id}: {ex}")
                    return False

            # Multi-education field population (support index 0, 1, 2...)
            for edu_idx in range(5):
                sch_key = f"education_{edu_idx}_school" if edu_idx > 0 else "education_school"
                deg_key = f"education_{edu_idx}_degree" if edu_idx > 0 else "education_degree"
                dis_key = f"education_{edu_idx}_discipline" if edu_idx > 0 else "education_discipline"
                start_key = f"education_{edu_idx}_start_year" if edu_idx > 0 else "education_start_year"
                end_key = f"education_{edu_idx}_end_year" if edu_idx > 0 else "education_end_year"

                s_val = safe_facts.get(sch_key, "")
                if s_val and await target.locator(f"input#school--{edu_idx}, input[name*='school[{edu_idx}]']").count() > 0:
                    await fill_gh_react_select(f"school--{edu_idx}", sch_key, s_val, "Other")
                    other_school = await find_input_by_label_patterns([
                        "If other, please specify", "Other school", "School name"
                    ])
                    if other_school:
                        await safe_fill_input(other_school, sch_key, s_val)
                elif edu_idx == 0 and s_val and await target.locator("input[id*='school']").count() > 0:
                    await fill_gh_react_select("school--0", "education_school", s_val, "Other")

                d_val = safe_facts.get(deg_key, "")
                if d_val and await target.locator(f"input#degree--{edu_idx}, input[name*='degree[{edu_idx}]']").count() > 0:
                    degree_query = "Bachelor" if any(k in d_val.lower() for k in ["bachelor", "b.tech", "btech", "b.e", "be"]) else ("Master" if any(k in d_val.lower() for k in ["master", "m.tech", "ms"]) else d_val)
                    await fill_gh_react_select(f"degree--{edu_idx}", deg_key, degree_query, None)
                elif edu_idx == 0 and d_val and await target.locator("input[id*='degree']").count() > 0:
                    degree_query = "Bachelor" if any(k in d_val.lower() for k in ["bachelor", "b.tech", "btech", "b.e", "be"]) else ("Master" if any(k in d_val.lower() for k in ["master", "m.tech", "ms"]) else d_val)
                    await fill_gh_react_select("degree--0", "education_degree", degree_query, None)

                f_val = safe_facts.get(dis_key, "")
                if f_val and await target.locator(f"input#discipline--{edu_idx}, input[name*='discipline[{edu_idx}]']").count() > 0:
                    field_query = "Computer Science" if any(k in f_val.lower() for k in ["computer", "cs", "csd", "software"]) else ("Data Science" if "data" in f_val.lower() else f_val)
                    await fill_gh_react_select(f"discipline--{edu_idx}", dis_key, field_query, None)
                elif edu_idx == 0 and f_val and await target.locator("input[id*='discipline']").count() > 0:
                    field_query = "Computer Science" if any(k in f_val.lower() for k in ["computer", "cs", "csd", "software"]) else ("Data Science" if "data" in f_val.lower() else f_val)
                    await fill_gh_react_select("discipline--0", "education_discipline", field_query, None)

                st_val = safe_facts.get(start_key, "")
                if st_val:
                    st_inp = target.locator(f"input#start_date_year--{edu_idx}, input[name*='start_date_year[{edu_idx}]']")
                    if await st_inp.count() == 0 and edu_idx == 0:
                        st_inp_found = await find_input_by_label_patterns([
                            "Start date year", "Start Date Year", "Start year", "Start Year", "Start Date"
                        ])
                        if st_inp_found:
                            st_inp = st_inp_found
                    if await st_inp.count() > 0:
                        await safe_fill_input(st_inp.first, start_key, st_val)

                en_val = safe_facts.get(end_key, "")
                if en_val:
                    en_inp = target.locator(f"input#end_date_year--{edu_idx}, input[name*='end_date_year[{edu_idx}]']")
                    if await en_inp.count() == 0 and edu_idx == 0:
                        en_inp_found = await find_input_by_label_patterns([
                            "End date year", "End Date Year", "End year", "End Year", "Graduation year", "End Date"
                        ])
                        if en_inp_found:
                            en_inp = en_inp_found
                    if await en_inp.count() > 0:
                        await safe_fill_input(en_inp.first, end_key, en_val)

            # Resume file upload
            file_loc = target.locator('#resume_fieldset input[type="file"], input[data-qa="resume-upload"], input[type="file"]')
            if await file_loc.count() > 0:
                resume_attached = await safe_attach_file(file_loc.first)

            # Location (City) via geocoded react-select (#candidate-location)
            city_val = safe_facts.get("city", "")
            state_val = safe_facts.get("state", "")
            country_val = safe_facts.get("country", "")
            loc_inp = target.locator("#candidate-location")
            if await loc_inp.count() == 0:
                loc_inp_found = await find_input_by_label_patterns(["Location (City)", "Current City"])
                if loc_inp_found:
                    loc_inp = loc_inp_found
            if await loc_inp.count() > 0:
                if city_val:
                    try:
                        await loc_inp.first.scroll_into_view_if_needed(timeout=3000)
                        await loc_inp.first.click()
                        await page.keyboard.press("Control+A")
                        await page.keyboard.press("Backspace")
                        # Type query (combine city and state if state provided to help geocoding disambiguation)
                        type_query = f"{city_val.strip()}, {state_val.strip()}" if state_val.strip() else city_val.strip()
                        await loc_inp.first.press_sequentially(type_query, delay=40)
                        
                        # Wait and poll for geocoded async dropdown options to load (up to 6.0s)
                        opts = target.locator("div[id*='candidate-location-option-'], div[class*='-option'], div[role='option']")
                        if await opts.count() == 0 and page != target:
                            opts = page.locator("div[id*='candidate-location-option-'], div[class*='-option'], div[role='option']")
                        found_opts = False
                        for _ in range(30):  # 30 * 200ms = 6000ms
                            if await opts.count() > 0:
                                found_opts = True
                                break
                            await page.wait_for_timeout(200)

                        if found_opts:
                            chosen = None
                            opt_count = await opts.count()
                            candidate_city_low = city_val.lower().strip()
                            candidate_state_low = state_val.lower().strip() if state_val.strip() else None
                            candidate_country_low = country_val.lower().strip() if country_val.strip() else None

                            # Priority 1: Match city, state, and country if available
                            for i in range(opt_count):
                                opt_text = (await opts.nth(i).inner_text()).lower()
                                if candidate_city_low in opt_text:
                                    if candidate_state_low and candidate_state_low in opt_text:
                                        if not candidate_country_low or candidate_country_low in opt_text:
                                            chosen = opts.nth(i)
                                            break
                            # Priority 2: Match city and country
                            if not chosen:
                                for i in range(opt_count):
                                    opt_text = (await opts.nth(i).inner_text()).lower()
                                    if candidate_city_low in opt_text:
                                        if not candidate_country_low or candidate_country_low in opt_text:
                                            chosen = opts.nth(i)
                                            break
                            # Priority 3: Fallback to first matching city
                            if not chosen:
                                for i in range(opt_count):
                                    opt_text = (await opts.nth(i).inner_text()).lower()
                                    if candidate_city_low in opt_text:
                                        chosen = opts.nth(i)
                                        break
                            if not chosen:
                                chosen = opts.first

                            sel_text = await chosen.inner_text()
                            await chosen.scroll_into_view_if_needed(timeout=2000)
                            try:
                                await chosen.hover()
                                await chosen.dispatch_event("mousedown")
                                await chosen.click(force=True)
                                await chosen.dispatch_event("mouseup")
                            except Exception:
                                await chosen.click(force=True)

                            await page.wait_for_timeout(200)
                            await page.keyboard.press("Enter")
                            await page.wait_for_timeout(100)
                            await page.keyboard.press("Tab")

                            try:
                                inp_val = await loc_inp.first.input_value()
                                if not inp_val or not inp_val.strip():
                                    await loc_inp.first.focus()
                                    await page.keyboard.press("ArrowDown")
                                    await page.wait_for_timeout(200)
                                    await page.keyboard.press("Enter")
                            except Exception:
                                pass

                            filled.append("city")
                            logger.info(f"Selected geocoded city option: '{sel_text}'")
                            await page.wait_for_timeout(400)
                        else:
                            # Dropdown options didn't appear in 6s; press ArrowDown then Enter
                            await page.keyboard.press("ArrowDown")
                            await page.wait_for_timeout(300)
                            await page.keyboard.press("Enter")
                            await page.wait_for_timeout(400)
                            filled.append("city")
                            logger.info(f"Submitted location via keyboard Enter: '{type_query}'")
                    except Exception as ex:
                        logger.error(f"Error on candidate-location selection: {ex}", exc_info=True)
                else:
                    needs_review.append("city")

            # Social Links: LinkedIn (Strictly verified linkedin_url only, never substituted)
            li_inp = await find_input_by_label_patterns(["LinkedIn Profile", "LinkedIn URL", "LinkedIn"])
            if not li_inp:
                li_inp_loc = target.locator('input[autocomplete*="linkedin"], input[id*="linkedin"], input[name*="linkedin"]')
                if await li_inp_loc.count() > 0:
                    li_inp = li_inp_loc.first
            if li_inp:
                if "linkedin_url" in safe_facts and safe_facts["linkedin_url"]:
                    await safe_fill_input(li_inp, "linkedin_url", safe_facts["linkedin_url"])
                else:
                    needs_review.append("linkedin_url")

            # Social Links: Other Website / Portfolio (Strictly verified portfolio_url only, never substituted)
            port_inp = await find_input_by_label_patterns(["Other Website", "Portfolio", "Personal Website"])
            if not port_inp:
                # Check for generic "Website" only if surrounding text confirms personal site
                gen_web = await find_input_by_label_patterns(["Website"])
                if gen_web:
                    parent_text = await gen_web.locator("xpath=..").inner_text()
                    if any(k in parent_text.lower() for k in ["personal", "portfolio", "other website"]):
                        port_inp = gen_web
            if not port_inp:
                port_inp_loc = target.locator('input[id*="portfolio"]')
                if await port_inp_loc.count() > 0:
                    port_inp = port_inp_loc.first
            if port_inp:
                if "portfolio_url" in safe_facts and safe_facts["portfolio_url"]:
                    await safe_fill_input(port_inp, "portfolio_url", safe_facts["portfolio_url"])
                else:
                    needs_review.append("portfolio_url")

            # GitHub URL (Strictly verified github_url only, if asked)
            gh_inp = await find_input_by_label_patterns(["GitHub Profile", "GitHub URL", "GitHub"])
            if gh_inp:
                if "github_url" in safe_facts and safe_facts["github_url"]:
                    await safe_fill_input(gh_inp, "github_url", safe_facts["github_url"])
                else:
                    needs_review.append("github_url")

            # Preferred First Name
            pref_inp = await find_input_by_label_patterns(["Preferred First Name", "Preferred Name", "Nickname"])
            if pref_inp and "preferred_first_name" in safe_facts:
                await safe_fill_input(pref_inp, "preferred_first_name", safe_facts["preferred_first_name"])

            # Pronouns (react-select combobox)
            pronoun_inp = await find_input_by_label_patterns(["Pronouns"])
            if pronoun_inp and "pronouns" in safe_facts and safe_facts["pronouns"]:
                user_pronouns = safe_facts["pronouns"].strip()
                try:
                    await pronoun_inp.scroll_into_view_if_needed(timeout=3000)
                    await pronoun_inp.focus()
                    await page.keyboard.press("Control+A")
                    await page.keyboard.press("Backspace")
                    first_token = user_pronouns.split("/")[0].strip() or user_pronouns
                    await pronoun_inp.press_sequentially(first_token, delay=35)
                    await page.wait_for_timeout(600)
                    p_opts = target.locator(f"div[id*='option-']:has-text('{user_pronouns}'), div[id*='option-']:has-text('{first_token}')")
                    if await p_opts.count() == 0 and page != target:
                        p_opts = page.locator(f"div[id*='option-']:has-text('{user_pronouns}'), div[id*='option-']:has-text('{first_token}')")
                    if await p_opts.count() > 0:
                        await p_opts.first.click()
                        filled.append("pronouns")
                        logger.info(f"Selected pronouns: {user_pronouns}")
                    await page.keyboard.press("Escape")
                    await page.wait_for_timeout(200)
                except Exception as ex:
                    logger.debug(f"Pronouns selection note: {ex}")

            # Gender (react-select combobox)
            gender_inp = target.locator("#gender")
            if await gender_inp.count() == 0:
                gender_inp_found = await find_input_by_label_patterns(["Gender"])
                if gender_inp_found:
                    gender_inp = gender_inp_found
            if await gender_inp.count() > 0 and "gender" in safe_facts and safe_facts["gender"]:
                user_gender = safe_facts["gender"].strip()
                try:
                    await gender_inp.first.scroll_into_view_if_needed(timeout=3000)
                    await gender_inp.first.focus()
                    await page.keyboard.press("Control+A")
                    await page.keyboard.press("Backspace")
                    await gender_inp.first.press_sequentially(user_gender, delay=35)
                    await page.wait_for_timeout(600)
                    g_opts = target.locator(f"div[id*='gender-option-']:has-text('{user_gender}'), div[id*='option-']:has-text('{user_gender}')")
                    if await g_opts.count() == 0 and page != target:
                        g_opts = page.locator(f"div[id*='gender-option-']:has-text('{user_gender}'), div[id*='option-']:has-text('{user_gender}')")
                    if await g_opts.count() > 0:
                        await g_opts.first.click()
                        filled.append("gender")
                        logger.info(f"Selected gender: {user_gender}")
                    await page.keyboard.press("Escape")
                    await page.wait_for_timeout(200)
                except Exception as ex:
                    logger.debug(f"Gender selection note: {ex}")

            # From where do you intend to work?
            work_inp = await find_input_by_label_patterns(["From where do you intend to work", "Where do you intend to work"])
            if work_inp:
                if "intended_work_location" in safe_facts and safe_facts["intended_work_location"]:
                    await safe_fill_input(work_inp, "intended_work_location", safe_facts["intended_work_location"])
                else:
                    needs_review.append("intended_work_location")

            # Experience Threshold Questions (e.g. "Do you have more than 5 years of experience?")
            await self._fill_experience_questions(target, page, safe_facts, filled)

        # -------------------------------------------------------------
        # 2. Lever Adapter
        # -------------------------------------------------------------
        elif ats_type == "lever":
            # Full Name
            name_loc = target.locator('input[name="name"]')
            if await name_loc.count() > 0:
                await safe_fill_input(name_loc.first, "full_name", safe_facts.get("full_name", ""))

            # Email
            email_loc = target.locator('input[name="email"]')
            if await email_loc.count() > 0:
                await safe_fill_input(email_loc.first, "email", safe_facts.get("email", ""))

            # Phone
            phone_loc = target.locator('input[name="phone"]')
            if await phone_loc.count() > 0:
                await safe_fill_input(phone_loc.first, "phone", safe_facts.get("phone", ""))

            # Resume
            resume_loc = target.locator('input[name="resume"], input[type="file"]')
            if await resume_loc.count() > 0:
                resume_attached = await safe_attach_file(resume_loc.first)

            # Social Links
            li_loc = target.locator('input[name="urls[LinkedIn]"]')
            if await li_loc.count() > 0 and "linkedin_url" in safe_facts:
                await safe_fill_input(li_loc.first, "linkedin_url", safe_facts["linkedin_url"])

            gh_loc = target.locator('input[name="urls[GitHub]"]')
            if await gh_loc.count() > 0 and "github_url" in safe_facts:
                await safe_fill_input(gh_loc.first, "github_url", safe_facts["github_url"])

            port_loc = target.locator('input[name="urls[Portfolio]"], input[name="urls[Other]"]')
            if await port_loc.count() > 0 and "portfolio_url" in safe_facts:
                await safe_fill_input(port_loc.first, "portfolio_url", safe_facts["portfolio_url"])

        # -------------------------------------------------------------
        # 3. Ashby Adapter
        # -------------------------------------------------------------
        elif ats_type == "ashby":
            # First Name
            first_loc = target.locator('input[name="_systemfield_name_first"]')
            if await first_loc.count() > 0:
                if "first_name" in safe_facts:
                    await safe_fill_input(first_loc.first, "first_name", safe_facts["first_name"])
                else:
                    needs_review.append("first_name")

            # Last Name
            last_loc = target.locator('input[name="_systemfield_name_last"]')
            if await last_loc.count() > 0:
                if "last_name" in safe_facts:
                    await safe_fill_input(last_loc.first, "last_name", safe_facts["last_name"])
                else:
                    needs_review.append("last_name")

            # Email
            email_loc = target.locator('input[name="_systemfield_email"]')
            if await email_loc.count() > 0:
                await safe_fill_input(email_loc.first, "email", safe_facts.get("email", ""))

            # Phone
            phone_loc = target.locator('input[name="_systemfield_phone"]')
            if await phone_loc.count() > 0:
                await safe_fill_input(phone_loc.first, "phone", safe_facts.get("phone", ""))

            # Resume
            file_loc = target.locator('input[type="file"]')
            if await file_loc.count() > 0:
                resume_attached = await safe_attach_file(file_loc.first)

        # -------------------------------------------------------------
        # 4. Generic Fallback Adapter (Strict Allowlist Only)
        # -------------------------------------------------------------
        else:
            # First Name via autocomplete, id, or name
            fn_loc = target.locator('input[autocomplete="given-name"], input#first_name, input[name="first_name"]')
            if await fn_loc.count() >= 1:
                if "first_name" in safe_facts:
                    await safe_fill_input(fn_loc.first, "first_name", safe_facts["first_name"])

            # Last Name via autocomplete, id, or name
            ln_loc = target.locator('input[autocomplete="family-name"], input#last_name, input[name="last_name"]')
            if await ln_loc.count() >= 1:
                if "last_name" in safe_facts:
                    await safe_fill_input(ln_loc.first, "last_name", safe_facts["last_name"])

            # Full Name via autocomplete
            full_loc = target.locator('input[autocomplete="name"]')
            if await full_loc.count() >= 1:
                await safe_fill_input(full_loc.first, "full_name", safe_facts.get("full_name", ""))

            # Email via type, id, name, or autocomplete
            em_loc = target.locator('input[type="email"], input[autocomplete="email"], input#email, input[name="email"]')
            if await em_loc.count() >= 1:
                await safe_fill_input(em_loc.first, "email", safe_facts.get("email", ""))

            # Phone via type, id, name, or autocomplete
            ph_loc = target.locator('input[type="tel"], input[autocomplete="tel"], input#phone, input[name="phone"]')
            if await ph_loc.count() >= 1:
                await safe_fill_input(ph_loc.first, "phone", safe_facts.get("phone", ""))

            # Social Links: LinkedIn
            li_loc = target.locator('input[name*="linkedin" i], input[id*="linkedin" i]')
            if await li_loc.count() >= 1 and "linkedin_url" in safe_facts:
                await safe_fill_input(li_loc.first, "linkedin_url", safe_facts["linkedin_url"])

            # File upload for resume
            f_loc = target.locator('input[type="file"]')
            if await f_loc.count() > 0:
                resume_attached = await safe_attach_file(f_loc.first)

        # Detect any custom question fields or textareas that were left untouched
        all_textareas = await target.locator("textarea").all()
        if len(all_textareas) > 0:
            skipped.append(f"{len(all_textareas)} custom textarea(s)")

        return filled, skipped, needs_review, resume_attached

    async def _inject_review_styling(self, page: Page):
        """Inject top floating review banner into the browser page."""
        try:
            banner_script = """
            (() => {
                if (document.getElementById('jobfinder-autofill-banner')) return;
                const banner = document.createElement('div');
                banner.id = 'jobfinder-autofill-banner';
                banner.style.cssText = 'position:fixed; top:12px; left:50%; transform:translateX(-50%); z-index:9999999; background:#0D0D0D; color:#FFFFFF; border:1px solid #10B981; padding:8px 18px; border-radius:12px; font-family:system-ui, -apple-system, sans-serif; font-size:12px; box-shadow:0 10px 25px rgba(0,0,0,0.6); display:flex; align-items:center; gap:8px; pointer-events:none;';
                banner.innerHTML = '<span style="color:#10B981; font-weight:bold;">JobFinder Autofill:</span><span>Verified profile information populated. Review all fields and manually submit.</span>';
                document.body.appendChild(banner);
            })();
            """
            await page.evaluate(banner_script)
        except Exception as ex:
            logger.debug(f"Could not inject banner script: {ex}")

    async def _handle_browser_closed(self, session_id: str):
        """Triggered when the candidate closes the browser window."""
        session = self._active_sessions.get(session_id)
        if session and session.status not in (
            AutofillStatusEnum.COMPLETED,
            AutofillStatusEnum.CANCELLED,
            AutofillStatusEnum.BROWSER_CLOSED,
            AutofillStatusEnum.EXPIRED,
        ):
            await self.broadcast_event(
                session_id,
                AutofillEventDTO(
                    sessionId=session_id,
                    status=AutofillStatusEnum.BROWSER_CLOSED,
                    atsType=session.atsType,
                    step="browser_closed",
                    message="Browser window closed by candidate.",
                ),
            )
            await self.cleanup_session(session_id)

    async def cancel_session(self, session_id: str, user_id: str) -> AutofillSessionDTO:
        """Cancel an ongoing autofill session."""
        session = self._active_sessions.get(session_id)
        if not session:
            raise KeyError(f"Session {session_id} not found.")
        if session.userId != user_id:
            raise PermissionError("User does not own this session.")

        await self.broadcast_event(
            session_id,
            AutofillEventDTO(
                sessionId=session_id,
                status=AutofillStatusEnum.CANCELLED,
                atsType=session.atsType,
                step="cancelled",
                message="Autofill session cancelled by candidate.",
            ),
        )
        await self.cleanup_session(session_id)
        return session

    async def cleanup_session(self, session_id: str):
        """Best-effort cleanup of browser context, task, and secure temporary directory."""
        # Cancel inactivity watchdog if running
        inact_task = self._inactivity_tasks.pop(session_id, None)
        if inact_task and not inact_task.done():
            inact_task.cancel()

        # Clean up session form context
        self._session_form_contexts.pop(session_id, None)

        # Unregister from active_sessions.json
        self._unregister_session(session_id)

        # Cancel background lifecycle task if still running
        task = self._session_tasks.pop(session_id, None)
        if task and not task.done():
            task.cancel()

        # Close browser and context
        ctx_data = self._browser_contexts.pop(session_id, None)
        if ctx_data:
            try:
                context = ctx_data.get("context")
                if context:
                    await context.close()
                browser = ctx_data.get("browser")
                if browser:
                    await browser.close()
                playwright_mgr = ctx_data.get("playwright")
                if playwright_mgr:
                    await playwright_mgr.stop()
            except Exception as ex:
                logger.debug(f"Error closing browser for session {session_id}: {ex}")

        # Delete secure temporary directory
        temp_dir = self._temp_dirs.pop(session_id, None)
        if temp_dir and os.path.exists(temp_dir):
            try:
                shutil.rmtree(temp_dir, ignore_errors=True)
                logger.info(f"Cleaned up temporary directory for session {session_id}")
            except Exception as ex:
                logger.warning(f"Failed to delete temp dir {temp_dir}: {ex}")

    async def fill_experience_questions(
        self,
        target: Page | Frame | Locator,
        page: Page,
        safe_facts: dict[str, str],
        filled: list[str],
    ) -> None:
        """Deterministically answer experience threshold questions (e.g. 'Do you have more than 5 years of experience?')."""
        await fill_experience_questions(target, page, safe_facts, filled)

    _fill_experience_questions = fill_experience_questions

    async def _detect_custom_questions(
        self,
        target: Page | Frame | Locator,
        frame_selector: str | None = None,
    ) -> list[DetectedFormFieldDTO]:
        """Detect unfilled custom text inputs and textareas on portal with stable question IDs."""
        from app.services.qa_copilot_service import classify_question
        detected: list[DetectedFormFieldDTO] = []
        idx = 1

        # Standard identity / contact keywords to hard-exclude from custom Q&A
        EXCLUDED_KEYWORDS = [
            "first name", "last name", "full name", "preferred name",
            "email", "phone", "street", "address", "city", "location",
            "postal", "zip", "country", "linkedin", "github", "portfolio",
            "other website", "personal website", "resume", "cv", "gender",
            "pronouns", "race", "ethnicity", "veteran", "disability",
            "school", "degree", "discipline"
        ]

        textareas = target.locator("textarea")
        count = await textareas.count()

        for i in range(count):
            ta = textareas.nth(i)
            try:
                # Basic visibility check
                is_vis = await ta.is_visible()
                if not is_vis:
                    bb = await ta.bounding_box()
                    if not bb or bb.get("width", 0) == 0 or bb.get("height", 0) == 0:
                        continue

                el_id = (await ta.get_attribute("id") or "").strip()
                el_name = (await ta.get_attribute("name") or "").strip()
                placeholder = (await ta.get_attribute("placeholder") or "").strip()
                aria_label = (await ta.get_attribute("aria-label") or "").strip()
                aria_lbl_id = (await ta.get_attribute("aria-labelledby") or "").strip()

                label_text = ""
                # Priority 1: label with matching for attribute
                if el_id:
                    label_loc = target.locator(f"label[for='{el_id}']")
                    if await label_loc.count() > 0:
                        label_text = (await label_loc.first.inner_text()).strip()

                # Priority 2: aria-labelledby reference
                if not label_text and aria_lbl_id:
                    lbl_el = target.locator(f"#{aria_lbl_id}")
                    if await lbl_el.count() > 0:
                        label_text = (await lbl_el.first.inner_text()).strip()

                # Priority 3: closest ancestor field/question container label
                if not label_text:
                    try:
                        ancestor_label = ta.locator("xpath=ancestor::*[contains(@class, 'field') or contains(@class, 'question') or contains(@class, 'form-group') or contains(@class, 'form-item') or self::div][1]//label")
                        if await ancestor_label.count() > 0:
                            label_text = (await ancestor_label.first.inner_text()).strip()
                    except Exception:
                        pass

                # Priority 4: parent or preceding sibling label
                if not label_text:
                    try:
                        prec_label = ta.locator("xpath=preceding::label[1]")
                        if await prec_label.count() > 0:
                            label_text = (await prec_label.first.inner_text()).strip()
                    except Exception:
                        pass

                # Priority 5: aria-label or placeholder
                if not label_text:
                    label_text = aria_label or placeholder or el_name or f"Custom Application Question {idx}"

                # Clean label: remove trailing asterisks and normalize whitespace
                clean_label = re.sub(r"[\*\:]+$", "", label_text).strip()
                clean_label = re.sub(r"\s+", " ", clean_label).strip()
                lower_label = clean_label.lower()

                # Strictly exclude standard profile fields
                if any(w in lower_label for w in EXCLUDED_KEYWORDS):
                    continue

                qid = f"q_{idx:03d}"
                selector = f"#{el_id}" if el_id else (f"textarea[name='{el_name}']" if el_name else f"textarea >> nth={i}")
                category = classify_question(clean_label)

                detected.append(DetectedFormFieldDTO(
                    questionId=qid,
                    selector=selector,
                    frameSelector=frame_selector,
                    tag="textarea",
                    label=clean_label,
                    category=category.value,
                ))
                idx += 1
                logger.info(f"Custom question detected: [{qid}] {clean_label} (category={category.value})")
            except Exception as ex:
                logger.error(f"Error inspecting textarea {i}: {ex}")

        return detected

    async def fill_custom_answers(self, session_id: str, answers: list[BatchFillAnswerDTO]) -> BatchFillResponse:
        """Map generated Q&A answers back to exact DOM fields using stable question IDs."""
        session_ctx = self._browser_contexts.get(session_id)
        if not session_ctx:
            raise ValueError(f"Active browser session {session_id} not found or has expired.")

        page = session_ctx["page"]
        fields_map = self._session_custom_fields.get(session_id, {})
        form_ctx = self._session_form_contexts.get(session_id)
        filled_count = 0
        failed_questions: list[str] = []

        for item in answers:
            field_dto = fields_map.get(item.questionId)
            if not field_dto:
                logger.warning(f"No selector descriptor found for question {item.questionId} in session {session_id}")
                failed_questions.append(item.questionId)
                continue

            try:
                # Dynamic locator re-queries live DOM to survive SPA re-rendering
                # If field has frameSelector, or form_ctx is iframe, scope through the frame!
                if field_dto.frameSelector:
                    try:
                        locator = page.frame_locator(field_dto.frameSelector).locator(field_dto.selector).first
                    except Exception:
                        locator = page.locator(field_dto.selector).first
                elif form_ctx and form_ctx.is_iframe:
                    locator = form_ctx.container.locator(field_dto.selector).first
                else:
                    locator = page.locator(field_dto.selector).first

                await locator.scroll_into_view_if_needed(timeout=3000)
                await locator.fill(item.answerText)
                # Apply emerald visual highlight
                await locator.evaluate(
                    "el => { el.style.outline = '2px solid #10B981'; el.style.backgroundColor = 'rgba(16, 185, 129, 0.08)'; }"
                )
                filled_count += 1
                logger.info(f"Filled custom answer for question {item.questionId}")
            except Exception as e:
                logger.warning(f"Failed to fill answer for {item.questionId}: {e}")
                failed_questions.append(item.questionId)

        return BatchFillResponse(
            sessionId=session_id,
            filledCount=filled_count,
            failedQuestions=failed_questions,
        )


playwright_autofill_engine = PlaywrightAutofillEngine()
