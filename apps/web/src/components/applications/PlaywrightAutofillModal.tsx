import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import {
  Bot,
  CheckCircle2,
  AlertTriangle,
  ShieldCheck,
  X,
  ExternalLink,
  Loader2,
  Play,
  RefreshCw,
  FileText,
  ChevronDown,
  ChevronUp,
  Clock,
  Sparkles,
  Send,
} from 'lucide-react';
import { ApplicationRecord } from '../../types/application';
import { AutofillStatus, AutofillEventDTO, AutofillSessionDTO } from '../../types/autofill';
import { fetchWithAuth } from '../../lib/api';

interface PlaywrightAutofillModalProps {
  isOpen: boolean;
  application: ApplicationRecord | null;
  onClose: () => void;
  onSuccess: (updatedApp: ApplicationRecord) => void;
}

const STEP_DEFINITIONS = [
  { id: 'pdf', title: 'Prepare Resume Package', description: 'Snapshot compiled deterministically' },
  { id: 'browser', title: 'Launch Local Browser', description: 'Headed Chromium instance initiated' },
  { id: 'navigate', title: 'Form Structure Detection', description: 'Analyzing ATS inputs & selectors' },
  { id: 'populate', title: 'Deterministic Autofill', description: 'Filling safe verified identity fields' },
  { id: 'resume', title: 'Attach Tailored Resume', description: 'Uploading approved PDF artifact' },
  { id: 'review', title: 'Human Review Checkpoint', description: 'Candidate inspects & submits' },
];

export const PlaywrightAutofillModal: React.FC<PlaywrightAutofillModalProps> = ({
  isOpen,
  application,
  onClose,
  onSuccess,
}) => {
  const [session, setSession] = useState<AutofillSessionDTO | null>(null);
  const [status, setStatus] = useState<AutofillStatus>('IDLE');
  const [events, setEvents] = useState<AutofillEventDTO[]>([]);
  const [isStarting, setIsStarting] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showLogs, setShowLogs] = useState(false);
  const [selectedQids, setSelectedQids] = useState<Set<string>>(new Set());
  const [qaAnswers, setQaAnswers] = useState<Record<string, string>>({});
  const [isGeneratingQa, setIsGeneratingQa] = useState(false);
  const [isFillingQa, setIsFillingQa] = useState(false);
  const [qaFillSuccess, setQaFillSuccess] = useState<number | null>(null);

  const eventSourceRef = useRef<EventSource | null>(null);
  const logsEndRef = useRef<HTMLDivElement | null>(null);

  // Auto-scroll logs
  useEffect(() => {
    if (showLogs && logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [events, showLogs]);

  // Clean up EventSource on unmount or close
  const cleanupEventSource = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      cleanupEventSource();
    };
  }, [cleanupEventSource]);

  // Reset state when application or modal opens/closes
  useEffect(() => {
    if (!isOpen) {
      cleanupEventSource();
      setSession(null);
      setStatus('IDLE');
      setEvents([]);
      setError(null);
      setIsStarting(false);
      setIsConfirming(false);
      setIsCancelling(false);
    }
  }, [isOpen, cleanupEventSource]);

  if (!isOpen || !application) return null;

  // Compute current active step index for stepper
  const getActiveStepIndex = () => {
    switch (status) {
      case 'IDLE':
      case 'CREATING':
      case 'INITIALIZING':
        return 0;
      case 'BROWSER_LAUNCHED':
      case 'LAUNCHING_BROWSER':
        return 1;
      case 'PORTAL_LOADING':
      case 'NAVIGATING':
      case 'DETECTING_APPLICATION_STATE':
      case 'APPLY_CTA_AVAILABLE':
      case 'APPLY_ACTION_IN_PROGRESS':
      case 'FORM_LOADING':
      case 'FORM_READY':
        return 2;
      case 'FILLING':
      case 'POPULATING':
        return 3;
      case 'ATTACHING_RESUME':
        return 4;
      case 'HUMAN_REVIEW_REQUIRED':
      case 'READY_FOR_SUBMISSION':
      case 'MULTI_STEP_FORM':
      case 'COMPLETED':
      case 'BROWSER_CLOSED':
        return 5;
      default:
        return 0;
    }
  };

  const connectToEventStream = (appId: string, sessionId: string) => {
    cleanupEventSource();
    const eventUrl = `/api/v1/applications/${appId}/autofill/events?session_id=${sessionId}&user_id=${encodeURIComponent(application.userId)}`;
    const es = new EventSource(eventUrl);
    eventSourceRef.current = es;

    es.onmessage = async (messageEvent) => {
      try {
        const eventData: AutofillEventDTO = JSON.parse(messageEvent.data);
        setEvents((prev) => [...prev, eventData]);
        setStatus(eventData.status);
        if (eventData.detectedCustomQuestions && eventData.detectedCustomQuestions.length > 0) {
          setSession((prev) => prev ? { ...prev, detectedCustomQuestions: eventData.detectedCustomQuestions } : prev);
          const qList = eventData.detectedCustomQuestions;
          setSelectedQids((prev) => prev.size > 0 ? prev : new Set(qList.map((q: any) => q.questionId)));
        }

        // Update fields populated/skipped from session updates
        if (
          eventData.status === 'READY_FOR_SUBMISSION' ||
          eventData.status === 'MULTI_STEP_FORM' ||
          eventData.status === 'HUMAN_REVIEW_REQUIRED' ||
          eventData.status === 'COMPLETED'
        ) {
          // Fetch authoritative session snapshot
          const res = await fetchWithAuth(`/api/v1/applications/${appId}/autofill/session?session_id=${sessionId}`);
          if (res.ok) {
            const sess: AutofillSessionDTO = await res.json();
            setSession((prev) => {
              if (!prev) return sess;
              const mergedQuestions = (sess.detectedCustomQuestions && sess.detectedCustomQuestions.length > 0)
                ? sess.detectedCustomQuestions
                : (prev.detectedCustomQuestions || []);
              return { ...sess, detectedCustomQuestions: mergedQuestions };
            });
            const finalQuestions = (sess.detectedCustomQuestions && sess.detectedCustomQuestions.length > 0)
              ? sess.detectedCustomQuestions
              : (eventData.detectedCustomQuestions || []);
            if (finalQuestions.length > 0) {
              setSelectedQids((prev) => prev.size > 0 ? prev : new Set(finalQuestions.map((q: any) => q.questionId)));
            }
          }
        }
      } catch (err) {
        console.error('Error parsing SSE event:', err);
      }
    };

    es.onerror = (err) => {
      console.warn('SSE stream disconnected or complete:', err);
      es.close();
    };
  };

  const handleStartAutofill = async () => {
    setIsStarting(true);
    setError(null);
    try {
      const res = await fetchWithAuth(`/api/v1/applications/${application.id}/autofill/start`, {
        method: 'POST',
      });
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.detail || 'Failed to start autofill session.');
      }
      const data: {
        sessionId: string;
        applicationId: string;
        status: AutofillStatus;
        portalUrl: string;
      } = await res.json();

      setStatus(data.status);
      setSession({
        sessionId: data.sessionId,
        userId: application.userId,
        applicationId: application.id,
        portalUrl: data.portalUrl,
        atsType: 'detecting',
        status: data.status,
        createdAt: new Date().toISOString(),
        lastActivityAt: new Date().toISOString(),
        fieldsFilled: [],
        fieldsSkipped: [],
        fieldsRequiringReview: [],
        resumeAttached: false,
        captchaDetected: false,
      });

      connectToEventStream(application.id, data.sessionId);
    } catch (err: any) {
      console.error('Failed to start autofill:', err);
      setError(err?.message || 'Failed to initialize Playwright session.');
      setStatus('FAILED');
    } finally {
      setIsStarting(false);
    }
  };

  const handleConfirmSubmission = async () => {
    if (!session) return;
    setIsConfirming(true);
    setError(null);
    try {
      const res = await fetchWithAuth(
        `/api/v1/applications/${application.id}/autofill/confirm-submission`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sessionId: session.sessionId,
            notes: 'Candidate verified fields on external portal and manually submitted application.',
          }),
        }
      );
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.detail || 'Failed to confirm submission.');
      }
      const updated: ApplicationRecord = await res.json();
      cleanupEventSource();
      onSuccess(updated);
      onClose();
    } catch (err: any) {
      console.error('Failed to confirm submission:', err);
      setError(err?.message || 'Failed to record application submission.');
    } finally {
      setIsConfirming(false);
    }
  };

  const handleCancelSession = async () => {
    setIsCancelling(true);
    cleanupEventSource();
    try {
      if (session) {
        await fetchWithAuth(`/api/v1/applications/${application.id}/autofill/cancel?session_id=${session.sessionId}`, {
          method: 'POST',
        });
      }
    } catch (err) {
      console.warn('Cancel request error (session may have exited):', err);
    } finally {
      setIsCancelling(false);
      onClose();
    }
  };

  const activeStepIdx = getActiveStepIndex();
  const isRunning =
    status === 'CREATING' ||
    status === 'INITIALIZING' ||
    status === 'BROWSER_LAUNCHED' ||
    status === 'LAUNCHING_BROWSER' ||
    status === 'PORTAL_LOADING' ||
    status === 'NAVIGATING' ||
    status === 'DETECTING_APPLICATION_STATE' ||
    status === 'APPLY_CTA_AVAILABLE' ||
    status === 'APPLY_ACTION_IN_PROGRESS' ||
    status === 'FORM_LOADING' ||
    status === 'FORM_READY' ||
    status === 'FILLING' ||
    status === 'POPULATING' ||
    status === 'ATTACHING_RESUME';
  const isReadyForReview =
    status === 'HUMAN_REVIEW_REQUIRED' ||
    status === 'READY_FOR_SUBMISSION' ||
    status === 'MULTI_STEP_FORM';
  const isBrowserClosed = status === 'BROWSER_CLOSED';
  const isMultiStep = status === 'MULTI_STEP_FORM';
  const isAmbiguous = status === 'APPLY_CTA_AMBIGUOUS';
  const isNotFound = status === 'FORM_NOT_FOUND' || status === 'CROSS_ORIGIN_FRAME_BLOCKED';
  const isPaused =
    status === 'PAUSED_FOR_CAPTCHA' ||
    status === 'PAUSED_FOR_LOGIN' ||
    status === 'AUTHENTICATION_REQUIRED';

  const filledList = session?.fieldsFilled || [];

  const handleToggleSelectQid = (qid: string) => {
    setSelectedQids((prev) => {
      const next = new Set(prev);
      if (next.has(qid)) next.delete(qid);
      else next.add(qid);
      return next;
    });
  };

  const handleBatchGenerateCustom = async () => {
    if (!application || !session?.detectedCustomQuestions) return;
    const selectedList = session.detectedCustomQuestions.filter((q) => selectedQids.has(q.questionId));
    if (selectedList.length === 0) return;

    setIsGeneratingQa(true);
    setError(null);
    try {
      const res = await fetchWithAuth(`/api/v1/applications/${application.id}/qa/batch-generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          questions: selectedList.map((q) => ({
            questionId: q.questionId,
            questionText: q.label,
            category: q.category,
          })),
          sessionId: session.sessionId,
          includeJobContext: true,
        }),
      });
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.detail || 'Batch question generation failed');
      }
      const data = await res.json();
      const newAnswers = { ...qaAnswers };
      data.answers.forEach((ans: any) => {
        if (ans.answer) {
          newAnswers[ans.questionId] = ans.answer;
        }
      });
      setQaAnswers(newAnswers);
    } catch (err: any) {
      setError(err.message || 'Failed to generate answers');
    } finally {
      setIsGeneratingQa(false);
    }
  };

  const handleBatchFillCustom = async () => {
    if (!application || !session) return;
    const itemsToFill = Object.entries(qaAnswers)
      .filter(([qid, t]) => selectedQids.has(qid) && t.trim().length > 0)
      .map(([questionId, answerText]) => ({ questionId, answerText }));

    if (itemsToFill.length === 0) return;

    setIsFillingQa(true);
    setError(null);
    try {
      const res = await fetchWithAuth(`/api/v1/applications/${application.id}/qa/batch-fill`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: session.sessionId,
          answers: itemsToFill,
        }),
      });
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.detail || 'Batch answer fill failed');
      }
      const data = await res.json();
      setQaFillSuccess(data.filledCount);
      setTimeout(() => setQaFillSuccess(null), 4000);
    } catch (err: any) {
      setError(err.message || 'Failed to fill answers in browser');
    } finally {
      setIsFillingQa(false);
    }
  };

    const skippedList = session?.fieldsSkipped || [];

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-in fade-in duration-200"
      onClick={() => {
        if (!isRunning) onClose();
      }}
    >
      <div
        className="w-full max-w-2xl bg-[#0D0D0D] border border-white/15 rounded-2xl shadow-2xl shadow-black/95 overflow-hidden flex flex-col max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 bg-neutral-900/40 shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
              <Bot className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold text-white tracking-tight">Autofill Application</h3>
                <span className="px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                  Playwright Local
                </span>
              </div>
              <p className="text-xs text-neutral-400">Deterministic Browser Automation • Human Review Checkpoint</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Status Pill */}
            {isRunning && (
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20 text-xs font-medium animate-pulse">
                <Loader2 className="w-3 h-3 animate-spin" />
                <span>Automating...</span>
              </div>
            )}
            {isReadyForReview && (
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 text-xs font-semibold">
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>Ready For Review</span>
              </div>
            )}
            {isMultiStep && (
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-blue-500/15 text-blue-400 border border-blue-500/30 text-xs font-semibold">
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>Step Populated</span>
              </div>
            )}
            {isBrowserClosed && (
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 text-xs font-semibold">
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>Browser Closed • Confirm Submission</span>
              </div>
            )}
            {(isPaused || isAmbiguous) && (
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-500/15 text-amber-400 border border-amber-500/30 text-xs font-semibold">
                <AlertTriangle className="w-3.5 h-3.5" />
                <span>Action Needed</span>
              </div>
            )}
            {isNotFound && (
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-rose-500/15 text-rose-400 border border-rose-500/30 text-xs font-semibold">
                <AlertTriangle className="w-3.5 h-3.5" />
                <span>Manual Form</span>
              </div>
            )}

            <button
              type="button"
              disabled={isRunning}
              onClick={handleCancelSession}
              className="text-neutral-400 hover:text-white p-1 rounded-lg hover:bg-neutral-800 disabled:opacity-30 transition-colors ml-1"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Scrollable Content Body */}
        <div className="p-6 space-y-5 overflow-y-auto custom-scrollbar flex-1 text-xs">
          {/* Target Role & Portal Info Card */}
          <div className="p-4 rounded-xl bg-neutral-900/60 border border-white/10 space-y-2.5">
            <div className="flex items-center justify-between text-neutral-300">
              <div className="flex items-center gap-2 font-semibold text-white text-sm">
                <span>{application.jobTitle}</span>
                <span className="text-neutral-500">•</span>
                <span className="text-neutral-300 font-normal">{application.company}</span>
              </div>
              <span className="text-[11px] px-2 py-0.5 rounded bg-white/5 border border-white/10 text-neutral-400">
                {application.location}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-3 pt-2 border-t border-white/5 text-[11px]">
              <div className="flex items-center justify-between">
                <span className="text-neutral-400">Resume Snapshot:</span>
                <span className="text-emerald-400 font-medium flex items-center gap-1">
                  <FileText className="w-3 h-3" />
                  <span>
                    {application.resumeSnapshot
                      ? `v${application.resumeSnapshot.version} (Approved)`
                      : 'None Attached'}
                  </span>
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-neutral-400">Portal URL:</span>
                {application.portalUrl ? (
                  <a
                    href={application.portalUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-emerald-400 hover:underline flex items-center gap-1 truncate max-w-[140px]"
                    title={application.portalUrl}
                  >
                    <span className="truncate">{application.portalUrl}</span>
                    <ExternalLink className="w-2.5 h-2.5 shrink-0" />
                  </a>
                ) : (
                  <span className="text-neutral-500">Not specified</span>
                )}
              </div>
            </div>
          </div>

          {/* Stepper Progress */}
          <div className="space-y-2">
            <h4 className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wider">
              Automation Lifecycle Stepper
            </h4>
            <div className="grid grid-cols-3 gap-2">
              {STEP_DEFINITIONS.map((step, idx) => {
                const isStepCompleted =
                  activeStepIdx > idx ||
                  (activeStepIdx === 5 && idx < 5) ||
                  status === 'COMPLETED' ||
                  isBrowserClosed;
                const isStepActive =
                  activeStepIdx === idx &&
                  (isRunning || isReadyForReview || isBrowserClosed);
                return (
                  <div
                    key={step.id}
                    className={`p-2.5 rounded-xl border transition-all ${
                      isStepCompleted
                        ? 'bg-emerald-500/10 border-emerald-500/25 text-neutral-200'
                        : isStepActive
                        ? 'bg-blue-500/10 border-blue-500/30 text-white shadow-sm ring-1 ring-blue-500/20'
                        : 'bg-neutral-900/30 border-white/5 text-neutral-500'
                    }`}
                  >
                    <div className="flex items-center gap-1.5 mb-1">
                      {isStepCompleted ? (
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                      ) : isStepActive ? (
                        <Loader2 className="w-3.5 h-3.5 text-blue-400 animate-spin shrink-0" />
                      ) : (
                        <div className="w-3.5 h-3.5 rounded-full border border-neutral-600 flex items-center justify-center text-[9px] font-semibold text-neutral-500 shrink-0">
                          {idx + 1}
                        </div>
                      )}
                      <span className="font-medium truncate text-[11px]">{step.title}</span>
                    </div>
                    <p className="text-[10px] text-neutral-400 leading-tight line-clamp-1">{step.description}</p>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Human Review Checkpoint Banner (When Ready For Submission) */}
          {isReadyForReview && (
            <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/30 space-y-3 animate-in fade-in duration-300">
              <div className="flex items-start gap-3">
                <div className="p-2 rounded-lg bg-emerald-500/20 text-emerald-400 shrink-0 mt-0.5">
                  <CheckCircle2 className="w-5 h-5" />
                </div>
                <div className="space-y-1 flex-1">
                  <h4 className="text-sm font-bold text-emerald-300">
                    Human Review Checkpoint — Headed Browser Open
                  </h4>
                  <p className="text-neutral-300 leading-relaxed text-[11px]">
                    The local browser is currently paused on your desktop with all populated fields outlined in green.
                    Please inspect your application, answer any untouched custom questions, and click{' '}
                    <strong>"Submit"</strong> on the employer portal.
                  </p>
                </div>
              </div>

              {/* Populated / Skipped Summary Badges */}
              <div className="grid grid-cols-2 gap-3 pt-2 border-t border-emerald-500/20 text-[11px]">
                <div>
                  <span className="font-semibold text-emerald-400 block mb-1.5">
                    Populated Fields ({filledList.length}):
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {filledList.length > 0 ? (
                      filledList.map((f) => (
                        <span
                          key={f}
                          className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-[10px] font-mono"
                        >
                          {f}
                        </span>
                      ))
                    ) : (
                      <span className="text-neutral-500 italic text-[10px]">None detected</span>
                    )}
                    {session?.resumeAttached && (
                      <span className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-[10px] font-mono flex items-center gap-1">
                        <FileText className="w-2.5 h-2.5" /> resume.pdf attached
                      </span>
                    )}
                  </div>
                </div>

                <div>
                  <span className="font-semibold text-amber-400 block mb-1.5">
                    Untouched / Custom Questions ({skippedList.length}):
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {skippedList.length > 0 ? (
                      skippedList.map((s, i) => (
                        <span
                          key={i}
                          className="px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30 text-[10px] font-mono"
                        >
                          {s}
                        </span>
                      ))
                    ) : (
                      <span className="text-neutral-500 italic text-[10px]">None skipped</span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Multi-Step Progression Banner */}
          {isMultiStep && (
            <div className="p-4 rounded-xl bg-blue-500/10 border border-blue-500/30 space-y-3 animate-in fade-in duration-300">
              <div className="flex items-start gap-3">
                <div className="p-2 rounded-lg bg-blue-500/20 text-blue-400 shrink-0 mt-0.5">
                  <CheckCircle2 className="w-5 h-5" />
                </div>
                <div className="space-y-1 flex-1">
                  <h4 className="text-sm font-bold text-blue-300">
                    Multi-Step Form Detected — Step Populated
                  </h4>
                  <p className="text-neutral-300 leading-relaxed text-[11px]">
                    The engine filled verified identity fields on this step. Please inspect the open browser window, answer any step-specific questions, and click{' '}
                    <strong>"Next"</strong> or <strong>"Continue"</strong> on the employer portal to proceed to the next step.
                  </p>
                </div>
              </div>

              {/* Populated Fields Summary */}
              <div className="pt-2 border-t border-blue-500/20 text-[11px]">
                <span className="font-semibold text-blue-400 block mb-1.5">
                  Populated On This Step ({filledList.length}):
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {filledList.map((f) => (
                    <span
                      key={f}
                      className="px-2 py-0.5 rounded bg-blue-500/20 text-blue-300 border border-blue-500/30 text-[10px] font-mono"
                    >
                      {f}
                    </span>
                  ))}
                  {session?.resumeAttached && (
                    <span className="px-2 py-0.5 rounded bg-blue-500/20 text-blue-300 border border-blue-500/30 text-[10px] font-mono flex items-center gap-1">
                      <FileText className="w-2.5 h-2.5" /> resume.pdf attached
                    </span>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Ambiguous Apply CTAs Banner */}
          {isAmbiguous && (
            <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/30 space-y-2 animate-in fade-in duration-300">
              <div className="flex items-center gap-2 text-amber-400 font-bold text-xs">
                <AlertTriangle className="w-4 h-4" />
                <span>Multiple Application Options Detected</span>
              </div>
              <p className="text-neutral-300 text-[11px] leading-relaxed">
                The portal offers multiple distinct ways to apply (such as Apply with LinkedIn vs Apply on Company Site).
                Please click your preferred application method in the opened browser window to reveal the form.
              </p>
            </div>
          )}

          {/* Form Not Found Banner */}
          {isNotFound && (
            <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/30 space-y-2 animate-in fade-in duration-300">
              <div className="flex items-center gap-2 text-rose-400 font-bold text-xs">
                <AlertTriangle className="w-4 h-4" />
                <span>Manual Form Inspection Required</span>
              </div>
              <p className="text-neutral-300 text-[11px] leading-relaxed">
                The application form could not be automatically located or interactable fields were not detected.
                Please complete the application directly in the opened browser window.
              </p>
            </div>
          )}


          {/* ATS Custom Question Co-Pilot Card */}
          {session?.detectedCustomQuestions && session.detectedCustomQuestions.length > 0 && (
            <div className="p-4 rounded-xl bg-purple-950/20 border border-purple-500/30 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="p-1.5 rounded-lg bg-purple-500/20 text-purple-400">
                    <Sparkles className="w-4 h-4" />
                  </div>
                  <div>
                    <h4 className="text-xs font-bold text-white flex items-center gap-1.5">
                      <span>Custom Questions Co-Pilot</span>
                      <span className="px-1.5 py-0.5 rounded text-[9px] bg-purple-500/20 text-purple-300 font-semibold">
                        Truth-Locked
                      </span>
                    </h4>
                    <p className="text-[10px] text-neutral-400">
                      {session.detectedCustomQuestions.length} custom portal questions detected. Select questions to answer in ONE batch.
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={selectedQids.size === 0 || isGeneratingQa}
                    onClick={handleBatchGenerateCustom}
                    className="inline-flex items-center gap-1 px-3 py-1.5 bg-gradient-to-r from-purple-600 to-emerald-600 hover:from-purple-500 hover:to-emerald-500 disabled:opacity-40 text-white font-semibold rounded-lg text-[11px] shadow-sm transition-all"
                  >
                    <Sparkles className="w-3 h-3" />
                    <span>{isGeneratingQa ? 'Generating...' : `Generate Selected (${selectedQids.size})`}</span>
                  </button>

                  {Object.keys(qaAnswers).length > 0 && (
                    <button
                      type="button"
                      disabled={isFillingQa}
                      onClick={handleBatchFillCustom}
                      className="inline-flex items-center gap-1 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white font-semibold rounded-lg text-[11px] shadow-sm transition-all"
                    >
                      <Send className="w-3 h-3" />
                      <span>{isFillingQa ? 'Filling...' : 'Fill Selected Answers'}</span>
                    </button>
                  )}
                </div>
              </div>

              {qaFillSuccess !== null && (
                <div className="p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/25 text-emerald-300 text-[11px] flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>Successfully populated {qaFillSuccess} custom answer(s) into live portal form!</span>
                </div>
              )}

              {/* Detected Questions Checklist */}
              <div className="space-y-2 pt-1">
                {session.detectedCustomQuestions.map((q) => {
                  const isChecked = selectedQids.has(q.questionId);
                  const generatedAnswer = qaAnswers[q.questionId];

                  return (
                    <div
                      key={q.questionId}
                      className="p-3 rounded-lg bg-neutral-900/60 border border-white/5 space-y-2 text-[11px]"
                    >
                      <div className="flex items-start gap-2">
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => handleToggleSelectQid(q.questionId)}
                          className="mt-0.5 w-3.5 h-3.5 rounded border-white/20 bg-neutral-800 text-purple-600 focus:ring-purple-500"
                        />
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-[9px] text-neutral-500">{q.questionId}</span>
                            <span className="font-semibold text-neutral-200">{q.label}</span>
                          </div>
                        </div>
                      </div>

                      {/* Inline Editable Answer */}
                      {generatedAnswer !== undefined && (
                        <div className="pl-5.5 space-y-1">
                          <textarea
                            rows={2}
                            value={generatedAnswer}
                            onChange={(e) => {
                              const val = e.target.value;
                              setQaAnswers((prev) => ({ ...prev, [q.questionId]: val }));
                            }}
                            className="w-full p-2 rounded-lg bg-neutral-950 border border-purple-500/30 text-neutral-200 text-[11px] focus:outline-none focus:border-purple-500"
                            placeholder="Generated answer..."
                          />
                          <div className="flex items-center justify-between text-[10px] text-neutral-500">
                            <span>{generatedAnswer.length} chars • {generatedAnswer.split(/\s+/).filter(Boolean).length} words</span>
                            <span className="text-emerald-400 font-medium">Ready to fill into form</span>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Paused for CAPTCHA or Login Warning */}
          {isPaused && (
            <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/30 space-y-2">
              <div className="flex items-center gap-2 text-amber-400 font-bold text-xs">
                <AlertTriangle className="w-4 h-4" />
                <span>
                  {status === 'PAUSED_FOR_CAPTCHA'
                    ? 'CAPTCHA Detected on Portal'
                    : 'Portal Requires Candidate Sign-In'}
                </span>
              </div>
              <p className="text-neutral-300 text-[11px] leading-relaxed">
                Please switch to the opened browser window on your desktop and solve the CAPTCHA or sign in. Autofill
                will safely resume once completed.
              </p>
            </div>
          )}

          {/* Safety Invariants Accordion/Notice */}
          <div className="p-3.5 rounded-xl bg-neutral-900/40 border border-white/10 space-y-2">
            <div className="flex items-center gap-2 text-neutral-300 font-medium">
              <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
              <span className="text-white font-semibold">Strict Human-In-The-Loop Safety Policy</span>
            </div>
            <ul className="text-[11px] text-neutral-400 space-y-1 list-disc list-inside leading-relaxed">
              <li>
                <strong className="text-neutral-200">Zero External AI / LLM Calls:</strong> 100% deterministic local
                browser runner. Free of AI inference costs.
              </li>
              <li>
                <strong className="text-neutral-200">No Automatic Submission:</strong> The automation runner has no
                submit API. It strictly halts at the final screen for candidate review.
              </li>
              <li>
                <strong className="text-neutral-200">Strict Safe Allowlist:</strong> Only basic verified contact info
                and the tailored PDF are uploaded. Sensitive, diversity, and custom questions remain untouched.
              </li>
            </ul>
          </div>

          {/* Collapsible Execution Event Stream Log */}
          <div className="border border-white/10 rounded-xl overflow-hidden bg-black/40">
            <button
              type="button"
              onClick={() => setShowLogs(!showLogs)}
              className="w-full flex items-center justify-between px-3.5 py-2.5 text-[11px] font-medium text-neutral-400 hover:text-white bg-neutral-900/40 transition-colors"
            >
              <div className="flex items-center gap-2">
                <Clock className="w-3.5 h-3.5 text-neutral-500" />
                <span>Technical Event Stream ({events.length} events logged)</span>
              </div>
              {showLogs ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </button>

            {showLogs && (
              <div className="p-3 max-h-48 overflow-y-auto space-y-1 font-mono text-[10px] text-neutral-400 border-t border-white/5 bg-black/60">
                {events.length === 0 ? (
                  <div className="text-neutral-600 italic">Waiting for session initialization...</div>
                ) : (
                  events.map((ev, i) => {
                    const evType = String(ev.eventType || ev.step || 'INFO').toUpperCase();
                    const isSuccess = evType.includes('SUCCESS') || evType.includes('FILLED') || evType.includes('READY');
                    const isSkipped = evType.includes('SKIPPED');
                    const isError = evType.includes('ERROR') || evType.includes('FAIL');
                    return (
                      <div key={ev.eventId || i} className="flex items-start gap-2 leading-relaxed">
                        <span className="text-neutral-600 shrink-0">
                          {ev.timestamp ? new Date(ev.timestamp).toLocaleTimeString([], { hour12: false }) : '--:--:--'}
                        </span>
                        <span
                          className={
                            isSuccess
                              ? 'text-emerald-400'
                              : isSkipped
                              ? 'text-amber-400'
                              : isError
                              ? 'text-rose-400'
                              : 'text-neutral-300'
                          }
                        >
                          [{evType}] {ev.message}
                        </span>
                      </div>
                    );
                  })
                )}
                <div ref={logsEndRef} />
              </div>
            )}
          </div>

          {/* Error Banner */}
          {error && (
            <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-300 text-[11px] flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
              <div className="flex-1">{error}</div>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="px-6 py-4 border-t border-white/10 bg-neutral-900/40 flex items-center justify-between shrink-0">
          <button
            type="button"
            disabled={isCancelling}
            onClick={handleCancelSession}
            className="px-4 py-2 text-xs font-medium text-neutral-400 hover:text-white rounded-xl hover:bg-neutral-800 disabled:opacity-40 transition-colors"
          >
            {isRunning || isReadyForReview ? 'Cancel & Close Browser' : 'Close'}
          </button>

          <div className="flex items-center gap-3">
            {status === 'IDLE' && (
              <button
                type="button"
                disabled={isStarting || !application.portalUrl}
                onClick={handleStartAutofill}
                className="px-5 py-2 text-xs font-bold text-black bg-emerald-400 hover:bg-emerald-300 rounded-xl transition-all shadow-lg shadow-emerald-500/20 flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
              >
                {isStarting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Initiating Browser...</span>
                  </>
                ) : (
                  <>
                    <Play className="w-4 h-4 fill-black" />
                    <span>Launch Autofill Session</span>
                  </>
                )}
              </button>
            )}

            {isRunning && (
              <div className="flex items-center gap-2 text-xs text-blue-400 font-medium px-3 py-1.5 rounded-xl bg-blue-500/10 border border-blue-500/20">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>Populating portal in headed browser...</span>
              </div>
            )}

            {(isReadyForReview || isMultiStep || isNotFound || isBrowserClosed) && (
              <button
                type="button"
                disabled={isConfirming}
                onClick={handleConfirmSubmission}
                className="px-6 py-2.5 text-xs font-bold text-black bg-emerald-400 hover:bg-emerald-300 rounded-xl transition-all shadow-xl shadow-emerald-500/30 flex items-center gap-2 cursor-pointer"
              >
                {isConfirming ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Recording Submission...</span>
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="w-4 h-4" />
                    <span>I submitted the application on portal</span>
                  </>
                )}
              </button>
            )}

            {(status === 'FAILED' || status === 'CANCELLED') && (
              <button
                type="button"
                onClick={handleStartAutofill}
                className="px-4 py-2 text-xs font-bold text-white bg-neutral-800 hover:bg-neutral-700 rounded-xl transition-colors flex items-center gap-2 cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Retry Autofill</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
};
