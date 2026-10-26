import React, { useState } from "react";
import {
  Sparkles,
  ShieldCheck,
  AlertTriangle,
  RotateCcw,
  Check,
  Lock,
  Quote,
} from "lucide-react";
import {
  GroundedRewriteProposalItem,
  TruthLockAuditReport,
  EvidenceAuditFinding,
} from "../../../types/scanner";

interface RewritesAuditViewProps {
  proposals: GroundedRewriteProposalItem[];
  auditReport?: TruthLockAuditReport | null;
  onApplyProposal?: (originalText: string, proposedText: string) => Promise<void> | void;
  canEditResume?: boolean;
  isHistorical?: boolean;
}

export const RewritesAuditView: React.FC<RewritesAuditViewProps> = ({
  proposals = [],
  auditReport,
  onApplyProposal,
  canEditResume = true,
  isHistorical = false,
}) => {
  const [subTab, setSubTab] = useState<"proposals" | "audit">("proposals");
  const [applyingProposalText, setApplyingProposalText] = useState<string | null>(null);
  const [appliedProposals, setAppliedProposals] = useState<Set<string>>(new Set());
  const [dismissedProposals, setDismissedProposals] = useState<Set<string>>(new Set());
  const [severityFilter, setSeverityFilter] = useState<"all" | "blocking" | "advisory">("all");

  // Helper to find audit finding for a specific proposal
  const getProposalFinding = (proposal: GroundedRewriteProposalItem): EvidenceAuditFinding | undefined => {
    if (!auditReport?.findings) return undefined;
    return auditReport.findings.find(
      (f) =>
        f.target_type === "rewrite_proposal" &&
        (f.target_identifier === proposal.original_text ||
          (proposal.original_text && f.target_identifier.includes(proposal.original_text.slice(0, 30))))
    );
  };

  const handleApply = async (proposal: GroundedRewriteProposalItem) => {
    if (isHistorical || !canEditResume) {
      console.warn("Rewrite application disabled in read-only historical mode.");
      return;
    }
    try {
      setApplyingProposalText(proposal.original_text);
      if (onApplyProposal) {
        await onApplyProposal(proposal.original_text, proposal.proposed_text);
      }
      setAppliedProposals((prev) => new Set([...prev, proposal.original_text]));
    } catch (err) {
      console.error("Error applying rewrite proposal:", err);
    } finally {
      setApplyingProposalText(null);
    }
  };

  const handleDismiss = (proposal: GroundedRewriteProposalItem) => {
    setDismissedProposals((prev) => new Set([...prev, proposal.original_text]));
  };

  const visibleProposals = proposals.filter((p) => !dismissedProposals.has(p.original_text));
  const findingsList = auditReport?.findings || [];
  const filteredFindings = findingsList.filter((f) => {
    if (severityFilter === "blocking") return f.severity === "blocking" || f.is_blocking;
    if (severityFilter === "advisory") return f.severity === "advisory" && !f.is_blocking;
    return true;
  });

  return (
    <div className="h-full flex flex-col space-y-4" data-testid="rewrites-audit-view">
      {/* SUB-TAB TOGGLE */}
      <div className="flex items-center justify-between shrink-0 bg-[#161616] p-2 rounded-xl border border-white/10">
        <div className="flex items-center bg-[#0D0D0D] p-1 rounded-lg border border-white/10">
          <button
            type="button"
            onClick={() => setSubTab("proposals")}
            className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all flex items-center gap-2 cursor-pointer ${
              subTab === "proposals"
                ? "bg-white text-black font-bold shadow-sm"
                : "text-neutral-400 hover:text-white"
            }`}
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>Grounded Bullet Rewrites ({visibleProposals.length})</span>
          </button>
          <button
            type="button"
            onClick={() => setSubTab("audit")}
            className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all flex items-center gap-2 cursor-pointer ${
              subTab === "audit"
                ? "bg-white text-black font-bold shadow-sm"
                : "text-neutral-400 hover:text-white"
            }`}
          >
            <ShieldCheck className="w-3.5 h-3.5" />
            <span>Truth-Lock Audit Findings ({findingsList.length})</span>
          </button>
        </div>

        {subTab === "audit" && (
          <div className="flex items-center gap-1 text-xs">
            <button
              type="button"
              onClick={() => setSeverityFilter("all")}
              className={`px-2 py-1 rounded text-[11px] font-medium transition-colors ${
                severityFilter === "all" ? "bg-neutral-800 text-white font-bold" : "text-neutral-400 hover:text-white"
              }`}
            >
              All ({findingsList.length})
            </button>
            <button
              type="button"
              onClick={() => setSeverityFilter("blocking")}
              className={`px-2 py-1 rounded text-[11px] font-medium transition-colors ${
                severityFilter === "blocking" ? "bg-rose-500/20 text-rose-300 font-bold" : "text-neutral-400 hover:text-rose-400"
              }`}
            >
              Blocking ({auditReport?.blocking_violations_count ?? 0})
            </button>
            <button
              type="button"
              onClick={() => setSeverityFilter("advisory")}
              className={`px-2 py-1 rounded text-[11px] font-medium transition-colors ${
                severityFilter === "advisory" ? "bg-amber-500/20 text-amber-300 font-bold" : "text-neutral-400 hover:text-amber-400"
              }`}
            >
              Advisory ({auditReport?.advisory_warnings_count ?? 0})
            </button>
          </div>
        )}
      </div>

      {/* CONTENT PANELS */}
      <div className="flex-1 overflow-y-auto">
        {subTab === "proposals" ? (
          visibleProposals.length === 0 ? (
            <div className="p-12 text-center text-xs text-neutral-400 bg-[#161616] rounded-2xl border border-white/10">
              No rewrite proposals available. Your resume statements already demonstrate strong evidence grounding.
            </div>
          ) : (
            <div className="space-y-4">
              {visibleProposals.map((proposal, idx) => {
                const finding = getProposalFinding(proposal);
                const isBlocking = Boolean(finding?.severity === "blocking" || finding?.is_blocking);
                const isApplied = appliedProposals.has(proposal.original_text);
                const isApplying = applyingProposalText === proposal.original_text;

                return (
                  <div
                    key={idx}
                    className={`p-5 rounded-2xl border shadow-sm space-y-4 transition-all ${
                      isApplied
                        ? "bg-emerald-950/20 border-emerald-500/40"
                        : isBlocking
                        ? "bg-rose-950/15 border-rose-500/30"
                        : "bg-[#161616] border-white/10"
                    }`}
                  >
                    {/* TOP PROPOSAL STATUS HEADER */}
                    <div className="flex items-center justify-between border-b border-white/5 pb-3">
                      <div className="flex items-center gap-2">
                        <span className="w-5 h-5 rounded-lg bg-emerald-500/10 text-emerald-400 font-mono font-bold flex items-center justify-center text-[11px] border border-emerald-500/20">
                          {idx + 1}
                        </span>
                        <h4 className="text-xs font-bold text-white uppercase tracking-wider">
                          Grounded Resume Bullet Proposal
                        </h4>
                      </div>

                      <div className="flex items-center gap-2">
                        {isApplied ? (
                          <span className="px-2.5 py-0.5 rounded-full text-xs font-mono font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 flex items-center gap-1">
                            <Check className="w-3 h-3 text-emerald-400" />
                            <span>Applied to Resume</span>
                          </span>
                        ) : isBlocking ? (
                          <span className="px-2.5 py-0.5 rounded-full text-xs font-mono font-bold bg-rose-500/20 text-rose-300 border border-rose-500/30 flex items-center gap-1">
                            <Lock className="w-3 h-3 text-rose-400" />
                            <span>Application Blocked by Truth-Lock</span>
                          </span>
                        ) : (
                          <span className="px-2.5 py-0.5 rounded-full text-xs font-mono font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center gap-1">
                            <ShieldCheck className="w-3 h-3 text-emerald-400" />
                            <span>Verified Grounded</span>
                          </span>
                        )}
                      </div>
                    </div>

                    {/* SIDE-BY-SIDE DIFF (ORIGINAL VS PROPOSED) */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {/* Original Bullet */}
                      <div className="p-3.5 rounded-xl bg-[#0F0F0F] border border-rose-500/20 space-y-1.5">
                        <span className="text-[10px] font-mono uppercase tracking-wider text-rose-400 font-bold">
                          Original Resume Bullet
                        </span>
                        <p className="text-xs text-neutral-300 leading-relaxed font-sans">
                          {proposal.original_text}
                        </p>
                      </div>

                      {/* Proposed Grounded Bullet */}
                      <div className="p-3.5 rounded-xl bg-[#0F0F0F] border border-emerald-500/30 space-y-1.5">
                        <span className="text-[10px] font-mono uppercase tracking-wider text-emerald-400 font-bold flex items-center gap-1">
                          <Sparkles className="w-3 h-3" />
                          <span>Proposed Grounded Revision</span>
                        </span>
                        <p className="text-xs text-white font-medium leading-relaxed font-sans">
                          {proposal.proposed_text}
                        </p>
                      </div>
                    </div>

                    {/* FACTUAL BASIS CALLOUT */}
                    <div className="p-3.5 rounded-xl bg-[#111111] border border-white/5 space-y-1">
                      <span className="text-[10px] font-mono uppercase tracking-wider text-neutral-400 flex items-center gap-1">
                        <Quote className="w-3 h-3 text-emerald-400" />
                        <span>Factual Basis & Grounding Provenance</span>
                      </span>
                      <p className="text-xs text-neutral-300 leading-relaxed font-serif italic">
                        "{proposal.factual_basis}"
                      </p>
                      <p className="text-[11px] text-neutral-400 pt-1 font-sans">
                        Rationale: {proposal.explanation}
                      </p>
                    </div>

                    {/* BLOCKING AUDIT FINDING CALLOUT (IF BLOCKED) */}
                    {isBlocking && finding && (
                      <div className="p-3 rounded-xl bg-rose-950/20 border border-rose-500/30 text-xs text-rose-300 flex items-start gap-2">
                        <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                        <div>
                          <p className="font-bold">Truth-Lock Violation:</p>
                          <p className="text-[11px] text-rose-200/90 leading-relaxed">{finding.reason}</p>
                        </div>
                      </div>
                    )}

                    {/* HUMAN APPROVAL ACTION BUTTONS OR READ-ONLY HISTORICAL NOTICE */}
                    {isHistorical ? (
                      <div className="flex items-center justify-end pt-2">
                        <span className="px-3 py-1.5 rounded-xl bg-neutral-900 border border-white/10 text-xs font-mono text-neutral-400 flex items-center gap-1.5">
                          <Lock className="w-3.5 h-3.5 text-amber-400" />
                          <span>Historical Snapshot • Resume Modification Disabled</span>
                        </span>
                      </div>
                    ) : (
                      <div className="flex items-center justify-end gap-3 pt-2">
                        <button
                          type="button"
                          onClick={() => handleDismiss(proposal)}
                          disabled={isApplied}
                          className="px-3 py-1.5 rounded-xl text-neutral-400 hover:text-white text-xs font-semibold transition-colors cursor-pointer disabled:opacity-30"
                        >
                          Keep Original
                        </button>

                        <button
                          type="button"
                          onClick={() => handleApply(proposal)}
                          disabled={isApplied || isBlocking || isApplying || !canEditResume}
                          className="px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-black font-bold text-xs shadow-md transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                          title={
                            isBlocking
                              ? "Blocked: This proposal contains ungrounded claims."
                              : !canEditResume
                              ? "Resume editing unavailable for external uploads."
                              : "Apply approved bullet revision to target resume"
                          }
                        >
                          {isApplied ? (
                            <>
                              <Check className="w-3.5 h-3.5" />
                              <span>Applied Successfully</span>
                            </>
                          ) : isApplying ? (
                            <>
                              <RotateCcw className="w-3.5 h-3.5 animate-spin" />
                              <span>Applying to Resume...</span>
                            </>
                          ) : (
                            <>
                              <Check className="w-3.5 h-3.5" />
                              <span>Approve & Update Resume</span>
                            </>
                          )}
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )
        ) : (
          /* TRUTH-LOCK EVIDENCE AUDIT FINDINGS LOG */
          <div className="space-y-4">
            {/* AUDIT SUMMARY STATUS CARD */}
            {auditReport && (
              <div className="p-4 rounded-xl bg-[#161616] border border-white/10 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs">
                <div>
                  <span className="text-[10px] font-mono text-neutral-400 uppercase">Audit Result</span>
                  <p className="text-sm font-bold text-white capitalize mt-0.5">
                    Status: {auditReport.status} • {auditReport.blocking_violations_count} Blocking, {auditReport.advisory_warnings_count} Advisory
                  </p>
                  <p className="text-neutral-400 text-[11px] mt-0.5">{auditReport.summary}</p>
                </div>
                <div className="font-mono text-[11px] text-neutral-400">
                  Original Score Preserved: <span className="text-white font-bold">{auditReport.original_ai_score}/100</span>
                </div>
              </div>
            )}

            {filteredFindings.length === 0 ? (
              <div className="p-12 text-center text-xs text-neutral-400 bg-[#161616] rounded-2xl border border-white/10">
                Zero findings detected under the selected severity filter.
              </div>
            ) : (
              <div className="space-y-3">
                {filteredFindings.map((finding, idx) => {
                  const isBlocking = finding.severity === "blocking" || finding.is_blocking;
                  return (
                    <div
                      key={idx}
                      className={`p-4 rounded-xl border space-y-2 text-xs ${
                        isBlocking
                          ? "bg-rose-950/15 border-rose-500/30"
                          : "bg-amber-950/15 border-amber-500/30"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-mono uppercase font-bold tracking-wider ${
                            isBlocking
                              ? "bg-rose-500/20 text-rose-300 border border-rose-500/30"
                              : "bg-amber-500/20 text-amber-300 border border-amber-500/30"
                          }`}
                        >
                          {isBlocking ? "Blocking Violation" : "Advisory Observation"}
                        </span>
                        <span className="text-[10px] font-mono text-neutral-400">
                          Target: {finding.target_type}
                        </span>
                      </div>

                      <p className="text-xs text-neutral-200 leading-relaxed font-sans">
                        {finding.reason}
                      </p>

                      {finding.cited_text && (
                        <div className="p-2.5 rounded-lg bg-[#0E0E0E] border border-white/5 space-y-0.5">
                          <span className="text-[10px] font-mono text-neutral-400 uppercase">Evaluated Claim</span>
                          <p className="text-[11px] font-serif italic text-neutral-300">
                            "{finding.cited_text}"
                          </p>
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
    </div>
  );
};

export default RewritesAuditView;
