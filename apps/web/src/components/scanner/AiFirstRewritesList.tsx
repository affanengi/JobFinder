import React, { useState } from "react";
import {
  Sparkles,
  ShieldCheck,
  ShieldAlert,
  ShieldX,
  Edit,
} from "lucide-react";
import {
  GroundedRewriteProposalItem,
  TruthLockAuditReport,
  EvidenceAuditFinding,
} from "../../types/scanner";
import { GroundedRewriteProposalModal } from "./GroundedRewriteProposalModal";

interface AiFirstRewritesListProps {
  proposals: GroundedRewriteProposalItem[];
  auditReport?: TruthLockAuditReport | null;
  onApplyProposal: (originalText: string, approvedText: string) => Promise<void> | void;
  canEditResume?: boolean;
}

export const AiFirstRewritesList: React.FC<AiFirstRewritesListProps> = ({
  proposals = [],
  auditReport,
  onApplyProposal,
  canEditResume = true,
}) => {
  const [activeModalProposal, setActiveModalProposal] = useState<GroundedRewriteProposalItem | null>(null);

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

  const activeFinding = activeModalProposal ? getProposalFinding(activeModalProposal) : undefined;
  const isModalProposalBlocking = Boolean(activeFinding?.severity === "blocking" || activeFinding?.is_blocking);
  const modalBlockingReason = activeFinding?.reason;

  return (
    <div
      className="bg-[#141414] border border-white/15 rounded-2xl p-6 space-y-6 shadow-sm"
      data-testid="ai-rewrites-list"
    >
      {/* HEADER */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-white/10 pb-4">
        <div>
          <h3 className="text-sm font-bold uppercase tracking-wider text-white flex items-center gap-2">
            <span>Grounded Bullet Rewrite Proposals</span>
            <span className="text-xs text-neutral-400 font-mono font-normal">
              ({proposals.length} evidence-backed suggestions)
            </span>
          </h3>
          <p className="text-xs text-neutral-400 mt-0.5">
            Strengthen action verbs, scope, and ATS alignment strictly preserving candidate truth. Human approval is required before applying.
          </p>
        </div>
      </div>

      {proposals.length === 0 ? (
        <div className="p-8 rounded-xl bg-[#0D0D0D] border border-white/5 text-center text-xs text-neutral-400">
          No rewrite proposals were suggested for this resume. The current presentation already demonstrates strong evidence grounding.
        </div>
      ) : (
        <div className="space-y-4">
          {proposals.map((prop, idx) => {
            const finding = getProposalFinding(prop);
            const isBlocking = finding?.severity === "blocking" || finding?.is_blocking;
            const requiresReview =
              prop.validation_status === "pending_review" ||
              prop.validation_status === "unverified" ||
              finding?.status === "review_required";

            return (
              <div
                key={idx}
                className="p-5 rounded-xl bg-[#0D0D0D] border border-white/10 space-y-4 hover:border-white/20 transition-all"
              >
                {/* STATUS BAR */}
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-mono font-bold text-neutral-400">
                      Proposal #{idx + 1}
                    </span>
                    {isBlocking ? (
                      <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-rose-500/15 border border-rose-500/30 text-rose-400 flex items-center gap-1">
                        <ShieldX size={11} /> Blocked by Truth-Lock
                      </span>
                    ) : requiresReview ? (
                      <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-amber-500/15 border border-amber-500/30 text-amber-400 flex items-center gap-1">
                        <ShieldAlert size={11} /> Candidate Review Required
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 flex items-center gap-1">
                        <ShieldCheck size={11} /> Verified Grounded
                      </span>
                    )}
                  </div>

                  {prop.explanation && (
                    <span className="text-[11px] text-neutral-400 max-w-md truncate">
                      {prop.explanation}
                    </span>
                  )}
                </div>

                {/* SIDE BY SIDE / COMPARISON VIEW */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                  {/* Original */}
                  <div className="p-3.5 rounded-xl bg-[#141414] border border-white/5 space-y-1">
                    <div className="text-[10px] font-mono uppercase text-neutral-500 font-bold">
                      Original Text
                    </div>
                    <p className="text-neutral-300 leading-relaxed font-sans">
                      {prop.original_text}
                    </p>
                  </div>

                  {/* Proposed */}
                  <div className="p-3.5 rounded-xl bg-[#131A14] border border-emerald-500/20 space-y-1">
                    <div className="text-[10px] font-mono uppercase text-emerald-400 font-bold flex items-center gap-1">
                      <Sparkles size={11} /> Proposed Revision
                    </div>
                    <p className="text-emerald-100 font-medium leading-relaxed font-sans">
                      {prop.proposed_text}
                    </p>
                  </div>
                </div>

                {/* FACTUAL BASIS */}
                {prop.factual_basis && (
                  <div className="p-2.5 rounded-lg bg-black/40 border border-white/5 text-[11px] text-neutral-400">
                    <strong className="text-neutral-300">Factual Basis:</strong> {prop.factual_basis}
                  </div>
                )}

                {/* ACTION BUTTON */}
                <div className="flex items-center justify-end gap-3 pt-2">
                  {canEditResume ? (
                    <button
                      onClick={() => setActiveModalProposal(prop)}
                      className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                        isBlocking
                          ? "bg-rose-500/10 border border-rose-500/30 text-rose-400 hover:bg-rose-500/20"
                          : "bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/30 text-emerald-400"
                      }`}
                    >
                      <Edit size={13} />
                      <span>{isBlocking ? "Inspect Blocked Proposal" : "Inspect & Apply to Resume"}</span>
                    </button>
                  ) : (
                    <span className="text-[11px] text-neutral-500 italic">
                      Direct resume editing is available for tailored resumes
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* REWRITE PROPOSAL MODAL */}
      <GroundedRewriteProposalModal
        isOpen={Boolean(activeModalProposal)}
        onClose={() => setActiveModalProposal(null)}
        proposal={activeModalProposal}
        isBlocking={isModalProposalBlocking}
        blockingReason={modalBlockingReason}
        onApply={async (approvedText) => {
          if (activeModalProposal) {
            await onApplyProposal(activeModalProposal.original_text, approvedText);
          }
        }}
      />
    </div>
  );
};
