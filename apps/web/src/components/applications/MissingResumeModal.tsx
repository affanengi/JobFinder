import React from 'react';
import { createPortal } from 'react-dom';
import { X, FileWarning, Sparkles, Building2, Briefcase } from 'lucide-react';
import { ApplicationRecord } from '../../types/application';

interface MissingResumeModalProps {
  isOpen: boolean;
  application: ApplicationRecord | null;
  onClose: () => void;
  onOpenResumeStudio: (app: ApplicationRecord) => void;
}

export const MissingResumeModal: React.FC<MissingResumeModalProps> = ({
  isOpen,
  application,
  onClose,
  onOpenResumeStudio,
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
            <div className="p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-400">
              <FileWarning className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white tracking-wide">Tailored Resume Required</h3>
              <p className="text-xs text-neutral-400">Approved resume package needed for Ready to Apply</p>
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
        <div className="p-3.5 bg-[#161616] rounded-xl border border-white/10 space-y-2 text-xs">
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

        {/* Informational Policy */}
        <div className="p-3 bg-neutral-900/80 rounded-xl border border-neutral-800 text-[11px] leading-relaxed text-neutral-300 space-y-1">
          <p>
            The <strong className="text-white">Ready to Apply</strong> stage is strictly reserved for submissions with an approved, job-specific tailored resume.
          </p>
          <p className="text-neutral-400">
            Open the Resume Studio to tailor and approve an ATS-optimized resume snapshot for this role.
          </p>
        </div>

        {/* Actions */}
        <div className="flex items-center justify-end gap-2.5 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="px-3.5 py-2 text-xs font-medium text-neutral-400 hover:text-white rounded-xl hover:bg-neutral-800 transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => {
              onClose();
              onOpenResumeStudio(application);
            }}
            className="px-4 py-2 text-xs font-bold text-black bg-emerald-500 hover:bg-emerald-400 rounded-xl shadow-lg shadow-emerald-500/20 flex items-center gap-1.5 transition-all cursor-pointer"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>Tailor Resume</span>
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};
