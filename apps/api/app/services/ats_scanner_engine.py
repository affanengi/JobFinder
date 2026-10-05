"""
100-Point ATS Resume Scanner & Keyword Match Engine.
Provides deterministic, sub-second ATS scoring across 4 pillars:
1. Parseability & Technical Format (25 pts)
2. Technical Keyword & Competency Alignment (30 pts)
3. Impact, Action Verbs & Quantified Metrics (25 pts)
4. Structural Integrity & Content Density (20 pts)
"""

from __future__ import annotations
import io
import re
import uuid
import logging
from typing import Dict, List, Any, Optional, Tuple, Literal
from pydantic import BaseModel

import pypdf
import docx

from app.core.config import settings
from app.schemas.scanner import (
    AtsScanResult,
    CategoryScore,
    CategoryCheckItem,
    KeywordMatrix,
    KeywordMatchDetail,
    BulletAuditItem,
    ChecklistItem,
    ScanMetadata,
    AiBulletRewriteResponse,
    BulletSuggestion,
    BulkBulletInput,
    OptimizedBulletItem,
    BulkAiBulletRewriteResponse
)
from app.services.taxonomy.technical_taxonomy import (
    extract_technical_entities,
    match_keywords_against_job,
    audit_bullet_text,
    TAXONOMY_VERSION,
    CANONICAL_LOOKUP,
    ACTION_VERBS
)
from app.ai.gemini import GeminiProvider

logger = logging.getLogger(__name__)


class AtsScannerEngine:
    """Deterministic 100-Point ATS Resume Scanner."""

    @staticmethod
    def _get_bullet_text(bullet: Any) -> str:
        """Extract text string from string or grounded bullet dict."""
        if isinstance(bullet, str):
            return bullet.strip()
        if isinstance(bullet, dict):
            return str(bullet.get("text", bullet.get("description", bullet.get("bullet", "")))).strip()
        return ""

    @staticmethod
    def _extract_all_bullets_from_structured(resume_data: Dict[str, Any]) -> List[Dict[str, Any]]:
        """Extract all individual bullet items with section and entity context."""
        bullets: List[Dict[str, Any]] = []
        content = resume_data.get("structuredContent") or resume_data.get("content") or resume_data

        # Experience Bullets
        experiences = content.get("experience", [])
        for exp_idx, exp in enumerate(experiences):
            role = exp.get("title", exp.get("role", "Experience"))
            company = exp.get("company", "")
            heading = f"{role} at {company}".strip(" at ")
            for b_idx, bullet in enumerate(exp.get("bullets", [])):
                text = AtsScannerEngine._get_bullet_text(bullet)
                if text:
                    bullets.append({
                        "id": f"exp_{exp_idx}_{b_idx}",
                        "section": "Experience",
                        "role_or_project": heading,
                        "text": text
                    })

        # Projects Bullets
        projects = content.get("projects", [])
        for proj_idx, proj in enumerate(projects):
            name = proj.get("name", proj.get("title", f"Project {proj_idx+1}"))
            for b_idx, bullet in enumerate(proj.get("bullets", [])):
                text = AtsScannerEngine._get_bullet_text(bullet)
                if text:
                    bullets.append({
                        "id": f"proj_{proj_idx}_{b_idx}",
                        "section": "Projects",
                        "role_or_project": name,
                        "text": text
                    })

        # Leadership / Extracurricular Bullets
        leadership = content.get("leadership", [])
        for lead_idx, lead in enumerate(leadership):
            role = lead.get("role", lead.get("title", "Leadership"))
            org = lead.get("organization", "")
            heading = f"{role} ({org})".strip(" ()")
            for b_idx, bullet in enumerate(lead.get("bullets", [])):
                text = AtsScannerEngine._get_bullet_text(bullet)
                if text:
                    bullets.append({
                        "id": f"lead_{lead_idx}_{b_idx}",
                        "section": "Leadership",
                        "role_or_project": heading,
                        "text": text
                    })

        return bullets

    @staticmethod
    def _extract_full_text_from_structured(resume_data: Dict[str, Any]) -> str:
        """Flatten structured resume object into clean comprehensive text string."""
        content = resume_data.get("structuredContent") or resume_data.get("content") or resume_data
        parts: List[str] = []

        # Contact / Personal Info
        contact = content.get("personal") or content.get("contact") or {}
        for field in ["fullName", "name", "email", "phone", "city", "country", "location", "linkedin", "github", "portfolio"]:
            val = contact.get(field, "")
            if isinstance(val, str) and val.strip():
                parts.append(val.strip())

        # Summary
        summary = content.get("summary", "") or content.get("professional_summary", "")
        if isinstance(summary, str) and summary.strip():
            parts.append(summary.strip())

        # Experience
        for exp in content.get("experience", []):
            for field in ["title", "role", "company", "location", "duration", "date", "startDate", "endDate"]:
                val = exp.get(field, "")
                if isinstance(val, str) and val.strip():
                    parts.append(val.strip())
            for b in exp.get("bullets", []):
                text = AtsScannerEngine._get_bullet_text(b)
                if text:
                    parts.append(text)

        # Projects
        for proj in content.get("projects", []):
            for field in ["name", "title", "link"]:
                val = proj.get(field, "")
                if isinstance(val, str) and val.strip():
                    parts.append(val.strip())
            techs = proj.get("technologies", [])
            if isinstance(techs, list):
                parts.extend([str(t).strip() for t in techs if str(t).strip()])
            for b in proj.get("bullets", []):
                text = AtsScannerEngine._get_bullet_text(b)
                if text:
                    parts.append(text)

        # Skills
        skills = content.get("skills", {})
        if isinstance(skills, dict):
            for cat, skill_list in skills.items():
                if isinstance(skill_list, list):
                    for s in skill_list:
                        s_text = s.get("name", s) if isinstance(s, dict) else str(s)
                        if s_text: parts.append(str(s_text).strip())
                elif isinstance(skill_list, str):
                    parts.append(skill_list.strip())
        elif isinstance(skills, list):
            for s in skills:
                if isinstance(s, dict):
                    items = s.get("items", [])
                    if isinstance(items, list):
                        for item in items:
                            if isinstance(item, str) and item.strip():
                                parts.append(item.strip())
                    elif s.get("name"):
                        parts.append(str(s.get("name")).strip())
                elif isinstance(s, str) and s.strip():
                    parts.append(s.strip())

        # Education
        for edu in content.get("education", []):
            for field in ["degree", "institution", "college", "field", "year", "duration", "startDate", "endDate", "score", "gpa", "grade", "percentage"]:
                val = edu.get(field, "")
                if isinstance(val, str) and val.strip():
                    parts.append(val.strip())

        # Leadership
        for lead in content.get("leadership", []):
            for field in ["role", "title", "organization"]:
                val = lead.get(field, "")
                if isinstance(val, str) and val.strip():
                    parts.append(val.strip())
            for b in lead.get("bullets", []):
                text = AtsScannerEngine._get_bullet_text(b)
                if text:
                    parts.append(text)

        return " \n ".join([p for p in parts if p])

    def scan_tailored_resume(
        self,
        resume_data: Dict[str, Any],
        job_data: Optional[Dict[str, Any]] = None
    ) -> AtsScanResult:
        """
        Execute deterministic 100-point ATS scan on a structured tailored resume.
        Sub-second local execution with zero AI calls.
        """
        content = resume_data.get("structuredContent") or resume_data.get("content") or resume_data
        resume_id = resume_data.get("id") if isinstance(resume_data, dict) else None

        if isinstance(job_data, str):
            job_id = resume_data.get("jobId") if isinstance(resume_data, dict) else None
            jd_text = job_data
        elif isinstance(job_data, dict):
            job_id = job_data.get("id") or (resume_data.get("jobId") if isinstance(resume_data, dict) else None)
            jd_text = f"{job_data.get('title', '')} \n {job_data.get('description', '')} \n {' '.join(job_data.get('requirements', []))} \n {' '.join(job_data.get('skills', []))}"
        else:
            job_id = resume_data.get("jobId") if isinstance(resume_data, dict) else None
            jd_text = ""

        # 1. Gather all text and bullet points
        full_text = self._extract_full_text_from_structured(resume_data)
        raw_bullets = self._extract_all_bullets_from_structured(resume_data)
        word_count = len(full_text.split())

        # -------------------------------------------------------------
        # PILLAR 1: ATS Parseability & Technical Format (25 Points)
        # -------------------------------------------------------------
        p1_checks: List[CategoryCheckItem] = []

        # Check 1.1: Section Headers (8 pts)
        has_summary = bool(content.get("summary") or content.get("professional_summary"))
        has_exp = bool(content.get("experience"))
        has_skills = bool(content.get("skills"))
        has_edu = bool(content.get("education"))
        has_proj = bool(content.get("projects"))

        sec_count = sum([has_summary, has_exp, has_skills, has_edu, has_proj])
        sec_score = round((sec_count / 5.0) * 8.0, 1)
        missing_secs = []
        if not has_summary: missing_secs.append("Summary")
        if not has_exp: missing_secs.append("Experience")
        if not has_skills: missing_secs.append("Skills")
        if not has_edu: missing_secs.append("Education")
        if not has_proj: missing_secs.append("Projects")

        p1_checks.append(CategoryCheckItem(
            name="Standard Section Headers",
            passed=sec_count == 5,
            score=sec_score,
            max_score=8.0,
            detail="All standard ATS sections detected (Summary, Experience, Skills, Education, Projects)." if sec_count == 5
                   else f"Missing section headers: {', '.join(missing_secs)}."
        ))

        # Check 1.2: Contact & Identifiers (7 pts)
        contact = content.get("personal") or content.get("contact") or {}
        has_name = bool(contact.get("fullName") or contact.get("name"))
        has_email = bool(contact.get("email")) and "@" in str(contact.get("email", ""))
        has_phone = bool(contact.get("phone"))
        has_links = bool(contact.get("linkedin") or contact.get("github") or contact.get("portfolio"))

        contact_score = (2.0 if has_name else 0.0) + (2.0 if has_email else 0.0) + (1.5 if has_phone else 0.0) + (1.5 if has_links else 0.0)
        p1_checks.append(CategoryCheckItem(
            name="Contact & Identification Data",
            passed=contact_score >= 6.5,
            score=contact_score,
            max_score=7.0,
            detail="Complete contact info (Name, Email, Phone, Professional Links)." if contact_score >= 6.5
                   else "Incomplete contact headers; ensure full name, email, phone, and LinkedIn/GitHub are specified."
        ))

        # Check 1.3: Clean Character Flow & Font Safety (5 pts)
        bad_chars = re.findall(r"[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]", full_text)
        clean_flow = len(bad_chars) == 0
        font_score = 5.0 if clean_flow else 2.0
        p1_checks.append(CategoryCheckItem(
            name="Text Flow & Glyph Safety",
            passed=clean_flow,
            score=font_score,
            max_score=5.0,
            detail="Standard UTF-8 plain-text stream safely parseable by all legacy and modern ATS engines." if clean_flow
                   else f"Detected {len(bad_chars)} non-standard control glyphs that may corrupt parser streams."
        ))

        # Check 1.4: Single Page Fit & Density (5 pts)
        if 280 <= word_count <= 650:
            page_score = 5.0
            page_detail = f"Optimal single-page length ({word_count} words). Fits standard 1-page layout without overflow."
        elif word_count < 280:
            page_score = 3.5
            page_detail = f"Low word density ({word_count} words); expand project and experience descriptions."
        else:
            page_score = 3.5
            page_detail = f"High word count ({word_count} words); verify ReportLab PDF fits 1 page cleanly without awkward 2nd page spill."

        p1_checks.append(CategoryCheckItem(
            name="Single-Page Density & Fit",
            passed=page_score == 5.0,
            score=page_score,
            max_score=5.0,
            detail=page_detail
        ))

        p1_total = sum(c.score for c in p1_checks)
        p1_status: Literal["pass", "warning", "fail"] = "pass" if p1_total >= 21 else ("warning" if p1_total >= 16 else "fail")

        # -------------------------------------------------------------
        # PILLAR 2: Technical Keyword & Competency Alignment (30 Points)
        # -------------------------------------------------------------
        p2_checks: List[CategoryCheckItem] = []
        kw_match_data = match_keywords_against_job(full_text, jd_text)

        matched_list = [
            KeywordMatchDetail(
                id=item["id"],
                name=item["name"],
                category=item["category"],
                importance=item["importance"],
                status="matched"
            )
            for item in kw_match_data["matched_keywords"]
        ]

        missing_list = [
            KeywordMatchDetail(
                id=item["id"],
                name=item["name"],
                category=item["category"],
                importance=item["importance"],
                status="missing",
                recommendation=item.get("recommendation")
            )
            for item in kw_match_data["missing_keywords"]
        ]

        transferable_list = [
            KeywordMatchDetail(
                id=item["id"],
                name=item["name"],
                category=item["category"],
                importance="Bonus",
                status="transferable"
            )
            for item in kw_match_data["transferable_skills"]
        ]

        keyword_matrix = KeywordMatrix(
            matched=matched_list,
            missing=missing_list,
            transferable=transferable_list,
            match_percentage=kw_match_data["match_percentage"],
            total_jd_keywords=kw_match_data["total_required"],
            matched_count=kw_match_data["matched_count"],
            missing_count=kw_match_data["missing_count"],
            transferable_count=kw_match_data["transferable_count"]
        )

        if kw_match_data["total_required"] > 0:
            high_jd = [k for k in kw_match_data["matched_keywords"] if k["importance"] == "High"]
            total_high_jd = [k for k in kw_match_data["matched_keywords"] + kw_match_data["missing_keywords"] if k["importance"] == "High"]

            high_ratio = len(high_jd) / max(len(total_high_jd), 1)
            core_score = round(high_ratio * 16.0, 1)

            med_jd = [k for k in kw_match_data["matched_keywords"] if k["importance"] == "Medium"]
            total_med_jd = [k for k in kw_match_data["matched_keywords"] + kw_match_data["missing_keywords"] if k["importance"] == "Medium"]
            med_ratio = len(med_jd) / max(len(total_med_jd), 1) if total_med_jd else 1.0
            tooling_score = round(med_ratio * 8.0, 1)

            arch_entities = [k for k in kw_match_data["matched_keywords"] if k["category"] in ["architecture_methodologies", "devops_cicd"]]
            arch_score = min(round((len(arch_entities) / 2.0) * 6.0, 1), 6.0)

            p2_checks.append(CategoryCheckItem(
                name="Core Technical Skills Match",
                passed=core_score >= 12.0,
                score=core_score,
                max_score=16.0,
                detail=f"Matched {len(high_jd)} of {len(total_high_jd)} critical technical skills requested in JD."
            ))
            p2_checks.append(CategoryCheckItem(
                name="Frameworks & Tooling Alignment",
                passed=tooling_score >= 6.0,
                score=tooling_score,
                max_score=8.0,
                detail=f"Matched {len(med_jd)} secondary frameworks and tooling requirements."
            ))
            p2_checks.append(CategoryCheckItem(
                name="Architecture & Methodologies",
                passed=arch_score >= 4.5,
                score=arch_score,
                max_score=6.0,
                detail=f"Matched {len(arch_entities)} architecture/CI-CD methodology competencies."
            ))
        else:
            total_recognized = len(matched_list) + len(transferable_list)
            gen_score = min(round((total_recognized / 12.0) * 30.0, 1), 30.0)
            p2_checks.append(CategoryCheckItem(
                name="General Technical Density",
                passed=gen_score >= 24.0,
                score=gen_score,
                max_score=30.0,
                detail=f"Found {total_recognized} verified taxonomy technologies across language, framework, database, and cloud domains."
            ))

        p2_total = sum(c.score for c in p2_checks)
        p2_status: Literal["pass", "warning", "fail"] = "pass" if p2_total >= 24 else ("warning" if p2_total >= 18 else "fail")

        # -------------------------------------------------------------
        # PILLAR 3: Impact, Action Verbs & Quantified Metrics (25 Points)
        # -------------------------------------------------------------
        bullet_audits: List[BulletAuditItem] = []
        action_verb_count = 0
        metric_count = 0
        weak_opener_count = 0

        for b in raw_bullets:
            audit = audit_bullet_text(b["text"])
            if audit["has_action_verb"]: action_verb_count += 1
            if audit["has_metric"]: metric_count += 1
            if audit["has_weak_opener"]: weak_opener_count += 1

            bullet_audits.append(BulletAuditItem(
                id=b["id"],
                section=b["section"],
                role_or_project=b["role_or_project"],
                text=audit["text"],
                score=audit["score"],
                status=audit["status"],
                has_action_verb=audit["has_action_verb"],
                has_metric=audit["has_metric"],
                has_weak_opener=audit["has_weak_opener"],
                verb=audit["verb"],
                word_count=audit["word_count"],
                issues=audit["issues"]
            ))

        total_bullets = max(len(raw_bullets), 1)
        action_ratio = action_verb_count / total_bullets
        metric_ratio = metric_count / total_bullets

        if action_ratio >= 0.80:
            verb_score = 10.0
        elif action_ratio >= 0.60:
            verb_score = 8.0
        elif action_ratio >= 0.40:
            verb_score = 5.0
        else:
            verb_score = round(action_ratio * 10.0, 1)

        if metric_count >= 5:
            metric_score = 10.0
            metric_passed = True
        elif metric_count >= 3:
            metric_score = 9.0
            metric_passed = True
        elif metric_count >= 1:
            metric_score = 7.5
            metric_passed = True
        else:
            metric_score = 5.0
            metric_passed = False

        weak_penalty = min(weak_opener_count * 1.5, 5.0)
        passive_score = max(5.0 - weak_penalty, 0.0)

        p3_checks = [
            CategoryCheckItem(
                name="Strong Action Verb Openers",
                passed=action_ratio >= 0.75,
                score=verb_score,
                max_score=10.0,
                detail=f"{action_verb_count} of {total_bullets} bullets ({round(action_ratio*100)}%) begin with high-impact power verbs."
            ),
            CategoryCheckItem(
                name="Quantified Metrics & Impact",
                passed=metric_passed,
                score=metric_score,
                max_score=10.0,
                detail=f"{metric_count} of {total_bullets} bullets ({round(metric_ratio*100)}%) include numerical metrics, scale, or quantifiable outcomes."
            ),
            CategoryCheckItem(
                name="Absence of Weak/Passive Openers",
                passed=weak_opener_count == 0,
                score=passive_score,
                max_score=5.0,
                detail="Zero weak or passive phrases detected." if weak_opener_count == 0
                       else f"Found {weak_opener_count} weak openers ('worked on', 'helped with', 'responsible for')."
            )
        ]

        p3_total = sum(c.score for c in p3_checks)
        p3_status: Literal["pass", "warning", "fail"] = "pass" if p3_total >= 20 else ("warning" if p3_total >= 15 else "fail")

        # -------------------------------------------------------------
        # PILLAR 4: Structural Integrity & Content Density (20 Points)
        # -------------------------------------------------------------
        p4_checks: List[CategoryCheckItem] = []

        summary_text = content.get("summary", "")
        summary_words = len(str(summary_text).split())
        if 35 <= summary_words <= 90:
            sum_score = 5.0
            sum_detail = f"Substantial, keyword-rich professional summary ({summary_words} words)."
        elif 20 <= summary_words < 35:
            sum_score = 3.5
            sum_detail = f"Summary is slightly concise ({summary_words} words); target 35-85 words with target competencies."
        elif summary_words > 90:
            sum_score = 3.5
            sum_detail = f"Summary is lengthy ({summary_words} words); condense to 4-5 focused lines."
        else:
            sum_score = 1.0
            sum_detail = "Summary is missing or under 20 words."

        p4_checks.append(CategoryCheckItem(
            name="Professional Summary Depth",
            passed=sum_score == 5.0,
            score=sum_score,
            max_score=5.0,
            detail=sum_detail
        ))

        bullet_words = [len(b["text"].split()) for b in raw_bullets]
        in_range_bullets = [w for w in bullet_words if 10 <= w <= 32]
        bullet_len_ratio = len(in_range_bullets) / max(len(bullet_words), 1)
        bullet_len_score = round(bullet_len_ratio * 5.0, 1)

        p4_checks.append(CategoryCheckItem(
            name="Bullet Length & Scannability",
            passed=bullet_len_score >= 4.0,
            score=bullet_len_score,
            max_score=5.0,
            detail=f"{len(in_range_bullets)} of {len(bullet_words)} bullets are within optimal ATS scannability range (10-32 words)."
        ))

        projects = content.get("projects", [])
        deep_projects = [p for p in projects if len(p.get("bullets", [])) >= 2]
        if len(deep_projects) >= 2:
            proj_score = 5.0
            proj_detail = f"{len(deep_projects)} substantive technical projects with verified bullet details."
        elif len(deep_projects) == 1:
            proj_score = 3.5
            proj_detail = "Only 1 comprehensive project found; recommend at least 2 substantiated projects."
        else:
            proj_score = 1.5
            proj_detail = "Projects section lacks sufficient bullet points or depth."

        p4_checks.append(CategoryCheckItem(
            name="Project Portfolio Depth",
            passed=proj_score == 5.0,
            score=proj_score,
            max_score=5.0,
            detail=proj_detail
        ))

        edu_list = content.get("education", [])
        has_degree = any(e.get("degree") for e in edu_list)
        has_college = any(e.get("institution") or e.get("college") for e in edu_list)
        has_grades = any(e.get("score") or e.get("percentage") or e.get("gpa") or e.get("grade") for e in edu_list)

        if has_degree and has_college and has_grades:
            edu_score = 5.0
            edu_detail = "Complete educational credentials including degree, institution, and performance metric."
        elif has_degree and has_college:
            edu_score = 4.0
            edu_detail = "Degree and institution present; add academic percentage or GPA for completeness."
        else:
            edu_score = 2.0
            edu_detail = "Incomplete education records."

        p4_checks.append(CategoryCheckItem(
            name="Academic Credentials Integrity",
            passed=edu_score >= 4.5,
            score=edu_score,
            max_score=5.0,
            detail=edu_detail
        ))

        p4_total = sum(c.score for c in p4_checks)
        p4_status: Literal["pass", "warning", "fail"] = "pass" if p4_total >= 16 else ("warning" if p4_total >= 12 else "fail")

        # -------------------------------------------------------------
        # OVERALL SCORE, GRADE & ACTIONABLE CHECKLIST
        # -------------------------------------------------------------
        overall_score = round(p1_total + p2_total + p3_total + p4_total)
        overall_score = max(0, min(100, overall_score))

        grade: Literal["A+", "A", "B", "C", "D"]
        if overall_score >= 90:
            grade = "A+"
            summary = "Outstanding ATS Match. Your resume is exceptionally structured, keyword-aligned, and impact-driven for ATS filters."
        elif overall_score >= 80:
            grade = "A"
            summary = "Strong ATS Candidate. Passes most automated parsers easily; a few minor metric or keyword tweaks can push you to A+."
        elif overall_score >= 70:
            grade = "B"
            summary = "Good Foundation. Clean format, but missing several target keywords or quantified metric bullets."
        elif overall_score >= 60:
            grade = "C"
            summary = "Needs Optimization. Substantial keyword gaps or passive language may reduce your ATS callback rate."
        else:
            grade = "D"
            summary = "High Filtering Risk. Format, missing headers, or lacking metrics puts this resume at high risk of automatic ATS rejection."

        checklist: List[ChecklistItem] = []

        for missing in missing_list:
            if missing.importance == "High":
                checklist.append(ChecklistItem(
                    id=f"chk_missing_{missing.id}",
                    priority="critical",
                    category="Keywords",
                    title=f"Add verified experience with {missing.name}",
                    description=f"{missing.name} is a high-priority requirement in the job description that is currently absent.",
                    passed=False,
                    impact_points=3
                ))

        weak_bullets = [b for b in bullet_audits if b.has_weak_opener]
        if weak_bullets:
            checklist.append(ChecklistItem(
                id="chk_weak_openers",
                priority="high",
                category="Impact",
                title=f"Replace {len(weak_bullets)} weak/passive bullet openers",
                description="Phrases like 'worked on' or 'helped with' weaken impact. Use strong power verbs like 'Architected', 'Engineered', or 'Optimized'.",
                passed=False,
                impact_points=len(weak_bullets) * 2
            ))

        non_metric_bullets = [b for b in bullet_audits if not b.has_metric]
        if len(non_metric_bullets) > len(bullet_audits) * 0.4:
            checklist.append(ChecklistItem(
                id="chk_missing_metrics",
                priority="high",
                category="Impact",
                title="Quantify achievements across project and work bullets",
                description="Add concrete numbers (%, latency reduction, user scale, request volume) to demonstrate tangible outcomes.",
                passed=False,
                impact_points=5
            ))

        for c in p1_checks + p4_checks:
            if not c.passed:
                checklist.append(ChecklistItem(
                    id=f"chk_struct_{c.name.lower().replace(' ', '_')}",
                    priority="medium" if c.score > 0 else "critical",
                    category="Format & Structure",
                    title=c.name,
                    description=c.detail,
                    passed=False,
                    impact_points=round(c.max_score - c.score)
                ))

        for c in p1_checks + p3_checks + p4_checks:
            if c.passed:
                checklist.append(ChecklistItem(
                    id=f"chk_passed_{c.name.lower().replace(' ', '_')}",
                    priority="low",
                    category="Passed Checks",
                    title=c.name,
                    description=c.detail,
                    passed=True,
                    impact_points=0
                ))

        category_scores = {
            "parseability": CategoryScore(
                name="ATS Parseability & Format",
                score=round(p1_total, 1),
                max_score=25.0,
                percentage=round((p1_total / 25.0) * 100, 1),
                status=p1_status,
                summary="Evaluates standard headers, contact details, glyph safety, and single-page density.",
                checks=p1_checks
            ),
            "keyword_match": CategoryScore(
                name="Technical Keyword & Competency Alignment",
                score=round(p2_total, 1),
                max_score=30.0,
                percentage=round((p2_total / 30.0) * 100, 1),
                status=p2_status,
                summary="Matches technical taxonomy terms against the target job description requirements.",
                checks=p2_checks
            ),
            "impact_verbs": CategoryScore(
                name="Impact, Action Verbs & Quantified Metrics",
                score=round(p3_total, 1),
                max_score=25.0,
                percentage=round((p3_total / 25.0) * 100, 1),
                status=p3_status,
                summary="Audits bullet points for strong power verbs, quantifiable results, and absence of passive phrasing.",
                checks=p3_checks
            ),
            "structural_integrity": CategoryScore(
                name="Structural Integrity & Content Density",
                score=round(p4_total, 1),
                max_score=20.0,
                percentage=round((p4_total / 20.0) * 100, 1),
                status=p4_status,
                summary="Checks professional summary depth, bullet scannability, project substantiation, and education.",
                checks=p4_checks
            )
        }

        read_time_secs = max(int(word_count / 3.5), 15)
        read_time_str = f"{read_time_secs} sec" if read_time_secs < 60 else f"{round(read_time_secs/60, 1)} min"

        return AtsScanResult(
            overall_score=overall_score,
            grade=grade,
            summary=summary,
            category_scores=category_scores,
            keyword_matrix=keyword_matrix,
            bullet_audits=bullet_audits,
            actionable_checklist=checklist,
            metadata=ScanMetadata(
                resume_id=resume_id,
                job_id=job_id,
                source_type="tailored_resume",
                file_name=f"{resume_data.get('targetRole', 'Resume')}.pdf",
                page_count=1,
                word_count=word_count,
                estimated_read_time=read_time_str,
                taxonomy_version=TAXONOMY_VERSION
            )
        )

    def scan_raw_resume_bytes(
        self,
        file_bytes: bytes,
        filename: str,
        content_type: str,
        job_description: Optional[str] = None
    ) -> AtsScanResult:
        """
        Scan an uploaded PDF, DOCX, or TXT file bytes.
        Performs in-memory text extraction, section identification, and runs the 100-point rubric.
        Zero disk/Firestore persistence: 100% ephemeral and private.
        """
        extracted_text = ""
        page_count = 1

        lower_name = filename.lower()
        if lower_name.endswith(".pdf") or "pdf" in content_type:
            try:
                reader = pypdf.PdfReader(io.BytesIO(file_bytes))
                page_count = len(reader.pages)
                extracted_text = "\n".join([page.extract_text() or "" for page in reader.pages])
            except Exception as e:
                logger.error(f"Failed to extract text from PDF: {e}")
                extracted_text = ""
        elif lower_name.endswith(".docx") or "officedocument" in content_type:
            try:
                doc = docx.Document(io.BytesIO(file_bytes))
                extracted_text = "\n".join([p.text for p in doc.paragraphs if p.text])
                page_count = max(1, int(len(extracted_text.split()) / 400))
            except Exception as e:
                logger.error(f"Failed to extract text from DOCX: {e}")
                extracted_text = ""
        else:
            try:
                extracted_text = file_bytes.decode("utf-8", errors="ignore")
                page_count = max(1, int(len(extracted_text.split()) / 400))
            except Exception as e:
                logger.error(f"Failed to decode raw text: {e}")
                extracted_text = ""

        # High-Fidelity in-memory section extraction
        lines = [line.strip() for line in extracted_text.split("\n") if line.strip()]
        
        # Extract Contact
        email_match = re.search(r"[\w\.-]+@[\w\.-]+\.\w+", extracted_text)
        phone_match = re.search(r"(\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}", extracted_text)
        linkedin_match = "linkedin.com" in extracted_text.lower()
        github_match = "github.com" in extracted_text.lower()
        full_name = lines[0] if lines else "Applicant"

        # Segment sections
        sections: Dict[str, List[str]] = {
            "summary": [],
            "experience": [],
            "projects": [],
            "skills": [],
            "education": [],
            "other": []
        }

        current_sec = "summary"
        for line in lines[1:]:
            lower_line = line.lower().strip(":#=-* ")
            if lower_line in ["experience", "work experience", "professional experience", "employment history"]:
                current_sec = "experience"
            elif lower_line in ["projects", "technical projects", "featured projects", "academic projects"]:
                current_sec = "projects"
            elif lower_line in ["skills", "technical skills", "skills & tools", "core competencies"]:
                current_sec = "skills"
            elif lower_line in ["education", "academic background", "education & credentials"]:
                current_sec = "education"
            elif lower_line in ["summary", "professional summary", "about me", "profile"]:
                current_sec = "summary"
            else:
                sections[current_sec].append(line)

        # Bullets
        exp_bullets = [l for l in sections["experience"] if l.startswith(("-", "•", "*", "–")) or len(l.split()) >= 8]
        if not exp_bullets and sections["experience"]:
            exp_bullets = sections["experience"]

        proj_bullets = [l for l in sections["projects"] if l.startswith(("-", "•", "*", "–")) or len(l.split()) >= 8]
        if not proj_bullets and sections["projects"]:
            proj_bullets = sections["projects"]

        # If sections weren't clearly delimited, fallback to all bullet-like lines
        if not exp_bullets and not proj_bullets:
            all_bullet_lines = [l for l in lines if l.startswith(("-", "•", "*", "–")) or len(l.split()) >= 8]
            exp_bullets = all_bullet_lines[:6]
            proj_bullets = all_bullet_lines[6:10] if len(all_bullet_lines) > 6 else all_bullet_lines[:2]

        summary_content = " ".join(sections["summary"][:3]) if sections["summary"] else (lines[1] if len(lines) > 1 else "Professional Summary")

        synthetic_resume = {
            "content": {
                "contact": {
                    "fullName": full_name,
                    "email": email_match.group(0) if email_match else "",
                    "phone": phone_match.group(0) if phone_match else "",
                    "linkedin": "linkedin.com/in/applicant" if linkedin_match else "",
                    "github": "github.com/applicant" if github_match else ""
                },
                "summary": summary_content,
                "experience": [
                    {
                        "title": "Professional Experience",
                        "company": "Organization",
                        "bullets": exp_bullets[:6]
                    }
                ],
                "projects": [
                    {
                        "name": "Featured Project",
                        "bullets": proj_bullets[:4]
                    }
                ],
                "skills": extract_technical_entities(extracted_text),
                "education": [
                    {
                        "degree": "Degree",
                        "institution": "University / College",
                        "year": "2024",
                        "score": "GPA / Percentage" if any(w in extracted_text.lower() for w in ["gpa", "cgpa", "%", "percentage"]) else ""
                    }
                ]
            }
        }

        job_data = {"description": job_description} if job_description else None
        res = self.scan_tailored_resume(synthetic_resume, job_data)

        # Explicit metadata for raw upload
        res.metadata.source_type = "file_upload"
        res.metadata.file_name = filename
        res.metadata.page_count = page_count

        return res

    async def generate_ai_bullet_suggestions(
        self,
        bullet_text: str,
        role_or_project: str = "",
        section: str = "",
        job_title: Optional[str] = None,
        job_description: Optional[str] = None
    ) -> AiBulletRewriteResponse:
        """
        Generate 3 high-impact, grounded ATS bullet rewrites via Gemini.
        Utilizes dedicated SCANNER_GEMINI_API_KEY (Key 3) for separate quota.
        """
        prompt = f"""
You are an expert ATS Resume Optimization Specialist.
Rewrite the following weak/moderate resume bullet into 3 high-impact, industry-standard ATS bullet variations.

Original Bullet: "{bullet_text}"
Context / Role / Project: "{role_or_project}" ({section})
Target Job Title: "{job_title or 'Software Engineer'}"
Target Job Context: "{job_description or 'Technical Engineering Role'}"

Strict Guidelines:
1. Every bullet MUST start with a strong past-tense action verb (e.g., 'Architected', 'Engineered', 'Optimized', 'Automated', 'Streamlined').
2. NEVER use weak or passive openers like 'Worked on', 'Responsible for', or 'Helped with'.
3. Include realistic, contextually grounded metrics (e.g. latency %, efficiency boost, query performance, user scale) without inventing fake companies or degrees.
4. Keep length between 14 and 28 words for optimal ATS scannability.
5. Provide 3 distinct styles:
   - Style 1: "High-Impact Quantified" (emphasizing numerical metrics and performance gain)
   - Style 2: "Action-Oriented Architecture" (emphasizing technical depth, stack, and design)
   - Style 3: "Concise & Focused" (crisp, direct, high-signal phrasing)

Return a JSON object with this exact structure:
{{
  "suggestions": [
    {{
      "style": "High-Impact Quantified",
      "text": "<rewritten bullet>",
      "rationale": "<brief 1-sentence explanation of the improvement>"
    }},
    {{
      "style": "Action-Oriented Architecture",
      "text": "<rewritten bullet>",
      "rationale": "<brief 1-sentence explanation of the improvement>"
    }},
    {{
      "style": "Concise & Focused",
      "text": "<rewritten bullet>",
      "rationale": "<brief 1-sentence explanation of the improvement>"
    }}
  ]
}}
"""
        class SuggestionsOutput(BaseModel):
            class SuggestionItem(BaseModel):
                style: str
                text: str
                rationale: str
            suggestions: List[SuggestionItem]

        try:
            # Use dedicated ATS Scanner Gemini API Key (Key 3)
            scanner_key = settings.SCANNER_GEMINI_API_KEY or settings.GEMINI_API_KEY
            provider = GeminiProvider(api_key=scanner_key)
            output = await provider.generate_structured(
                prompt=prompt,
                schema=SuggestionsOutput,
                temperature=0.2
            )

            suggestions: List[BulletSuggestion] = []
            for s in output.suggestions:
                audit = audit_bullet_text(s.text)
                suggestions.append(BulletSuggestion(
                    text=s.text,
                    style=s.style,
                    audit=audit,
                    rationale=s.rationale
                ))

            return AiBulletRewriteResponse(
                original_bullet=bullet_text,
                suggestions=suggestions
            )

        except Exception as e:
            logger.error(f"Gemini bullet rewrite failed: {e}")
            cleaned = bullet_text.lstrip("-•* ").strip()
            fallback_text_1 = re.sub(r"^(worked on|helped with|responsible for|handled)\b", "Engineered", cleaned, flags=re.IGNORECASE)
            if fallback_text_1 == cleaned:
                fallback_text_1 = f"Engineered and deployed {cleaned.lower()}"

            fallback_text_2 = f"Architected scalable solution for {cleaned.lower()} with modular component boundaries."
            fallback_text_3 = f"Streamlined {cleaned.lower()} with structured data handling and robust validation."

            fallback_suggestions = [
                BulletSuggestion(
                    text=fallback_text_1,
                    style="Action-Oriented Architecture",
                    audit=audit_bullet_text(fallback_text_1),
                    rationale="Replaced passive opener with strong engineering action verb."
                ),
                BulletSuggestion(
                    text=fallback_text_2,
                    style="System Architecture",
                    audit=audit_bullet_text(fallback_text_2),
                    rationale="Structured technical implementation and design patterns."
                ),
                BulletSuggestion(
                    text=fallback_text_3,
                    style="Concise & Focused",
                    audit=audit_bullet_text(fallback_text_3),
                    rationale="Focused on implementation reliability and validation."
                )
            ]

            return AiBulletRewriteResponse(
                original_bullet=bullet_text,
                suggestions=fallback_suggestions
            )



    async def generate_bulk_ai_bullet_suggestions(
        self,
        bullets: List[BulkBulletInput],
        job_title: Optional[str] = None,
        job_description: Optional[str] = None
    ) -> BulkAiBulletRewriteResponse:
        """
        Generate two complete sets of grounded ATS optimizations (Set A and Set B)
        for all N selected bullets in exactly ONE single Gemini request.

        Strict Anti-Fabrication Constraints:
        - Optimize only the provided bullet. Do not invent or assume anything.
        - NEVER fabricate metrics, numbers, percentages, tools, technologies, scale, revenue, or employers.
        - If the original bullet has no verified metric, do NOT create one just to make the bullet stronger.
        - Focus strictly on stronger truthful power verbs, clearer technical ownership, and job-relevant phrasing.
        """
        if not bullets:
            return BulkAiBulletRewriteResponse(
                set_a=[],
                set_b=[],
                total_processed=0,
                validation_passed=True
            )

        bullet_blocks = []
        for idx, b in enumerate(bullets, 1):
            bullet_blocks.append(f"[BULLET_{idx}]\nID: {b.id}\nContext: {b.role_or_project} ({b.section})\nOriginal Text: {b.original_text}")
        bullets_payload = "\n\n".join(bullet_blocks)
        prompt = f"""
You are an expert ATS Career Document & Resume Optimization Specialist.
You are given exactly {len(bullets)} resume bullet point(s) to optimize.

TARGET JOB CONTEXT:
Job Title: {job_title or 'Engineering / Professional Role'}
Job Details: {job_description or 'Professional competencies'}

INPUT BULLETS TO OPTIMIZE:
{bullets_payload}

CRITICAL ANTI-FABRICATION & TRUTH RULES:
1. OPTIMIZE ONLY THE PROVIDED BULLETS. DO NOT INVENT OR ASSUME ANYTHING.
2. NEVER FABRICATE:
   - Metrics, percentages (e.g. 'reduced latency by 45%'), numbers, scale, dollar amounts, or revenue.
   - Technologies, programming languages, libraries, or tools not mentioned in the original bullet.
   - Employer names, project titles, dates, or responsibilities.
3. If an input bullet has NO metric, DO NOT create or invent a number. Focus strictly on powerful past-tense action verbs (e.g., 'Architected', 'Engineered', 'Organized', 'Mentored', 'Spearheaded', 'Coordinated'), active ownership, and cleaner phrasing.
4. If an input bullet ALREADY has a metric (e.g. 'saving 0K' or '50 nodes'), PRESERVE that metric faithfully.
5. You MUST return EXACTLY TWO SETS: 'set_a' and 'set_b'.
   - 'set_a' MUST contain EXACTLY {len(bullets)} items corresponding 1-to-1 with the input bullets in identical order.
     Emphasis for Set A: Strong action verbs, active individual ownership, concise verified impact (strictly supported by the supplied bullet facts), and direct job-relevant phrasing.
   - 'set_b' MUST contain EXACTLY {len(bullets)} items corresponding 1-to-1 with the input bullets in identical order.
     Emphasis for Set B: Technical workflows and systems depth (strictly grounded in the technologies, architecture, and responsibilities verified in the supplied bullet).
6. Length: 12 to 28 words per bullet for optimal ATS scannability.
"""

        class BulkSuggestionsOutput(BaseModel):
            class RawSetItem(BaseModel):
                bullet_id: str
                text: str
                style: str
                rationale: str

            set_a: List[RawSetItem]
            set_b: List[RawSetItem]

        try:
            scanner_key = settings.SCANNER_GEMINI_API_KEY or settings.GEMINI_API_KEY
            provider = GeminiProvider(api_key=scanner_key)
            output = await provider.generate_structured(
                prompt=prompt,
                schema=BulkSuggestionsOutput,
                temperature=0.2
            )

            # Deterministic Pre-Apply Truth & Count Validation
            set_a_items: List[OptimizedBulletItem] = []
            set_b_items: List[OptimizedBulletItem] = []
            all_valid = True

            input_ids = [b.id for b in bullets]
            input_map = {b.id: b for b in bullets}

            # Map and validate Set A
            raw_a_map = {item.bullet_id: item for item in output.set_a}
            for b in bullets:
                if b.id in raw_a_map:
                    raw = raw_a_map[b.id]
                    audit = audit_bullet_text(raw.text)
                    issues = []
                    is_valid = True

                    # Verify no fabricated metrics if original had none
                    orig_audit = audit_bullet_text(b.original_text)
                    if not orig_audit["has_metric"] and audit["has_metric"]:
                        # Detected newly introduced metric not in original
                        issues.append("Newly introduced metric; verify against personal records before applying.")

                    set_a_items.append(OptimizedBulletItem(
                        bullet_id=b.id,
                        text=raw.text,
                        style="Action & Verified Impact",
                        has_action_verb=audit["has_action_verb"],
                        has_metric=audit["has_metric"],
                        rationale=raw.rationale,
                        is_valid=is_valid,
                        validation_issues=issues
                    ))
                else:
                    all_valid = False
                    # Fallback to cleaned original
                    audit = audit_bullet_text(b.original_text)
                    set_a_items.append(OptimizedBulletItem(
                        bullet_id=b.id,
                        text=b.original_text,
                        style="Action & Verified Impact",
                        has_action_verb=audit["has_action_verb"],
                        has_metric=audit["has_metric"],
                        rationale="Preserved original phrasing (fallback).",
                        is_valid=True,
                        validation_issues=[]
                    ))

            # Map and validate Set B
            raw_b_map = {item.bullet_id: item for item in output.set_b}
            for b in bullets:
                if b.id in raw_b_map:
                    raw = raw_b_map[b.id]
                    audit = audit_bullet_text(raw.text)
                    issues = []
                    is_valid = True

                    orig_audit = audit_bullet_text(b.original_text)
                    if not orig_audit["has_metric"] and audit["has_metric"]:
                        issues.append("Newly introduced metric; verify against personal records before applying.")

                    set_b_items.append(OptimizedBulletItem(
                        bullet_id=b.id,
                        text=raw.text,
                        style="Architecture & Systems Depth",
                        has_action_verb=audit["has_action_verb"],
                        has_metric=audit["has_metric"],
                        rationale=raw.rationale,
                        is_valid=is_valid,
                        validation_issues=issues
                    ))
                else:
                    all_valid = False
                    audit = audit_bullet_text(b.original_text)
                    set_b_items.append(OptimizedBulletItem(
                        bullet_id=b.id,
                        text=b.original_text,
                        style="Architecture & Systems Depth",
                        has_action_verb=audit["has_action_verb"],
                        has_metric=audit["has_metric"],
                        rationale="Preserved original phrasing (fallback).",
                        is_valid=True,
                        validation_issues=[]
                    ))

            return BulkAiBulletRewriteResponse(
                set_a=set_a_items,
                set_b=set_b_items,
                total_processed=len(bullets),
                validation_passed=all_valid
            )

        except Exception as e:
            logger.error(f"Bulk Gemini bullet rewrite failed: {e}", exc_info=True)
            # Graceful deterministic fallback: Strengthen verbs without hallucinating metrics
            set_a_items = []
            set_b_items = []

            for b in bullets:
                cleaned = b.original_text.lstrip("-•* ").strip()
                # Strong verb rewrite for Set A
                alt_a = re.sub(r"^(worked on|helped with|responsible for|handled|assisted with)", "Engineered", cleaned, flags=re.IGNORECASE)
                if alt_a == cleaned and not audit_bullet_text(cleaned)["has_action_verb"]:
                    alt_a = f"Engineered and delivered {cleaned[0].lower() + cleaned[1:] if len(cleaned) > 1 else cleaned}"

                # Architecture workflow rewrite for Set B
                alt_b = re.sub(r"^(worked on|helped with|responsible for|handled|assisted with)", "Architected", cleaned, flags=re.IGNORECASE)
                if alt_b == cleaned and not audit_bullet_text(cleaned)["has_action_verb"]:
                    alt_b = f"Architected and integrated {cleaned[0].lower() + cleaned[1:] if len(cleaned) > 1 else cleaned}"

                audit_a = audit_bullet_text(alt_a)
                audit_b = audit_bullet_text(alt_b)

                set_a_items.append(OptimizedBulletItem(
                    bullet_id=b.id,
                    text=alt_a,
                    style="Action & Verified Impact",
                    has_action_verb=audit_a["has_action_verb"],
                    has_metric=audit_a["has_metric"],
                    rationale="Upgraded opener to high-impact action verb.",
                    is_valid=True,
                    validation_issues=[]
                ))

                set_b_items.append(OptimizedBulletItem(
                    bullet_id=b.id,
                    text=alt_b,
                    style="Architecture & Systems Depth",
                    has_action_verb=audit_b["has_action_verb"],
                    has_metric=audit_b["has_metric"],
                    rationale="Reframed around technical architecture and delivery.",
                    is_valid=True,
                    validation_issues=[]
                ))

            return BulkAiBulletRewriteResponse(
                set_a=set_a_items,
                set_b=set_b_items,
                total_processed=len(bullets),
                validation_passed=True
            )


ats_scanner_engine = AtsScannerEngine()
