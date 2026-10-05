"""Deterministic Python Resume Validator with Zero AI Token Cost."""

import logging
import re
from typing import Any, Literal

from app.schemas.profile import ExperienceFact, Profile, ProjectFact
from app.schemas.resume import ResumeValidationResult, StructuredResumeContent

logger = logging.getLogger("jobFinder.resume_validator")

TECH_MASK_PATTERNS = [
    r'python\s*3(?:\.\d+)*',
    r'react\s*(?:18|19)',
    r'next(?:\.js)?\s*(?:14|15)',
    r'tailwind(?:\s*css)?\s*v?\d*',
    r'gemini\s*(?:1\.5|2\.0|2\.5)',
    r'fastapi',
    r'oauth\s*2(?:\.0)?',
    r'sha-?256',
    r'aes-?256',
    r'http/?2',
    r'3-tier',
    r'4-tier',
    r'2-tier',
    r'1-page',
    r'3-paragraph',
    r'4 categories',
    r'iso\s*27001',
    r'wcag\s*2(?:\.1)?',
]


class ResumeValidatorService:
    """Mechanically validates structured resume claims, metrics, and structural density against verified facts."""

    def _normalize(self, s: str) -> str:
        return re.sub(r"[^a-z0-9]", "", s.lower().strip())

    def _extract_metric_numbers(self, text: str) -> set[str]:
        """Extract standalone numeric sequences from text, ignoring standard technical versions."""
        t = text.lower()
        for p in TECH_MASK_PATTERNS:
            t = re.sub(p, ' ', t)

        numbers = set()
        for match in re.finditer(r'\b\d+(?:\.\d+)?\b', t):
            num_str = match.group(0)
            # Ignore 0..4 as they are frequently used in non-metric grammatical contexts (e.g., "1 system", "4 pillars")
            if num_str not in {"0", "1", "2", "3", "4"}:
                numbers.add(num_str)
        return numbers

    def _build_verified_item_number_set(self, item_dict: dict[str, Any] | Any) -> set[str]:
        """Extract all valid numbers from a verified project or experience item."""
        combined_text = []
        if "description" in item_dict and item_dict["description"]:
            combined_text.append(str(item_dict["description"]))
        if "bullets" in item_dict and item_dict["bullets"]:
            combined_text.extend([str(b) for b in item_dict["bullets"]])
        if "startDate" in item_dict and item_dict["startDate"]:
            combined_text.append(str(item_dict["startDate"]))
        if "endDate" in item_dict and item_dict["endDate"]:
            combined_text.append(str(item_dict["endDate"]))
        if "metrics" in item_dict and item_dict["metrics"]:
            for m in item_dict["metrics"]:
                if isinstance(m, dict):
                    combined_text.append(f"{m.get('metric', '')} {m.get('value', '')} {m.get('context', '')}")
                else:
                    combined_text.append(str(m))

        numbers = set()
        for text in combined_text:
            numbers.update(self._extract_metric_numbers(text))
            # Also explicitly extract raw numbers
            for match in re.finditer(r'\b\d+(?:\.\d+)?\b', text):
                numbers.add(match.group(0))
        return numbers

    def validate(
        self,
        resume: StructuredResumeContent,
        profile: Profile,
        enforce_structural: bool = True,
    ) -> ResumeValidationResult:
        """Deterministically verify fact IDs, entity names, claimed skills, numerical metrics, and structural density."""
        truth_violations: list[str] = []
        structural_violations: list[str] = []
        verified_fact_count = 0

        # Build lookup tables from verified Master Profile facts with compound & alias expansion
        verified_skill_map = {}
        target_skills = [s for s in profile.skills if s.verified] or profile.skills
        for s in target_skills:
            norm = self._normalize(s.name)
            verified_skill_map[norm] = s
            # Expand compound skills like "Google Gemini / LLM APIs", "TypeScript / React", etc.
            for subpart in re.split(r"[/&+,]", s.name):
                clean_sub = subpart.strip()
                if clean_sub:
                    verified_skill_map[self._normalize(clean_sub)] = s
            # Special case for Gemini / LLM APIs
            if "gemini" in s.name.lower():
                verified_skill_map["gemini"] = s
                verified_skill_map["geminiapi"] = s
                verified_skill_map["googlegemini"] = s
                verified_skill_map["googlegeminiapi"] = s

        all_fact_ids = set()
        for s in profile.skills:
            all_fact_ids.add(s.id)
        for exp in profile.experience:
            all_fact_ids.add(exp.id)
        for proj in profile.projects:
            all_fact_ids.add(proj.id)
        for edu in profile.education:
            all_fact_ids.add(edu.id)
        for cert in profile.courseCertifications:
            all_fact_ids.add(cert.id)

        verified_exp_map = {self._normalize(e.company): e for e in profile.experience}
        verified_proj_map = {self._normalize(p.name): p for p in profile.projects}
        verified_edu_map = {self._normalize(ed.institution): ed for ed in profile.education}
        verified_course_map = {self._normalize(c.title): c for c in profile.courseCertifications}

        # 1. Validate Fact IDs in Summary
        for fid in resume.summary_fact_ids:
            if fid in all_fact_ids:
                verified_fact_count += 1
            else:
                logger.debug(f"Unmatched summary fact ID: {fid}")

        # 2. Validate Claimed Skills (Must exist in candidate's verified profile)
        for cat in resume.skills:
            for skill_name in cat.items:
                norm_skill = self._normalize(skill_name)
                is_matched = False
                clean_norm_skill = re.sub(r"(apis?|framework|library)$", "", norm_skill).strip()
                if norm_skill in verified_skill_map or clean_norm_skill in verified_skill_map:
                    is_matched = True
                elif len(norm_skill) >= 3:
                    for k in verified_skill_map:
                        clean_k = re.sub(r"(apis?|framework|library)$", "", k).strip()
                        if len(k) >= 3 and (
                            norm_skill in k or k in norm_skill or
                            (clean_norm_skill and (clean_norm_skill in clean_k or clean_k in clean_norm_skill))
                        ):
                            is_matched = True
                            break
                if not is_matched:
                    truth_violations.append(
                        f"Unsupported skill claim: '{skill_name}' is not in your verified Master Profile."
                    )
                else:
                    verified_fact_count += 1

            for fid in cat.source_fact_ids:
                if fid in all_fact_ids:
                    verified_fact_count += 1

        # 3. Validate Experience & Leadership Entries (Company, Job Titles, Dates, Descriptions & Numbers)
        all_exp_entries = list(resume.experience) + list(getattr(resume, "leadership", []) or [])
        lodestar_count = 0

        for exp_item in all_exp_entries:
            norm_co = self._normalize(exp_item.company)
            matched_exp: ExperienceFact | None = None
            for exp_k, exp_v in verified_exp_map.items():
                if norm_co == exp_k or norm_co in exp_k or exp_k in norm_co:
                    matched_exp = exp_v
                    break

            if not matched_exp:
                truth_violations.append(
                    f"Unsupported employer claim: '{exp_item.company}' is not in your verified experience history."
                )
            else:
                verified_fact_count += 1
                exp_dict: dict[str, Any] = (
                    matched_exp.model_dump()
                    if hasattr(matched_exp, "model_dump")
                    else (matched_exp if isinstance(matched_exp, dict) else vars(matched_exp))
                )
                allowed_numbers = self._build_verified_item_number_set(exp_dict)

                # Lodestar Truth-Lock: Role title, synthetic metric context, no unsupported production claims
                if "lodestar" in norm_co:
                    lodestar_count += 1
                    if exp_item.title.strip().lower() != "software engineering intern":
                        truth_violations.append(
                            f"Unsupported title claim: Lodestar title must be strictly 'Software Engineering Intern', got '{exp_item.title}'."
                        )

                    for b in exp_item.bullets:
                        b_lower = b.text.lower()
                        # Strict rejection of production claims for synthetic event replay
                        for prohibited in [
                            "real user", "real users", "production user", "production users",
                            "customer activity", "production traffic", "real-world usage",
                            "user-generated production", "live production", "live traffic",
                            "active users", "paying customer", "production scale", "revenue impact"
                        ]:
                            if prohibited in b_lower:
                                truth_violations.append(
                                    f"Unsupported production claim in Lodestar: Synthetic 14.6K events must not be described as '{prohibited}'."
                                )

                        if re.search(r"14\.?6\s*k|14,?600", b_lower):
                            if not re.search(r"synthetic|replay|harness|simulat|test|benchmark", b_lower):
                                truth_violations.append(
                                    "Unsupported metric context in Lodestar: The 14.6K events metric must retain its synthetic/replayed test context."
                                )

                # Validate Date accuracy (Techniva: 2024-2026, no Present)
                if "techniva" in norm_co:
                    if exp_item.endDate and "present" in exp_item.endDate.lower():
                        truth_violations.append(
                            "Unsupported date claim: Techniva Technical Club end date must be '2026', not 'Present'."
                        )

                # Validate bullet content & quantitative claims
                for b in exp_item.bullets:
                    b_text = b.text.strip()
                    # Check for prohibited phrasing
                    if "techniva" in norm_co:
                        if "college fest" in b_text.lower() or "cultural fest" in b_text.lower():
                            truth_violations.append(
                                "Unsupported description: Techniva is a technical club, not a college/cultural fest."
                            )

                    # Extract numbers from bullet and verify against allowed set
                    bullet_numbers = self._extract_metric_numbers(b_text)
                    unsupported_nums = bullet_numbers - allowed_numbers
                    if unsupported_nums:
                        truth_violations.append(
                            f"Unsupported quantitative claim in experience '{exp_item.company}': numbers {sorted(unsupported_nums)} not verified in profile facts."
                        )

            if exp_item.experience_fact_id and exp_item.experience_fact_id in all_fact_ids:
                verified_fact_count += 1

            for b in exp_item.bullets:
                for fid in b.source_fact_ids:
                    if fid in all_fact_ids:
                        verified_fact_count += 1

        if lodestar_count > 1:
            truth_violations.append("Duplicate canonical experience: Lodestar appears more than once.")

        # 4. Validate Projects (Project Name, Technologies & Quantitative Claims)
        for proj_item in resume.projects:
            norm_pname = self._normalize(proj_item.name)
            base_pname = self._normalize(re.sub(r"\(.*?\)", "", proj_item.name))

            matched_proj: ProjectFact | None = None
            # Direct match by fact ID if provided
            if getattr(proj_item, "project_fact_id", None) and proj_item.project_fact_id in all_fact_ids:
                for p in profile.projects:
                    if p.id == proj_item.project_fact_id:
                        matched_proj = p
                        break

            # Truth-preserving canonical identity matching (parenthetical subtitles ignored, generic token overlap forbidden)
            if not matched_proj:
                for proj_k, proj_v in verified_proj_map.items():
                    norm_vname = proj_k
                    base_vname = self._normalize(re.sub(r"\(.*?\)", "", getattr(proj_v, "name", "")))

                    # 1. Exact normalized match or direct substring containment of full title
                    if norm_pname == norm_vname or norm_pname in norm_vname or norm_vname in norm_pname:
                        matched_proj = proj_v
                        break

                    # 2. Canonical base identity match (ignoring parenthetical descriptions like '(LinkedIn Clone)')
                    if base_pname and base_vname and (base_pname == base_vname or base_pname in base_vname or base_vname in base_pname):
                        matched_proj = proj_v
                        break

            if not matched_proj:
                truth_violations.append(
                    f"Unsupported project claim: '{proj_item.name}' is not in your verified Master Profile projects."
                )
            else:
                verified_fact_count += 1
                proj_dict: dict[str, Any] = (
                    matched_proj.model_dump()
                    if hasattr(matched_proj, "model_dump")
                    else (matched_proj if isinstance(matched_proj, dict) else vars(matched_proj))
                )
                allowed_numbers = self._build_verified_item_number_set(proj_dict)

                # Validate bullet quantitative claims
                for b in proj_item.bullets:
                    b_text = b.text.strip()
                    bullet_numbers = self._extract_metric_numbers(b_text)
                    unsupported_nums = bullet_numbers - allowed_numbers
                    if unsupported_nums:
                        truth_violations.append(
                            f"Unsupported quantitative claim in project '{proj_item.name}': numbers {sorted(unsupported_nums)} not verified in profile facts."
                        )

            if proj_item.project_fact_id and proj_item.project_fact_id in all_fact_ids:
                verified_fact_count += 1

            for b in proj_item.bullets:
                for fid in b.source_fact_ids:
                    if fid in all_fact_ids:
                        verified_fact_count += 1

        # 5. Validate Education
        for edu_item in resume.education:
            norm_inst = self._normalize(edu_item.institution)
            if norm_inst not in verified_edu_map and not any(
                norm_inst in edu_k or edu_k in norm_inst for edu_k in verified_edu_map
            ):
                truth_violations.append(
                    f"Unsupported education claim: '{edu_item.institution}' is not in your verified Master Profile education."
                )
            else:
                verified_fact_count += 1

        # 5.5 Validate Courses & Certifications
        profile_courses = [c for c in profile.courseCertifications if getattr(c, "verified", True)]
        seen_course_ids = set()

        for cert_item in (resume.course_certifications or []):
            norm_title = self._normalize(cert_item.title)
            matched_cert = None

            # 1. Match by course_fact_id
            if getattr(cert_item, "course_fact_id", None):
                if cert_item.course_fact_id not in all_fact_ids:
                    truth_violations.append(
                        f"Unknown course ID claim: '{cert_item.course_fact_id}' does not exist in verified profile."
                    )
                    continue
                for c in profile.courseCertifications:
                    if c.id == cert_item.course_fact_id:
                        matched_cert = c
                        break

            # 2. Match by normalized title
            if not matched_cert:
                for cert_k, cert_v in verified_course_map.items():
                    if norm_title == cert_k or norm_title in cert_k or cert_k in norm_title:
                        matched_cert = cert_v
                        break

            if not matched_cert:
                truth_violations.append(
                    f"Unsupported course certification claim: '{cert_item.title}' is not in your verified Master Profile courses."
                )
            else:
                seen_course_ids.add(matched_cert.id)
                verified_fact_count += 1

                # Check description immutability
                if matched_cert.description:
                    norm_expected = " ".join(matched_cert.description.split()).strip()
                    norm_actual = " ".join((cert_item.description or "").split()).strip()
                    if norm_actual != norm_expected:
                        truth_violations.append(
                            f"Altered verified course description: Course '{cert_item.title}' description was modified from canonical profile."
                        )

                # Check certificate URL
                if matched_cert.certificateUrl:
                    if cert_item.certificateUrl and cert_item.certificateUrl.strip() != matched_cert.certificateUrl.strip():
                        truth_violations.append(
                            f"Altered certificate URL: Course '{cert_item.title}' URL was modified."
                        )

                # Check instructor
                if getattr(matched_cert, "instructor", None):
                    if cert_item.instructor and cert_item.instructor.strip().lower() != matched_cert.instructor.strip().lower():
                        truth_violations.append(
                            f"Altered instructor: Course '{cert_item.title}' instructor '{cert_item.instructor}' does not match verified instructor '{matched_cert.instructor}'."
                        )

        # Ensure no eligible verified profile courses are missing if candidate has courses in profile
        if profile_courses and len(resume.course_certifications or []) > 0:
            for pc in profile_courses:
                if pc.id not in seen_course_ids:
                    truth_violations.append(
                        f"Missing verified course: Course '{pc.title}' is in verified profile but missing from resume."
                    )

        # 6. Validate Structural Hard Minimum Requirements
        if enforce_structural:
            # 6.1 Professional Summary minimum density (at least 5 rendered lines -> minimum 350 characters / 45 words)
            summary_clean = resume.summary.strip()
            if len(summary_clean) < 350 or len(summary_clean.split()) < 45:
                structural_violations.append(
                    f"Structural requirement: Professional Summary is too brief ({len(summary_clean)} chars / {len(summary_clean.split())} words). Minimum 350+ characters (5+ rendered lines) of dense verified details required."
                )

            # 6.2 Mandatory Project Count: Minimum 4 projects if profile has 4+ projects
            min_expected_projects = min(4, len(profile.projects))
            if len(resume.projects) < min_expected_projects:
                structural_violations.append(
                    f"Structural requirement: Selected project count ({len(resume.projects)}) is below the mandatory minimum of {min_expected_projects} from verified profile."
                )

            # 6.3 Mandatory Bullets Count: Minimum 4 substantive bullets per project
            for proj_item in resume.projects:
                if len(proj_item.bullets) < 4:
                    structural_violations.append(
                        f"Structural requirement: Project '{proj_item.name}' has {len(proj_item.bullets)} bullets (mandatory minimum: 4 substantive bullets)."
                    )

        # 7. Evaluation Result
        violations = truth_violations + structural_violations
        is_valid = len(violations) == 0
        truth_score = 100 if len(truth_violations) == 0 else max(0, 100 - (len(truth_violations) * 25))
        status: Literal["PASSED", "BLOCKED"] = "PASSED" if is_valid else "BLOCKED"

        return ResumeValidationResult(
            is_valid=is_valid,
            truth_score=truth_score,
            verified_fact_count=verified_fact_count,
            violations=violations,
            truth_violations=truth_violations,
            structural_violations=structural_violations,
            transferable_highlights=resume.job_alignment.transferable_strengths,
            skill_gaps=resume.job_alignment.skill_gaps,
            status=status,
        )


resume_validator = ResumeValidatorService()
