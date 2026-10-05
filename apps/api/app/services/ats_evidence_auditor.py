"""ATS Evidence Auditor & Truth Integrity Engine adhering to Phase 2 ARCHITECTURE.

Strictly decouples:
A. ATS Compatibility / Keyword Match Score (0 - 100)
from:
B. Truth Integrity (VERIFIED vs VIOLATIONS_DETECTED)

Evaluates 5 distinct states:
1. KEYWORD_MATCH: Term exists in both Resume and Job.
2. EVIDENCE_MATCH: Term exists in Resume, Job, and is backed by verified Profile facts.
3. OMITTED_OPPORTUNITY: Term is in Job and verified in Profile, but missing from Resume.
4. UNSUPPORTED_KEYWORD: Term exists in Resume without verified Profile backing (Truth violation).
5. MISSING_REQUIREMENT: Term is required by Job, but absent from candidate Profile.
"""

import logging
import re
from datetime import UTC, datetime
from typing import Any

from app.schemas.job_analysis import (
    AtsEvidenceAuditReport,
    AtsEvidenceItem,
    AtsEvidenceStatus,
    JobAnalysisResult,
)
from app.schemas.profile import Profile
from app.schemas.resume import StructuredResumeContent
from app.services.taxonomy.technical_taxonomy import extract_technical_entities

logger = logging.getLogger("jobFinder.services.ats_evidence_auditor")


class AtsEvidenceAuditorService:
    """Audits resume keywords against target job requirements and canonical profile facts."""

    @staticmethod
    def _normalize(s: str) -> str:
        return re.sub(r"[^a-z0-9]", "", s.lower().strip())

    def _extract_resume_entities(self, resume: StructuredResumeContent | dict) -> set[str]:
        """Extract all technical keywords, skills, and tools present in the resume text."""
        raw_text = []

        if isinstance(resume, StructuredResumeContent):
            raw_text.append(resume.summary)
            for s in resume.skills:
                raw_text.extend(s.items)
            for exp in resume.experience:
                raw_text.append(exp.title)
                raw_text.append(exp.company)
                for b in exp.bullets:
                    raw_text.append(b.text)
            for p in resume.projects:
                raw_text.append(p.name)
                raw_text.extend(p.technologies)
                for b in p.bullets:
                    raw_text.append(b.text)
            for c in resume.course_certifications:
                raw_text.append(c.title)
                if c.description:
                    raw_text.append(c.description)
            for lead in resume.leadership:
                raw_text.append(lead.title)
                for b in lead.bullets:
                    raw_text.append(b.text)
        elif isinstance(resume, dict):
            content = resume.get("structuredContent") or resume.get("content") or resume
            raw_text.append(str(content.get("summary", "")))
            for s in content.get("skills", []):
                if isinstance(s, dict):
                    raw_text.extend(s.get("items", []))
            for exp in content.get("experience", []):
                raw_text.append(exp.get("title", ""))
                for b in exp.get("bullets", []):
                    raw_text.append(b if isinstance(b, str) else b.get("text", ""))
            for p in content.get("projects", []):
                raw_text.append(p.get("name", ""))
                raw_text.extend(p.get("technologies", []))
                for b in p.get("bullets", []):
                    raw_text.append(b if isinstance(b, str) else b.get("text", ""))

        joined = " ".join(raw_text)
        entities = extract_technical_entities(joined)
        entity_names = set()
        for e in entities:
            name = e.get("name", e.get("id", str(e))) if isinstance(e, dict) else str(e)
            if name.strip():
                entity_names.add(name.strip())
        return entity_names

    def _extract_profile_verified_entities(self, profile: Profile) -> tuple[dict[str, list[str]], set[str]]:
        """Index verified entities from canonical profile facts with supporting fact IDs."""
        norm_map: dict[str, list[str]] = {}
        canonical_entities: set[str] = set()

        def add_entity(entity: str, fact_id: str):
            clean = entity.strip()
            if not clean:
                return
            norm = self._normalize(clean)
            if norm not in norm_map:
                norm_map[norm] = []
            if fact_id not in norm_map[norm]:
                norm_map[norm].append(fact_id)
            canonical_entities.add(clean)

        # Profile skills
        for s in profile.skills:
            if getattr(s, "verified", True):
                add_entity(s.name, s.id)
                # Expand compound skills
                for sub in re.split(r"[/&+,]", s.name):
                    add_entity(sub, s.id)

        # Profile projects
        for p in profile.projects:
            for t in p.technologies:
                add_entity(t, p.id)
                for sub in re.split(r"[/&+,]", t):
                    add_entity(sub, p.id)

        # Profile experience
        for e in profile.experience:
            for b in e.bullets:
                entities_in_bullet = extract_technical_entities(b)
                for ent in entities_in_bullet:
                    name = ent.get("name", ent.get("id", str(ent))) if isinstance(ent, dict) else str(ent)
                    add_entity(name, e.id)

        # Profile courses
        for c in getattr(profile, "courseCertifications", []):
            if getattr(c, "verified", True):
                add_entity(c.title, c.id)
                if c.description:
                    for ent in extract_technical_entities(c.description):
                        name = ent.get("name", ent.get("id", str(ent))) if isinstance(ent, dict) else str(ent)
                        add_entity(name, c.id)

        return norm_map, canonical_entities

    def _is_term_verified(self, norm_term: str, profile_norm_map: dict[str, list[str]]) -> tuple[bool, list[str]]:
        """Verify if a normalized term exists in profile facts with token length safety."""
        if norm_term in profile_norm_map:
            return True, profile_norm_map[norm_term]

        for np, fids in profile_norm_map.items():
            # For short tokens (<= 3 chars, e.g. 'c', 'r', 'sql', 'git'), require exact match only
            if len(np) <= 3 or len(norm_term) <= 3:
                if norm_term == np:
                    return True, fids
            else:
                if norm_term in np or np in norm_term:
                    return True, fids

        return False, []

    def audit_ats_evidence(
        self,
        resume: StructuredResumeContent | dict,
        job_analysis: JobAnalysisResult,
        profile: Profile,
        resume_id: str | None = None,
    ) -> AtsEvidenceAuditReport:
        """Perform comprehensive ATS Evidence Audit correlating resume, job requirements, and profile facts."""
        resume_entities = self._extract_resume_entities(resume)
        profile_norm_map, profile_entities = self._extract_profile_verified_entities(profile)

        # Collect job requirements/keywords
        job_target_terms = list(job_analysis.requiredSkills) + list(job_analysis.preferredSkills)
        for req in job_analysis.requirements:
            job_target_terms.extend(req.keywords)
        # Deduplicate while preserving casing
        seen_job = set()
        deduped_job_terms = []
        for t in job_target_terms:
            norm = self._normalize(t)
            if norm and norm not in seen_job:
                seen_job.add(norm)
                deduped_job_terms.append(t)

        items: list[AtsEvidenceItem] = []
        keyword_matches: list[str] = []
        evidence_matches: list[str] = []
        omitted_opportunities: list[str] = []
        unsupported_keywords: list[str] = []
        missing_requirements: list[str] = []

        norm_resume_set = {self._normalize(r) for r in resume_entities}

        # 1. Audit Job Terms
        for job_term in deduped_job_terms:
            norm_j = self._normalize(job_term)
            in_resume = norm_j in norm_resume_set or any(norm_j in nr or nr in norm_j for nr in norm_resume_set if len(nr) > 3)
            is_verified, fact_ids = self._is_term_verified(norm_j, profile_norm_map)

            if in_resume and is_verified:
                status: AtsEvidenceStatus = "EVIDENCE_MATCH"
                evidence_matches.append(job_term)
                keyword_matches.append(job_term)
                details = f"Verified in profile ({', '.join(fact_ids[:2])}) and tailored into resume."
            elif in_resume and not is_verified:
                status = "UNSUPPORTED_KEYWORD"
                unsupported_keywords.append(job_term)
                keyword_matches.append(job_term)
                details = f"Warning: '{job_term}' present in resume but lacks verified profile backing."
            elif not in_resume and is_verified:
                status = "OMITTED_OPPORTUNITY"
                omitted_opportunities.append(job_term)
                details = f"Opportunity: Candidate has verified evidence ({', '.join(fact_ids[:2])}) but it was omitted from resume."
            else:
                status = "MISSING_REQUIREMENT"
                missing_requirements.append(job_term)
                details = f"Skill gap: Target job requires '{job_term}', which is not verified in candidate profile."

            items.append(
                AtsEvidenceItem(
                    keyword=job_term,
                    status=status,
                    inResume=in_resume,
                    inJob=True,
                    isVerifiedInProfile=is_verified,
                    verifiedFactIds=fact_ids,
                    category="job_requirement",
                    details=details,
                )
            )

        # 2. Check for Unsupported Keywords in Resume not caught above
        for r_term in resume_entities:
            norm_r = self._normalize(r_term)
            if norm_r not in seen_job:
                is_verified, fact_ids = self._is_term_verified(norm_r, profile_norm_map)
                if not is_verified:
                    unsupported_keywords.append(r_term)
                    items.append(
                        AtsEvidenceItem(
                            keyword=r_term,
                            status="UNSUPPORTED_KEYWORD",
                            inResume=True,
                            inJob=False,
                            isVerifiedInProfile=False,
                            verifiedFactIds=[],
                            category="resume_unverified",
                            details=f"Unsupported claim: '{r_term}' appears in resume without canonical profile proof.",
                        )
                    )

        # Calculate ATS compatibility score based on keyword match rate
        total_job_terms = max(len(deduped_job_terms), 1)
        matched_job_terms = len(evidence_matches) + (len(unsupported_keywords) * 0.5)
        raw_score = (matched_job_terms / total_job_terms) * 100.0
        ats_score = min(100, max(15, int(raw_score)))

        # Truth Integrity Status strictly decoupled from ATS score
        truth_status = "VIOLATIONS_DETECTED" if len(unsupported_keywords) > 0 else "VERIFIED"

        summary = (
            f"ATS Score: {ats_score}/100 ({len(evidence_matches)} verified matches). "
            f"Truth Integrity: {truth_status} ({len(unsupported_keywords)} unsupported keywords detected, "
            f"{len(missing_requirements)} missing requirements, {len(omitted_opportunities)} omitted opportunities)."
        )

        return AtsEvidenceAuditReport(
            resumeId=resume_id,
            jobId=job_analysis.jobId,
            atsScore=ats_score,
            truthIntegrityStatus=truth_status,
            items=items,
            keywordMatches=list(set(keyword_matches)),
            evidenceMatches=list(set(evidence_matches)),
            omittedOpportunities=list(set(omitted_opportunities)),
            unsupportedKeywords=list(set(unsupported_keywords)),
            missingRequirements=list(set(missing_requirements)),
            summary=summary,
            auditedAt=datetime.now(UTC).isoformat(),
        )


ats_evidence_auditor = AtsEvidenceAuditorService()
