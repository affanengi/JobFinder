import React from 'react';
import { createPortal } from 'react-dom';
import { X, Trophy, XCircle, Building2, Briefcase } from 'lucide-react';
import { ApplicationRecord } from '../../types/application';

interface OutcomeDecisionModalProps {
  isOpen: boolean;
  application: ApplicationRecord | null;
  onClose: () => void;
  onSelectOutcome: (app: ApplicationRecord, outcome: 'offer' | 'rejected') => void;
}

export const OutcomeDecisionModal: React.FC<OutcomeDecisionModalProps> = ({
  isOpen,
  application,
  onClose,
  onSelectOutcome,
}) => {
  if (!isOpen || !application) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md bg-[#0D0D0D] border border-white/15 rounded-2xl shadow-2xl shadow-black/90 overflow-hidden p-6 space-y-5"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-purple-500/10 border border-purple-500/20 text-purple-400">
              <Trophy className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white tracking-wide">Record Application Outcome</h3>
              <p className="text-xs text-neutral-400">Did you receive an offer or was this application rejected?</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-neutral-400 hover:text-white p-1 rounded-lg hover:bg-neutral-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Application details card */}
        <div className="p-3.5 bg-[#161616] rounded-xl border border-white/10 space-y-1.5 text-xs">
          <div className="flex items-center gap-2 text-neutral-200 font-semibold">
            <Briefcase className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
            <span className="truncate">{application.jobTitle}</span>
          </div>
          <div className="flex items-center gap-2 text-neutral-400 text-[11px]">
            <Building2 className="w-3.5 h-3.5 text-neutral-500 shrink-0" />
            <span className="truncate">{application.company}</span>
            {application.location && <span>• {application.location}</span>}
          </div>
        </div>

        {/* Decision Choices */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
          {/* Offer Choice */}
          <button
            type="button"
            data-testid="outcome-offer-btn"
            onClick={() => onSelectOutcome(application, 'offer')}
            className="p-3.5 rounded-xl bg-purple-500/10 hover:bg-purple-500/20 border border-purple-500/30 text-left transition-all group cursor-pointer flex flex-col justify-between space-y-2"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-purple-300 group-hover:text-purple-200 flex items-center gap-1.5">
                <Trophy className="w-4 h-4 text-purple-400" />
                <span>Offer Received</span>
              </span>
            </div>
            <p className="text-[11px] text-neutral-400 leading-snug">
              Move to Offers column with an active offer status.
            </p>
          </button>

          {/* Rejected Choice */}
          <button
            type="button"
            data-testid="outcome-reject-btn"
            onClick={() => onSelectOutcome(application, 'rejected')}
            className="p-3.5 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/30 text-left transition-all group cursor-pointer flex flex-col justify-between space-y-2"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-rose-300 group-hover:text-rose-200 flex items-center gap-1.5">
                <XCircle className="w-4 h-4 text-rose-400" />
                <span>Rejected</span>
              </span>
            </div>
            <p className="text-[11px] text-neutral-400 leading-snug">
              Move to Concluded Applications with a red Rejected badge.
            </p>
          </button>
        </div>

        {/* Cancel Button */}
        <div className="flex items-center justify-end pt-1">
          <button
            type="button"
            onClick={onClose}
            className="px-3.5 py-2 text-xs font-medium text-neutral-400 hover:text-white rounded-xl hover:bg-neutral-800 transition-colors"
          >
            Cancel (Keep in Interviewing)
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};
