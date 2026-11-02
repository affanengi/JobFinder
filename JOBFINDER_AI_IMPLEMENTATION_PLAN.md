# JobFinder AI — Comprehensive Implementation Plan

**Document Status:** Complete & Ready for Engineering Review  
**Date:** November 2, 2026  
**Architectural Baseline:** Grounded strictly in `JOBFINDER_AI_CURRENT_CODEBASE_AUDIT.md`  
**Target Workspaces:** `apps/api` (FastAPI backend), `apps/web` (React 18 / Vite frontend), Google Cloud Firestore  
**Primary Constraints:** $0 Infra Spend, Reuse Existing AI/API Hub, Zero Hallucination (Truth-Lock Grounding), Strict 3-Level Permission Enforcement, Model-Agnostic Execution

---

## 1. Executive Summary

**JobFinder AI** transforms JobFinder from an ensemble of disconnected job-search utilities into an integrated, context-aware, autonomous personal career operating system. Through a single natural language interface accessible from anywhere within the application, users can query job recommendations, inspect company legitimacy, prepare Truth-Locked tailored resumes, draft and send outreach emails to recruiters via Gmail, review upcoming interview slots on Google Calendar, and archive application artifacts into Google Drive.

This plan details the complete engineering specification for building JobFinder AI. It leverages the existing, operational AI/API Hub (`apps/api/app/ai/hub/`) and existing Google OAuth connections while adding a controlled tool registry, a 3-level permission execution gateway, an active-page context harvester, and a lightweight Firestore conversation store.

---

## 2. Product Vision and Scope

### 2.1 The Problem
Job seekers are burdened by context fragmentation: they analyze jobs in JobFinder, check recruiter emails in Gmail, schedule technical screens in Google Calendar, and organize tailored resumes in Google Drive. This fragmentation leads to missed recruiter follow-ups, double-booking, and generic, un-audited application materials.

### 2.2 The Solution
JobFinder AI serves as a **Human-in-the-Loop Career Agent**. It acts as an expert copilot that:
1. **Understands Application Context:** Automatically senses what the user is currently looking at (e.g., viewing Stripe on the Company Profile page or inspecting a Software Engineer recommendation).
2. **Accesses Authoritative Truth:** Retrieves verified career history from the Master Profile without ever inventing metrics or qualifications.
3. **Coordinates External Services:** Reads and searches Gmail, Google Calendar, and Google Drive through pre-authorized OAuth tokens.
4. **Enforces Explicit User Approval:** Stages drafts and schedules, but **never** transmits emails or creates/deletes calendar events without unambiguous, parameter-bound user confirmation.

---

## 3. Functional Requirements

| ID | Requirement | Description | Target Phase |
| :--- | :--- | :--- | :--- |
| **FR-01** | **Global Slide-Over Drawer** | Native assistant panel accessible via navbar button and `Cmd+J` / `Ctrl+J` across all views without shifting layout. | Phase 1 |
| **FR-02** | **Multi-Turn Chat Sessions** | Persistent conversation history stored in Cloud Firestore with thread switching and title generation. | Phase 1 |
| **FR-03** | **Active View Context Sensing** | Automatic harvesting of active route, viewed opportunity ID, company name, or selected recruiter contact. | Phase 1 |
| **FR-04** | **Internal JobFinder Tool Suite** | Read-only querying of jobs, applications, candidate profile facts, and tailored resumes. | Phase 1 |
| **FR-05** | **Gmail Recruiter Search** | Natural language search across incoming/outgoing Gmail threads for recruiter communications. | Phase 2 |
| **FR-06** | **Truth-Locked Gmail Drafting** | Assistant preparation of follow-up drafts validated by `OutreachOrchestrationService` anti-fabrication rules. | Phase 2 |
| **FR-07** | **Approval-Gated Email Dispatch** | Level 3 execution of `send_approved_outreach` requiring explicit user signature on recipient, subject, and body. | Phase 2 |
| **FR-08** | **Calendar Conflict & Event Read** | Inspection of upcoming interviews, recruiter calls, and conflict detection via Google Calendar API. | Phase 3 |
| **FR-09** | **Interview Reminder Scheduling** | Staging and approval-gated creation of calendar events for interviews, deadlines, and prep sessions. | Phase 3 |
| **FR-10** | **Drive Document Search & Upload** | Storing tailored resume PDFs and cover letter artifacts directly into user's Google Drive. | Phase 4 |
| **FR-11** | **Multi-Service Workflows** | Chained operations (e.g. "Draft follow-up to Scale AI recruiter, find their email in Gmail, and block 30m prep tomorrow"). | Phase 5 |
| **FR-12** | **Assistant Memory & Preferences** | User-declared preferences (e.g., preferred interview prep lead time, communication tone) stored in Firestore. | Phase 6 |

---

## 4. Non-Functional Requirements

- **Zero Added Infrastructure Costs ($0 Spend):** Runs entirely within the existing FastAPI process and Cloud Firestore (Spark plan compatible). No external vector databases, Redis, or Celery.
- **Model Independence:** Replaceable AI routing via AI/API Hub. Works identically across Google Gemini, Groq (Llama 3.3), and OpenRouter models.
- **Latency & Responsiveness:** Context assembly under 100ms; tool execution under 1.5s; total round-trip response under 3.5s.
- **Security & Privilege Isolation:** The LLM never sees raw OAuth refresh tokens, Firebase service credentials, or raw SQL/Firestore query interfaces.
- **Deterministic Anti-Hallucination:** All candidate career statements strictly match `MasterProfile` facts.

---

## 5. Proposed Architecture

```
+----------------------------------------------------------------------------------------------------+
|                                              FRONTEND                                              |
|                                                                                                    |
|   +-----------------------+     +--------------------------+     +-----------------------------+   |
|   |   TopHeader.tsx       | --> |   AssistantDrawer.tsx    | --> |   ContextCollector.ts       |   |
|   |   [JobFinder AI Btn]  |     |   (Slide-over overlay)   |     |   (Active tab, job, contact)|   |
|   +-----------------------+     +--------------------------+     +-----------------------------+   |
+-----------------------------------------------|----------------------------------------------------+
                                                | HTTP / SSE (JSON)
+-----------------------------------------------v----------------------------------------------------+
|                                          FASTAPI BACKEND                                           |
|                                                                                                    |
|   +--------------------------------------------------------------------------------------------+   |
|   |                        Assistant API Router: /api/v1/assistant                             |   |
|   |                        (Session management, chat dispatch, approvals)                      |   |
|   +---------------------------------------------|----------------------------------------------+   |
|                                                 |                                                  |
|   +---------------------------------------------v----------------------------------------------+   |
|   |                                 AssistantOrchestrator                                      |   |
|   |       1. Inject conversation history & active context                                      |   |
|   |       2. Invoke AI Hub with Structured Tool Schema                                         |   |
|   |       3. Intercept planned tool calls & evaluate Permission Gateway                        |   |
|   +---------------------|-------------------------------------------------------|--------------+   |
|                         |                                                       |                  |
|         +---------------v---------------+                       +---------------v---------------+  |
|         |       Permission Gateway      |                       |        AI / API Hub           |  |
|         | Level 1: Execute read         |                       | Router -> Gemini / Groq       |  |
|         | Level 2: Stage draft / event  |                       | AES-256-GCM User Keys         |  |
|         | Level 3: Block for approval   |                       +-------------------------------+  |
|         +---------------|---------------+                                                          |
|                         |                                                                          |
|         +---------------v-------------------------------------------------------+                  |
|         |                            Tool Registry                              |                  |
|         | +------------------+ +-------------------+ +------------------------+ |                  |
|         | | Internal Tools   | | Gmail Tools       | | Calendar & Drive Tools | |                  |
|         | | - Jobs / Opps    | | - Search Messages | | - Upcoming Events      | |                  |
|         | | - Profile Truth  | | - Create Draft    | | - Create Event         | |                  |
|         | | - Resumes        | | - Send Approved   | | - Upload Resume File   | |                  |
|         | +------------------+ +-------------------+ +------------------------+ |                  |
|         +---------------------------------------|-------------------------------+                  |
+-------------------------------------------------|--------------------------------------------------+
                                                  |
+-------------------------------------------------v--------------------------------------------------+
|                                    DATA & CREDENTIAL STORES                                        |
|   +-------------------------------+   +-----------------------------+   +----------------------+   |
|   |        Cloud Firestore        |   |      OAuth Crypto Vault     |   | Google Workspace APIs|   |
|   | - users/{uid}/ai_conversations|   | - AES-256-GCM Tokens        |   | - Gmail (Send/Read)  |   |
|   | - users/{uid}/outreach        |   | - HKDF Key Separation       |   | - Calendar (Events)  |   |
|   | - profiles/{uid} (Truth)      |   | - Distributed Token Leases  |   | - Drive (Files)      |   |
|   +-------------------------------+   +-----------------------------+   +----------------------+   |
+----------------------------------------------------------------------------------------------------+
```

---

## 6. Frontend Architecture and UI Integration

### 6.1 Component Hierarchy

```
apps/web/src/
├── components/
│   ├── layout/
│   │   ├── TopHeader.tsx               [MODIFIED] Replace cloud dot with JobFinder AI button
│   │   └── TopHeader.test.tsx          [MODIFIED] Add tests for AI button
│   └── assistant/                      [NEW DIRECTORY]
│       ├── AssistantDrawer.tsx         # Main slide-over drawer shell
│       ├── AssistantDrawer.test.tsx    # Vitest component test
│       ├── ChatMessageList.tsx         # Virtualized or auto-scrolling message list
│       ├── ChatInputArea.tsx           # Auto-expanding textarea with shortcut tips
│       ├── ToolExecutionCard.tsx       # Visual feedback for tool execution (pending, done, failed)
│       ├── ActionApprovalCard.tsx      # Level 3 interactive confirmation modal / card
│       ├── ContextPillBar.tsx          # Chips displaying active context (e.g. "Scale AI", "Page: Opportunities")
│       └── SessionHistoryMenu.tsx      # Dropdown to switch or clear conversations
├── hooks/
│   ├── useAssistant.ts                 # React hook encapsulating chat state, dispatch, and approvals
│   └── useActiveContext.ts             # Senses current URL hash, active company, or selected job
└── types/
    └── assistant.ts                    # TypeScript interfaces for messages, tools, and tickets
```

### 6.2 Navbar Integration Detail (`TopHeader.tsx`)

In `apps/web/src/components/layout/TopHeader.tsx`, lines 57–72 are replaced with:

```tsx
{/* JobFinder AI Launch Button */}
<button
  onClick={() => setIsAssistantOpen((prev) => !prev)}
  className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border transition-all cursor-pointer ${
    isAssistantOpen
      ? 'bg-white text-black border-white shadow-[0_0_15px_rgba(255,255,255,0.2)]'
      : 'bg-[#161616] border-white/20 text-white hover:bg-[#1F1F1F] hover:border-white/40'
  }`}
  title="Toggle JobFinder AI (Cmd+J / Ctrl+J)"
  aria-label="JobFinder AI Assistant"
>
  <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
  <span className="text-xs font-semibold tracking-tight hidden sm:inline">JobFinder AI</span>
  <kbd className="hidden lg:inline text-[10px] px-1 py-0.5 rounded bg-white/10 text-[#A3A3A3] font-mono">⌘J</kbd>
</button>
```

### 6.3 Drawer Layout & Overlay Behavior

The drawer mounts at the root of `App.tsx` outside the main scroll container:
- Style: `fixed top-0 right-0 bottom-0 w-full sm:w-[480px] z-50 bg-[#121212] border-l border-white/20 shadow-2xl flex flex-col`
- Transition: Slide-in transition from right (`translate-x-0` vs `translate-x-full`) with 200ms ease-out.
- Backdrop: Subtle semi-transparent backdrop (`bg-black/40 backdrop-blur-[2px]`) visible on mobile screens (<640px) with tap-outside to close. Desktop screens allow simultaneous interaction with the main page.

---

## 7. Backend Architecture

### 7.1 New Modules and Responsibilities

```
apps/api/app/
├── ai/
│   └── assistant/                      [NEW PACKAGE]
│       ├── __init__.py
│       ├── orchestrator.py             # Assistant turn lifecycle: context -> model -> tools -> response
│       ├── registry.py                 # Tool registration, dispatch, and JSON schema export
│       ├── permissions.py              # 3-level permission checks & approval ticket minting/verifying
│       ├── context.py                  # Server-side context hydration (user profile, active job, etc.)
│       └── schemas.py                  # Pydantic schemas for messages, tool calls, and approval tickets
├── api/
│   └── v1/
│       ├── assistant.py                # [NEW] REST & SSE endpoints for assistant chat & approval
│       └── router.py                   # [MODIFIED] Mounts assistant.py
├── db/
│   └── repositories/
│       └── conversation_repo.py        # [NEW] Firestore repository for user chat sessions & messages
└── services/
    ├── gmail_tool_service.py           # [NEW] Gmail search & draft creation wrappers
    ├── calendar_tool_service.py        # [NEW] Calendar event query & creation wrappers
    └── drive_tool_service.py           # [NEW] Drive search, upload & folder organization wrappers
```

---

## 8. AI Orchestration Design

### 8.1 Turn Lifecycle

Each assistant interaction executes through six deterministic phases:

```
[ User Input + Client Context ]
               │
               ▼
1. Context Hydration
   - Load recent message history (last 10 turns)
   - Hydrate active job / company / contact if ID provided
   - Load candidate profile summary (Truth corpus)
               │
               ▼
2. Model Invocation (via AI Hub)
   - Format prompt with System Directive, Tool Schemas, and Context
   - Dispatch to AI Hub Orchestrator using task `AITaskType.JOBFINDER_ASSISTANT_CHAT`
   - AI Hub routes to user-configured model (Gemini 2.5/Groq/OpenRouter)
               │
               ▼
3. Tool Call Interception
   - Model returns: Text response OR Proposed Tool Calls (JSON)
   - If no tool calls: Persist assistant message and return.
               │
               ▼
4. Permission Gateway Evaluation
   - For each tool call:
     - Level 1 (Read): Execute tool immediately
     - Level 2 (Prepare): Execute preparation, store draft, return staged preview
     - Level 3 (Execute): Halt execution; generate parameter-bound Approval Ticket
               │
               ▼
5. Tool Execution & Observation
   - Execute authorized tools against backend services
   - Capture tool result observations
               │
               ▼
6. Final Synthesis Response
   - Feed observations back to model to synthesize natural language summary
   - Persist assistant message + tool execution log in Firestore
   - Return response payload to client
```

---

## 9. Existing AI/API Hub Integration

### 9.1 New Task Type Registration

Modify `apps/api/app/ai/hub/types.py`:

```python
class AITaskType(StrEnum):
    # Existing task types...
    COMPANY_INTELLIGENCE = "company_intelligence"
    OUTREACH_DRAFT_GENERATION = "outreach_draft_generation"
    REPLY_INTENT_CLASSIFICATION = "reply_intent_classification"
    # NEW: Dedicated Assistant Orchestration Task
    JOBFINDER_ASSISTANT_CHAT = "jobfinder_assistant_chat"
```

Modify `apps/api/app/ai/hub/task_key_normalizer.py`:
- Map `"jobfinder_assistant_chat"` and `"assistant"` to `AITaskType.JOBFINDER_ASSISTANT_CHAT`.

### 9.2 Request Specification

The assistant orchestrator constructs an `ExecutionRequest` (`apps/api/app/ai/hub/models.py`):

```python
request = ExecutionRequest(
    task=AITaskType.JOBFINDER_ASSISTANT_CHAT,
    user_id=user_id,
    prompt=turn_prompt,
    system_instruction=ASSISTANT_SYSTEM_DIRECTIVE,
    temperature=0.2,  # Low temperature for strict tool precision
    execution_timeout=45.0,
    metadata={"conversation_id": conversation_id, "active_route": client_context.active_route},
)
response: ExecutionResponse = await ai_orchestrator.execute(request)
```

This guarantees that:
- The user's active API keys and cost policies (`FREE_ONLY`, `FREE_PREFERRED`) are automatically enforced.
- Key fallbacks (e.g. Gemini -> Groq Llama 3.3) trigger seamlessly on 429 rate limits.
- Telemetry is recorded in `users/{userId}/ai_telemetry` without custom logging code.

---

## 10. Internal JobFinder Tool Design

All internal tools are implemented in `apps/api/app/ai/assistant/tools/internal_tools.py` as pure async functions receiving `user_id` and typed parameters.

### Tool Catalog

#### 1. `search_jobs`
- **Purpose:** Search ingested job listings by keyword, title, location, or match score threshold.
- **Parameters:**
  ```python
  class SearchJobsParams(BaseModel):
      query: Optional[str] = None
      min_match_score: Optional[int] = Field(default=None, ge=0, le=100)
      remote_only: Optional[bool] = False
      limit: int = Field(default=5, ge=1, le=20)
  ```
- **Backend Service:** Delegates to `apps/api/app/services/job_service.py` (`job_service.list_jobs`).
- **Permission Level:** Level 1 (Read).

#### 2. `get_application_status`
- **Purpose:** Retrieve status and timeline of job applications (e.g. `APPLIED`, `INTERVIEWING`, `OFFER`, `REJECTED`).
- **Parameters:**
  ```python
  class GetApplicationStatusParams(BaseModel):
      company_name: Optional[str] = None
      status_filter: Optional[str] = None
      limit: int = 10
  ```
- **Backend Service:** Delegates to `apps/api/app/db/repositories/application_repo.py`.
- **Permission Level:** Level 1 (Read).

#### 3. `get_candidate_profile_facts`
- **Purpose:** Retrieve verified facts from Master Profile regarding candidate skills, past employment, projects, or degree.
- **Parameters:**
  ```python
  class GetProfileFactsParams(BaseModel):
      category: Literal["all", "skills", "experience", "education", "projects", "certifications"] = "all"
  ```
- **Backend Service:** Delegates to `apps/api/app/services/profile_service.py` (`profile_service.get_profile`).
- **Permission Level:** Level 1 (Read).

#### 4. `get_company_intelligence`
- **Purpose:** Retrieve Scam Shield legitimacy score, company evidence, and known contacts.
- **Parameters:**
  ```python
  class GetCompanyIntelParams(BaseModel):
      company_name: str
  ```
- **Backend Service:** Delegates to `apps/api/app/services/company_intelligence_service.py`.
- **Permission Level:** Level 1 (Read).

---

## 11. Gmail Tool Integration

Implemented in `apps/api/app/services/gmail_tool_service.py` using `google_oauth_service.get_valid_access_token(user_id, "gmail")`.

### Tool Catalog

#### 1. `search_gmail_messages`
- **Purpose:** Search user's Gmail mailbox for recruiter messages, interview invitations, or updates.
- **Parameters:**
  ```python
  class SearchGmailParams(BaseModel):
      query: str = Field(description="Gmail search query syntax, e.g. 'from:recruiter@stripe.com' or 'interview'")
      max_results: int = Field(default=5, ge=1, le=10)
  ```
- **Endpoint:** Calls Google API `GET https://gmail.googleapis.com/gmail/v1/users/me/messages?q={query}&maxResults={max_results}`.
- **Permission Level:** Level 1 (Read).

#### 2. `get_gmail_thread`
- **Purpose:** Retrieve complete message thread history for context.
- **Parameters:**
  ```python
  class GetGmailThreadParams(BaseModel):
      thread_id: str
  ```
- **Endpoint:** `GET https://gmail.googleapis.com/gmail/v1/users/me/threads/{thread_id}?format=full`. Sanitizes HTML body into clean plaintext.
- **Permission Level:** Level 1 (Read).

#### 3. `create_gmail_draft`
- **Purpose:** Prepare an email draft in the user's Gmail box. Draft is staged in Gmail for user inspection.
- **Parameters:**
  ```python
  class CreateGmailDraftParams(BaseModel):
      recipient_email: str
      subject: str
      body_text: str
      thread_id: Optional[str] = None
  ```
- **Validation:** Runs `outreach_orchestration_service.audit_truth_lock` to verify that no fabricated metrics or relationships exist before staging.
- **Endpoint:** `POST https://gmail.googleapis.com/gmail/v1/users/me/drafts`.
- **Permission Level:** Level 2 (Prepare). Returns Draft ID and preview link.

#### 4. `send_gmail_message`
- **Purpose:** Transmit an email message directly to a recipient.
- **Parameters:**
  ```python
  class SendGmailMessageParams(BaseModel):
      approval_ticket: str = Field(description="Signed Level-3 HMAC approval token")
      recipient_email: str
      subject: str
      body_text: str
      thread_id: Optional[str] = None
  ```
- **Backend Service:** Validates approval ticket, then invokes `gmail_sending_service.send_approved_outreach` or direct send.
- **Permission Level:** **Level 3 (Execute — Explicit User Approval Required)**.

---

## 12. Google Calendar Tool Integration

Implemented in `apps/api/app/services/calendar_tool_service.py` using `google_oauth_service.get_valid_access_token(user_id, "calendar")`.

### Tool Catalog

#### 1. `get_upcoming_calendar_events`
- **Purpose:** List scheduled events and interviews in a specified date range.
- **Parameters:**
  ```python
  class GetCalendarEventsParams(BaseModel):
      days_ahead: int = Field(default=7, ge=1, le=30)
      query: Optional[str] = None
  ```
- **Endpoint:** `GET https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin={now}&timeMax={future}&q={query}&singleEvents=true&orderBy=startTime`.
- **Permission Level:** Level 1 (Read).

#### 2. `prepare_calendar_event`
- **Purpose:** Formulate and validate an interview, prep block, or reminder event without creating it on Google servers.
- **Parameters:**
  ```python
  class PrepareCalendarEventParams(BaseModel):
      summary: str
      description: Optional[str] = None
      start_iso: str
      end_iso: str
      attendees: list[str] = Field(default_factory=list)
  ```
- **Behavior:** Verifies start/end validity, checks for overlapping conflicts using `get_upcoming_calendar_events`, stages proposed event, and presents to user.
- **Permission Level:** Level 2 (Prepare).

#### 3. `create_calendar_event`
- **Purpose:** Insert approved event into Google Calendar.
- **Parameters:**
  ```python
  class CreateCalendarEventParams(BaseModel):
      approval_ticket: str
      summary: str
      description: Optional[str] = None
      start_iso: str
      end_iso: str
      attendees: list[str] = Field(default_factory=list)
  ```
- **Endpoint:** `POST https://www.googleapis.com/calendar/v3/calendars/primary/events`.
- **Permission Level:** **Level 3 (Execute — Explicit User Approval Required)**.

#### 4. `delete_calendar_event`
- **Purpose:** Delete a cancelled interview or reminder.
- **Parameters:**
  ```python
  class DeleteCalendarEventParams(BaseModel):
      approval_ticket: str
      event_id: str
  ```
- **Endpoint:** `DELETE https://www.googleapis.com/calendar/v3/calendars/primary/events/{event_id}`.
- **Permission Level:** **Level 3 (Execute — Explicit User Approval Required)**.

---

## 13. Google Drive Tool Integration

Implemented in `apps/api/app/services/drive_tool_service.py` using `google_oauth_service.get_valid_access_token(user_id, "drive")`. Scope: `https://www.googleapis.com/auth/drive.file`.

### Tool Catalog

#### 1. `search_drive_files`
- **Purpose:** Find documents, resumes, and export folders created by JobFinder.
- **Parameters:**
  ```python
  class SearchDriveFilesParams(BaseModel):
      query: Optional[str] = None
      mime_type: Optional[str] = None
  ```
- **Endpoint:** `GET https://www.googleapis.com/drive/v3/files?q={q}&fields=files(id,name,mimeType,webViewLink,createdTime)`.
- **Permission Level:** Level 1 (Read).

#### 2. `upload_resume_to_drive`
- **Purpose:** Upload a compiled tailored resume PDF or DOCX from JobFinder into the user's Google Drive.
- **Parameters:**
  ```python
  class UploadResumeToDriveParams(BaseModel):
      approval_ticket: str
      resume_id: str
      folder_name: str = "JobFinder Applications"
  ```
- **Behavior:** Retrieves resume artifact from `resume_repo.get_tailored_resume(resume_id)`, creates folder if not exists, uploads file via multipart upload (`POST https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart`), returns `webViewLink`.
- **Permission Level:** **Level 3 (Execute — Explicit User Approval Required)**.

---

## 14. Context-Awareness Design

### 14.1 Client-Side Context Payload

Every message sent from `apps/web` includes an active context snapshot:

```typescript
export interface ClientContextSnapshot {
  activeRoute: string;                 // e.g. "companies/scale-ai" or "opportunities"
  activeTab: string;                   // e.g. "companies"
  selectedCompanyKey?: string | null;  // e.g. "scale-ai"
  selectedContactId?: string | null;   // e.g. "contact-sarah-chen"
  selectedOpportunityId?: string | null; // e.g. "opp_stripe_fullstack"
  pageSummary?: string;                // e.g. "Viewing Scale AI legitimacy dossier: Score 85/100"
}
```

### 14.2 Server-Side Context Hydration

When the backend receives the request, `apps/api/app/ai/assistant/context.py` hydrates the context:
1. If `selectedOpportunityId` is present: Loads target role, requirements, salary, and company from `job_service.get_job(...)`.
2. If `selectedCompanyKey` is present: Loads corporate profile and Scam Shield score from `company_intelligence_repo`.
3. If `selectedContactId` is present: Loads recruiter name, role, email, and prior outreach state from `opportunity_contact_repo`.
4. Loads candidate core facts: Name, primary title, and top 5 verified skills from `profile_service`.

This context is injected into the model prompt under `<current_user_context>`, enabling zero-friction conversational references:
> User: *"Draft a follow up to this recruiter."*  
> Assistant: Resolves that "this recruiter" refers to Sarah Chen at Scale AI based on the hydrated context.

---

## 15. Truth-Lock Integration

To prevent hallucinations, the assistant prompt enforces strict Truth-Lock boundaries:

```markdown
<truth_lock_policy>
1. You are bound by the candidate's canonical Master Profile.
2. You MUST NEVER fabricate employment dates, job titles, technical skills, or degrees.
3. You MUST NEVER invent quantitative achievements or metrics (e.g. "reduced latency by 40%"). If an achievement lacks a metric in the profile facts, describe the accomplishment qualitatively.
4. When drafting outreach or cover letters, you MUST ground all statements in verified facts retrieved via `get_candidate_profile_facts`.
5. If the user asks you to state experience the candidate does not have, you MUST politely decline and cite the Truth-Lock requirement.
</truth_lock_policy>
```

Furthermore, prior to saving or presenting any generated outreach draft, the assistant backend automatically routes the draft through `outreach_orchestration_service.audit_truth_lock`. If a blocking `FAIL` is triggered, the draft is rejected with an explanation.

---

## 16. Conversation History and Preferences

### 16.1 Storage Schema in Cloud Firestore

#### Conversation Document
- Path: `users/{userId}/ai_conversations/{conversationId}`
```json
{
  "id": "conv_abc123",
  "userId": "user_xyz",
  "title": "Scale AI Recruiter Outreach",
  "createdAt": "2026-11-02T14:30:00Z",
  "updatedAt": "2026-11-02T14:32:15Z",
  "messageCount": 4,
  "lastMessageSnippet": "Draft prepared and awaiting your review."
}
```

#### Message Document
- Path: `users/{userId}/ai_conversations/{conversationId}/messages/{messageId}`
```json
{
  "id": "msg_001",
  "conversationId": "conv_abc123",
  "role": "assistant",
  "content": "I found 2 recent emails from Scale AI regarding the Senior Frontend position. Here is the latest update:",
  "createdAt": "2026-11-02T14:31:00Z",
  "toolCalls": [
    {
      "toolName": "search_gmail_messages",
      "callId": "call_987",
      "parameters": { "query": "from:scale.com interview" },
      "status": "COMPLETED",
      "resultSnippet": "Found thread: 'Invitation to Technical Screen'"
    }
  ],
  "stagedAction": null
}
```

### 16.2 Assistant Preferences
Stored at `users/{userId}/ai_settings/assistant_preferences`:
```json
{
  "defaultCalendarReminderMinutes": 30,
  "communicationTone": "CONCISE_PROFESSIONAL",
  "autoCheckRecruiterReplies": true,
  "preferredModelId": "gemini-2.5-flash"
}
```

---

## 17. Permission and Approval Architecture

### 17.1 The 3-Level Action Taxonomy

```
+-------------------------------------------------------------------------+
| Level 1: READ (Zero Friction)                                           |
| Search emails, read calendar, view jobs, inspect profile facts.         |
| -> Executed immediately by backend without prompt.                      |
+-------------------------------------------------------------------------+
                                    │
+-----------------------------------v-------------------------------------+
| Level 2: PREPARE (Staged Preview)                                       |
| Formulate draft, prepare calendar event, tailor resume.                 |
| -> Staged in JobFinder database with status 'AWAITING_APPROVAL'.       |
| -> Preview card rendered in chat interface.                             |
+-------------------------------------------------------------------------+
                                    │
+-----------------------------------v-------------------------------------+
| Level 3: EXECUTE (Consequential External Action)                        |
| Send email, insert calendar event, delete file, submit application.     |
| -> Requires user click on approval card.                                |
| -> Mints cryptographically signed, parameter-bound Approval Ticket.     |
| -> Backend verifies ticket before executing external API call.          |
+-------------------------------------------------------------------------+
```

### 17.2 Tamper-Evident Approval Ticket Design

Implemented in `apps/api/app/ai/assistant/permissions.py`:
- Format: `{userId}:{toolName}:{paramSha256}:{expiresAt}:{hmacSignature}`
- Signing Key: HKDF-derived key from `OAUTH_ENCRYPTION_SECRET`.
- Time-to-Live (TTL): 5 minutes.
- Invariant: If a user modifies the recipient email, subject, body, or event time, the SHA256 parameter digest no longer matches the signature. The ticket is immediately rejected as invalid.

---

## 18. Security and Privacy Architecture

1. **Strict Tenant Boundaries:** Every database write and tool invocation is bound to `user_id` extracted from the Firebase Auth JWT.
2. **Inbound Data Sanitization:** Untrusted email text or external job postings are stripped of prompt-injection delimiters before injection into prompts.
3. **Least Privilege Scopes:** Google Drive operates under `drive.file` scope only; Gmail operates under `gmail.send` and optional `gmail.readonly`. No full mailbox management scope is ever requested.
4. **Idempotency Keys:** Every Level 3 action generates an idempotency hash recorded in Firestore to prevent double-execution.

---

## 19. Activity and Execution History

The assistant automatically records all operations into `users/{userId}/ai_telemetry` and displays a live execution status badge in the UI:

| Status | Visual Badge | Description |
| :--- | :--- | :--- |
| `PENDING` | Spinner (Blue) | Tool call received, preparing dispatch |
| `EXECUTING` | Pulse (Blue) | External API request in-flight |
| `AWAITING_APPROVAL` | Shield Alert (Amber) | Action staged, waiting for user click |
| `COMPLETED` | Checkmark (Emerald) | Action executed and verified |
| `FAILED` | X-Circle (Rose) | Execution failed with actionable error message |
| `CANCELLED` | Minus (Neutral) | User rejected staged action |

---

## 20. Background Task Handling

For multi-step or time-consuming workflows (e.g. querying multiple recruiter replies and summarizing past application history):
1. The assistant creates an in-flight operation document in `users/{userId}/ai_tasks/{taskId}`.
2. The FastAPI backend dispatches the task via `asyncio.create_task`.
3. The frontend drawer displays a non-blocking progress spinner.
4. The user can close the drawer and navigate elsewhere in JobFinder; when the task finishes, a notification banner signals completion.

---

## 21. Database Changes and Schema Design

### New Firestore Collections

```
users/
└── {userId}/
    ├── ai_conversations/
    │   └── {conversationId}/
    │       ├── (fields: id, title, createdAt, updatedAt, messageCount)
    │       └── messages/
    │           └── {messageId}/
    │               └── (fields: id, role, content, toolCalls, stagedAction, createdAt)
    └── ai_settings/
        └── assistant_preferences (fields: tone, reminderMinutes, preferredModel)
```

No alterations to existing `jobs`, `applications`, `profiles`, or `oauth_tokens` collections are required. Full backward compatibility is preserved.

---

## 22. API Endpoint Specifications

All endpoints mounted under `/api/v1/assistant` in `apps/api/app/api/v1/assistant.py`:

### 1. `POST /api/v1/assistant/chat`
- **Description:** Submit user message with active context and receive assistant response or staged actions.
- **Request Body:**
  ```json
  {
    "conversationId": "conv_123",
    "message": "Find Sarah's email and draft a follow up.",
    "context": {
      "activeRoute": "companies/scale-ai",
      "selectedCompanyKey": "scale-ai",
      "selectedContactId": "cont_sarah"
    }
  }
  ```
- **Response Body:**
  ```json
  {
    "conversationId": "conv_123",
    "messageId": "msg_456",
    "reply": "I've drafted a follow-up email to Sarah Chen. Please review the details below:",
    "stagedAction": {
      "ticket": "user1:send_gmail:a8f9c...:1793610000:7b4e...",
      "toolName": "send_gmail_message",
      "level": 3,
      "summary": "Send follow-up email to Sarah Chen (schen@scale.com)",
      "parameters": {
        "recipientEmail": "schen@scale.com",
        "subject": "Follow-up: Senior Frontend Engineer Role",
        "bodyText": "Hi Sarah,\n\nFollowing up on our discussion regarding the Senior Frontend Engineer position..."
      }
    }
  }
  ```

### 2. `POST /api/v1/assistant/approve-action`
- **Description:** Authorize and execute a staged Level 3 action using the signed approval ticket.
- **Request Body:**
  ```json
  {
    "ticket": "user1:send_gmail:a8f9c...:1793610000:7b4e...",
    "toolName": "send_gmail_message",
    "parameters": { ... }
  }
  ```
- **Response Body:**
  ```json
  {
    "status": "COMPLETED",
    "toolName": "send_gmail_message",
    "result": { "messageId": "18f9c2d7e", "sentAt": "2026-11-02T14:35:00Z" }
  }
  ```

### 3. `GET /api/v1/assistant/conversations`
- **Description:** List past chat conversations for the authenticated user.

### 4. `DELETE /api/v1/assistant/conversations/{id}`
- **Description:** Delete a conversation thread and its message history.

---

## 23. Error Handling and Recovery

| Error Condition | Handled Behavior | User Notification |
| :--- | :--- | :--- |
| **OAuth Token Expired & Revoked** | Caught as `GoogleReauthorizationRequiredError` | Surfaced as an inline card with direct 1-click "Reconnect Gmail" button. |
| **Model Rate Limit (HTTP 429)** | AI Hub automatic fallback hop to secondary provider (e.g. Groq) | Transparent recovery; telemetry logs fallback hop without crashing chat. |
| **Truth-Lock Violation** | `audit_truth_lock` detects unverified claim | Assistant explains: *"I couldn't include metric X because it's not verified in your Master Profile. Here is the truthful version:"* |
| **Tampered Approval Ticket** | HMAC verification failure in `permissions.py` | Rejection: *"Approval parameters have expired or been altered. Please re-stage the action."* |
| **Network Timeout During Send** | Handled with reconciliation check in `gmail_sending_service` | Marked as `SEND_STATUS_UNKNOWN` and reconciled before retry. |

---

## 24. Testing Strategy

### Backend Tests (`apps/api/tests/`)
- `test_assistant_permissions.py`: Unit test verifying that Level 1 executes without tickets, Level 2 stages previews, and Level 3 strictly blocks un-signed executions.
- `test_assistant_approval_tickets.py`: Cryptographic test validating ticket expiration, nonce validation, parameter tampering rejection, and user binding.
- `test_assistant_context_hydration.py`: Tests verifying that active opportunity and company IDs correctly populate context.
- `test_assistant_gmail_tools.py`: Mocked HTTP tests for Gmail search, thread fetch, and draft creation.
- `test_assistant_calendar_tools.py`: Mocked tests for event querying, conflict checks, and event creation.
- `test_assistant_drive_tools.py`: Mocked tests for file search, folder creation, and PDF upload.

### Frontend Tests (`apps/web/src/`)
- `AssistantDrawer.test.tsx`: Tests opening/closing the drawer, keyboard shortcut `Cmd+J`, and rendering message history.
- `ActionApprovalCard.test.tsx`: Tests rendering approval cards and invoking the `/approve-action` API on click.
- `ContextPillBar.test.tsx`: Tests accurate chip rendering based on active window hash.

---

## 25. Performance and Scalability Considerations

- **Prompt Optimization:** Use concise system instructions and structured tool definitions. System instruction size is budgeted under 1,200 tokens.
- **Message Truncation:** Load only the last 10 messages of history into the active LLM context window. Earlier history is preserved in Firestore but omitted from prompt turns.
- **Connection Reuse:** HTTP client connections to Google APIs are pooled using `httpx.AsyncClient`.
- **Zero Polling When Inactive:** The assistant drawer maintains zero active WebSocket or background HTTP connections when closed.

---

## 26. Implementation Phases

```
+-----------------------------------------------------------------------------------+
| PHASE 1: FOUNDATION                                                               |
| Native UI Drawer, Conversation Store, AI Hub Router Task, Internal Read Tools     |
+-----------------------------------------------------------------------------------+
                                          │
+-----------------------------------------v-----------------------------------------+
| PHASE 2: GMAIL TOOLS                                                              |
| Email Search, Thread Inspection, Truth-Locked Drafts, Approval-Gated Sending      |
+-----------------------------------------------------------------------------------+
                                          │
+-----------------------------------------v-----------------------------------------+
| PHASE 3: GOOGLE CALENDAR TOOLS                                                    |
| Interview Retrieval, Conflict Detection, Staged Event Scheduling                  |
+-----------------------------------------------------------------------------------+
                                          │
+-----------------------------------------v-----------------------------------------+
| PHASE 4: GOOGLE DRIVE TOOLS                                                       |
| Resume Artifact Search, Folder Setup, Tailored PDF Uploads                        |
+-----------------------------------------------------------------------------------+
                                          │
+-----------------------------------------v-----------------------------------------+
| PHASE 5: CROSS-SERVICE MULTI-STEP WORKFLOWS                                       |
| Chained Actions: JobFinder + Gmail + Calendar + Drive                             |
+-----------------------------------------------------------------------------------+
                                          │
+-----------------------------------------v-----------------------------------------+
| PHASE 6: ADVANCED CAPABILITIES & PREFERENCES                                      |
| Assistant Memory, User Habits, Proactive Follow-up Summaries                      |
+-----------------------------------------------------------------------------------+
```

### Detailed Phase Specifications

#### Phase 1 — Foundation
- **Objectives:** Establish the native UI drawer in `TopHeader.tsx`, Firestore conversation persistence, AI Hub task routing, active context harvester, and read-only internal JobFinder tools (`search_jobs`, `get_application_status`, `get_candidate_profile_facts`).
- **Files Modified:** `apps/web/src/components/layout/TopHeader.tsx`, `apps/web/src/App.tsx`, `apps/api/app/ai/hub/types.py`, `apps/api/app/ai/hub/task_key_normalizer.py`, `apps/api/app/api/v1/router.py`.
- **Files Created:** `apps/web/src/components/assistant/*`, `apps/api/app/ai/assistant/*`, `apps/api/app/api/v1/assistant.py`, `apps/api/app/db/repositories/conversation_repo.py`.
- **Exit Criteria:** User can open the drawer with `Cmd+J`, ask *"What are my top recommended jobs?"* or *"What skills are verified in my profile?"*, and receive an accurate, grounded reply.

#### Phase 2 — Gmail Tools
- **Objectives:** Implement Gmail search, thread inspection, draft generation, and approval-based sending.
- **Files Created:** `apps/api/app/services/gmail_tool_service.py`, `apps/api/app/ai/assistant/tools/gmail_tools.py`.
- **Exit Criteria:** User can instruct *"Search my Gmail for messages from recruiters"* and *"Draft a follow-up to Sarah Chen"*, review the drafted email in the UI card, and click "Approve & Send" to dispatch the email.

#### Phase 3 — Google Calendar Tools
- **Objectives:** Implement upcoming event query, interview detection, conflict checking, and approval-based event creation.
- **Files Created:** `apps/api/app/services/calendar_tool_service.py`, `apps/api/app/ai/assistant/tools/calendar_tools.py`.
- **Exit Criteria:** User can ask *"Do I have any interviews scheduled this week?"* and *"Schedule 45 min interview prep tomorrow at 2 PM"*, and confirm the event.

#### Phase 4 — Google Drive Tools
- **Objectives:** Implement Drive document search, directory creation, and tailored resume uploading.
- **Files Created:** `apps/api/app/services/drive_tool_service.py`, `apps/api/app/ai/assistant/tools/drive_tools.py`.
- **Exit Criteria:** User can instruct *"Save the tailored resume for Scale AI to my Google Drive"*, verify the staged upload, and view the saved file link.

#### Phase 5 — Cross-Service Workflows
- **Objectives:** Chain multi-step workflows across JobFinder, Gmail, Calendar, and Drive.
- **Exit Criteria:** A single instruction such as *"I just received an email from Stripe offering an interview. Review my application notes, prepare a calendar block for Friday at 10 AM, and draft an acceptance reply"* executes smoothly with interactive approval cards.

#### Phase 6 — Advanced Capabilities
- **Objectives:** Assistant memory, persistent user preferences, and proactive daily briefing summaries on the Dashboard.
- **Exit Criteria:** Assistant respects user-defined preferences and suggests follow-ups based on days elapsed since last recruiter contact.

---

## 27. Dependencies and Prerequisites

1. Existing Google OAuth web application credentials (`GOOGLE_GMAIL_CLIENT_ID`, `GOOGLE_CALENDAR_CLIENT_ID`, `GOOGLE_DRIVE_CLIENT_ID`) configured in `.env`.
2. Existing `OAUTH_ENCRYPTION_SECRET` configured in `.env`.
3. Existing AI Provider credentials configured in the AI/API Hub (`users/{userId}/ai_credentials`).
4. Working-tree checkpoint commit `decae24` pushed and verified on `origin/main`.
5. Global GSD Core v1.19.0 framework installed and validated for Antigravity CLI.

---

## 28. Risks and Mitigation

| Risk | Impact | Mitigation |
| :--- | :--- | :--- |
| **Accidental Email Transmission** | High | Strict Level 3 enforcement: Backend rejects execution unless a valid, parameter-bound approval ticket is presented. |
| **LLM Fabricates Facts** | High | Truth-Lock grounding: Prompts strictly forbid ungrounded claims; drafts are audited via `audit_truth_lock`. |
| **Exceeding Free Tier Quotas** | Medium | AI Hub enforces `CostPolicy.FREE_ONLY` by default; rate limiters and cooldown trackers avoid quota spikes. |
| **UI Resizing Main App Layout** | Low | Slide-over drawer uses `fixed` positioning, completely floating over the main view without layout reflow. |

---

## 29. Acceptance Criteria

1. **Architecture & Scope Preservation:**
   - Zero modifications to existing OAuth connection flows or encryption algorithms.
   - AI Hub reused as the sole model provider interface.
   - Zero additions of external paid queues (Redis/Celery) or vector databases.
2. **Security & Permissions:**
   - 100% of Level 3 external actions require signed user approval.
   - All tool calls scoped strictly to the authenticated `user_id`.
   - Zero raw OAuth tokens exposed to the LLM or frontend client.
3. **Conversational Quality & Accuracy:**
   - The assistant correctly resolves active view context (e.g. "this company", "this job").
   - Truth-Lock prevents any fabrication of candidate qualifications.
4. **Code Quality & Testing:**
   - Backend tests pass with 100% coverage on permission checks and approval tickets.
   - Frontend tests pass for drawer toggling and approval interactions.

---

## 30. Final Recommended Implementation Sequence

1. **User Approval:** Present this implementation plan and wait for explicit user approval.
2. **Execute Phase 1 (Foundation):**
   - Step 1.1: Create Firestore conversation repository (`conversation_repo.py`).
   - Step 1.2: Register `JOBFINDER_ASSISTANT_CHAT` task in AI Hub.
   - Step 1.3: Create permission system and tool registry in backend.
   - Step 1.4: Implement `/api/v1/assistant` endpoints.
   - Step 1.5: Build `AssistantDrawer.tsx` and integrate trigger button in `TopHeader.tsx`.
   - Step 1.6: Run tests and verify basic chat & internal tool responses.
3. **Execute Phase 2 (Gmail):** Implement Gmail search, draft preparation, and approval-based sending.
4. **Execute Phase 3 (Google Calendar):** Implement event retrieval and interview scheduling.
5. **Execute Phase 4 (Google Drive):** Implement resume uploading and file organization.
6. **Execute Phase 5 & 6 (Workflows & Polish):** Multi-service chaining, assistant preferences, and final delivery.

