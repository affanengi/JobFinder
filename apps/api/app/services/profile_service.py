"""Profile Management and Truth Verification Service with Cloud Firestore persistence."""

import logging
from datetime import UTC, datetime

from app.db.repositories.profile_repo import profile_repo
from app.schemas.profile import (
    ApproveCandidateFactsRequest,
    AutofillProfile,
    CourseCertificationFact,
    EducationEntry,
    EducationFact,
    ExperienceFact,
    MetricFact,
    PersonalContact,
    PersonalLinks,
    Profile,
    ProjectFact,
    SkillFact,
)

from app.services.profile_migration_service import (
    MIGRATION_V1_LODESTAR_COURSES,
    get_canonical_courses,
)

logger = logging.getLogger("jobFinder.profile_service")


class ProfileService:
    """Service handling user profile state, truth verification, cumulative multi-resume merging, and Firestore persistence."""

    def __init__(self):
        self.repo = profile_repo
        self._profiles: dict[str, Profile] = {}
        self._init_default_profile()

    def _init_default_profile(self, user_id: str = "user_default") -> Profile:
        default_profile = Profile(
            userId=user_id,
            personal=PersonalContact(
                fullName="Mohammed Affan Razvi",
                email="mohammedaffanrazvi604@gmail.com",
                phone="+91 8978293087",
                city="Hyderabad",
                country="India",
                links=PersonalLinks(
                    github="https://github.com/affanengi",
                    linkedin="https://www.linkedin.com/in/mohammed-affan-razvi-855a202ab/",
                    portfolio="https://my-portfolio-henna-tau-72.vercel.app/",
                ),
            ),
            education=[
                EducationFact(
                    id="edu-default-1",
                    institution="Global Institute of Engineering & Technology (JNTU Hyderabad)",
                    degree="Bachelor of Technology (B.Tech)",
                    field="Computer Science & Engineering (Data Science)",
                    startDate="2022",
                    endDate="2026",
                    grade="GPA: 7.6",
                    location="Hyderabad, Telangana",
                    verified=True,
                    source="user",
                ),
                EducationFact(
                    id="edu-default-2",
                    institution="Sree Tapasiya Jr College",
                    degree="MPC",
                    field="MPC",
                    endDate="2021",
                    grade="86% Aggregate",
                    location="Hyderabad, Telangana",
                    verified=True,
                    source="user",
                ),
                EducationFact(
                    id="edu-default-3",
                    institution="Gotham Model School",
                    degree="10th Standard",
                    endDate="2019",
                    grade="95% Aggregate",
                    location="Hyderabad, Telangana",
                    verified=True,
                    source="user",
                ),
            ],
            experience=[
                ExperienceFact(
                    id="exp-lodestar-01",
                    company="Lodestar",
                    title="Software Engineering Intern",
                    employmentType="internship",
                    category="work",
                    location="Remote",
                    startDate="Jun 2026",
                    endDate="Aug 2026",
                    current=False,
                    description=(
                        "Engineered browser autocapture SDK modules, PII-redaction pass, "
                        "user journey dashboard flows, and Fastify synthetic validation harness."
                    ),
                    bullets=[
                        (
                            "Built modules of a browser autocapture SDK, including a capture-phase listener layer "
                            "automatically emitting click, navigation, input, and network events without manual instrumentation."
                        ),
                        (
                            "Implemented a PII-redaction pass before events were batched/shipped to the ingest endpoint."
                        ),
                        (
                            "Built the dashboard user journey view by grouping raw events by session, ordering them chronologically, "
                            "counting common step-to-step transitions, and transforming the processed data into a flow diagram."
                        ),
                        (
                            "Built a seed/load harness replaying ~14.6K synthetic events across approximately 40 sessions "
                            "through a per-tenant Fastify ingest service, validating capture → storage → analytics and usage metering."
                        ),
                    ],
                    metrics=[
                        MetricFact(
                            id="fact-lodestar-events-01",
                            parentId="exp-lodestar-01",
                            value="~14.6K",
                            description="Built seed/load harness replaying approximately 14.6K synthetic events across approximately 40 sessions through a per-tenant Fastify ingest service, validating capture → storage → analytics and usage metering",
                            unitOrScope="synthetic_events",
                            verified=True,
                            source="candidate_confirmed",
                        ),
                        MetricFact(
                            id="fact-lodestar-sessions-02",
                            parentId="exp-lodestar-01",
                            value="~40",
                            description="Replayed synthetic events across approximately 40 test sessions through per-tenant Fastify ingest service",
                            unitOrScope="sessions",
                            verified=True,
                            source="candidate_confirmed",
                        ),
                    ],
                    verified=True,
                    source="candidate_confirmed",
                ),
                ExperienceFact(
                    id="exp-cccf5bb2",
                    company="Techniva Technical Club",
                    title="Co-Founder & Technical Lead",
                    employmentType="leadership",
                    category="leadership",
                    location="Hyderabad, Telangana",
                    startDate="2024",
                    endDate="2026",
                    current=False,
                    bullets=[
                        "Co-founded Techniva Technical Club and served as Technical Lead to foster competitive coding and engineering culture.",
                        "Organized 10+ technical and non-technical events with 300+ total participants across all organized events.",
                        "Managed and coordinated 70+ audience members and participants in competitive hackathon and workshop contexts.",
                        "Mentored peers on modern web development practices, conducting hands-on sessions covering React, JavaScript, and Git version control.",
                    ],
                    metrics=[
                        MetricFact(
                            id="fact-techniva-events-01",
                            parentId="exp-cccf5bb2",
                            value="10+",
                            description="Organized 10+ technical and non-technical events",
                            unitOrScope="events",
                            verified=True,
                            source="candidate_confirmed",
                        ),
                        MetricFact(
                            id="fact-techniva-participants-02",
                            parentId="exp-cccf5bb2",
                            value="300+",
                            description="300+ total participants across organized events",
                            unitOrScope="participants",
                            verified=True,
                            source="candidate_confirmed",
                        ),
                        MetricFact(
                            id="fact-techniva-audience-03",
                            parentId="exp-cccf5bb2",
                            value="70+",
                            description="Managed/handled 70+ audience members in hackathon and event contexts",
                            unitOrScope="audience",
                            verified=True,
                            source="candidate_confirmed",
                        ),
                    ],
                    verified=True,
                    source="candidate_confirmed",
                )
            ],
            projects=[
                ProjectFact(
                    id="proj-default-1",
                    name="Personal AI Career Agent (jobFinder)",
                    description="Career operating system with truth-audited ATS resumes and Playwright assisted applications.",
                    bullets=[
                        "Architected an ATS resume engine with automated truth auditing to block hallucinated claims.",
                        "Built browser automation pipelines with Playwright to pre-fill multi-step job application portals.",
                        "Engineered hybrid job recommendation algorithms combining hard filters, vector search, and structured score breakdowns.",
                        "Designed modular caching and local PDF recompile pipelines processing structured profile workflows within approximately 1–2 seconds.",
                    ],
                    technologies=["Python", "FastAPI", "Playwright", "Firestore", "React"],
                    metrics=[
                        MetricFact(
                            id="fact-ats-perf-01",
                            parentId="proj-default-1",
                            value="~1-2s",
                            description="Observed processing/workflow performance of approximately 1–2 seconds for structured profile workflows",
                            unitOrScope="seconds",
                            verified=True,
                            source="candidate_confirmed",
                        )
                    ],
                    verified=True,
                    source="candidate_confirmed",
                ),
                ProjectFact(
                    id="proj-ae54d0fb",
                    name="WebPilot Automation",
                    description="Developed a comprehensive SaaS automation platform supporting 8+ workflow automations.",
                    bullets=[
                        "Built an automation platform supporting 8+ workflow automations across YouTube uploads, LinkedIn posting, bulk emails, and Google Forms.",
                        "Implemented integrations for Google Drive/Docs file management (creation, deletion, renaming, moving) and GitHub repository creation.",
                        "Integrated Notion AI note automation and intelligent data processing directly into the central dashboard.",
                        "Deployed a responsive frontend using React, Tailwind CSS, and Firebase for secure state synchronization.",
                    ],
                    technologies=["React", "Tailwind CSS", "Firebase", "Node.js", "Netlify"],
                    metrics=[
                        MetricFact(
                            id="fact-webpilot-workflows-01",
                            parentId="proj-ae54d0fb",
                            value="8+",
                            description="Built an automation platform supporting 8+ workflow automations",
                            unitOrScope="workflows",
                            verified=True,
                            source="candidate_confirmed",
                        )
                    ],
                    verified=True,
                    source="candidate_confirmed",
                ),
                ProjectFact(
                    id="proj-8bded314",
                    name="School Management Dashboard",
                    description="Engineered a full-stack, role-based school management system featuring secure authentication and analytics.",
                    bullets=[
                        "Engineered a full-stack, role-based school management system featuring secure authentication and dedicated dashboards for admins, teachers, and students.",
                        "Built an analytics dashboard containing 8+ interactive charts and dynamic data tables using Recharts to visualize school metrics.",
                        "Architected a scalable multi-role data schema leveraging Firebase to ensure secure and isolated data access across user roles.",
                        "Constructed responsive frontend views using Next.js and Tailwind CSS with role-based access control.",
                    ],
                    technologies=["Next.js", "Tailwind CSS", "Firebase", "Recharts"],
                    metrics=[
                        MetricFact(
                            id="fact-school-charts-01",
                            parentId="proj-8bded314",
                            value="8+",
                            description="Analytics dashboard contains 8+ interactive charts",
                            unitOrScope="charts",
                            verified=True,
                            source="candidate_confirmed",
                        )
                    ],
                    verified=True,
                    source="candidate_confirmed",
                ),
                ProjectFact(
                    id="proj-3e5f9c49",
                    name="Next-Social (LinkedIn Clone)",
                    description="Built a full-stack professional networking platform featuring user profiles, post creation, connection requests, and real-time messaging.",
                    bullets=[
                        "Built a full-stack professional networking platform featuring user profiles, post creation, connection requests, and real-time messaging.",
                        "Designed and optimized a relational SQL database schema to efficiently handle user relationship graphs and feed generation.",
                        "Implemented responsive UI components using React.js and Tailwind CSS for social interaction workflows.",
                        "Constructed secure API endpoints for handling profile updates, connection requests, and real-time feed synchronization.",
                    ],
                    technologies=["React.js", "Tailwind CSS", "SQL Database"],
                    metrics=[],
                    verified=True,
                    source="candidate_confirmed",
                ),
                ProjectFact(
                    id="proj-df57ad67",
                    name="Spotify Clone",
                    description="Created a sleek, fully responsive music player focusing on modern frontend architecture and custom audio controls.",
                    bullets=[
                        "Created a sleek, fully responsive music player focusing on modern frontend architecture and precise UI/UX matching.",
                        "Implemented a custom audio player with seamless playback controls, progress tracking, and state management without external UI libraries.",
                        "Engineered modular React component architecture with custom CSS styling for media playback interfaces.",
                        "Optimized playlist rendering and audio buffering for smooth continuous playback across view transitions.",
                    ],
                    technologies=["React.js", "Vanilla CSS"],
                    metrics=[],
                    verified=True,
                    source="candidate_confirmed",
                ),
            ],
            skills=[
                # 1. Languages / Programming
                SkillFact(id="skill-lang-1", name="JavaScript", category="programming", proficiency="advanced", verified=True, source="candidate_confirmed"),
                SkillFact(id="skill-lang-2", name="TypeScript", category="programming", proficiency="advanced", verified=True, source="candidate_confirmed"),
                SkillFact(id="skill-lang-3", name="Python", category="programming", proficiency="advanced", verified=True, source="candidate_confirmed"),
                SkillFact(id="skill-lang-4", name="C", category="programming", proficiency="intermediate", verified=True, source="candidate_confirmed"),
                SkillFact(id="skill-lang-5", name="HTML", category="programming", proficiency="advanced", verified=True, source="candidate_confirmed"),
                SkillFact(id="skill-lang-6", name="CSS", category="programming", proficiency="advanced", verified=True, source="candidate_confirmed"),
                SkillFact(id="skill-lang-7", name="SQL", category="programming", proficiency="advanced", verified=True, source="candidate_confirmed"),

                # 2. Frontend Frameworks & UI
                SkillFact(id="skill-fe-1", name="React.js", category="web", proficiency="advanced", verified=True, source="candidate_confirmed"),
                SkillFact(id="skill-fe-2", name="Next.js", category="web", proficiency="intermediate", verified=True, source="candidate_confirmed"),
                SkillFact(id="skill-fe-3", name="Tailwind CSS", category="web", proficiency="advanced", verified=True, source="candidate_confirmed"),
                SkillFact(id="skill-fe-4", name="Framer Motion", category="web", proficiency="intermediate", verified=True, source="candidate_confirmed"),
                SkillFact(id="skill-fe-5", name="shadcn/ui", category="web", proficiency="advanced", verified=True, source="candidate_confirmed"),
                SkillFact(id="skill-fe-6", name="TypeScript / React", category="web", proficiency="advanced", verified=True, source="candidate_confirmed"),

                # 3. Backend & Databases
                SkillFact(id="skill-be-1", name="FastAPI", category="backend", proficiency="advanced", verified=True, source="candidate_confirmed"),
                SkillFact(id="skill-be-2", name="Node.js", category="backend", proficiency="intermediate", verified=True, source="candidate_confirmed"),
                SkillFact(id="skill-be-3", name="Express.js", category="backend", proficiency="intermediate", verified=True, source="candidate_confirmed"),
                SkillFact(id="skill-be-4", name="Django", category="backend", proficiency="intermediate", verified=True, source="candidate_confirmed"),
                SkillFact(id="skill-be-5", name="Firebase", category="backend", proficiency="advanced", verified=True, source="candidate_confirmed"),
                SkillFact(id="skill-be-6", name="Firestore", category="data", proficiency="advanced", verified=True, source="candidate_confirmed"),
                SkillFact(id="skill-be-7", name="PostgreSQL", category="data", proficiency="intermediate", verified=True, source="candidate_confirmed"),
                SkillFact(id="skill-be-8", name="MongoDB", category="data", proficiency="intermediate", verified=True, source="candidate_confirmed"),
                SkillFact(id="skill-be-9", name="MySQL", category="data", proficiency="intermediate", verified=True, source="candidate_confirmed"),
                SkillFact(id="skill-be-10", name="SQL / Firestore", category="data", proficiency="advanced", verified=True, source="candidate_confirmed"),

                # 4. AI & Generative AI
                SkillFact(id="skill-ai-1", name="Generative AI", category="ai_ml", proficiency="advanced", verified=True, source="candidate_confirmed"),
                SkillFact(id="skill-ai-2", name="LLMs", category="ai_ml", proficiency="advanced", verified=True, source="candidate_confirmed"),
                SkillFact(id="skill-ai-3", name="Google Gemini / LLM APIs", category="ai_ml", proficiency="advanced", verified=True, source="candidate_confirmed"),
                SkillFact(id="skill-ai-4", name="Prompt Engineering", category="ai_ml", proficiency="advanced", verified=True, source="candidate_confirmed"),
                SkillFact(id="skill-ai-5", name="AI Agents", category="ai_ml", proficiency="advanced", verified=True, source="candidate_confirmed"),
                SkillFact(id="skill-ai-6", name="AI-assisted Development", category="ai_ml", proficiency="advanced", verified=True, source="candidate_confirmed"),

                # 5. Automation & Integrations
                SkillFact(id="skill-auto-1", name="n8n", category="automation", proficiency="advanced", verified=True, source="candidate_confirmed"),
                SkillFact(id="skill-auto-2", name="Workflow Automation", category="automation", proficiency="advanced", verified=True, source="candidate_confirmed"),
                SkillFact(id="skill-auto-3", name="Playwright", category="automation", proficiency="advanced", verified=True, source="candidate_confirmed"),
                SkillFact(id="skill-auto-4", name="REST APIs", category="backend", proficiency="advanced", verified=True, source="candidate_confirmed"),
                SkillFact(id="skill-auto-5", name="Webhooks", category="automation", proficiency="advanced", verified=True, source="candidate_confirmed"),
                SkillFact(id="skill-auto-6", name="API Integration", category="automation", proficiency="advanced", verified=True, source="candidate_confirmed"),
                SkillFact(id="skill-auto-7", name="JSON", category="data", proficiency="advanced", verified=True, source="candidate_confirmed"),

                # 6. Tools & Platforms
                SkillFact(id="skill-tool-1", name="Git", category="tools", proficiency="advanced", verified=True, source="candidate_confirmed"),
                SkillFact(id="skill-tool-2", name="GitHub", category="tools", proficiency="advanced", verified=True, source="candidate_confirmed"),
                SkillFact(id="skill-tool-3", name="Docker", category="tools", proficiency="intermediate", verified=True, source="candidate_confirmed"),
                SkillFact(id="skill-tool-4", name="Vercel", category="cloud", proficiency="advanced", verified=True, source="candidate_confirmed"),
                SkillFact(id="skill-tool-5", name="Netlify", category="cloud", proficiency="intermediate", verified=True, source="candidate_confirmed"),
                SkillFact(id="skill-tool-6", name="Linux", category="tools", proficiency="intermediate", verified=True, source="candidate_confirmed"),

                # 7. Data & Productivity
                SkillFact(id="skill-prod-1", name="Microsoft Excel", category="productivity", proficiency="advanced", verified=True, source="candidate_confirmed"),
                SkillFact(id="skill-prod-2", name="PowerPoint", category="productivity", proficiency="advanced", verified=True, source="candidate_confirmed"),
                SkillFact(id="skill-prod-3", name="Google Sheets", category="productivity", proficiency="advanced", verified=True, source="candidate_confirmed"),
                SkillFact(id="skill-prod-4", name="Data Analysis", category="data", proficiency="intermediate", verified=True, source="candidate_confirmed"),
                SkillFact(id="skill-prod-5", name="Documentation", category="productivity", proficiency="advanced", verified=True, source="candidate_confirmed"),
                SkillFact(id="skill-prod-6", name="Reporting", category="productivity", proficiency="advanced", verified=True, source="candidate_confirmed"),

                # 8. Software Engineering
                SkillFact(id="skill-eng-1", name="Full-Stack Development", category="engineering", proficiency="advanced", verified=True, source="candidate_confirmed"),
                SkillFact(id="skill-eng-2", name="Object-Oriented Programming", category="engineering", proficiency="advanced", verified=True, source="candidate_confirmed"),
                SkillFact(id="skill-eng-3", name="Debugging", category="engineering", proficiency="advanced", verified=True, source="candidate_confirmed"),
                SkillFact(id="skill-eng-4", name="Testing", category="engineering", proficiency="intermediate", verified=True, source="candidate_confirmed"),
                SkillFact(id="skill-eng-5", name="Problem Solving", category="soft", proficiency="advanced", verified=True, source="candidate_confirmed"),

                # 9. Professional & Communication (Soft Skills)
                SkillFact(id="skill-soft-1", name="Communication", category="soft", proficiency="advanced", verified=True, source="candidate_confirmed"),
                SkillFact(id="skill-soft-2", name="Team Collaboration", category="soft", proficiency="advanced", verified=True, source="candidate_confirmed"),
                SkillFact(id="skill-soft-3", name="Analytical Thinking", category="soft", proficiency="advanced", verified=True, source="candidate_confirmed"),
                SkillFact(id="skill-soft-4", name="Time Management", category="soft", proficiency="advanced", verified=True, source="candidate_confirmed"),
                SkillFact(id="skill-soft-5", name="Adaptability", category="soft", proficiency="advanced", verified=True, source="candidate_confirmed"),
                SkillFact(id="skill-soft-6", name="Attention to Detail", category="soft", proficiency="advanced", verified=True, source="candidate_confirmed"),

                # 10. Spoken Languages
                SkillFact(id="skill-langspk-1", name="English (Fluent)", category="languages_spoken", proficiency="advanced", verified=True, source="candidate_confirmed"),
                SkillFact(id="skill-langspk-2", name="Hindi (Fluent)", category="languages_spoken", proficiency="advanced", verified=True, source="candidate_confirmed"),
                SkillFact(id="skill-langspk-3", name="Telugu (Conversational)", category="languages_spoken", proficiency="intermediate", verified=True, source="candidate_confirmed"),
            ],
            courseCertifications=get_canonical_courses(),
            summary="AI Solutions & Automation Engineer with experience building agentic workflows, Python/FastAPI microservices, Playwright browser automation, and data pipelines.",
            appliedMigrations=[MIGRATION_V1_LODESTAR_COURSES],
            profileVersion=1,
        )
        default_profile.autofill = AutofillProfile(
            firstName="Mohammed",
            lastName="Affan Razvi",
            fullName="Mohammed Affan Razvi",
            email="mohammedaffanrazvi604@gmail.com",
            phone="+918978293087",
            streetAddress="Razvis Building, Floor 1st. In the lane of safa residency, Padmasri Estates, Hyder Shah Kote, Sun City, Bandlaguda Jagir, Telangana, India",
            city="Hyderabad",
            state="Telangana",
            postalCode="500086",
            country="India",
            gender="Male",
            pronouns="he/him/his",
            linkedinUrl="https://www.linkedin.com/in/mohammed-affan-razvi-855a202ab/",
            githubUrl="https://github.com/affanengi",
            portfolioUrl="https://my-portfolio-henna-tau-72.vercel.app/",
            school="Global Institute of Engineering and Technology",
            degree="Bachelor's Degree",
            discipline="Computer Science",
            startYear="2022",
            endYear="2026",
            educations=[
                EducationEntry(
                    id="edu-default-1",
                    school="Global Institute of Engineering and Technology",
                    degree="Bachelor of Technology (B.Tech)",
                    discipline="Computer Science & Engineering (Data Science)",
                    startYear="2022",
                    endYear="2026",
                ),
                EducationEntry(
                    id="edu-default-2",
                    school="Sree Tapasiya Jr College",
                    degree="MPC",
                    discipline="MPC",
                    startYear="2019",
                    endYear="2021",
                ),
            ],
            experienceLevel="fresher",
            yearsOfExperience=0.0,
        )
        self._profiles[user_id] = default_profile
        self.repo.save(default_profile)
        return default_profile

    def get_profile(self, user_id: str = "user_default") -> Profile:
        """Get the current verified profile from Firestore or memory cache (pure read)."""
        # 1. Check Firestore first (authoritative persistent source of truth)
        db_profile = self.repo.get_by_user_id(user_id)
        if db_profile:
            self._profiles[user_id] = db_profile
            return db_profile

        # 2. Check in-memory cache if Firestore has no document or is unavailable
        if user_id in self._profiles:
            return self._profiles[user_id]

        # 3. If user_id is user_default or the primary developer user ID, initialize default profile
        if user_id in ("user_default", "Sf0isG4mUuXwTQTWWwG1Wf4aIM82"):
            return self._init_default_profile(user_id=user_id)

        # 4. Create new user profile for multi-user system with clean blank facts (no hardcoded fallbacks)
        new_profile = Profile(
            userId=user_id,
            personal=PersonalContact(fullName="", email=""),
            education=[],
            experience=[],
            projects=[],
            skills=[],
            certifications=[],
            courseCertifications=[],
            summary="",
            autofill=AutofillProfile(),
            appliedMigrations=[],
            profileVersion=1,
        )
        self._profiles[user_id] = new_profile
        self.repo.save(new_profile)
        return new_profile

    def sync_verified_profile(self, user_id: str) -> tuple[Profile, bool]:
        """Explicitly run the idempotent migration/synchronization for the given user profile."""
        profile = self.get_profile(user_id)
        from app.services.profile_migration_service import profile_migration_service
        updated_profile, has_changed = profile_migration_service.migrate_profile(profile)
        if has_changed:
            self.repo.save(updated_profile)
            self._profiles[user_id] = updated_profile
        return updated_profile, has_changed

    def update_profile(self, profile: Profile) -> Profile:
        """Update the master profile and persist to Firestore."""
        profile.profileVersion += 1
        profile.updatedAt = datetime.now(UTC).isoformat()
        self._profiles[profile.userId] = profile
        self.repo.save(profile)
        return profile

    def get_autofill_profile(self, user_id: str) -> AutofillProfile:
        """Retrieve user-managed autofill configuration."""
        profile = self.get_profile(user_id)
        return profile.autofill

    def update_autofill_profile(
        self, user_id: str, autofill_data: AutofillProfile
    ) -> AutofillProfile:
        """Update user-managed autofill configuration without altering master facts."""
        profile = self.get_profile(user_id)
        # Ensure educations and primary fields stay synchronized
        if autofill_data.educations and len(autofill_data.educations) > 0:
            first_edu = autofill_data.educations[0]
            if not autofill_data.school and first_edu.school:
                autofill_data.school = first_edu.school
            if not autofill_data.degree and first_edu.degree:
                autofill_data.degree = first_edu.degree
            if not autofill_data.discipline and first_edu.discipline:
                autofill_data.discipline = first_edu.discipline
            if not autofill_data.startYear and first_edu.startYear:
                autofill_data.startYear = first_edu.startYear
            if not autofill_data.endYear and first_edu.endYear:
                autofill_data.endYear = first_edu.endYear
        elif (
            autofill_data.school
            or autofill_data.degree
            or autofill_data.discipline
            or autofill_data.startYear
            or autofill_data.endYear
        ):
            autofill_data.educations = [
                EducationEntry(
                    id="edu-1",
                    school=autofill_data.school or "",
                    degree=autofill_data.degree or "",
                    discipline=autofill_data.discipline or "",
                    startYear=autofill_data.startYear or "",
                    endYear=autofill_data.endYear or "",
                )
            ]
        autofill_data.updatedAt = datetime.now(UTC).isoformat()
        profile.autofill = autofill_data
        profile.updatedAt = datetime.now(UTC).isoformat()
        self._profiles[user_id] = profile
        self.repo.save(profile)
        logger.info(f"Updated autofill profile for user {user_id}.")
        return profile.autofill

    def approve_and_merge_extracted_facts(
        self,
        candidate_profile: Profile,
        request: ApproveCandidateFactsRequest,
        user_id: str = "user_default",
    ) -> Profile:
        """Approve selected candidate facts and cumulatively merge them into the master profile with smart deduplication."""
        current_profile = self.get_profile(user_id)

        # 1. Update personal details if approved
        if request.personalEdits:
            current_profile.personal = request.personalEdits
        elif (
            candidate_profile.personal.fullName
            and candidate_profile.personal.fullName != "Unknown Candidate"
        ):
            current_profile.personal.fullName = candidate_profile.personal.fullName
            if candidate_profile.personal.email:
                current_profile.personal.email = candidate_profile.personal.email
            if candidate_profile.personal.phone:
                current_profile.personal.phone = candidate_profile.personal.phone
            if candidate_profile.personal.city:
                current_profile.personal.city = candidate_profile.personal.city
            if candidate_profile.personal.links:
                if candidate_profile.personal.links.github:
                    current_profile.personal.links.github = candidate_profile.personal.links.github
                if candidate_profile.personal.links.linkedin:
                    current_profile.personal.links.linkedin = (
                        candidate_profile.personal.links.linkedin
                    )

        # Summary
        if request.summaryEdit:
            current_profile.summary = request.summaryEdit
        elif candidate_profile.summary and len(candidate_profile.summary.strip()) > 10:
            current_profile.summary = candidate_profile.summary

        # 2. Cumulative Education Merging (avoid exact duplicate degrees)
        existing_edu_signatures = {
            f"{e.institution.strip().lower()}_{e.degree.strip().lower()}"
            for e in current_profile.education
        }
        for edu in candidate_profile.education:
            if edu.id in request.approvedEducationIds:
                sig = f"{edu.institution.strip().lower()}_{edu.degree.strip().lower()}"
                if sig not in existing_edu_signatures:
                    edu.verified = True
                    current_profile.education.append(edu)
                    existing_edu_signatures.add(sig)

        # 3. Cumulative Experience Merging (avoid exact duplicate jobs)
        existing_exp_signatures = {
            f"{exp.company.strip().lower()}_{exp.title.strip().lower()}"
            for exp in current_profile.experience
        }
        for exp in candidate_profile.experience:
            if exp.id in request.approvedExperienceIds:
                sig = f"{exp.company.strip().lower()}_{exp.title.strip().lower()}"
                if sig not in existing_exp_signatures:
                    exp.verified = True
                    current_profile.experience.append(exp)
                    existing_exp_signatures.add(sig)

        # 4. Cumulative Project Merging (match by project name, merge technologies & bullets if exists, else append)
        existing_projects_by_name = {p.name.strip().lower(): p for p in current_profile.projects}
        for proj in candidate_profile.projects:
            if proj.id in request.approvedProjectIds:
                p_name = proj.name.strip().lower()
                if p_name in existing_projects_by_name:
                    target_p = existing_projects_by_name[p_name]
                    # Merge tech
                    existing_tech = {t.lower() for t in target_p.technologies}
                    for t in proj.technologies:
                        if t.lower() not in existing_tech:
                            target_p.technologies.append(t)
                            existing_tech.add(t.lower())
                    # Merge bullets
                    existing_bullets = set(target_p.bullets)
                    for b in proj.bullets:
                        if b not in existing_bullets:
                            target_p.bullets.append(b)
                            existing_bullets.add(b)
                else:
                    proj.verified = True
                    current_profile.projects.append(proj)
                    existing_projects_by_name[p_name] = proj

        # 5. Cumulative Skill Merging (case-insensitive deduplication)
        existing_skill_names = {s.name.strip().lower() for s in current_profile.skills}
        for sk in candidate_profile.skills:
            if sk.id in request.approvedSkillIds:
                clean_name = sk.name.strip().lower()
                if clean_name not in existing_skill_names:
                    sk.verified = True
                    current_profile.skills.append(sk)
                    existing_skill_names.add(clean_name)

        current_profile.profileVersion += 1
        current_profile.updatedAt = datetime.now(UTC).isoformat()
        self._profiles[user_id] = current_profile

        # Persist to Firestore
        self.repo.save(current_profile)

        logger.info(
            f"Merged approved facts for {user_id}. Profile now has {len(current_profile.skills)} skills, {len(current_profile.projects)} projects. Version is {current_profile.profileVersion}."
        )
        return current_profile


profile_service = ProfileService()
