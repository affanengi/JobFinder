import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  X,
  Sparkles,
  CheckCircle2,
  AlertTriangle,
  ShieldCheck,
  ShieldAlert,
  Loader2,
  ExternalLink,
  Users,
  Clock,
  Zap,
  Building2,
} from 'lucide-react';
import { useScrollLock } from '../../hooks/useScrollLock';
import {
  BulkCompanyResearchResponse,
  BulkCompanyResearchItemResult,
} from '../../types/company';

export type ProgressStage = 'harvesting' | 'synthesizing' | 'saving' | 'completed' | 'error';

interface BulkResearchProgressModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedCompanies: { key: string; name: string; domain: string }[];
  isLoading: boolean;
  progressStage: ProgressStage;
  progressPct?: number;
  stageDescription?: string;
  response: BulkCompanyResearchResponse | null;
  error: string | null;
  onNavigateToCompany: (companyKey: string) => void;
}

export const BulkResearchProgressModal: React.FC<BulkResearchProgressModalProps> = ({
  isOpen,
  onClose,
  selectedCompanies,
  isLoading,
  progressStage,
  progressPct,
  stageDescription,
  response,
  error,
  onNavigateToCompany,
}) => {
  useScrollLock(isOpen);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    if (isOpen) {
      window.addEventListener('keydown', handleKeyDown);
      return () => window.removeEventListener('keydown', handleKeyDown);
    }
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const renderStageIndicator = () => {
    const stages = [
      {
        id: 'harvesting',
        label: 'Harvest Evidence',
        desc: 'Reading corporate pages (max 2)',
      },
      {
        id: 'synthesizing',
        label: 'Gemini Synthesis',
        desc: '1 single batch request ($0 cost)',
      },
      {
        id: 'saving',
        label: 'Discovery & Saving',
        desc: 'Extracting contacts & persisting',
      },
    ];

    return (
      <div className="grid grid-cols-3 gap-2 p-3 bg-[#111111] rounded-xl border border-white/5 text-center">
        {stages.map((stage, idx) => {
          let status: 'done' | 'active' | 'pending' = 'pending';
          if (progressStage === 'completed') {
            status = 'done';
          } else if (stage.id === progressStage) {
            status = 'active';
          } else if (
            (stage.id === 'harvesting' && (progressStage === 'synthesizing' || progressStage === 'saving')) ||
            (stage.id === 'synthesizing' && progressStage === 'saving')
          ) {
            status = 'done';
          }

          return (
            <div
              key={stage.id}
              className={`p-2 rounded-lg transition-all ${
                status === 'active'
                  ? 'bg-emerald-500/10 border border-emerald-500/30'
                  : status === 'done'
                  ? 'bg-white/5 border border-white/5'
                  : 'opacity-50'
              }`}
            >
              <div className="flex items-center justify-center gap-1.5 mb-1">
                {status === 'done' ? (
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                ) : status === 'active' ? (
                  <Loader2 className="w-3.5 h-3.5 text-emerald-400 animate-spin" />
                ) : (
                  <div className="w-3.5 h-3.5 rounded-full border border-neutral-600 flex items-center justify-center text-[9px] text-neutral-400">
                    {idx + 1}
                  </div>
                )}
                <span className={`text-[11px] font-semibold ${status === 'active' ? 'text-emerald-300' : 'text-neutral-200'}`}>
                  {stage.label}
                </span>
              </div>
              <p className="text-[10px] text-neutral-400 hidden sm:block truncate">
                {stage.desc}
              </p>
            </div>
          );
        })}
      </div>
    );
  };

  const getRiskBadge = (riskTier?: string) => {
    switch (riskTier) {
      case 'NO_OBVIOUS_RED_FLAGS_FOUND':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
            <ShieldCheck className="w-3 h-3" /> No Red Flags
          </span>
        );
      case 'NEEDS_VERIFICATION':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/20">
            <AlertTriangle className="w-3 h-3" /> Verification Needed
          </span>
        );
      case 'SIGNIFICANT_RED_FLAGS':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-rose-500/10 text-rose-400 border border-rose-500/20">
            <ShieldAlert className="w-3 h-3" /> Red Flags
          </span>
        );
      default:
        return null;
    }
  };

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="bulk-research-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 overflow-y-auto animate-in fade-in duration-200"
    >
      <div 
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-2xl rounded-2xl bg-[#141414] border border-white/10 shadow-2xl overflow-hidden flex flex-col max-h-[85vh]"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-white/10 bg-[#181818]/90 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
              <Sparkles className="w-5 h-5 text-emerald-400" />
            </div>
            <div>
              <h2 id="bulk-research-title" className="text-sm font-bold text-white flex items-center gap-2">
                Bulk Corporate Intelligence & Discovery
              </h2>
              <p className="text-xs text-neutral-400">
                Researches {selectedCompanies.length} organizations under $0 Free Policy
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close bulk research modal"
            className="p-1.5 rounded-lg text-neutral-400 hover:text-white hover:bg-white/5 transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-5 overflow-y-auto space-y-4 flex-1 min-h-0">
          {/* Truthful Stage Indicator */}
          {renderStageIndicator()}

          {/* Progress percentage bar if available */}
          {isLoading && typeof progressPct === 'number' && (
            <div className="space-y-1.5 p-3 rounded-xl bg-[#111111] border border-white/5">
              <div className="flex justify-between items-center text-[11px] text-neutral-300 font-mono">
                <span className="truncate pr-2">{stageDescription || 'Executing background research...'}</span>
                <span className="font-bold text-emerald-400">{progressPct}%</span>
              </div>
              <div className="w-full h-1.5 bg-neutral-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-emerald-500 rounded-full transition-all duration-300"
                  style={{ width: `${Math.min(100, Math.max(5, progressPct))}%` }}
                />
              </div>
            </div>
          )}

          {/* Loading State Banner */}
          {isLoading && !progressPct && (
            <div className="p-4 rounded-xl bg-emerald-500/5 border border-emerald-500/20 space-y-2">
              <div className="flex items-center gap-2 text-xs font-semibold text-emerald-300">
                <Loader2 className="w-4 h-4 animate-spin text-emerald-400" />
                <span>
                  {progressStage === 'harvesting'
                    ? 'Harvesting corporate websites and About pages...'
                    : progressStage === 'synthesizing'
                    ? 'Synthesizing corporate overviews and Scam Shield assessments in 1 Gemini batch request...'
                    : 'Discovering multi-channel contacts and persisting records...'}
                </span>
              </div>
              <p className="text-[11px] text-neutral-400 leading-relaxed">
                Evidence is gathered independently with bounded timeouts (max 45s). To preserve Gemini free-tier quota, all uncached companies are evaluated together in a single structured prompt.
              </p>
            </div>
          )}

          {/* Error Banner */}
          {!isLoading && error && (
            <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/20 space-y-2 text-rose-200">
              <div className="flex items-center gap-2 text-xs font-semibold">
                <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
                <span>Bulk Research Failed</span>
              </div>
              <p className="text-xs text-rose-300">{error}</p>
            </div>
          )}

          {/* Completed Metrics Summary Strip */}
          {!isLoading && response && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <div className="p-3 rounded-xl bg-[#181818] border border-white/5 text-center">
                <span className="text-[10px] text-neutral-400 block uppercase tracking-wider font-semibold">
                  Companies
                </span>
                <span className="text-base font-bold text-white">
                  {response.metrics.totalRequested}
                </span>
                <span className="text-[10px] text-neutral-500 block">
                  {response.metrics.cachedCount} cached / {response.metrics.liveHarvestedCount} fresh
                </span>
              </div>

              <div className="p-3 rounded-xl bg-[#181818] border border-white/5 text-center">
                <span className="text-[10px] text-neutral-400 block uppercase tracking-wider font-semibold">
                  Gemini Calls
                </span>
                <span className="text-base font-bold text-emerald-400 flex items-center justify-center gap-1">
                  <Zap className="w-3.5 h-3.5" />
                  {response.metrics.geminiRequestsIssued}
                </span>
                <span className="text-[10px] text-emerald-500/80 block">
                  $0.00 spend (Free)
                </span>
              </div>

              <div className="p-3 rounded-xl bg-[#181818] border border-white/5 text-center">
                <span className="text-[10px] text-neutral-400 block uppercase tracking-wider font-semibold">
                  Contacts Found
                </span>
                <span className="text-base font-bold text-white flex items-center justify-center gap-1">
                  <Users className="w-3.5 h-3.5 text-neutral-400" />
                  {response.metrics.totalContactsDiscovered}
                </span>
                <span className="text-[10px] text-neutral-500 block">
                  {response.metrics.contactsWithDirectEmail} emails / {response.metrics.contactsWithProfileOnly} profiles
                </span>
              </div>

              <div className="p-3 rounded-xl bg-[#181818] border border-white/5 text-center">
                <span className="text-[10px] text-neutral-400 block uppercase tracking-wider font-semibold">
                  Duration
                </span>
                <span className="text-base font-bold text-neutral-200 flex items-center justify-center gap-1">
                  <Clock className="w-3.5 h-3.5 text-neutral-400" />
                  {response.metrics.durationSeconds}s
                </span>
                <span className="text-[10px] text-neutral-500 block">
                  Bounded &lt;45s
                </span>
              </div>
            </div>
          )}

          {/* Per-Company Result Items */}
          <div className="space-y-2.5">
            <h3 className="text-xs font-semibold text-neutral-300 uppercase tracking-wider">
              Selected Organizations
            </h3>

            {/* If still loading, render selected companies list */}
            {isLoading && (
              <div className="space-y-2">
                {selectedCompanies.map((c) => (
                  <div
                    key={c.key}
                    className="p-3.5 rounded-xl bg-[#181818] border border-white/5 flex items-center justify-between"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg bg-neutral-800 flex items-center justify-center text-neutral-400">
                        <Building2 className="w-4 h-4" />
                      </div>
                      <div>
                        <h4 className="text-xs font-bold text-white">{c.name}</h4>
                        <p className="text-[11px] text-neutral-400 font-mono">{c.domain}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-neutral-400">
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-emerald-400" />
                      <span className="text-[11px]">Processing...</span>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* If finished, render rich results */}
            {!isLoading && response && (
              <div className="space-y-2">
                {response.results.map((item: BulkCompanyResearchItemResult) => (
                  <div
                    key={item.companyKey}
                    className="p-4 rounded-xl bg-[#181818] border border-white/5 hover:border-white/10 transition space-y-2.5"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="w-8 h-8 rounded-lg bg-neutral-800 flex items-center justify-center text-neutral-400 shrink-0">
                          <Building2 className="w-4 h-4" />
                        </div>
                        <div className="truncate">
                          <h4 className="text-xs font-bold text-white truncate">
                            {item.companyName}
                          </h4>
                          <span className="text-[10px] text-neutral-400">
                            Status: <strong className="text-neutral-300">{item.status}</strong>
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        {item.intelligence && getRiskBadge(item.intelligence.riskTier)}
                        <button
                          type="button"
                          onClick={() => {
                            onClose();
                            onNavigateToCompany(item.companyKey);
                          }}
                          className="inline-flex items-center gap-1 px-2.5 py-1 bg-white/5 hover:bg-white/10 border border-white/10 text-white rounded-lg text-[11px] font-medium transition cursor-pointer"
                        >
                          View Profile <ExternalLink className="w-3 h-3 text-neutral-400" />
                        </button>
                      </div>
                    </div>

                    {/* Overview snippet if present */}
                    {item.intelligence?.overview && (
                      <p className="text-[11px] text-neutral-300 line-clamp-2 bg-black/20 p-2 rounded-lg border border-white/5">
                        {item.intelligence.overview}
                      </p>
                    )}

                    {/* Contacts snippet */}
                    <div className="flex items-center justify-between text-[11px] text-neutral-400 pt-1 border-t border-white/5">
                      <div className="flex items-center gap-1.5">
                        <Users className="w-3.5 h-3.5 text-neutral-500" />
                        <span>
                          {item.contacts.length}{' '}
                          {item.contacts.length === 1 ? 'contact discovered' : 'contacts discovered'}
                        </span>
                      </div>
                      {item.error && (
                        <span className="text-amber-400 text-[10px]">
                          Note: {item.error}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Modal Footer */}
        <div className="flex items-center justify-between p-4 border-t border-white/10 bg-[#181818]/90 shrink-0">
          <div className="text-[11px] text-neutral-500">
            {isLoading ? (
              <span>Closing will not cancel the ongoing server research.</span>
            ) : (
              <span>Directory will reflect fresh intelligence upon closing.</span>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className={`px-4 py-2 rounded-xl text-xs font-semibold transition cursor-pointer ${
              isLoading
                ? 'bg-neutral-800 hover:bg-neutral-700 text-neutral-300'
                : 'bg-emerald-500 hover:bg-emerald-400 text-black shadow-md'
            }`}
          >
            {isLoading ? 'Dismiss to Background (Research continues)' : 'Done & Refresh'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};
