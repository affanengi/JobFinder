"""Tests for Phase 3: AI-First Prompts & Structured Schemas.

Validates:
1. AtsPromptBuilder includes the actual supplied resume and job description.
2. Prompt instructs contextual assessment rather than the retired 4-pillar arithmetic formula.
3. Mandatory and preferred job requirements are clearly distinguished in prompt instructions.
4. Missing resume evidence is distinguished from verified lack of candidate ability.
5. Grounded rewrite instructions strictly prohibit unsupported claims and fabricated metrics.
6. Different role types can be assessed without irrelevant engineering-specific assumptions.
7. Valid structured model responses parse cleanly into AtsAnalysisResult.
8. Scores below 0 or above 100 are strictly rejected by Pydantic validation.
9. Invalid requirement match statuses or keyword statuses are strictly rejected.
10. Missing optional information is handled cleanly without fabricating default values.
11. AtsAnalysisResult exports valid JSON schema compatible with AI Hub structured output.
12. No deterministic score recalculation or arithmetic formula is introduced.
"""

import json
import pytest
from pydantic import ValidationError

from app.schemas.ats_analysis import (
    AtsAnalysisResult,
    ContextualKeywordItem,
    GroundedRewriteProposalItem,
    JobRequirementAnalysisItem,
    KeywordCoverageStatus,
    RequirementCriticality,
    RequirementMatchStatus,
    ResumeSectionAnalysisItem,
    RewriteValidationStatus,
    SectionName,
)
from app.services.ats_prompt_builder import AtsPromptBuilder


# ---------------------------------------------------------------------------
# Test 1 & 2: Prompt Builder Content & Contextual Instructions
# ---------------------------------------------------------------------------
def test_prompt_builder_includes_supplied_resume_and_job_description():
    """Prompt must include the exact supplied resume and job description text."""
    sample_resume = "Alex Chen\nSenior Backend Engineer\nBuilt Python microservices with FastAPI."
    sample_jd = "Senior Python Developer at TechCorp. Must have 5+ years with FastAPI and PostgreSQL."

    prompt = AtsPromptBuilder.build_analysis_prompt(
        resume_text=sample_resume,
        job_description=sample_jd,
        candidate_facts=["Verified Bachelor of Science in Computer Science"],
        role_category="software_engineering",
    )

    assert "Senior Backend Engineer" in prompt
    assert "Senior Python Developer at TechCorp" in prompt
    assert "Verified Bachelor of Science in Computer Science" in prompt
    assert "Role Category Hint: software_engineering" in prompt


def test_prompt_builder_instructs_contextual_assessment_not_arithmetic_formula():
    """System instruction must enforce holistic contextual assessment and prohibit 4-pillar arithmetic math."""
    sys_instruction = AtsPromptBuilder.build_system_instruction()

    # Must mandate contextual assessment
    assert "CONTEXTUAL ASSESSMENT (NO ARITHMETIC FORMULA)" in sys_instruction
    assert "four-pillar" in sys_instruction.lower()
    # Must specify qualitative score bands
    assert "90-100" in sys_instruction
    assert "75-89" in sys_instruction
    assert "60-74" in sys_instruction
    assert "Below 60" in sys_instruction


# ---------------------------------------------------------------------------
# Test 3 & 4: Requirement Mapping & Missing Evidence Nuance
# ---------------------------------------------------------------------------
def test_prompt_builder_distinguishes_mandatory_and_preferred_requirements():
    """System instruction and prompt must distinguish mandatory requirements from preferred/bonus."""
    sys_instruction = AtsPromptBuilder.build_system_instruction()
    user_prompt = AtsPromptBuilder.build_analysis_prompt("resume", "job description")

    assert "mandatory" in sys_instruction.lower()
    assert "preferred" in sys_instruction.lower()
    assert "bonus" in sys_instruction.lower()
    assert "'mandatory', 'preferred', or 'bonus'" in user_prompt


def test_prompt_builder_distinguishes_missing_evidence_from_lack_of_ability():
    """Prompt must explicitly instruct not to conflate missing keywords with lack of candidate ability."""
    sys_instruction = AtsPromptBuilder.build_system_instruction()
    user_prompt = AtsPromptBuilder.build_analysis_prompt("resume", "job description")

    assert "Distinguish lack of resume evidence from verified lack of candidate ability" in sys_instruction
    assert "missing_evidence=true" in user_prompt


# ---------------------------------------------------------------------------
# Test 5: Grounded Rewrite Instructions & Anti-Fabrication Constraints
# ---------------------------------------------------------------------------
def test_prompt_builder_prohibits_fabrication_in_rewrites():
    """Prompt instructions must strictly forbid inventing metrics, percentages, tools, or dates."""
    sys_instruction = AtsPromptBuilder.build_system_instruction()
    user_prompt = AtsPromptBuilder.build_analysis_prompt("resume", "job description")

    assert "NEVER invent metrics, numerical percentages, revenue figures" in sys_instruction
    assert "Do NOT fabricate metrics, percentages, revenue figures" in user_prompt
    assert "Rewrites are proposals" in sys_instruction


# ---------------------------------------------------------------------------
# Test 6: Role-Aware Calibration
# ---------------------------------------------------------------------------
def test_prompt_builder_supports_role_aware_categories():
    """System instruction must require calibrating expectations to role type without imposing engineering criteria."""
    sys_instruction = AtsPromptBuilder.build_system_instruction()

    assert "ROLE-AWARE CALIBRATION" in sys_instruction
    assert "Do NOT apply engineering-specific expectations" in sys_instruction


# ---------------------------------------------------------------------------
# Test 7: Valid Structured Result Parses Cleanly
# ---------------------------------------------------------------------------
def test_ats_analysis_result_valid_parsing():
    """Valid dictionary conforming to AtsAnalysisResult schema parses cleanly."""
    valid_payload = {
        "overall_score": 88,
        "overall_explanation": "Strong candidate demonstrating extensive FastAPI and distributed systems experience.",
        "executive_summary": "Meets all core requirements for senior backend engineer with deep Python expertise.",
        "requirements": [
            {
                "requirement_description": "5+ years backend Python experience",
                "criticality": "mandatory",
                "match_status": "MEETS",
                "supporting_evidence": ["Senior Backend Engineer at TechCo for 5 years"],
                "explanation": "Directly demonstrated through current and prior senior engineering roles.",
                "missing_evidence": False,
            },
            {
                "requirement_description": "Experience with Kubernetes deployments",
                "criticality": "preferred",
                "match_status": "PARTIAL",
                "supporting_evidence": ["Dockerized services and managed container clusters"],
                "explanation": "Demonstrates containerization knowledge but Kubernetes not explicitly named.",
                "missing_evidence": True,
            },
        ],
        "section_analysis": [
            {
                "section_name": "experience",
                "findings": ["High technical substance and clear ownership of architecture."],
                "supporting_evidence": ["Architected distributed messaging pipeline."],
                "gaps": ["Some bullets lack quantified business metrics."],
                "recommendations": ["Clarify transaction throughput where available."],
            }
        ],
        "keyword_analysis": [
            {
                "keyword": "FastAPI",
                "status": "present_and_relevant",
                "explanation": "Primary framework demonstrated across multiple roles.",
                "supporting_evidence": "Engineered REST APIs using FastAPI",
            }
        ],
        "strengths": ["Deep expertise in modern asynchronous Python"],
        "gaps": ["No explicit mention of Kubernetes orchestration"],
        "recommendations": ["Highlight container orchestration experience in technical projects"],
        "rewrite_proposals": [
            {
                "original_text": "Worked on backend microservices using FastAPI.",
                "proposed_text": "Engineered high-throughput backend microservices using FastAPI and PostgreSQL.",
                "explanation": "Adds active verb and clarifies core technology stack without inventing metrics.",
                "factual_basis": "FastAPI and PostgreSQL appear in candidate technical skills and project details.",
                "validation_status": "pending_review",
            }
        ],
    }

    result = AtsAnalysisResult.model_validate(valid_payload)
    assert result.overall_score == 88
    assert len(result.requirements) == 2
    assert result.requirements[0].match_status == RequirementMatchStatus.MEETS
    assert result.requirements[1].match_status == RequirementMatchStatus.PARTIAL
    assert result.keyword_analysis[0].status == KeywordCoverageStatus.PRESENT_AND_RELEVANT
    assert len(result.rewrite_proposals) == 1
    assert result.rewrite_proposals[0].validation_status == RewriteValidationStatus.PENDING_REVIEW


# ---------------------------------------------------------------------------
# Test 8: Score Boundary Validation (0-100)
# ---------------------------------------------------------------------------
def test_ats_analysis_result_rejects_out_of_range_scores():
    """Overall score strictly rejected if < 0 or > 100."""
    base_payload = {
        "overall_explanation": "Test explanation with sufficient length.",
        "executive_summary": "Test executive summary with sufficient length.",
    }

    # Negative score rejected
    with pytest.raises(ValidationError) as exc_info:
        AtsAnalysisResult.model_validate({**base_payload, "overall_score": -5})
    assert "Input should be greater than or equal to 0" in str(exc_info.value)

    # Score over 100 rejected
    with pytest.raises(ValidationError) as exc_info:
        AtsAnalysisResult.model_validate({**base_payload, "overall_score": 105})
    assert "Input should be less than or equal to 100" in str(exc_info.value)

    # Valid boundary scores
    r0 = AtsAnalysisResult.model_validate({**base_payload, "overall_score": 0})
    assert r0.overall_score == 0

    r100 = AtsAnalysisResult.model_validate({**base_payload, "overall_score": 100})
    assert r100.overall_score == 100


# ---------------------------------------------------------------------------
# Test 9: Invalid Status Enums Rejected
# ---------------------------------------------------------------------------
def test_ats_analysis_result_rejects_invalid_enums():
    """Invalid enum values for match_status or criticality must fail validation."""
    with pytest.raises(ValidationError):
        JobRequirementAnalysisItem.model_validate({
            "requirement_description": "Valid requirement",
            "criticality": "invalid_criticality",
            "match_status": "MEETS",
            "explanation": "Valid explanation",
        })

    with pytest.raises(ValidationError):
        JobRequirementAnalysisItem.model_validate({
            "requirement_description": "Valid requirement",
            "criticality": "mandatory",
            "match_status": "EXCELLENT",  # Invalid match status
            "explanation": "Valid explanation",
        })

    with pytest.raises(ValidationError):
        ContextualKeywordItem.model_validate({
            "keyword": "Python",
            "status": "fully_mastered",  # Invalid keyword status
            "explanation": "Valid explanation",
        })


# ---------------------------------------------------------------------------
# Test 10: Handling Optional Information Without Fabrication
# ---------------------------------------------------------------------------
def test_ats_analysis_result_handles_optional_fields():
    """Missing optional lists and fields default cleanly to empty collections without fabricating values."""
    minimal_payload = {
        "overall_score": 75,
        "overall_explanation": "Solid fit for the role with moderate gaps in specific tooling.",
        "executive_summary": "Demonstrates foundational backend competency with good communication skills.",
    }

    result = AtsAnalysisResult.model_validate(minimal_payload)
    assert result.overall_score == 75
    assert result.requirements == []
    assert result.section_analysis == []
    assert result.keyword_analysis == []
    assert result.strengths == []
    assert result.gaps == []
    assert result.recommendations == []
    assert result.rewrite_proposals == []


# ---------------------------------------------------------------------------
# Test 11: Schema Compatibility with AI Hub Structured Output
# ---------------------------------------------------------------------------
def test_ats_analysis_result_schema_compatibility():
    """Schema must export valid JSON schema for AI Hub generate_structured."""
    schema = AtsAnalysisResult.model_json_schema()
    assert schema["type"] == "object"
    assert "overall_score" in schema["properties"]
    assert "overall_explanation" in schema["properties"]
    assert "requirements" in schema["properties"]
    assert "section_analysis" in schema["properties"]
    assert "keyword_analysis" in schema["properties"]
    assert "rewrite_proposals" in schema["properties"]


# ---------------------------------------------------------------------------
# Test 12: No Deterministic Score Recalculation
# ---------------------------------------------------------------------------
def test_no_deterministic_score_recalculation():
    """AtsAnalysisResult preserves the AI-provided score exactly without modifying or recalculating it."""
    # A score of 42 given by the model must remain 42, not replaced by keyword count arithmetic
    result = AtsAnalysisResult(
        overall_score=42,
        overall_explanation="Candidate has relevant foundational skills but lacks mandatory years of experience.",
        executive_summary="Junior candidate applying for senior level role.",
        requirements=[
            JobRequirementAnalysisItem(
                requirement_description="5+ years experience",
                criticality=RequirementCriticality.MANDATORY,
                match_status=RequirementMatchStatus.MISSING,
                explanation="Resume shows 1 year of experience.",
            )
        ],
    )
    assert result.overall_score == 42
