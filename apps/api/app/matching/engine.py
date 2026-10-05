"""Deterministic Matching & Opportunity Scoring Engine adhering to ARCHITECTURE.md."""

import logging
import re

from app.matching.hard_filters import HardFilterService, hard_filter_service
from app.schemas.job import CanonicalJob
from app.schemas.matching import MatchTier, ScoredJobOpportunity
from app.schemas.profile import Profile
from app.services.profile_service import profile_service

logger = logging.getLogger("jobFinder.matching")


class MatchingEngineService:
    """Core deterministic opportunity matcher providing explainable fit scores."""

    def __init__(self, filters: HardFilterService | None = None):
        self.filters = filters or hard_filter_service

    def _normalize_skill_string(self, skill: str) -> str:
        """Normalize skill string for resilient token matching."""
        s = skill.lower().strip()
        s = re.sub(r"[^a-z0-9+#.]", "", s)
        s = s.replace("nodejs", "node").replace("reactjs", "react").replace("nextjs", "next")
        return s

    def evaluate_skills_overlap(
        self,
        job_skills: list[str],
        verified_skills: list[str],
    ) -> tuple[list[str], list[str], float]:
        """Compute verified matched skills, missing skills, and skill fit score."""
        if not job_skills:
            return verified_skills[:3], [], 85.0

        verified_map = {self._normalize_skill_string(s): s for s in verified_skills}
        matched: list[str] = []
        missing: list[str] = []

        for req in job_skills:
            norm_req = self._normalize_skill_string(req)
            if norm_req in verified_map or any(
                norm_req in v or v in norm_req for v in verified_map
            ):
                matched.append(req)
            else:
                missing.append(req)

        # 1. Base skill match percentage (0 to 100)
        match_ratio = len(matched) / max(len(job_skills), 1)
        base_skill_score = match_ratio * 100.0

        # 2. Missing skills deduction: 3% deduction per missing required skill (capped at 30%)
        missing_penalty = min(30.0, len(missing) * 3.0)
        skills_score = max(15.0, base_skill_score - missing_penalty)

        return matched, missing, skills_score

    def compute_fit_score(
        self,
        job: CanonicalJob,
        profile: Profile,
    ) -> tuple[int, MatchTier, list[str], list[str]]:
        """Calculate calibrated fit score with user-defined experience penalties for freshers."""
        verified_skill_names = [s.name for s in profile.skills if s.verified]
        if not verified_skill_names:
            verified_skill_names = [s.name for s in profile.skills]

        matched, missing, skills_score = self.evaluate_skills_overlap(
            job.requiredSkills, verified_skill_names
        )

        # Title leadership & senior level check
        title_lower = job.title.lower()
        leadership_keywords = [
            "director",
            "associate director",
            "vp",
            "vice president",
            "head of",
            "principal",
            "staff",
            "lead",
            "manager",
            "architect",
        ]
        is_leadership_title = any(kw in title_lower for kw in leadership_keywords)

        # Experience & Seniority Penalty Ladder (Candidate has 0-1 yr / fresher background)
        exp_years = job.experienceYearsRequired or 0.0
        seniority = (job.seniority or "").lower()

        # Determine experience adjustment and strict score cap based on required years
        # Note: Candidate is a Fresher with 0-1 yr background. Required years ALWAYS takes precedence over titles.
        if exp_years >= 5.0 or seniority in ("senior", "lead", "principal", "director"):
            exp_adjustment = -46.0      # 5+ years / Senior Principal
            max_score_cap = 35          # Senior roles cannot exceed Low Match for a fresher
        elif exp_years >= 4.0:
            exp_adjustment = -36.0      # 4+ to 5 years required
            max_score_cap = 45
        elif exp_years >= 3.0:
            exp_adjustment = -30.0      # 3+ to 4 years required (e.g. 3+ yrs Associate Director, Assistant Manager)
            max_score_cap = 49          # Cannot exceed Low Match
        elif exp_years >= 2.0:
            exp_adjustment = -25.0      # 2+ to 3 years required (e.g. 2+ yrs Brand Associate / Monetisation)
            max_score_cap = 65          # Strictly capped at Moderate Match (never Strong)
        elif exp_years > 1.0:
            exp_adjustment = -18.0      # 1+ to 2 years required
            max_score_cap = 75          # Capped at Good Match
        elif is_leadership_title:
            exp_adjustment = -38.0      # Leadership role without explicit high years
            max_score_cap = 35
        else:
            # Candidate fits 0-1 years / Fresher / Intern role
            exp_adjustment = 5.0        # +5% Fresher Boost for true entry/intern roles!
            max_score_cap = 98

        # Work mode adjustments
        work_mode_mult = 1.0
        if job.workMode == "remote":
            work_mode_mult = 1.02
        elif job.workMode == "hybrid":
            work_mode_mult = 1.0
        elif job.workMode == "onsite":
            work_mode_mult = 0.96

        # Category alignment
        cat_mult = 1.0
        if job.category in ("technical", "data", "qa"):
            cat_mult = 1.02
        else:
            cat_mult = 0.95

        raw_score = (skills_score + exp_adjustment) * work_mode_mult * cat_mult
        final_score = round(min(max_score_cap, max(15, raw_score)))

        # Calibrated Tier Thresholds
        if final_score >= 90:
            tier: MatchTier = "Strong"
        elif final_score >= 75:
            tier = "Good"
        elif final_score >= 50:
            tier = "Moderate"
        elif final_score >= 35:
            tier = "Low"
        else:
            tier = "Not a Match"

        return final_score, tier, matched, missing

    def generate_deterministic_fit_reason(
        self,
        job: CanonicalJob,
        matched_skills: list[str],
        missing_skills: list[str],
        fit_score: int,
    ) -> str:
        """Deterministic, grounded explanation strictly using verified facts (Zero Token Cost)."""
        exp_years = job.experienceYearsRequired or 0.0
        title_lower = job.title.lower()
        is_leadership = any(
            k in title_lower
            for k in ["director", "vp", "lead", "manager", "principal", "architect"]
        )

        if exp_years >= 2.0 or is_leadership or job.seniority in ("senior", "lead"):
            years_label = f"{int(exp_years)}+" if exp_years >= 2.0 else "extensive"
            return f"Experience gap: This {job.title} role asks for {years_label} years of experience/leadership, exceeding your current fresher background despite partial skill overlap."

        if matched_skills:
            skills_str = ", ".join(matched_skills[:3])
            if fit_score >= 90:
                return f"Exceptional fit. Your verified experience with {skills_str} directly matches their primary stack with strong {job.workMode} alignment."
            elif fit_score >= 75:
                return f"Strong alignment. Your verified background in {skills_str} covers core qualifications for this {job.experienceText or job.seniority} {job.category.replace('_', ' ')} role."
            else:
                missing_str = missing_skills[0] if missing_skills else "secondary tools"
                return f"Foundational match. Relevant for your verified {skills_str} skillset with growth opportunity in {missing_str}."
        else:
            return f"Relevant {job.seniority} {job.category.replace('_', ' ')} role at {job.company} with {job.workMode} flexibility in {job.location}."

    def score_and_job_opportunity(
        self,
        job: CanonicalJob,
        profile: Profile | None = None,
    ) -> ScoredJobOpportunity | None:
        """Score a single job against profile after hard filter validation."""
        user_profile = profile or profile_service.get_profile()

        # 1. Hard Exclusion Filters (Location: India/Remote, Language: English)
        passes, reason = self.filters.passes_hard_filters(job, user_profile)
        if not passes:
            logger.info(f"Filtered out '{job.title}' ({job.location}): {reason}")
            return None

        # 2. Compute Fit Score
        fit_score, tier, matched, missing = self.compute_fit_score(job, user_profile)

        # 3. Deterministic Grounded Reason
        fit_reason = self.generate_deterministic_fit_reason(job, matched, missing, fit_score)

        salary_text = None
        if job.compensation and job.compensation.min:
            if job.compensation.interval == "hour":
                salary_text = f"{job.compensation.currency} {job.compensation.min:,.0f} / hr"
            elif job.compensation.interval == "month":
                max_part = (
                    f" - {job.compensation.max:,.0f}"
                    if job.compensation.max and job.compensation.max != job.compensation.min
                    else ""
                )
                salary_text = (
                    f"{job.compensation.currency} {job.compensation.min:,.0f}{max_part} / month"
                )
            else:
                max_part = (
                    f" - {job.compensation.max:,.0f}"
                    if job.compensation.max and job.compensation.max != job.compensation.min
                    else ""
                )
                salary_text = (
                    f"{job.compensation.currency} {job.compensation.min:,.0f}{max_part} / year"
                )
        elif job.compensation and job.compensation.rawString:
            salary_text = job.compensation.rawString

        return ScoredJobOpportunity(
            id=job.id,
            title=job.title,
            company=job.company,
            location=job.location,
            workMode=job.workMode,
            category=job.category,
            employmentType=job.employmentType,
            seniority=job.seniority,
            experienceYearsRequired=job.experienceYearsRequired,
            experienceText=job.experienceText,
            postedAt=job.postedAt,
            postedDateText=job.postedDateText or "Active posting",
            fitScore=fit_score,
            matchTier=tier,
            fitReason=fit_reason,
            matchedSkills=matched,
            missingSkills=missing[:3],
            compensation=job.compensation,
            salaryText=salary_text,
            description=job.description,
            descriptionBlocks=job.descriptionBlocks,
            sourceUrl=job.sourceRef.originalUrl,
            sourceAdapter=job.sourceRef.adapter,
            rawJob=job,
        )

    # Alias for compatibility
    def score_and_rank_job(
        self, job: CanonicalJob, profile: Profile | None = None
    ) -> ScoredJobOpportunity | None:
        return self.score_and_job_opportunity(job, profile)

    def rank_all_opportunities(
        self,
        jobs: list[CanonicalJob],
        profile: Profile | None = None,
    ) -> list[ScoredJobOpportunity]:
        """Filter, score, and rank all active job opportunities."""
        user_profile = profile or profile_service.get_profile()
        scored_list: list[ScoredJobOpportunity] = []

        for job in jobs:
            scored = self.score_and_job_opportunity(job, user_profile)
            if scored:
                scored_list.append(scored)

        return sorted(scored_list, key=lambda s: s.fitScore, reverse=True)


matching_engine = MatchingEngineService()
