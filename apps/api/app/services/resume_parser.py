"""Resume Parsing Engine extracting structured profile facts with truth provenance and PDF hyperlink support."""

import io
import logging
import uuid

import pypdf

from app.ai.gemini import GeminiProvider
from app.ai.provider import AIProvider
from app.schemas.profile import (
    EducationFact,
    ExperienceFact,
    ExtractedResumeData,
    PersonalContact,
    PersonalLinks,
    Profile,
    ProjectFact,
    SkillFact,
)

logger = logging.getLogger("jobFinder.resume_parser")


class ResumeParserService:
    """Service that parses raw resume documents into canonical profile candidates."""

    def __init__(self, ai_provider: AIProvider | None = None):
        self.ai_provider = ai_provider or GeminiProvider()

    def extract_text_and_links_from_pdf(self, pdf_bytes: bytes) -> str:
        """Extract plain text and embedded PDF hyperlink annotations (e.g. from LaTeX \\href)."""
        try:
            reader = pypdf.PdfReader(io.BytesIO(pdf_bytes))
            text_chunks: list[str] = []
            extracted_uris: list[str] = []

            for page in reader.pages:
                page_text = page.extract_text()
                if page_text:
                    text_chunks.append(page_text)

                # Extract embedded PDF link annotations (LaTeX \href{URL}{Label})
                if "/Annots" in page:
                    annots = page["/Annots"]
                    try:
                        annots_list = (
                            annots.get_object() if hasattr(annots, "get_object") else annots
                        )
                        if isinstance(annots_list, list):
                            for annot in annots_list:
                                annot_obj = (
                                    annot.get_object() if hasattr(annot, "get_object") else annot
                                )
                                if "/A" in annot_obj:
                                    action = annot_obj["/A"]
                                    action_obj = (
                                        action.get_object()
                                        if hasattr(action, "get_object")
                                        else action
                                    )
                                    if "/URI" in action_obj:
                                        uri = str(action_obj["/URI"]).strip()
                                        if uri.startswith("http") and uri not in extracted_uris:
                                            extracted_uris.append(uri)
                    except Exception as annot_err:
                        logger.debug(f"Annotation extraction note: {annot_err}")

            extracted_text = "\n".join(text_chunks).strip()
            if not extracted_text:
                raise ValueError("No readable text could be extracted from PDF.")

            if extracted_uris:
                extracted_text += "\n\n[Embedded Hyperlinks in Resume Document]:\n" + "\n".join(
                    f"- {u}" for u in extracted_uris
                )

            return extracted_text
        except Exception as e:
            logger.error(f"pypdf extraction error: {e}")
            raise ValueError(f"Failed to read PDF document: {e}") from e

    async def parse_resume_to_candidate_profile(
        self,
        pdf_bytes: bytes,
        filename: str = "master_resume.pdf",
    ) -> Profile:
        """Extract structured facts from resume PDF. All extracted facts start as unverified (verified=False)."""
        raw_text = self.extract_text_and_links_from_pdf(pdf_bytes)

        prompt = f"""
You are an expert ATS Resume Extraction Engine for a truthful career operating system.
Carefully parse the following resume text and extract all factual information into structured JSON.

CRITICAL TRUTH RULES:
1. Extract ONLY facts explicitly stated in the text or embedded links.
2. DO NOT invent phone numbers, employers, job titles, technologies, degrees, or metrics.
3. If phone number is present (e.g. +91 ...), extract it accurately. If not present in text, leave it empty/null.
4. If GitHub or LinkedIn URLs are present in the text or embedded hyperlinks, match them accurately to candidate links.
5. Categorize skills appropriately (programming, data, ai_ml, web, cloud, tools, soft, other).

Resume Text:
\"\"\"
{raw_text}
\"\"\"
"""
        system_instruction = "You extract factual career profile data from resumes without hallucination or exaggeration."

        extracted: ExtractedResumeData = await self.ai_provider.generate_structured(
            prompt=prompt,
            schema=ExtractedResumeData,
            system_instruction=system_instruction,
            temperature=0.0,
        )

        # Build Canonical Profile with verified=False for all extracted items
        contact = PersonalContact(
            fullName=extracted.fullName or "Candidate",
            email=extracted.email or "",
            phone=extracted.phone,
            city=extracted.city,
            country=extracted.country,
            links=PersonalLinks(
                linkedin=extracted.linkedin,
                github=extracted.github,
                portfolio=extracted.portfolio,
            ),
        )

        education_facts = [
            EducationFact(
                id=f"edu-{uuid.uuid4().hex[:8]}",
                institution=edu.institution,
                degree=edu.degree,
                field=edu.field,
                startDate=edu.startDate,
                endDate=edu.endDate,
                grade=edu.grade,
                location=edu.location,
                verified=False,
                source=f"imported_resume:{filename}",
            )
            for edu in extracted.education
        ]

        experience_facts = [
            ExperienceFact(
                id=f"exp-{uuid.uuid4().hex[:8]}",
                company=exp.company,
                title=exp.title,
                employmentType=exp.employmentType,
                location=exp.location,
                startDate=exp.startDate,
                endDate=exp.endDate,
                current=exp.current,
                description=exp.description,
                bullets=exp.bullets,
                verified=False,
                source=f"imported_resume:{filename}",
            )
            for exp in extracted.experience
        ]

        project_facts = [
            ProjectFact(
                id=f"proj-{uuid.uuid4().hex[:8]}",
                name=proj.name,
                description=proj.description,
                bullets=proj.bullets,
                technologies=proj.technologies,
                url=proj.url,
                metrics=proj.metrics,
                verified=False,
                source=f"imported_resume:{filename}",
            )
            for proj in extracted.projects
        ]

        skill_facts = [
            SkillFact(
                id=f"skill-{uuid.uuid4().hex[:8]}",
                name=sk.name,
                category=sk.category,
                proficiency=sk.proficiency,
                verified=False,
                source=f"imported_resume:{filename}",
            )
            for sk in extracted.skills
        ]

        return Profile(
            userId="user_default",
            personal=contact,
            education=education_facts,
            experience=experience_facts,
            projects=project_facts,
            skills=skill_facts,
            summary=extracted.summary,
            profileVersion=1,
        )
