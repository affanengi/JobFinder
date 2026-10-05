"""Deterministic Claim-Level Truth-Lock Validator for ATS Custom Questions."""

import logging
import re
from typing import Literal
from app.schemas.profile import Profile
from app.services.resume_validator import resume_validator

logger = logging.getLogger("jobFinder.qa_claim_validator")

# Known technologies to check against profile
COMMON_TECH_PATTERNS = ['\\bkubernetes\\b', '\\bk8s\\b', '\\bdocker\\b', '\\baws\\b', '\\bgcp\\b', '\\bazure\\b', '\\bpython\\b', '\\btypescript\\b', '\\bjavascript\\b', '\\bgolang\\b', '\\bgo\\b', '\\brust\\b', '\\breact\\b', '\\bnext\\.?js\\b', '\\bvue\\b', '\\bangular\\b', '\\bnode\\.?js\\b', '\\bfastapi\\b', '\\bpostgres(?:ql)?\\b', '\\bmongodb\\b', '\\bredis\\b', '\\bgraphql\\b', '\\bkafka\\b', '\\brabbitmq\\b', '\\btensorflow\\b', '\\bpytorch\\b', '\\bplaywright\\b', '\\bci/cd\\b', '\\bterraform\\b', '\\bspark\\b', '\\bhadoop\\b', '\\belasticsearch\\b', '\\bdjang[o]?\\b', '\\bflask\\b', '\\bspring\\s*boot\\b']


class QAClaimValidatorService:
    """Zero-AI-cost claim validator verifying quantitative, entity, and technology claims."""

    def validate_answer(
        self, answer_text: str, profile: Profile
    ) -> tuple[Literal["VERIFIED", "REQUIRES_REVIEW", "REJECTED"], list[str], list[str]]:
        """Evaluate answer claims against the authoritative Verified Master Profile.

        Returns:
            status: "VERIFIED", "REQUIRES_REVIEW", or "REJECTED"
            violations: List of specific unverified factual claim descriptions
            fact_ids_used: Stable fact IDs from the Master Profile supporting the answer
        """
        if not answer_text or not answer_text.strip():
            return "REJECTED", ["Answer is empty."], []

        violations: list[str] = []
        fact_ids_used: list[str] = []

        # 1. Quantitative Metric Verification
        # Extract all numbers from generated answer
        answer_numbers = resume_validator._extract_metric_numbers(answer_text)

        # Build allowed numbers set across ALL verified projects and experiences
        allowed_numbers: set[str] = set()
        for p in profile.projects:
            allowed_numbers.update(resume_validator._build_verified_item_number_set(p.model_dump()))
        for e in profile.experience:
            allowed_numbers.update(resume_validator._build_verified_item_number_set(e.model_dump()))
        for ed in profile.education:
            allowed_numbers.update(resume_validator._build_verified_item_number_set(ed.model_dump()))

        unsupported_nums = answer_numbers - allowed_numbers
        # Filter out numbers that are common dates/years (e.g. 2020-2026)
        allowed_years = {"2020", "2021", "2022", "2023", "2024", "2025", "2026"}
        unsupported_metrics = {n for n in unsupported_nums if n not in allowed_years}

        if unsupported_metrics:
            violations.append(
                f"Unsupported quantitative metrics claimed: {sorted(unsupported_metrics)} not verified in Master Profile."
            )

        # 2. Technology Claims Verification
        verified_techs = {s.name.lower().strip() for s in profile.skills}
        for p in profile.projects:
            verified_techs.update(t.lower().strip() for t in p.technologies)
        # Add canonical aliases
        if "react" in verified_techs or "react.js" in verified_techs:
            verified_techs.update({"react", "react.js", "reactjs"})
        if "node" in verified_techs or "node.js" in verified_techs:
            verified_techs.update({"node", "node.js", "nodejs"})

        # Check for claimed common technologies in answer
        ans_lower = answer_text.lower()
        for pat in COMMON_TECH_PATTERNS:
            match = re.search(pat, ans_lower)
            if match:
                claimed = match.group(0).lower().replace("k8s", "kubernetes")
                claimed_clean = re.sub(r"[^a-z0-9]", "", claimed)
                is_verified = any(
                    claimed == vt or claimed_clean == re.sub(r"[^a-z0-9]", "", vt)
                    for vt in verified_techs
                )
                # If candidate explicitly states they DO NOT have experience, do not penalize
                negation_pattern = rf"\b(?:no|not|neither|nor|without|lack|have not)\b[^.?!]{{1,80}}\b{re.escape(match.group(0))}\b"
                if not is_verified and not re.search(negation_pattern, ans_lower):
                    violations.append(
                        f"Unsupported technology claim: '{match.group(0)}' is not in your verified skills or projects."
                    )

        # 3. Associate Matched Fact IDs
        for p in profile.projects:
            p_name = p.name.lower().split("(")[0].strip()
            if p_name and p_name in ans_lower:
                fact_ids_used.append(p.id)

        for e in profile.experience:
            e_co = e.company.lower().split("(")[0].strip()
            if e_co and e_co in ans_lower:
                fact_ids_used.append(e.id)

        for s in profile.skills:
            if s.name.lower() in ans_lower and s.id not in fact_ids_used:
                fact_ids_used.append(s.id)

        if violations:
            logger.warning(f"QA Truth-Lock violation detected: {violations}")
            return "REJECTED", violations, fact_ids_used

        return "VERIFIED", [], fact_ids_used


qa_claim_validator = QAClaimValidatorService()
