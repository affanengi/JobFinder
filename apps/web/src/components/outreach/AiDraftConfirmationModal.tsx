import { Sparkles, AlertCircle, X, Loader2 } from 'lucide-react';

interface AiDraftConfirmationModalProps {
  isOpen: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  hasExistingText?: boolean;
  isGenerating?: boolean;
}

export const AiDraftConfirmationModal: React.FC<AiDraftConfirmationModalProps> = ({
  isOpen,
  onConfirm,
  onCancel,
  hasExistingText = false,
  isGenerating = false,
}) => {
  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="ai-confirmation-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-150"
    >
      <div className="relative w-full max-w-md bg-[#141414] border border-white/10 rounded-2xl p-6 shadow-2xl space-y-5 text-white">
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <h3 id="ai-confirmation-title" className="text-base font-semibold text-white">
                Generate tailored outreach draft with AI?
              </h3>
              <p className="text-xs text-neutral-400 mt-0.5">
                Truth-Lock Factual Grounding
              </p>
            </div>
          </div>
          <button
            onClick={onCancel}
            aria-label="Close dialog"
            className="p-1.5 rounded-lg text-neutral-400 hover:text-white hover:bg-white/5 transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="space-y-3 text-xs text-neutral-300 leading-relaxed">
          <p>
            JobFinder will analyze the opportunity details and synthesize a tailored draft strictly grounded in your verified Master Profile facts.
          </p>

          {hasExistingText && (
            <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-xl flex items-start gap-2.5 text-amber-300">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-amber-400" />
              <span>
                <strong>Note:</strong> Generating an AI draft will replace any draft content currently in the composer. (Cancelling preserves your text).
              </span>
            </div>
          )}

          <div className="text-[11px] text-neutral-400 bg-neutral-900/60 p-2.5 rounded-lg border border-white/5">
            🔒 <strong>Safety Guarantee:</strong> Generating an AI draft never sends an email. Sending is a separate action requiring your explicit approval.
          </div>
        </div>

        {/* Exactly Two Actions */}
        <div className="flex items-center justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={isGenerating}
            className="px-4 py-2 rounded-xl text-xs font-semibold bg-white/5 hover:bg-white/10 text-neutral-300 border border-white/10 transition disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isGenerating}
            className="px-4 py-2 rounded-xl text-xs font-semibold bg-emerald-500 hover:bg-emerald-600 text-black shadow-lg shadow-emerald-500/20 transition flex items-center gap-1.5 disabled:opacity-50"
          >
            {isGenerating ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Generating Draft...
              </>
            ) : (
              <>
                <Sparkles className="w-3.5 h-3.5" />
                Yes, write with AI
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
