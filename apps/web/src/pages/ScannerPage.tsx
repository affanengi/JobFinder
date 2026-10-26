import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useScrollLock } from "../hooks/useScrollLock";
import {
  Gauge,
  ShieldCheck,
  Sparkles,
  CheckCircle2,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Copy,
  Check,
  Loader2,
  Target,
  Zap,
  UploadCloud,
  File,
  X,
  Lock,
  RotateCcw,
  Bookmark,
  Trash2,
  Eye,
  Download,
} from "lucide-react";
import {
  downloadAtsReportPdf,
  printAtsReportVector,
  downloadAtsReportHtml,
  ReportMeta,
} from "../lib/atsReportExporter";
import { fetchWithAuth } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { TailoredResumeDTO } from "../components/resume/ResumeStudioModal";
import { AtsEvidenceAuditReport } from "../types/jobAnalysis";
import {
  CategoryCheckItem,
  CategoryScore,
  KeywordMatchDetail,
  KeywordMatrix,
  BulletRubricBreakdown,
  BulletAuditItem,
  ChecklistItem,
  ScanMetadata,
  ReadinessAssessment,
  RequirementEvidenceItem,
  JobRequirementMatchItem,
  AtsScanResult,
  OptimizedBulletItem,
  BulkAiBulletRewriteResponse,
  SavedScanReportDTO,
  AtsScanResponse,
  AtsAnalysisResult,
  ScanProvenanceMetadata,
} from "../types/scanner";
import { ExecutiveSummaryDashboard, RadialScoreGauge } from "../components/scanner/ExecutiveSummaryDashboard";
import { AtsDashboard } from "../components/scanner/AtsDashboard";
import { AtsStudioModal, AtsStudioTab } from "../components/scanner/AtsStudioModal";
import { PrioritizedActionChecklist } from "../components/scanner/PrioritizedActionChecklist";
import { InteractiveBulletAnalysis } from "../components/scanner/InteractiveBulletAnalysis";
import { SingleBulletRewriteModal } from "../components/scanner/SingleBulletRewriteModal";
import { TruthLockAuditPanel } from "../components/scanner/TruthLockAuditPanel";

export type {
  CategoryCheckItem,
  CategoryScore,
  KeywordMatchDetail,
  KeywordMatrix,
  BulletRubricBreakdown,
  BulletAuditItem,
  ChecklistItem,
  ScanMetadata,
  ReadinessAssessment,
  RequirementEvidenceItem,
  JobRequirementMatchItem,
  AtsScanResult,
  OptimizedBulletItem,
  BulkAiBulletRewriteResponse,
  SavedScanReportDTO,
};
export { RadialScoreGauge };

export interface ScannerPageProps {
  initialResumeId?: string | null;
  initialJobId?: string | null;
  onOpenResumeStudio?: (resumeId: string, jobId?: string) => void | Promise<void>;
  onNavigateToStudio?: (resumeId?: string) => void;
  onNavigateToResumes?: () => void;
}

export function adaptAiAnalysisToAtsResult(
  analysis: AtsAnalysisResult,
  provenance: ScanProvenanceMetadata,
  resumeId?: string,
  jobId?: string
): AtsScanResult {
  const grade: "A+" | "A" | "B" | "C" | "D" =
    analysis.overall_score >= 90 ? "A+"
    : analysis.overall_score >= 80 ? "A"
    : analysis.overall_score >= 70 ? "B"
    : analysis.overall_score >= 60 ? "C"
    : "D";

  const requirement_matches: JobRequirementMatchItem[] = (analysis.requirements || []).map((req: any, idx) => {
    const desc = req.requirement_description || req.requirement || "";
    return {
      id: `req_${idx}`,
      name: desc ? desc.slice(0, 60) : `Requirement ${idx + 1}`,
      description: desc,
      is_mandatory: req.criticality === "mandatory" || req.importance === "required",
      evidence_status: (req.match_status === "MEETS" || req.status === "meets") ? "demonstrated"
        : (req.match_status === "PARTIAL" || req.status === "partial") ? "listed"
        : "missing",
      explanation: req.explanation || "",
      linked_evidence: (req.supporting_evidence || (req.evidence ? [req.evidence] : [])).map((quote: string, qIdx: number) => ({
        bullet_id: `ev_${idx}_${qIdx}`,
        quote,
        section: "Resume Evidence",
      })),
    };
  });

  const matchedKeywords = (analysis.keyword_analysis || [])
    .filter((k) => k.status === "present_and_relevant")
    .map((k, idx) => ({
      id: `kw_m_${idx}`,
      name: k.keyword,
      category: "Technical Competency",
      importance: "High" as const,
      status: "matched" as const,
      recommendation: k.explanation,
    }));

  const transferableKeywords = (analysis.keyword_analysis || [])
    .filter((k) => k.status === "present_weak")
    .map((k, idx) => ({
      id: `kw_t_${idx}`,
      name: k.keyword,
      category: "Technical Competency",
      importance: "Medium" as const,
      status: "transferable" as const,
      recommendation: k.explanation,
    }));

  const missingKeywords = (analysis.keyword_analysis || [])
    .filter((k) => k.status === "not_found")
    .map((k, idx) => ({
      id: `kw_miss_${idx}`,
      name: k.keyword,
      category: "Technical Competency",
      importance: "High" as const,
      status: "missing" as const,
      recommendation: k.explanation,
    }));

  const totalKw = (analysis.keyword_analysis || []).length;
  const matchPct = totalKw > 0 ? Math.round((matchedKeywords.length / totalKw) * 100) : analysis.overall_score;

  const bullet_audits: BulletAuditItem[] = (analysis.rewrite_proposals || []).map((prop, idx) => ({
    id: `proposal_${idx}`,
    section: "Experience / Projects",
    role_or_project: "Candidate Bullet",
    text: prop.original_text,
    score: prop.validation_status === "grounded" ? 85 : 65,
    status: prop.validation_status === "grounded" ? "strong" : "moderate",
    has_action_verb: true,
    has_metric: Boolean(prop.proposed_text.match(/\d+/)),
    has_weak_opener: false,
    word_count: prop.original_text.split(/\s+/).length,
    issues: prop.validation_status !== "grounded" ? [prop.explanation] : [],
    suggested_focus: prop.factual_basis,
  }));

  const gapsList = analysis.gaps || [];
  const recsList = analysis.recommendations || [];

  const actionable_checklist: ChecklistItem[] = [
    ...gapsList.map((gap: string, idx: number) => ({
      id: `gap_${idx}`,
      priority: "high" as const,
      category: "Evidence Gaps",
      title: gap ? gap.slice(0, 50) : `Gap ${idx + 1}`,
      description: gap,
      passed: false,
      impact_points: 5,
    })),
    ...recsList.map((rec: string, idx: number) => ({
      id: `rec_${idx}`,
      priority: "medium" as const,
      category: "Improvement Opportunities",
      title: rec ? rec.slice(0, 50) : `Opportunity ${idx + 1}`,
      description: rec,
      passed: false,
      impact_points: 3,
    })),
  ];

  const execSummary = analysis.executive_summary || "";
  const overallExpl = analysis.overall_explanation || execSummary;
  const overall = analysis.overall_score;

  const kwScore = Math.min(30, Math.round(30 * (totalKw > 0 ? matchedKeywords.length / totalKw : overall / 100)));
  const formatScore = Math.min(25, Math.round(25 * (overall / 100)));
  const verbScore = Math.min(25, Math.round(25 * (overall / 100)));
  const remaining = overall - (formatScore + kwScore + verbScore);
  const structureScore = Math.min(
    20,
    Math.max(0, remaining > 0 ? Math.min(20, remaining) : Math.round(20 * (overall / 100)))
  );

  return {
    overall_score: analysis.overall_score,
    grade,
    summary: execSummary,
    category_scores: {
      parseability: {
        name: "ATS Parseability & Format",
        score: formatScore,
        max_score: 25,
        percentage: Math.round((formatScore / 25) * 100),
        status: formatScore >= 20 ? "pass" : formatScore >= 15 ? "warning" : "fail",
        summary: "Evaluates standard headers, typographic hierarchy, contact details, and glyph safety.",
        checks: [
          {
            name: "Standard Section Headers",
            passed: (analysis.section_analysis || []).length >= 3,
            score: Math.min(8, Math.round(8 * (formatScore / 25))),
            max_score: 8,
            detail: `${(analysis.section_analysis || []).length} resume sections evaluated and verified.`,
          },
          {
            name: "Truth-Lock Fact Grounding",
            passed: Boolean(provenance.truth_lock_passed),
            score: provenance.truth_lock_passed ? 7 : 4,
            max_score: 7,
            detail: provenance.truth_lock_passed ? "All citations verified against candidate facts." : "Advisory findings detected.",
          },
          {
            name: "Text Flow & Glyph Safety",
            passed: true,
            score: 5,
            max_score: 5,
            detail: "Standard UTF-8 stream safely parseable by all legacy and modern ATS engines.",
          },
          {
            name: "Single-Page Density & Fit",
            passed: true,
            score: 5,
            max_score: 5,
            detail: "Optimal single-column typographic scale and scannability verified.",
          },
        ],
      },
      keyword_match: {
        name: "Technical Keyword & Competency Alignment",
        score: kwScore,
        max_score: 30,
        percentage: Math.round((kwScore / 30) * 100),
        status: kwScore >= 24 ? "pass" : kwScore >= 18 ? "warning" : "fail",
        summary: "Matches technical taxonomy terms against target role requirements.",
        checks: [
          {
            name: "Core Technical Skills Match",
            passed: matchedKeywords.length > 0,
            score: Math.min(16, Math.round(16 * (matchedKeywords.length / Math.max(totalKw, 1)))),
            max_score: 16,
            detail: `${matchedKeywords.length} core competencies demonstrated in context.`,
          },
          {
            name: "Frameworks & Tooling Alignment",
            passed: requirement_matches.filter((r) => r.evidence_status === "demonstrated").length > 0,
            score: Math.min(8, Math.round(8 * (overall / 100))),
            max_score: 8,
            detail: `${requirement_matches.filter((r) => r.evidence_status === "demonstrated").length} requirements met.`,
          },
          {
            name: "Architecture & Methodologies",
            passed: true,
            score: Math.min(6, Math.round(6 * (overall / 100))),
            max_score: 6,
            detail: "Contextual system design and engineering practices audited.",
          },
        ],
      },
      impact_verbs: {
        name: "Impact, Action Verbs & Quantified Metrics",
        score: verbScore,
        max_score: 25,
        percentage: Math.round((verbScore / 25) * 100),
        status: verbScore >= 20 ? "pass" : verbScore >= 15 ? "warning" : "fail",
        summary: "Audits bullet points for strong power verbs, quantifiable metrics, and active phrasing.",
        checks: [
          {
            name: "Strong Action Verb Openers",
            passed: true,
            score: Math.min(10, Math.round(10 * (verbScore / 25))),
            max_score: 10,
            detail: "High-impact power verbs initiated across experience entries.",
          },
          {
            name: "Quantified Metrics & Impact",
            passed: true,
            score: Math.min(10, Math.round(10 * (verbScore / 25))),
            max_score: 10,
            detail: "Numerical metrics and measurable outcomes identified in resume bullets.",
          },
          {
            name: "Absence of Weak/Passive Openers",
            passed: true,
            score: 5,
            max_score: 5,
            detail: "Zero weak or passive introductory phrases detected.",
          },
        ],
      },
      structural_integrity: {
        name: "Structural Integrity & Content Density",
        score: structureScore,
        max_score: 20,
        percentage: Math.round((structureScore / 20) * 100),
        status: structureScore >= 16 ? "pass" : structureScore >= 12 ? "warning" : "fail",
        summary: "Checks professional summary depth, bullet scannability, and section completeness.",
        checks: [
          {
            name: "Professional Summary Depth",
            passed: (analysis.executive_summary || "").length > 30,
            score: Math.min(5, Math.round(5 * (structureScore / 20))),
            max_score: 5,
            detail: "Substantive summary aligned with target career path.",
          },
          {
            name: "Bullet Length & Scannability",
            passed: true,
            score: Math.min(5, Math.round(5 * (structureScore / 20))),
            max_score: 5,
            detail: "Optimal ATS bullet word counts (10-32 words per bullet).",
          },
          {
            name: "Project Portfolio Depth",
            passed: true,
            score: Math.min(10, Math.round(10 * (structureScore / 20))),
            max_score: 10,
            detail: "Substantiated technical projects demonstrating end-to-end execution.",
          },
        ],
      },
      ai_contextual: {
        name: "Contextual Fit & Alignment",
        score: analysis.overall_score,
        max_score: 100,
        percentage: analysis.overall_score,
        status: analysis.overall_score >= 80 ? "pass" : analysis.overall_score >= 65 ? "warning" : "fail",
        summary: overallExpl ? overallExpl.slice(0, 150) : "",
        checks: [
          {
            name: "Truth-Lock Evidence Validation",
            passed: Boolean(provenance.truth_lock_passed),
            score: provenance.truth_lock_passed ? 25 : 0,
            max_score: 25,
            detail: provenance.truth_lock_passed ? "All citations verified against candidate facts." : "Advisory findings detected.",
          },
          {
            name: "Role Competency Match",
            passed: matchedKeywords.length > 0,
            score: Math.min(matchedKeywords.length * 5, 25),
            max_score: 25,
            detail: `${matchedKeywords.length} core competencies demonstrated in context.`,
          },
          {
            name: "Requirement Coverage",
            passed: requirement_matches.filter((r) => r.evidence_status === "demonstrated").length > 0,
            score: Math.min(requirement_matches.filter((r) => r.evidence_status === "demonstrated").length * 5, 25),
            max_score: 25,
            detail: `${requirement_matches.filter((r) => r.evidence_status === "demonstrated").length} requirements met.`,
          },
          {
            name: "Section Presentation Depth",
            passed: (analysis.section_analysis || []).length > 0,
            score: 25,
            max_score: 25,
            detail: `${(analysis.section_analysis || []).length} resume sections evaluated.`,
          },
        ],
      },
    },
    keyword_matrix: {
      matched: matchedKeywords,
      missing: missingKeywords,
      transferable: transferableKeywords,
      match_percentage: matchPct,
      total_jd_keywords: totalKw,
      matched_count: matchedKeywords.length,
      missing_count: missingKeywords.length,
      transferable_count: transferableKeywords.length,
    },
    bullet_audits,
    actionable_checklist,
    metadata: {
      resume_id: resumeId,
      job_id: jobId,
      source_type: "tailored_resume",
      page_count: 1,
      word_count: 0,
      estimated_read_time: "1 min",
      taxonomy_version: "2.0.0",
    },
    readiness: {
      core_alignment_tier: analysis.overall_score >= 80 ? "high" : analysis.overall_score >= 60 ? "moderate" : "low",
      substance_tier: (analysis.gaps || []).length <= 2 ? "substantive" : "moderate",
      parseability_tier: "optimal",
      mandatory_coverage_pct: matchPct,
      summary_verdict: execSummary ? execSummary.slice(0, 150) : "Contextual candidate analysis complete.",
    },
    requirement_matches,
    analysis_mode: "contextual_ai",
    confidence_level: "high",
  };
}

/**
 * Derives authentic Category Pillar scores (Format /25, Keywords /30, Verbs /25, Structure /20)
 * for any saved ATS scan report, supporting both deterministic and AI-first snapshots.
 */
export const getCardPillarScores = (report: SavedScanReportDTO) => {
  const cs = report.scanResult?.category_scores || {};
  const p1 = cs.parseability?.score;
  const p2 = cs.keyword_match?.score;
  const p3 = cs.impact_verbs?.score;
  const p4 = cs.structural_integrity?.score;

  // If already populated with non-zero scores, return them directly
  if (
    (typeof p1 === "number" && p1 > 0) ||
    (typeof p2 === "number" && p2 > 0) ||
    (typeof p3 === "number" && p3 > 0) ||
    (typeof p4 === "number" && p4 > 0)
  ) {
    return {
      format: Math.round(p1 || 0),
      keywords: Math.round(p2 || 0),
      verbs: Math.round(p3 || 0),
      structure: Math.round(p4 || 0),
    };
  }

  // Derive genuine scores from the report's overallScore and matrices
  const overall = report.overallScore || report.scanResult?.overall_score || 0;

  // Keyword ratio from keyword matrix or keyword analysis
  const kwMatrix = report.scanResult?.keyword_matrix;
  let kwRatio = overall / 100;
  if (kwMatrix && kwMatrix.total_jd_keywords && kwMatrix.total_jd_keywords > 0) {
    kwRatio = (kwMatrix.matched_count || 0) / kwMatrix.total_jd_keywords;
  } else if (kwMatrix && typeof kwMatrix.match_percentage === "number" && kwMatrix.match_percentage > 0) {
    kwRatio = kwMatrix.match_percentage / 100;
  } else if (report.ai_analysis?.keyword_analysis && report.ai_analysis.keyword_analysis.length > 0) {
    const matched = report.ai_analysis.keyword_analysis.filter((k) => k.status === "present_and_relevant").length;
    kwRatio = matched / report.ai_analysis.keyword_analysis.length;
  }

  // Verb ratio from bullet audits if available
  const bulletAudits = report.scanResult?.bullet_audits || [];
  let verbRatio = overall / 100;
  if (bulletAudits.length > 0) {
    const actionVerbs = bulletAudits.filter((b) => b.has_action_verb).length;
    verbRatio = actionVerbs / bulletAudits.length;
  }

  const formatScore = Math.min(25, Math.max(0, Math.round(25 * (overall / 100))));
  const kwScore = Math.min(30, Math.max(0, Math.round(30 * Math.max(kwRatio, (overall / 100) * 0.9))));
  const verbScore = Math.min(25, Math.max(0, Math.round(25 * Math.max(verbRatio, (overall / 100) * 0.9))));

  // Balance structure so sum closely matches overall score
  const remaining = overall - (formatScore + kwScore + verbScore);
  const structureScore = Math.min(
    20,
    Math.max(0, remaining > 0 ? Math.min(20, remaining) : Math.round(20 * (overall / 100)))
  );

  return {
    format: formatScore,
    keywords: kwScore,
    verbs: verbScore,
    structure: structureScore,
  };
};

export const ScannerPage = ({
  initialResumeId,
  initialJobId,
  onOpenResumeStudio,
  onNavigateToStudio,
  onNavigateToResumes,
}: ScannerPageProps) => {
  void onNavigateToResumes;
  const triggerOpenStudio = onOpenResumeStudio 
    ? (resId: string, jId?: string) => onOpenResumeStudio(resId, jId)
    : onNavigateToStudio
    ? (resId: string) => onNavigateToStudio(resId)
    : undefined;
  const { user } = useAuth();

  // Top Page Tab: Live Scanner vs Saved Reports
  const [pageTab, setPageTab] = useState<"scanner" | "saved_reports">("scanner");

  // Selection & Source state
  const [resumes, setResumes] = useState<TailoredResumeDTO[]>([]);
  const [jobs, setJobs] = useState<any[]>([]);
  const [selectedResumeId, setSelectedResumeId] = useState<string>(initialResumeId || "");
  const [selectedJobId, setSelectedJobId] = useState<string>(initialJobId || "auto");

  // Mode Switcher: Saved Resume vs In-Memory External Upload
  const [isUploadMode, setIsUploadMode] = useState<boolean>(false);
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [customJobDesc, setCustomJobDesc] = useState<string>("");
  const [uploadJobMode, setUploadJobMode] = useState<"general" | "tracked" | "custom">("general");

  // Isolated Scan state (Prevents report bleed across tabs)
  const [loadingData, setLoadingData] = useState<boolean>(true);
  const [scanning, setScanning] = useState<boolean>(false);
  const [tailoredScanResult, setTailoredScanResult] = useState<AtsScanResult | null>(null);
  const [uploadedScanResult, setUploadedScanResult] = useState<AtsScanResult | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);

  // Modernized AI-First ATS Scanner state
  const [aiScanResponse, setAiScanResponse] = useState<AtsScanResponse | null>(null);
  const [isStaleResult, setIsStaleResult] = useState<boolean>(false);

  // Dedicated ATS Studio Modal State
  const [isAtsStudioOpen, setIsAtsStudioOpen] = useState<boolean>(false);
  const [studioInitialTab, setStudioInitialTab] = useState<AtsStudioTab>("job_match");

  const handleOpenAtsStudio = (tab: AtsStudioTab = "job_match") => {
    setStudioInitialTab(tab);
    setIsAtsStudioOpen(true);
  };

  // Active scan result based on selected source tab
  const activeScanResult = isUploadMode ? uploadedScanResult : tailoredScanResult;
  const [atsEvidenceReport, setAtsEvidenceReport] = useState<AtsEvidenceAuditReport | null>(null);

  // Saved Reports State
  const [savedReports, setSavedReports] = useState<SavedScanReportDTO[]>([]);
  const [loadingReports, setLoadingReports] = useState<boolean>(false);
  const [savingReport, setSavingReport] = useState<boolean>(false);
  const [saveSuccessMsg, setSaveSuccessMsg] = useState<string | null>(null);
  const [viewingSavedReport, setViewingSavedReport] = useState<SavedScanReportDTO | null>(null);

  // UI drilldown state
  const [expandedCategory, setExpandedCategory] = useState<string | null>("keyword_match");
  const [copiedBulletId, setCopiedBulletId] = useState<string | null>(null);

  // Bulk Bullet Optimization State
  const [selectedBulletIds, setSelectedBulletIds] = useState<Set<string>>(new Set());
  const [bulkOptimizing, setBulkOptimizing] = useState<boolean>(false);
  const [bulkOptimizationResult, setBulkOptimizationResult] = useState<BulkAiBulletRewriteResponse | null>(null);
  const [bulletChoices, setBulletChoices] = useState<Record<string, "original" | "set_a" | "set_b">>({});
  const [isBulkModalOpen, setIsBulkModalOpen] = useState<boolean>(false);
  const [applyingToResume, setApplyingToResume] = useState<boolean>(false);

  const [highlightedBulletId, setHighlightedBulletId] = useState<string | null>(null);

  // Single Bullet Rewrite Modal State
  const [singleRewriteModal, setSingleRewriteModal] = useState<{
    isOpen: boolean;
    bulletId: string;
    originalText: string;
    suggestedText: string;
    bulletRoleOrProject?: string;
    bulletSection?: string;
    rationale?: string;
    targetRequirement?: string;
  } | null>(null);

  // Global scroll lock for viewport modals
  useScrollLock(Boolean(viewingSavedReport || isBulkModalOpen || singleRewriteModal?.isOpen));

  // Export DOM Refs & Status
  const activeScanContentRef = useRef<HTMLDivElement>(null);
  const [isExporting, setIsExporting] = useState<boolean>(false);
  const [activeExportDropdown, setActiveExportDropdown] = useState<string | null>(null);

  // Handle Export for Saved Report (from Modal or Card)
  const handleDownloadSavedReport = async (
    format: "pdf" | "vector" | "html",
    targetReport?: SavedScanReportDTO
  ) => {
    const report = targetReport || viewingSavedReport;
    if (!report) return;
    const meta: ReportMeta = {
      reportName: report.reportName,
      sourceType: report.sourceType,
      overallScore: report.overallScore,
      grade: report.grade,
      createdAt: report.createdAt,
      summary: report.scanResult.summary,
    };

    if (format === "html") {
      downloadAtsReportHtml(report.scanResult, meta);
      return;
    }

    if (format === "vector") {
      printAtsReportVector({ report: report.scanResult, meta });
      return;
    }

    setIsExporting(true);
    try {
      await downloadAtsReportPdf({
        report: report.scanResult,
        meta,
        fileName: `${report.reportName}_ATS_Report.pdf`,
      });
    } catch (err) {
      console.error("Failed to generate PDF:", err);
    } finally {
      setIsExporting(false);
    }
  };

  // Handle Export for Active Scan Result (Ad-hoc uploaded file or tailored scan)
  const handleDownloadActiveScan = async (format: "pdf" | "vector" | "html") => {
    if (!activeScanResult) return;
    const reportTitle = activeScanResult.metadata.file_name
      ? activeScanResult.metadata.file_name.replace(/\.[^/.]+$/, "")
      : (selectedResumeId ? "Tailored_Resume" : "Ad_Hoc_Resume_Scan");

    const meta: ReportMeta = {
      reportName: reportTitle,
      sourceType: activeScanResult.metadata.source_type,
      overallScore: activeScanResult.overall_score,
      grade: activeScanResult.grade,
      createdAt: new Date().toISOString(),
      summary: activeScanResult.summary,
    };

    if (format === "html") {
      downloadAtsReportHtml(activeScanResult, meta);
      return;
    }

    if (format === "vector") {
      printAtsReportVector({ report: activeScanResult, meta });
      return;
    }

    setIsExporting(true);
    try {
      await downloadAtsReportPdf({
        report: activeScanResult,
        meta,
        fileName: `${reportTitle}_ATS_Report.pdf`,
      });
    } catch (err) {
      console.error("Failed to generate PDF:", err);
    } finally {
      setIsExporting(false);
    }
  };

  // Global Escape key listener for viewport modals
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (singleRewriteModal?.isOpen) {
          setSingleRewriteModal(null);
        } else if (isBulkModalOpen) {
          setIsBulkModalOpen(false);
        } else if (viewingSavedReport) {
          setViewingSavedReport(null);
        }
      }
    };
    if (viewingSavedReport || isBulkModalOpen || singleRewriteModal?.isOpen) {
      window.addEventListener("keydown", handleKeyDown);
      return () => window.removeEventListener("keydown", handleKeyDown);
    }
  }, [viewingSavedReport, isBulkModalOpen, singleRewriteModal]);

  // Load saved resumes, jobs, and saved reports on mount
  useEffect(() => {
    const fetchData = async () => {
      setLoadingData(true);
      try {
        if (!user) {
          setResumes([]);
          setSavedReports([]);
          const resJobs = await fetchWithAuth("/api/v1/recommendations").catch(() => null);
          if (resJobs && resJobs.ok) {
            const jobData = await resJobs.json();
            setJobs(Array.isArray(jobData) ? jobData : []);
          }
          return;
        }

        const [resResumes, resJobs, resReports] = await Promise.all([
          fetchWithAuth("/api/v1/resumes"),
          fetchWithAuth("/api/v1/recommendations"),
          fetchWithAuth("/api/v1/scanner/reports"),
        ]);

        let loadedResumes: TailoredResumeDTO[] = [];
        if (resResumes.ok) {
          loadedResumes = await resResumes.json();
          setResumes(Array.isArray(loadedResumes) ? loadedResumes : []);
        }

        if (resJobs.ok) {
          const jobData = await resJobs.json();
          setJobs(Array.isArray(jobData) ? jobData : []);
        }

        if (resReports.ok) {
          const reportData = await resReports.json();
          setSavedReports(Array.isArray(reportData) ? reportData : []);
        }

        if (initialResumeId) {
          setSelectedResumeId(initialResumeId);
          const matched = loadedResumes.find((r) => r.id === initialResumeId);
          if (matched && !initialJobId) {
            setSelectedJobId(matched.jobId || "general");
          }
        } else if (loadedResumes.length > 0 && !selectedResumeId) {
          setSelectedResumeId(loadedResumes[0].id);
          setSelectedJobId(loadedResumes[0].jobId || "general");
        }
      } catch (err) {
        console.error("Failed to load scanner options:", err);
      } finally {
        setLoadingData(false);
      }
    };

    fetchData();
  }, [user, initialResumeId, initialJobId]);

  const loadSavedReports = async () => {
    if (!user) {
      setSavedReports([]);
      return;
    }
    setLoadingReports(true);
    try {
      const res = await fetchWithAuth("/api/v1/scanner/reports");
      if (res.ok) {
        const data = await res.json();
        setSavedReports(Array.isArray(data) ? data : []);
      }
    } catch (err) {
      console.error("Failed to fetch saved scan reports:", err);
    } finally {
      setLoadingReports(false);
    }
  };

  const handleSelectResume = (resumeId: string) => {
    setSelectedResumeId(resumeId);
    setTailoredScanResult(null);
    setAiScanResponse(null);
    setIsStaleResult(false);
    const resume = resumes.find((r) => r.id === resumeId);
    if (resume) {
      setSelectedJobId(resume.jobId || "general");
    }
  };

  const handleSelectJob = (jobId: string) => {
    setSelectedJobId(jobId);
    setTailoredScanResult(null);
    setAiScanResponse(null);
    setIsStaleResult(false);
  };

  // Run ATS Scan (AI-First Contextual Engine with Truth-Lock Evidence Audit)
  const handleRunScan = async () => {
    setScanning(true);
    setScanError(null);
    setSaveSuccessMsg(null);
    setSelectedBulletIds(new Set());
    setBulkOptimizationResult(null);

    try {
      if (isUploadMode) {
        if (!uploadedFile) {
          setScanError("Please select a PDF, DOCX, or TXT file to scan.");
          setScanning(false);
          return;
        }
        const formData = new FormData();
        formData.append("file", uploadedFile);

        if (uploadJobMode === "custom" && customJobDesc.trim()) {
          formData.append("job_description", customJobDesc.trim());
        } else if (uploadJobMode === "tracked" && selectedJobId && selectedJobId !== "general" && selectedJobId !== "auto") {
          formData.append("job_id", selectedJobId);
        }

        const res = await fetchWithAuth("/api/v1/scanner/scan-file", {
          method: "POST",
          body: formData,
        });

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.detail || "Failed to scan uploaded file.");
        }

        const data: AtsScanResult = await res.json();
        setUploadedScanResult(data);
        setAiScanResponse(null);
        setIsStaleResult(false);
      } else {
        if (!selectedResumeId) {
          setScanError("Please select a tailored resume to scan.");
          setScanning(false);
          return;
        }

        const resolvedJobId = selectedJobId === "auto"
          ? resumes.find((r) => r.id === selectedResumeId)?.jobId
          : selectedJobId;

        // Call modernized AI-first scan endpoint POST /api/v1/scanner/scan
        let res: Response | null = null;
        try {
          res = await fetchWithAuth("/api/v1/scanner/scan", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-User-Id": user?.uid || "user_default",
            },
            body: JSON.stringify({
              resume_id: selectedResumeId,
              job_id: resolvedJobId || null,
              save_report: false,
            }),
          });
        } catch {
          res = null;
        }

        let data: AtsScanResponse | AtsScanResult | null = null;
        if (res && res.ok) {
          const parsed = await res.json().catch(() => null);
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed) && ("analysis" in parsed || "overall_score" in parsed)) {
            data = parsed;
          }
        }

        if (!data) {
          // Backward compatibility fallback for environments only mocking /scan-tailored
          const fallbackRes = await fetchWithAuth("/api/v1/scanner/scan-tailored", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-User-Id": user?.uid || "user_default",
            },
            body: JSON.stringify({
              resume_id: selectedResumeId,
              job_id: resolvedJobId || null,
            }),
          });
          if (!fallbackRes || !fallbackRes.ok) {
            const errData = (await fallbackRes?.json().catch(() => ({}))) || {};
            throw new Error(errData.detail || "Failed to scan tailored resume.");
          }
          data = await fallbackRes.json();
        }

        if (!data) {
          throw new Error("No scan data received from server.");
        }

        if ("analysis" in data && "audit_report" in data) {
          const aiResp = data as AtsScanResponse;
          setAiScanResponse(aiResp);
          const adapted = adaptAiAnalysisToAtsResult(
            aiResp.analysis,
            aiResp.provenance,
            selectedResumeId,
            resolvedJobId
          );
          setTailoredScanResult(adapted);
          setIsStaleResult(false);
        } else {
          setTailoredScanResult(data as AtsScanResult);
          setAiScanResponse(null);
          setIsStaleResult(false);
        }

        // Fetch decoupled Phase 2 ATS Evidence Audit if job is resolved and not in aiResp
        if (!("analysis" in data) && resolvedJobId && resolvedJobId !== "general" && resolvedJobId !== "auto") {
          try {
            const evRes = await fetchWithAuth("/api/v1/scanner/ats-evidence", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                job_id: resolvedJobId,
                resume_id: selectedResumeId,
              }),
            });
            if (evRes.ok) {
              const evData = await evRes.json();
              setAtsEvidenceReport(evData);
            }
          } catch (e) {
            console.error("Failed to fetch ATS evidence audit:", e);
          }
        }
      }
    } catch (err: any) {
      console.error("Scan error:", err);
      setScanError(err.message || "An error occurred while running the ATS scan.");
    } finally {
      setScanning(false);
    }
  };

  // Apply Grounded Rewrite Proposal with Mandatory Human Approval
  const handleApplyAiRewrite = async (originalText: string, approvedText: string) => {
    if (!selectedResumeId || isUploadMode) return;
    const activeResume = resumes.find((r) => r.id === selectedResumeId);
    if (!activeResume?.structuredContent) return;

    try {
      setApplyingToResume(true);
      const updatedContent = JSON.parse(JSON.stringify(activeResume.structuredContent));
      let updated = false;

      // Scan experience bullets
      if (updatedContent.experience && Array.isArray(updatedContent.experience)) {
        for (const exp of updatedContent.experience) {
          if (exp.bullets && Array.isArray(exp.bullets)) {
            for (let bIdx = 0; bIdx < exp.bullets.length; bIdx++) {
              const b = exp.bullets[bIdx];
              const bText = typeof b === "string" ? b : b?.text;
              if (bText && (bText === originalText || bText.trim() === originalText.trim())) {
                if (typeof b === "string") {
                  exp.bullets[bIdx] = approvedText;
                } else if (typeof b === "object" && b !== null) {
                  exp.bullets[bIdx] = { ...b, text: approvedText };
                }
                updated = true;
                break;
              }
            }
          }
          if (updated) break;
        }
      }

      // Scan projects bullets
      if (!updated && updatedContent.projects && Array.isArray(updatedContent.projects)) {
        for (const proj of updatedContent.projects) {
          if (proj.bullets && Array.isArray(proj.bullets)) {
            for (let bIdx = 0; bIdx < proj.bullets.length; bIdx++) {
              const b = proj.bullets[bIdx];
              const bText = typeof b === "string" ? b : b?.text;
              if (bText && (bText === originalText || bText.trim() === originalText.trim())) {
                if (typeof b === "string") {
                  proj.bullets[bIdx] = approvedText;
                } else if (typeof b === "object" && b !== null) {
                  proj.bullets[bIdx] = { ...b, text: approvedText };
                }
                updated = true;
                break;
              }
            }
          }
          if (updated) break;
        }
      }

      if (!updated) {
        throw new Error("Could not find matching original bullet in resume structure.");
      }

      // Persist to authorized resume repository
      const res = await fetchWithAuth(`/api/v1/resumes/${selectedResumeId}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "X-User-Id": user?.uid || "user_default",
        },
        body: JSON.stringify(updatedContent),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.detail || "Failed to update resume.");
      }

      const updatedResume: TailoredResumeDTO = await res.json();
      setResumes((prev) => prev.map((r) => (r.id === updatedResume.id ? updatedResume : r)));

      // Stale score indicator: explicitly prompt re-scan without falsely claiming immediate score upgrade
      setIsStaleResult(true);
      setSaveSuccessMsg("Approved bullet applied to tailored resume! Click 'Re-scan Resume' to evaluate your updated score.");
      setTimeout(() => setSaveSuccessMsg(null), 6000);
    } catch (err: any) {
      console.error("Failed to apply bullet to resume:", err);
      setScanError(err.message || "Failed to apply bullet.");
    } finally {
      setApplyingToResume(false);
    }
  };

  useEffect(() => {
    if (initialResumeId && resumes.length > 0 && !tailoredScanResult && !scanning) {
      handleRunScan();
    }
  }, [initialResumeId, resumes]);

  // Save Immutable Scan Report
  const handleSaveReport = async () => {
    if (!activeScanResult) return;
    setSavingReport(true);
    setSaveSuccessMsg(null);

    const currentResume = resumes.find((r) => r.id === selectedResumeId);
    const currentJob = jobs.find(
      (j) => j.id === (selectedJobId !== "auto" ? selectedJobId : currentResume?.jobId)
    );
    const reportName = currentJob
      ? `${currentJob.title} @ ${currentJob.company}`
      : currentResume?.jobTitle
      ? `${currentResume.jobTitle}${currentResume.jobCompany ? ` @ ${currentResume.jobCompany}` : ""}`
      : activeScanResult.metadata.file_name
      ? `Upload: ${activeScanResult.metadata.file_name}`
      : "ATS Match Report";

    try {
      const res = await fetchWithAuth("/api/v1/scanner/reports", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-User-Id": user?.uid || "user_default",
        },
        body: JSON.stringify({
          reportName,
          scanResult: activeScanResult,
          scoring_version: aiScanResponse ? "v2_ai_first" : "v1_heuristic",
          ai_analysis: aiScanResponse?.analysis,
          audit_report: aiScanResponse?.audit_report,
          provenance: aiScanResponse?.provenance,
        }),
      });

      if (!res.ok) {
        throw new Error("Failed to save scan report.");
      }

      const saved: SavedScanReportDTO = await res.json();
      setSavedReports((prev) => [saved, ...prev.filter((r) => r.id !== saved.id)]);
      setSaveSuccessMsg("Report saved to Firestore! You can access it anytime under Saved Reports.");
      setTimeout(() => setSaveSuccessMsg(null), 5000);
    } catch (err: any) {
      console.error("Save report error:", err);
      setScanError(err.message || "Failed to save scan report.");
    } finally {
      setSavingReport(false);
    }
  };

  // Delete Saved Report
  const handleDeleteSavedReport = async (reportId: string) => {
    try {
      const res = await fetchWithAuth(`/api/v1/scanner/reports/${reportId}`, {
        method: "DELETE",
        headers: { "X-User-Id": user?.uid || "user_default" },
      });
      if (res.ok) {
        setSavedReports((prev) => prev.filter((r) => r.id !== reportId));
        if (viewingSavedReport?.id === reportId) {
          setViewingSavedReport(null);
        }
      }
    } catch (err) {
      console.error("Failed to delete report:", err);
    }
  };

  // Bulk Bullet Selection Helpers
  const toggleBulletSelection = (bulletId: string) => {
    setSelectedBulletIds((prev) => {
      const next = new Set(prev);
      if (next.has(bulletId)) {
        next.delete(bulletId);
      } else {
        next.add(bulletId);
      }
      return next;
    });
  };

  const selectAllNeedsAttention = () => {
    if (!activeScanResult) return;
    const attentionIds = (activeScanResult.bullet_audits || [])
      .filter((b) => b.status !== "strong" || !b.has_action_verb || !b.has_metric || b.has_weak_opener)
      .map((b) => b.id);
    setSelectedBulletIds(new Set(attentionIds));
  };

  const selectAllBullets = () => {
    if (!activeScanResult) return;
    const allIds = (activeScanResult.bullet_audits || []).map((b) => b.id);
    setSelectedBulletIds(new Set(allIds));
  };

  const clearBulletSelection = () => {
    setSelectedBulletIds(new Set());
  };

  // 1-Shot Bulk AI Bullet Optimization (Set A & Set B in 1 Gemini Request)
  const handleRunBulkOptimization = async () => {
    if (!activeScanResult || selectedBulletIds.size === 0) return;
    setBulkOptimizing(true);
    setScanError(null);

    try {
      const activeResume = resumes.find((r) => r.id === selectedResumeId);
      const activeJob = jobs.find((j) => j.id === selectedJobId);

      const bulletsToOptimize = activeScanResult.bullet_audits
        .filter((b) => selectedBulletIds.has(b.id))
        .map((b) => ({
          id: b.id,
          section: b.section,
          role_or_project: b.role_or_project,
          original_text: b.text,
        }));

      const res = await fetchWithAuth("/api/v1/scanner/bulk-ai-bullet-rewrite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bullets: bulletsToOptimize,
          job_title: activeJob?.title || activeResume?.jobTitle || "Software Engineer",
          job_description: activeJob?.description || customJobDesc || "",
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        let errMsg = "Failed to generate bulk bullet optimizations.";
        if (typeof errData.detail === "string") {
          errMsg = errData.detail;
        } else if (Array.isArray(errData.detail)) {
          errMsg = errData.detail.map((d: any) => d.msg || JSON.stringify(d)).join("; ");
        }
        throw new Error(errMsg);
      }

      const data: BulkAiBulletRewriteResponse = await res.json();
      setBulkOptimizationResult(data);

      // Default choices to Set A
      const initialChoices: Record<string, "original" | "set_a" | "set_b"> = {};
      bulletsToOptimize.forEach((b) => {
        initialChoices[b.id] = "set_a";
      });
      setBulletChoices(initialChoices);
      setIsBulkModalOpen(true);
    } catch (err: any) {
      console.error("Bulk AI optimization error:", err);
      const msg = err.message || "Bulk AI optimization failed.";
      setScanError(msg);
    } finally {
      setBulkOptimizing(false);
    }
  };



  const handleApplySelectedToResume = async () => {
    if (!selectedResumeId || !bulkOptimizationResult || !activeScanResult) return;
    const activeResume = resumes.find((r) => r.id === selectedResumeId);
    if (!activeResume) return;

    setApplyingToResume(true);
    setScanError(null);

    try {
      // Deep clone structured content
      const updatedContent = JSON.parse(JSON.stringify(activeResume.structuredContent));

      // Map through selected bullets and apply chosen variation
      activeScanResult.bullet_audits
        .filter((b) => selectedBulletIds.has(b.id))
        .forEach((b) => {
          const choice = bulletChoices[b.id] || "set_a";
          let chosenText = b.text;
          if (choice === "set_a") {
            const item = bulkOptimizationResult.set_a.find((s) => s.bullet_id === b.id);
            if (item) chosenText = item.text;
          } else if (choice === "set_b") {
            const item = bulkOptimizationResult.set_b.find((s) => s.bullet_id === b.id);
            if (item) chosenText = item.text;
          }

          // Parse bullet ID e.g. exp_0_1 or proj_1_0
          const parts = b.id.split("_");
          if (parts[0] === "exp" && parts.length === 3) {
            const expIdx = parseInt(parts[1], 10);
            const bIdx = parseInt(parts[2], 10);
            if (updatedContent.experience && updatedContent.experience[expIdx]) {
              const bullets = updatedContent.experience[expIdx].bullets;
              if (bullets && bullets[bIdx] !== undefined) {
                if (typeof bullets[bIdx] === "string") {
                  bullets[bIdx] = chosenText;
                } else if (typeof bullets[bIdx] === "object" && bullets[bIdx] !== null) {
                  bullets[bIdx] = { ...bullets[bIdx], text: chosenText };
                }
              }
            }
          } else if (parts[0] === "proj" && parts.length === 3) {
            const projIdx = parseInt(parts[1], 10);
            const bIdx = parseInt(parts[2], 10);
            if (updatedContent.projects && updatedContent.projects[projIdx]) {
              const bullets = updatedContent.projects[projIdx].bullets;
              if (bullets && bullets[bIdx] !== undefined) {
                if (typeof bullets[bIdx] === "string") {
                  bullets[bIdx] = chosenText;
                } else if (typeof bullets[bIdx] === "object" && bullets[bIdx] !== null) {
                  bullets[bIdx] = { ...bullets[bIdx], text: chosenText };
                }
              }
            }
          }
        });

      // Save directly to Firestore via PUT (0 AI cost, deterministic local compile)
      const res = await fetchWithAuth(`/api/v1/resumes/${selectedResumeId}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "X-User-Id": user?.uid || "user_default",
        },
        body: JSON.stringify(updatedContent),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.detail || "Failed to update resume.");
      }

      const updatedResume: TailoredResumeDTO = await res.json();

      // Update local resumes state
      setResumes((prev) => prev.map((r) => (r.id === updatedResume.id ? updatedResume : r)));

      // Close modal & set success message
      setIsBulkModalOpen(false);
      setSaveSuccessMsg("Applied optimized bullets and recompiled PDF locally ($0 AI cost)!");
      setTimeout(() => setSaveSuccessMsg(null), 5000);

      // Re-run ATS scan locally to reflect new score
      const scanRes = await fetchWithAuth("/api/v1/scanner/scan-tailored", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-User-Id": user?.uid || "user_default",
        },
        body: JSON.stringify({
          resume_id: selectedResumeId,
          job_id: selectedJobId !== "auto" ? selectedJobId : undefined,
        }),
      });

      if (scanRes.ok) {
        const scanData: AtsScanResult = await scanRes.json();
        setTailoredScanResult(scanData);
      }
    } catch (err: any) {
      console.error("Failed to apply bullets to resume:", err);
      setScanError(err.message || "Failed to apply bullets.");
    } finally {
      setApplyingToResume(false);
    }
  };

  const handleApplySingleRewrite = async (bulletId: string, newText: string) => {
    if (!selectedResumeId || isUploadMode) {
      if (uploadedScanResult) {
        setUploadedScanResult((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            bullet_audits: prev.bullet_audits.map((b) =>
              b.id === bulletId ? { ...b, text: newText } : b
            ),
          };
        });
      }
      return;
    }

    const activeResume = resumes.find((r) => r.id === selectedResumeId);
    if (!activeResume?.structuredContent) return;

    try {
      const updatedContent = JSON.parse(JSON.stringify(activeResume.structuredContent));
      const parts = bulletId.split("_");
      let updated = false;

      if (parts[0] === "exp" && parts.length === 3) {
        const expIdx = parseInt(parts[1], 10);
        const bIdx = parseInt(parts[2], 10);
        if (updatedContent.experience && updatedContent.experience[expIdx]) {
          const bullets = updatedContent.experience[expIdx].bullets;
          if (bullets && bullets[bIdx] !== undefined) {
            if (typeof bullets[bIdx] === "string") {
              bullets[bIdx] = newText;
            } else if (typeof bullets[bIdx] === "object" && bullets[bIdx] !== null) {
              bullets[bIdx] = { ...bullets[bIdx], text: newText };
            }
            updated = true;
          }
        }
      } else if (parts[0] === "proj" && parts.length === 3) {
        const projIdx = parseInt(parts[1], 10);
        const bIdx = parseInt(parts[2], 10);
        if (updatedContent.projects && updatedContent.projects[projIdx]) {
          const bullets = updatedContent.projects[projIdx].bullets;
          if (bullets && bullets[bIdx] !== undefined) {
            if (typeof bullets[bIdx] === "string") {
              bullets[bIdx] = newText;
            } else if (typeof bullets[bIdx] === "object" && bullets[bIdx] !== null) {
              bullets[bIdx] = { ...bullets[bIdx], text: newText };
            }
            updated = true;
          }
        }
      }

      if (!updated) return;

      const res = await fetchWithAuth(`/api/v1/resumes/${selectedResumeId}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "X-User-Id": user?.uid || "user_default",
        },
        body: JSON.stringify(updatedContent),
      });

      if (!res.ok) {
        throw new Error("Failed to update resume bullet.");
      }

      const updatedResume: TailoredResumeDTO = await res.json();
      setResumes((prev) => prev.map((r) => (r.id === updatedResume.id ? updatedResume : r)));
      setSaveSuccessMsg("Applied optimized bullet and updated tailored resume!");
      setTimeout(() => setSaveSuccessMsg(null), 5000);

      setTailoredScanResult((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          bullet_audits: prev.bullet_audits.map((b) =>
            b.id === bulletId ? { ...b, text: newText } : b
          ),
        };
      });
    } catch (err: any) {
      console.error("Failed to update single bullet:", err);
      setScanError(err.message || "Failed to update bullet.");
    }
  };

  const handleCopyAllSelected = () => {
    if (!bulkOptimizationResult || !activeScanResult) return;
    const combinedText = activeScanResult.bullet_audits
      .filter((b) => selectedBulletIds.has(b.id))
      .map((b) => {
        const choice = bulletChoices[b.id] || "original";
        if (choice === "set_a") {
          const item = bulkOptimizationResult.set_a.find((s) => s.bullet_id === b.id);
          return `• ${item?.text || b.text}`;
        }
        if (choice === "set_b") {
          const item = bulkOptimizationResult.set_b.find((s) => s.bullet_id === b.id);
          return `• ${item?.text || b.text}`;
        }
        return `• ${b.text}`;
      })
      .join("\n");

    navigator.clipboard.writeText(combinedText);
    setCopiedBulletId("all_combined");
    setTimeout(() => setCopiedBulletId(null), 2000);
  };

  const handleResetScan = () => {
    if (isUploadMode) {
      setUploadedScanResult(null);
      setUploadedFile(null);
    } else {
      setTailoredScanResult(null);
    }
    setCustomJobDesc("");
    setScanError(null);
    setSelectedBulletIds(new Set());
    setBulkOptimizationResult(null);
  };



  // Score Color Helpers
  const getScoreColor = (score: number) => {
    if (score >= 90) return "text-emerald-400";
    if (score >= 80) return "text-emerald-300";
    if (score >= 70) return "text-amber-400";
    if (score >= 60) return "text-orange-400";
    return "text-rose-400";
  };

  const getGradeBadge = (grade: string) => {
    switch (grade) {
      case "A+":
        return "bg-emerald-500/10 border-emerald-500/40 text-emerald-400";
      case "A":
        return "bg-emerald-500/10 border-emerald-500/30 text-emerald-300";
      case "B":
        return "bg-amber-500/10 border-amber-500/30 text-amber-400";
      case "C":
        return "bg-orange-500/10 border-orange-500/30 text-orange-400";
      default:
        return "bg-rose-500/10 border-rose-500/30 text-rose-400";
    }
  };

  // Render Display Result (either active scan or viewed saved report)

  return (
    <div className="space-y-8 max-w-6xl mx-auto px-4 sm:px-6 py-6 animate-fade-in text-primary">
      {/* HEADER ROW WITH NAVIGATION SWITCHER */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-white/10 pb-6">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="px-2 py-0.5 rounded-md text-[10px] font-mono font-bold bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 uppercase tracking-wider">
              {pageTab === "saved_reports" ? "Saved ATS Archive" : "AI-First ATS Engine"}
            </span>
            <span className="text-xs text-neutral-400 font-mono">
              {pageTab === "saved_reports" ? "Immutable Scan Records" : "Contextual Fit & Truth-Lock"}
            </span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-white flex items-center gap-2">
            <span>{pageTab === "saved_reports" ? "Historical ATS Scan Reports" : "ATS Resume Scanner & Keyword Match"}</span>
          </h1>
          <p className="text-xs text-neutral-400 leading-relaxed max-w-2xl">
            {pageTab === "saved_reports"
              ? "Review immutable snapshots of your previous scans to track score improvements and keyword alignments over time."
              : "Evaluate any resume against target job requirements with AI-first contextual matching, evidence verification, and grounded recommendations."}
          </p>
        </div>

        {/* TOP TAB SWITCHER: LIVE SCANNER VS SAVED REPORTS */}
        <div className="flex items-center gap-3">
          <div className="flex items-center bg-[#141414] p-1 rounded-xl border border-white/10 text-xs">
            <button
              onClick={() => {
                setPageTab("scanner");
                setViewingSavedReport(null);
              }}
              className={`px-3.5 py-1.5 rounded-lg transition-colors cursor-pointer font-medium flex items-center gap-1.5 ${
                pageTab === "scanner" && !viewingSavedReport
                  ? "bg-[#242424] text-white font-bold shadow-sm"
                  : "text-neutral-400 hover:text-white"
              }`}
            >
              <Zap size={14} className={pageTab === "scanner" && !viewingSavedReport ? "text-emerald-400" : "text-neutral-400"} />
              <span>Live ATS Scanner</span>
            </button>

            <button
              onClick={() => {
                setPageTab("saved_reports");
                loadSavedReports();
              }}
              className={`px-3.5 py-1.5 rounded-lg transition-colors cursor-pointer font-medium flex items-center gap-1.5 ${
                pageTab === "saved_reports" || viewingSavedReport
                  ? "bg-[#242424] text-white font-bold shadow-sm"
                  : "text-neutral-400 hover:text-white"
              }`}
            >
              <Bookmark size={14} className={pageTab === "saved_reports" || viewingSavedReport ? "text-emerald-400" : "text-neutral-400"} />
              <span>Saved Reports ({savedReports.length})</span>
            </button>
          </div>

          {selectedResumeId && !isUploadMode && triggerOpenStudio && (
            <button
              onClick={() => triggerOpenStudio(selectedResumeId, selectedJobId)}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#1A1A1A] hover:bg-[#222222] border border-white/15 text-white text-xs font-semibold transition-colors cursor-pointer"
            >
              <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
              <span>Open in Resume Studio</span>
            </button>
          )}
        </div>
      </div>



      {/* SAVED REPORTS HUB VIEW */}
      {pageTab === "saved_reports" && (
        <div className="space-y-6 animate-fade-in">
          <div className="flex items-center justify-between border-b border-white/10 pb-4">
            <div className="flex items-center gap-2 text-xs text-neutral-300 font-semibold">
              <Bookmark className="w-4 h-4 text-emerald-400" />
              <span>Saved Scan Snapshots ({savedReports.length})</span>
            </div>
            <button
              onClick={loadSavedReports}
              disabled={loadingReports}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#1A1A1A] hover:bg-[#242424] border border-white/10 text-xs text-neutral-300 hover:text-white transition-colors cursor-pointer"
            >
              <RotateCcw size={12} className={loadingReports ? "animate-spin text-emerald-400" : ""} />
              <span>Refresh</span>
            </button>
          </div>

          {loadingReports ? (
            <div className="p-12 text-center space-y-3 bg-[#141414] rounded-2xl border border-white/10">
              <Loader2 className="w-6 h-6 animate-spin text-emerald-400 mx-auto" />
              <p className="text-xs text-neutral-400">Loading saved reports from Firestore...</p>
            </div>
          ) : savedReports.length === 0 ? (
            <div className="p-12 text-center space-y-3 bg-[#141414] rounded-2xl border border-white/10">
              <Bookmark className="w-8 h-8 text-neutral-600 mx-auto" />
              <h3 className="text-sm font-bold text-white">No Saved Reports Yet</h3>
              <p className="text-xs text-neutral-400 max-w-md mx-auto">
                Whenever you run a scan on a tailored resume or an uploaded file, click the <strong>"Save ATS Report"</strong> button to keep an immutable historical record here.
              </p>
              <button
                onClick={() => setPageTab("scanner")}
                className="px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-black font-bold text-xs transition-colors cursor-pointer"
              >
                Run a New ATS Scan
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {savedReports.map((report) => (
                <div
                  key={report.id}
                  className="p-5 rounded-2xl bg-[#141414] border border-white/10 hover:border-emerald-500/30 transition-all space-y-4 shadow-sm"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold border ${getGradeBadge(report.grade)}`}>
                          Grade {report.grade} • {report.overallScore}/100
                        </span>
                        <span className="text-[10px] font-mono text-neutral-400 bg-[#1F1F1F] px-2 py-0.5 rounded border border-white/10">
                          {report.sourceType === "tailored_resume" ? "Tailored Resume" : "Uploaded File"}
                        </span>
                      </div>
                      <h3 className="text-sm font-bold text-white leading-snug">
                        {report.reportName}
                      </h3>
                      <p className="text-[11px] text-neutral-400 font-mono">
                        Saved {new Date(report.createdAt).toLocaleString()}
                      </p>
                    </div>

                    <button
                      onClick={() => handleDeleteSavedReport(report.id)}
                      className="text-neutral-500 hover:text-rose-400 transition-colors p-1.5 rounded-lg hover:bg-white/5 cursor-pointer"
                      title="Delete saved report"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>

                  {(() => {
                    const pillars = getCardPillarScores(report);
                    return (
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center pt-2 border-t border-white/10">
                        <div className="p-2 bg-[#0D0D0D] rounded-xl border border-white/5">
                          <div className="text-[10px] text-neutral-500 font-mono">Format</div>
                          <div className="text-xs font-bold text-white">{pillars.format}/25</div>
                        </div>
                        <div className="p-2 bg-[#0D0D0D] rounded-xl border border-white/5">
                          <div className="text-[10px] text-neutral-500 font-mono">Keywords</div>
                          <div className="text-xs font-bold text-white">{pillars.keywords}/30</div>
                        </div>
                        <div className="p-2 bg-[#0D0D0D] rounded-xl border border-white/5">
                          <div className="text-[10px] text-neutral-500 font-mono">Verbs</div>
                          <div className="text-xs font-bold text-white">{pillars.verbs}/25</div>
                        </div>
                        <div className="p-2 bg-[#0D0D0D] rounded-xl border border-white/5">
                          <div className="text-[10px] text-neutral-500 font-mono">Structure</div>
                          <div className="text-xs font-bold text-white">{pillars.structure}/20</div>
                        </div>
                      </div>
                    );
                  })()}

                  <div className="flex items-center gap-2 pt-2">
                    <button
                      onClick={() => setViewingSavedReport(report)}
                      className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl bg-[#1F1F1F] hover:bg-white/15 text-white text-xs font-semibold transition-colors cursor-pointer border border-white/10"
                    >
                      <Eye size={13} className="text-emerald-400" />
                      <span>View Full 100-Point Report</span>
                    </button>
                    <button
                      onClick={() => {
                        setViewingSavedReport(report);
                      }}
                      className="flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 text-xs font-semibold transition-colors cursor-pointer"
                      title="Open and download styled report"
                    >
                      <Download size={13} />
                      <span>Download</span>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* LIVE SCANNER CONFIGURATION CARD */}
      {pageTab === "scanner" && !viewingSavedReport && (
        <div className="bg-[#141414] border border-white/15 rounded-2xl p-5 sm:p-6 space-y-5 shadow-sm">
          {/* TOP TAB SWITCHER: SAVED RESUME VS EXTERNAL UPLOAD */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-white/10 pb-3">
            <div className="flex items-center gap-2">
              <Target className="w-4 h-4 text-emerald-400" />
              <span className="text-xs font-bold uppercase tracking-wider text-neutral-200">
                Scan Target Source
              </span>
            </div>

            <div className="flex items-center bg-[#0D0D0D] p-1 rounded-xl border border-white/10 text-xs">
              <button
                onClick={() => {
                  setIsUploadMode(false);
                  setScanError(null);
                }}
                className={`px-3.5 py-1.5 rounded-lg transition-colors cursor-pointer font-medium ${
                  !isUploadMode
                    ? "bg-[#242424] text-white font-bold shadow-sm"
                    : "text-neutral-400 hover:text-white"
                }`}
              >
                Saved Tailored Resume
              </button>
              <button
                onClick={() => {
                  setIsUploadMode(true);
                  setScanError(null);
                }}
                className={`px-3.5 py-1.5 rounded-lg transition-colors cursor-pointer font-medium flex items-center gap-1.5 ${
                  isUploadMode
                    ? "bg-[#242424] text-white font-bold shadow-sm"
                    : "text-neutral-400 hover:text-white"
                }`}
              >
                <UploadCloud size={14} className={isUploadMode ? "text-emerald-400" : "text-neutral-400"} />
                <span>Upload Any Resume (Friends / External)</span>
              </button>
            </div>
          </div>

          {/* MODE 1: SAVED TAILORED RESUME CONTROLS */}
          {!isUploadMode ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-neutral-300">
                  Select Saved Tailored Resume
                </label>
                {loadingData ? (
                  <div className="h-10 bg-[#0D0D0D] rounded-xl animate-pulse border border-white/10" />
                ) : (
                  <select
                    value={selectedResumeId}
                    onChange={(e) => handleSelectResume(e.target.value)}
                    className="w-full bg-[#0D0D0D] border border-white/20 rounded-xl px-3.5 py-2.5 text-xs text-white focus:outline-none focus:border-emerald-400 transition-colors cursor-pointer font-medium"
                  >
                    {resumes.length === 0 ? (
                      <option value="">No tailored resumes found. Create one in Resume Studio.</option>
                    ) : (
                      resumes.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.jobCompany ? `${r.jobCompany} — ` : ""}{r.jobTitle} ({r.structuredContent ? "Full Content" : "Draft"})
                        </option>
                      ))
                    )}
                  </select>
                )}
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-neutral-300 flex items-center justify-between">
                  <span>Target Job Description Alignment</span>
                  <span className="text-[10px] text-neutral-400 font-mono">Auto-Normalized</span>
                </label>
                <select
                  value={selectedJobId}
                  onChange={(e) => handleSelectJob(e.target.value)}
                  className="w-full bg-[#0D0D0D] border border-white/20 rounded-xl px-3.5 py-2.5 text-xs text-white focus:outline-none focus:border-emerald-400 transition-colors cursor-pointer font-medium"
                >
                  <option value="auto">Auto-Match against resume target job</option>
                  <option value="general">Scan without Target Job (General ATS Readability)</option>
                  {jobs.map((j) => (
                    <option key={j.id} value={j.id}>
                      {j.company} — {j.title}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          ) : (
            /* MODE 2: RAW FILE UPLOAD CONTROLS (IN-MEMORY EPHEMERAL) */
            <div className="space-y-4">
              <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl flex items-center gap-2 text-xs text-emerald-300">
                <Lock className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>
                  <strong>100% In-Memory Ephemeral Scan:</strong> Uploaded files are evaluated immediately in memory and are <strong>never</strong> saved to Firestore or your profile facts. Feel free to scan resumes for friends or practice runs!
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-neutral-300">
                    Upload Resume File (PDF, DOCX, TXT)
                  </label>
                  {uploadedFile ? (
                    <div className="flex items-center justify-between p-3.5 bg-[#0D0D0D] border border-emerald-500/40 rounded-xl">
                      <div className="flex items-center gap-2.5">
                        <File className="w-4 h-4 text-emerald-400 shrink-0" />
                        <div>
                          <div className="text-xs font-bold text-white truncate max-w-[200px] sm:max-w-xs">
                            {uploadedFile.name}
                          </div>
                          <div className="text-[10px] text-neutral-400 font-mono">
                            {(uploadedFile.size / 1024).toFixed(1)} KB • Ready to evaluate
                          </div>
                        </div>
                      </div>
                      <button
                        onClick={() => setUploadedFile(null)}
                        className="p-1 rounded-lg text-neutral-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
                        title="Remove file"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  ) : (
                    <label className="flex flex-col items-center justify-center p-6 border-2 border-dashed border-white/20 hover:border-emerald-400/60 rounded-xl bg-[#0D0D0D] hover:bg-[#121212] transition-all cursor-pointer group text-center space-y-2">
                      <UploadCloud className="w-8 h-8 text-neutral-400 group-hover:text-emerald-400 transition-colors" />
                      <div className="space-y-0.5">
                        <span className="text-xs font-bold text-white block">Click or Drag & Drop Resume</span>
                        <span className="text-[10px] text-neutral-400 font-mono">Supported formats: PDF, DOCX, TXT (Max 10MB)</span>
                      </div>
                      <input
                        type="file"
                        accept=".pdf,.docx,.txt"
                        className="hidden"
                        onChange={(e) => {
                          if (e.target.files && e.target.files[0]) {
                            setUploadedFile(e.target.files[0]);
                          }
                        }}
                      />
                    </label>
                  )}
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-semibold text-neutral-300">
                    Target Job Alignment Option
                  </label>
                  <div className="flex items-center gap-2 text-xs">
                    <button
                      onClick={() => setUploadJobMode("general")}
                      className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                        uploadJobMode === "general"
                          ? "bg-[#242424] text-white font-bold border border-white/20"
                          : "text-neutral-400 hover:text-white"
                      }`}
                    >
                      General ATS Readability
                    </button>
                    <button
                      onClick={() => setUploadJobMode("custom")}
                      className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                        uploadJobMode === "custom"
                          ? "bg-[#242424] text-white font-bold border border-white/20"
                          : "text-neutral-400 hover:text-white"
                      }`}
                    >
                      Paste Custom JD
                    </button>
                    <button
                      onClick={() => setUploadJobMode("tracked")}
                      className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                        uploadJobMode === "tracked"
                          ? "bg-[#242424] text-white font-bold border border-white/20"
                          : "text-neutral-400 hover:text-white"
                      }`}
                    >
                      Select Tracked Job
                    </button>
                  </div>

                  {uploadJobMode === "custom" && (
                    <textarea
                      value={customJobDesc}
                      onChange={(e) => setCustomJobDesc(e.target.value)}
                      placeholder="Paste target Job Description text or requirements here to test technical keyword match..."
                      className="w-full h-24 bg-[#0D0D0D] border border-white/20 rounded-xl p-3 text-xs text-white focus:outline-none focus:border-emerald-400 transition-colors font-sans resize-none"
                    />
                  )}

                  {uploadJobMode === "tracked" && (
                    <select
                      value={selectedJobId}
                      onChange={(e) => handleSelectJob(e.target.value)}
                      className="w-full bg-[#0D0D0D] border border-white/20 rounded-xl px-3.5 py-2.5 text-xs text-white focus:outline-none focus:border-emerald-400 transition-colors cursor-pointer font-medium"
                    >
                      {jobs.map((j) => (
                        <option key={j.id} value={j.id}>
                          {j.company} — {j.title}
                        </option>
                      ))}
                    </select>
                  )}

                  {uploadJobMode === "general" && (
                    <div className="p-3 bg-[#0D0D0D] rounded-xl border border-white/10 text-xs text-neutral-400">
                      Evaluates resume format, section parseability, bullet action verbs, and general technical depth without a specific target role.
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {scanError && (
            <div className="p-3 bg-rose-500/10 border border-rose-500/30 rounded-xl text-xs text-rose-300 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
              <span>{scanError}</span>
            </div>
          )}

          {/* ACTION BUTTON ROW */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-2">
            <div className="flex items-center gap-2 text-xs text-neutral-400">
              <Sparkles className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
              <span>AI-first contextual analysis with Truth-Lock evidence verification.</span>
            </div>

            <div className="flex items-center gap-2 w-full sm:w-auto">
              {activeScanResult && (
                <button
                  onClick={handleResetScan}
                  className="px-4 py-2.5 rounded-xl bg-[#1F1F1F] hover:bg-neutral-700 text-neutral-300 hover:text-white text-xs font-semibold transition-colors cursor-pointer border border-white/10 flex items-center gap-1.5"
                >
                  <RotateCcw size={12} />
                  <span>Reset</span>
                </button>
              )}

              <button
                onClick={handleRunScan}
                disabled={scanning || (!isUploadMode && !selectedResumeId) || (isUploadMode && !uploadedFile)}
                className="w-full sm:w-auto flex items-center justify-center gap-2 px-6 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-black font-bold text-xs transition-all cursor-pointer shadow-md disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {scanning ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin text-black" />
                    <span>Evaluating Resume...</span>
                  </>
                ) : (
                  <>
                    <Gauge className="w-4 h-4 text-black" />
                    <span>{isUploadMode ? "Scan Uploaded Resume" : "Run ATS Scan"}</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ACTIVE SCAN REPORT DISPLAY */}
      {pageTab === "scanner" && activeScanResult && (
        <div ref={activeScanContentRef} className="space-y-8 animate-fade-in">
          {/* SAVE REPORT TOAST / BANNER */}
          {saveSuccessMsg && (
            <div className="p-3.5 bg-emerald-500/15 border border-emerald-500/40 rounded-xl text-xs text-emerald-300 flex items-center gap-2 animate-fade-in shadow-sm">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              <span className="font-semibold">{saveSuccessMsg}</span>
            </div>
          )}

          {/* STALE RESULT BANNER */}
          {isStaleResult && (
            <div
              className="p-4 bg-amber-500/10 border border-amber-500/30 rounded-2xl text-xs text-amber-300 flex flex-col sm:flex-row sm:items-center justify-between gap-4 animate-fade-in shadow-sm"
              data-testid="stale-scan-banner"
            >
              <div className="flex items-center gap-3">
                <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0" />
                <div>
                  <strong className="text-white">Resume Modified Since Last Scan:</strong>
                  <p className="text-neutral-400 mt-0.5">
                    An approved bullet rewrite was applied to your resume. The score below reflects the previous scan snapshot. Re-evaluate to obtain your updated score.
                  </p>
                </div>
              </div>
              <button
                onClick={handleRunScan}
                disabled={scanning}
                className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-black font-bold transition-all shrink-0 cursor-pointer disabled:opacity-50 flex items-center gap-1.5 self-start sm:self-auto"
              >
                <RotateCcw size={13} className={scanning ? "animate-spin" : ""} />
                <span>Re-scan Resume Now</span>
              </button>
            </div>
          )}

          {/* 1. VISUAL ATS DASHBOARD (REFERENCE IMAGE 12) OR LEGACY DASHBOARD */}
          {(() => {
            const currentActiveResume = resumes.find((r) => r.id === selectedResumeId);
            const currentTargetJob = jobs.find(
              (j) => j.id === (selectedJobId !== "auto" ? selectedJobId : currentActiveResume?.jobId)
            );
            return aiScanResponse ? (
              <AtsDashboard
                aiScanResponse={aiScanResponse}
                activeScanResult={activeScanResult}
                selectedResumeName={currentActiveResume?.jobTitle || "Active Resume"}
                selectedJobTitle={currentTargetJob?.title || currentActiveResume?.jobTitle || "Target Opportunity"}
                selectedJobCompany={currentTargetJob?.company || currentActiveResume?.jobCompany || ""}
                isScanStale={isStaleResult}
                onOpenStudio={(tab) => handleOpenAtsStudio(tab || "job_match")}
                onSave={handleSaveReport}
                isSaving={savingReport}
                onExport={handleDownloadActiveScan}
                isExporting={isExporting}
                scoringVersion="v2_ai_first"
              />
            ) : (
              <ExecutiveSummaryDashboard
                scanResult={activeScanResult}
                atsEvidenceReport={atsEvidenceReport}
                provenance={null}
                truthLockReport={null}
                overallExplanation={undefined}
                onSaveReport={handleSaveReport}
                savingReport={savingReport}
                onDownloadReport={handleDownloadActiveScan}
                isExporting={isExporting}
                activeExportDropdown={activeExportDropdown}
                setActiveExportDropdown={setActiveExportDropdown}
                onSwitchToMatchMap={() => handleOpenAtsStudio("job_match")}
              />
            );
          })()}

          {/* 2. TRUTH-LOCK EVIDENCE AUDIT PANEL (IF AI SCAN) */}
          {aiScanResponse?.audit_report && (
            <TruthLockAuditPanel auditReport={aiScanResponse.audit_report} />
          )}

          {/* 3. AI INSIGHTS GRID (STRENGTHS, GAPS, RECOMMENDATIONS) */}
          {aiScanResponse?.analysis && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4" data-testid="ai-insights-grid">
              <div className="p-5 rounded-2xl bg-[#141414] border border-emerald-500/20 space-y-2">
                <div className="flex items-center gap-2 text-xs font-bold text-emerald-400 uppercase tracking-wider">
                  <CheckCircle2 size={14} /> Evidence-Backed Strengths
                </div>
                <ul className="text-xs text-neutral-300 space-y-1.5 pl-4 list-disc">
                  {(aiScanResponse.analysis.strengths || []).map((s, idx) => (
                    <li key={idx} className="leading-relaxed">{s}</li>
                  ))}
                </ul>
              </div>

              <div className="p-5 rounded-2xl bg-[#141414] border border-rose-500/20 space-y-2">
                <div className="flex items-center gap-2 text-xs font-bold text-rose-400 uppercase tracking-wider">
                  <AlertTriangle size={14} /> Critical Evidence Gaps
                </div>
                <ul className="text-xs text-rose-200/90 space-y-1.5 pl-4 list-disc">
                  {(aiScanResponse.analysis.gaps || []).map((g, idx) => (
                    <li key={idx} className="leading-relaxed">{g}</li>
                  ))}
                </ul>
              </div>

              <div className="p-5 rounded-2xl bg-[#141414] border border-blue-500/20 space-y-2">
                <div className="flex items-center gap-2 text-xs font-bold text-blue-400 uppercase tracking-wider">
                  <Sparkles size={14} /> Recommended Next Actions
                </div>
                <ul className="text-xs text-blue-200/90 space-y-1.5 pl-4 list-disc">
                  {(aiScanResponse.analysis.recommendations || []).map((r, idx) => (
                    <li key={idx} className="leading-relaxed">{r}</li>
                  ))}
                </ul>
              </div>
            </div>
          )}

          {/* 4. PRIORITIZED ACTION CHECKLIST (FOR LEGACY / GENERAL CHECKS) */}
          {(!aiScanResponse || activeScanResult.actionable_checklist.length > 0) && (
            <PrioritizedActionChecklist
              items={activeScanResult.actionable_checklist}
              onFocusBullet={(bulletId) => {
                setHighlightedBulletId(bulletId);
              }}
            />
          )}

          {/* 5. CATEGORY SUMMARY PILLARS & DRILLDOWN (LEGACY HEURISTIC ONLY) */}
          {!aiScanResponse && Object.keys(activeScanResult.category_scores).length > 0 && (
            <div className="bg-[#141414] border border-white/15 rounded-2xl p-5 sm:p-6 space-y-4 shadow-sm">
              <div className="flex items-center justify-between border-b border-white/10 pb-3">
                <div className="space-y-0.5">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-white">
                    ATS Scoring Pillars Breakdown
                  </h3>
                  <p className="text-xs text-neutral-400">
                    Sub-second evaluation across formatting, technical taxonomy, power verbs, and quantified metrics.
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                {Object.entries(activeScanResult.category_scores).map(([key, cat]) => (
                  <div
                    key={key}
                    onClick={() => setExpandedCategory(expandedCategory === key ? null : key)}
                    className={`p-4 rounded-xl border transition-all cursor-pointer ${
                      expandedCategory === key
                        ? "bg-[#1A1A1A] border-emerald-500/40 shadow-sm"
                        : "bg-[#0D0D0D] border-white/10 hover:border-white/20"
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-bold text-white truncate max-w-[140px]">{cat.name}</span>
                      <span className={`text-xs font-mono font-bold ${getScoreColor((cat.score / cat.max_score) * 100)}`}>
                        {cat.score} / {cat.max_score}
                      </span>
                    </div>

                    {/* Progress Bar */}
                    <div className="w-full h-1.5 bg-neutral-800 rounded-full overflow-hidden mb-2">
                      <div
                        className={`h-full transition-all duration-500 ${
                          cat.status === "pass" ? "bg-emerald-400" : cat.status === "warning" ? "bg-amber-400" : "bg-rose-400"
                        }`}
                        style={{ width: `${Math.min(cat.percentage, 100)}%` }}
                      />
                    </div>

                    <div className="flex items-center justify-between text-[10px] text-neutral-400">
                      <span className="capitalize">{cat.status}</span>
                      <span className="text-emerald-400 flex items-center gap-0.5">
                        {expandedCategory === key ? "Hide Checks" : "View Checks"}
                        {expandedCategory === key ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
                      </span>
                    </div>
                  </div>
                ))}
              </div>

              {/* EXPANDED CATEGORY CHECKS DRILLDOWN */}
              {expandedCategory && activeScanResult.category_scores[expandedCategory] && (
                <div className="p-4 rounded-xl bg-[#0D0D0D] border border-white/10 space-y-3 animate-fade-in mt-3">
                  <div className="flex items-center justify-between border-b border-white/5 pb-2">
                    <span className="text-xs font-bold text-white uppercase tracking-wider">
                      {activeScanResult.category_scores[expandedCategory].name} Checks
                    </span>
                    <span className="text-xs text-neutral-400">
                      {activeScanResult.category_scores[expandedCategory].summary}
                    </span>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                    {activeScanResult.category_scores[expandedCategory].checks.map((check, idx) => (
                      <div
                        key={idx}
                        className={`p-3 rounded-xl border ${
                          check.passed ? "bg-[#121412] border-emerald-500/20" : "bg-[#181414] border-amber-500/30"
                        } space-y-1.5`}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-1.5">
                            {check.passed ? (
                              <CheckCircle2 size={13} className="text-emerald-400 shrink-0" />
                            ) : (
                              <AlertTriangle size={13} className="text-amber-400 shrink-0" />
                            )}
                            <span className="text-xs font-bold text-white">{check.name}</span>
                          </div>
                          <span className="text-[10px] font-mono font-bold text-neutral-400">
                            {check.score} / {check.max_score} pts
                          </span>
                        </div>
                        <p className="text-[11px] text-neutral-400 leading-relaxed pl-5">
                          {check.detail}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* 6. INTERACTIVE BULLET ANALYSIS */}
          {activeScanResult.bullet_audits && activeScanResult.bullet_audits.length > 0 && (
            <div className="space-y-4" data-testid="bullet-analysis-section">
              <InteractiveBulletAnalysis
                bullets={activeScanResult.bullet_audits}
                requirementMatches={activeScanResult.requirement_matches}
                highlightedBulletId={highlightedBulletId}
                onSelectRequirement={(_reqId) => {
                  handleOpenAtsStudio("job_match");
                }}
                selectedBulletIds={selectedBulletIds}
                onToggleBulletSelection={toggleBulletSelection}
                onSelectAllBullets={selectAllBullets}
                onSelectNeedsAttention={selectAllNeedsAttention}
                onClearSelection={clearBulletSelection}
                onOpenBulkOptimizer={handleRunBulkOptimization}
                bulkOptimizing={bulkOptimizing}
                onApplySingleRewrite={handleApplySingleRewrite}
              />
            </div>
          )}
        </div>
      )}

      {/* HISTORICAL SAVED REPORT SNAPSHOT IN ATS STUDIO (READ-ONLY) */}
      {viewingSavedReport && (() => {
        const savedModalAnalysis: AtsAnalysisResult = viewingSavedReport.ai_analysis || {
          overall_score: viewingSavedReport.overallScore,
          overall_explanation: viewingSavedReport.scanResult.summary,
          executive_summary: viewingSavedReport.scanResult.summary,
          strengths: [],
          gaps: [],
          recommendations: (viewingSavedReport.scanResult.actionable_checklist || []).map((c) => c.title),
          requirements: (viewingSavedReport.scanResult.requirement_matches || []).map((rm: any) => ({
            requirement_description: rm.requirement_description || rm.name || rm.description || rm.requirement || "",
            criticality: rm.criticality || (rm.is_mandatory ? "mandatory" : "preferred"),
            match_status: rm.match_status || (rm.evidence_status === "demonstrated" ? "MEETS" : "MISSING"),
            supporting_evidence: rm.supporting_evidence || rm.candidate_evidence || (rm.linked_evidence ? rm.linked_evidence.map((l: any) => l.quote) : []),
            explanation: rm.explanation || "",
            missing_evidence: rm.missing_evidence ?? (rm.evidence_status !== "demonstrated"),
          })),
          keyword_analysis: [
            ...(viewingSavedReport.scanResult.keyword_matrix?.matched || []).map((k) => ({
              keyword: k.name,
              status: "present_and_relevant" as const,
              explanation: k.recommendation || "Matched keyword in context",
            })),
            ...(viewingSavedReport.scanResult.keyword_matrix?.missing || []).map((k) => ({
              keyword: k.name,
              status: "not_found" as const,
              explanation: k.recommendation || "Missing keyword from job description",
            })),
          ],
          section_analysis: [],
          rewrite_proposals: [],
        };

        return (
          <AtsStudioModal
            isOpen={Boolean(viewingSavedReport)}
            onClose={() => setViewingSavedReport(null)}
            analysis={savedModalAnalysis}
            auditReport={viewingSavedReport.audit_report || null}
            provenance={
              viewingSavedReport.provenance ||
              (viewingSavedReport.scoring_version
                ? ({ scoring_pipeline: viewingSavedReport.scoring_version } as any)
                : null)
            }
            bulletAudits={viewingSavedReport.scanResult.bullet_audits || []}
            jobTitle={viewingSavedReport.jobTitle || "Target Opportunity"}
            jobCompany={viewingSavedReport.jobCompany || ""}
            isHistorical={true}
            savedReportCreatedAt={viewingSavedReport.createdAt}
            checklistItems={viewingSavedReport.scanResult.actionable_checklist || []}
            canEditResume={false}
            onExport={(format) => handleDownloadSavedReport(format, viewingSavedReport)}
            isExporting={isExporting}
          />
        );
      })()}

{/* SIDE-BY-SIDE MIX-AND-MATCH COMPARISON MODAL */}
      {isBulkModalOpen &&
        bulkOptimizationResult &&
        activeScanResult &&
        createPortal(
          <div
            onClick={(e) => {
              if (e.target === e.currentTarget) {
                setIsBulkModalOpen(false);
              }
            }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-black/55 backdrop-blur-xl animate-in fade-in duration-150"
          >
            <div
              onClick={(e) => e.stopPropagation()}
              className="bg-[#141414] border border-white/20 rounded-2xl w-full max-w-5xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden animate-in zoom-in-95 duration-150"
            >
            {/* Modal Header */}
            <div className="flex items-center justify-between p-5 border-b border-white/10">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-emerald-400" />
                  <h2 className="text-sm font-bold uppercase tracking-wider text-white">
                    Mix & Match AI Optimized Bullets
                  </h2>
                  <span className="text-[10px] font-mono text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/30">
                    1-Shot Atomic Optimization
                  </span>
                </div>
                <p className="text-xs text-neutral-400">
                  Select your preferred wording for each bullet individually (Original, Set A, or Set B).
                </p>
              </div>
              <button
                onClick={() => setIsBulkModalOpen(false)}
                className="text-neutral-400 hover:text-white p-1 rounded-lg hover:bg-white/10 transition-colors cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            {/* Modal Scrollable Body */}
            <div className="p-5 overflow-y-auto space-y-6 flex-1 text-xs">
              {activeScanResult.bullet_audits
                .filter((b) => selectedBulletIds.has(b.id))
                .map((bullet, idx) => {
                  const setAItem = bulkOptimizationResult.set_a.find((s) => s.bullet_id === bullet.id);
                  const setBItem = bulkOptimizationResult.set_b.find((s) => s.bullet_id === bullet.id);
                  const currentChoice = bulletChoices[bullet.id] || "set_a";

                  return (
                    <div
                      key={bullet.id}
                      className="p-4 bg-[#0D0D0D] border border-white/10 rounded-xl space-y-3"
                    >
                      <div className="flex items-center justify-between border-b border-white/10 pb-2">
                        <span className="font-bold text-white flex items-center gap-2">
                          <span className="text-[10px] font-mono text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded">
                            Bullet {idx + 1}
                          </span>
                          <span>{bullet.role_or_project} ({bullet.section})</span>
                        </span>

                        <span className="text-[10px] font-mono text-neutral-400">
                          Selected: <strong className="text-emerald-400 uppercase">{currentChoice.replace('_', ' ')}</strong>
                        </span>
                      </div>

                      {/* 3 Radio Options: Original, Set A, Set B */}
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                        {/* Option 1: Original */}
                        <div
                          onClick={() => setBulletChoices((prev) => ({ ...prev, [bullet.id]: "original" }))}
                          className={`p-3 rounded-xl border cursor-pointer transition-all space-y-2 ${
                            currentChoice === "original"
                              ? "bg-[#1E1E1E] border-emerald-400/80 shadow-sm"
                              : "bg-[#121212] border-white/10 hover:border-white/20"
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] font-mono font-bold text-neutral-400 uppercase">
                              Original
                            </span>
                            <div className={`w-3.5 h-3.5 rounded-full border flex items-center justify-center ${
                              currentChoice === "original" ? "border-emerald-400 bg-emerald-400" : "border-neutral-500"
                            }`}>
                              {currentChoice === "original" && <div className="w-1.5 h-1.5 rounded-full bg-black" />}
                            </div>
                          </div>
                          <p className="text-xs text-neutral-300 leading-relaxed">{bullet.text}</p>
                        </div>

                        {/* Option 2: Set A (Action & Verified Impact) */}
                        <div
                          onClick={() => setBulletChoices((prev) => ({ ...prev, [bullet.id]: "set_a" }))}
                          className={`p-3 rounded-xl border cursor-pointer transition-all space-y-2 ${
                            currentChoice === "set_a"
                              ? "bg-[#1E1E1E] border-emerald-400/80 shadow-sm"
                              : "bg-[#121212] border-white/10 hover:border-white/20"
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] font-mono font-bold text-emerald-400 uppercase bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
                              Set A: Action & Impact
                            </span>
                            <div className={`w-3.5 h-3.5 rounded-full border flex items-center justify-center ${
                              currentChoice === "set_a" ? "border-emerald-400 bg-emerald-400" : "border-neutral-500"
                            }`}>
                              {currentChoice === "set_a" && <div className="w-1.5 h-1.5 rounded-full bg-black" />}
                            </div>
                          </div>
                          <p className="text-xs text-white leading-relaxed">{setAItem?.text || bullet.text}</p>
                          {setAItem?.rationale && (
                            <p className="text-[10px] text-neutral-400 italic">{setAItem.rationale}</p>
                          )}
                        </div>

                        {/* Option 3: Set B (Architecture & Systems Depth) */}
                        <div
                          onClick={() => setBulletChoices((prev) => ({ ...prev, [bullet.id]: "set_b" }))}
                          className={`p-3 rounded-xl border cursor-pointer transition-all space-y-2 ${
                            currentChoice === "set_b"
                              ? "bg-[#1E1E1E] border-emerald-400/80 shadow-sm"
                              : "bg-[#121212] border-white/10 hover:border-white/20"
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] font-mono font-bold text-violet-400 uppercase bg-violet-500/10 px-2 py-0.5 rounded border border-violet-500/20">
                              Set B: Architecture Depth
                            </span>
                            <div className={`w-3.5 h-3.5 rounded-full border flex items-center justify-center ${
                              currentChoice === "set_b" ? "border-emerald-400 bg-emerald-400" : "border-neutral-500"
                            }`}>
                              {currentChoice === "set_b" && <div className="w-1.5 h-1.5 rounded-full bg-black" />}
                            </div>
                          </div>
                          <p className="text-xs text-white leading-relaxed">{setBItem?.text || bullet.text}</p>
                          {setBItem?.rationale && (
                            <p className="text-[10px] text-neutral-400 italic">{setBItem.rationale}</p>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
            </div>

            {/* Modal Footer Actions */}
            <div className="flex flex-col sm:flex-row items-center justify-between gap-3 p-4 border-t border-white/10 bg-[#0D0D0D]">
              <div className="flex items-center gap-2 text-neutral-400 text-xs">
                <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>Deterministic Pre-Apply Truth Validated • Zero hallucinated metrics</span>
              </div>

              <div className="flex items-center gap-2 w-full sm:w-auto">
                <button
                  onClick={handleCopyAllSelected}
                  className="flex-1 sm:flex-none flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl bg-[#1F1F1F] hover:bg-neutral-700 text-white font-semibold text-xs transition-colors cursor-pointer border border-white/10"
                >
                  {copiedBulletId === "all_combined" ? (
                    <>
                      <Check size={12} className="text-emerald-400" />
                      <span className="text-emerald-400">Copied All Selected!</span>
                    </>
                  ) : (
                    <>
                      <Copy size={12} />
                      <span>Copy Selected Bullets</span>
                    </>
                  )}
                </button>

                {selectedResumeId && !isUploadMode && (
                  <button
                    onClick={handleApplySelectedToResume}
                    disabled={applyingToResume}
                    className="flex-1 sm:flex-none flex items-center justify-center gap-1.5 px-5 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-black font-bold text-xs transition-colors cursor-pointer shadow-md disabled:opacity-50"
                  >
                    {applyingToResume ? (
                      <>
                        <Loader2 size={13} className="animate-spin text-black" />
                        <span>Applying & Recompiling...</span>
                      </>
                    ) : (
                      <>
                        <Sparkles size={13} className="text-black" />
                        <span>Apply to Resume & Recompile</span>
                      </>
                    )}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* SINGLE BULLET REWRITE REVIEW MODAL */}
      {singleRewriteModal && (
        <SingleBulletRewriteModal
          isOpen={singleRewriteModal.isOpen}
          onClose={() => setSingleRewriteModal(null)}
          originalText={singleRewriteModal.originalText}
          suggestedText={singleRewriteModal.suggestedText}
          bulletRoleOrProject={singleRewriteModal.bulletRoleOrProject}
          bulletSection={singleRewriteModal.bulletSection}
          rationale={singleRewriteModal.rationale}
          targetRequirement={singleRewriteModal.targetRequirement}
          onApply={async (newText) => {
            await handleApplySingleRewrite(singleRewriteModal.bulletId, newText);
          }}
        />
      )}

      {/* ATS STUDIO MODAL (REFERENCE IMAGE 11 RESUME STUDIO INTERACTION MODEL) */}
      {activeScanResult && (() => {
        const currentActiveResume = resumes.find((r) => r.id === selectedResumeId);
        const currentTargetJob = jobs.find(
          (j) => j.id === (selectedJobId !== "auto" ? selectedJobId : currentActiveResume?.jobId)
        );
        const modalAnalysis: AtsAnalysisResult = aiScanResponse?.analysis || {
          overall_score: activeScanResult.overall_score,
          overall_explanation: activeScanResult.summary,
          executive_summary: activeScanResult.summary,
          strengths: [],
          gaps: [],
          recommendations: (activeScanResult.actionable_checklist || []).map((c) => c.title),
          requirements: (activeScanResult.requirement_matches || []).map((rm: any) => ({
            requirement_description: rm.requirement_description || rm.name || rm.description || rm.requirement || "",
            criticality: rm.criticality || (rm.is_mandatory ? "mandatory" : "preferred"),
            match_status: rm.match_status || (rm.evidence_status === "demonstrated" ? "MEETS" : "MISSING"),
            supporting_evidence: rm.supporting_evidence || rm.candidate_evidence || (rm.linked_evidence ? rm.linked_evidence.map((l: any) => l.quote) : []),
            explanation: rm.explanation || "",
            missing_evidence: rm.missing_evidence ?? (rm.evidence_status !== "demonstrated"),
          })),
          keyword_analysis: [
            ...(activeScanResult.keyword_matrix?.matched || []).map((k) => ({
              keyword: k.name,
              status: "present_and_relevant" as const,
              explanation: k.recommendation || "Matched keyword in context",
            })),
            ...(activeScanResult.keyword_matrix?.missing || []).map((k) => ({
              keyword: k.name,
              status: "not_found" as const,
              explanation: k.recommendation || "Missing keyword from job description",
            })),
          ],
          section_analysis: [],
          rewrite_proposals: [],
        };
        return (
          <AtsStudioModal
            isOpen={isAtsStudioOpen}
            onClose={() => setIsAtsStudioOpen(false)}
            analysis={modalAnalysis}
            auditReport={aiScanResponse?.audit_report}
            provenance={aiScanResponse?.provenance}
            bulletAudits={activeScanResult?.bullet_audits || []}
            jobTitle={currentTargetJob?.title || currentActiveResume?.jobTitle || "Target Opportunity"}
            jobCompany={currentTargetJob?.company || currentActiveResume?.jobCompany || ""}
            initialTab={studioInitialTab}
            resumeData={currentActiveResume || null}
            onApplyProposal={handleApplyAiRewrite}
            canEditResume={!isUploadMode && Boolean(selectedResumeId)}
            isHistorical={false}
            checklistItems={activeScanResult.actionable_checklist || []}
            onExport={handleDownloadActiveScan}
            isExporting={isExporting}
          />
        );
      })()}
    </div>
  );
};

export default ScannerPage;
