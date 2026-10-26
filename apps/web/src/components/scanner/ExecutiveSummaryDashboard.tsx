import React from "react";
import {
  ShieldCheck,
  Bookmark,
  Download,
  Printer,
  Globe,
  Loader2,
  ChevronDown,
  Info,
  Layers,
  Sparkles,
} from "lucide-react";
import { AtsScanResult, ScanProvenanceMetadata, TruthLockAuditReport } from "../../types/scanner";
import { AtsEvidenceAuditReport } from "../../types/jobAnalysis";

interface ExecutiveSummaryDashboardProps {
  scanResult: AtsScanResult;
  atsEvidenceReport?: AtsEvidenceAuditReport | null;
  provenance?: ScanProvenanceMetadata | null;
  truthLockReport?: TruthLockAuditReport | null;
  overallExplanation?: string | null;
  isHistoricalReport?: boolean;
  onSaveReport?: () => void;
  savingReport?: boolean;
  isSavedReportView?: boolean;
  onDownloadReport: (format: "pdf" | "vector" | "html") => void;
  isExporting?: boolean;
  activeExportDropdown: string | null;
  setActiveExportDropdown: (val: string | null) => void;
  onSwitchToMatchMap?: () => void;
}

export const RadialScoreGauge: React.FC<{ score: number }> = ({ score }) => {
  const radius = 44;
  const strokeWidth = 7;
  const circumference = 2 * Math.PI * radius;
  const safeScore =
    typeof score === "number" && !isNaN(score)
      ? Math.min(Math.max(Math.round(score), 0), 100)
      : 0;
  const strokeDashoffset = circumference - (safeScore / 100) * circumference;

  const strokeColor =
    safeScore >= 80 ? "#34d399" : safeScore >= 65 ? "#fbbf24" : "#f87171";
  const glowColor =
    safeScore >= 80
      ? "rgba(52, 211, 153, 0.3)"
      : safeScore >= 65
      ? "rgba(251, 191, 36, 0.3)"
      : "rgba(248, 113, 113, 0.3)";

  return (
    <div className="relative flex items-center justify-center shrink-0 w-28 h-28" data-testid="radial-score-gauge">
      <svg className="w-28 h-28 -rotate-90 transform" viewBox="0 0 100 100">
        <circle
          cx="50"
          cy="50"
          r="44"
          fill="transparent"
          stroke="#222222"
          strokeWidth={strokeWidth}
          className="opacity-70"
        />
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
            filter: "drop-shadow(0 0 6px " + glowColor + ")",
          }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
        <span
          className={
            "text-3xl font-black font-mono tracking-tight " +
            (safeScore >= 80
              ? "text-emerald-400"
              : safeScore >= 65
              ? "text-amber-400"
              : "text-rose-400")
          }
        >
          {safeScore}
        </span>
        <span className="text-[10px] text-neutral-400 uppercase tracking-widest font-mono -mt-0.5">
          / 100
        </span>
      </div>
    </div>
  );
};

export const ExecutiveSummaryDashboard: React.FC<ExecutiveSummaryDashboardProps> = ({
  scanResult,
  atsEvidenceReport,
  provenance,
  truthLockReport,
  overallExplanation,
  isHistoricalReport = false,
  onSaveReport,
  savingReport = false,
  isSavedReportView = false,
  onDownloadReport,
  isExporting = false,
  activeExportDropdown,
  setActiveExportDropdown,
  onSwitchToMatchMap,
}) => {
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

  const getTierColor = (tier: string) => {
    switch (tier) {
      case "high":
      case "substantive":
      case "optimal":
        return "bg-emerald-500/15 border-emerald-500/30 text-emerald-400";
      case "moderate":
      case "acceptable":
        return "bg-amber-500/15 border-amber-500/30 text-amber-400";
      default:
        return "bg-rose-500/15 border-rose-500/30 text-rose-400";
    }
  };

  const formatTierLabel = (tier: string) => {
    return tier.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  };

  const reqMatches = scanResult.requirement_matches || [];
  const mandatoryReqs = reqMatches.filter((r) => r.is_mandatory);
  const preferredReqs = reqMatches.filter((r) => !r.is_mandatory);

  const mandatoryCovered = mandatoryReqs.filter(
    (r) => r.evidence_status === "demonstrated" || r.evidence_status === "listed"
  ).length;

  const preferredCovered = preferredReqs.filter(
    (r) => r.evidence_status === "demonstrated" || r.evidence_status === "listed"
  ).length;

  const analysisModeLabel =
    provenance?.scoring_version === "v2_ai_first"
      ? "AI-First Contextual Evaluation"
      : scanResult.analysis_mode === "contextual_ai"
      ? "Contextual AI Evaluation"
      : scanResult.analysis_mode === "deterministic_structural"
      ? "Deterministic Structural Engine"
      : scanResult.analysis_mode === "legacy_deterministic" || isHistoricalReport
      ? "Legacy Heuristic Snapshot"
      : "Standard Evaluation Engine";

  const confidenceBadge =
    scanResult.confidence_level === "high"
      ? "bg-emerald-500/15 border-emerald-500/30 text-emerald-400"
      : scanResult.confidence_level === "moderate"
      ? "bg-amber-500/15 border-amber-500/30 text-amber-400"
      : "bg-neutral-800 border-neutral-700 text-neutral-300";

  return (
    <div className="bg-[#141414] border border-white/15 rounded-2xl p-6 sm:p-8 space-y-6 shadow-sm" data-testid="executive-summary-dashboard">
      {/* HISTORICAL REPORT NOTICE (IF LEGACY) */}
      {(isHistoricalReport || provenance?.scoring_version === "v1_heuristic") && (
        <div className="p-3 bg-amber-950/20 border border-amber-500/25 rounded-xl text-xs text-amber-300 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Info size={14} className="text-amber-400 shrink-0" />
            <span>
              <strong>Historical Heuristic Record (v1):</strong> This snapshot reflects our previous deterministic 4-pillar calculation. New scans use AI-first evidence-grounded contextual scoring.
            </span>
          </div>
          <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-black/40 text-neutral-400 shrink-0">
            v1_heuristic
          </span>
        </div>
      )}

      {/* HERO ROW */}
      <div className="flex flex-col xl:flex-row items-start xl:items-center justify-between gap-6">
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-5 sm:gap-6 flex-1 min-w-0">
          <RadialScoreGauge score={scanResult.overall_score} />

          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`px-2.5 py-0.5 rounded-lg text-xs font-mono font-bold border ${getGradeBadge(
                  scanResult.grade
                )}`}
              >
                Grade {scanResult.grade}
              </span>
              <span className="text-xs text-neutral-400 font-mono">
                {scanResult.metadata?.word_count ?? 0} words • ~
                {scanResult.metadata?.estimated_read_time ?? "1 min"} read
              </span>
              <span className="px-2 py-0.5 rounded-md text-[10px] font-mono font-semibold bg-[#222] border border-white/10 text-neutral-300">
                {analysisModeLabel}
              </span>
              {provenance && (
                <span className="px-2 py-0.5 rounded-md text-[10px] font-mono font-semibold bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 flex items-center gap-1">
                  <Sparkles size={10} /> {provenance.model_used || "Gemini"} • {provenance.scoring_version}
                </span>
              )}
              {truthLockReport && (
                <span
                  className={`px-2 py-0.5 rounded-md text-[10px] font-mono font-bold border ${
                    truthLockReport.is_valid
                      ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400"
                      : truthLockReport.blocking_violations_count > 0
                      ? "bg-rose-500/10 border-rose-500/30 text-rose-400"
                      : "bg-amber-500/10 border-amber-500/30 text-amber-400"
                  }`}
                >
                  Truth-Lock: {truthLockReport.is_valid ? "PASSED" : truthLockReport.status.toUpperCase()}
                </span>
              )}
            </div>

            <h2 className="text-xl font-bold text-white tracking-tight">
              {scanResult.readiness?.summary_verdict
                ? scanResult.readiness.summary_verdict
                : scanResult.overall_score >= 80
                ? "Competitive Resume with Strong ATS Alignment"
                : "Needs Keyword & Formatting Polish"}
            </h2>
            <p className="text-xs text-neutral-400 leading-relaxed max-w-2xl">
              {scanResult.summary}
            </p>
            {overallExplanation && (
              <div className="pt-2 text-xs text-neutral-300 leading-relaxed border-t border-white/5 font-sans">
                <strong className="text-white">Contextual Evaluation:</strong> {overallExplanation}
              </div>
            )}
          </div>
        </div>

        {/* ACTIONS (PDF EXPORT & SAVE REPORT) */}
        {!isSavedReportView && (
          <div className="flex flex-col gap-2 min-w-[200px] w-full sm:w-auto shrink-0 justify-center">
            {/* DOWNLOAD REPORT DROPDOWN */}
            <div className="relative w-full">
              <div className="flex items-center w-full rounded-xl bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 shadow-sm overflow-hidden transition-all">
                <button
                  onClick={() => onDownloadReport("pdf")}
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
                  onClick={() =>
                    setActiveExportDropdown(
                      activeExportDropdown === "summary" ? null : "summary"
                    )
                  }
                  className="px-2.5 py-2.5 border-l border-emerald-500/25 hover:bg-emerald-500/20 transition-colors cursor-pointer"
                  title="More export formats"
                >
                  <ChevronDown size={13} />
                </button>
              </div>

              {activeExportDropdown === "summary" && (
                <div
                  className="absolute right-0 mt-1.5 w-56 rounded-xl bg-[#1a1a1e] border border-white/15 shadow-2xl p-1.5 z-40 space-y-1 text-xs animate-in fade-in zoom-in-95 duration-100"
                  onClick={(e) => e.stopPropagation()}
                >
                  <button
                    onClick={() => {
                      setActiveExportDropdown(null);
                      onDownloadReport("pdf");
                    }}
                    className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-neutral-200 hover:bg-white/10 hover:text-white transition-colors text-left"
                  >
                    <Download size={13} className="text-emerald-400" />
                    <div>
                      <div className="font-semibold">Visual PDF (.pdf)</div>
                      <div className="text-[10px] text-neutral-400">
                        A4 styled layout
                      </div>
                    </div>
                  </button>
                  <button
                    onClick={() => {
                      setActiveExportDropdown(null);
                      onDownloadReport("vector");
                    }}
                    className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-neutral-200 hover:bg-white/10 hover:text-white transition-colors text-left"
                  >
                    <Printer size={13} className="text-emerald-400" />
                    <div>
                      <div className="font-semibold">Vector Print / PDF</div>
                      <div className="text-[10px] text-neutral-400">
                        Browser native print dialog
                      </div>
                    </div>
                  </button>
                  <button
                    onClick={() => {
                      setActiveExportDropdown(null);
                      onDownloadReport("html");
                    }}
                    className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-neutral-200 hover:bg-white/10 hover:text-white transition-colors text-left"
                  >
                    <Globe size={13} className="text-emerald-400" />
                    <div>
                      <div className="font-semibold">Offline HTML Report</div>
                      <div className="text-[10px] text-neutral-400">
                        Self-contained file
                      </div>
                    </div>
                  </button>
                </div>
              )}
            </div>

            {/* SAVE REPORT BUTTON */}
            {onSaveReport && (
              <button
                onClick={onSaveReport}
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
            )}
          </div>
        )}
      </div>

      {/* READINESS & QUALITATIVE GATING SECTION */}
      {scanResult.readiness ? (
        <div className="p-4 rounded-xl bg-[#0D0D0D] border border-white/10 space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-white/5 pb-2.5">
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
              <span className="text-xs font-bold uppercase tracking-wider text-white">
                Readiness & Qualitative Alignment
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-[11px] font-mono">
              <span
                className={`px-2 py-0.5 rounded border ${getTierColor(
                  scanResult.readiness.core_alignment_tier
                )}`}
              >
                Alignment: {formatTierLabel(scanResult.readiness.core_alignment_tier)}
              </span>
              <span
                className={`px-2 py-0.5 rounded border ${getTierColor(
                  scanResult.readiness.substance_tier
                )}`}
              >
                Substance: {formatTierLabel(scanResult.readiness.substance_tier)}
              </span>
              <span
                className={`px-2 py-0.5 rounded border ${getTierColor(
                  scanResult.readiness.parseability_tier
                )}`}
              >
                Format: {formatTierLabel(scanResult.readiness.parseability_tier)}
              </span>
            </div>
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="text-neutral-300 font-medium">
                Mandatory Requirement Coverage
              </span>
              <span className="font-mono font-bold text-white">
                {scanResult.readiness.mandatory_coverage_pct}%
              </span>
            </div>
            <div className="w-full h-2 bg-neutral-800 rounded-full overflow-hidden">
              <div
                className={`h-full transition-all duration-500 ${
                  scanResult.readiness.mandatory_coverage_pct >= 80
                    ? "bg-emerald-400"
                    : scanResult.readiness.mandatory_coverage_pct >= 60
                    ? "bg-amber-400"
                    : "bg-rose-400"
                }`}
                style={{
                  width: `${Math.min(
                    scanResult.readiness.mandatory_coverage_pct,
                    100
                  )}%`,
                }}
              />
            </div>
          </div>
        </div>
      ) : (
        <div className="p-3.5 rounded-xl bg-[#0D0D0D] border border-amber-500/20 text-xs text-amber-300/90 flex items-center gap-2.5">
          <Info className="w-4 h-4 text-amber-400 shrink-0" />
          <span>
            <strong>Legacy Report Format:</strong> Contextual readiness gating was
            not evaluated for this historical scan. Overall score reflects
            deterministic structural and keyword taxonomy metrics.
          </span>
        </div>
      )}

      {/* JOB-DESCRIPTION ALIGNMENT & EVIDENCE OVERVIEW */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Requirement Coverage Summary */}
        <div className="p-4 rounded-xl bg-[#0D0D0D] border border-white/10 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Layers className="w-4 h-4 text-emerald-400" />
              <span className="text-xs font-bold text-white uppercase tracking-wider">
                Job Alignment Coverage
              </span>
            </div>
            {onSwitchToMatchMap && (
              <button
                onClick={onSwitchToMatchMap}
                className="text-[11px] text-emerald-400 hover:text-emerald-300 font-semibold cursor-pointer"
              >
                View Match Map →
              </button>
            )}
          </div>

          {reqMatches.length > 0 ? (
            <div className="grid grid-cols-2 gap-3 pt-1">
              <div className="p-3 bg-[#141414] rounded-lg border border-white/5 space-y-1">
                <div className="text-[10px] font-mono text-neutral-400 uppercase tracking-wider">
                  Mandatory Requirements
                </div>
                <div className="text-base font-bold text-white flex items-baseline gap-1">
                  <span
                    className={
                      mandatoryCovered === mandatoryReqs.length
                        ? "text-emerald-400"
                        : "text-amber-400"
                    }
                  >
                    {mandatoryCovered}
                  </span>
                  <span className="text-xs text-neutral-500">
                    / {mandatoryReqs.length} covered
                  </span>
                </div>
                <div className="text-[10px] text-neutral-400">
                  {mandatoryReqs.length - mandatoryCovered > 0
                    ? `${mandatoryReqs.length - mandatoryCovered} missing in resume`
                    : "100% core alignment"}
                </div>
              </div>

              <div className="p-3 bg-[#141414] rounded-lg border border-white/5 space-y-1">
                <div className="text-[10px] font-mono text-neutral-400 uppercase tracking-wider">
                  Preferred / Bonus
                </div>
                <div className="text-base font-bold text-white flex items-baseline gap-1">
                  <span className="text-emerald-400">{preferredCovered}</span>
                  <span className="text-xs text-neutral-500">
                    / {preferredReqs.length} covered
                  </span>
                </div>
                <div className="text-[10px] text-neutral-400">
                  {preferredReqs.length > 0
                    ? `${Math.round(
                        (preferredCovered / preferredReqs.length) * 100
                      )}% bonus match`
                    : "No preferred listed"}
                </div>
              </div>
            </div>
          ) : (
            <div className="text-xs text-neutral-400 space-y-1">
              <p>
                Matched{" "}
                <strong className="text-emerald-400">
                  {scanResult.keyword_matrix.matched_count}
                </strong>{" "}
                of{" "}
                <strong className="text-white">
                  {scanResult.keyword_matrix.total_jd_keywords ||
                    scanResult.keyword_matrix.matched_count}
                </strong>{" "}
                technical taxonomy keywords (
                {Math.round(scanResult.keyword_matrix.match_percentage)}%).
              </p>
              <p className="text-[11px] text-neutral-500">
                Detailed requirement-evidence links are available for contextual scans.
              </p>
            </div>
          )}
        </div>

        {/* Truth Integrity & Analysis Confidence */}
        <div className="p-4 rounded-xl bg-[#0D0D0D] border border-white/10 space-y-3">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-emerald-400" />
            <span className="text-xs font-bold text-white uppercase tracking-wider">
              Truth Integrity & Engine Confidence
            </span>
          </div>

          <div className="space-y-2 pt-1 text-xs">
            {atsEvidenceReport ? (
              <div
                className={`p-2.5 rounded-lg border flex items-center justify-between ${
                  atsEvidenceReport.truthIntegrityStatus === "VERIFIED"
                    ? "bg-emerald-950/20 border-emerald-500/30 text-emerald-300"
                    : "bg-rose-950/30 border-rose-500/40 text-rose-300"
                }`}
              >
                <div className="flex items-center gap-2">
                  <ShieldCheck size={14} className="shrink-0" />
                  <span>
                    Truth Integrity:{" "}
                    <strong>{atsEvidenceReport.truthIntegrityStatus}</strong>
                  </span>
                </div>
                <span className="text-[10px] font-mono text-neutral-400">
                  Evaluated independently
                </span>
              </div>
            ) : (
              <div className="p-2.5 rounded-lg border border-white/5 bg-[#141414] text-neutral-300 flex items-center justify-between">
                <span>Resume Truth Integrity</span>
                <span className="text-[10px] font-mono text-emerald-400 font-semibold">
                  Verified against facts
                </span>
              </div>
            )}

            <div className="flex items-center justify-between text-neutral-400 text-[11px]">
              <span>Analysis Mode:</span>
              <span className="font-mono text-neutral-200">
                {analysisModeLabel}
              </span>
            </div>

            {scanResult.confidence_level && (
              <div className="flex items-center justify-between text-neutral-400 text-[11px]">
                <span>Analysis Confidence:</span>
                <span
                  className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase border ${confidenceBadge}`}
                >
                  {scanResult.confidence_level}
                </span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* DISCLOSURE FOOTER */}
      <div className="pt-2 border-t border-white/5 flex items-center gap-2 text-[11px] text-neutral-500">
        <Info size={12} className="shrink-0 text-neutral-400" />
        <span>
          <strong>Transparency Notice:</strong> Heuristic ATS scores model parsing
          and alignment. Scores do not guarantee an interview or replicate every
          employer's proprietary ATS filter.
        </span>
      </div>
    </div>
  );
};
