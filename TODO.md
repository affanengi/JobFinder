
# 1. Architecture & Design

- [X] Review system architecture, workflows, and constraints.
- [X] Finalize database strategy (Firestore for profiles, canonical jobs, and memory).
- [X] Verify local file extraction design (PDF/DOCX).
- [X] Validate persistent candidate truth layer.
- [X] Validate browser automation architecture (human-supervised).
- [X] Confirm all required schemas are fully designed.

---

# 2. Project Setup

- [X] Create workspace folder structure.
- [X] Set up Python backend with FastAPI and strict types.
- [X] Set up React frontend with Vite and strict TypeScript.
- [X] Configure backend package manager (uv/pip).
- [X] Configure frontend package manager (npm).
- [X] Set up Linters and Formatters (ruff, mypy, eslint, prettier).
- [X] Initialize Git repository.
- [X] Create root README with project vision and run commands.
- [X] Create development startup script.

---

# 3. Configuration & Secrets

- [X] Create backend `.env.example`.
- [X] Create backend settings module with Pydantic validation.
- [X] Create frontend environment configuration.
- [X] Set up secure local storage directory for user files and state.
- [X] Add checks to ensure `.env` and sensitive files are git-ignored.

---

# 4. Firebase Foundation

- [X] Install Firebase Admin SDK (backend).
- [X] Install Firebase Client SDK (frontend).
- [X] Implement backend Firebase initialization with service account key.
- [X] Implement frontend Firebase client initialization.
- [X] Implement Google One-Click OAuth authentication popup.
- [X] Implement Email/Password authentication.
- [X] Implement JWT token verification middleware.
- [X] Build login and signup UI with error handling.
- [X] Connect authentication state to all API requests.

---

# 5. Memory & Truth Layer (Firestore)

- [X] Create candidate profile schema with provenance.
- [X] Create work history, education, project, and skill fact schemas.
- [X] Implement local resume parser (pypdf text & LaTeX \href hyperlink extraction).
- [X] Implement candidate fact extraction service.
- [X] Implement Firestore profile repository (`profiles` collection).
- [X] Implement Firestore user job status repository (`user_job_statuses` collection).
- [X] Implement Master Profile & Truth viewer UI.
- [X] Implement Interactive Profile Edit Modal for candidate details.
- [X] Implement Interactive Education & Experience Edit Modals (grades, percentages, timelines).
- [X] Implement Universal Delete Confirmation Modals for tailored resumes and profile items.
- [X] Implement fact verification and approval flow.
- [X] Implement cumulative multi-resume merging and skill deduplication.
- [X] Implement candidate truth locking.

---

# 6. AI Foundation

- [X] Define `AIProvider` abstract protocol.
- [X] Implement Gemini Provider using official `google-genai` SDK.
- [X] Configure resilient multi-model fallback chain (`gemini-3.8-flash` -> `gemini-3.6-flash` -> `gemini-3.5-flash`).
- [X] Implement zero-wait instant fallback on 429 quota exhaustion.
- [X] Implement structured JSON generation with Pydantic self-repair.
- [X] Add provider error mapping.
- [X] Validate every model response.
- [X] Log model metadata without sensitive prompts.
- [X] Add mock AI provider for tests.

---

# 7. Job Source System

- [X] Define `JobSource` interface.
- [X] Implement manual URL source.
- [X] Implement manual text source.
- [X] Implement Lever public ATS board adapter.
- [X] Implement Ashby public ATS board adapter.
- [X] Implement Greenhouse public ATS board adapter.
- [X] Extract live publication dates (`rawPostedAt`) across all adapters for $0 free.
- [X] Add source health tracking and error recovery.

---

# 8. Job Normalization

- [X] Create raw job schema.
- [X] Create normalized canonical job schema.
- [X] Implement normalization service.
- [X] Extract and normalize title, company, location, and work mode.
- [X] Extract required and preferred skills with tech dictionary.
- [X] Extract experience requirements and freshness flags (`0-1 yrs`, `Fresher OK`).
- [X] Extract compensation and salary ranges (USD, INR, EUR).
- [X] Compute human-friendly relative posting age (`📅 2d ago`, `📅 1w ago`).
- [X] Preserve source metadata and original application URLs.

---

# 9. Job Deduplication & Persistence

- [X] Create canonical job hash (UUID5 URL namespace).
- [X] Compare company/title/location.
- [X] Prevent duplicate entries in memory and Firestore.
- [X] Store canonical jobs in Firestore (`canonical_jobs` collection).

---

# 10. Job Analysis

- [X] Implement job analysis and categorization service.
- [X] Extract hard requirements and soft requirements.
- [X] Classify roles into Technical, Data & Analytics, QA & Testing, and Non-Technical.
- [X] Save and structure analysis.

---

# 11. Job Embeddings

- [ ] Define canonical embedding text.
- [ ] Generate job embedding using `gemini-embedding-2`.
- [ ] Store embeddings in Firestore.
- [ ] Implement nearest-neighbor semantic search.

---

# 12. Matching Engine

- [X] Implement location hard filters (Strict India Hubs + Global Remote).
- [X] Implement language and non-English rejection filters.
- [X] Implement skill scoring and overlap ratio.
- [X] Implement experience and seniority multiplier (fresher bonus vs senior penalty).
- [X] Implement work mode multiplier (Remote / India preference).
- [X] Generate calibrated match tiers (Strong 90%+, Good 75%+, Moderate 50%+, Low 35%+, Not a Match <35%) with strict experience caps & fresher calibration.
- [X] Generate deterministic grounded match explanation (Zero token cost).

---

# 13. Recommendations UI & Global Modal Architecture

- [X] Create Opportunities dashboard with Notion-style dark mode.
- [X] Create sub-tabs (Recommended, Saved, Applied, Archived) with live counters.
- [X] Create View Mode switcher (Grid 🔲 vs Compact List ☰).
- [X] Create unified filter bar (Search, Role category, Work mode, Match score).
- [X] Display match score badge (90%+ Strong, 80%+ Good).
- [X] Display color-coded ATS source badges (Greenhouse emerald, Ashby violet, Lever teal).
- [X] Display explicit experience badges (`Fresher OK`, `0-1 yrs`, `Senior`).
- [X] Display live publication date badges (`📅 2d ago`, `📅 1w ago`).
- [X] Add 1-Click Save, Dismiss, and View Application actions.
- [X] Implement Global Modal Backdrop & Layering Architecture (Portal mount to `document.body`, full viewport coverage, subtle background blur with 100% sharp modals, click-outside dismissal, and scroll lock).

---

# 14. AI-Tailored ATS Resume Generator (Phase 4)

- [X] Create structured resume domain model (`StructuredResumeContent`, provenance `source_fact_ids`).
- [X] Implement 1-Shot Gemini tailoring layer bounded strictly by verified Master Profile facts.
- [X] Implement Transferable Evidence intelligence (frames genuine adjacent skills truthfully without fabricating missing job requirements).
- [X] Implement Canonical ATS PDF Renderer using ReportLab (100% local, $0, deterministic layout & typography).
- [X] Implement Controlled LaTeX Template Engine (clean `.tex` export for Overleaf).
- [X] Persist tailored resumes and metadata to Cloud Firestore (`tailored_resumes` collection).
- [X] Build interactive split-screen Resume Studio UI (Structured Field Editor + Live PDF Preview + 1-Click PDF & TEX Downloads).
- [X] Instant zero-latency loading for existing tailored resumes with on-demand local re-rendering.

---

# 15. Deterministic Resume Validator & Truth Lock (Phase 4)

- [X] Implement zero-AI-cost deterministic Python validator (`app/services/resume_validator.py`).
- [X] Verify Pydantic structural boundaries and presence of required fields.
- [X] Mechanically verify that all claimed skills exist in candidate's verified profile.
- [X] Mechanically verify employer names, titles, dates, project names, and institutions against verified history.
- [X] Ensure skill gaps are transparently recorded without causing validation failures.
- [X] Implement bounded recovery retry (max 1 controlled retry on mechanical violation).
- [X] Display real-time Truth Integrity Badge (`Grounded in Verified Profile`) in Resume Studio UI.

---

# 16. Cover Letter Generator & Overleaf LaTeX Engine

- [X] Generate grounded 3-paragraph tailored cover letters in unified 1-shot Gemini requests (modes: `both`, `resume`, `cover_letter`).
- [X] Match company culture and job requirements with multi-tone selection (Professional, Enthusiastic, Technical, Concise).
- [X] Overleaf-format layout in ReportLab PDF & standalone `.tex` engine (Centered header, two-column recipient/date grid, formal subject line, 3 justified body paragraphs, sign-off).
- [X] Resumes & Tailoring Studio Hub with top segmented tab switcher (`ATS Resumes` vs `Tailored Cover Letters`), with .TEX, .MD, PDF export, Studio navigation, and safe delete.
- [X] Deterministic Python cover letter validation & Cloud Firestore persistence (`cover_letters` collection) with Zero-Token caching on subsequent opens.

---

# 17. Application Engine & Tracker

- [X] Create application schema and bidirectional state machine (`ApplicationRecordDTO`, `ApplicationStage`, immutable `StageTransitionEvent`).
- [X] Implement 5-column Kanban board (Saved / Draft, Ready to Apply, Applied, Interviewing, Offers) + collapsible Concluded section (Rejected & Archived).
- [X] Implement native HTML5 bidirectional drag-and-drop with strict gating (Saved -> Ready requires approved tailored resume snapshot; Interviewing -> Offers prompts Offer vs Rejected decision).
- [X] Implement structured interview timeline logging, candidate scratchpad notes, table view, and sync from saved opportunities.

---

# 18. Human-Supervised Browser Automation (Phase 2 Playwright Form Autofill)

- [ ] Set up Playwright browser lifecycle with headed Chromium on user's desktop.
- [ ] Implement smart ATS field adapters for Greenhouse, Lever, Ashby, and generic career portals.
- [ ] Automatically attach compiled tailored PDF resume to file upload inputs (`input[type="file"]`).
- [ ] Autofill verified candidate identity, contact details, and social links (LinkedIn, GitHub, Portfolio).
- [ ] Apply visual highlights (green borders & badges) on autofilled inputs and inject floating status banner.
- [ ] Enforce strict human-in-the-loop safety: mechanical block preventing Playwright from clicking "Submit Application".
- [ ] Pause at final review step for candidate to inspect fields, answer custom questions, and solve CAPTCHAs.
- [ ] Provide one-click "Mark as Applied" confirmation in JobFinder UI upon manual portal submission.

---

# Future Phase 1: ATS Custom Question Co-pilot (Application Q&A Assistant)

- [ ] Build ATS Question Co-pilot modal accessible directly from the application cards and details view.
- [ ] Implement prompt engine combining Target Job Description + Candidate Verified Master Profile facts.
- [ ] Generate concise, authentic, role-tailored responses for common portal essay questions ("Why us?", "Describe a challenging problem", "Salary expectations", "Work authorization").
- [ ] Enforce zero-fabrication truth model (answers only cite verified projects, tools, and experiences from the master profile).
- [ ] Add 1-click clipboard copy button with formatted text and character count indicators.
- [ ] Persist answered questions to Firestore so past answers can be re-used across similar applications.

---

# Future Phase 2: AI Role-Specific Interview Intelligence Kit

- [ ] Build dedicated Interview Prep Hub in the details modal for applications in the "Interviewing" stage.
- [ ] Generate top 10 role-specific technical deep-dive questions based on the target job's exact tech stack and requirements.
- [ ] Generate STAR-method behavioral response outlines mapping candidate's verified projects (Techniva, WebPilot, jobFinder, School Management) to expected behavioral questions.
- [ ] Generate 5 high-impact reverse-interview questions for the candidate to ask the hiring manager and interview panel.
- [ ] Include interactive mock answer practice field with AI feedback on conciseness and technical accuracy.
- [ ] Export full Interview Preparation Sheet as Markdown (.md) and printable ATS PDF.

---

# Future Phase 3: Browser Extension / Web Clipper ("Clip to JobFinder")

- [ ] Build lightweight Chromium extension (Manifest V3) for 1-click job clipping.
- [ ] Add content extraction scripts for major job boards: LinkedIn Jobs, Indeed, Wellfound (AngelList), Y Combinator Work at a Startup, and Glassdoor.
- [ ] Parse and extract job title, company name, location, remote status, compensation, and raw description text directly from the active tab DOM.
- [ ] Connect extension to JobFinder API via authenticated REST endpoint (`POST /api/v1/jobs/clip`).
- [ ] Automatically normalize extracted job via `job_normalization_service` into canonical format with semantic blocks.
- [ ] Place clipped opportunity directly into the "Saved / Draft" Kanban column with real-time browser push notification.

---

# Future Phase 4: Automated Resume ATS Score Simulator & Diff Inspector

- [ ] Build visual side-by-side ATS keyword and semantic match inspector in Application Studio.
- [ ] Compare tailored resume content directly against the target Job Description to highlight matched keywords, adjacent skills, and missing requirements.
- [ ] Provide actionable, 1-click optimization suggestions grounded strictly in verified profile facts (e.g., "Emphasize DSPy from your WebPilot project under Technical Skills").
- [ ] Simulate ATS parsing algorithms (ReportLab layout fidelity, section heading recognizability, date formatting compliance, font parseability).
- [ ] Display real-time ATS match score projection before exporting or approving the resume package.

---

# Future Phase 5: Email & Calendar Sync (Smart Status Auto-Detection)

- [ ] Implement secure Google / Gmail API integration to scan for inbound career and recruiter communications.
- [ ] Detect recruiter emails and parse message intent using NLP (Interview Invitation, Assessment Link, Rejection Notice, Offer Letter).
- [ ] Surface smart notification banners in JobFinder: e.g., "Interview invitation received from Databricks — Advance to Interviewing?".
- [ ] 1-click status advancement based on email triggers with automated interview event creation in the application timeline.
- [ ] Sync interview rounds and schedule details with Google Calendar (including meeting links, interviewers, and scheduled time).

---

# Active Execution: Forensic Audit Remediation (Phases 1 – 6)

## Phase 1 — Backend Authentication and Authorization Security
- [X] Task 1.1: Remove insecure developer UID fallbacks from `app/core/auth.py` and `app/api/v1/applications.py`.
- [X] Task 1.2: Enforce `Depends(get_authenticated_user_id)` on bypassed routers (`recommendations.py`, `scanner.py`, `resumes.py`, `cover_letters.py`).
- [X] Task 1.3: Validate identity header isolation (reject conflicting `X-User-Id` with HTTP 403; require verified token).
- [X] Task 1.4: Add comprehensive automated tests (`tests/test_auth_security.py`) for unauthenticated (401), invalid (401), cross-user (403), and valid token flows.
- [X] Phase 1 Verification: Run backend auth security tests and confirm zero unauthenticated data leaks (6/6 tests passing in `tests/test_auth_security.py`).

## Phase 2 — Logout Confirmation and Account Isolation
- [X] Task 2.1: Build `LogoutConfirmModal.tsx` adhering to JobFinder design system with clear Cancel and Log Out actions.
- [X] Task 2.2: Implement request cancellation (`abortAllRequests` via `AbortController`) in `lib/api.ts` on confirmed logout.
- [X] Task 2.3: Implement in-memory state wiping and cache invalidation on logout across `AiApiHubSettings`, `DashboardPage`, etc.
- [X] Task 2.4: Fix `Sidebar.tsx` display name fallback (replace hardcoded 'Affan Razvi' with 'Guest Candidate' when logged out).
- [X] Task 2.5: Add unit/component tests for logout modal confirmation, cancellation, and session cleanup.
- [X] Phase 2 Verification: Verify logout flow prevents previous-account data visibility and handles cancellation cleanly (7/7 tests passing in `LogoutConfirmModal.test.tsx`, 79/79 frontend suite passing).

## Phase 3 — Backend Health Monitoring and Recovery
- [X] Task 3.1: Update `apps/web/scripts/dev.js` health check timeout from 2000ms to 5000ms.
- [X] Task 3.2: Implement consecutive failure threshold (require 3 consecutive failed checks before revival attempt).
- [X] Task 3.3: Add process ownership verification (`process.kill(pid, 0)`) before restart and eliminate indiscriminate `fuser -k` killing.
- [X] Task 3.4: Verify recovery behavior and prove no false-alarm warning loops during normal operation.
- [X] Phase 3 Verification: Run dev server and confirm healthy requests produce 0 revival loops.

## Phase 4 — Consolidate Master Profile & Truth and Memory & Facts
- [X] Task 4.1: Port "Verified Quantitative Evidence" ribbon, "Deterministic Grounding Active" badge, and Work vs. Leadership visual grouping into `ProfilePage.tsx`.
- [X] Task 4.2: Delete `MemoryPage.tsx` and remove the `memory` tab from `App.tsx` and `Sidebar.tsx`.
- [X] Task 4.3: Verify all AI consumers continue functioning with zero broken imports or references.
- [X] Phase 4 Verification: Run frontend build (`tsc && vite build`) and full test suite (79/79 passed) to verify consolidated profile view.

## Phase 5 — Signed-Out Experience, New-User Onboarding, and Honest Matching
- [X] Task 5.1: Implement Profile Readiness Gate in `matching/engine.py` (`is_profile_usable`), returning `Unscored` and `fitScore = None` for empty profiles.
- [X] Task 5.2: Update backend schemas (`matching.py`, `job.py`) and frontend types (`job.ts`, `ScoreIndicator.tsx`) for nullable score and "Unscored" tier.
- [X] Task 5.3: Build Public Welcome Banner for signed-out visitors on Dashboard with AuthModal trigger and explore action.
- [X] Task 5.4: Add Onboarding Readiness Card to `DashboardPage.tsx` and "Unscored" indicators and filter tab to `OpportunitiesPage.tsx`.
- [X] Task 5.5: Add tests for empty vs usable profiles and honest matching behavior in `test_matching_engine.py` (5/5 tests pass).
- [X] Phase 5 Verification: Confirm empty profile returns 0 fake scores (Unscored/None), frontend build passes (exit 0), and 79/79 frontend tests pass.

## Phase 6 — Comprehensive Regression and Final Verification
- [X] Task 6.1: Run backend test suites covering auth, matching, health, profile, applications, scanner, and AI intelligence (89/89 tests passing).
- [X] Task 6.2: Run frontend Vitest suite (`npm --prefix apps/web test:run`) (10/10 test files, 79/79 tests passing).
- [X] Task 6.3: Run frontend production build (`tsc && vite build`) (built in 21.48s, 0 errors).
- [X] Task 6.4: Update `.audit/audit.md` and `.audit/change-log.md` with all changes, verified results, and watchdog hardening.
- [X] Phase 6 Verification: Confirm 100% checks pass, pre-existing user files preserved, and zero regressions remain.

---

# ATS Scanner Production-Readiness Architecture Roadmap

## Phase 1: Core Algorithm and Calibration Suite (Backend Core) — NOT STARTED
- Scope: Deprecate additive formula (+25 verb, +15 metric, +20 word count) in `technical_taxonomy.py`. Implement 4-dimensional rubric scoring (Action & Scope 0-25, Technical Substance 0-25, Outcome Credibility 0-25, Target Role Relevance 0-25) in `technical_taxonomy.py` and `ats_scanner_engine.py`. Integrate `JobAnalysisService` requirement extraction, contextual evidence matching, and multi-criteria qualitative gating (`Ready to Apply`, `Needs Alignment`, `Structural Revision Needed`). Build calibration test suite covering the 14 mandatory ordinal invariant scenarios.
- Files:
  - `apps/api/app/services/taxonomy/technical_taxonomy.py`
  - `apps/api/app/services/ats_scanner_engine.py`
  - `apps/api/tests/test_ats_scanner.py`
- Acceptance Criteria:
  - [ ] 85/100 and 100/100 bimodal scoring eliminated across diverse statement inputs.
  - [ ] Zero hardcoded bonus increments or score caps in scoring codebase.
  - [ ] 14 calibration test cases pass relative ordinal invariant assertions ($A > B$) and qualitative rubric bands.
  - [ ] Missing job description falls back cleanly to baseline structural mode without errors.

## Phase 2: Schema Extensions, Security & Fallback Hardening (API Layer) — NOT STARTED
- Scope: Update Pydantic schemas in `apps/api/app/schemas/scanner.py` with additive optional models (`rubric_breakdown`, `readiness`, `analysis_mode`, `confidence_level` defaulting to `None`). Secure `POST /api/v1/scanner/scan-file` with `get_optional_authenticated_user_id`, enforcing guest rate limits, file size caps (5MB), magic byte validation, and DOCX decompression explosion defenses. Implement 4-layer prompt injection defense and tenant-safe cache key hashing.
- Files:
  - `apps/api/app/schemas/scanner.py`
  - `apps/api/app/api/v1/scanner.py`
  - `apps/api/tests/test_ats_scanner.py`
- Acceptance Criteria:
  - [ ] Historical Firestore scan reports deserialize cleanly with zero validation errors or artificial defaults.
  - [ ] Unauthenticated requests to `/scanner/scan-file` receive in-memory scan; spoofed `X-User-Id` rejected with 403.
  - [ ] File upload constraints (5MB max, magic bytes, zip-bomb checks) enforced.
  - [ ] Simulated AI timeouts gracefully trigger `analysis_mode: "deterministic_structural"` with explicit mode labeling.

## Phase 3: Interactive Modern UI/UX Implementation (Frontend Layer) — NOT STARTED
- Scope: Build Inline Expandable Bullet Audit cards with 4-bar rubric breakdown, linked requirement tags, and diff-based rewrite previews. Build interactive Job-Description Match Map separating mandatory vs preferred competencies with 4 evidence states (`Demonstrated`, `Listed`, `Missing in Resume`, `Unverified`). Implement 3-pillar Hero Dashboard, WCAG AA color tokens, and impact-ranked action checklist in `ScannerPage.tsx`. Update TypeScript types in `types/scanner.ts`.
- Files:
  - `apps/web/src/types/scanner.ts`
  - `apps/web/src/pages/ScannerPage.tsx`
  - `apps/web/src/pages/ScannerPage.test.tsx`
- Acceptance Criteria:
  - [ ] Candidates can expand individual bullets to inspect 4-metric rubric breakdowns and matched requirements.
  - [ ] Match Map highlights matching resume statements upon clicking requirement tags.
  - [ ] Rewrites require explicit user review and confirmation before applying (zero auto-commits).
  - [ ] Legacy reports display legacy notice without rendering broken or empty rubric meters.

## Phase 4: Production Verification, PDF Exporter Audit & Benchmark Signoff — NOT STARTED
- Scope: Validate offscreen A4 PDF exporter (`atsReportExporter.ts`) compatibility with new additive schemas and legacy reports. Execute full end-to-end regression test suite, 50-pair golden benchmark evaluation, Axe accessibility audit, and operational performance measurements.
- Files:
  - `apps/web/src/lib/atsReportExporter.ts`
  - `apps/web/src/lib/atsReportExporter.test.ts`
  - `apps/api/tests/test_ats_scanner.py`
- Acceptance Criteria:
  - [ ] Multi-page A4 PDF exports render cleanly for both legacy and contextual reports without layout shifts or text overlaps.
  - [ ] Benchmark evaluation achieves $\ge 90\%$ rubric agreement and $\le 5\%$ false positive rate across the golden set.
  - [ ] Full backend suite (`pytest`) and frontend suite (`npm run test:run`) pass with 0 errors; `npm run build` succeeds.

