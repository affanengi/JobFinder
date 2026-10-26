import React, { useState } from "react";
import {
  Sparkles,
  CheckCircle2,
  X,
  ShieldCheck,
  Loader2,
  Copy,
  Check,
} from "lucide-react";

interface SingleBulletRewriteModalProps {
  isOpen: boolean;
  onClose: () => void;
  originalText: string;
  suggestedText: string;
  bulletRoleOrProject?: string;
  bulletSection?: string;
  rationale?: string;
  targetRequirement?: string;
  onApply: (newText: string) => Promise<void> | void;
}

export const SingleBulletRewriteModal: React.FC<SingleBulletRewriteModalProps> = ({
  isOpen,
  onClose,
  originalText,
  suggestedText,
  bulletRoleOrProject,
  bulletSection,
  rationale,
  targetRequirement,
  onApply,
}) => {
  const [isApplying, setIsApplying] = useState(false);
  const [copied, setCopied] = useState(false);

  if (!isOpen) return null;

  const handleConfirmApply = async () => {
    setIsApplying(true);
    try {
      await onApply(suggestedText);
      onClose();
    } finally {
      setIsApplying(false);
    }
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(suggestedText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fade-in">
      <div className="bg-[#141414] border border-white/15 rounded-2xl max-w-2xl w-full p-6 space-y-5 shadow-2xl relative">
        <div className="flex items-center justify-between border-b border-white/10 pb-4">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-xl bg-emerald-500/10 text-emerald-400">
              <Sparkles size={18} />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white">Review Verified Bullet Rewrite</h3>
              <p className="text-[11px] text-neutral-400">
                {bulletSection || "Experience"} {bulletRoleOrProject ? `• ${bulletRoleOrProject}` : ""}
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

        {/* FACTUAL BOUNDARY SAFETY BADGE */}
        <div className="p-3 bg-emerald-950/20 border border-emerald-500/20 rounded-xl text-xs text-emerald-300 flex items-center gap-2.5">
          <ShieldCheck size={16} className="text-emerald-400 shrink-0" />
          <span>
            <strong>Grounded in Candidate Facts:</strong> This proposed rewrite strengthens action verbs and quantifiable metrics without fabricating unverified tools or inflated achievements.
          </span>
        </div>

        {/* SIDE-BY-SIDE / DIFFERENTIATED PREVIEWS */}
        <div className="space-y-3">
          {/* Original */}
          <div className="p-4 rounded-xl bg-[#0D0D0D] border border-white/10 space-y-1.5">
            <div className="text-[10px] font-mono uppercase tracking-wider text-neutral-400">
              Original Resume Bullet (Preserved)
            </div>
            <p className="text-xs text-neutral-300 leading-relaxed font-sans">
              {originalText}
            </p>
          </div>

          {/* Suggested */}
          <div className="p-4 rounded-xl bg-[#131A14] border border-emerald-500/30 space-y-1.5 relative">
            <div className="flex items-center justify-between">
              <div className="text-[10px] font-mono uppercase tracking-wider text-emerald-400 font-bold flex items-center gap-1">
                <Sparkles size={11} /> Proposed ATS-Optimized Version
              </div>
              <button
                onClick={handleCopy}
                className="text-[11px] text-neutral-400 hover:text-white flex items-center gap-1 cursor-pointer"
              >
                {copied ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
                <span>{copied ? "Copied" : "Copy"}</span>
              </button>
            </div>
            <p className="text-xs text-emerald-100 leading-relaxed font-sans font-medium">
              {suggestedText}
            </p>
          </div>
        </div>

        {/* TARGET & RATIONALE */}
        {(rationale || targetRequirement) && (
          <div className="p-3 rounded-xl bg-[#0D0D0D] border border-white/5 text-[11px] text-neutral-400 space-y-1">
            {targetRequirement && (
              <div>
                <strong className="text-white">Addresses Requirement:</strong> {targetRequirement}
              </div>
            )}
            {rationale && (
              <div>
                <strong className="text-white">Optimization Rationale:</strong> {rationale}
              </div>
            )}
          </div>
        )}

        {/* MODAL ACTIONS */}
        <div className="flex items-center justify-end gap-3 pt-3 border-t border-white/10 text-xs">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-[#1F1F1F] hover:bg-neutral-700 text-neutral-300 hover:text-white font-medium transition-colors cursor-pointer"
          >
            Cancel (Keep Original)
          </button>

          <button
            onClick={handleConfirmApply}
            disabled={isApplying}
            className="flex items-center gap-1.5 px-5 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-black font-bold transition-all cursor-pointer shadow-md disabled:opacity-50"
          >
            {isApplying ? (
              <>
                <Loader2 size={13} className="animate-spin text-black" />
                <span>Applying to Resume...</span>
              </>
            ) : (
              <>
                <CheckCircle2 size={13} className="text-black" />
                <span>Apply Rewrite to Resume</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
