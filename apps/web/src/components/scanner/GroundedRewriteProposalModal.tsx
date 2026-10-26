import React, { useState, useEffect } from "react";
import {
  Sparkles,
  CheckCircle2,
  X,
  ShieldCheck,
  ShieldAlert,
  ShieldX,
  Loader2,
  Copy,
  Check,
  Edit3,
} from "lucide-react";
import { GroundedRewriteProposalItem } from "../../types/scanner";

interface GroundedRewriteProposalModalProps {
  isOpen: boolean;
  onClose: () => void;
  proposal: GroundedRewriteProposalItem | null;
  isBlocking?: boolean;
  blockingReason?: string;
  onApply: (approvedText: string) => Promise<void> | void;
}

export const GroundedRewriteProposalModal: React.FC<GroundedRewriteProposalModalProps> = ({
  isOpen,
  onClose,
  proposal,
  isBlocking = false,
  blockingReason,
  onApply,
}) => {
  const [editedText, setEditedText] = useState<string>("");
  const [isEditing, setIsEditing] = useState<boolean>(false);
  const [isApplying, setIsApplying] = useState<boolean>(false);
  const [copied, setCopied] = useState<boolean>(false);
  const [userConfirmedReview, setUserConfirmedReview] = useState<boolean>(false);

  useEffect(() => {
    if (proposal) {
      setEditedText(proposal.proposed_text);
      setIsEditing(false);
      setUserConfirmedReview(false);
    }
  }, [proposal]);

  if (!isOpen || !proposal) return null;

  const requiresReviewCheckbox =
    proposal.validation_status === "pending_review" ||
    proposal.validation_status === "unverified";

  const canApply = !isBlocking && (!requiresReviewCheckbox || userConfirmedReview) && editedText.trim().length > 0;

  const handleConfirmApply = async () => {
    if (!canApply) return;
    setIsApplying(true);
    try {
      await onApply(editedText.trim());
      onClose();
    } finally {
      setIsApplying(false);
    }
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(editedText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fade-in"
      data-testid="grounded-rewrite-modal"
    >
      <div className="bg-[#141414] border border-white/15 rounded-2xl max-w-2xl w-full p-6 space-y-5 shadow-2xl relative">
        <div className="flex items-center justify-between border-b border-white/10 pb-4">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-xl bg-emerald-500/10 text-emerald-400">
              <Sparkles size={18} />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white">Grounded Resume Rewrite Proposal</h3>
              <p className="text-[11px] text-neutral-400">
                Evidence-backed bullet optimization • Zero unverified claims
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-neutral-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
          >
            <X size={16} />
          </button>
        </div>

        {/* VALIDATION STATUS BANNER */}
        {isBlocking ? (
          <div className="p-3 bg-rose-950/20 border border-rose-500/30 rounded-xl text-xs text-rose-300 flex items-start gap-2.5">
            <ShieldX size={16} className="text-rose-400 shrink-0 mt-0.5" />
            <div>
              <strong className="text-rose-200">Truth-Lock Blocked:</strong>{" "}
              {blockingReason || "This proposal contains unverified claims or unsupported numerical metrics and cannot be applied."}
            </div>
          </div>
        ) : requiresReviewCheckbox ? (
          <div className="p-3 bg-amber-950/20 border border-amber-500/30 rounded-xl text-xs text-amber-300 flex items-start gap-2.5">
            <ShieldAlert size={16} className="text-amber-400 shrink-0 mt-0.5" />
            <div>
              <strong className="text-amber-200">Human Review Required:</strong>{" "}
              Please carefully review this revision to confirm it accurately describes your achievements before applying.
            </div>
          </div>
        ) : (
          <div className="p-3 bg-emerald-950/20 border border-emerald-500/20 rounded-xl text-xs text-emerald-300 flex items-center gap-2.5">
            <ShieldCheck size={16} className="text-emerald-400 shrink-0" />
            <span>
              <strong>Grounded in Verified Facts:</strong> This proposed rewrite strictly preserves candidate truth while enhancing action verbs and role alignment.
            </span>
          </div>
        )}

        {/* COMPARISON PREVIEWS */}
        <div className="space-y-3">
          {/* Original Bullet */}
          <div className="p-4 rounded-xl bg-[#0D0D0D] border border-white/10 space-y-1.5">
            <div className="text-[10px] font-mono uppercase tracking-wider text-neutral-400 font-bold">
              Original Resume Bullet (Preserved)
            </div>
            <p className="text-xs text-neutral-300 leading-relaxed font-sans">
              {proposal.original_text}
            </p>
          </div>

          {/* Proposed Bullet */}
          <div className="p-4 rounded-xl bg-[#131A14] border border-emerald-500/30 space-y-2 relative">
            <div className="flex items-center justify-between">
              <div className="text-[10px] font-mono uppercase tracking-wider text-emerald-400 font-bold flex items-center gap-1">
                <Sparkles size={11} /> Proposed ATS-Optimized Revision
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setIsEditing(!isEditing)}
                  className="text-[11px] text-neutral-400 hover:text-white flex items-center gap-1 cursor-pointer"
                >
                  <Edit3 size={12} className={isEditing ? "text-emerald-400" : ""} />
                  <span>{isEditing ? "Done Editing" : "Edit Text"}</span>
                </button>
                <button
                  onClick={handleCopy}
                  className="text-[11px] text-neutral-400 hover:text-white flex items-center gap-1 cursor-pointer"
                >
                  {copied ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
                  <span>{copied ? "Copied" : "Copy"}</span>
                </button>
              </div>
            </div>

            {isEditing ? (
              <textarea
                value={editedText}
                onChange={(e) => setEditedText(e.target.value)}
                rows={3}
                className="w-full p-2.5 rounded-lg bg-[#0D0D0D] border border-white/20 text-xs text-white focus:outline-none focus:border-emerald-500 font-sans leading-relaxed"
                placeholder="Edit proposed bullet text..."
              />
            ) : (
              <p className="text-xs text-emerald-100 leading-relaxed font-sans font-medium">
                {editedText}
              </p>
            )}
          </div>
        </div>

        {/* FACTUAL BASIS & EXPLANATION */}
        <div className="p-3.5 rounded-xl bg-[#0D0D0D] border border-white/5 text-[11px] space-y-2">
          {proposal.factual_basis && (
            <div>
              <span className="font-bold text-neutral-300">Factual Basis in Evidence:</span>{" "}
              <span className="text-neutral-400">{proposal.factual_basis}</span>
            </div>
          )}
          {proposal.explanation && (
            <div>
              <span className="font-bold text-neutral-300">Why this improves ATS alignment:</span>{" "}
              <span className="text-neutral-400">{proposal.explanation}</span>
            </div>
          )}
        </div>

        {/* HUMAN APPROVAL CONFIRMATION CHECKBOX */}
        {requiresReviewCheckbox && !isBlocking && (
          <label className="flex items-start gap-2.5 p-3 rounded-xl bg-[#1A1A1A] border border-white/10 text-xs text-neutral-300 cursor-pointer">
            <input
              type="checkbox"
              checked={userConfirmedReview}
              onChange={(e) => setUserConfirmedReview(e.target.checked)}
              className="mt-0.5 rounded border-white/20 text-emerald-500 focus:ring-0 focus:outline-none cursor-pointer"
            />
            <span>
              I have reviewed this proposed bullet and verify that it accurately and truthfully reflects my experience and qualifications.
            </span>
          </label>
        )}

        {/* ACTION BUTTONS */}
        <div className="flex items-center justify-end gap-3 pt-3 border-t border-white/10 text-xs">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-[#1F1F1F] hover:bg-neutral-700 text-neutral-300 hover:text-white font-medium transition-colors cursor-pointer"
          >
            Cancel (Keep Original)
          </button>

          <button
            onClick={handleConfirmApply}
            disabled={!canApply || isApplying}
            className={`flex items-center gap-1.5 px-5 py-2 rounded-xl font-bold transition-all cursor-pointer shadow-md ${
              canApply
                ? "bg-emerald-500 hover:bg-emerald-400 text-black"
                : "bg-neutral-800 text-neutral-500 cursor-not-allowed"
            }`}
          >
            {isApplying ? (
              <>
                <Loader2 size={13} className="animate-spin text-black" />
                <span>Applying to Resume...</span>
              </>
            ) : (
              <>
                <CheckCircle2 size={13} className={canApply ? "text-black" : "text-neutral-500"} />
                <span>Accept & Apply to Resume</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
