# 🎯 Personal AI Job Agent (`jobFinder`)

> A **Human-in-the-Loop Career Operating System** that discovers high-fit jobs, calculates transparent match scores, crafts truthful ATS-tailored resumes, and prepares browser applications with zero hallucination and $0 infrastructure cost.

---

## 🌟 Core Principles

1. **Absolute Truthfulness**: Never fabricates skills, experience, or metrics. Every claim in tailored resumes is strictly audited against your verified master profile facts.
2. **Human in Control**: The AI handles repetitive discovery, matching, resume generation, and form pre-filling, but **you** explicitly review and make the final submission.
3. **100% Free Stack ($0)**: Designed around Google Gemini free tier, Firebase Spark plan, and local Playwright automation.
4. **Soft Minimalism**: A calm, tactile, Notion/Linear-inspired interface designed for clarity and trust.

---

## 🏗️ Repository Architecture

```text
jobFinder/
├── apps/
│   ├── api/                  # FastAPI backend (Python 3.11+, uv, Pydantic v2)
│   │   ├── app/
│   │   │   ├── api/v1/       # API endpoints (health, profile, jobs, etc.)
│   │   │   ├── core/         # Config, logging, security
│   │   │   ├── ai/           # Gemini provider abstraction
│   │   │   ├── memory/       # Firestore memory layer
│   │   │   ├── jobs/         # Ingestion, normalization, hybrid matching
│   │   │   ├── resume/       # Truth-audited ATS resume engine
│   │   │   └── applications/ # Playwright assisted application engine
│   │   └── tests/            # pytest unit & integration tests
│   │
│   └── web/                  # React 18 + Vite + TypeScript + Tailwind CSS
│       ├── src/
│       │   ├── components/   # Soft minimalism UI components
│       │   ├── pages/        # Dashboard, Opportunities, Resumes, Memory, etc.
│       │   └── index.css     # Design tokens & color system
│       └── tests/            # Vitest component tests
│
├── docs/                     # Specifications (PRD, Architecture, Schema, Rules)
├── .github/workflows/ci.yml  # GitHub Actions CI pipeline
├── .env.example              # Environment variables template
└── TODO.md                   # 25-step execution roadmap
```

---

## 🚀 Quick Start (Local Development)

### 1. Prerequisites
- **Python 3.11+**
- **Node.js 18+** & **npm**
- **uv** (recommended for ultra-fast Python package management)

### 2. Backend Setup (`apps/api`)
```bash
cd apps/api
# Create virtual environment & install dependencies
python3 -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
# Or with uv:
# uv venv && uv pip install -e ".[dev]"

# Copy environment variables
cp ../../.env.example .env

# Run FastAPI server
uvicorn app.main:app --reload --port 8000
```
Backend will be live at `http://localhost:8000` (API Docs: `http://localhost:8000/docs`).

### 3. Frontend Setup (`apps/web`)
```bash
cd apps/web
npm install
npm run dev
```
Frontend will be live at `http://localhost:5173`.

---

## 🧪 Testing & Code Quality

### Backend
```bash
cd apps/api
pytest                  # Run unit tests
ruff check .            # Linting
ruff format --check .   # Formatting
mypy app tests          # Static typing
```

### Frontend
```bash
cd apps/web
npm run test            # Run Vitest tests
npm run lint            # ESLint checks
npx tsc --noEmit        # TypeScript typecheck
```

---
