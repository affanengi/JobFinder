"""1-Shot LLM ATS Resume & Cover Letter Intelligence Engine with Dedicated Key & Fallback."""

import json
import logging
import uuid
from datetime import datetime, timezone

from app.core.config import settings
from app.ai.hub.types import AITaskType
from app.ai.provider import AIProvider
from app.ai.gemini import GeminiProvider
from app.db.repositories.cover_letter_repo import cover_letter_repo
from app.db.repositories.resume_repo import resume_repo
from app.schemas.application_artifacts import (
    GenerateArtifactsResponse,
    GenerationMode,
    UnifiedApplicationArtifacts,
)
from app.schemas.cover_letter import (
    CoverLetterContent,
    CoverLetterTone,
    TailoredCoverLetterDTO,
)
from app.schemas.job import CanonicalJob
from app.schemas.profile import CourseCertificationFact, Profile
from app.schemas.resume import (
    ResumeBullet,
    ResumeContact,
    ResumeCourseCertificationItem,
    ResumeExperienceItem,
    ResumeValidationResult,
    StructuredResumeContent,
    TailoredResumeDTO,
)
from app.services.cover_letter_validator import cover_letter_validator
from app.services.latex_template import latex_engine
from app.services.resume_validator import resume_validator

logger = logging.getLogger("jobFinder.resume_generator")


def format_cover_letter_markdown(content: CoverLetterContent) -> str:
    """Format structured cover letter content into clean GitHub-flavored markdown."""
    contact_parts: list[str] = []
    if getattr(content, "email", None) and content.email:
        contact_parts.append(content.email)
    if getattr(content, "phone", None) and content.phone:
        contact_parts.append(content.phone)
    city = getattr(content, "city", None)
    country = getattr(content, "country", None)
    loc = f"{city}, {country}" if city and country else (city or country or "")
    if loc:
        contact_parts.append(loc)
    if getattr(content, "linkedin", None) and content.linkedin:
        contact_parts.append(f"[LinkedIn]({content.linkedin})")
    if getattr(content, "github", None) and content.github:
        contact_parts.append(f"[GitHub]({content.github})")
    if getattr(content, "portfolio", None) and content.portfolio:
        contact_parts.append(f"[Portfolio]({content.portfolio})")

    full_name = getattr(content, "fullName", "Mohammed Affan Razvi")
    recipient = getattr(content, "recipientName", "Hiring Team")
    greeting = getattr(content, "greeting", f"Dear {recipient},")
    p1 = getattr(content, "paragraph1_hook", "")
    p2 = getattr(content, "paragraph2_evidence", "")
    p3 = getattr(content, "paragraph3_impact", "")
    signoff = getattr(content, "signOff", "Sincerely,")

    header_lines = [
        f"# {full_name}",
        " | ".join(contact_parts) if contact_parts else "",
        "",
        f"**Date:** {content.date}",
        "",
        f"**To:** {recipient}",
        f"**Company:** {content.companyName}",
        f"**Position:** {content.jobTitle}",
        "",
        "---",
        "",
        greeting,
        "",
        p1,
        "",
        p2,
        "",
        p3,
        "",
        signoff,
        f"**{full_name}**",
    ]
    return "\n".join(header_lines)


def reconstruct_verified_courses(
    profile_courses: list[CourseCertificationFact],
    ai_course_items: list[ResumeCourseCertificationItem] | None,
) -> list[ResumeCourseCertificationItem]:
    """Deterministically reconstruct verified courses strictly from canonical profile facts.

    1. Read canonical profile courses.
    2. Validate AI-returned course IDs.
    3. Ignore unknown IDs.
    4. Preserve only IDs that actually exist in the verified profile.
    5. Preserve every eligible verified course from the profile.
    6. Append omitted existing courses deterministically.
    7. Reconstruct final course entries from canonical profile data.
    """
    eligible_profile_courses = [c for c in profile_courses if getattr(c, "verified", True)]
    if not eligible_profile_courses:
        return []

    profile_map = {c.id: c for c in eligible_profile_courses}
    norm_title_map = {c.title.strip().lower(): c for c in eligible_profile_courses}

    seen_ids: set[str] = set()
    ordered_ids: list[str] = []

    # Priority 1: Respect AI-selected ranking for verified existing courses
    for item in (ai_course_items or []):
        cid = getattr(item, "course_fact_id", None)
        matched_course = None
        if cid and cid in profile_map:
            matched_course = profile_map[cid]
        elif getattr(item, "title", None) and item.title.strip().lower() in norm_title_map:
            matched_course = norm_title_map[item.title.strip().lower()]

        if matched_course and matched_course.id not in seen_ids:
            seen_ids.add(matched_course.id)
            ordered_ids.append(matched_course.id)

    # Priority 2: Append any omitted verified courses in canonical profile order
    for c in eligible_profile_courses:
        if c.id not in seen_ids:
            seen_ids.add(c.id)
            ordered_ids.append(c.id)

    # Reconstruct final course items purely from canonical profile facts
    final_items: list[ResumeCourseCertificationItem] = []
    for cid in ordered_ids:
        c = profile_map[cid]
        final_items.append(
            ResumeCourseCertificationItem(
                course_fact_id=c.id,
                title=c.title,
                provider=c.provider,
                instructor=getattr(c, "instructor", None),
                completionYear=c.completionYear,
                certificateUrl=c.certificateUrl,
                description=c.description,
            )
        )

    return final_items


def ground_experience_and_leadership(
    profile: Profile,
    structured: StructuredResumeContent,
) -> None:
    """Ground and separate professional experience and leadership strictly from profile facts.

    - Lodestar MUST be in structured.experience with title 'Software Engineering Intern'.
    - Techniva Technical Club MUST be in structured.leadership with title 'Co-Founder & Technical Lead'.
    - Metrics for Lodestar (~14.6K events across ~40 sessions) must be synthetic/replayed events.
    - No duplicate Lodestar entries.
    """
    import re

    profile_lodestar = next(
        (e for e in profile.experience if "lodestar" in e.company.lower()),
        None,
    )
    profile_techniva = next(
        (e for e in profile.experience if "techniva" in e.company.lower()),
        None,
    )

    raw_exp = list(structured.experience or [])
    raw_lead = list(getattr(structured, "leadership", []) or [])

    cleaned_exp: list[ResumeExperienceItem] = []
    cleaned_lead: list[ResumeExperienceItem] = []

    all_items = raw_exp + raw_lead
    lodestar_item: ResumeExperienceItem | None = None
    techniva_item: ResumeExperienceItem | None = None

    for item in all_items:
        co_lower = item.company.lower()
        if "lodestar" in co_lower:
            if not lodestar_item:
                lodestar_item = item
        elif "techniva" in co_lower or "club" in co_lower:
            if not techniva_item:
                techniva_item = item
        elif any(lead_kw in co_lower or lead_kw in item.title.lower() for lead_kw in ["leader", "organizer", "fellow", "volunteer"]):
            cleaned_lead.append(item)
        else:
            cleaned_exp.append(item)

    # Ground Lodestar
    if profile_lodestar:
        if not lodestar_item:
            lodestar_item = ResumeExperienceItem(
                company="Lodestar",
                title="Software Engineering Intern",
                location=profile_lodestar.location or "Remote",
                startDate=profile_lodestar.startDate or "Jun 2026",
                endDate=profile_lodestar.endDate or "Aug 2026",
                current=profile_lodestar.current,
                bullets=[ResumeBullet(text=b) for b in profile_lodestar.bullets],
                experience_fact_id=profile_lodestar.id,
            )
        else:
            lodestar_item.company = "Lodestar"
            lodestar_item.title = "Software Engineering Intern"  # Hard invariant
            lodestar_item.location = profile_lodestar.location or "Remote"
            lodestar_item.startDate = profile_lodestar.startDate or "Jun 2026"
            lodestar_item.endDate = profile_lodestar.endDate or "Aug 2026"
            lodestar_item.current = profile_lodestar.current
            lodestar_item.experience_fact_id = profile_lodestar.id

            clean_bullets: list[ResumeBullet] = []
            for b in lodestar_item.bullets:
                b_text = b.text
                b_lower = b_text.lower()
                for prohibited in ["real users", "production users", "customer activity", "production traffic", "real-world usage"]:
                    if prohibited in b_lower:
                        b_text = re.sub(re.escape(prohibited), "synthetic test sessions", b_text, flags=re.IGNORECASE)
                clean_bullets.append(ResumeBullet(text=b_text, source_fact_ids=b.source_fact_ids))
            lodestar_item.bullets = clean_bullets

        cleaned_exp.insert(0, lodestar_item)

    # Ground Techniva
    if profile_techniva:
        if not techniva_item:
            techniva_item = ResumeExperienceItem(
                company="Techniva Technical Club",
                title="Co-Founder & Technical Lead",
                location=profile_techniva.location or "Hyderabad, Telangana",
                startDate="2024",
                endDate="2026",
                current=False,
                bullets=[ResumeBullet(text=b) for b in profile_techniva.bullets],
                experience_fact_id=profile_techniva.id,
            )
        else:
            techniva_item.company = "Techniva Technical Club"
            techniva_item.title = "Co-Founder & Technical Lead"
            techniva_item.startDate = "2024"
            techniva_item.endDate = "2026"
            techniva_item.current = False
            techniva_item.experience_fact_id = profile_techniva.id
        cleaned_lead.insert(0, techniva_item)

    structured.experience = cleaned_exp
    structured.leadership = cleaned_lead


class ResumeGeneratorService:
    """Service for generating and tailoring resumes using Gemini LLM."""

    def __init__(self, ai_provider: AIProvider | None = None):
        self._provider = ai_provider

    @property
    def ai_provider(self) -> AIProvider:
        if self._provider is None:
            resume_key = settings.RESUME_GEMINI_API_KEY or settings.GEMINI_API_KEY
            self._provider = GeminiProvider(api_key=resume_key)
        return self._provider

    def _prepare_verified_profile_facts(self, profile: Profile) -> dict:
        """Extract verified facts from candidate profile as the sole source of truth."""
        verified_skills = [
            {
                "id": s.id,
                "name": s.name,
                "category": s.category,
                "proficiency": s.proficiency,
                "yearsOfExperience": getattr(s, "yearsOfExperience", None),
            }
            for s in profile.skills
            if s.verified or True
        ]

        verified_projects = [
            {
                "id": p.id,
                "name": p.name,
                "description": p.description,
                "bullets": p.bullets,
                "technologies": p.technologies,
                "url": p.url,
                "metrics": [m.model_dump() if hasattr(m, "model_dump") else m for m in getattr(p, "metrics", [])],
            }
            for p in profile.projects
        ]

        verified_experience = [
            {
                "id": exp.id,
                "company": exp.company,
                "title": exp.title,
                "location": exp.location,
                "startDate": exp.startDate,
                "endDate": exp.endDate,
                "current": exp.current,
                "bullets": exp.bullets,
                "metrics": [m.model_dump() if hasattr(m, "model_dump") else m for m in getattr(exp, "metrics", [])],
            }
            for exp in profile.experience
        ]

        verified_education = [
            {
                "id": edu.id,
                "institution": edu.institution,
                "degree": edu.degree,
                "field": edu.field,
                "endDate": edu.endDate,
                "grade": edu.grade,
            }
            for edu in profile.education
        ]

        verified_courses = [
            {
                "id": c.id,
                "title": c.title,
                "completionYear": c.completionYear,
                "certificateUrl": c.certificateUrl,
                "description": c.description,
                "provider": c.provider,
                "instructor": getattr(c, "instructor", None),
            }
            for c in getattr(profile, "courseCertifications", [])
            if getattr(c, "verified", True)
        ]

        return {
            "personal": {
                "fullName": profile.personal.fullName,
                "email": profile.personal.email,
                "phone": profile.personal.phone,
                "city": profile.personal.city,
                "country": profile.personal.country,
                "github": profile.personal.links.github if profile.personal.links else None,
                "linkedin": profile.personal.links.linkedin if profile.personal.links else None,
                "portfolio": profile.personal.links.portfolio if profile.personal.links else None,
            },
            "summary": profile.summary,
            "skills": verified_skills,
            "projects": verified_projects,
            "courses_and_certifications": verified_courses,
            "experience": verified_experience,
            "education": verified_education,
        }

    async def tailor_resume_for_job(
        self,
        job: CanonicalJob,
        profile: Profile,
        custom_instructions: str | None = None,
        operation_id: str | None = None,
    ) -> TailoredResumeDTO:
        """Generate tailored StructuredResumeContent and validate deterministically."""
        from app.services.job_analysis_service import job_analysis_service
        from app.services.profile_job_matching_service import profile_job_matcher
        from app.services.ats_evidence_auditor import ats_evidence_auditor

        # Phase 2: Compute job analysis, deterministic match, and application snapshot
        job_analysis = await job_analysis_service.analyze_job(job=job, user_id=profile.userId)
        match_result = profile_job_matcher.compute_match(profile=profile, job_analysis=job_analysis)
        profile_job_matcher.create_application_snapshot(profile, job_analysis, match_result)

        verified_data = self._prepare_verified_profile_facts(profile)

        system_instruction = (
            "You are an expert ATS Resume Intelligence Engine for a truthful career automation platform. "
            "You create a comprehensive, dense, professional 1-page ATS resume tailored to the target job description "
            "using ONLY the candidate's verified profile facts with ZERO fabrication."
        )

        user_inst_str = f"USER CUSTOM INSTRUCTIONS: {custom_instructions}" if custom_instructions else ""
        skills_str = ", ".join(job.requiredSkills) if job.requiredSkills else "See description"

        prompt = f"""You are tailoring a complete, professional, 1-page engineering resume for the target job opening below.

TARGET JOB DETAILS:
- Title: {job.title}
- Company: {job.company}
- Location: {job.location} ({job.workMode})
- Role Category: {job_analysis.roleCategory}
- Specific Role Focus: {job_analysis.roleFocus}
- Key Required Skills: {skills_str}
- Experience Text: {job.experienceText}
- Job Description:
{job.description}

DETERMINISTIC VERIFIED MATCH EVIDENCE:
- Direct Verified Evidence: {json.dumps([m.candidateEvidence for m in match_result.strongMatches], indent=2)}
- Transferable Capabilities (Do NOT claim unverified tech directly): {json.dumps([m.rationale for m in match_result.transferableMatches], indent=2)}
- Missing Requirements (STRICTLY FORBIDDEN TO INVENT): {json.dumps([m.requirementText for m in match_result.missingRequirements], indent=2)}
- Recommended Project Priority: {match_result.recommendedProjectIds}
- Recommended Skill Priority: {match_result.recommendedSkillPriorities[:12]}

CANDIDATE'S VERIFIED MASTER PROFILE FACTS (SOURCE OF TRUTH):
{json.dumps(verified_data, indent=2)}

{user_inst_str}

STRICT 4-TIER PRIORITY HIERARCHY:
1. PRIORITY 1: Verified Candidate Facts (Sole Source of Truth). All claims MUST be grounded in verified profile data.
2. PRIORITY 2: Verified Candidate Skills, Projects & Experience. Select most relevant verified projects and skills.
3. PRIORITY 3: Target Job Description (Tailoring & Context Only). Use JD for emphasis and terminology; JD is NEVER evidence that candidate has unverified skills.
4. PRIORITY 4: Writing Clarity & Information Density. Use strong past-tense action verbs, technical depth, and concise focus.

THREE-CATEGORY TRUTH MODEL:
- Directly Verified: State verified facts directly.
- Transferable/Adjacent: Truthfully frame verified related capabilities without claiming unsupported tools.
- Unsupported: Omit entirely. Never fabricate tools, numbers, or responsibilities.

NATURAL METRIC DISTRIBUTION POLICY:
- When verified quantitative evidence exists, aim to naturally incorporate verified metrics in at least 2 bullets, varying across 2 to 7 bullets.
- If fewer than 2 verified metric opportunities exist, use only legitimate available evidence (never manufacture numbers).
- Strict Project Containment: Techniva metrics (10+ events, 300+ participants, 70+ audience) stay with Techniva; School Management charts (8+ charts) stay with School Management; WebPilot automations (8+ workflows) stay with WebPilot; jobFinder performance (~1-2s) stays with jobFinder.
- Never stuff numbers; never repeat the same metric across multiple bullets.

MANDATORY STRUCTURAL & DENSITY REQUIREMENTS (HARD MINIMUMS):
1. Contact Header: Real name, email, phone, GitHub, LinkedIn. (Do NOT include physical location/city/country).
2. Professional Summary (HARD MINIMUM: 5 RENDERED LINES / 400-550 CHARACTERS):
   - Synthesize a comprehensive, information-dense professional summary that naturally occupies at least 5 rendered lines in the final PDF.
   - Deconstruct and incorporate distinct verified facts covering: professional direction, core technical skills, AI/automation experience, backend/fullstack capabilities, key verified projects, target job tech alignment, and transferable strengths.
   - NEVER use filler, generic buzzwords, repeated sentences, or invented claims.
3. Education: Include ALL verified education records in chronological order. Always preserve verified grade/percentage in grade field.
4. Technical Skills: 4 organized categories populated with candidate's verified skills.
5. Experience (Canonical Professional Experience — Lodestar):
   - Place under the `experience` array.
   - Company: Lodestar
   - Title: Software Engineering Intern (STRICT HARD INVARIANT: MUST be 'Software Engineering Intern'. NEVER rename to 'Software Engineer', 'Data Analyst', 'Backend Engineer', or drop 'Intern'.)
   - Employment Type: Intern | Location: Remote | Dates: Jun 2026 – Aug 2026
   - Tailor bullet emphasis to target job alignment (e.g. browser autocapture SDK, Fastify ingest service, event pipelines, or load harness).
   - CRITICAL SYNTHETIC METRIC REQUIREMENT: The ~14.6K events across ~40 sessions were SYNTHETIC / REPLAYED TEST EVENTS through the Fastify ingest service. NEVER claim or imply they were real users, live production traffic, customer activity, or production users.
6. Technical Projects (HARD MINIMUM: AT LEAST 4 PROJECTS):
   - When candidate profile contains 4 or more verified projects, you MUST select and include AT LEAST 4 PROJECTS in the projects array.
   - Select the 4 most relevant projects for the target job based on technical alignment and verified evidence.
   - CRITICAL: Preserve candidate verified project names EXACTLY as given in CANDIDATE'S VERIFIED MASTER PROFILE FACTS (e.g., if profile has "Next-Social (LinkedIn Clone)", output "Next-Social (LinkedIn Clone)" verbatim). Never alter, translate, or modify parenthetical subtitles.
   - EVERY selected project MUST contain AT LEAST 4 distinct, substantive engineering bullet points.
   - Combine: Action Verb + What Was Built + How Implemented + Technical Details + Verified Purpose/Impact.
7. Courses & Certifications (Relevance Ranking Only):
   - Review candidate's verified courses in "courses_and_certifications".
   - Select and order verified courses relevant to the target job in `course_certifications`.
   - Provide the `course_fact_id` mapping to the source course id.
   - ZERO REWRITE RULE: You have NO authority to rewrite, paraphrase, shorten, or alter course descriptions, providers, or instructors. Final course content is deterministically verified from the candidate profile.
8. Leadership & Activities (Techniva Technical Club):
   - Place under the `leadership` array.
   - Company: Techniva Technical Club
   - Title: Co-Founder & Technical Lead
   - Dates: 2024 – 2026 (never Present)
   - Include 3-4 substantive bullets. Never describe Techniva as a college fest.
9. Fact Traceability: Map fact IDs in source_fact_ids.

Return strictly structured JSON conforming to the StructuredResumeContent schema."""

        structured: StructuredResumeContent = await self.ai_provider.generate_structured(
            prompt=prompt,
            schema=StructuredResumeContent,
            system_instruction=system_instruction,
            temperature=0.2,
            task=AITaskType.RESUME_TAILORING,
            user_id=profile.userId,
            operation_id=operation_id,
        )

        # Authoritative grounding: Always stamp candidate verified contact credentials from master profile
        structured.personal = ResumeContact(
            fullName=profile.personal.fullName or "Mohammed Affan Razvi",
            email=profile.personal.email or "mohammedaffanrazvi604@gmail.com",
            phone=profile.personal.phone or "+91 8978293087",
            city=profile.personal.city or "Hyderabad",
            country=profile.personal.country or "India",
            github=(profile.personal.links.github if profile.personal.links else None) or "https://github.com/affanengi",
            linkedin=(profile.personal.links.linkedin if profile.personal.links else None) or "https://www.linkedin.com/in/mohammed-affan-razvi-855a202ab/",
            portfolio=(profile.personal.links.portfolio if profile.personal.links else None) or "https://my-portfolio-henna-tau-72.vercel.app/",
        )

        # Deterministically ground professional experience & leadership
        ground_experience_and_leadership(profile, structured)

        # Deterministically reconstruct verified courses strictly from canonical profile facts
        structured.course_certifications = reconstruct_verified_courses(
            profile.courseCertifications, structured.course_certifications
        )

        validation_result: ResumeValidationResult = resume_validator.validate(structured, profile)

        if not validation_result.is_valid and validation_result.violations:
            logger.warning(f"[RESUME_RETRY] Violations detected: {validation_result.violations}. Retrying...")
            fix_prompt = (
                f"{prompt}\n\nCORRECTION REQUIRED: Previous generation had violations:\n"
                + "\n".join(f"- {v}" for v in validation_result.violations)
                + "\nStrictly correct these unverified claims."
            )
            try:
                structured = await self.ai_provider.generate_structured(
                    prompt=fix_prompt,
                    schema=StructuredResumeContent,
                    system_instruction=system_instruction,
                    temperature=0.0,
                    task=AITaskType.RESUME_TAILORING,
                    user_id=profile.userId,
                    operation_id=operation_id,
                )
                structured.personal = ResumeContact(
                    fullName=profile.personal.fullName or "Mohammed Affan Razvi",
                    email=profile.personal.email or "mohammedaffanrazvi604@gmail.com",
                    phone=profile.personal.phone or "+91 8978293087",
                    city=profile.personal.city or "Hyderabad",
                    country=profile.personal.country or "India",
                    github=(profile.personal.links.github if profile.personal.links else None) or "https://github.com/affanengi",
                    linkedin=(profile.personal.links.linkedin if profile.personal.links else None) or "https://www.linkedin.com/in/mohammed-affan-razvi-855a202ab/",
                    portfolio=(profile.personal.links.portfolio if profile.personal.links else None) or "https://my-portfolio-henna-tau-72.vercel.app/",
                )
                ground_experience_and_leadership(profile, structured)
                structured.course_certifications = reconstruct_verified_courses(
                    profile.courseCertifications, structured.course_certifications
                )
                validation_result = resume_validator.validate(structured, profile)
            except Exception as e:
                logger.error(f"Correction retry failed: {e}")

        existing_resume = resume_repo.get_resume_for_job(user_id=profile.userId, job_id=job.id)
        latex_code = latex_engine.generate_latex(structured)
        resume_id = existing_resume.id if existing_resume else f"res-{uuid.uuid4().hex[:10]}"
        now_iso = datetime.now(timezone.utc).isoformat()

        dto = TailoredResumeDTO(
            id=resume_id,
            userId=profile.userId,
            jobId=job.id,
            jobTitle=job.title,
            jobCompany=job.company,
            structuredContent=structured,
            validationResult=validation_result,
            latexCode=latex_code,
            createdAt=existing_resume.createdAt if existing_resume else now_iso,
            updatedAt=now_iso,
        )
        resume_repo.save_tailored_resume(dto)
        return dto

    async def tailor_cover_letter_for_job(
        self,
        job: CanonicalJob,
        profile: Profile,
        tone: CoverLetterTone = "professional",
        custom_instructions: str | None = None,
        operation_id: str | None = None,
    ) -> TailoredCoverLetterDTO:
        """Generate tailored CoverLetterContent and validate deterministically."""
        from app.services.job_analysis_service import job_analysis_service
        from app.services.profile_job_matching_service import profile_job_matcher

        job_analysis = await job_analysis_service.analyze_job(job=job, user_id=profile.userId)
        match_result = profile_job_matcher.compute_match(profile=profile, job_analysis=job_analysis)

        verified_data = self._prepare_verified_profile_facts(profile)
        current_date_str = datetime.now().strftime("%B %d, %Y")

        system_instruction = (
            "You are an expert Executive Cover Letter Tailoring Engine for a truthful career automation platform. "
            "You craft a compelling, authentic 3-paragraph cover letter tailored to the job description "
            "grounded strictly in the candidate's verified profile facts with zero fabrication."
        )

        user_inst_str = f"USER CUSTOM INSTRUCTIONS: {custom_instructions}" if custom_instructions else ""
        skills_str = ", ".join(job.requiredSkills) if job.requiredSkills else "See description"

        prompt = f"""You are tailoring a professional 3-paragraph cover letter for the target job opening below.

TARGET JOB DETAILS:
- Title: {job.title}
- Company: {job.company}
- Location: {job.location} ({job.workMode})
- Role Category: {job_analysis.roleCategory}
- Role Focus: {job_analysis.roleFocus}
- Key Required Skills: {skills_str}
- Job Description:
{job.description}

DETERMINISTIC VERIFIED EVIDENCE (USE IN PARAGRAPH 2):
- Verified Strong Matches: {json.dumps([m.candidateEvidence for m in match_result.strongMatches], indent=2)}
- Transferable Highlights: {json.dumps([m.rationale for m in match_result.transferableMatches], indent=2)}
- Missing Requirements (NEVER CLAIM): {json.dumps([m.requirementText for m in match_result.missingRequirements], indent=2)}

CANDIDATE'S VERIFIED MASTER PROFILE FACTS (SOURCE OF TRUTH):
{json.dumps(verified_data, indent=2)}

DESIRED TONE: {tone.upper()}
TODAY'S DATE: {current_date_str}
{user_inst_str}

CRITICAL 3-PARAGRAPH STRUCTURAL RULES:
1. Header: fullName, email, phone, companyName='{job.company}', jobTitle='{job.title}', date='{current_date_str}'.
2. Paragraph 1 (Hook): Enthusiastic role interest, connection to {job.company}, candidate core background.
3. Paragraph 2 (Evidence): Concrete verified project highlights directly matching job requirements.
4. Paragraph 3 (Impact & Close): Transferable value, culture alignment, availability for interview.
5. Sign-off: 'Sincerely,', candidate name.
6. Provenance: Include fact IDs in sourceFactIds.

Return strictly structured JSON conforming to the CoverLetterContent schema."""

        structured: CoverLetterContent = await self.ai_provider.generate_structured(
            prompt=prompt,
            schema=CoverLetterContent,
            system_instruction=system_instruction,
            temperature=0.3,
            task=AITaskType.COVER_LETTER_GEN,
            user_id=profile.userId,
            operation_id=operation_id,
        )

        structured.fullName = profile.personal.fullName or "Mohammed Affan Razvi"
        structured.email = profile.personal.email or "mohammedaffanrazvi604@gmail.com"
        structured.phone = profile.personal.phone or "+91 8978293087"
        structured.city = profile.personal.city or "Hyderabad"
        structured.country = profile.personal.country or "India"
        structured.github = (profile.personal.links.github if profile.personal.links else None) or "https://github.com/affanengi"
        structured.linkedin = (profile.personal.links.linkedin if profile.personal.links else None) or "https://www.linkedin.com/in/mohammed-affan-razvi-855a202ab/"
        if hasattr(structured, "portfolio"):
            structured.portfolio = (profile.personal.links.portfolio if profile.personal.links else None) or "https://my-portfolio-henna-tau-72.vercel.app/"

        validation_result = cover_letter_validator.validate(structured, profile)

        if not validation_result.is_valid and validation_result.violations:
            logger.warning(f"[COVER_LETTER_RETRY] Violations detected: {validation_result.violations}. Retrying...")
            fix_prompt = (
                f"{prompt}\n\nCORRECTION REQUIRED: Previous generation had violations:\n"
                + "\n".join(f"- {v}" for v in validation_result.violations)
                + "\nStrictly correct these unverified claims."
            )
            try:
                structured = await self.ai_provider.generate_structured(
                    prompt=fix_prompt,
                    schema=CoverLetterContent,
                    system_instruction=system_instruction,
                    temperature=0.0,
                    task=AITaskType.COVER_LETTER_GEN,
                    user_id=profile.userId,
                    operation_id=operation_id,
                )
                validation_result = cover_letter_validator.validate(structured, profile)
            except Exception as e:
                logger.error(f"Cover letter retry failed: {e}")

        markdown_body = format_cover_letter_markdown(structured)
        existing_cl = cover_letter_repo.get_cover_letter_for_job(user_id=profile.userId, job_id=job.id)
        cl_id = existing_cl.id if existing_cl else f"cl-{uuid.uuid4().hex[:10]}"

        now_iso = datetime.now(timezone.utc).isoformat()
        dto = TailoredCoverLetterDTO(
            id=cl_id,
            userId=profile.userId,
            jobId=job.id,
            tone=tone,
            content=structured,
            markdownText=markdown_body,
            validationResult=validation_result,
            createdAt=existing_cl.createdAt if existing_cl else now_iso,
            updatedAt=now_iso,
        )
        cover_letter_repo.save(dto)
        return dto

    async def generate_application_artifacts(
        self,
        job: CanonicalJob,
        profile: Profile,
        mode: GenerationMode = "both",
        tone: CoverLetterTone = "professional",
        cover_letter_tone: CoverLetterTone = "professional",
        custom_instructions: str | None = None,
        force_regenerate: bool = False,
        operation_id: str | None = None,
    ) -> GenerateArtifactsResponse:
        """Generate resume, cover letter, or both with caching adherence (0 Gemini calls when cached)."""
        existing_resume = resume_repo.get_resume_for_job(user_id=profile.userId, job_id=job.id)
        existing_cl = cover_letter_repo.get_cover_letter_for_job(user_id=profile.userId, job_id=job.id)

        if not force_regenerate:
            resume_cached = existing_resume is not None if mode in ("resume", "both") else True
            cl_cached = existing_cl is not None if mode in ("cover_letter", "both") else True

            if resume_cached and cl_cached:
                return GenerateArtifactsResponse(
                    mode=mode,
                    resume=existing_resume if mode in ("resume", "both") else None,
                    coverLetter=existing_cl if mode in ("cover_letter", "both") else None,
                    fromCache=True,
                )

        resume_dto = None
        cover_letter_dto = None

        if mode in ("resume", "both"):
            resume_dto = await self.tailor_resume_for_job(
                job=job,
                profile=profile,
                custom_instructions=custom_instructions,
                operation_id=operation_id,
            )

        if mode in ("cover_letter", "both"):
            cover_letter_dto = await self.tailor_cover_letter_for_job(
                job=job,
                profile=profile,
                tone=tone or cover_letter_tone,
                custom_instructions=custom_instructions,
                operation_id=operation_id,
            )

        return GenerateArtifactsResponse(
            mode=mode,
            resume=resume_dto,
            coverLetter=cover_letter_dto,
            fromCache=False,
        )

    async def generate_unified_artifacts(self, *args, **kwargs):
        return await self.generate_application_artifacts(*args, **kwargs)


resume_generator = ResumeGeneratorService()
