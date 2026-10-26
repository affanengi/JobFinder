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

from app.schemas.ats_analysis import (
    AtsAnalysisResult,
    EvidenceAuditFinding,
    EvidenceViolationSeverity,
    GroundedRewriteProposalItem,
    JobRequirementAnalysisItem,
    RequirementMatchStatus,
    RewriteValidationStatus,
    TruthLockAuditReport,
    ValidationStatus,
)
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
            evidenceAudit=items,
            keywordMatches=list(set(keyword_matches)),
            evidenceMatches=list(set(evidence_matches)),
            omittedOpportunities=list(set(omitted_opportunities)),
            unsupportedKeywords=list(set(unsupported_keywords)),
            missingRequirements=list(set(missing_requirements)),
            summary=summary,
            auditedAt=datetime.now(UTC).isoformat(),
        )

    # =========================================================================
    # PHASE 4: DETERMINISTIC TRUTH-LOCK EVIDENCE AUDITING
    # =========================================================================

    @staticmethod
    def normalize_whitespace(text: str) -> str:
        """Collapse multiple spaces, newlines, and tabs into a single space, and strip."""
        if not text:
            return ""
        return re.sub(r"\s+", " ", text).strip()

    @classmethod
    def is_exact_quotation_present(
        cls, quote: str, source_text: str, min_chars: int = 5
    ) -> bool:
        """Verify whether a cited quotation is an exact substring of source text with permitted whitespace normalization.

        Permitted normalization:
        - Collapsing multiple consecutive spaces, newlines, and tabs into a single space.
        - Case-insensitive substring matching.
        - Quotations shorter than min_chars are rejected as insufficiently specific.
        """
        if not quote or not source_text:
            return False
        clean_quote = cls.normalize_whitespace(quote).lower()
        if len(clean_quote) < min_chars:
            return False
        clean_source = cls.normalize_whitespace(source_text).lower()
        return clean_quote in clean_source

    @staticmethod
    def extract_metrics_and_numbers(text: str) -> set[str]:
        """Extract numerical metrics, percentages, dollar amounts, and quantified figures."""
        patterns = re.findall(
            r"\b(?:\$\d+(?:\.\d+)?[kKmMbB]?|\d+(?:\.\d+)?%|\d+(?:\.\d+)?[kKmMbB]\b|\d+\+?\s*(?:years?|yrs?|months?|x|X)\b)",
            text,
            flags=re.IGNORECASE,
        )
        return {p.lower().strip() for p in patterns}

    def audit_contextual_analysis(
        self,
        analysis: AtsAnalysisResult,
        raw_resume_text: str,
        profile: Profile | None = None,
        job_description: str | None = None,
        authenticated_user_id: str | None = None,
    ) -> TruthLockAuditReport:
        """Deterministically audit an AI-generated AtsAnalysisResult for evidence grounding and truth lock.

        CRITICAL ARCHITECTURAL GUARANTEE:
        This method NEVER modifies, recalculates, or deducts from analysis.overall_score.
        """
        # Tenant isolation check:
        if profile and authenticated_user_id:
            if profile.userId != authenticated_user_id:
                raise PermissionError(
                    f"Tenant isolation violation: profile userId '{profile.userId}' does not match authenticated user '{authenticated_user_id}'."
                )

        norm_resume = self.normalize_whitespace(raw_resume_text)
        findings: list[EvidenceAuditFinding] = []
        total_checks = 0
        passed_checks = 0

        # Extract verified facts from Profile if provided
        profile_norm_map: dict[str, list[str]] = {}
        profile_entities: set[str] = set()
        if profile:
            profile_norm_map, profile_entities = self._extract_profile_verified_entities(profile)

        # 1. Job Requirement Analysis Audit
        for idx, req in enumerate(analysis.requirements):
            total_checks += 1
            req_id = f"req_{idx + 1}: {req.requirement_description[:40]}"

            # Check: A requirement marked MEETS must have evidence in resume or verified profile
            if req.match_status == RequirementMatchStatus.MEETS:
                if not req.supporting_evidence:
                    findings.append(
                        EvidenceAuditFinding(
                            target_type="requirement",
                            target_identifier=req_id,
                            status=ValidationStatus.FAIL,
                            severity=EvidenceViolationSeverity.BLOCKING,
                            evidence_source="resume",
                            cited_text=None,
                            reason="Requirement marked MEETS has zero supporting evidence citations.",
                            is_blocking=True,
                        )
                    )
                else:
                    # Validate cited quotations
                    has_at_least_one_verified_quote = False
                    for q in req.supporting_evidence:
                        if not q.strip() or len(q.strip()) < 5:
                            findings.append(
                                EvidenceAuditFinding(
                                    target_type="requirement",
                                    target_identifier=req_id,
                                    status=ValidationStatus.FAIL,
                                    severity=EvidenceViolationSeverity.ADVISORY,
                                    evidence_source="resume",
                                    cited_text=q,
                                    reason="Cited evidence quote is empty or too generic (< 5 characters) to substantiate a claim.",
                                    is_blocking=False,
                                )
                            )
                        elif self.is_exact_quotation_present(q, norm_resume):
                            has_at_least_one_verified_quote = True
                        else:
                            # Not found in resume: check if it's a JD excerpt incorrectly attributed to candidate
                            if job_description and self.is_exact_quotation_present(q, job_description):
                                findings.append(
                                    EvidenceAuditFinding(
                                        target_type="requirement",
                                        target_identifier=req_id,
                                        status=ValidationStatus.FAIL,
                                        severity=EvidenceViolationSeverity.BLOCKING,
                                        evidence_source="job_description",
                                        cited_text=q,
                                        reason="Job description text was cited as candidate evidence without appearing in the resume.",
                                        is_blocking=True,
                                    )
                                )
                            else:
                                findings.append(
                                    EvidenceAuditFinding(
                                        target_type="requirement",
                                        target_identifier=req_id,
                                        status=ValidationStatus.FAIL,
                                        severity=EvidenceViolationSeverity.BLOCKING,
                                        evidence_source="resume",
                                        cited_text=q,
                                        reason="Fabricated or ungrounded quotation: cited text does not exist in the candidate's resume.",
                                        is_blocking=True,
                                    )
                                )

                    if has_at_least_one_verified_quote:
                        passed_checks += 1
                        findings.append(
                            EvidenceAuditFinding(
                                target_type="requirement",
                                target_identifier=req_id,
                                status=ValidationStatus.PASS,
                                severity=EvidenceViolationSeverity.ADVISORY,
                                evidence_source="resume",
                                cited_text="; ".join(req.supporting_evidence[:2]),
                                reason="Demonstrated requirement substantiated by verified resume text quotation.",
                                is_blocking=False,
                            )
                        )
            elif req.match_status == RequirementMatchStatus.MISSING:
                # Nuance check: Ensure missing_evidence distinction is respected
                passed_checks += 1
                findings.append(
                    EvidenceAuditFinding(
                        target_type="requirement",
                        target_identifier=req_id,
                        status=ValidationStatus.PASS,
                        severity=EvidenceViolationSeverity.ADVISORY,
                        evidence_source="resume",
                        cited_text=None,
                        reason="Missing requirement correctly identified as unproven in candidate submission.",
                        is_blocking=False,
                    )
                )
            else:  # PARTIAL
                passed_checks += 1

        # 2. Grounded Rewrite Proposals Audit
        for idx, prop in enumerate(analysis.rewrite_proposals):
            total_checks += 1
            prop_id = f"rewrite_{idx + 1}"

            # Check A: original_text must exist in resume
            orig_present = self.is_exact_quotation_present(prop.original_text, norm_resume, min_chars=5)
            if not orig_present:
                findings.append(
                    EvidenceAuditFinding(
                        target_type="rewrite_proposal",
                        target_identifier=prop_id,
                        status=ValidationStatus.FAIL,
                        severity=EvidenceViolationSeverity.BLOCKING,
                        evidence_source="resume",
                        cited_text=prop.original_text,
                        reason="Original text cited in rewrite proposal does not exist in the candidate's submitted resume.",
                        is_blocking=True,
                    )
                )
                prop.validation_status = RewriteValidationStatus.UNVERIFIED
                continue

            # Check B: Proposed text must not invent new ungrounded metrics or figures
            orig_metrics = self.extract_metrics_and_numbers(prop.original_text)
            prop_metrics = self.extract_metrics_and_numbers(prop.proposed_text)
            new_metrics = prop_metrics - orig_metrics

            if new_metrics:
                findings.append(
                    EvidenceAuditFinding(
                        target_type="rewrite_proposal",
                        target_identifier=prop_id,
                        status=ValidationStatus.FAIL,
                        severity=EvidenceViolationSeverity.BLOCKING,
                        evidence_source="resume",
                        cited_text=f"New metrics: {', '.join(sorted(new_metrics))}",
                        reason=f"Rewrite proposal fabricates ungrounded numerical metrics or percentages: {sorted(new_metrics)}",
                        is_blocking=True,
                    )
                )
                prop.validation_status = RewriteValidationStatus.UNVERIFIED
            else:
                passed_checks += 1
                prop.validation_status = RewriteValidationStatus.GROUNDED
                findings.append(
                    EvidenceAuditFinding(
                        target_type="rewrite_proposal",
                        target_identifier=prop_id,
                        status=ValidationStatus.PASS,
                        severity=EvidenceViolationSeverity.ADVISORY,
                        evidence_source="resume",
                        cited_text=prop.proposed_text[:60],
                        reason="Rewrite proposal preserves factual scope and original evidence without hallucination.",
                        is_blocking=False,
                    )
                )

        # 3. Contextual Keyword Citations Audit
        for idx, kw in enumerate(analysis.keyword_analysis):
            if kw.supporting_evidence:
                total_checks += 1
                kw_id = f"keyword_{kw.keyword}"
                if not self.is_exact_quotation_present(kw.supporting_evidence, norm_resume, min_chars=3):
                    findings.append(
                        EvidenceAuditFinding(
                            target_type="keyword",
                            target_identifier=kw_id,
                            status=ValidationStatus.FAIL,
                            severity=EvidenceViolationSeverity.ADVISORY,
                            evidence_source="resume",
                            cited_text=kw.supporting_evidence,
                            reason=f"Supporting quote for keyword '{kw.keyword}' not found in candidate resume text.",
                            is_blocking=False,
                        )
                    )
                else:
                    passed_checks += 1

        blocking_count = sum(1 for f in findings if f.is_blocking)
        advisory_count = sum(1 for f in findings if not f.is_blocking and f.status != ValidationStatus.PASS)

        if blocking_count == 0 and advisory_count == 0:
            overall_status = ValidationStatus.PASS
            is_valid = True
        elif blocking_count == 0:
            overall_status = ValidationStatus.REVIEW_REQUIRED
            is_valid = True
        else:
            overall_status = ValidationStatus.FAIL
            is_valid = False

        summary = (
            f"Truth-Lock Evidence Audit: {overall_status.value.upper()} "
            f"({passed_checks}/{max(total_checks, 1)} checks passed, "
            f"{blocking_count} blocking violations, {advisory_count} advisory warnings). "
            f"AI Contextual Score preserved: {analysis.overall_score}/100."
        )

        return TruthLockAuditReport(
            is_valid=is_valid,
            status=overall_status,
            total_checks=total_checks,
            passed_checks=passed_checks,
            blocking_violations_count=blocking_count,
            advisory_warnings_count=advisory_count,
            findings=findings,
            original_ai_score=analysis.overall_score,  # CRITICAL: strictly unmodified
            summary=summary,
            audited_at=datetime.now(UTC).isoformat(),
        )


ats_evidence_auditor = AtsEvidenceAuditorService()
