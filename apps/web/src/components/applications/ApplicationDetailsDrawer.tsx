import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  X,
  Building2,
  MapPin,
  ExternalLink,
  FileText,
  Calendar,
  Save,
  Clock,
  CheckCircle2,
  Plus,
  Bot,
  Sparkles,
} from 'lucide-react';
import { ApplicationRecord, ApplicationStage, EventSource } from '../../types/application';
import { useScrollLock } from '../../hooks/useScrollLock';

interface Props {
  application: ApplicationRecord | null;
  onClose: () => void;
  onUpdateStatus: (newStatus: ApplicationStage, note?: string, eventSource?: EventSource) => Promise<void>;
  onUpdateNotes: (notes: string) => Promise<void>;
  onAddInterviewRound: (roundData: { round: string; scheduledAt?: string; interviewer?: string; notes?: string }) => Promise<void>;
  onPreviewResume?: (resumeId: string) => void;
  onAutofillPrompt?: (app: ApplicationRecord) => void;
}

export const ApplicationDetailsDrawer: React.FC<Props> = ({
  application,
  onClose,
  onUpdateStatus,
  onUpdateNotes,
  onAddInterviewRound,
  onPreviewResume,
  onAutofillPrompt,
}) => {
  // Global scroll lock so background page does not scroll while drawer is open
  useScrollLock(Boolean(application));

  // State initialization
  const [notes, setNotes] = useState('');
  const [isSavingNotes, setIsSavingNotes] = useState(false);
  const [notesSavedToast, setNotesSavedToast] = useState(false);

  // New Interview Round Form state
  const [showAddRound, setShowAddRound] = useState(false);
  const [roundName, setRoundName] = useState('Recruiter Screen');
  const [roundDate, setRoundDate] = useState('');
  const [interviewer, setInterviewer] = useState('');
  const [roundNotes, setRoundNotes] = useState('');
  const [isAddingRound, setIsAddingRound] = useState(false);

  // Sync notes when application changes
  useEffect(() => {
    if (application) {
      setNotes(application.notes || '');
    }
  }, [application]);

  // Close on Escape key press
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  if (!application) return null;

  const handleSaveNotes = async () => {
    setIsSavingNotes(true);
    try {
      await onUpdateNotes(notes);
      setNotesSavedToast(true);
      setTimeout(() => setNotesSavedToast(false), 2000);
    } finally {
      setIsSavingNotes(false);
    }
  };

  const handleCreateRound = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!roundName.trim()) return;
    setIsAddingRound(true);
    try {
      await onAddInterviewRound({
        round: roundName,
        scheduledAt: roundDate || undefined,
        interviewer: interviewer || undefined,
        notes: roundNotes || undefined,
      });
      setShowAddRound(false);
      setRoundDate('');
      setInterviewer('');
      setRoundNotes('');
    } finally {
      setIsAddingRound(false);
    }
  };

  const resumeId = application.resumeSnapshot?.resumeId || application.tailoredResumeId;

  // Legal transitions based on current stage
  const getAvailableNextStages = (current: ApplicationStage): { stage: ApplicationStage; label: string; eventSource: EventSource }[] => {
    switch (current) {
      case 'saved':
        return [
          { stage: 'archived', label: 'Archive Opportunity', eventSource: 'candidate' },
        ];
      case 'ready':
        return [
          { stage: 'applied', label: 'Mark as Submitted (Applied)', eventSource: 'candidate' },
          { stage: 'saved', label: 'Demote to Draft (Revise)', eventSource: 'candidate' },
          { stage: 'archived', label: 'Archive Application', eventSource: 'candidate' },
        ];
      case 'applied':
        return [
          { stage: 'interviewing', label: 'Advance to Interviewing', eventSource: 'employer' },
          { stage: 'rejected', label: 'Record Employer Rejection', eventSource: 'employer' },
          { stage: 'archived', label: 'Archive Application', eventSource: 'candidate' },
        ];
      case 'interviewing':
        return [
          { stage: 'offer', label: 'Record Offer Received', eventSource: 'employer' },
          { stage: 'rejected', label: 'Record Employer Rejection', eventSource: 'employer' },
          { stage: 'archived', label: 'Withdraw Application', eventSource: 'candidate' },
        ];
      case 'offer':
        return [
          { stage: 'archived', label: 'Conclude Offer (Archive)', eventSource: 'candidate' },
        ];
      case 'rejected':
      case 'archived':
        return [
          { stage: 'saved', label: 'Restore to Active Saved Pipeline', eventSource: 'candidate' },
        ];
      default:
        return [];
    }
  };

  const nextStages = getAvailableNextStages(application.status);

  return createPortal(
    <div
      onClick={(e) => {
        // Clicking the darkened backdrop closes the drawer
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
      className="fixed inset-0 z-[100] overflow-hidden flex justify-end bg-black/75 backdrop-blur-sm animate-in fade-in duration-150"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-xl bg-neutral-950 border-l border-neutral-800 h-full flex flex-col shadow-2xl overflow-hidden animate-in slide-in-from-right duration-200"
      >
        {/* Drawer Header */}
        <div className="p-4 border-b border-neutral-800 flex items-start justify-between bg-neutral-900/60 shrink-0">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                {application.status === 'ready' ? 'Ready to Apply' : application.status}
              </span>
              {application.isExternal && (
                <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-neutral-800 text-neutral-400 border border-neutral-700">
                  External
                </span>
              )}
            </div>
            <h2 className="text-base font-bold text-white mt-1.5 line-clamp-1">
              {application.jobTitle}
            </h2>
            <div className="flex items-center gap-3 text-xs text-neutral-400 mt-1 flex-wrap">
              <span className="flex items-center gap-1 font-medium text-neutral-300">
                <Building2 className="w-3.5 h-3.5 text-neutral-400" />
                {application.company}
              </span>
              <span className="flex items-center gap-1">
                <MapPin className="w-3.5 h-3.5 text-neutral-500" />
                {application.location}
              </span>
              {application.salarySnippet && (
                <span className="text-emerald-400 font-medium">
                  {application.salarySnippet}
                </span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2">
            {application.portalUrl && (
              <a
                href={application.portalUrl}
                target="_blank"
                rel="noreferrer"
                className="p-1.5 rounded-lg text-neutral-400 hover:text-white hover:bg-neutral-800 transition-colors"
                title="Open Application Portal"
              >
                <ExternalLink className="w-4 h-4" />
              </a>
            )}
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-neutral-400 hover:text-white hover:bg-neutral-800 transition-colors cursor-pointer"
              title="Close Drawer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-6">
          {/* Lifecycle State Controls */}
          <div className="space-y-2 p-3.5 rounded-xl bg-neutral-900/60 border border-neutral-800">
            <span className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wider">
              Advance Lifecycle Stage
            </span>
            <div className="flex flex-wrap gap-2 pt-1">
              {application.status === 'ready' && (
                <button
                  onClick={() => onUpdateStatus('applied', 'Candidate submitted portal application', 'candidate')}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-500 hover:bg-emerald-400 text-black rounded-lg text-xs font-bold transition-colors shadow-sm cursor-pointer"
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>Mark as Submitted (Applied)</span>
                </button>
              )}

              {nextStages.length === 0 ? (
                <span className="text-xs text-neutral-500 italic">No further transitions available.</span>
              ) : (
                nextStages.map((ns) => (
                  <button
                    key={ns.stage}
                    onClick={() => onUpdateStatus(ns.stage, `Transitioned to ${ns.stage}`, ns.eventSource)}
                    className="px-3 py-1.5 rounded-lg border border-neutral-700 bg-neutral-900 hover:bg-neutral-800 text-neutral-200 text-xs font-medium transition-colors cursor-pointer"
                  >
                    {ns.label}
                  </button>
                ))
              )}
            </div>
          </div>

          {/* Attached Tailored Resume Snapshot */}
          <div className="space-y-2 p-3.5 rounded-xl bg-neutral-900/60 border border-neutral-800">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wider flex items-center gap-1.5">
                <FileText className="w-3.5 h-3.5 text-emerald-400" />
                Attached Resume Snapshot
              </span>
              {application.atsScoreSnapshot && (
                <span className="px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-[10px] font-semibold">
                  {application.atsScoreSnapshot.overallScore}% ATS Match
                </span>
              )}
            </div>

            {application.resumeSnapshot ? (
              <div className="space-y-2 pt-1 text-[11px]">
                <div className="text-white font-medium">
                  {application.resumeSnapshot.targetRole} (v{application.resumeSnapshot.version})
                </div>
                <div className="text-neutral-400 text-[10px]">
                  Approved on {new Date(application.resumeSnapshot.approvedAt).toLocaleString()} •{' '}
                  {application.resumeSnapshot.bulletCount} verified bullets
                </div>
                {resumeId && (
                  <button
                    onClick={() => onPreviewResume && onPreviewResume(resumeId)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/20 font-semibold text-xs transition-colors cursor-pointer"
                  >
                    <FileText className="w-3.5 h-3.5" />
                    <span>View Exact 1-Page PDF</span>
                  </button>
                )}
              </div>
            ) : resumeId ? (
              <div className="space-y-2 pt-1">
                <div className="text-neutral-400 text-[11px]">Draft tailored resume available.</div>
                <button
                  onClick={() => onPreviewResume && onPreviewResume(resumeId)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/20 text-xs font-semibold transition-colors cursor-pointer"
                >
                  <FileText className="w-3.5 h-3.5" />
                  <span>View Draft PDF</span>
                </button>
              </div>
            ) : (
              <div className="space-y-2.5 pt-1 text-[11px]">
                <div className="text-neutral-300 font-medium flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-amber-400/80 shrink-0" />
                  No tailored resume attached yet
                </div>
                <p className="text-neutral-400 text-[11px] leading-relaxed">
                  Opportunities in <span className="text-neutral-200 font-medium">Saved / Draft</span> start without a locked resume. To attach one, open the Resume Studio from <span className="text-emerald-400 font-medium">Opportunities</span> or <span className="text-emerald-400 font-medium">Resumes</span>, tailor your resume for this role, and click <span className="text-emerald-400 font-medium">"Approve Resume for Application"</span>.
                </p>
                <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 text-[11px] space-y-1.5">
                  <div className="font-semibold text-emerald-200 flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                    <span>How Resume Snapshots Work</span>
                  </div>
                  <p className="text-[10px] text-neutral-300/90 leading-relaxed">
                    When you approve a resume package, an immutable snapshot locks the exact resume version, bullet points, and ATS match score evaluated for this job. Even if you edit your master profile later, this snapshot remains a historical record of what you applied with.
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Playwright Portal Autofill Hook */}
          {application.portalUrl && (
            <div className="p-3.5 rounded-xl bg-neutral-900/60 border border-neutral-800 flex items-center justify-between">
              <div>
                <span className="text-xs font-semibold text-white flex items-center gap-1.5">
                  <Bot className="w-4 h-4 text-emerald-400" />
                  Autofill Application (Playwright)
                </span>
                <p className="text-[10px] text-neutral-400 mt-0.5">
                  Prefill portal forms with human oversight (Phase 2).
                </p>
              </div>
              <button
                onClick={() => onAutofillPrompt && onAutofillPrompt(application)}
                className="px-3 py-1.5 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/30 text-emerald-300 text-xs font-semibold transition-colors cursor-pointer"
              >
                Autofill Portal
              </button>
            </div>
          )}

          {/* Interview Rounds Timeline & Scheduler */}
          <div className="space-y-3 p-3.5 rounded-xl bg-neutral-900/60 border border-neutral-800">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wider flex items-center gap-1.5">
                <Calendar className="w-3.5 h-3.5 text-amber-400" />
                Interview Rounds ({application.interviewEvents?.length || 0})
              </span>
              <button
                onClick={() => setShowAddRound(!showAddRound)}
                className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-400 hover:text-emerald-300 cursor-pointer"
              >
                <Plus className="w-3 h-3" />
                <span>Add Round</span>
              </button>
            </div>

            {/* Add Round Inline Form */}
            {showAddRound && (
              <form onSubmit={handleCreateRound} className="p-3 rounded-lg bg-neutral-900 border border-neutral-700/80 space-y-2.5 text-xs">
                <div>
                  <label className="block text-[10px] text-neutral-400 mb-1">Round Name / Stage</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Technical Screening, Hiring Manager"
                    value={roundName}
                    onChange={(e) => setRoundName(e.target.value)}
                    className="w-full px-2.5 py-1.5 bg-neutral-800 border border-neutral-700 rounded-md text-white text-xs focus:outline-none focus:border-emerald-500"
                  />
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[10px] text-neutral-400 mb-1">Date & Time</label>
                    <input
                      type="datetime-local"
                      value={roundDate}
                      onChange={(e) => setRoundDate(e.target.value)}
                      className="w-full px-2 py-1.5 bg-neutral-800 border border-neutral-700 rounded-md text-white text-xs focus:outline-none focus:border-emerald-500"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] text-neutral-400 mb-1">Interviewer (Optional)</label>
                    <input
                      type="text"
                      placeholder="e.g. Jane Doe (Eng Lead)"
                      value={interviewer}
                      onChange={(e) => setInterviewer(e.target.value)}
                      className="w-full px-2.5 py-1.5 bg-neutral-800 border border-neutral-700 rounded-md text-white text-xs focus:outline-none focus:border-emerald-500"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-[10px] text-neutral-400 mb-1">Prep Notes / Key Topics</label>
                  <textarea
                    rows={2}
                    placeholder="Key questions to ask, system design focus..."
                    value={roundNotes}
                    onChange={(e) => setRoundNotes(e.target.value)}
                    className="w-full px-2.5 py-1.5 bg-neutral-800 border border-neutral-700 rounded-md text-white text-xs focus:outline-none focus:border-emerald-500 resize-none"
                  />
                </div>

                <div className="flex items-center justify-end gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => setShowAddRound(false)}
                    className="px-2.5 py-1 text-neutral-400 hover:text-white"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isAddingRound}
                    className="px-3 py-1 bg-emerald-500 hover:bg-emerald-400 text-black font-bold rounded-md disabled:opacity-50"
                  >
                    {isAddingRound ? 'Saving...' : 'Save Round'}
                  </button>
                </div>
              </form>
            )}

            {/* List of existing rounds */}
            {application.interviewEvents && application.interviewEvents.length > 0 ? (
              <div className="space-y-2">
                {application.interviewEvents.map((r) => (
                  <div key={r.id} className="p-2.5 rounded-lg bg-neutral-900 border border-neutral-800 space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-semibold text-white">{r.round}</span>
                      {r.scheduledAt && (
                        <span className="text-[10px] font-mono text-amber-400">
                          {new Date(r.scheduledAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                        </span>
                      )}
                    </div>
                    {r.interviewer && (
                      <div className="text-[11px] text-neutral-400">Interviewer: {r.interviewer}</div>
                    )}
                    {r.notes && (
                      <div className="text-[10px] text-neutral-500 pt-0.5">{r.notes}</div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-neutral-500 italic text-[11px]">No interview rounds logged yet.</div>
            )}
          </div>

          {/* Candidate Scratchpad Notes */}
          <div className="space-y-2 p-3.5 rounded-xl bg-neutral-900/60 border border-neutral-800">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wider">
                Candidate Scratchpad Notes
              </span>
              {notesSavedToast && (
                <span className="text-[10px] text-emerald-400 flex items-center gap-1 font-medium">
                  <CheckCircle2 className="w-3 h-3" />
                  Saved
                </span>
              )}
            </div>
            <textarea
              rows={4}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Record recruiter contacts, referral names, salary requirements, interview follow-ups..."
              className="w-full px-3 py-2 bg-neutral-900 border border-neutral-800 rounded-lg text-white text-xs placeholder-neutral-500 focus:outline-none focus:border-emerald-500 resize-none"
            />
            <div className="flex justify-end">
              <button
                onClick={handleSaveNotes}
                disabled={isSavingNotes}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-neutral-800 hover:bg-neutral-700 text-white rounded-lg text-xs font-medium transition-colors cursor-pointer"
              >
                <Save className="w-3.5 h-3.5" />
                <span>{isSavingNotes ? 'Saving...' : 'Save Notes'}</span>
              </button>
            </div>
          </div>

          {/* Audit History Timeline */}
          <div className="space-y-2.5 pt-2 border-t border-neutral-800">
            <span className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wider flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5 text-neutral-500" />
              Audit Timeline ({application.history?.length || 0})
            </span>

            <div className="relative pl-4 space-y-3 border-l border-neutral-800/80 ml-2">
              {application.history?.map((ev, idx) => (
                <div key={ev.id || idx} className="relative">
                  <div className="absolute -left-[21px] top-1 w-2.5 h-2.5 rounded-full bg-neutral-700 border-2 border-neutral-950" />
                  <div>
                    <div className="flex items-center gap-1.5 text-white font-medium text-[11px]">
                      <span>{ev.eventName}</span>
                      <span className="text-[9px] text-neutral-500 capitalize">
                        via {ev.eventSource}
                      </span>
                    </div>
                    <div className="text-[10px] text-neutral-500">
                      {new Date(ev.timestamp).toLocaleString()}
                    </div>
                    {ev.note && <div className="text-[11px] text-neutral-400 mt-0.5">{ev.note}</div>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
};
