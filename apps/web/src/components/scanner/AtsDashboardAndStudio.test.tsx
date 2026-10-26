import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { AtsDashboard } from "./AtsDashboard";
import { AtsStudioModal } from "./AtsStudioModal";
import { JobMatchExplorerView } from "./studio/JobMatchExplorerView";
import { ResumeEvidenceView } from "./studio/ResumeEvidenceView";
import { KeywordExplorerView } from "./studio/KeywordExplorerView";
import { RewritesAuditView } from "./studio/RewritesAuditView";
import { OverviewScorecardView } from "./studio/OverviewScorecardView";
import { InteractiveBulletAnalysis } from "./InteractiveBulletAnalysis";
import {
  AtsAnalysisResult,
  AtsScanResponse,
  AtsScanResult,
  TruthLockAuditReport,
  ChecklistItem,
  BulletAuditItem,
} from "../../types/scanner";

const mockAnalysis: AtsAnalysisResult = {
  overall_score: 88,
  overall_explanation: "Candidate demonstrates strong background alignment with targeted position requirements.",
  executive_summary: "Candidate is a senior backend engineer with deep Python experience.",
  strengths: ["Strong microservices background", "Extensive PostgreSQL indexing expertise"],
  gaps: ["Lacks Kubernetes multi-cluster federation evidence"],
  recommendations: [
    "Highlight distributed caching architectures",
    "Detail production database migration procedures",
  ],
  requirements: [
    {
      requirement_description: "5+ years developing backend services in Python",
      criticality: "mandatory",
      match_status: "MEETS",
      supporting_evidence: ["Architected distributed microservices in FastAPI reducing latency by 45%."],
      explanation: "Extensive professional experience with Python.",
      missing_evidence: false,
    },
    {
      requirement_description: "Experience deploying to Kubernetes clusters",
      criticality: "preferred",
      match_status: "PARTIAL",
      supporting_evidence: [],
      explanation: "Some project mentions but lacks enterprise cluster scale details.",
      missing_evidence: true,
    },
  ],
  keyword_analysis: [
    {
      keyword: "FastAPI",
      status: "present_and_relevant",
      explanation: "Core framework",
      supporting_evidence: "Architected distributed microservices in FastAPI",
    },
    {
      keyword: "Docker",
      status: "not_found",
      explanation: "Missing containerization skills",
    },
  ],
  section_analysis: [
    {
      section_name: "Experience",
      findings: ["High density of measurable business outcomes."],
      supporting_evidence: ["Reduced latency by 45%"],
      gaps: [],
      recommendations: ["Specify exact cluster RPS if available."],
    },
  ],
  rewrite_proposals: [
    {
      original_text: "Architected microservices in FastAPI.",
      proposed_text: "Architected scalable microservices in FastAPI reducing latency by 45%.",
      explanation: "Quantifies the business impact with hard metrics.",
      factual_basis: "Internal APM telemetry reports verified by user",
      validation_status: "grounded",
    },
  ],
};

const mockAuditReport: TruthLockAuditReport = {
  is_valid: true,
  status: "pass",
  total_checks: 12,
  passed_checks: 12,
  blocking_violations_count: 0,
  advisory_warnings_count: 0,
  findings: [],
  original_ai_score: 88,
  summary: "All bullet claims corroborated by candidate source records.",
  audited_at: "2026-10-25T14:30:00Z",
};

const mockAiScanResponse: AtsScanResponse = {
  analysis: mockAnalysis,
  audit_report: mockAuditReport,
  provenance: {
    scoring_version: "v2_ai_first",
    operation_id: "op_test_123456",
    provider_used: "google_genai",
    model_used: "gemini-1.5-pro",
    credential_id_used: "cred_primary",
    latency_ms: 1200,
    timestamp: "2026-10-25T14:30:00Z",
    tenant_isolated: true,
    truth_lock_passed: true,
  },
};

const mockLegacyResult: AtsScanResult = {
  overall_score: 88,
  grade: "A",
  summary: "Strong profile fit.",
  category_scores: {},
  metadata: {
    source_type: "tailored_resume",
    page_count: 1,
    word_count: 350,
    estimated_read_time: "1 min",
    taxonomy_version: "2.0",
  },
  keyword_matrix: {
    matched: [],
    missing: [],
    transferable: [],
    match_percentage: 50,
    total_jd_keywords: 2,
    matched_count: 1,
    missing_count: 1,
    transferable_count: 0,
  },
  requirement_matches: [],
  bullet_audits: [],
  actionable_checklist: [
    {
      id: "check_1",
      priority: "high",
      category: "content",
      title: "Highlight distributed caching",
      description: "Mention cluster RPS",
      passed: false,
      impact_points: 5,
    },
  ],
};

describe("Workstream B: AtsDashboard Component", () => {
  it("renders authoritative score gauge without recalculation and displays grade", () => {
    const handleOpenStudio = vi.fn();
    const handleSave = vi.fn();

    render(
      <AtsDashboard
        aiScanResponse={mockAiScanResponse}
        activeScanResult={mockLegacyResult}
        onOpenStudio={handleOpenStudio}
        onSave={handleSave}
        onExport={vi.fn()}
        selectedJobTitle="Senior Backend Engineer"
        selectedJobCompany="Google"
      />
    );

    // Score gauge shows backend overall_score: 88
    expect(screen.getByText("88")).toBeInTheDocument();
    expect(screen.getByText("Grade A")).toBeInTheDocument();
    expect(screen.getByText("Verified Grounded (Zero Blocking Violations)")).toBeInTheDocument();

    // Metric coverage
    expect(screen.getByText("Mandatory Requirements")).toBeInTheDocument();
    expect(screen.getByText("100% (1/1)")).toBeInTheDocument(); // 1 of 1 mandatory fully met

    // Save Report button
    const saveReportBtn = screen.getByTestId("save-report-btn");
    expect(saveReportBtn).toBeInTheDocument();
    fireEvent.click(saveReportBtn);
    expect(handleSave).toHaveBeenCalledTimes(1);

    // Open Studio buttons
    const openStudioBtns = screen.getAllByRole("button", { name: /Open ATS Studio/i });
    expect(openStudioBtns.length).toBeGreaterThan(0);
    fireEvent.click(openStudioBtns[0]);
    expect(handleOpenStudio).toHaveBeenCalledWith("job_match");
  });

  it("handles empty or zero-denominator data safely", () => {
    const emptyAiResponse: AtsScanResponse = {
      analysis: {
        ...mockAnalysis,
        overall_score: 0,
        requirements: [],
        keyword_analysis: [],
        rewrite_proposals: [],
        section_analysis: [],
      },
      audit_report: mockAuditReport,
      provenance: {
        scoring_version: "v2_ai_first",
        operation_id: null,
        provider_used: "unknown",
        model_used: "none",
        credential_id_used: "none",
        latency_ms: 0,
        timestamp: "2026-10-25T14:30:00Z",
        tenant_isolated: true,
        truth_lock_passed: true,
      },
    };

    render(
      <AtsDashboard
        aiScanResponse={emptyAiResponse}
        activeScanResult={mockLegacyResult}
        onOpenStudio={vi.fn()}
        onSave={vi.fn()}
      />
    );

    // Score gauge shows 0 and unavailable coverage states display N/A honestly
    expect(screen.getAllByText("0").length).toBeGreaterThan(0);
    expect(screen.getAllByText("N/A").length).toBeGreaterThan(0);
  });
});

describe("Workstream C: AtsStudioModal Architecture", () => {
  it("renders modal with 5 workspace tabs and supports tab switching", () => {
    const handleClose = vi.fn();

    render(
      <AtsStudioModal
        isOpen={true}
        onClose={handleClose}
        initialTab="overview"
        analysis={mockAnalysis}
        auditReport={mockAuditReport}
        onApplyProposal={vi.fn()}
        jobTitle="Senior Backend Engineer"
        jobCompany="Google"
      />
    );

    // Modal title & header
    expect(screen.getByText("ATS Analysis Studio")).toBeInTheDocument();

    // 5 Workspace navigation tabs
    const overviewTab = screen.getByRole("tab", { name: /Scorecard & Overview/i });
    const matchTab = screen.getByRole("tab", { name: /Job Match Explorer/i });
    const evidenceTab = screen.getByRole("tab", { name: /Resume Evidence/i });
    const keywordsTab = screen.getByRole("tab", { name: /Keyword Matrix/i });
    const rewritesTab = screen.getByRole("tab", { name: /Rewrites & Audit/i });

    expect(overviewTab).toBeInTheDocument();
    expect(matchTab).toBeInTheDocument();
    expect(evidenceTab).toBeInTheDocument();
    expect(keywordsTab).toBeInTheDocument();
    expect(rewritesTab).toBeInTheDocument();

    // Initial tab content: Overview
    expect(screen.getByText("Authoritative AI Match Score")).toBeInTheDocument();
    expect(screen.getByText("Strong microservices background")).toBeInTheDocument();

    // Switch to Job Match tab
    fireEvent.click(matchTab);
    expect(screen.getByText("5+ years developing backend services in Python")).toBeInTheDocument();

    // Switch to Keywords tab
    fireEvent.click(keywordsTab);
    expect(screen.getByPlaceholderText("Search keywords, explanations, or quotes...")).toBeInTheDocument();

    // Switch to Rewrites tab
    fireEvent.click(rewritesTab);
    expect(screen.getByText("Architected microservices in FastAPI.")).toBeInTheDocument();

    // Switch to Resume Evidence tab
    fireEvent.click(evidenceTab);
    expect(screen.getAllByText("High density of measurable business outcomes.").length).toBeGreaterThan(0);

    // Close button
    const closeBtn = screen.getByRole("button", { name: /Close Studio/i });
    fireEvent.click(closeBtn);
    expect(handleClose).toHaveBeenCalled();
  });
});

describe("Workstream D: Studio Analysis Views", () => {
  it("JobMatchExplorerView filters requirements by search and criticality", () => {
    render(<JobMatchExplorerView requirements={mockAnalysis.requirements} />);

    expect(screen.getByText("5+ years developing backend services in Python")).toBeInTheDocument();
    expect(screen.getByText("Experience deploying to Kubernetes clusters")).toBeInTheDocument();

    // Filter by search query
    const searchInput = screen.getByPlaceholderText(/Search role requirements or candidate evidence/i);
    fireEvent.change(searchInput, { target: { value: "Kubernetes" } });

    expect(screen.queryByText("5+ years developing backend services in Python")).not.toBeInTheDocument();
    expect(screen.getByText("Experience deploying to Kubernetes clusters")).toBeInTheDocument();

    // Clear search and filter by Mandatory
    fireEvent.change(searchInput, { target: { value: "" } });
    const mandatoryPill = screen.getByRole("button", { name: /Mandatory \(1\)/i });
    fireEvent.click(mandatoryPill);

    expect(screen.getByText("5+ years developing backend services in Python")).toBeInTheDocument();
    expect(screen.queryByText("Experience deploying to Kubernetes clusters")).not.toBeInTheDocument();
  });

  it("KeywordExplorerView filters by search and status", () => {
    render(<KeywordExplorerView keywords={mockAnalysis.keyword_analysis} />);

    expect(screen.getByText("FastAPI")).toBeInTheDocument();
    expect(screen.getByText("Docker")).toBeInTheDocument();

    // Filter missing only
    const missingPill = screen.getByRole("button", { name: /Missing \(1\)/i });
    fireEvent.click(missingPill);

    expect(screen.queryByText("FastAPI")).not.toBeInTheDocument();
    expect(screen.getByText("Docker")).toBeInTheDocument();
  });

  it("ResumeEvidenceView renders sections and bullet evaluations", () => {
    render(<ResumeEvidenceView sections={mockAnalysis.section_analysis} />);
    expect(screen.getByText("Experience")).toBeInTheDocument();
    expect(screen.getAllByText("High density of measurable business outcomes.").length).toBeGreaterThan(0);
  });

  it("OverviewScorecardView renders score and 3-column qualitative insights", () => {
    render(
      <OverviewScorecardView
        overallScore={mockAnalysis.overall_score}
        overallExplanation={mockAnalysis.overall_explanation}
        executiveSummary={mockAnalysis.executive_summary}
        strengths={mockAnalysis.strengths}
        gaps={mockAnalysis.gaps}
        recommendations={mockAnalysis.recommendations}
      />
    );
    expect(screen.getByText("88")).toBeInTheDocument();
    expect(screen.getByText("Grade A")).toBeInTheDocument();
    expect(screen.getByText("Strong microservices background")).toBeInTheDocument();
    expect(screen.getByText("Lacks Kubernetes multi-cluster federation evidence")).toBeInTheDocument();
  });
});

describe("Workstream E: Rewrites & Audit Safeguards", () => {
  it("enforces explicit user approval and disables blocked proposals", () => {
    const handleApply = vi.fn();

    render(
      <RewritesAuditView
        proposals={mockAnalysis.rewrite_proposals}
        auditReport={mockAuditReport}
        onApplyProposal={handleApply}
        canEditResume={true}
      />
    );

    // Verify side-by-side proposal is displayed
    expect(screen.getByText("Architected scalable microservices in FastAPI reducing latency by 45%.")).toBeInTheDocument();
    expect(screen.getByText(/Internal APM telemetry reports verified by user/i)).toBeInTheDocument();

    // Click Approve & Update Resume button
    const approveBtn = screen.getByRole("button", { name: /Approve & Update Resume/i });
    expect(approveBtn).not.toBeDisabled();
    fireEvent.click(approveBtn);

    expect(handleApply).toHaveBeenCalledWith(
      "Architected microservices in FastAPI.",
      "Architected scalable microservices in FastAPI reducing latency by 45%."
    );
  });

  it("disables resume modification actions in historical read-only mode", () => {
    const handleApply = vi.fn();

    render(
      <RewritesAuditView
        proposals={mockAnalysis.rewrite_proposals}
        auditReport={mockAuditReport}
        onApplyProposal={handleApply}
        canEditResume={true}
        isHistorical={true}
      />
    );

    // Verify read-only indicator is rendered and approve button is not present
    expect(screen.getByText("Historical Snapshot • Resume Modification Disabled")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Approve & Update Resume/i })).not.toBeInTheDocument();
  });
});

describe("Workstream F: Checklist & Read-Only Historical Snapshot Features", () => {
  it("renders Prioritized Action Checklist with statuses and priority tags in OverviewScorecardView", () => {
    const mockChecklist: ChecklistItem[] = [
      {
        id: "check_1",
        category: "keywords",
        priority: "high",
        title: "Incorporate FastAPI into Professional Summary",
        description: "Add framework mention in the top summary paragraph.",
        passed: false,
        impact_points: 8,
      },
      {
        id: "check_2",
        category: "impact_verbs",
        priority: "medium",
        title: "Quantify Latency Metric on Project Alpha",
        description: "Include percentage reduction in latency.",
        passed: true,
        impact_points: 5,
      },
    ];

    render(
      <OverviewScorecardView
        overallScore={mockAnalysis.overall_score}
        overallExplanation={mockAnalysis.overall_explanation}
        executiveSummary={mockAnalysis.executive_summary}
        strengths={mockAnalysis.strengths}
        gaps={mockAnalysis.gaps}
        recommendations={mockAnalysis.recommendations}
        checklistItems={mockChecklist}
        isHistorical={true}
      />
    );

    expect(screen.getByText(/Prioritized Action Checklist/i)).toBeInTheDocument();
    expect(screen.getByText("Incorporate FastAPI into Professional Summary")).toBeInTheDocument();
    expect(screen.getByText("Quantify Latency Metric on Project Alpha")).toBeInTheDocument();
    expect(screen.getAllByText(/Action Needed/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Passed/i).length).toBeGreaterThan(0);
  });

  it("disables bulk optimization and selection in InteractiveBulletAnalysis when isReadOnly is true", () => {
    const mockBullets: BulletAuditItem[] = [
      {
        id: "bullet_1",
        section: "Experience",
        role_or_project: "Senior Backend Engineer",
        text: "Built microservices using FastAPI.",
        score: 75,
        status: "moderate",
        has_action_verb: true,
        verb: "Built",
        has_metric: false,
        has_weak_opener: false,
        word_count: 5,
        issues: ["Missing quantified latency outcome"],
        suggested_focus: "Specify transactions per second or performance improvement.",
      },
    ];

    render(
      <InteractiveBulletAnalysis
        bullets={mockBullets}
        selectedBulletIds={new Set()}
        onToggleBulletSelection={vi.fn()}
        onSelectAllBullets={vi.fn()}
        onSelectNeedsAttention={vi.fn()}
        onClearSelection={vi.fn()}
        onOpenBulkOptimizer={vi.fn()}
        isReadOnly={true}
      />
    );

    // Verify Read-Only historical rubric pill is displayed
    expect(screen.getByText("Read-Only Historical Rubric")).toBeInTheDocument();
    expect(screen.getByText("1 bullets evaluated in historical audit")).toBeInTheDocument();

    // Verify interactive bulk AI button and checkboxes are not rendered
    expect(screen.queryByRole("button", { name: /Optimize Selected/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Select All/i })).not.toBeInTheDocument();
    expect(screen.queryByTitle(/Select for optimization/i)).not.toBeInTheDocument();
  });

  it("renders AtsStudioModal with historical snapshot header and export button in read-only mode", () => {
    const handleClose = vi.fn();
    const handleExport = vi.fn();

    render(
      <AtsStudioModal
        isOpen={true}
        onClose={handleClose}
        analysis={mockAnalysis}
        auditReport={mockAuditReport}
        bulletAudits={[]}
        jobTitle="Staff Backend Engineer"
        jobCompany="Stripe"
        isHistorical={true}
        savedReportCreatedAt="2026-10-25T14:30:00Z"
        onExport={handleExport}
      />
    );

    expect(screen.getByText("Historical Snapshot (Read-Only)")).toBeInTheDocument();
    expect(screen.getByText(/Saved/i)).toBeInTheDocument();
    expect(screen.getByTitle("Export report snapshot")).toBeInTheDocument();
  });
});

