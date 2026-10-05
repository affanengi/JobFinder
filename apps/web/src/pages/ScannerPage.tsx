import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useScrollLock } from "../hooks/useScrollLock";
import {
  Gauge,
  ShieldCheck,
  Sparkles,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  ChevronDown,
  ChevronUp,
  Copy,
  Check,
  Loader2,
  ListFilter,
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
  CheckSquare,
  Square,
  Download,
  Printer,
  Globe,
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

export interface CategoryCheckItem {
  name: string;
  passed: boolean;
  score: number;
  max_score: number;
  detail: string;
}

export interface CategoryScore {
  name: string;
  score: number;
  max_score: number;
  percentage: number;
  status: "pass" | "warning" | "fail";
  summary: string;
  checks: CategoryCheckItem[];
}

export interface KeywordMatchDetail {
  id: string;
  name: string;
  category: string;
  importance: "High" | "Medium" | "Bonus";
  status: "matched" | "missing" | "transferable";
  recommendation?: string;
}

export interface KeywordMatrix {
  matched: KeywordMatchDetail[];
  missing: KeywordMatchDetail[];
  transferable: KeywordMatchDetail[];
  match_percentage: number;
  total_jd_keywords: number;
  matched_count: number;
  missing_count: number;
  transferable_count: number;
}

export interface BulletAuditItem {
  id: string;
  section: string;
  role_or_project: string;
  text: string;
  score: number;
  status: "strong" | "moderate" | "weak";
  has_action_verb: boolean;
  has_metric: boolean;
  has_weak_opener: boolean;
  verb?: string | null;
  word_count: number;
  issues: string[];
}

export interface ChecklistItem {
  id: string;
  priority: "critical" | "high" | "medium" | "low";
  category: string;
  title: string;
  description: string;
  passed: boolean;
  impact_points: number;
}

export interface ScanMetadata {
  resume_id?: string;
  job_id?: string;
  source_type: "tailored_resume" | "file_upload";
  file_name?: string;
  page_count: number;
  word_count: number;
  estimated_read_time: string;
  taxonomy_version: string;
}

export interface AtsScanResult {
  overall_score: number;
  grade: "A+" | "A" | "B" | "C" | "D";
  summary: string;
  category_scores: Record<string, CategoryScore>;
  keyword_matrix: KeywordMatrix;
  bullet_audits: BulletAuditItem[];
  actionable_checklist: ChecklistItem[];
  metadata: ScanMetadata;
}

export interface OptimizedBulletItem {
  bullet_id: string;
  text: string;
  style: string;
  has_action_verb: boolean;
  has_metric: boolean;
  rationale: string;
  is_valid: boolean;
  validation_issues: string[];
}

export interface BulkAiBulletRewriteResponse {
  set_a: OptimizedBulletItem[];
  set_b: OptimizedBulletItem[];
  total_processed: number;
  validation_passed: boolean;
}

export interface SavedScanReportDTO {
  id: string;
  userId: string;
  reportName: string;
  sourceType: "tailored_resume" | "file_upload";
  resumeId?: string;
  resumeContentHash?: string;
  jobId?: string;
  jobTitle?: string;
  jobCompany?: string;
  overallScore: number;
  grade: string;
  scanResult: AtsScanResult;
  taxonomyVersion: string;
  createdAt: string;
  updatedAt: string;
}

// -------------------------------------------------------------
// RADIAL PROGRESS GAUGE COMPONENT
// -------------------------------------------------------------
const RadialScoreGauge = ({ score }: { score: number }) => {
  const radius = 44;
  const strokeWidth = 7;
  const circumference = 2 * Math.PI * radius; // ~276.46
  const normalizedScore = Math.min(Math.max(score, 0), 100);
  const strokeDashoffset = circumference - (normalizedScore / 100) * circumference;

  const strokeColor =
    score >= 80 ? "#34d399" : score >= 65 ? "#fbbf24" : "#f87171";
  const glowColor =
    score >= 80
      ? "rgba(52, 211, 153, 0.3)"
      : score >= 65
      ? "rgba(251, 191, 36, 0.3)"
      : "rgba(248, 113, 113, 0.3)";

  return (
    <div className="relative flex items-center justify-center shrink-0 w-28 h-28">
      <svg className="w-28 h-28 -rotate-90 transform" viewBox="0 0 100 100">
        {/* Background Track Circle */}
        <circle
          cx="50"
          cy="50"
          r="44"
          fill="transparent"
          stroke="#222222"
          strokeWidth={strokeWidth}
          className="opacity-70"
        />
        {/* Animated Active Score Arc */}
        <circle
          cx="50"
          cy="50"
          r="44"
          fill="transparent"
          stroke={strokeColor}
          strokeWidth={strokeWidth}
          strokeDasharray={circumference}
          strokeDashoffset={strokeDashoffset}
          strokeLinecap="round"
          className="transition-all duration-1000 ease-out"
          style={{
            filter: 'drop-shadow(0 0 6px ' + glowColor + ')',
          }}
        />
      </svg>
      {/* Centered Score Label */}
      <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
        <span className={'text-3xl font-black font-mono tracking-tight ' + (
          score >= 80 ? 'text-emerald-400' : score >= 65 ? 'text-amber-400' : 'text-rose-400'
        )}>
          {score}
        </span>
        <span className="text-[10px] text-neutral-400 uppercase tracking-widest font-mono -mt-0.5">
          / 100
        </span>
      </div>
    </div>
  );
};

export interface ScannerPageProps {
  initialResumeId?: string | null;
  initialJobId?: string | null;
  onOpenResumeStudio?: (resumeId: string, jobId?: string) => void | Promise<void>;
  onNavigateToStudio?: (resumeId?: string) => void;
  onNavigateToResumes?: () => void;
}

export const ScannerPage = ({
  initialResumeId,
  initialJobId,
  onOpenResumeStudio,
  onNavigateToStudio,
  onNavigateToResumes: _onNavigateToResumes,
}: ScannerPageProps) => {
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
  const [keywordTab, setKeywordTab] = useState<"matched" | "missing" | "transferable">("matched");
  const [bulletFilter, setBulletFilter] = useState<"all" | "weak" | "strong">("all");
  const [copiedBulletId, setCopiedBulletId] = useState<string | null>(null);

  // Bulk Bullet Optimization State
  const [selectedBulletIds, setSelectedBulletIds] = useState<Set<string>>(new Set());
  const [bulkOptimizing, setBulkOptimizing] = useState<boolean>(false);
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [bulkOptimizationResult, setBulkOptimizationResult] = useState<BulkAiBulletRewriteResponse | null>(null);
  const [bulletChoices, setBulletChoices] = useState<Record<string, "original" | "set_a" | "set_b">>({});
  const [isBulkModalOpen, setIsBulkModalOpen] = useState<boolean>(false);
  const [applyingToResume, setApplyingToResume] = useState<boolean>(false);

  // Global scroll lock for viewport modals
  useScrollLock(Boolean(viewingSavedReport || isBulkModalOpen));

  // Export DOM Refs & Status
  const savedReportContentRef = useRef<HTMLDivElement>(null);
  const activeScanContentRef = useRef<HTMLDivElement>(null);
  const [isExporting, setIsExporting] = useState<boolean>(false);
  const [activeExportDropdown, setActiveExportDropdown] = useState<string | null>(null);

  // Handle Export for Saved Report (from Modal)
  const handleDownloadSavedReport = async (format: "pdf" | "vector" | "html") => {
    if (!viewingSavedReport) return;
    const meta: ReportMeta = {
      reportName: viewingSavedReport.reportName,
      sourceType: viewingSavedReport.sourceType,
      overallScore: viewingSavedReport.overallScore,
      grade: viewingSavedReport.grade,
      createdAt: viewingSavedReport.createdAt,
      summary: viewingSavedReport.scanResult.summary,
    };

    if (format === "html") {
      downloadAtsReportHtml(viewingSavedReport.scanResult, meta);
      return;
    }

    if (format === "vector") {
      printAtsReportVector({ report: viewingSavedReport.scanResult, meta });
      return;
    }

    setIsExporting(true);
    try {
      await downloadAtsReportPdf({
        report: viewingSavedReport.scanResult,
        meta,
        fileName: `${viewingSavedReport.reportName}_ATS_Report.pdf`,
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
        if (isBulkModalOpen) {
          setIsBulkModalOpen(false);
        } else if (viewingSavedReport) {
          setViewingSavedReport(null);
        }
      }
    };
    if (viewingSavedReport || isBulkModalOpen) {
      window.addEventListener("keydown", handleKeyDown);
      return () => window.removeEventListener("keydown", handleKeyDown);
    }
  }, [viewingSavedReport, isBulkModalOpen]);

  // Load saved resumes, jobs, and saved reports on mount
  useEffect(() => {
    const fetchData = async () => {
      setLoadingData(true);
      try {
        const [resResumes, resJobs, resReports] = await Promise.all([
          fetchWithAuth("/api/v1/resumes", {
            headers: { "X-User-Id": user?.uid || "user_default" },
          }),
          fetchWithAuth("/api/v1/recommendations", {
            headers: { "X-User-Id": user?.uid || "user_default" },
          }),
          fetchWithAuth("/api/v1/scanner/reports", {
            headers: { "X-User-Id": user?.uid || "user_default" },
          }),
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
    setLoadingReports(true);
    try {
      const res = await fetchWithAuth("/api/v1/scanner/reports", {
        headers: { "X-User-Id": user?.uid || "user_default" },
      });
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
    const resume = resumes.find((r) => r.id === resumeId);
    if (resume) {
      setSelectedJobId(resume.jobId || "general");
    }
  };

  // Run ATS Scan (Deterministic Sub-Second Engine)
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
      } else {
        if (!selectedResumeId) {
          setScanError("Please select a tailored resume to scan.");
          setScanning(false);
          return;
        }

        const resolvedJobId = selectedJobId === "auto"
          ? resumes.find((r) => r.id === selectedResumeId)?.jobId
          : selectedJobId;

        const res = await fetchWithAuth("/api/v1/scanner/scan-tailored", {
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

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.detail || "Failed to scan tailored resume.");
        }

        const data: AtsScanResult = await res.json();
        setTailoredScanResult(data);

        // Fetch decoupled Phase 2 ATS Evidence Audit if job is resolved
        if (resolvedJobId && resolvedJobId !== "general" && resolvedJobId !== "auto") {
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

    try {
      const res = await fetchWithAuth("/api/v1/scanner/reports", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-User-Id": user?.uid || "user_default",
        },
        body: JSON.stringify({
          scanResult: activeScanResult,
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
    const attentionIds = activeScanResult.bullet_audits
      .filter((b) => b.status !== "strong" || !b.has_action_verb || !b.has_metric || b.has_weak_opener)
      .map((b) => b.id);
    setSelectedBulletIds(new Set(attentionIds));
  };

  const selectAllBullets = () => {
    if (!activeScanResult) return;
    const allIds = activeScanResult.bullet_audits.map((b) => b.id);
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
    setBulkError(null);

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
      setBulkError(msg);
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
              {pageTab === "saved_reports" ? "Saved ATS Archive" : "100-Point ATS Engine"}
            </span>
            <span className="text-xs text-neutral-400 font-mono">
              {pageTab === "saved_reports" ? "Immutable Scan Records" : "Taxonomy v1.0.0 • Free Local Scans"}
            </span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-white flex items-center gap-2">
            <span>{pageTab === "saved_reports" ? "Historical ATS Scan Reports" : "ATS Resume Scanner & Keyword Match"}</span>
          </h1>
          <p className="text-xs text-neutral-400 leading-relaxed max-w-2xl">
            {pageTab === "saved_reports"
              ? "Review immutable snapshots of your previous scans to track score improvements and keyword alignments over time."
              : "Evaluate any resume against real-world Applicant Tracking Systems with sub-second deterministic scoring across formatting, technical taxonomy, power verbs, and quantified metrics."}
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

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center pt-2 border-t border-white/10">
                    <div className="p-2 bg-[#0D0D0D] rounded-xl border border-white/5">
                      <div className="text-[10px] text-neutral-500 font-mono">Format</div>
                      <div className="text-xs font-bold text-white">{report.scanResult.category_scores.parseability?.score || 0}/25</div>
                    </div>
                    <div className="p-2 bg-[#0D0D0D] rounded-xl border border-white/5">
                      <div className="text-[10px] text-neutral-500 font-mono">Keywords</div>
                      <div className="text-xs font-bold text-white">{report.scanResult.category_scores.keyword_match?.score || 0}/30</div>
                    </div>
                    <div className="p-2 bg-[#0D0D0D] rounded-xl border border-white/5">
                      <div className="text-[10px] text-neutral-500 font-mono">Verbs</div>
                      <div className="text-xs font-bold text-white">{report.scanResult.category_scores.impact_verbs?.score || 0}/25</div>
                    </div>
                    <div className="p-2 bg-[#0D0D0D] rounded-xl border border-white/5">
                      <div className="text-[10px] text-neutral-500 font-mono">Structure</div>
                      <div className="text-xs font-bold text-white">{report.scanResult.category_scores.structural_integrity?.score || 0}/20</div>
                    </div>
                  </div>

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
                <label className="text-xs font-semibold text-neutral-300 flex items-center justify-between">
                  <span>Select Saved Tailored Resume</span>
                  <span className="text-[10px] text-emerald-400 font-mono">100% Free Local Scan</span>
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
                  onChange={(e) => setSelectedJobId(e.target.value)}
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
                      onChange={(e) => setSelectedJobId(e.target.value)}
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
              <Zap className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
              <span>Fast local deterministic analysis with sub-second performance ($0 API cost).</span>
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
                    <span>{isUploadMode ? "Scan Uploaded Resume" : "Run 100-Point ATS Scan"}</span>
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

          {/* 100-POINT HERO SCORE CARD */}
          <div className="bg-[#141414] border border-white/15 rounded-2xl p-6 sm:p-8 space-y-6 shadow-sm">
            <div className="flex flex-col xl:flex-row items-start xl:items-center justify-between gap-6">
              {/* Radial Gauge & Score */}
              <div className="flex flex-col sm:flex-row items-start sm:items-center gap-5 sm:gap-6 flex-1 min-w-0">
                <RadialScoreGauge score={activeScanResult.overall_score} />

                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <span className={`px-2.5 py-0.5 rounded-lg text-xs font-mono font-bold border ${getGradeBadge(activeScanResult.grade)}`}>
                      Grade {activeScanResult.grade}
                    </span>
                    <span className="text-xs text-neutral-400 font-mono">
                      {activeScanResult.metadata.word_count} words • ~{activeScanResult.metadata.estimated_read_time} read
                    </span>
                  </div>
                  <h2 className="text-xl font-bold text-white tracking-tight">
                    {activeScanResult.overall_score >= 80 ? "Competitive Resume with Key Optimization Areas" : "Needs Keyword & Formatting Polish"}
                  </h2>
                  <p className="text-xs text-neutral-400 leading-relaxed max-w-xl">
                    {activeScanResult.summary}
                  </p>
                </div>
              </div>

              {/* Action Buttons: Save Report & Quick Stats */}
              <div className="flex flex-col lg:flex-row items-stretch lg:items-center gap-4 w-full xl:w-auto shrink-0 pt-2 xl:pt-0">
                {/* 2 Quick Stat Pills */}
                <div className="flex items-center gap-2.5 shrink-0">
                  <div className="p-3 bg-[#0D0D0D] rounded-xl border border-white/10 text-center min-w-[125px]">
                    <div className="text-[10px] font-mono text-neutral-400 uppercase tracking-wider">Matched Keywords</div>
                    <div className="text-sm font-bold text-emerald-400 mt-0.5">
                      {activeScanResult.keyword_matrix.matched_count} / {activeScanResult.keyword_matrix.total_jd_keywords || activeScanResult.keyword_matrix.matched_count}
                    </div>
                  </div>

                  <div className="p-3 bg-[#0D0D0D] rounded-xl border border-white/10 text-center min-w-[125px]">
                    <div className="text-[10px] font-mono text-neutral-400 uppercase tracking-wider">Strong Action Verbs</div>
                    <div className="text-sm font-bold text-emerald-400 mt-0.5">
                      {activeScanResult.bullet_audits.filter((b) => b.has_action_verb).length} / {activeScanResult.bullet_audits.length} bullets
                    </div>
                  </div>
                </div>

                {/* Dedicated Vertical Stack for Actions: Download Report ABOVE Save Report */}
                {!viewingSavedReport && (
                  <div className="flex flex-col gap-2 min-w-[195px] justify-center">
                    {/* 1. TOP: DOWNLOAD REPORT DROPDOWN */}
                    <div className="relative w-full">
                      <div className="flex items-center w-full rounded-xl bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 shadow-sm overflow-hidden transition-all">
                        <button
                          onClick={() => handleDownloadActiveScan("pdf")}
                          disabled={isExporting}
                          className="flex-1 flex items-center justify-center gap-1.5 py-2.5 px-3 text-xs font-bold transition-all cursor-pointer disabled:opacity-50 whitespace-nowrap"
                          title="Download high-resolution styled PDF report"
                        >
                          {isExporting ? (
                            <>
                              <Loader2 size={13} className="animate-spin text-emerald-400" />
                              <span>Generating PDF...</span>
                            </>
                          ) : (
                            <>
                              <Download size={13} className="text-emerald-400" />
                              <span>Download Report (PDF)</span>
                            </>
                          )}
                        </button>
                        <button
                          onClick={() => setActiveExportDropdown(activeExportDropdown === "active" ? null : "active")}
                          className="px-2.5 py-2.5 border-l border-emerald-500/25 hover:bg-emerald-500/20 transition-colors cursor-pointer"
                          title="More export formats"
                        >
                          <ChevronDown size={13} />
                        </button>
                      </div>

                      {activeExportDropdown === "active" && (
                        <div
                          className="absolute right-0 mt-1.5 w-56 rounded-xl bg-[#1a1a1e] border border-white/15 shadow-2xl p-1.5 z-40 space-y-1 text-xs animate-in fade-in zoom-in-95 duration-100"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <button
                            onClick={() => {
                              setActiveExportDropdown(null);
                              handleDownloadActiveScan("pdf");
                            }}
                            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-neutral-200 hover:bg-white/10 hover:text-white transition-colors text-left"
                          >
                            <Download size={13} className="text-emerald-400" />
                            <div>
                              <div className="font-semibold">Visual PDF (.pdf)</div>
                              <div className="text-[10px] text-neutral-400">Exact dark mode design</div>
                            </div>
                          </button>
                          <button
                            onClick={() => {
                              setActiveExportDropdown(null);
                              handleDownloadActiveScan("vector");
                            }}
                            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-neutral-200 hover:bg-white/10 hover:text-white transition-colors text-left"
                          >
                            <Printer size={13} className="text-emerald-400" />
                            <div>
                              <div className="font-semibold">Vector Print / PDF</div>
                              <div className="text-[10px] text-neutral-400">Native browser print (Ctrl+P)</div>
                            </div>
                          </button>
                          <button
                            onClick={() => {
                              setActiveExportDropdown(null);
                              handleDownloadActiveScan("html");
                            }}
                            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-neutral-200 hover:bg-white/10 hover:text-white transition-colors text-left"
                          >
                            <Globe size={13} className="text-emerald-400" />
                            <div>
                              <div className="font-semibold">Offline Web Report (.html)</div>
                              <div className="text-[10px] text-neutral-400">Standalone interactive file</div>
                            </div>
                          </button>
                        </div>
                      )}
                    </div>

                    {/* 2. BOTTOM: SAVE ATS REPORT BUTTON */}
                    <button
                      onClick={handleSaveReport}
                      disabled={savingReport}
                      className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-black text-xs font-bold transition-all cursor-pointer shadow-sm disabled:opacity-50 whitespace-nowrap"
                    >
                      {savingReport ? (
                        <>
                          <Loader2 size={13} className="animate-spin text-black" />
                          <span>Saving Report...</span>
                        </>
                      ) : (
                        <>
                          <Bookmark size={13} className="text-black" />
                          <span>Save ATS Report</span>
                        </>
                      )}
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Phase 2: Decoupled Truth Integrity Banner */}
            {atsEvidenceReport && (
              <div className={`p-4 rounded-xl border flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 ${
                atsEvidenceReport.truthIntegrityStatus === 'VERIFIED'
                  ? 'bg-emerald-950/20 border-emerald-500/30'
                  : 'bg-rose-950/30 border-rose-500/40'
              }`}>
                <div className="flex items-start gap-3">
                  <div className={`p-2 rounded-xl shrink-0 ${
                    atsEvidenceReport.truthIntegrityStatus === 'VERIFIED'
                      ? 'bg-emerald-500/20 text-emerald-400'
                      : 'bg-rose-500/20 text-rose-400'
                  }`}>
                    {atsEvidenceReport.truthIntegrityStatus === 'VERIFIED' ? (
                      <ShieldCheck className="w-5 h-5" />
                    ) : (
                      <AlertTriangle className="w-5 h-5" />
                    )}
                  </div>
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-mono font-bold uppercase tracking-wider text-neutral-400">
                        Safety Boundary:
                      </span>
                      <span className={`text-xs font-mono font-bold px-2 py-0.5 rounded ${
                        atsEvidenceReport.truthIntegrityStatus === 'VERIFIED'
                          ? 'bg-emerald-500/20 text-emerald-400'
                          : 'bg-rose-500/20 text-rose-400'
                      }`}>
                        Truth Integrity: {atsEvidenceReport.truthIntegrityStatus}
                      </span>
                    </div>
                    <p className="text-xs text-neutral-300">
                      {atsEvidenceReport.truthIntegrityStatus === 'VERIFIED'
                        ? 'All resume keywords and claims are strictly grounded in canonical Master Profile facts.'
                        : `Unsupported keywords detected: ${atsEvidenceReport.unsupportedKeywords.join(', ')}. Truth integrity is evaluated independently from ATS score.`}
                    </p>
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-[10px] font-mono text-neutral-400 uppercase">Audit Classification</div>
                  <div className="text-xs font-mono text-neutral-300">
                    {atsEvidenceReport.evidenceAudit.length} audited items
                  </div>
                </div>
              </div>
            )}

            {/* 4 CATEGORY SUMMARY PILLARS */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 pt-4 border-t border-white/10">
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
          </div>

          {/* EXPANDABLE CATEGORY CHECKS DRILLDOWN */}
          {expandedCategory && activeScanResult.category_scores[expandedCategory] && (
            <div className="bg-[#141414] border border-white/15 rounded-2xl p-5 sm:p-6 space-y-4 animate-fade-in shadow-sm">
              <div className="flex items-center justify-between border-b border-white/10 pb-3">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  <h3 className="text-xs font-bold uppercase tracking-wider text-white">
                    {activeScanResult.category_scores[expandedCategory].name} Breakdown
                  </h3>
                </div>
                <p className="text-xs text-neutral-400">
                  {activeScanResult.category_scores[expandedCategory].summary}
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {activeScanResult.category_scores[expandedCategory].checks.map((check, idx) => (
                  <div
                    key={idx}
                    className={`p-3.5 rounded-xl border ${
                      check.passed ? "bg-[#0D0D0D] border-emerald-500/20" : "bg-[#181414] border-amber-500/30"
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

          {/* TECHNICAL KEYWORD & COMPETENCY MATRIX */}
          <div className="bg-[#141414] border border-white/15 rounded-2xl p-5 sm:p-6 space-y-5 shadow-sm">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-white/10 pb-4">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-emerald-400" />
                  <h3 className="text-xs font-bold uppercase tracking-wider text-white">
                    Technical Keyword & Skill Alignment Matrix
                  </h3>
                </div>
                <p className="text-xs text-neutral-400">
                  Extracted and matched against the normalized ATS technical taxonomy across 10 engineering domains.
                </p>
              </div>

              <div className="flex items-center bg-[#0D0D0D] p-1 rounded-xl border border-white/10 text-xs">
                <button
                  onClick={() => setKeywordTab("matched")}
                  className={`px-3 py-1 rounded-lg transition-colors cursor-pointer font-medium ${
                    keywordTab === "matched" ? "bg-[#222] text-emerald-400 font-bold" : "text-neutral-400 hover:text-white"
                  }`}
                >
                  Matched ({activeScanResult.keyword_matrix.matched_count})
                </button>
                <button
                  onClick={() => setKeywordTab("missing")}
                  className={`px-3 py-1 rounded-lg transition-colors cursor-pointer font-medium ${
                    keywordTab === "missing" ? "bg-[#222] text-rose-400 font-bold" : "text-neutral-400 hover:text-white"
                  }`}
                >
                  Missing ({activeScanResult.keyword_matrix.missing_count})
                </button>
                <button
                  onClick={() => setKeywordTab("transferable")}
                  className={`px-3 py-1 rounded-lg transition-colors cursor-pointer font-medium ${
                    keywordTab === "transferable" ? "bg-[#222] text-violet-400 font-bold" : "text-neutral-400 hover:text-white"
                  }`}
                >
                  Transferable ({activeScanResult.keyword_matrix.transferable_count})
                </button>
              </div>
            </div>

            {/* Keyword Pills Display */}
            <div className="flex flex-wrap gap-2 pt-1">
              {keywordTab === "matched" && (
                activeScanResult.keyword_matrix.matched.length === 0 ? (
                  <div className="text-xs text-neutral-500 italic p-3">No direct keyword matches found.</div>
                ) : (
                  activeScanResult.keyword_matrix.matched.map((kw) => (
                    <span
                      key={kw.id}
                      className="px-3 py-1 rounded-xl text-xs font-medium bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 flex items-center gap-1.5"
                    >
                      <Check size={11} className="text-emerald-400" />
                      <span>{kw.name}</span>
                      <span className="text-[10px] text-emerald-500/70 font-mono">({kw.category.replace('_', ' ')})</span>
                    </span>
                  ))
                )
              )}

              {keywordTab === "missing" && (
                activeScanResult.keyword_matrix.missing.length === 0 ? (
                  <div className="text-xs text-emerald-400 flex items-center gap-1.5 p-3 bg-emerald-500/10 rounded-xl border border-emerald-500/20">
                    <CheckCircle2 size={13} />
                    <span>Zero critical skill gaps detected. You match all core technical requirements!</span>
                  </div>
                ) : (
                  activeScanResult.keyword_matrix.missing.map((kw) => (
                    <div
                      key={kw.id}
                      className="px-3 py-1.5 rounded-xl text-xs bg-rose-500/10 border border-rose-500/30 text-rose-300 flex items-center gap-2"
                    >
                      <XCircle size={12} className="text-rose-400 shrink-0" />
                      <div>
                        <span className="font-bold">{kw.name}</span>
                        {kw.recommendation && (
                          <span className="text-[10px] text-neutral-400 block">{kw.recommendation}</span>
                        )}
                      </div>
                    </div>
                  ))
                )
              )}

              {keywordTab === "transferable" && (
                activeScanResult.keyword_matrix.transferable.length === 0 ? (
                  <div className="text-xs text-neutral-500 italic p-3">No additional adjacent technical skills found.</div>
                ) : (
                  activeScanResult.keyword_matrix.transferable.map((kw) => (
                    <span
                      key={kw.id}
                      className="px-3 py-1 rounded-xl text-xs font-medium bg-violet-500/10 border border-violet-500/30 text-violet-300 flex items-center gap-1.5"
                    >
                      <Sparkles size={11} className="text-violet-400" />
                      <span>{kw.name}</span>
                      <span className="text-[10px] text-violet-400/60 font-mono">(Bonus)</span>
                    </span>
                  ))
                )
              )}
            </div>
          </div>

          {/* BULLET-BY-BULLET IMPACT & METRIC AUDIT WITH 1-SHOT BULK OPTIMIZER */}
          <div className="bg-[#141414] border border-white/15 rounded-2xl p-5 sm:p-6 space-y-5 shadow-sm">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-white/10 pb-4">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <ListFilter className="w-4 h-4 text-emerald-400" />
                  <h3 className="text-xs font-bold uppercase tracking-wider text-white">
                    Bullet-by-Bullet Impact & Metric Audit
                  </h3>
                </div>
                <p className="text-xs text-neutral-400">
                  Every experience and project bullet is audited for strong power verbs, quantified metrics, and weak phrasing.
                </p>
              </div>

              {/* FILTER & BULK CONTROLS */}
              <div className="flex items-center gap-2 flex-wrap">
                <div className="flex items-center bg-[#0D0D0D] p-1 rounded-xl border border-white/10 text-xs">
                  <button
                    onClick={() => setBulletFilter("all")}
                    className={`px-3 py-1 rounded-lg transition-colors cursor-pointer font-medium ${
                      bulletFilter === "all" ? "bg-[#222] text-white font-bold" : "text-neutral-400 hover:text-white"
                    }`}
                  >
                    All ({activeScanResult.bullet_audits.length})
                  </button>
                  <button
                    onClick={() => setBulletFilter("weak")}
                    className={`px-3 py-1 rounded-lg transition-colors cursor-pointer font-medium ${
                      bulletFilter === "weak" ? "bg-[#222] text-amber-400 font-bold" : "text-neutral-400 hover:text-white"
                    }`}
                  >
                    Needs Attention ({activeScanResult.bullet_audits.filter((b) => b.status !== "strong" || !b.has_action_verb || !b.has_metric).length})
                  </button>
                  <button
                    onClick={() => setBulletFilter("strong")}
                    className={`px-3 py-1 rounded-lg transition-colors cursor-pointer font-medium ${
                      bulletFilter === "strong" ? "bg-[#222] text-emerald-400 font-bold" : "text-neutral-400 hover:text-white"
                    }`}
                  >
                    Strong ({activeScanResult.bullet_audits.filter((b) => b.status === "strong").length})
                  </button>
                </div>
              </div>
            </div>

            {/* BULK ACTION BAR */}
            <div className="p-3 bg-[#0D0D0D] border border-white/10 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
              <div className="flex items-center gap-3">
                <span className="text-neutral-400">
                  <strong className="text-white">{selectedBulletIds.size}</strong> of {activeScanResult.bullet_audits.length} bullets selected
                </span>
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={selectAllNeedsAttention}
                    className="px-2 py-1 rounded-lg bg-[#1F1F1F] hover:bg-neutral-700 text-amber-300 font-medium transition-colors cursor-pointer"
                  >
                    Select Needs Attention
                  </button>
                  <button
                    onClick={selectAllBullets}
                    className="px-2 py-1 rounded-lg bg-[#1F1F1F] hover:bg-neutral-700 text-neutral-300 hover:text-white font-medium transition-colors cursor-pointer"
                  >
                    Select All
                  </button>
                  {selectedBulletIds.size > 0 && (
                    <button
                      onClick={clearBulletSelection}
                      className="px-2 py-1 rounded-lg text-neutral-500 hover:text-white transition-colors cursor-pointer"
                    >
                      Clear
                    </button>
                  )}
                </div>
              </div>

              {/* 1-SHOT BULK OPTIMIZE ACTION */}
              <button
                onClick={handleRunBulkOptimization}
                disabled={selectedBulletIds.size === 0 || bulkOptimizing}
                className="flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-black font-bold text-xs transition-all cursor-pointer shadow-md disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {bulkOptimizing ? (
                  <>
                    <Loader2 size={13} className="animate-spin text-black" />
                    <span>Optimizing {selectedBulletIds.size} Bullets in 1-Shot...</span>
                  </>
                ) : (
                  <>
                    <Sparkles size={13} className="text-black" />
                    <span>✨ Optimize Selected ({selectedBulletIds.size}) with AI</span>
                  </>
                )}
              </button>
            </div>

            {bulkError && (
              <div className="p-3 bg-rose-500/10 border border-rose-500/30 rounded-xl text-xs text-rose-300 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
                  <span>{bulkError}</span>
                </div>
                <button
                  onClick={() => setBulkError(null)}
                  className="text-rose-400 hover:text-white text-xs font-mono px-2 py-0.5 rounded hover:bg-white/10 transition-colors"
                >
                  Dismiss
                </button>
              </div>
            )}

            {/* Bullet Cards List */}
            <div className="space-y-3">
              {activeScanResult.bullet_audits
                .filter((b) => {
                  if (bulletFilter === "weak") return b.status !== "strong" || !b.has_action_verb || !b.has_metric;
                  if (bulletFilter === "strong") return b.status === "strong";
                  return true;
                })
                .map((bullet) => {
                  const isSelected = selectedBulletIds.has(bullet.id);

                  return (
                    <div
                      key={bullet.id}
                      className={`p-4 rounded-xl border transition-all ${
                        isSelected
                          ? "bg-[#161616] border-emerald-500/40 shadow-sm"
                          : bullet.status === "strong"
                          ? "bg-[#0D0D0D] border-emerald-500/20"
                          : bullet.status === "moderate"
                          ? "bg-[#121210] border-amber-500/20"
                          : "bg-[#141010] border-rose-500/20"
                      } space-y-2.5`}
                    >
                      {/* Bullet Header with Checkbox */}
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-center gap-2.5">
                          <button
                            onClick={() => toggleBulletSelection(bullet.id)}
                            className="text-neutral-400 hover:text-emerald-400 transition-colors cursor-pointer shrink-0"
                            title={isSelected ? "Deselect bullet" : "Select bullet for bulk AI optimization"}
                          >
                            {isSelected ? (
                              <CheckSquare size={16} className="text-emerald-400" />
                            ) : (
                              <Square size={16} />
                            )}
                          </button>

                          <div className="flex items-center gap-2">
                            <span className="text-[10px] font-mono uppercase tracking-wider text-neutral-400 bg-[#1F1F1F] px-2 py-0.5 rounded border border-white/10">
                              {bullet.section}
                            </span>
                            <span className="text-xs font-bold text-white truncate max-w-sm">
                              {bullet.role_or_project}
                            </span>
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          <span className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded ${
                            bullet.status === "strong"
                              ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/30"
                              : bullet.status === "moderate"
                              ? "bg-amber-500/10 text-amber-400 border border-amber-500/30"
                              : "bg-rose-500/10 text-rose-400 border border-rose-500/30"
                          }`}>
                            Score {bullet.score}/100
                          </span>
                        </div>
                      </div>

                      {/* Bullet Text */}
                      <p className="text-xs text-neutral-200 leading-relaxed pl-6 font-sans">
                        {bullet.text}
                      </p>

                      {/* Badges & Metrics Row */}
                      <div className="flex flex-wrap items-center gap-2 text-[10px] font-mono pl-6 pt-1">
                        {bullet.has_action_verb ? (
                          <span className="px-2 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 flex items-center gap-1">
                            <Check size={10} /> Action Verb ({bullet.verb || "power verb"})
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded bg-rose-500/10 border border-rose-500/30 text-rose-400 flex items-center gap-1">
                            <XCircle size={10} /> Missing Strong Action Verb
                          </span>
                        )}

                        {bullet.has_metric ? (
                          <span className="px-2 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 flex items-center gap-1">
                            <Check size={10} /> Quantified Metric
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded bg-amber-500/10 border border-amber-500/30 text-amber-400 flex items-center gap-1">
                            <AlertTriangle size={10} /> Missing Numerical Impact
                          </span>
                        )}

                        {bullet.has_weak_opener && (
                          <span className="px-2 py-0.5 rounded bg-rose-500/10 border border-rose-500/30 text-rose-400 flex items-center gap-1">
                            <XCircle size={10} /> Weak Passive Opener
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
            </div>
          </div>

          {/* ACTIONABLE ATS PRIORITY CHECKLIST */}
          <div className="bg-[#141414] border border-white/15 rounded-2xl p-5 sm:p-6 space-y-5 shadow-sm">
            <div className="flex items-center justify-between border-b border-white/10 pb-4">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  <h3 className="text-xs font-bold uppercase tracking-wider text-white">
                    Actionable Optimization Checklist
                  </h3>
                </div>
                <p className="text-xs text-neutral-400">
                  Prioritized checklist of specific updates to achieve a 100/100 ATS pass rate.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {activeScanResult.actionable_checklist.map((item) => (
                <div
                  key={item.id}
                  className={`p-3.5 rounded-xl border flex flex-col justify-between space-y-2 ${
                    item.passed
                      ? "bg-[#121412] border-emerald-500/20"
                      : item.priority === "critical"
                      ? "bg-[#181214] border-rose-500/30"
                      : "bg-[#181612] border-amber-500/30"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2">
                      {item.passed ? (
                        <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                      ) : item.priority === "critical" ? (
                        <XCircle className="w-4 h-4 text-rose-400 shrink-0" />
                      ) : (
                        <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
                      )}
                      <span className="text-xs font-bold text-white">{item.title}</span>
                    </div>

                    {!item.passed && item.impact_points > 0 && (
                      <span className="text-[10px] font-mono font-bold text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/30">
                        +{item.impact_points} pts
                      </span>
                    )}
                  </div>

                  <p className="text-xs text-neutral-300 leading-relaxed pl-6">
                    {item.description}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

            {/* HISTORICAL SAVED REPORT SNAPSHOT MODAL */}
      {viewingSavedReport &&
        createPortal(
          <div
            onClick={(e) => {
              if (e.target === e.currentTarget) {
                setViewingSavedReport(null);
              }
            }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-black/55 backdrop-blur-xl animate-in fade-in duration-150"
          >
            <div
              onClick={(e) => e.stopPropagation()}
              className="bg-[#121212] border border-white/20 rounded-2xl w-full max-w-5xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden animate-in zoom-in-95 duration-150"
            >
            {/* Modal Header */}
            <div className="flex items-center justify-between p-5 border-b border-white/10 bg-[#171717]">
              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-emerald-500/10 border border-emerald-500/30 rounded-xl text-emerald-400 shrink-0">
                  <Bookmark size={20} />
                </div>
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <h2 className="text-base font-bold text-white">{viewingSavedReport.reportName}</h2>
                    <span className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold border ${getGradeBadge(viewingSavedReport.grade)}`}>
                      Grade {viewingSavedReport.grade} • {viewingSavedReport.overallScore}/100
                    </span>
                  </div>
                  <p className="text-xs text-neutral-400 font-mono mt-0.5">
                    Saved on {new Date(viewingSavedReport.createdAt).toLocaleString()} • {viewingSavedReport.sourceType === "tailored_resume" ? "Tailored Resume" : "Uploaded File"}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                {/* MODAL DOWNLOAD BUTTON WITH OPTIONS */}
                <div className="relative">
                  <div className="flex items-center rounded-xl bg-emerald-500/10 border border-emerald-500/30 shadow-sm overflow-hidden">
                    <button
                      onClick={() => handleDownloadSavedReport("pdf")}
                      disabled={isExporting}
                      className="flex items-center gap-2 px-3.5 py-2 text-emerald-400 hover:bg-emerald-500/20 text-xs font-bold transition-all cursor-pointer disabled:opacity-50"
                      title="Download high-resolution styled PDF report"
                    >
                      {isExporting ? (
                        <>
                          <Loader2 size={13} className="animate-spin text-emerald-400" />
                          <span>Generating PDF...</span>
                        </>
                      ) : (
                        <>
                          <Download size={13} className="text-emerald-400" />
                          <span>Download Report (PDF)</span>
                        </>
                      )}
                    </button>
                    <button
                      onClick={() => setActiveExportDropdown(activeExportDropdown === "saved_modal" ? null : "saved_modal")}
                      className="px-2 py-2 border-l border-emerald-500/25 text-emerald-400 hover:bg-emerald-500/20 transition-colors cursor-pointer"
                      title="More export options"
                    >
                      <ChevronDown size={14} />
                    </button>
                  </div>

                  {activeExportDropdown === "saved_modal" && (
                    <div
                      className="absolute right-0 mt-1.5 w-56 rounded-xl bg-[#1a1a1e] border border-white/15 shadow-2xl p-1.5 z-50 space-y-1 text-xs animate-in fade-in zoom-in-95 duration-100"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button
                        onClick={() => {
                          setActiveExportDropdown(null);
                          handleDownloadSavedReport("pdf");
                        }}
                        className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-neutral-200 hover:bg-white/10 hover:text-white transition-colors text-left"
                      >
                        <Download size={13} className="text-emerald-400" />
                        <div>
                          <div className="font-semibold">Visual PDF (.pdf)</div>
                          <div className="text-[10px] text-neutral-400">Exact dark mode design</div>
                        </div>
                      </button>
                      <button
                        onClick={() => {
                          setActiveExportDropdown(null);
                          handleDownloadSavedReport("vector");
                        }}
                        className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-neutral-200 hover:bg-white/10 hover:text-white transition-colors text-left"
                      >
                        <Printer size={13} className="text-emerald-400" />
                        <div>
                          <div className="font-semibold">Vector Print / PDF</div>
                          <div className="text-[10px] text-neutral-400">Native browser print (Ctrl+P)</div>
                        </div>
                      </button>
                      <button
                        onClick={() => {
                          setActiveExportDropdown(null);
                          handleDownloadSavedReport("html");
                        }}
                        className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-neutral-200 hover:bg-white/10 hover:text-white transition-colors text-left"
                      >
                        <Globe size={13} className="text-amber-400" />
                        <div>
                          <div className="font-semibold">Offline Web Report (.html)</div>
                          <div className="text-[10px] text-neutral-400">Standalone interactive file</div>
                        </div>
                      </button>
                    </div>
                  )}
                </div>

                <button
                  onClick={() => setViewingSavedReport(null)}
                  className="p-2 rounded-xl bg-white/5 hover:bg-white/10 text-neutral-400 hover:text-white transition-colors cursor-pointer"
                  title="Close snapshot modal"
                >
                  <X size={18} />
                </button>
              </div>
            </div>

            {/* Modal Scrollable Body */}
            <div ref={savedReportContentRef} className="p-6 overflow-y-auto space-y-6 max-h-[calc(90vh-140px)]">
              {/* 100-Point Score Card */}
              <div className="bg-[#141414] border border-white/15 rounded-2xl p-6 sm:p-8 space-y-6 shadow-sm">
                <div className="flex flex-col xl:flex-row items-start xl:items-center justify-between gap-6">
                  <div className="flex flex-col sm:flex-row items-start sm:items-center gap-5 sm:gap-6 flex-1 min-w-0">
                    <RadialScoreGauge score={viewingSavedReport.scanResult.overall_score} />
                    <div className="space-y-1.5 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`px-2.5 py-0.5 rounded-lg text-xs font-mono font-bold border ${getGradeBadge(viewingSavedReport.scanResult.grade)}`}>
                          Grade {viewingSavedReport.scanResult.grade}
                        </span>
                        <span className="text-xs text-neutral-400 font-mono">
                          {viewingSavedReport.scanResult.metadata.word_count} words • ~{viewingSavedReport.scanResult.metadata.estimated_read_time} read
                        </span>
                      </div>
                      <h3 className="text-lg sm:text-xl font-bold text-white tracking-tight leading-snug">
                        {viewingSavedReport.scanResult.overall_score >= 80 ? "Competitive Resume with Key Optimization Areas" : "Needs Keyword & Formatting Polish"}
                      </h3>
                      <p className="text-xs text-neutral-400 leading-relaxed max-w-xl">
                        {viewingSavedReport.scanResult.summary}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2.5 shrink-0 flex-1 sm:flex-initial">
                    <div className="p-3 bg-[#0D0D0D] rounded-xl border border-white/10 text-center flex-1 sm:flex-none sm:min-w-[125px]">
                      <div className="text-[10px] font-mono text-neutral-400 uppercase tracking-wider">Matched Keywords</div>
                      <div className="text-sm font-bold text-emerald-400 mt-0.5">
                        {viewingSavedReport.scanResult.keyword_matrix.matched_count} / {viewingSavedReport.scanResult.keyword_matrix.total_jd_keywords || viewingSavedReport.scanResult.keyword_matrix.matched_count}
                      </div>
                    </div>

                    <div className="p-3 bg-[#0D0D0D] rounded-xl border border-white/10 text-center flex-1 sm:flex-none sm:min-w-[125px]">
                      <div className="text-[10px] font-mono text-neutral-400 uppercase tracking-wider">Strong Action Verbs</div>
                      <div className="text-sm font-bold text-emerald-400 mt-0.5">
                        {viewingSavedReport.scanResult.bullet_audits.filter((b) => b.has_action_verb).length} / {viewingSavedReport.scanResult.bullet_audits.length} bullets
                      </div>
                    </div>
                  </div>
                </div>

                {/* 4 Category Summary Pillars */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 pt-4 border-t border-white/10">
                  {Object.entries(viewingSavedReport.scanResult.category_scores).map(([key, cat]) => (
                    <div
                      key={key}
                      className="p-4 rounded-xl border bg-[#0D0D0D] border-white/10 space-y-2"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-white truncate max-w-[140px]">{cat.name}</span>
                        <span className={`text-xs font-mono font-bold ${getScoreColor((cat.score / cat.max_score) * 100)}`}>
                          {cat.score} / {cat.max_score}
                        </span>
                      </div>
                      <div className="w-full h-1.5 bg-neutral-800 rounded-full overflow-hidden">
                        <div
                          className={`h-full ${
                            cat.status === "pass" ? "bg-emerald-400" : cat.status === "warning" ? "bg-amber-400" : "bg-rose-400"
                          }`}
                          style={{ width: `${Math.min(cat.percentage, 100)}%` }}
                        />
                      </div>
                      <div className="text-[10px] text-neutral-400 capitalize">{cat.status}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Keyword Matrix */}
              <div className="bg-[#141414] border border-white/15 rounded-2xl p-5 sm:p-6 space-y-4 shadow-sm">
                <div className="flex items-center justify-between border-b border-white/10 pb-3">
                  <div className="flex items-center gap-2">
                    <Target className="w-4 h-4 text-emerald-400" />
                    <h3 className="text-xs font-bold uppercase tracking-wider text-white">
                      Technical Keyword Alignment Matrix
                    </h3>
                  </div>
                  <span className="text-xs text-neutral-400 font-mono">
                    {viewingSavedReport.scanResult.keyword_matrix.matched_count} Matched • {viewingSavedReport.scanResult.keyword_matrix.missing_count} Missing
                  </span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {viewingSavedReport.scanResult.keyword_matrix.matched.map((kw) => (
                    <span
                      key={kw.id}
                      className="px-3 py-1 rounded-xl text-xs font-medium bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 flex items-center gap-1.5"
                    >
                      <Check size={11} className="text-emerald-400" />
                      <span>{kw.name}</span>
                    </span>
                  ))}
                  {viewingSavedReport.scanResult.keyword_matrix.missing.map((kw) => (
                    <span
                      key={kw.id}
                      className="px-3 py-1 rounded-xl text-xs font-medium bg-rose-500/10 border border-rose-500/30 text-rose-300 flex items-center gap-1.5"
                    >
                      <XCircle size={11} className="text-rose-400" />
                      <span>{kw.name}</span>
                    </span>
                  ))}
                </div>
              </div>

              {/* Bullet Audits List */}
              <div className="bg-[#141414] border border-white/15 rounded-2xl p-5 sm:p-6 space-y-4 shadow-sm">
                <div className="flex items-center gap-2 border-b border-white/10 pb-3">
                  <ListFilter className="w-4 h-4 text-emerald-400" />
                  <h3 className="text-xs font-bold uppercase tracking-wider text-white">
                    Bullet Impact Audits ({viewingSavedReport.scanResult.bullet_audits.length})
                  </h3>
                </div>
                <div className="space-y-3">
                  {viewingSavedReport.scanResult.bullet_audits.map((bullet) => (
                    <div
                      key={bullet.id}
                      className="p-3.5 rounded-xl border bg-[#0D0D0D] border-white/10 space-y-2"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[10px] font-mono text-neutral-400 uppercase bg-[#1F1F1F] px-2 py-0.5 rounded">
                          {bullet.section} — {bullet.role_or_project}
                        </span>
                        <span className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded ${
                          bullet.status === "strong" ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/30" : "bg-amber-500/10 text-amber-400 border border-amber-500/30"
                        }`}>
                          Score {bullet.score}/100
                        </span>
                      </div>
                      <p className="text-xs text-neutral-200 leading-relaxed font-sans">{bullet.text}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="flex items-center justify-between p-4 border-t border-white/10 bg-[#141414]">
              <div className="flex items-center gap-2 text-neutral-400 text-xs font-mono">
                <ShieldCheck size={14} className="text-emerald-400" />
                <span>Immutable Historical Record • Saved in Firestore</span>
              </div>
              <div className="flex items-center gap-2.5">
                <button
                  onClick={() => handleDownloadSavedReport("pdf")}
                  disabled={isExporting}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-black font-bold text-white font-semibold text-xs transition-colors cursor-pointer shadow-md disabled:opacity-50"
                >
                  {isExporting ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
                  <span>Download Report (PDF)</span>
                </button>
                <button
                  onClick={() => setViewingSavedReport(null)}
                  className="px-5 py-2 rounded-xl bg-[#222] hover:bg-neutral-700 text-white font-semibold text-xs transition-colors cursor-pointer border border-white/10"
                >
                  Close Report View
                </button>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}

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
    </div>
  );
};

export default ScannerPage;
