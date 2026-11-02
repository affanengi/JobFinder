import React from 'react';
import { Sparkles, X, Loader2, AlertCircle } from 'lucide-react';

interface BulkActionBarProps {
  selectedCount: number;
  maxSelection?: number;
  onResearch: () => void;
  onClear: () => void;
  isLoading?: boolean;
}

export const BulkActionBar: React.FC<BulkActionBarProps> = ({
  selectedCount,
  maxSelection = 5,
  onResearch,
  onClear,
  isLoading = false,
}) => {
  if (selectedCount === 0) return null;

  const isAtLimit = selectedCount >= maxSelection;

  return (
    <div
      role="region"
      aria-label="Bulk company research actions"
      className="fixed bottom-6 left-1/2 -translate-x-1/2 z-30 flex items-center gap-4 px-5 py-3 rounded-2xl bg-[#141414]/95 backdrop-blur-md border border-white/15 shadow-2xl shadow-black/90 transition-all duration-300 animate-in slide-in-from-bottom-5 max-w-xl w-[90%]"
    >
      <div className="flex items-center gap-3 flex-1 min-w-0">
        <div className="w-8 h-8 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center shrink-0">
          <Sparkles className="w-4 h-4 text-emerald-400" />
        </div>
        <div className="truncate">
          <p
            data-testid="selected-count-label"
            aria-label={`Selected ${selectedCount} of ${maxSelection} companies`}
            className="text-xs text-neutral-300 font-medium truncate"
          >
            Selected <span className="font-bold text-white">{selectedCount}</span> of{' '}
            <span className="font-bold text-white">{maxSelection}</span> companies
          </p>
          {isAtLimit && (
            <p className="text-[10px] text-amber-400 flex items-center gap-1 mt-0.5">
              <AlertCircle className="w-3 h-3 shrink-0" />
              Maximum 5 companies per batch (Free-tier safe)
            </p>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        <button
          type="button"
          onClick={onClear}
          disabled={isLoading}
          aria-label="Clear company selection"
          className="px-3 py-1.5 text-xs font-medium text-neutral-400 hover:text-white disabled:opacity-50 transition flex items-center gap-1 rounded-lg hover:bg-white/5"
        >
          <X className="w-3.5 h-3.5" />
          Clear
        </button>

        <button
          type="button"
          onClick={onResearch}
          disabled={isLoading || selectedCount === 0}
          aria-label={`Research ${selectedCount} selected companies`}
          className="px-4 py-2 bg-emerald-500 hover:bg-emerald-400 active:bg-emerald-600 disabled:opacity-50 disabled:cursor-not-allowed text-black font-semibold text-xs rounded-xl shadow-md transition flex items-center gap-2"
        >
          {isLoading ? (
            <>
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              <span>Researching...</span>
            </>
          ) : (
            <>
              <Sparkles className="w-3.5 h-3.5" />
              <span>Research Selected ({selectedCount})</span>
            </>
          )}
        </button>
      </div>
    </div>
  );
};
