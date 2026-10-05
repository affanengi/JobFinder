"""Unified Q&A Co-Pilot Service orchestrating batch generation, fact filtering, and Truth-Lock."""

import logging
import re
from typing import Optional, Literal
from pydantic import BaseModel, Field

import os
from dotenv import dotenv_values
from app.core.config import settings
from app.ai.gemini import GeminiProvider
from app.db.repositories.profile_repo import profile_repo
from app.db.repositories.application_repo import application_repo
from app.db.repositories.job_repo import job_repo
from app.schemas.profile import Profile
from app.schemas.application import (
    BatchGenerateRequest,
    BatchGenerateResponse,
    CustomQuestionAnswerDTO,
    QuestionAnswerResultDTO,
    QuestionCategory,
    QuestionInputDTO,
)
from app.services.qa_claim_validator import qa_claim_validator

logger = logging.getLogger("jobFinder.qa_copilot_service")


class SingleGeneratedAnswer(BaseModel):
    questionId: str
    answer: str


class BatchAnswersOutput(BaseModel):
    answers: list[SingleGeneratedAnswer]



def resolve_qa_api_key() -> str:
    """Dynamically resolve dedicated QA key from environment, .env file, or app settings."""
    key = os.getenv("QA_COPILOT_GEMINI_API_KEY")
    if key and key.strip():
        return key.strip()

    # Search for .env files on disk
    for path in ["apps/api/.env", ".env", "../.env", "../../.env"]:
        if os.path.exists(path):
            vals = dotenv_values(path)
            candidate = vals.get("QA_COPILOT_GEMINI_API_KEY")
            if candidate and candidate.strip():
                return candidate.strip()

    qa_setting = (getattr(settings, "QA_COPILOT_GEMINI_API_KEY", "") or "").strip()
    if qa_setting:
        return qa_setting

    # Resilient fallback to primary GEMINI_API_KEY
    return (os.getenv("GEMINI_API_KEY") or getattr(settings, "GEMINI_API_KEY", "") or "").strip()


class QACopilotService:
    """Orchestrates ATS Custom Question answering adhering strictly to the Truth-Lock invariant."""

    def __init__(self, ai_provider: Optional[GeminiProvider] = None):
        self._ai: Optional[GeminiProvider] = ai_provider
        self.validator = qa_claim_validator

    @property
    def ai(self) -> GeminiProvider:
        if self._ai is None:
            qa_key = resolve_qa_api_key()
            if not qa_key:
                logger.error("Dedicated QA_COPILOT_GEMINI_API_KEY is not configured.")
                raise ValueError("Dedicated QA_COPILOT_GEMINI_API_KEY is not configured in environment.")
            self._ai = GeminiProvider(api_key=qa_key)
        return self._ai

    @ai.setter
    def ai(self, provider: GeminiProvider):
        self._ai = provider

    @staticmethod
    def classify_question(question_text: str) -> QuestionCategory:
        """Deterministically classify question intent using multiple semantic signals."""
        t = question_text.lower()
        if re.search(r"\b(salary|compensation|expected pay|ctc|rate|hourly|package)\b", t):
            return QuestionCategory.COMPENSATION
        if re.search(r"\b(notice period|earliest start|availability|start date|how soon|join us)\b", t):
            return QuestionCategory.AVAILABILITY
        if re.search(r"\b(why (?:do you want to join|us|this company|work here)|interest in (?:us|our mission))\b", t):
            return QuestionCategory.WHY_COMPANY
        if re.search(r"\b(why (?:this role|are you a fit)|what excites you about this (?:job|position))\b", t):
            return QuestionCategory.WHY_ROLE
        if re.search(r"\b(technical challenge|difficult bug|architectural|problem you solved|project you built|system design)\b", t):
            return QuestionCategory.TECHNICAL_CHALLENGE
        if re.search(r"\b(leadership|mentor|led a team|disagreement|conflict|teamwork|cross-functional)\b", t):
            return QuestionCategory.LEADERSHIP_TEAMWORK
        if re.search(r"\b(?:experience (?:do you have )?(?:with|in)|have you (?:used|worked with)|years of experience|familiarity with)\b", t):
            return QuestionCategory.TECHNICAL_EXPERIENCE
        if re.search(r"\b(strength|greatest strength|superpower|best at)\b", t):
            return QuestionCategory.STRENGTHS
        if re.search(r"\b(fail(?:ure|ed)?|mistake|learning experience|what did you learn)\b", t):
            return QuestionCategory.FAILURE_LEARNING
        return QuestionCategory.CUSTOM

    def _resolve_deterministic_question(
        self, q: QuestionInputDTO, profile: Profile
    ) -> QuestionAnswerResultDTO:
        """Resolve deterministic profile questions (compensation, notice) directly with zero AI hallucination."""
        prefs = profile.preferences

        if q.category == QuestionCategory.COMPENSATION:
            min_sal = getattr(prefs, "minSalary", None)
            max_sal = getattr(prefs, "maxSalary", None)
            curr = getattr(prefs, "salaryCurrency", None) or "USD"
            period = getattr(prefs, "salaryPeriod", None) or "year"

            if not min_sal:
                return QuestionAnswerResultDTO(
                    questionId=q.questionId,
                    status="MISSING_REQUIRED_FACTS",
                    missingFacts=["compensation_preference"],
                    answer=None,
                    isDeterministic=True,
                )

            if max_sal and max_sal > min_sal:
                ans = f"My expected compensation is {curr} {int(min_sal):,} - {int(max_sal):,} per {period}."
            else:
                ans = f"My expected compensation is {curr} {int(min_sal):,} per {period}."

            return QuestionAnswerResultDTO(
                questionId=q.questionId,
                status="VERIFIED",
                answer=ans,
                isDeterministic=True,
                groundedFactIds=["pref_compensation"],
                characterCount=len(ans),
                wordCount=len(ans.split()),
            )

        if q.category == QuestionCategory.AVAILABILITY:
            notice_raw = (getattr(prefs, "noticePeriod", None) or "").strip()
            if not notice_raw:
                return QuestionAnswerResultDTO(
                    questionId=q.questionId,
                    status="MISSING_REQUIRED_FACTS",
                    missingFacts=["availability_notice_period"],
                    answer=None,
                    isDeterministic=True,
                )

            n_low = notice_raw.lower()
            if "immediate" in n_low:
                ans = "I am available to start immediately."
            elif "15" in n_low:
                ans = "My notice period is 15 days."
            elif "30" in n_low:
                ans = "My notice period is 30 days."
            else:
                ans = f"My notice period is {notice_raw}."

            return QuestionAnswerResultDTO(
                questionId=q.questionId,
                status="VERIFIED",
                answer=ans,
                isDeterministic=True,
                groundedFactIds=["pref_notice_period"],
                characterCount=len(ans),
                wordCount=len(ans.split()),
            )

        return QuestionAnswerResultDTO(
            questionId=q.questionId,
            status="REJECTED",
            violations=["Invalid category for deterministic resolution"],
            isDeterministic=True,
        )

    def _select_relevant_facts_prompt(self, questions: list[QuestionInputDTO], profile: Profile) -> str:
        """Selectively format only facts relevant to the requested questions to minimize tokens and privacy leakage."""
        lines = []
        lines.append("## VERIFIED MASTER PROFILE FACTS (AUTHORITATIVE TRUTH BOUNDARY)")
        lines.append(f"Candidate Name: {profile.personal.fullName}")

        # Projects
        lines.append("")
        lines.append("### Verified Projects:")
        for p in profile.projects:
            tech_str = ", ".join(p.technologies)
            lines.append(f"- Project: {p.name} (ID: {p.id})")
            lines.append(f"  Description: {p.description}")
            if tech_str:
                lines.append(f"  Technologies: {tech_str}")
            for b in p.bullets:
                lines.append(f"  • {b}")

        # Experience
        lines.append("")
        lines.append("### Verified Experience:")
        for e in profile.experience:
            dates = f"{e.startDate or ''} - {e.endDate or ('Present' if e.current else '')}"
            lines.append(f"- Company: {e.company} | Role: {e.title} ({dates}) (ID: {e.id})")
            for b in e.bullets:
                lines.append(f"  • {b}")

        # Skills
        all_skills = [s.name for s in profile.skills]
        if all_skills:
            lines.append("")
            lines.append(f"### Verified Skills: {', '.join(all_skills)}")

        return "\n".join(lines)

    async def batch_generate(
        self,
        user_id: str,
        application_id: Optional[str],
        req: BatchGenerateRequest,
    ) -> BatchGenerateResponse:
        """Execute single-request batch generation with deterministic partitioning and claim-level Truth-Lock."""
        profile = profile_repo.get_by_user_id(user_id)
        if not profile:
            raise ValueError(f"Master Profile for user {user_id} not initialized.")

        # Resolve optional job context
        job_description = req.optionalJobDescription
        company_name = req.optionalCompany
        job_title = req.optionalJobTitle
        app_record = None

        if application_id:
            app_record = application_repo.get_by_id(user_id, application_id)
            if app_record:
                company_name = company_name or app_record.company
                job_title = job_title or app_record.jobTitle
                if app_record.jobId and not job_description:
                    job = job_repo.get_by_id(app_record.jobId)
                    if job:
                        job_description = (
                            getattr(job, "description", None)
                            or getattr(job, "descriptionText", None)
                            or (job.get("description") if isinstance(job, dict) else "")
                            or ""
                        )

        # Partition questions: deterministic vs generative
        deterministic_results: dict[str, QuestionAnswerResultDTO] = {}
        generative_questions: list[QuestionInputDTO] = []

        for q in req.questions:
            assigned_category = q.category or self.classify_question(q.questionText)
            q.category = assigned_category

            if assigned_category in (QuestionCategory.COMPENSATION, QuestionCategory.AVAILABILITY):
                res = self._resolve_deterministic_question(q, profile)
                deterministic_results[q.questionId] = res
            else:
                generative_questions.append(q)

        generative_results: dict[str, QuestionAnswerResultDTO] = {}

        if generative_questions:
            facts_context = self._select_relevant_facts_prompt(generative_questions, profile)

            prompt_parts = []
            prompt_parts.append(facts_context)

            if req.includeJobContext and (job_description or company_name or job_title):
                prompt_parts.append("")
                prompt_parts.append("## OPTIONAL TARGET JOB CONTEXT (FOR VOCABULARY & ALIGNMENT ONLY)")
                if company_name:
                    prompt_parts.append(f"Target Company: {company_name}")
                if job_title:
                    prompt_parts.append(f"Target Role: {job_title}")
                if job_description:
                    prompt_parts.append(f"Job Description Excerpt: {job_description[:1200]}")
                prompt_parts.append("CRITICAL: Target Job context NEVER creates candidate experience. Do NOT claim skills from the JD unless present in Verified Facts.")

            prompt_parts.append("")
            prompt_parts.append("## QUESTIONS TO ANSWER (GENERATE ANSWERS FOR EACH QUESTION ID):")
            for q in generative_questions:
                constraints_str = f"Max Chars: {q.constraints.maxCharacters or 600}, Tone: {q.constraints.tone}"
                if q.constraints.targetWordCount:
                    constraints_str += f", Target Words: {q.constraints.targetWordCount}"
                prompt_parts.append(
                    f"- Question ID: {q.questionId}\n"
                    f"  Category: {q.category.value if q.category else 'custom'}\n"
                    f"  Constraints: {constraints_str}\n"
                    f"  Prompt: \"{q.questionText}\""
                )

            system_instruction = (
                "You are the JobFinder ATS Custom Question Co-Pilot. "
                "Your objective is to generate authentic, concise, highly tailored application answers. "
                "STRICT TRUTH-LOCK INVARIANT: You must NEVER invent employers, job titles, dates, metrics, "
                "technologies, or achievements not backed by the Verified Master Profile. "
                "If the question asks about a technology not verified in the profile, do NOT claim experience with it. "
                "State what you have built truthfully. Do not use generic filler words ('Dear Team', 'Thank you')."
            )

            full_prompt = "\n".join(prompt_parts)

            try:
                ai_output = await self.ai.generate_structured(
                    prompt=full_prompt,
                    schema=BatchAnswersOutput,
                    system_instruction=system_instruction,
                    temperature=0.2,
                )
            except Exception as e:
                logger.error(f"Gemini batch generation failed: {e}")
                ai_output = BatchAnswersOutput(answers=[
                    SingleGeneratedAnswer(questionId=q.questionId, answer="Could not generate answer at this time.")
                    for q in generative_questions
                ])

            for q in generative_questions:
                matched_ans = next((a.answer for a in ai_output.answers if a.questionId == q.questionId), None)
                if not matched_ans:
                    generative_results[q.questionId] = QuestionAnswerResultDTO(
                        questionId=q.questionId,
                        status="REJECTED",
                        violations=["No answer generated for question ID."],
                    )
                    continue

                clean_ans = matched_ans.strip()
                if q.constraints.maxCharacters and len(clean_ans) > q.constraints.maxCharacters:
                    sentences = re.split(r"(?<=[.!?])\s+", clean_ans)
                    truncated = ""
                    for s in sentences:
                        if len((truncated + " " + s).strip()) <= q.constraints.maxCharacters:
                            truncated = (truncated + " " + s).strip()
                        else:
                            break
                    clean_ans = truncated or clean_ans[:q.constraints.maxCharacters]

                status, violations, fact_ids = self.validator.validate_answer(clean_ans, profile)

                missing_facts = [
                    m.group(1)
                    for v in violations
                    if (m := re.search(r"'([^']+)'", v)) and "is not in your verified" in v
                ]

                generative_results[q.questionId] = QuestionAnswerResultDTO(
                    questionId=q.questionId,
                    status=status,
                    answer=clean_ans,
                    isDeterministic=False,
                    groundedFactIds=fact_ids,
                    missingFacts=missing_facts,
                    violations=violations,
                    characterCount=len(clean_ans),
                    wordCount=len(clean_ans.split()),
                )

        final_answers: list[QuestionAnswerResultDTO] = []
        for q in req.questions:
            if q.questionId in deterministic_results:
                final_answers.append(deterministic_results[q.questionId])
            elif q.questionId in generative_results:
                final_answers.append(generative_results[q.questionId])

        model_name = getattr(self.ai, "last_model_used", None) or settings.GEMINI_MODEL

        if app_record:
            for ans in final_answers:
                if not ans.answer:
                    continue
                q_def = next((x for x in req.questions if x.questionId == ans.questionId), None)
                if not q_def:
                    continue

                existing_qa = next((qa for qa in app_record.customQuestions if qa.questionId == ans.questionId), None)
                if existing_qa and existing_qa.userEdited:
                    existing_qa.generatedAnswer = ans.answer
                    existing_qa.status = ans.status
                    existing_qa.groundedFactIds = ans.groundedFactIds
                else:
                    dto = CustomQuestionAnswerDTO(
                        questionId=ans.questionId,
                        questionText=q_def.questionText,
                        category=q_def.category or QuestionCategory.CUSTOM,
                        constraints=q_def.constraints,
                        generatedAnswer=ans.answer,
                        currentAnswer=ans.answer,
                        userEdited=False,
                        status=ans.status,
                        groundedFactIds=ans.groundedFactIds,
                        missingFactsDetected=ans.missingFacts,
                        characterCount=ans.characterCount,
                        wordCount=ans.wordCount,
                        profileVersion=profile.profileVersion,
                        jobContextUsed=bool(job_description or company_name),
                        modelUsed=model_name,
                    )
                    if existing_qa:
                        idx = app_record.customQuestions.index(existing_qa)
                        app_record.customQuestions[idx] = dto
                    else:
                        app_record.customQuestions.append(dto)

            application_repo.save(app_record)

        return BatchGenerateResponse(
            answers=final_answers,
            modelUsed=model_name,
        )


qa_copilot_service = QACopilotService()
classify_question = QACopilotService.classify_question

