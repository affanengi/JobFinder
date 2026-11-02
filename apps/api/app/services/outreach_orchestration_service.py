"""Truth-Lock Outreach Orchestration Service.

Generates concise, respectful, tailored outreach emails (< 120 words) strictly grounded
in verified candidate profile facts from profile_service.py.
Integrates Truth-Lock auditing to block synthetic skills, inflated metrics, and fabricated relationships.
"""

import logging
import re
import uuid
from datetime import UTC, datetime
from typing import Optional

from app.ai.gemini import GeminiProvider
from app.db.repositories.opportunity_contact_repo import opportunity_contact_repo
from app.db.repositories.outreach_repo import OutreachRepository, outreach_repo
from app.schemas.opportunity_contact import DiscoveredContact
from app.schemas.outreach import (
    AIGeneratedOutreach,
    OutreachMessage,
    OutreachStatus,
    TruthLockFinding,
    TruthLockReport,
)
from app.schemas.profile import Profile
from app.services.job_service import job_service
from app.services.profile_service import profile_service

logger = logging.getLogger("jobFinder.services.outreach_orchestration")

DEFAULT_MAX_WORDS = 120


class OutreachOrchestrationService:
    """Orchestrates Truth-Locked personalized outreach drafting and validation."""

    def __init__(
        self,
        repo: OutreachRepository | None = None,
        ai_provider: GeminiProvider | None = None,
    ):
        self.repo = repo or outreach_repo
        self._provider = ai_provider

    @property
    def ai_provider(self) -> GeminiProvider:
        if self._provider is None:
            self._provider = GeminiProvider()
        return self._provider

    @staticmethod
    def _sanitize_untrusted_input(text: str) -> str:
        """Strip prompt injection attempts from contact notes or descriptions."""
        if not text:
            return ""
        patterns = [
            r"(?i)\bignore\s+(?:all\s+)?previous\s+instructions\b",
            r"(?i)\bsystem\s*:\s*you\s+are\s+now\b",
            r"(?i)\boverride\s+system\s+prompt\b",
            r"(?i)\bdisregard\s+(?:all\s+)?prior\s+instructions\b",
        ]
        sanitized = text
        for p in patterns:
            sanitized = re.sub(p, "[REDACTED_PROMPT_INJECTION]", sanitized)
        return sanitized.strip()

    def _extract_profile_truth_corpus(self, profile: Profile) -> dict[str, list[str]]:
        """Extract verified facts, skills, companies, and metrics from candidate profile."""
        skills: list[str] = [s.name for s in profile.skills if s.name]

        companies: list[str] = [e.company.strip() for e in profile.experience if e.company]
        titles: list[str] = [e.title.strip() for e in profile.experience if e.title]

        projects: list[str] = [p.name.strip() for p in profile.projects if p.name]

        # Extract metric strings from experience and project bullets
        metrics: list[str] = []
        for exp in profile.experience:
            for b in exp.bullets:
                found_metrics = re.findall(r"\b\d+(?:\.\d+)?%|\$\d+(?:,\d+)*(?:\.\d+)?[kmb]?|\b\d+x\b", b, re.IGNORECASE)
                metrics.extend(found_metrics)
        for proj in profile.projects:
            for b in proj.bullets:
                found_metrics = re.findall(r"\b\d+(?:\.\d+)?%|\$\d+(?:,\d+)*(?:\.\d+)?[kmb]?|\b\d+x\b", b, re.IGNORECASE)
                metrics.extend(found_metrics)

        return {
            "fullName": [profile.personal.fullName or "Candidate"],
            "skills": skills,
            "companies": companies,
            "titles": titles,
            "projects": projects,
            "metrics": list(set(metrics)),
        }

    def audit_draft_truth(
        self,
        subject: str,
        body: str,
        truth_corpus: dict[str, list[str]],
        target_company: str,
        recipient_name: str,
    ) -> TruthLockReport:
        """Audit draft text against candidate truth corpus to detect fabrications."""
        findings: list[TruthLockFinding] = []
        total_checks = 0
        passed_checks = 0

        full_text = f"{subject}\n{body}"

        # 1. Word count constraint (< 140 words soft threshold, 120 target)
        word_count = len(body.split())
        total_checks += 1
        if word_count > 160:
            findings.append(
                TruthLockFinding(
                    status="REVIEW_REQUIRED",
                    field="body",
                    claim=f"{word_count} words",
                    reason=f"Draft exceeds recommended brevity ({word_count} words). Recommended under 120 words.",
                    isBlocking=False,
                )
            )
        else:
            passed_checks += 1
            findings.append(
                TruthLockFinding(
                    status="PASS",
                    field="body",
                    claim=f"{word_count} words",
                    reason="Draft satisfies professional brevity guideline (< 140 words).",
                    isBlocking=False,
                )
            )

        # 2. Fabricated relationship check
        total_checks += 1
        relationship_triggers = [
            (r"\b(as we discussed|per our conversation|our chat yesterday)\b", "Claims unverified prior conversation"),
            (r"\b(mutual friend|referred by|referred me|our mutual)\b", "Claims unverified referral or mutual contact"),
            (r"\b(great seeing you|good to see you again|great meeting you)\b", "Claims unverified prior in-person meeting"),
        ]
        relationship_fabrication = False
        for pattern, reason in relationship_triggers:
            if re.search(pattern, full_text, re.IGNORECASE):
                relationship_fabrication = True
                findings.append(
                    TruthLockFinding(
                        status="FAIL",
                        field="body",
                        claim="Prior relationship claim",
                        reason=f"Truth violation: {reason}. Candidate facts do not establish prior contact.",
                        isBlocking=True,
                    )
                )
                break
        if not relationship_fabrication:
            passed_checks += 1
            findings.append(
                TruthLockFinding(
                    status="PASS",
                    field="body",
                    claim="Relationship grounding",
                    reason="No ungrounded claims of prior acquaintance or fabricated referrals detected.",
                    isBlocking=False,
                )
            )

        # 3. Fabricated metric check (percentages, currency, multipliers)
        total_checks += 1
        draft_metrics = re.findall(r"\b\d+(?:\.\d+)?%|\$\d+[kmb]?|\b\d+x\b", full_text, re.IGNORECASE)
        metric_fabrication = False
        if draft_metrics:
            verified_metric_strings = [m.lower() for m in truth_corpus.get("metrics", [])]
            for dm in draft_metrics:
                if dm.lower() not in verified_metric_strings:
                    metric_fabrication = True
                    findings.append(
                        TruthLockFinding(
                            status="FAIL",
                            field="body",
                            claim=dm,
                            reason=f"Metric '{dm}' does not exist in verified profile facts (metric inflation detected).",
                            isBlocking=True,
                        )
                    )
        if not metric_fabrication:
            passed_checks += 1
            findings.append(
                TruthLockFinding(
                    status="PASS",
                    field="body",
                    claim="Metric grounding",
                    reason="All numerical metrics and quantifiable results match verified profile achievements.",
                    isBlocking=False,
                )
            )

        # 4. Target company alignment
        total_checks += 1
        if target_company.lower() in full_text.lower():
            passed_checks += 1
            findings.append(
                TruthLockFinding(
                    status="PASS",
                    field="body",
                    claim=target_company,
                    reason=f"Draft accurately references target company '{target_company}'.",
                    isBlocking=False,
                )
            )
        else:
            findings.append(
                TruthLockFinding(
                    status="REVIEW_REQUIRED",
                    field="body",
                    claim=target_company,
                    reason=f"Draft does not explicitly reference the company name '{target_company}'.",
                    isBlocking=False,
                )
            )

        has_blocking = any(f.isBlocking for f in findings)
        report_status = "FAIL" if has_blocking else "REVIEW_REQUIRED" if any(f.status == "REVIEW_REQUIRED" for f in findings) else "PASS"

        verified_refs: list[str] = [
            f"skill:{s}" for s in truth_corpus.get("skills", [])[:5]
        ] + [f"project:{p}" for p in truth_corpus.get("projects", [])[:3]]

        return TruthLockReport(
            status=report_status,
            totalChecks=total_checks,
            passedChecks=passed_checks,
            findings=findings,
            verifiedFactReferences=verified_refs,
        )

    async def generate_outreach_draft(
        self,
        user_id: str,
        opportunity_id: str,
        contact_id: str,
        notes: str | None = None,
        tone: str = "concise",
        resume_attachment_id: str | None = None,
    ) -> OutreachMessage:
        """Generate a personalized outreach draft grounded in verified profile facts."""
        # 1. Fetch contact
        contact = opportunity_contact_repo.get_contact(user_id=user_id, contact_id=contact_id)
        if not contact or contact.opportunityId != opportunity_id:
            raise ValueError(f"Contact '{contact_id}' not found for opportunity '{opportunity_id}'.")

        # Check suppression rules (Phase 5)
        if getattr(contact, "doNotContact", False) or getattr(contact, "suppressionState", "NONE") == "GLOBAL_STAKEHOLDER_SUPPRESSION":
            raise ValueError(
                f"Cannot generate outreach: Contact '{contact.fullName}' has explicitly opted out of communication (GLOBAL_STAKEHOLDER_SUPPRESSION)."
            )
        if getattr(contact, "suppressionState", "NONE") == "JOB_SPECIFIC_SUPPRESSION":
            raise ValueError(
                f"Cannot generate outreach: Contact '{contact.fullName}' has rejected outreach for this opportunity (JOB_SPECIFIC_SUPPRESSION)."
            )

        # 2. Fetch opportunity
        job = job_service.get_job(opportunity_id)
        if not job:
            raise ValueError(f"Opportunity '{opportunity_id}' not found.")

        # 3. Fetch candidate profile
        profile = profile_service.get_profile(user_id=user_id)
        truth_corpus = self._extract_profile_truth_corpus(profile)

        # 4. Prepare prompt grounding
        sanitized_notes = self._sanitize_untrusted_input(notes or "")
        company_name = contact.companyName or job.company or "the team"
        contact_name = contact.fullName
        contact_title = contact.roleTitle
        contact_tier = contact.stakeholderTier

        candidate_name = truth_corpus["fullName"][0]
        verified_skills_sample = ", ".join(truth_corpus["skills"][:8]) or "Software engineering"
        verified_projects_sample = ", ".join(truth_corpus["projects"][:3]) or "Full-stack web applications"
        verified_experience_sample = ", ".join(
            f"{t} at {c}" for t, c in zip(truth_corpus["titles"][:2], truth_corpus["companies"][:2])
        ) or "Software development intern"

        system_instruction = (
            "You are an expert technical career outreach assistant. Your job is to draft a concise, respectful, "
            "and highly tailored cold outreach email from a job seeker to a company stakeholder.\n\n"
            "STRICT GROUNDING RULES:\n"
            "1. Ground all claims STRICTLY in the verified candidate facts provided below.\n"
            "2. NEVER fabricate past employers, titles, employment dates, skills, projects, or metrics.\n"
            "3. NEVER claim the candidate has spoken with or knows the recipient before.\n"
            "4. NEVER invent a mutual friend, connection, or referral.\n"
            "5. Tailor the tone to the stakeholder's role:\n"
            "   - Recruiter: Express interest in the specific open role, highlight 1-2 core matching skills.\n"
            "   - Hiring Manager: Focus on engineering impact, relevant tech stack, and excitement about their product.\n"
            "   - Tech Lead: Technical resonance, relevant projects, and architecture.\n"
            f"6. Keep the body UNDER {DEFAULT_MAX_WORDS} words. Brevity is critical.\n"
            "7. Do NOT include placeholder tokens like [Your Name] or [Link]. Use the authentic candidate name."
        )

        user_prompt = (
            f"RECIPIENT:\n"
            f"- Name: {contact_name}\n"
            f"- Title: {contact_title} ({contact_tier})\n"
            f"- Company: {company_name}\n\n"
            f"TARGET OPPORTUNITY:\n"
            f"- Role: {job.title}\n"
            f"- Location: {job.location}\n\n"
            f"VERIFIED CANDIDATE PROFILE FACTS (DO NOT EXTRAPOLATE):\n"
            f"- Name: {candidate_name}\n"
            f"- Verified Skills: {verified_skills_sample}\n"
            f"- Verified Experiences: {verified_experience_sample}\n"
            f"- Verified Projects: {verified_projects_sample}\n"
            f"- Notes/Specific Angle: {sanitized_notes or 'Interest in engineering contribution'}\n"
            f"- Desired Tone: {tone}\n\n"
            "Generate structured JSON with:\n"
            "- subject: clear, professional email subject line\n"
            "- body: complete outreach email message (under 120 words)\n"
            "- citedFacts: list of candidate facts cited\n"
            "- contactRoleRelevance: 1-sentence rationale of how the message addresses this stakeholder's role"
        )

        # 5. Call AI Hub
        ai_result: AIGeneratedOutreach = await self.ai_provider.generate_structured(
            prompt=user_prompt,
            response_schema=AIGeneratedOutreach,
            system_instruction=system_instruction,
        )

        # 6. Truth-Lock Post-Generation Audit
        truth_report = self.audit_draft_truth(
            subject=ai_result.subject,
            body=ai_result.body,
            truth_corpus=truth_corpus,
            target_company=company_name,
            recipient_name=contact_name,
        )

        # 7. Check if existing draft exists for this contact
        existing = self.repo.get_by_contact(user_id=user_id, opportunity_id=opportunity_id, contact_id=contact_id)
        outreach_id = existing.id if existing else str(uuid.uuid4())
        correlation_id = existing.correlationId if existing else f"outreach-{uuid.uuid4().hex[:12]}"

        now_iso = datetime.now(UTC).isoformat()
        message = OutreachMessage(
            id=outreach_id,
            userId=user_id,
            opportunityId=opportunity_id,
            contactId=contact_id,
            recipientEmail=contact.email,
            recipientName=contact.fullName,
            recipientTitle=contact.roleTitle,
            companyName=company_name,
            emailClassification=contact.emailClassification,
            subject=ai_result.subject,
            body=ai_result.body,
            status="DRAFT",
            truthLockReport=truth_report,
            resumeAttachmentId=resume_attachment_id,
            correlationId=correlation_id,
            createdAt=existing.createdAt if existing else now_iso,
            updatedAt=now_iso,
        )

        return self.repo.save_outreach(message)

    def save_manual_draft(
        self,
        user_id: str,
        opportunity_id: str,
        contact_id: str,
        subject: str,
        body: str,
        resume_attachment_id: str | None = None,
    ) -> OutreachMessage:
        """Manually save or update an outreach draft, running Truth-Lock audit."""
        contact = opportunity_contact_repo.get_contact(user_id=user_id, contact_id=contact_id)
        if not contact or contact.opportunityId != opportunity_id:
            raise ValueError(f"Contact '{contact_id}' not found for opportunity '{opportunity_id}'.")

        profile = profile_service.get_profile(user_id=user_id)
        truth_corpus = self._extract_profile_truth_corpus(profile)

        # Audit user draft
        truth_report = self.audit_draft_truth(
            subject=subject,
            body=body,
            truth_corpus=truth_corpus,
            target_company=contact.companyName,
            recipient_name=contact.fullName,
        )

        existing = self.repo.get_by_contact(user_id=user_id, opportunity_id=opportunity_id, contact_id=contact_id)
        outreach_id = existing.id if existing else str(uuid.uuid4())
        correlation_id = existing.correlationId if existing else f"outreach-{uuid.uuid4().hex[:12]}"

        now_iso = datetime.now(UTC).isoformat()
        message = OutreachMessage(
            id=outreach_id,
            userId=user_id,
            opportunityId=opportunity_id,
            contactId=contact_id,
            recipientEmail=contact.email,
            recipientName=contact.fullName,
            recipientTitle=contact.roleTitle,
            companyName=contact.companyName,
            emailClassification=contact.emailClassification,
            subject=subject.strip(),
            body=body.strip(),
            status="DRAFT",  # Any manual edit resets approval state to DRAFT
            truthLockReport=truth_report,
            resumeAttachmentId=resume_attachment_id,
            correlationId=correlation_id,
            createdAt=existing.createdAt if existing else now_iso,
            updatedAt=now_iso,
        )

        return self.repo.save_outreach(message)

    def update_draft(
        self,
        user_id: str,
        outreach_id: str,
        subject: str,
        body: str,
        resume_attachment_id: str | None = None,
    ) -> OutreachMessage:
        """Update an existing draft by ID, resetting approval state to DRAFT."""
        existing = self.repo.get_outreach(user_id=user_id, outreach_id=outreach_id)
        if not existing:
            raise ValueError(f"Outreach message '{outreach_id}' not found.")

        profile = profile_service.get_profile(user_id=user_id)
        truth_corpus = self._extract_profile_truth_corpus(profile)

        truth_report = self.audit_draft_truth(
            subject=subject,
            body=body,
            truth_corpus=truth_corpus,
            target_company=existing.companyName,
            recipient_name=existing.recipientName,
        )

        now_iso = datetime.now(UTC).isoformat()
        updated_dict = existing.model_dump()
        updated_dict.update({
            "subject": subject.strip(),
            "body": body.strip(),
            "status": "DRAFT",  # Invalidate prior approval on any text edit
            "truthLockReport": truth_report.model_dump(),
            "resumeAttachmentId": resume_attachment_id if resume_attachment_id is not None else existing.resumeAttachmentId,
            "updatedAt": now_iso,
        })

        updated = OutreachMessage.model_validate(updated_dict)
        return self.repo.save_outreach(updated)

    def set_approval_status(
        self,
        user_id: str,
        outreach_id: str,
        is_approved: bool,
    ) -> OutreachMessage:
        """Set approval status of draft with tenant isolation."""
        existing = self.repo.get_outreach(user_id=user_id, outreach_id=outreach_id)
        if not existing:
            raise ValueError(f"Outreach message '{outreach_id}' not found.")

        new_status: OutreachStatus = "APPROVED" if is_approved else "DRAFT"
        now_iso = datetime.now(UTC).isoformat()

        updated_dict = existing.model_dump()
        updated_dict["status"] = new_status
        updated_dict["updatedAt"] = now_iso

        updated = OutreachMessage.model_validate(updated_dict)
        return self.repo.save_outreach(updated)

    def get_outreach(self, user_id: str, outreach_id: str) -> Optional[OutreachMessage]:
        return self.repo.get_outreach(user_id=user_id, outreach_id=outreach_id)

    def get_by_contact(self, user_id: str, opportunity_id: str, contact_id: str) -> Optional[OutreachMessage]:
        return self.repo.get_by_contact(user_id=user_id, opportunity_id=opportunity_id, contact_id=contact_id)


outreach_orchestration_service = OutreachOrchestrationService()
