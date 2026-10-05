import React from 'react';
import {
  Building2,
  MapPin,
  ExternalLink,
  FileText,
  CheckCircle2,
  Calendar,
  Trophy,
  XCircle,
  Archive,
  Bot,
  RotateCcw,
  Sparkles,
  ArrowRight,
} from 'lucide-react';
import { ApplicationRecord, ApplicationStage } from '../../types/application';
import { getRelativeTimeLabel } from './dateFilterUtils';

interface Props {
  application: ApplicationRecord;
  onSelect: (app: ApplicationRecord) => void;
  onMoveStage: (app: ApplicationRecord, newStage: ApplicationStage, note?: string) => void;
  onPreviewResume?: (resumeId: string) => void;
  onAutofillPrompt?: (app: ApplicationRecord) => void;
  onOpenQaCopilot?: (app: ApplicationRecord) => void;
  isDraggable?: boolean;
  onDragStart?: (e: React.DragEvent, app: ApplicationRecord) => void;
  onDragEnd?: (e: React.DragEvent) => void;
  isDragging?: boolean;
}

export const ApplicationCard: React.FC<Props> = ({
  application,
  onSelect,
  onMoveStage,
  onPreviewResume,
  onAutofillPrompt,
  onOpenQaCopilot,
  isDraggable = true,
  onDragStart,
  onDragEnd,
  isDragging = false,
}) => {
  const atsScore = application.atsScoreSnapshot?.overallScore;
  const hasApprovedResume = Boolean(application.resumeSnapshot?.resumeId);
  const hasAnyResume = Boolean(application.resumeSnapshot?.resumeId || application.tailoredResumeId);

  return (
    <div
      draggable={isDraggable}
      onDragStart={(e) => {
        if (onDragStart) {
          onDragStart(e, application);
        } else {
          e.dataTransfer.setData('text/plain', application.id);
          e.dataTransfer.effectAllowed = 'move';
        }
      }}
      onDragEnd={(e) => {
        if (onDragEnd) onDragEnd(e);
      }}
      onClick={() => onSelect(application)}
      className={`group bg-neutral-900/80 hover:bg-neutral-900 border rounded-xl p-3.5 transition-all shadow-sm hover:shadow-md cursor-grab active:cursor-grabbing flex flex-col justify-between space-y-3 select-none ${
        isDragging
          ? 'opacity-40 scale-[0.98] border-emerald-500/60 ring-2 ring-emerald-500/20'
          : 'border-neutral-800/80 hover:border-neutral-700'
      }`}
    >
      <div>
        {/* Header */}
        <div className="flex items-start justify-between gap-2">
          <div>
            <h3 className="text-xs font-semibold text-white group-hover:text-emerald-400 transition-colors line-clamp-1">
              {application.jobTitle}
            </h3>
            <div className="flex items-center gap-1.5 text-[11px] text-neutral-400 mt-0.5">
              <Building2 className="w-3 h-3 text-neutral-500 shrink-0" />
              <span className="line-clamp-1">{application.company}</span>
            </div>
          </div>

          {application.portalUrl && (
            <a
              href={application.portalUrl}
              target="_blank"
              rel="noopener noreferrer"
              draggable={false}
              onDragStart={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
              className="text-neutral-500 hover:text-neutral-300 p-1 rounded hover:bg-neutral-800 transition-colors"
              title="Open job portal"
            >
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          )}
        </div>

        {/* Location & Metadata */}
        <div className="flex flex-wrap items-center gap-2 mt-2 text-[10px] text-neutral-400">
          <span className="flex items-center gap-1">
            <MapPin className="w-3 h-3 text-neutral-500" />
            {application.location}
          </span>
          {application.isExternal && (
            <span className="px-1.5 py-0.2 bg-neutral-800 text-neutral-300 border border-neutral-700 rounded text-[9px] font-medium">
              External
            </span>
          )}
          {application.appliedAt && (
            <span
              className="text-neutral-500 hover:text-neutral-300 transition-colors"
              title={`Submitted: ${new Date(application.appliedAt).toLocaleString()}`}
            >
              {getRelativeTimeLabel(application.appliedAt, 'Applied')}
            </span>
          )}
        </div>

        {/* Badges / Snapshots */}
        <div className="flex flex-wrap items-center gap-1.5 mt-2.5">
          {atsScore !== undefined && (
            <span
              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                atsScore >= 80
                  ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                  : atsScore >= 60
                  ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                  : 'bg-neutral-800 text-neutral-400'
              }`}
            >
              <span>{atsScore}% ATS Match</span>
            </span>
          )}

          {hasApprovedResume ? (
            <button
              draggable={false}
              onDragStart={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                if (onPreviewResume && application.resumeSnapshot?.resumeId) {
                  onPreviewResume(application.resumeSnapshot.resumeId);
                }
              }}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/20 transition-colors"
            >
              <FileText className="w-3 h-3" />
              <span>Tailored PDF</span>
            </button>
          ) : hasAnyResume ? (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-neutral-800 text-neutral-400 border border-neutral-700">
              <FileText className="w-3 h-3" />
              <span>Draft Resume</span>
            </span>
          ) : null}

          {application.status === 'offer' && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-purple-500/15 text-purple-300 border border-purple-500/30">
              <Trophy className="w-3 h-3 text-purple-400" />
              <span>Offer Received</span>
            </span>
          )}

          {application.status === 'rejected' && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-rose-500/15 text-rose-400 border border-rose-500/30">
              <XCircle className="w-3 h-3 text-rose-400" />
              <span>Rejected</span>
            </span>
          )}

          {application.interviewEvents && application.interviewEvents.length > 0 && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-amber-500/10 text-amber-400 border border-amber-500/20">
              <Calendar className="w-3 h-3" />
              <span>{application.interviewEvents.length} Round{application.interviewEvents.length > 1 ? 's' : ''}</span>
            </span>
          )}
        </div>
      </div>

      {/* Stage Actions Toolbar */}
      <div
        draggable={false}
        onDragStart={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
        className="pt-2 border-t border-neutral-800/60 flex items-center justify-between gap-1 text-[11px]"
      >
        {/* Stage-Specific Fast Forward Buttons */}
        {application.status === 'saved' && (
          <div className="flex items-center gap-1.5 w-full justify-end">
            <button
              draggable={false}
              onClick={() => onMoveStage(application, 'archived', 'Candidate archived from Saved')}
              className="p-1 text-neutral-500 hover:text-neutral-300 rounded hover:bg-neutral-800 transition-colors"
              title="Archive"
            >
              <Archive className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {application.status === 'ready' && (
          <div className="flex flex-col gap-1.5 w-full">
            {/* Top Row: Automation & AI Assistance Tools */}
            <div className="grid grid-cols-2 gap-1.5 w-full">
              <button
                type="button"
                draggable={false}
                onClick={() => onAutofillPrompt && onAutofillPrompt(application)}
                className="inline-flex items-center justify-center gap-1 px-2 py-1.5 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/30 hover:border-emerald-500/50 text-emerald-300 rounded-lg text-[10px] font-semibold transition-all shadow-sm"
                title="Playwright Local Automation: Autofill portal form inputs"
              >
                <Bot className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                <span>Autofill</span>
              </button>

              <button
                type="button"
                draggable={false}
                onClick={(e) => {
                  e.stopPropagation();
                  onOpenQaCopilot && onOpenQaCopilot(application);
                }}
                className="inline-flex items-center justify-center gap-1 px-2 py-1.5 bg-purple-500/10 hover:bg-purple-500/20 border border-purple-500/30 hover:border-purple-500/50 text-purple-300 rounded-lg text-[10px] font-semibold transition-all shadow-sm"
                title="ATS Custom Question Co-Pilot: Generate truth-locked answers for essay & portal questions"
              >
                <Sparkles className="w-3.5 h-3.5 text-purple-400 shrink-0" />
                <span>Q&A Co-Pilot</span>
              </button>
            </div>

            {/* Bottom Row: Advance to Next Step (Applied) */}
            <button
              type="button"
              draggable={false}
              onClick={() => onMoveStage(application, 'applied', 'Submitted on portal')}
              className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 bg-emerald-500 hover:bg-emerald-400 text-black font-semibold rounded-lg text-[11px] transition-all w-full shadow-sm hover:shadow-emerald-500/20 group"
              title="Record that you submitted this application (Moves to Applied)"
            >
              <CheckCircle2 className="w-3.5 h-3.5 text-black shrink-0" />
              <span>Advance to Next Step</span>
              <ArrowRight className="w-3.5 h-3.5 text-black/70 ml-auto group-hover:translate-x-0.5 transition-transform" />
            </button>
          </div>
        )}

        {application.status === 'applied' && (
          <div className="flex items-center justify-between gap-1 w-full">
            <button
              draggable={false}
              onClick={() => onMoveStage(application, 'rejected', 'Employer declined application')}
              className="p-1 text-neutral-500 hover:text-red-400 rounded hover:bg-neutral-800 transition-colors"
              title="Record Rejection"
            >
              <XCircle className="w-3.5 h-3.5" />
            </button>
            <button
              draggable={false}
              onClick={() => onMoveStage(application, 'interviewing', 'Recruiter scheduled interview')}
              className="inline-flex items-center gap-1 px-2 py-1 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 text-amber-300 rounded-lg text-[10px] font-semibold transition-colors"
            >
              <Calendar className="w-3 h-3" />
              <span>Advance to Interview</span>
            </button>
          </div>
        )}

        {application.status === 'interviewing' && (
          <div className="flex items-center justify-between gap-1 w-full">
            <button
              draggable={false}
              onClick={() => onMoveStage(application, 'rejected', 'Employer declined after interview')}
              className="p-1 text-neutral-500 hover:text-red-400 rounded hover:bg-neutral-800 transition-colors"
              title="Record Rejection"
            >
              <XCircle className="w-3.5 h-3.5" />
            </button>
            <button
              draggable={false}
              onClick={() => onMoveStage(application, 'offer', 'Received formal offer!')}
              className="inline-flex items-center gap-1 px-2.5 py-1 bg-purple-500 hover:bg-purple-400 text-white font-semibold rounded-lg text-[10px] transition-colors shadow-sm"
            >
              <Trophy className="w-3 h-3" />
              <span>Offer Received</span>
            </button>
          </div>
        )}

        {application.status === 'offer' && (
          <div className="flex items-center justify-end gap-1.5 w-full">
            <button
              draggable={false}
              onClick={() => onMoveStage(application, 'archived', 'Offer concluded')}
              className="inline-flex items-center gap-1 px-2 py-1 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded-lg text-[10px] transition-colors"
            >
              <Archive className="w-3.5 h-3.5" />
              <span>Conclude Offer</span>
            </button>
          </div>
        )}

        {(application.status === 'rejected' || application.status === 'archived') && (
          <div className="flex items-center justify-end gap-1.5 w-full">
            <button
              draggable={false}
              onClick={() => onMoveStage(application, 'saved', 'Restored to active saved pipeline')}
              className="inline-flex items-center gap-1 px-2 py-1 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded-lg text-[10px] transition-colors"
              title="Restore to Active Pipeline"
            >
              <RotateCcw className="w-3 h-3 text-neutral-400" />
              <span>Restore</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
