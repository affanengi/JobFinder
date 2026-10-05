import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ScannerPage } from "./ScannerPage";
import { AuthProvider } from "../context/AuthContext";

// Mock api
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
      summary: "Experienced Senior Backend Engineer proficient in Python, FastAPI, and PostgreSQL on AWS.",
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
      projects: [
        {
          name: "Cloud Autoscaler",
          technologies: ["Python", "Kubernetes", "AWS"],
          bullets: ["Built automated autoscaling pipeline across 50 Kubernetes nodes."]
        }
      ],
      skills: [
        {
          category: "Languages",
          items: ["Python", "SQL"]
        }
      ],
      education: [
        {
          degree: "B.S. in Computer Science",
          institution: "MIT",
          year: "2020",
          grade: "GPA 3.9"
        }
      ]
    },
    validationResult: { truth_score: 95, is_valid: true, violations: [] },
    latexCode: "% LaTeX Source",
    createdAt: "2026-09-01T12:00:00Z",
    updatedAt: "2026-09-01T12:00:00Z"
  }
];

const mockJobs = [
  {
    id: "job_123",
    title: "Senior Backend Engineer",
    company: "Google",
    description: "Looking for a Python, FastAPI, and AWS engineer."
  }
];

const mockScanResult = {
  overall_score: 88,
  grade: "A",
  summary: "Strong ATS Candidate. Passes most automated parsers easily.",
  category_scores: {
    parseability: {
      name: "ATS Parseability & Format",
      score: 24,
      max_score: 25,
      percentage: 96,
      status: "pass",
      summary: "Clean sections and format.",
      checks: [
        { name: "Standard Section Headers", passed: true, score: 8, max_score: 8, detail: "All standard sections detected." }
      ]
    },
    keyword_match: {
      name: "Technical Keyword & Competency Alignment",
      score: 26,
      max_score: 30,
      percentage: 86.7,
      status: "pass",
      summary: "Matched key requirements.",
      checks: [
        { name: "Core Technical Skills Match", passed: true, score: 14, max_score: 16, detail: "Matched 5 core skills." }
      ]
    },
    impact_verbs: {
      name: "Impact, Action Verbs & Quantified Metrics",
      score: 22,
      max_score: 25,
      percentage: 88,
      status: "pass",
      summary: "Strong action verbs and metrics.",
      checks: [
        { name: "Strong Action Verb Openers", passed: true, score: 10, max_score: 10, detail: "100% action verbs." }
      ]
    },
    structural_integrity: {
      name: "Structural Integrity & Content Density",
      score: 16,
      max_score: 20,
      percentage: 80,
      status: "pass",
      summary: "Good depth.",
      checks: [
        { name: "Professional Summary Depth", passed: true, score: 5, max_score: 5, detail: "Dense summary." }
      ]
    }
  },
  keyword_matrix: {
    matched: [
      { id: "python", name: "Python", category: "programming_languages", importance: "High", status: "matched" },
      { id: "fastapi", name: "FastAPI", category: "frameworks_libraries", importance: "High", status: "matched" }
    ],
    missing: [],
    transferable: [
      { id: "docker", name: "Docker", category: "cloud_infrastructure", importance: "Bonus", status: "transferable" }
    ],
    match_percentage: 100,
    total_jd_keywords: 2,
    matched_count: 2,
    missing_count: 0,
    transferable_count: 1
  },
  bullet_audits: [
    {
      id: "exp_0_0",
      section: "Experience",
      role_or_project: "Senior Software Engineer at Tech Corp",
      text: "Architected distributed microservices in FastAPI reducing p99 latency by 45%.",
      score: 100,
      status: "strong",
      has_action_verb: true,
      has_metric: true,
      has_weak_opener: false,
      verb: "architected",
      word_count: 10,
      issues: []
    }
  ],
  actionable_checklist: [
    {
      id: "chk_passed_section_headers",
      priority: "low",
      category: "Passed Checks",
      title: "Standard Section Headers",
      description: "All standard sections detected.",
      passed: true,
      impact_points: 0
    }
  ],
  metadata: {
    resume_id: "res_abc_1",
    job_id: "job_123",
    source_type: "tailored_resume",
    file_name: "Senior Backend Engineer.pdf",
    page_count: 1,
    word_count: 420,
    estimated_read_time: "45 sec",
    taxonomy_version: "1.0.0"
  }
};

const mockSavedReport = {
  id: "rep_xyz_1",
  userId: "user_default",
  reportName: "Google - Senior Backend Engineer (ATS Scan)",
  targetRole: "Senior Backend Engineer",
  company: "Google",
  sourceType: "tailored_resume",
  fileName: "Senior Backend Engineer.pdf",
  overallScore: 88,
  grade: "A",
  scanResult: mockScanResult,
  createdAt: "2026-09-01T12:00:00Z",
  updatedAt: "2026-09-01T12:00:00Z"
};

describe("ScannerPage ATS Evaluation Suite", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (fetchWithAuth as any).mockImplementation((url: string, opts?: any) => {
      if (url === "/api/v1/resumes") {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(mockResumes) });
      }
      if (url.startsWith("/api/v1/resumes/") && opts?.method === "PUT") {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            ...mockResumes[0],
            structuredContent: JSON.parse(opts.body)
          })
        });
      }
      if (url === "/api/v1/jobs/recommendations") {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(mockJobs) });
      }
      if (url === "/api/v1/scanner/reports" && (!opts?.method || opts.method === "GET")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve([mockSavedReport]) });
      }
      if (url === "/api/v1/scanner/reports" && opts?.method === "POST") {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(mockSavedReport) });
      }
      if (url === "/api/v1/scanner/scan-tailored") {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(mockScanResult) });
      }
      if (url === "/api/v1/scanner/scan-file") {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({
          ...mockScanResult,
          metadata: { ...mockScanResult.metadata, source_type: "ephemeral_upload", file_name: "friend_resume.pdf" }
        }) });
      }
      if (url === "/api/v1/scanner/bulk-ai-bullet-rewrite") {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            set_a: [
              {
                bullet_id: "exp_0_0",
                text: "Architected distributed microservices in FastAPI reducing p99 latency by 45%.",
                style: "Action & Verified Impact",
                has_action_verb: true,
                has_metric: true,
                rationale: "Strong verified impact.",
                is_valid: true,
                validation_issues: []
              }
            ],
            set_b: [
              {
                bullet_id: "exp_0_0",
                text: "Engineered asynchronous FastAPI microservices to handle high-throughput workloads.",
                style: "Architecture & Systems Depth",
                has_action_verb: true,
                has_metric: false,
                rationale: "Technical architecture depth.",
                is_valid: true,
                validation_issues: []
              }
            ],
            total_processed: 1,
            validation_passed: true
          })
        });
      }
      return Promise.resolve({ ok: false, json: () => Promise.resolve({}) });
    });
  });

  it("renders scanner page header and configuration targets", async () => {
    render(
      <AuthProvider>
        <ScannerPage />
      </AuthProvider>
    );

    expect(screen.getByText("ATS Resume Scanner & Keyword Match")).toBeInTheDocument();
    expect(screen.getByText("Live ATS Scanner")).toBeInTheDocument();
    expect(screen.getByText("Scan Target Source")).toBeInTheDocument();
    expect(screen.getByText("Saved Tailored Resume")).toBeInTheDocument();
    expect(screen.getByText(/Upload Any Resume/i)).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Run 100-Point ATS Scan/i })).toBeInTheDocument();
    });
  });

  it("executes ATS scan, displays hero score, and handles save report button", async () => {
    render(
      <AuthProvider>
        <ScannerPage initialResumeId="res_abc_1" />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByText("88")).toBeInTheDocument();
      expect(screen.getByText("Grade A")).toBeInTheDocument();
      expect(screen.getByText("ATS Parseability & Format")).toBeInTheDocument();
      expect(screen.getByText("Technical Keyword & Competency Alignment")).toBeInTheDocument();
      expect(screen.getByText("Architected distributed microservices in FastAPI reducing p99 latency by 45%.")).toBeInTheDocument();
    });

    const saveBtn = screen.getByRole("button", { name: /Save ATS Report/i });
    expect(saveBtn).toBeInTheDocument();
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(screen.getByText(/Report saved to Firestore/i)).toBeInTheDocument();
    });
  });

  it("allows switching to Ephemeral Upload tab and maintains isolated state", async () => {
    render(
      <AuthProvider>
        <ScannerPage />
      </AuthProvider>
    );

    const uploadTabBtn = screen.getByText(/Upload Any Resume/i);
    fireEvent.click(uploadTabBtn);

    expect(screen.getByText(/100% In-Memory Ephemeral Scan/i)).toBeInTheDocument();
    expect(screen.getByText(/Click or Drag & Drop Resume/i)).toBeInTheDocument();
  });

  it("switches to Saved Reports hub tab and displays saved snapshots", async () => {
    render(
      <AuthProvider>
        <ScannerPage />
      </AuthProvider>
    );

    const savedReportsTab = await screen.findByText(/Saved Reports/i);
    fireEvent.click(savedReportsTab);

    await waitFor(() => {
      expect(screen.getByText("Historical ATS Scan Reports")).toBeInTheDocument();
      expect(screen.getByText("Google - Senior Backend Engineer (ATS Scan)")).toBeInTheDocument();
    });
  });

  it("selects bullets, opens modal, and applies selected to resume with direct recompile ($0 AI cost)", async () => {
    render(
      <AuthProvider>
        <ScannerPage initialResumeId="res_abc_1" />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByText("Architected distributed microservices in FastAPI reducing p99 latency by 45%.")).toBeInTheDocument();
    });

    const selectAllBtn = screen.getByRole("button", { name: /Select All/i });
    fireEvent.click(selectAllBtn);

    const optimizeBtn = screen.getByRole("button", { name: /Optimize Selected \(1\) with AI/i });
    expect(optimizeBtn).toBeInTheDocument();
    fireEvent.click(optimizeBtn);

    await waitFor(() => {
      expect(screen.getByText(/Mix & Match AI Optimized Bullets/i)).toBeInTheDocument();
      expect(screen.getByText(/Set A: Action & Impact/i)).toBeInTheDocument();
      expect(screen.getByText(/Set B: Architecture Depth/i)).toBeInTheDocument();
    });

    const applyBtn = screen.getByRole("button", { name: /Apply to Resume & Recompile/i });
    expect(applyBtn).toBeInTheDocument();
    fireEvent.click(applyBtn);

    await waitFor(() => {
      expect(screen.getByText(/Applied optimized bullets and recompiled PDF locally/i)).toBeInTheDocument();
    });
  });
});
