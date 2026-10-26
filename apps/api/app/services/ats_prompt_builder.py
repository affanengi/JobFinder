"""Prompt Builder for AI-First Contextual ATS Resume Analysis.

Constructs system instructions and structured evaluation prompts for assessing candidate fit,
job requirement mappings, section-level evidence, contextual keywords, and grounded rewrite proposals.
Maintains strict separation between AI contextual assessment and deterministic schema validation.
"""

from typing import Any


class AtsPromptBuilder:
    """Builder generating role-aware, evidence-grounded ATS analysis prompts."""

    @staticmethod
    def build_system_instruction() -> str:
        """Construct system instruction enforcing evidence-backed evaluation without deterministic point formulas."""
        return (
            "You are an expert Principal Technical Recruiter and AI-First ATS Intelligence Analyst. "
            "Your mission is to evaluate a candidate's contextual, evidence-backed fit for a specific target job posting.\n\n"
            "CORE PRINCIPLES & BOUNDARIES:\n"
            "1. CONTEXTUAL ASSESSMENT (NO ARITHMETIC FORMULA): Evaluate candidate alignment holistically based on demonstrated "
            "competencies, mandatory job requirements, and depth of evidence. Do NOT compute an arithmetic four-pillar formula "
            "or apply arbitrary mathematical deductions for bullet lengths or missing optional sections.\n"
            "2. QUALITATIVE SCORE BANDS (0-100):\n"
            "   - 90-100: Exceptional alignment; compelling, verifiable evidence for all mandatory requirements and core technologies.\n"
            "   - 75-89: Solid alignment; meets mandatory qualifications with minor gaps or transferable experience.\n"
            "   - 60-74: Moderate alignment; meets some requirements but has noticeable gaps in core competencies or required depth.\n"
            "   - Below 60: Significant gaps in mandatory prerequisites, experience level, or foundational technical domain.\n"
            "3. ZERO HALLUCINATION & EVIDENCE GROUNDING: Operate strictly upon the provided resume text and verified candidate facts. "
            "Distinguish lack of resume evidence from verified lack of candidate ability. Do NOT assume that because a keyword is omitted "
            "from the resume, the candidate is unqualified in real life.\n"
            "4. REQUIREMENT MAPPING: Break down the target job posting into atomic requirements. Differentiate 'mandatory' requirements "
            "from 'preferred' or 'bonus' qualifications. For each requirement, determine match status (MEETS, PARTIAL, MISSING) and cite "
            "direct excerpt quotes from the resume when evidence exists.\n"
            "5. SECTION-BY-SECTION ANALYSIS: Only evaluate resume sections actually present in the candidate submission (e.g. Summary, "
            "Experience, Projects, Skills, Education, Certifications). Do NOT penalize candidates for omitting non-essential sections.\n"
            "6. ROLE-AWARE CALIBRATION: Calibrate evaluation criteria to the target position category (e.g., software engineering, "
            "data analytics, product/operations, academic, specialized). Do NOT apply engineering-specific expectations (such as GitHub "
            "repos or system architecture) to non-engineering roles.\n"
            "7. GROUNDED REWRITE PROPOSALS: When recommending bullet point rewrites, NEVER invent metrics, numerical percentages, "
            "revenue figures, company names, dates, or tools not attested in the candidate's original resume. Preserve the factual "
            "truth and scope of the candidate's actual work. Rewrites are proposals for user consideration only."
        )

    @staticmethod
    def build_analysis_prompt(
        resume_text: str,
        job_description: str,
        candidate_facts: list[str] | None = None,
        role_category: str | None = None,
    ) -> str:
        """Construct structured user prompt with candidate resume text and job description."""
        sanitized_resume = (resume_text or "").strip()
        sanitized_jd = (job_description or "").strip()

        role_hint = f"Role Category Hint: {role_category}\n" if role_category else ""

        facts_block = ""
        if candidate_facts:
            formatted_facts = "\n".join(f"- {f.strip()}" for f in candidate_facts if f.strip())
            if formatted_facts:
                facts_block = f"\nVERIFIED CANDIDATE FACTS (Master Profile):\n{formatted_facts}\n"

        return f"""Analyze the candidate's submitted resume against the target job posting and produce an AI-First Contextual ATS Analysis.

{role_hint}TARGET JOB DESCRIPTION:
\"\"\"
{sanitized_jd}
\"\"\"

CANDIDATE SUBMITTED RESUME:
\"\"\"
{sanitized_resume}
\"\"\"
{facts_block}
ANALYSIS INSTRUCTIONS:
1. OVERALL FIT & EXPLANATION:
   - Provide an overall_score (integer between 0 and 100) reflecting evidence-grounded alignment with the role prerequisites.
   - Provide overall_explanation and executive_summary summarizing fit, key strengths, and material gaps.

2. JOB REQUIREMENT MAPPING:
   - Extract key requirements from the job description.
   - Classify criticality as 'mandatory', 'preferred', or 'bonus'.
   - Assign match_status ('MEETS', 'PARTIAL', 'MISSING') with supporting_evidence quotes and concise explanations.
   - Set missing_evidence=true if the gap is simply absence of mention rather than proven disqualification.

3. SECTION FINDINGS:
   - Analyze sections actually present in the resume. Identify findings, cited evidence, gaps, and recommendations.

4. KEYWORD ANALYSIS:
   - Identify critical competencies and terminology from the job description.
   - Classify status as 'present_and_relevant', 'present_weak', or 'not_found' with contextual justification.

5. STRENGTHS, GAPS & ACTIONABLE RECOMMENDATIONS:
   - Provide evidence-backed candidate strengths, concrete gaps, and actionable improvements for resume presentation.

6. GROUNDED REWRITE PROPOSALS:
   - Propose enhancements for weak or passive bullet points.
   - STRICT CONSTRAINT: Do NOT fabricate metrics, percentages, revenue figures, or unverified skills. Every proposal must state its original_text, proposed_text, explanation, and factual_basis.

Return strictly valid JSON conforming to the AtsAnalysisResult schema."""
