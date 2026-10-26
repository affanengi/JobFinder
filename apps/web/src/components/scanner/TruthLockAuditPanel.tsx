import React, { useState } from "react";
import {
  ShieldCheck,
  ShieldAlert,
  ShieldX,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { TruthLockAuditReport, EvidenceAuditFinding } from "../../types/scanner";

interface TruthLockAuditPanelProps {
  auditReport: TruthLockAuditReport;
  onFocusFinding?: (finding: EvidenceAuditFinding) => void;
}

export const TruthLockAuditPanel: React.FC<TruthLockAuditPanelProps> = ({
  auditReport,
  onFocusFinding,
}) => {
  const [isExpanded, setIsExpanded] = useState<boolean>(false);
  const [severityFilter, setSeverityFilter] = useState<"all" | "blocking" | "advisory">("all");

  const getStatusConfig = () => {
    if (auditReport.status === "pass" && auditReport.is_valid) {
      return {
        badge: "bg-emerald-500/15 border-emerald-500/30 text-emerald-400",
        icon: <ShieldCheck className="w-5 h-5 text-emerald-400" />,
        label: "Truth-Lock Passed (100% Grounded)",
        description: "Zero blocking violations detected. All evaluated findings and quotes are strictly supported by candidate facts.",
      };
    }
    if (auditReport.status === "review_required" || (!auditReport.is_valid && auditReport.blocking_violations_count === 0)) {
      return {
        badge: "bg-amber-500/15 border-amber-500/30 text-amber-400",
        icon: <ShieldAlert className="w-5 h-5 text-amber-400" />,
        label: "Human Review Required",
        description: "Advisory warnings detected. Some citations or proposed rewrites warrant candidate confirmation before application.",
      };
    }
    return {
      badge: "bg-rose-500/15 border-rose-500/30 text-rose-400",
      icon: <ShieldX className="w-5 h-5 text-rose-400" />,
      label: "Truth-Lock Blocked",
      description: "Blocking evidence violations detected (e.g. unsupported metrics or unverified facts). Rewrites are strictly blocked from automatic application.",
    };
  };

  const statusConfig = getStatusConfig();

  const findingsList = auditReport.findings || [];
  const filteredFindings = findingsList.filter((f) => {
    if (severityFilter === "blocking") return f.severity === "blocking" || f.is_blocking;
    if (severityFilter === "advisory") return f.severity === "advisory" && !f.is_blocking;
    return true;
  });

  return (
    <div
      className="bg-[#141414] border border-white/15 rounded-2xl p-5 sm:p-6 space-y-4 shadow-sm"
      data-testid="truth-lock-audit-panel"
    >
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-start sm:items-center gap-3.5">
          <div className="p-2.5 rounded-xl bg-[#0D0D0D] border border-white/10 shrink-0">
            {statusConfig.icon}
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`px-2.5 py-0.5 rounded-md text-xs font-mono font-bold border ${statusConfig.badge}`}>
                {statusConfig.label}
              </span>
              <span className="text-xs text-neutral-400 font-mono">
                {auditReport.passed_checks} / {auditReport.total_checks} checks passed
              </span>
              {auditReport.blocking_violations_count > 0 && (
                <span className="px-2 py-0.5 rounded-md text-xs font-mono font-bold bg-rose-500/20 text-rose-300 border border-rose-500/30">
                  {auditReport.blocking_violations_count} Blocking
                </span>
              )}
              {auditReport.advisory_warnings_count > 0 && (
                <span className="px-2 py-0.5 rounded-md text-xs font-mono font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">
                  {auditReport.advisory_warnings_count} Advisory
                </span>
              )}
            </div>
            <p className="text-xs text-neutral-400 mt-1 leading-relaxed">
              {auditReport.summary || statusConfig.description}
            </p>
          </div>
        </div>

        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#1A1A1A] hover:bg-[#222] border border-white/10 text-xs font-semibold text-neutral-300 hover:text-white transition-colors cursor-pointer self-start sm:self-auto"
        >
          <span>{isExpanded ? "Hide Evidence Audit" : "Inspect Evidence Audit"}</span>
          {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>
      </div>

      {isExpanded && (
        <div className="pt-4 border-t border-white/10 space-y-4 animate-fade-in">
          {/* FILTER CONTROLS */}
          <div className="flex items-center justify-between flex-wrap gap-2">
            <span className="text-xs font-bold uppercase tracking-wider text-neutral-400">
              Audit Findings ({auditReport.findings.length})
            </span>
            <div className="flex items-center bg-[#0D0D0D] p-1 rounded-xl border border-white/10 text-xs">
              <button
                onClick={() => setSeverityFilter("all")}
                className={`px-2.5 py-1 rounded-lg transition-colors cursor-pointer font-medium ${
                  severityFilter === "all" ? "bg-[#222] text-white font-bold" : "text-neutral-400 hover:text-white"
                }`}
              >
                All ({auditReport.findings.length})
              </button>
              <button
                onClick={() => setSeverityFilter("blocking")}
                className={`px-2.5 py-1 rounded-lg transition-colors cursor-pointer font-medium ${
                  severityFilter === "blocking" ? "bg-[#222] text-white font-bold" : "text-neutral-400 hover:text-white"
                }`}
              >
                Blocking ({auditReport.blocking_violations_count})
              </button>
              <button
                onClick={() => setSeverityFilter("advisory")}
                className={`px-2.5 py-1 rounded-lg transition-colors cursor-pointer font-medium ${
                  severityFilter === "advisory" ? "bg-[#222] text-white font-bold" : "text-neutral-400 hover:text-white"
                }`}
              >
                Advisory ({auditReport.advisory_warnings_count})
              </button>
            </div>
          </div>

          {/* FINDINGS LIST */}
          {filteredFindings.length === 0 ? (
            <div className="p-4 rounded-xl bg-[#0D0D0D] border border-white/5 text-xs text-neutral-400 text-center">
              No findings match the selected severity filter.
            </div>
          ) : (
            <div className="space-y-2.5 max-h-96 overflow-y-auto pr-1">
              {filteredFindings.map((finding, idx) => {
                const isBlocking = finding.severity === "blocking" || finding.is_blocking;
                return (
                  <div
                    key={idx}
                    onClick={() => onFocusFinding?.(finding)}
                    className={`p-3.5 rounded-xl border ${onFocusFinding ? "cursor-pointer hover:border-white/20 transition-all" : ""} ${
                      isBlocking
                        ? "bg-rose-950/20 border-rose-500/30 text-rose-200"
                        : finding.status === "review_required"
                        ? "bg-amber-950/20 border-amber-500/30 text-amber-200"
                        : "bg-[#0D0D0D] border-emerald-500/20 text-emerald-200"
                    } space-y-1.5`}
                  >
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded bg-black/40 border border-white/10 text-neutral-300">
                          {finding.target_type}
                        </span>
                        <span className="text-xs font-bold text-white">
                          {finding.target_identifier}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-mono text-neutral-400">
                          Source: {finding.evidence_source}
                        </span>
                        <span
                          className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded ${
                            isBlocking
                              ? "bg-rose-500/20 text-rose-400 border border-rose-500/30"
                              : finding.status === "review_required"
                              ? "bg-amber-500/20 text-amber-400 border border-amber-500/30"
                              : "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                          }`}
                        >
                          {isBlocking ? "BLOCKING" : finding.status.toUpperCase()}
                        </span>
                      </div>
                    </div>

                    <p className="text-xs text-neutral-300 leading-relaxed">
                      {finding.reason}
                    </p>

                    {finding.cited_text && (
                      <div className="p-2 rounded-lg bg-black/40 border border-white/5 text-[11px] font-mono text-neutral-400 italic">
                        "{finding.cited_text}"
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
