import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ScannerPage } from "./ScannerPage";
import { AuthProvider, mockTestUser } from "../context/AuthContext";
import { AtsScanResponse } from "../types/scanner";

// Mock API client
vi.mock("../lib/api", () => ({
  fetchWithAuth: vi.fn(),
}));

import { fetchWithAuth } from "../lib/api";

const mockResumes = [
  {
    id: "res_abc_1",
    userId: "user_default",
    jobId: "job_123",
    jobTitle: "Senior Backend Engineer",
    jobCompany: "Google",
    structuredContent: {
      personal: { fullName: "Jane Doe", email: "jane@google.com", phone: "+1 555-0100" },
      summary: "Senior Backend Engineer with 6+ years designing scalable microservices.",
      experience: [
        {
          title: "Senior Software Engineer",
          company: "Tech Corp",
          bullets: [
            "Architected distributed microservices in FastAPI reducing p99 latency by 45%.",
            "Optimized database indexing across PostgreSQL clusters saving $50K annually."
          ]
        }
      ],
      projects: [],
      skills: [{ category: "Languages", items: ["Python", "SQL"] }],
      education: []
    },
    validationResult: { truth_score: 95, is_valid: true, violations: [] },
    createdAt: "2026-09-01T12:00:00Z",
    updatedAt: "2026-09-01T12:00:00Z"
  }
];

const mockJobs = [
  {
    id: "job_123",
    title: "Senior Backend Engineer",
    company: "Google",
    description: "Looking for an engineer experienced with Python, FastAPI, and Kubernetes."
  }
];

const mockAiScanResponse: AtsScanResponse = {
  analysis: {
    overall_score: 91,
    executive_summary: "Exceptional candidate match with strong evidence of distributed systems design.",
    overall_explanation: "Candidate provides verified production experience with Python and FastAPI, surpassing role requirements.",
    strengths: [
      "Demonstrated latency reduction in high-throughput microservices",
      "Direct PostgreSQL cluster optimization"
    ],
    gaps: [
      "No direct mention of Kubernetes orchestration in experience section"
    ],
    recommendations: [
      "Add Kubernetes cluster orchestration details if candidate possesses experience."
    ],
    requirements: [
      {
        requirement_description: "Python and FastAPI REST API architecture",
        criticality: "mandatory",
        match_status: "MEETS",
        supporting_evidence: [
          "Architected distributed microservices in FastAPI reducing p99 latency by 45%"
        ],
        explanation: "Direct hands-on experience reducing p99 latency by 45% in production.",
        missing_evidence: false
      },
      {
        requirement_description: "Kubernetes container orchestration",
        criticality: "preferred",
        match_status: "MISSING",
        supporting_evidence: [],
        explanation: "No production deployment of Kubernetes clusters documented in resume.",
        missing_evidence: true
      }
    ],
    section_analysis: [
      {
        section_name: "Experience",
        findings: ["High metric density and strong action verbs."],
        supporting_evidence: ["Architected distributed microservices in FastAPI reducing p99 latency by 45%."],
        gaps: ["No direct orchestrator mentions."],
        recommendations: ["Highlight container orchestrators used alongside FastAPI."]
      }
    ],
    keyword_analysis: [
      {
        keyword: "FastAPI",
        status: "present_and_relevant",
        explanation: "Microservices latency optimization",
        supporting_evidence: "Architected distributed microservices in FastAPI"
      },
      {
        keyword: "Kubernetes",
        status: "not_found",
        explanation: "Container cluster orchestration",
        supporting_evidence: null
      }
    ],
    rewrite_proposals: [
      {
        original_text: "Optimized database indexing across PostgreSQL clusters saving $50K annually.",
        proposed_text: "Led database query & indexing optimization across multi-region PostgreSQL clusters, reducing cloud storage overhead and saving $50K annually.",
        factual_basis: "Backed by candidate's PostgreSQL optimization project.",
        explanation: "Emphasizes distributed architecture scope without fabricating facts.",
        validation_status: "pending_review"
      }
    ]
  },
  audit_report: {
    is_valid: true,
    status: "review_required",
    total_checks: 18,
    passed_checks: 17,
    blocking_violations_count: 0,
    advisory_warnings_count: 1,
    findings: [
      {
        target_type: "rewrite_proposal",
        target_identifier: "PostgreSQL rewrite",
        status: "review_required",
        severity: "advisory",
        evidence_source: "resume",
        cited_text: "multi-region PostgreSQL clusters",
        reason: "PostgreSQL rewrite mentions multi-region clusters; verify if production deployment was multi-region.",
        is_blocking: false
      }
    ],
    original_ai_score: 91,
    summary: "Truth-Lock passed 17/18 checks with 1 advisory item recommended for candidate review.",
    audited_at: "2026-10-24T18:00:00Z"
  },
  provenance: {
    scoring_version: "v2_ai_first",
    provider_used: "gemini",
    model_used: "gemini-1.5-flash",
    credential_id_used: "server_gemini_credential",
    latency_ms: 120.0,
    timestamp: "2026-10-24T18:00:00Z",
    tenant_isolated: true,
    truth_lock_passed: true
  }
};

describe("ScannerPage Phase 6 AI-First Integration Suite", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const setupDefaultMocks = (scanResp: AtsScanResponse = mockAiScanResponse) => {
    (fetchWithAuth as any).mockImplementation((url: string, opts?: any) => {
      if (url === "/api/v1/resumes") {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(mockResumes) });
      }
      if (url === "/api/v1/jobs/recommendations") {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(mockJobs) });
      }
      if (url === "/api/v1/scanner/reports") {
        return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
      }
      if (url === "/api/v1/scanner/scan") {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(scanResp) });
      }
      if (url.startsWith("/api/v1/resumes/") && opts?.method === "PUT") {
        const body = JSON.parse(opts.body);
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ ...mockResumes[0], structuredContent: body })
        });
      }
      return Promise.resolve({ ok: false, json: () => Promise.resolve({}) });
    });
  };

  const renderScanner = (user: any = mockTestUser, initialResumeId: string = "res_abc_1") =>
    render(
      <AuthProvider initialUser={user}>
        <ScannerPage initialResumeId={initialResumeId} />
      </AuthProvider>
    );

  it("calls modernized POST /api/v1/scanner/scan and renders AI score without recomputation", async () => {
    setupDefaultMocks();
    renderScanner();

    // Verify AI contextual score (91) is displayed
    await waitFor(() => {
      expect(screen.getByText("91")).toBeInTheDocument();
      expect(screen.getByText(/Grade A/i)).toBeInTheDocument();
    });

    // Verify provenance metadata chip is rendered
    expect(screen.getByText(/v2_ai_first/i)).toBeInTheDocument();
    expect(screen.getByText(/gemini-1.5-flash/i)).toBeInTheDocument();

    // Verify AI explanation is rendered
    expect(
      screen.getByText(/Candidate provides verified production experience with Python and FastAPI/i)
    ).toBeInTheDocument();

    // Verify API request payload
    expect(fetchWithAuth).toHaveBeenCalledWith("/api/v1/scanner/scan", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({
        resume_id: "res_abc_1",
        job_id: "job_123",
        save_report: false,
      }),
    }));
  });

  it("renders Truth-Lock audit report badge, checks count, and review-required findings", async () => {
    setupDefaultMocks();
    renderScanner();

    // Verify Truth-Lock Audit Panel is present
    await waitFor(() => {
      expect(screen.getByTestId("truth-lock-audit-panel")).toBeInTheDocument();
      expect(screen.getByText(/Human Review Required/i)).toBeInTheDocument();
      expect(screen.getByText(/17 \/ 18 checks passed/i)).toBeInTheDocument();
    });

    // Expand audit panel to inspect findings
    const inspectBtn = screen.getByRole("button", { name: /Inspect Evidence Audit/i });
    fireEvent.click(inspectBtn);

    // Check specific finding quote and text
    expect(
      screen.getByText(/PostgreSQL rewrite mentions multi-region clusters/i)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/multi-region PostgreSQL clusters/i)
    ).toBeInTheDocument();
  });

  it("renders Job Match Explorer in ATS Studio with AI-first requirements and evidence quotations", async () => {
    setupDefaultMocks();
    renderScanner();

    await waitFor(() => {
      expect(screen.getByText("91")).toBeInTheDocument();
    });

    // Open ATS Studio
    const openStudioBtn = screen.getByTestId("open-ats-studio-btn");
    fireEvent.click(openStudioBtn);

    await waitFor(() => {
      expect(screen.getByTestId("ats-studio-modal")).toBeInTheDocument();
      expect(screen.getByTestId("job-match-explorer-view")).toBeInTheDocument();
      expect(screen.getByText("Python and FastAPI REST API architecture")).toBeInTheDocument();
      expect(screen.getByText("Kubernetes container orchestration")).toBeInTheDocument();
      expect(
        screen.getByText(/Architected distributed microservices in FastAPI reducing p99 latency by 45%/i)
      ).toBeInTheDocument();
    });
  });

  it("renders Section Analysis and Contextual Keywords workspaces in ATS Studio", async () => {
    setupDefaultMocks();
    renderScanner();

    await waitFor(() => {
      expect(screen.getByText("91")).toBeInTheDocument();
    });

    // Open ATS Studio
    const openStudioBtn = screen.getByTestId("open-ats-studio-btn");
    fireEvent.click(openStudioBtn);

    await waitFor(() => {
      expect(screen.getByTestId("ats-studio-modal")).toBeInTheDocument();
    });

    // Switch to Resume Evidence tab
    const evidenceTab = screen.getByRole("tab", { name: /Resume Evidence/i });
    fireEvent.click(evidenceTab);

    await waitFor(() => {
      expect(screen.getByTestId("resume-evidence-view")).toBeInTheDocument();
      expect(screen.getByText("Experience")).toBeInTheDocument();
      expect(screen.getByText("High metric density and strong action verbs.")).toBeInTheDocument();
    });

    // Switch to Keywords tab
    const keywordsTab = screen.getByRole("tab", { name: /Keyword Matrix/i });
    fireEvent.click(keywordsTab);

    await waitFor(() => {
      expect(screen.getByTestId("keyword-explorer-view")).toBeInTheDocument();
      expect(screen.getAllByText("FastAPI").length).toBeGreaterThan(0);
      expect(screen.getByText("Microservices latency optimization")).toBeInTheDocument();
    });
  });

  it("requires explicit user approval before applying rewrite proposals to Resume Studio", async () => {
    setupDefaultMocks();
    renderScanner();

    await waitFor(() => {
      expect(screen.getByText("91")).toBeInTheDocument();
    });

    // Open ATS Studio
    const openStudioBtn = screen.getByTestId("open-ats-studio-btn");
    fireEvent.click(openStudioBtn);

    await waitFor(() => {
      expect(screen.getByTestId("ats-studio-modal")).toBeInTheDocument();
    });

    // Switch to Rewrites & Audit tab
    const rewritesTab = screen.getByRole("tab", { name: /Rewrites & Audit/i });
    fireEvent.click(rewritesTab);

    await waitFor(() => {
      expect(screen.getByTestId("rewrites-audit-view")).toBeInTheDocument();
      expect(screen.getByText(/multi-region PostgreSQL clusters/i)).toBeInTheDocument();
    });

    // Click Apply Proposal in Rewrites & Audit
    const applyBtn = screen.getByRole("button", { name: /Approve & Update Resume/i });
    expect(applyBtn).toBeInTheDocument();
    fireEvent.click(applyBtn);

    // Verify PUT request to /api/v1/resumes/{id} with updated text
    await waitFor(() => {
      expect(fetchWithAuth).toHaveBeenCalledWith(
        "/api/v1/resumes/res_abc_1",
        expect.objectContaining({
          method: "PUT",
          headers: expect.objectContaining({ "Content-Type": "application/json" }),
          body: expect.stringContaining("multi-region PostgreSQL clusters"),
        })
      );
    });

    // Verify modal closes and Stale Result banner appears
    await waitFor(() => {
      expect(screen.queryByTestId("grounded-rewrite-modal")).not.toBeInTheDocument();
      expect(screen.getByTestId("stale-scan-banner")).toBeInTheDocument();
      expect(screen.getByText(/Resume Modified Since Last Scan/i)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /Re-scan Resume Now/i })).toBeInTheDocument();
    });
  });

  it("handles 429 quota exhaustion gracefully without exposing raw backend keys", async () => {
    (fetchWithAuth as any).mockImplementation((url: string) => {
      if (url === "/api/v1/resumes") {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(mockResumes) });
      }
      if (url === "/api/v1/jobs/recommendations") {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(mockJobs) });
      }
      if (url === "/api/v1/scanner/reports") {
        return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
      }
      if (url === "/api/v1/scanner/scan") {
        return Promise.resolve({
          ok: false,
          status: 429,
          json: () => Promise.resolve({ detail: "AI provider quota exhausted. Please try again in 1 minute." })
        });
      }
      if (url === "/api/v1/scanner/scan-tailored") {
        return Promise.resolve({
          ok: false,
          status: 429,
          json: () => Promise.resolve({ detail: "AI provider quota exhausted. Please try again in 1 minute." })
        });
      }
      return Promise.resolve({ ok: false, json: () => Promise.resolve({}) });
    });

    renderScanner();

    // Verify error is displayed to user cleanly
    await waitFor(() => {
      expect(
        screen.getByText(/AI provider quota exhausted. Please try again in 1 minute./i)
      ).toBeInTheDocument();
    });

    // Verify sensitive secrets/keys are NOT leaked
    expect(screen.queryByText(/AIza/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/AQ\./i)).not.toBeInTheDocument();
  });
});
