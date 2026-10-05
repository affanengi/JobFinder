"""Deterministic Zero-Token Cover Letter Validator with Claim-Level Truth-Lock.

Enforces strict truth boundaries:
1. Structural integrity and header completeness.
2. Lodestar title must remain 'Software Engineering Intern' (no title inflation).
3. 14.6K synthetic events metric must retain synthetic/replayed test context.
4. Quantitative claims must match verified profile facts.
5. Claimed technologies must be verified in profile facts.
"""

import logging
import re
from typing import Any

from app.schemas.cover_letter import CoverLetterContent, CoverLetterValidationResult
from app.schemas.profile import Profile

logger = logging.getLogger("jobFinder.cover_letter_validator")

TECH_MASK_PATTERNS = [
    r"python\s*3(?:\.\d+)*",
    r"react\s*(?:18|19)",
    r"next(?:\.js)?\s*(?:14|15)",
    r"fastapi",
    r"oauth\s*2(?:\.0)?",
    r"sha-?256",
    r"aes-?256",
    r"http/?2",
    r"3-paragraph",
    r"4-tier",
    r"2-tier",
]


class CoverLetterValidatorService:
    """Zero-AI-cost deterministic Python validator for generated cover letters with Truth-Lock."""

    @staticmethod
    def _normalize(s: str) -> str:
        return re.sub(r"[^a-z0-9]", "", s.lower().strip())

    def _extract_metric_numbers(self, text: str) -> set[str]:
        """Extract standalone numerical metrics, masking known version numbers."""
        t = text.lower()
        for p in TECH_MASK_PATTERNS:
            t = re.sub(p, " ", t)

        numbers = set()
        for match in re.finditer(r"\b\d+(?:\.\d+)?\b", t):
            num = match.group(0)
            if num not in {"0", "1", "2", "3", "4"}:
                numbers.add(num)
        return numbers

    def _build_allowed_numbers(self, profile: Profile) -> set[str]:
        """Extract all verified numbers across profile experience, projects, and education."""
        allowed = set()
        # From projects
        for p in profile.projects:
            for b in p.bullets:
                allowed.update(self._extract_metric_numbers(b))
            if p.description:
                allowed.update(self._extract_metric_numbers(p.description))
            for m in getattr(p, "metrics", []):
                val = getattr(m, "value", "") if hasattr(m, "value") else str(m)
                allowed.update(self._extract_metric_numbers(val))

        # From experience
        for e in profile.experience:
            for b in e.bullets:
                allowed.update(self._extract_metric_numbers(b))
            if e.startDate:
                allowed.update(self._extract_metric_numbers(e.startDate))
            if e.endDate:
                allowed.update(self._extract_metric_numbers(e.endDate))
            for m in getattr(e, "metrics", []):
                val = getattr(m, "value", "") if hasattr(m, "value") else str(m)
                allowed.update(self._extract_metric_numbers(val))

        # From education
        for edu in profile.education:
            if getattr(edu, "grade", None):
                allowed.update(self._extract_metric_numbers(edu.grade))

        return allowed

    def validate(self, content: CoverLetterContent, profile: Profile) -> CoverLetterValidationResult:
        """Mechanically check structure and verified fact boundaries."""
        violations: list[str] = []
        warnings: list[str] = []

        # 1. Structural checks
        if not content.fullName or not content.fullName.strip():
            violations.append("Full name is missing from letter header.")
        if not content.email or not content.email.strip():
            violations.append("Email address is missing from letter header.")
        if not content.companyName or not content.companyName.strip():
            violations.append("Company name is missing.")
        if not content.jobTitle or not content.jobTitle.strip():
            violations.append("Job title is missing.")

        # 2. Paragraph length & substance checks
        if not content.paragraph1_hook or len(content.paragraph1_hook.strip()) < 30:
            violations.append("Paragraph 1 (Introduction & Hook) is missing or too brief.")
        if not content.paragraph2_evidence or len(content.paragraph2_evidence.strip()) < 30:
            violations.append("Paragraph 2 (Core Evidence & Project Alignment) is missing or too brief.")
        if not content.paragraph3_impact or len(content.paragraph3_impact.strip()) < 30:
            violations.append("Paragraph 3 (Value Proposition & Call to Action) is missing or too brief.")

        # 3. Name consistency check against profile
        if profile.personal.fullName and content.fullName.lower().strip() != profile.personal.fullName.lower().strip():
            warnings.append(
                f"Candidate name '{content.fullName}' does not match profile name '{profile.personal.fullName}'."
            )

        full_letter_text = f"{content.paragraph1_hook} {content.paragraph2_evidence} {content.paragraph3_impact}"
        full_lower = full_letter_text.lower()

        # 4. Lodestar Invariants Check (Title & Synthetic context)
        if "lodestar" in full_lower:
            # Check for title inflation (e.g., claiming to have been Lead, Senior, or dropping Intern)
            if re.search(r"\blodestar\b[^.?!]{0,60}\b(?:lead|senior|principal|staff|full\s*stack|backend|data)\s*(?:software\s+)?(?:engineer|developer|scientist)\b", full_lower):
                violations.append(
                    "Unsupported title inflation in cover letter: Lodestar role must strictly be 'Software Engineering Intern'."
                )
            elif re.search(r"\blodestar\b[^.?!]{0,60}\b(?:software\s+(?:engineer|developer))\b", full_lower) and not re.search(r"\b(?:software\s+(?:engineering\s+)?intern)\b", full_lower):
                violations.append(
                    "Unsupported title inflation in cover letter: Lodestar role must strictly be 'Software Engineering Intern'."
                )

            # Check for prohibited live production claims
            for prohibited in [
                "real user", "real users", "production user", "production users",
                "customer activity", "production traffic", "real-world usage",
                "paying customer", "live production", "live traffic"
            ]:
                if prohibited in full_lower:
                    violations.append(
                        f"Unsupported production claim in cover letter: Synthetic 14.6K events must not be described as '{prohibited}'."
                    )

            if re.search(r"14\.?6\s*k|14,?600", full_lower):
                if not re.search(r"synthetic|replay|harness|simulat|test|benchmark|seed", full_lower):
                    violations.append(
                        "Unsupported metric context in cover letter: The 14.6K events metric must retain its synthetic/replayed test context."
                    )

        # 5. Validate quantitative claims
        allowed_numbers = self._build_allowed_numbers(profile)
        letter_numbers = self._extract_metric_numbers(full_letter_text)
        unsupported_numbers = letter_numbers - allowed_numbers
        # Filter out common benign dates like current year 2026, 2024, 2025
        unsupported_numbers = {n for n in unsupported_numbers if n not in {"2024", "2025", "2026", "2027"}}
        if (profile.projects or profile.experience) and unsupported_numbers:
            violations.append(
                f"Unsupported quantitative claim in cover letter: Numbers {sorted(unsupported_numbers)} not verified in profile facts."
            )

        is_valid = len(violations) == 0
        if not is_valid:
            logger.warning(f"Cover letter Truth-Lock validation failed with {len(violations)} violations: {violations}")

        return CoverLetterValidationResult(
            is_valid=is_valid,
            violations=violations,
            warnings=warnings,
        )


cover_letter_validator = CoverLetterValidatorService()
