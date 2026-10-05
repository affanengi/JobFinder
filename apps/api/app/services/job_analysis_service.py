"""Job Analysis Service implementing hybrid deterministic preprocessing + AI semantic structuring.

Adheres strictly to Phase 2 requirements:
- Uses AI Hub (AITaskType.JOB_ANALYSIS) via AIOrchestrator.
- Caches analysis by jobId in Firestore/memory repository.
- Provides robust deterministic fallback when AI is unavailable or for malformed JDs.
- Never invents requirements not present in the job description.
"""

import logging
import re
import uuid
from typing import Optional

from pydantic import BaseModel, Field

from app.ai.gemini import GeminiProvider
from app.ai.hub.types import AITaskType
from app.core.config import settings
from app.db.repositories.job_analysis_repo import job_analysis_repo
from app.schemas.job import CanonicalJob
from app.schemas.job_analysis import (
    JobAnalysisResult,
    JobRequirementItem,
    JobRequirementType,
    RequirementCategory,
    RequirementImportance,
)
from app.services.taxonomy.technical_taxonomy import extract_technical_entities

logger = logging.getLogger("jobFinder.services.job_analysis")


class StructuredJobAnalysisOutput(BaseModel):
    """Schema for AI structured output extraction."""

    roleCategory: str = Field(
        default="software_engineering",
        description="One of: software_engineering, data_analytics, qa_testing, privacy_security, product_operations, general_technical",
    )
    roleFocus: str = Field(
        default="",
        description="Key technological and evidence focus areas for this opening",
    )
    summary: str = Field(description="2-3 sentence executive summary of role requirements")
    requirements: list[JobRequirementItem] = Field(default_factory=list)
    requiredSkills: list[str] = Field(default_factory=list)
    preferredSkills: list[str] = Field(default_factory=list)
    responsibilities: list[str] = Field(default_factory=list)
    qualifications: list[str] = Field(default_factory=list)
    keywords: list[str] = Field(default_factory=list)
    softSkills: list[str] = Field(default_factory=list)
    domainContext: list[str] = Field(default_factory=list)


class JobAnalysisService:
    """Hybrid Job Intelligence Engine with deterministic preprocessing and AI semantic extraction."""

    def __init__(self, ai_provider: Optional[GeminiProvider] = None):
        self._provider = ai_provider

    @property
    def ai_provider(self) -> GeminiProvider:
        if self._provider is None:
            key = settings.JOB_INGESTION_GEMINI_API_KEY or settings.GEMINI_API_KEY
            self._provider = GeminiProvider(api_key=key)
        return self._provider

    def detect_role_category(self, title: str, description: str) -> tuple[str, str]:
        """Deterministically determine role category and default focus prioritizing title."""
        t_low = title.lower()
        d_low = description.lower()
        combined = f"{t_low} {d_low}"

        # 1. Primary Title Evaluation (Title is the strongest signal)
        if re.search(r"\b(qa|quality assurance|test automation|sdet|test engineer|software tester)\b", t_low):
            return "qa_testing", "test automation, synthetic test harness, replay verification, API testing, debugging"
        if re.search(r"\b(data analyst|data scientist|data analytics|business intelligence|bi analyst|analytics engineer)\b", t_low):
            return "data_analytics", "SQL, Python, R, data cleaning, statistical analysis, dashboarding"
        if re.search(r"\b(privacy|security|compliance|infosec|pii|data protection)\b", t_low):
            return "privacy_security", "PII redaction, privacy controls, secure data handling, compliance verification"
        if re.search(r"\b(product manager|operations associate|technical operations|program manager|agile|scrum)\b", t_low):
            return "product_operations", "technical communication, sprint tracking, workflow documentation, cross-functional leadership"
        if re.search(r"\b(software engineer|frontend|backend|full stack|web developer|api developer|fastify|react|node|developer|programmer|engineer)\b", t_low):
            return "software_engineering", "browser SDKs, Fastify, REST APIs, client event processing, React, backend pipelines"

        # 2. Body-level fallbacks if title was generic
        if re.search(r"\b(data analyst|data scientist|data analytics|business intelligence|bi analyst|analytics engineer)\b", combined):
            return "data_analytics", "SQL, Python, R, data cleaning, statistical analysis, dashboarding"
        if re.search(r"\b(qa|quality assurance|test automation|sdet|test engineer|software tester)\b", combined):
            return "qa_testing", "test automation, synthetic test harness, replay verification, API testing, debugging"
        if re.search(r"\b(software engineer|frontend|backend|full stack|web developer|api developer|fastify|react|node)\b", combined):
            return "software_engineering", "browser SDKs, Fastify, REST APIs, client event processing, React, backend pipelines"
        if re.search(r"\b(privacy|security|compliance|infosec|pii|data protection)\b", combined):
            return "privacy_security", "PII redaction, privacy controls, secure data handling, compliance verification"
        if re.search(r"\b(product manager|operations associate|technical operations|program manager|agile|scrum)\b", combined):
            return "product_operations", "technical communication, sprint tracking, workflow documentation, cross-functional leadership"

        return "general_technical", "software fundamentals, modern web technologies, problem solving"

    def deterministic_fallback_analysis(self, job: CanonicalJob) -> JobAnalysisResult:
        """Robust zero-AI fallback extracting requirements, skills, and categories deterministically."""
        text = job.description or ""
        role_category, role_focus = self.detect_role_category(job.title, text)

        # Extract entities from description
        extracted_entities = extract_technical_entities(text)
        req_skills = list(job.requiredSkills) if job.requiredSkills else []
        for ent in extracted_entities[:10]:
            ent_name = ent.get("name", ent.get("id", str(ent))) if isinstance(ent, dict) else str(ent)
            if ent_name and ent_name not in req_skills:
                req_skills.append(ent_name)

        pref_skills = list(job.preferredSkills) if job.preferredSkills else []

        requirements: list[JobRequirementItem] = []
        req_idx = 1

        # Break text into lines/sentences to find requirements
        lines = [line.strip().lstrip("•-* \t") for line in text.splitlines() if line.strip()]
        responsibilities: list[str] = []
        qualifications: list[str] = []

        is_resp_section = False
        is_qual_section = False

        for line in lines:
            lower = line.lower()
            if any(h in lower for h in ["responsibilities", "what you will do", "duties"]):
                is_resp_section = True
                is_qual_section = False
                continue
            if any(h in lower for h in ["qualifications", "requirements", "what we are looking for", "skills required"]):
                is_qual_section = True
                is_resp_section = False
                continue

            if len(line) < 15 or len(line) > 300:
                continue

            if is_resp_section and len(responsibilities) < 8:
                responsibilities.append(line)
                requirements.append(
                    JobRequirementItem(
                        id=f"req-{req_idx}",
                        type="responsibility",
                        text=line,
                        category="required",
                        keywords=[w for w in line.split() if len(w) > 4][:3],
                        importance="high",
                    )
                )
                req_idx += 1
            elif is_qual_section and len(qualifications) < 8:
                qualifications.append(line)
                is_pref = "preferred" in lower or "plus" in lower or "nice to have" in lower
                requirements.append(
                    JobRequirementItem(
                        id=f"req-{req_idx}",
                        type="qualification_experience" if any(w in lower for w in ["year", "experience", "degree"]) else "skill_technical",
                        text=line,
                        category="preferred" if is_pref else "required",
                        keywords=[w for w in line.split() if len(w) > 4][:3],
                        importance="medium" if is_pref else "high",
                    )
                )
                req_idx += 1

        # If no explicit sections were parsed, add requirements from skills
        if not requirements:
            for s in req_skills[:6]:
                requirements.append(
                    JobRequirementItem(
                        id=f"req-{req_idx}",
                        type="skill_technical",
                        text=f"Demonstrated proficiency in {s}",
                        category="required",
                        keywords=[s],
                        importance="critical",
                    )
                )
                req_idx += 1

        summary = (
            f"{job.company} is hiring a {job.title} ({job.workMode}). "
            f"Key focus areas include {', '.join(req_skills[:4]) or 'technical development'}."
        )

        return JobAnalysisResult(
            id=f"analysis-{job.id}",
            jobId=job.id,
            jobTitle=job.title,
            company=job.company,
            roleCategory=role_category,
            roleFocus=role_focus,
            summary=summary,
            requirements=requirements,
            requiredSkills=req_skills,
            preferredSkills=pref_skills,
            responsibilities=responsibilities,
            qualifications=qualifications,
            keywords=req_skills[:12],
            softSkills=["Communication", "Collaboration", "Problem Solving"],
            domainContext=[job.department or "Engineering"],
            confidence="medium" if len(text) > 100 else "low",
            source="deterministic_fallback",
        )

    async def analyze_job(
        self,
        job: CanonicalJob,
        user_id: Optional[str] = None,
        force_regenerate: bool = False,
    ) -> JobAnalysisResult:
        """Analyze a job opportunity using AI Hub with automatic caching and deterministic fallback."""
        if not force_regenerate:
            cached = job_analysis_repo.get_analysis_by_job_id(job.id)
            if cached:
                logger.info(f"Returning cached job analysis for {job.id}")
                return cached

        # Check if description is too minimal for LLM
        desc = (job.description or "").strip()
        if len(desc) < 40:
            logger.warning(f"Job description for {job.id} is too short ({len(desc)} chars). Using deterministic fallback.")
            fallback = self.deterministic_fallback_analysis(job)
            return job_analysis_repo.save_analysis(fallback)

        detected_category, detected_focus = self.detect_role_category(job.title, desc)

        system_instruction = (
            "You are an expert Job Intelligence & Technical Requirement Extraction Engine. "
            "Your objective is to deconstruct a job posting into atomic, structured, and factual requirements. "
            "CRITICAL RULE: DO NOT INVENT REQUIREMENTS THAT ARE NOT PRESENT IN THE JOB DESCRIPTION. "
            "Distinguish required vs preferred qualifications carefully. "
            "Extract precise technical skills, tools, frameworks, responsibilities, and domain context."
        )

        prompt = f"""Deconstruct the following job opening into atomic, structured requirements.

JOB DETAILS:
Title: {job.title}
Company: {job.company}
Location: {job.location} ({job.workMode})
Experience Requirement: {job.experienceText or 'Not specified'}
Category Hint: {detected_category} (Suggested focus: {detected_focus})

JOB DESCRIPTION:
{desc}

INSTRUCTIONS:
1. roleCategory: Choose the best fit from (software_engineering, data_analytics, qa_testing, privacy_security, product_operations, general_technical).
2. roleFocus: State the specific technical and evidence priorities for this specific JD (e.g. 'Browser SDK, Fastify, REST APIs, event pipelines').
3. summary: Provide a 2-3 sentence executive summary of what the role requires.
4. requirements: Extract distinct atomic requirements with category ('required' or 'preferred'), type ('skill_technical', 'skill_soft', 'responsibility', 'qualification_experience', 'qualification_education', 'domain_context'), importance, and keywords.
5. requiredSkills: List all tools, languages, and technical frameworks that are explicitly mandatory.
6. preferredSkills: List nice-to-have or preferred technical skills.
7. responsibilities: Extract 4-8 core duties.
8. qualifications: Extract education, years of experience, and degree requirements.
9. keywords: Important ATS terminology from the posting.
10. softSkills: Behavioral and collaboration traits requested.
11. domainContext: Business or product area (e.g. Telemetry, Analytics, E-commerce).

Return strictly valid JSON adhering to StructuredJobAnalysisOutput."""

        try:
            structured_output: StructuredJobAnalysisOutput = await self.ai_provider.generate_structured(
                prompt=prompt,
                schema=StructuredJobAnalysisOutput,
                system_instruction=system_instruction,
                temperature=0.1,
                task=AITaskType.JOB_ANALYSIS,
                user_id=user_id,
            )

            # Assign consistent IDs if missing
            validated_reqs: list[JobRequirementItem] = []
            for idx, r in enumerate(structured_output.requirements, start=1):
                if not r.id or not r.id.startswith("req-"):
                    r.id = f"req-{idx}"
                validated_reqs.append(r)

            result = JobAnalysisResult(
                id=f"analysis-{job.id}",
                jobId=job.id,
                jobTitle=job.title,
                company=job.company,
                roleCategory=structured_output.roleCategory or detected_category,
                roleFocus=structured_output.roleFocus or detected_focus,
                summary=structured_output.summary,
                requirements=validated_reqs,
                requiredSkills=structured_output.requiredSkills,
                preferredSkills=structured_output.preferredSkills,
                responsibilities=structured_output.responsibilities,
                qualifications=structured_output.qualifications,
                keywords=structured_output.keywords,
                softSkills=structured_output.softSkills,
                domainContext=structured_output.domainContext,
                modelUsed=getattr(self.ai_provider, "last_model_used", None),
                confidence="high",
                source="ai_structured",
            )
            return job_analysis_repo.save_analysis(result)

        except Exception as e:
            logger.error(f"AI job analysis failed for {job.id}: {e}. Falling back to deterministic extraction.")
            fallback = self.deterministic_fallback_analysis(job)
            return job_analysis_repo.save_analysis(fallback)


job_analysis_service = JobAnalysisService()
