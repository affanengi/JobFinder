import React, { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import {
  X,
  Target,
  FileText,
  Zap,
  Sparkles,
  Layers,
  ShieldCheck,
  ShieldAlert,
  ShieldX,
  Lock,
  Download,
  ChevronDown,
  Printer,
  Globe,
} from "lucide-react";
import { useScrollLock } from "../../hooks/useScrollLock";
import {
  AtsAnalysisResult,
  TruthLockAuditReport,
  ScanProvenanceMetadata,
  BulletAuditItem,
  ChecklistItem,
} from "../../types/scanner";
import { TailoredResumeDTO } from "../resume/ResumeStudioModal";
import { JobMatchExplorerView } from "./studio/JobMatchExplorerView";
import { ResumeEvidenceView } from "./studio/ResumeEvidenceView";
import { KeywordExplorerView } from "./studio/KeywordExplorerView";
import { RewritesAuditView } from "./studio/RewritesAuditView";
import { OverviewScorecardView } from "./studio/OverviewScorecardView";

export type AtsStudioTab = "job_match" | "evidence" | "keywords" | "rewrites" | "overview";

export interface AtsStudioModalProps {
  isOpen: boolean;
  onClose: () => void;
  analysis: AtsAnalysisResult;
  auditReport?: TruthLockAuditReport | null;
  provenance?: ScanProvenanceMetadata | null;
  bulletAudits?: BulletAuditItem[];
  checklistItems?: ChecklistItem[];
  jobTitle?: string;
  jobCompany?: string;
  initialTab?: AtsStudioTab;
  resumeData?: TailoredResumeDTO | null;
  onApplyProposal?: (originalText: string, proposedText: string) => Promise<void> | void;
  canEditResume?: boolean;
  isHistorical?: boolean;
  savedReportCreatedAt?: string;
  onExport?: (format: "pdf" | "vector" | "html") => void;
  isExporting?: boolean;
}

export const AtsStudioModal: React.FC<AtsStudioModalProps> = ({
  isOpen,
  onClose,
  analysis,
  auditReport,
  provenance,
  bulletAudits = [],
  checklistItems = [],
  jobTitle = "Target Opportunity",
  jobCompany,
  initialTab = "job_match",
  resumeData,
  onApplyProposal,
  canEditResume = true,
  isHistorical = false,
  savedReportCreatedAt,
  onExport,
  isExporting = false,
}) => {
  const [activeTab, setActiveTab] = useState<AtsStudioTab>(initialTab);
  const [exportDropdownOpen, setExportDropdownOpen] = useState(false);

  // Sync initial tab when changed from deep links
  useEffect(() => {
    if (initialTab) {
      setActiveTab(initialTab);
    }
  }, [initialTab]);

  // Lock background scroll when studio modal is active
  useScrollLock(isOpen);

  // Escape key listener to close cleanly
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const score = analysis?.overall_score ?? 0;
  const isTruthLockPass = Boolean(auditReport?.is_valid && auditReport?.blocking_violations_count === 0);
  const isTruthLockBlocked = Boolean(auditReport && auditReport.blocking_violations_count > 0);

  const proposalsCount = analysis?.rewrite_proposals?.length || 0;

  return createPortal(
    <div
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xl flex items-center justify-center p-3 sm:p-5 md:p-6 animate-in fade-in duration-200"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        data-testid="ats-studio-modal"
        className="w-full h-full max-w-[1400px] max-h-[92vh] bg-[#121212] border border-white/20 rounded-2xl md:rounded-3xl shadow-2xl flex flex-col overflow-hidden animate-in zoom-in-95 duration-200 relative"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="ATS Analysis Studio"
      >
        {/* TOP HEADER BAR (REFERENCE IMAGE 11 RESUME STUDIO PATTERN) */}
        <div className="px-6 py-4 border-b border-white/10 bg-[#161616] flex items-center justify-between shrink-0 gap-4">
          {/* LEFT: TITLE & TARGET CONTEXT */}
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-8 h-8 rounded-xl bg-white/10 flex items-center justify-center border border-white/20 shrink-0">
              <Zap className="w-4 h-4 text-emerald-400" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-sm font-bold text-white tracking-tight">
                  ATS Analysis Studio
                </h2>
                {isHistorical ? (
                  <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-amber-500/10 border border-amber-500/30 text-amber-300 font-semibold flex items-center gap-1">
                    <Lock className="w-3 h-3 text-amber-400" />
                    <span>Historical Snapshot (Read-Only)</span>
                  </span>
                ) : (
                  <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 font-semibold">
                    AI Contextual Fit
                  </span>
                )}
                {isTruthLockPass ? (
                  <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 flex items-center gap-1">
                    <ShieldCheck className="w-3 h-3" />
                    <span>Grounded</span>
                  </span>
                ) : isTruthLockBlocked ? (
                  <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-rose-500/10 border border-rose-500/30 text-rose-400 flex items-center gap-1">
                    <ShieldX className="w-3 h-3" />
                    <span>Violations Detected</span>
                  </span>
                ) : (
                  <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-amber-500/10 border border-amber-500/30 text-amber-400 flex items-center gap-1">
                    <ShieldAlert className="w-3 h-3" />
                    <span>Review Advised</span>
                  </span>
                )}
              </div>
              <p className="text-xs text-[#A3A3A3] truncate max-w-md">
                {jobTitle} {jobCompany && <>• <span className="text-white font-medium">@{jobCompany}</span></>}
                {savedReportCreatedAt && (
                  <span className="text-neutral-400 font-mono text-[10px] ml-1.5">
                    • Saved {new Date(savedReportCreatedAt).toLocaleString()}
                  </span>
                )}
              </p>
            </div>
          </div>

          {/* CENTER: 5 CONSOLIDATED WORKSPACE TABS */}
          <div role="tablist" aria-label="Studio Workspace Tabs" className="hidden md:flex items-center gap-1 bg-[#0D0D0D] p-1 rounded-xl border border-white/20 overflow-x-auto">
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "job_match"}
              onClick={() => setActiveTab("job_match")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer whitespace-nowrap ${
                activeTab === "job_match"
                  ? "bg-white text-black font-bold shadow-sm"
                  : "text-[#A3A3A3] hover:text-white hover:bg-white/5"
              }`}
            >
              <Target className="w-3.5 h-3.5" />
              <span>Job Match Explorer</span>
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 ml-0.5" />
            </button>

            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "evidence"}
              onClick={() => setActiveTab("evidence")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer whitespace-nowrap ${
                activeTab === "evidence"
                  ? "bg-white text-black font-bold shadow-sm"
                  : "text-[#A3A3A3] hover:text-white hover:bg-white/5"
              }`}
            >
              <FileText className="w-3.5 h-3.5" />
              <span>Resume Evidence</span>
            </button>

            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "keywords"}
              onClick={() => setActiveTab("keywords")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer whitespace-nowrap ${
                activeTab === "keywords"
                  ? "bg-white text-black font-bold shadow-sm"
                  : "text-[#A3A3A3] hover:text-white hover:bg-white/5"
              }`}
            >
              <Zap className="w-3.5 h-3.5" />
              <span>Keyword Matrix</span>
            </button>

            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "rewrites"}
              onClick={() => setActiveTab("rewrites")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer whitespace-nowrap ${
                activeTab === "rewrites"
                  ? "bg-white text-black font-bold shadow-sm"
                  : "text-[#A3A3A3] hover:text-white hover:bg-white/5"
              }`}
            >
              <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
              <span>Rewrites & Audit</span>
              {proposalsCount > 0 && (
                <span className="px-1.5 py-0.2 rounded-full text-[10px] font-mono bg-emerald-500/20 text-emerald-300">
                  {proposalsCount}
                </span>
              )}
            </button>

            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "overview"}
              onClick={() => setActiveTab("overview")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer whitespace-nowrap ${
                activeTab === "overview"
                  ? "bg-white text-black font-bold shadow-sm"
                  : "text-[#A3A3A3] hover:text-white hover:bg-white/5"
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              <span>Scorecard & Overview</span>
            </button>
          </div>

          {/* RIGHT: EXPORT, MATCH SCORE BADGE & CLOSE BUTTON */}
          <div className="flex items-center gap-2 sm:gap-3 shrink-0">
            {provenance?.model_used && (
              <span className="hidden xl:inline text-[10px] font-mono text-neutral-400 bg-neutral-900 px-2 py-1 rounded-lg border border-white/5">
                {provenance.model_used}
              </span>
            )}

            {/* EXPORT DROPDOWN (SUPPORTED IN HISTORICAL AND ACTIVE VIEWS) */}
            {onExport && (
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setExportDropdownOpen(!exportDropdownOpen)}
                  disabled={isExporting}
                  className="px-3 py-1.5 rounded-xl bg-[#202020] hover:bg-[#282828] text-neutral-200 hover:text-white border border-white/10 text-xs font-semibold transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                  title="Export report snapshot"
                >
                  <Download className="w-3.5 h-3.5 text-neutral-400" />
                  <span className="hidden sm:inline">Export</span>
                  <ChevronDown className="w-3 h-3 opacity-60" />
                </button>

                {exportDropdownOpen && (
                  <div
                    className="absolute right-0 mt-1.5 w-48 rounded-xl bg-[#1C1C1C] border border-white/15 shadow-2xl py-1 z-50 animate-in fade-in zoom-in-95 duration-150"
                    onClick={() => setExportDropdownOpen(false)}
                  >
                    <button
                      type="button"
                      onClick={() => onExport("pdf")}
                      className="w-full px-3 py-2 text-left text-xs text-neutral-300 hover:text-white hover:bg-white/5 flex items-center gap-2 cursor-pointer"
                    >
                      <Download className="w-3.5 h-3.5 text-emerald-400" />
                      <span>Executive PDF Report</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => onExport("vector")}
                      className="w-full px-3 py-2 text-left text-xs text-neutral-300 hover:text-white hover:bg-white/5 flex items-center gap-2 cursor-pointer"
                    >
                      <Printer className="w-3.5 h-3.5 text-blue-400" />
                      <span>Print Vector Document</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => onExport("html")}
                      className="w-full px-3 py-2 text-left text-xs text-neutral-300 hover:text-white hover:bg-white/5 flex items-center gap-2 cursor-pointer"
                    >
                      <Globe className="w-3.5 h-3.5 text-teal-400" />
                      <span>Full Technical HTML</span>
                    </button>
                  </div>
                )}
              </div>
            )}

            <div className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#0D0D0D] border border-white/10 font-mono text-xs">
              <span className="text-neutral-400">Score:</span>
              <span
                className={`font-bold ${
                  score >= 80 ? "text-emerald-400" : score >= 65 ? "text-amber-400" : "text-rose-400"
                }`}
              >
                {score} / 100
              </span>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-xl text-[#A3A3A3] hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
              title="Close Studio (Esc)"
              aria-label="Close Studio"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* MOBILE SUB-NAVIGATION (VISIBLE ON SCREENS < 768px) */}
        <div className="flex md:hidden items-center gap-1 px-4 py-2 bg-[#161616] border-b border-white/10 overflow-x-auto shrink-0">
          <button
            type="button"
            onClick={() => setActiveTab("job_match")}
            className={`px-2.5 py-1 rounded-lg text-xs font-medium whitespace-nowrap ${
              activeTab === "job_match" ? "bg-white text-black font-bold" : "text-neutral-400"
            }`}
          >
            Job Match
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("evidence")}
            className={`px-2.5 py-1 rounded-lg text-xs font-medium whitespace-nowrap ${
              activeTab === "evidence" ? "bg-white text-black font-bold" : "text-neutral-400"
            }`}
          >
            Evidence
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("keywords")}
            className={`px-2.5 py-1 rounded-lg text-xs font-medium whitespace-nowrap ${
              activeTab === "keywords" ? "bg-white text-black font-bold" : "text-neutral-400"
            }`}
          >
            Keywords
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("rewrites")}
            className={`px-2.5 py-1 rounded-lg text-xs font-medium whitespace-nowrap ${
              activeTab === "rewrites" ? "bg-white text-black font-bold" : "text-neutral-400"
            }`}
          >
            Rewrites
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("overview")}
            className={`px-2.5 py-1 rounded-lg text-xs font-medium whitespace-nowrap ${
              activeTab === "overview" ? "bg-white text-black font-bold" : "text-neutral-400"
            }`}
          >
            Overview
          </button>
        </div>

        {/* MODAL MAIN WORKSPACE BODY */}
        <div className="flex-1 p-4 sm:p-6 overflow-hidden bg-[#121212]">
          {activeTab === "job_match" && (
            <JobMatchExplorerView
              requirements={analysis.requirements || []}
              jobTitle={jobTitle}
              jobCompany={jobCompany}
            />
          )}

          {activeTab === "evidence" && (
            <ResumeEvidenceView
              sections={analysis.section_analysis || []}
              bulletAudits={bulletAudits}
              resumeData={resumeData}
            />
          )}

          {activeTab === "keywords" && (
            <KeywordExplorerView
              keywords={analysis.keyword_analysis || []}
            />
          )}

          {activeTab === "rewrites" && (
            <RewritesAuditView
              proposals={analysis.rewrite_proposals || []}
              auditReport={auditReport}
              onApplyProposal={onApplyProposal}
              canEditResume={canEditResume}
              isHistorical={isHistorical}
            />
          )}

          {activeTab === "overview" && (
            <OverviewScorecardView
              overallScore={analysis.overall_score}
              overallExplanation={analysis.overall_explanation}
              executiveSummary={analysis.executive_summary}
              strengths={analysis.strengths || []}
              gaps={analysis.gaps || []}
              recommendations={analysis.recommendations || []}
              checklistItems={checklistItems}
              isHistorical={isHistorical}
            />
          )}
        </div>
      </div>
    </div>,
    document.body
  );
};

export default AtsStudioModal;
