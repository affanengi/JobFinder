import React, { useState, useEffect } from 'react';
import {
  X,
  Sparkles,
  ShieldCheck,
  AlertTriangle,
  CheckCircle2,
  Paperclip,
  Send,
  Loader2,
  RefreshCw,
  MessageSquare,
  ShieldAlert,
} from 'lucide-react';
import { fetchWithAuth } from '../../lib/api';
import { DiscoveredContact } from '../../types/opportunityContact';
import { OutreachMessage, TruthLockReport } from '../../types/outreach';
import { ThreadTimeline } from './ThreadTimeline';

interface OutreachComposerModalProps {
  isOpen: boolean;
  onClose: () => void;
  contact: DiscoveredContact | null;
  opportunityId: string;
  companyName: string;
  onOutreachUpdated?: (outreach: OutreachMessage) => void;
}

interface SavedResumeOption {
  id: string;
  jobTitle: string;
  jobCompany: string;
}

export const OutreachComposerModal: React.FC<OutreachComposerModalProps> = ({
  isOpen,
  onClose,
  contact,
  opportunityId,
  companyName,
  onOutreachUpdated,
}) => {
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [tone, setTone] = useState<'concise' | 'professional' | 'enthusiastic'>('concise');
  const [notes, setNotes] = useState('');
  const [selectedResumeId, setSelectedResumeId] = useState<string>('');
  const [availableResumes, setAvailableResumes] = useState<SavedResumeOption[]>([]);
  
  const [currentOutreach, setCurrentOutreach] = useState<OutreachMessage | null>(null);
  const [truthReport, setTruthReport] = useState<TruthLockReport | null>(null);
  const [status, setStatus] = useState<string>('DRAFT');
  
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [approving, setApproving] = useState(false);
  const [sending, setSending] = useState(false);
  const [reconciling, setReconciling] = useState(false);
  const [activeTab, setActiveTab] = useState<'composer' | 'timeline'>('composer');
  
  // Strict 2-step AI confirmation state
  const [showAiConfirm, setShowAiConfirm] = useState(false);
  
  // Gmail OAuth status
  const [isGmailConnected, setIsGmailConnected] = useState(false);
  const [gmailEmail, setGmailEmail] = useState<string | null>(null);
  const [checkingGmail, setCheckingGmail] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen && contact) {
      setActiveTab('composer');
      loadExistingOutreach();
      loadUserResumes();
      checkGmailConnection();
    } else {
      setShowAiConfirm(false);
      setErrorMessage(null);
    }
  }, [isOpen, contact]);

  const loadExistingOutreach = async () => {
    if (!contact) return;
    setLoading(true);
    setErrorMessage(null);
    try {
      const res = await fetchWithAuth(
        `/api/v1/opportunities/${opportunityId}/contacts/${contact.id}/outreach`
      );
      if (res.ok) {
        const data: OutreachMessage | null = await res.json();
        if (data) {
          setCurrentOutreach(data);
          setSubject(data.subject);
          setBody(data.body);
          setTruthReport(data.truthLockReport);
          setStatus(data.status);
          if (data.status === 'SENT') {
            setActiveTab('timeline');
          }
          if (data.resumeAttachmentId) {
            setSelectedResumeId(data.resumeAttachmentId);
          }
        } else {
          // Initialize empty
          setCurrentOutreach(null);
          setSubject(`Connecting regarding opportunities at ${contact.companyName || companyName}`);
          setBody('');
          setTruthReport(null);
          setStatus('DRAFT');
        }
      }
    } catch (err: any) {
      console.error('Failed to load outreach draft:', err);
    } finally {
      setLoading(false);
    }
  };

  const loadUserResumes = async () => {
    try {
      const res = await fetchWithAuth('/api/v1/resumes');
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) {
          setAvailableResumes(
            data.map((r: any) => ({
              id: r.id,
              jobTitle: r.jobTitle || 'General Software Engineering',
              jobCompany: r.jobCompany || 'Standard',
            }))
          );
        }
      }
    } catch (err) {
      console.warn('Could not load user resumes for attachment:', err);
    }
  };

  const checkGmailConnection = async () => {
    setCheckingGmail(true);
    try {
      const res = await fetchWithAuth('/api/v1/auth/gmail/status');
      if (res.ok) {
        const data = await res.json();
        setIsGmailConnected(data.isConnected);
        setGmailEmail(data.gmailAddress || null);
      }
    } catch {
      setIsGmailConnected(false);
    } finally {
      setCheckingGmail(false);
    }
  };

  // Text edits invalidate approval state back to DRAFT
  const handleSubjectChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSubject(e.target.value);
    if (status === 'APPROVED') {
      setStatus('DRAFT');
    }
  };

  const handleBodyChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setBody(e.target.value);
    if (status === 'APPROVED') {
      setStatus('DRAFT');
    }
  };

  // 1. AI Generation flow with strict 2-step confirmation
  const handleInitiateAiClick = () => {
    setShowAiConfirm(true);
  };

  const handleCancelAi = () => {
    // User cancelled: does NOT call AI, preserves typed text
    setShowAiConfirm(false);
  };

  const handleConfirmAiGenerate = async () => {
    if (!contact) return;
    setShowAiConfirm(false);
    setLoading(true);
    setErrorMessage(null);
    try {
      const res = await fetchWithAuth(
        `/api/v1/opportunities/${opportunityId}/contacts/${contact.id}/outreach/generate`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            notes,
            tone,
            resumeAttachmentId: selectedResumeId || undefined,
          }),
        }
      );

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.detail || 'Failed to generate outreach draft.');
      }

      const generated: OutreachMessage = await res.json();
      setCurrentOutreach(generated);
      setSubject(generated.subject);
      setBody(generated.body);
      setTruthReport(generated.truthLockReport);
      setStatus(generated.status);
      onOutreachUpdated?.(generated);
    } catch (err: any) {
      setErrorMessage(err.message || 'Error communicating with AI service.');
    } finally {
      setLoading(false);
    }
  };

  // 2. Manual Save Draft
  const handleSaveDraft = async () => {
    if (!contact) return;
    setSaving(true);
    setErrorMessage(null);
    try {
      const res = await fetchWithAuth(
        `/api/v1/opportunities/${opportunityId}/contacts/${contact.id}/outreach`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            subject,
            body,
            resumeAttachmentId: selectedResumeId || undefined,
          }),
        }
      );

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.detail || 'Failed to save draft.');
      }

      const saved: OutreachMessage = await res.json();
      setCurrentOutreach(saved);
      setTruthReport(saved.truthLockReport);
      setStatus(saved.status);
      onOutreachUpdated?.(saved);
    } catch (err: any) {
      setErrorMessage(err.message || 'Error saving draft.');
    } finally {
      setSaving(false);
    }
  };

  // 3. Explicit Approval Toggle
  const handleToggleApproval = async () => {
    if (!currentOutreach) {
      await handleSaveDraft();
    }
    const outreachId = currentOutreach?.id;
    if (!outreachId) return;

    setApproving(true);
    setErrorMessage(null);
    try {
      const nextApproval = status !== 'APPROVED';
      const res = await fetchWithAuth(
        `/api/v1/opportunities/${opportunityId}/outreach/${outreachId}/approve`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ isApproved: nextApproval }),
        }
      );

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.detail || 'Failed to update approval status.');
      }

      const updated: OutreachMessage = await res.json();
      setCurrentOutreach(updated);
      setStatus(updated.status);
      onOutreachUpdated?.(updated);
    } catch (err: any) {
      setErrorMessage(err.message || 'Error approving outreach draft.');
    } finally {
      setApproving(false);
    }
  };

  // 4. Send via Gmail (Phase 4)
  const handleSendViaGmail = async () => {
    if (!currentOutreach) return;
    setSending(true);
    setErrorMessage(null);
    try {
      const res = await fetchWithAuth(
        `/api/v1/opportunities/${opportunityId}/outreach/${currentOutreach.id}/send`,
        { method: 'POST' }
      );

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.detail || data.message || 'Failed to send outreach via Gmail.');
      }

      setStatus(data.status);
      // Refresh current outreach message state
      await loadExistingOutreach();
    } catch (err: any) {
      setErrorMessage(err.message || 'Send execution error.');
      // Refresh to capture SEND_FAILED or SEND_STATUS_UNKNOWN
      await loadExistingOutreach();
    } finally {
      setSending(false);
    }
  };

  // 5. Reconcile Ambiguous Outcome (Phase 4)
  const handleReconcileStatus = async () => {
    if (!currentOutreach) return;
    setReconciling(true);
    setErrorMessage(null);
    try {
      const res = await fetchWithAuth(
        `/api/v1/opportunities/${opportunityId}/outreach/${currentOutreach.id}/reconcile`,
        { method: 'POST' }
      );

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.detail || 'Failed to reconcile outreach status.');
      }

      await loadExistingOutreach();
    } catch (err: any) {
      setErrorMessage(err.message || 'Reconciliation failed.');
    } finally {
      setReconciling(false);
    }
  };

  const handleConnectGmail = async () => {
    try {
      const res = await fetchWithAuth('/api/v1/auth/gmail/authorize');
      if (res.ok) {
        const data = await res.json();
        if (data.authorizationUrl) {
          window.location.href = data.authorizationUrl;
        }
      } else {
        const errData = await res.json().catch(() => ({}));
        setErrorMessage(errData.detail || 'Could not initiate Gmail authorization.');
      }
    } catch (err) {
      setErrorMessage('Failed to initiate Gmail authorization.');
    }
  };

  if (!isOpen || !contact) return null;

  const wordCount = body.trim() ? body.trim().split(/\s+/).length : 0;
  const isWordCountOptimal = wordCount > 0 && wordCount <= 140;

  const isGloballySuppressed = Boolean(
    contact.doNotContact || contact.suppressionState === 'GLOBAL_STAKEHOLDER_SUPPRESSION'
  );
  const isJobSuppressed = Boolean(contact.suppressionState === 'JOB_SPECIFIC_SUPPRESSION');
  const isSuppressed = isGloballySuppressed || isJobSuppressed;

  // Eligibility: strictly prohibited for PATTERN_INFERRED, UNVERIFIED, INVALID_OR_UNSUPPORTED, and suppressed contacts
  const isEmailEligibleForSending =
    contact.email &&
    !isSuppressed &&
    contact.emailClassification !== 'PATTERN_INFERRED' &&
    contact.emailClassification !== 'UNVERIFIED' &&
    contact.emailClassification !== 'INVALID_OR_UNSUPPORTED';

  const isApproved = status === 'APPROVED';
  const isSent = status === 'SENT';
  const isUnknown = status === 'SEND_STATUS_UNKNOWN';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-in fade-in duration-150"
      data-testid="outreach-composer-modal"
    >
      <div className="bg-[#121212] border border-white/10 rounded-2xl w-full max-w-3xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 bg-[#161616]">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-purple-500/15 border border-purple-500/30 text-purple-400">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-semibold text-white">Outreach Composer</h3>
                <span className="text-xs px-2 py-0.5 rounded font-mono font-medium bg-neutral-800 text-neutral-300 border border-white/10">
                  Truth-Locked
                </span>
              </div>
              <p className="text-xs text-neutral-400">
                To: <span className="text-white font-medium">{contact.fullName}</span> ({contact.roleTitle}) · {contact.companyName || companyName}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-neutral-400 hover:text-white hover:bg-white/5 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {/* Recipient Email & Evidence Pill */}
          <div className="flex flex-wrap items-center justify-between gap-2 p-3 rounded-xl bg-[#1A1A1A] border border-white/10">
            <div className="flex items-center gap-2 text-xs">
              <span className="text-neutral-400">Recipient Email:</span>
              <span className="font-mono text-white font-medium">
                {contact.email || 'No direct email published'}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-neutral-800 text-neutral-300 border border-white/10">
                Evidence: {contact.emailClassification}
              </span>
              {!isEmailEligibleForSending && (
                <span className="text-[11px] text-amber-400 flex items-center gap-1 font-mono">
                  <AlertTriangle className="w-3.5 h-3.5" /> Direct sending restricted (requires verified email)
                </span>
              )}
            </div>
          </div>

          {/* Gmail Integration Status Bar */}
          <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 rounded-xl bg-[#161616] border border-white/5 text-xs">
            <div className="flex items-center gap-2">
              {checkingGmail ? (
                <Loader2 className="w-3 h-3 animate-spin text-purple-400" />
              ) : (
                <span className={`w-2 h-2 rounded-full ${isGmailConnected ? 'bg-emerald-400' : 'bg-neutral-500'}`} />
              )}
              <span className="text-neutral-400">
                Gmail: <span className="text-white font-medium">{isGmailConnected ? (gmailEmail ? `Connected (${gmailEmail})` : 'Connected') : 'Not Connected'}</span>
              </span>
            </div>
            {!isGmailConnected && (
              <button
                type="button"
                onClick={handleConnectGmail}
                className="px-2.5 py-1 text-[11px] font-semibold rounded-lg bg-white/10 hover:bg-white/15 text-white transition-colors cursor-pointer"
                data-testid="connect-gmail-btn"
              >
                Connect Gmail
              </button>
            )}
          </div>

          {/* Suppression Alerts */}
          {isGloballySuppressed && (
            <div className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/30 flex items-start gap-2.5 text-xs text-rose-300">
              <ShieldAlert className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
              <div>
                <span className="font-semibold">Global Opt-Out Active:</span> This stakeholder has explicitly requested no further contact (GLOBAL_STAKEHOLDER_SUPPRESSION). Drafting and sending are disabled.
              </div>
            </div>
          )}
          {isJobSuppressed && (
            <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-start gap-2.5 text-xs text-amber-300">
              <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
              <div>
                <span className="font-semibold">Role Rejection (Job-Specific):</span> This contact rejected outreach for this specific vacancy (JOB_SPECIFIC_SUPPRESSION). Sending further messages is paused.
              </div>
            </div>
          )}

          {/* Segmented Tab Switcher (Outreach Draft vs Thread & Replies) */}
          {currentOutreach && (currentOutreach.status === 'SENT' || (currentOutreach.replyCount || 0) > 0) && (
            <div className="flex items-center gap-2 border-b border-white/10 pb-2">
              <button
                type="button"
                onClick={() => setActiveTab('composer')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer ${
                  activeTab === 'composer'
                    ? 'bg-purple-600/20 text-purple-300 border border-purple-500/40'
                    : 'text-neutral-400 hover:text-white'
                }`}
                data-testid="composer-tab-btn"
              >
                Outreach Message
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('timeline')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer ${
                  activeTab === 'timeline'
                    ? 'bg-purple-600/20 text-purple-300 border border-purple-500/40'
                    : 'text-neutral-400 hover:text-white'
                }`}
                data-testid="timeline-tab-btn"
              >
                <MessageSquare className="w-3.5 h-3.5" />
                Thread &amp; Replies
                {(currentOutreach.replyCount || 0) > 0 && (
                  <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-emerald-500/20 text-emerald-400 font-mono">
                    {currentOutreach.replyCount}
                  </span>
                )}
              </button>
            </div>
          )}

          {activeTab === 'timeline' && currentOutreach ? (
            <ThreadTimeline
              opportunityId={opportunityId}
              outreachId={currentOutreach.id}
              onReplyUpdated={() => loadExistingOutreach()}
            />
          ) : (
            <>
              {/* AI Drafting Confirmation Banner */}
          {showAiConfirm ? (
            <div
              className="p-4 rounded-xl bg-purple-950/40 border border-purple-500/40 space-y-3 animate-in fade-in duration-150"
              data-testid="ai-confirmation-panel"
            >
              <div className="flex items-start gap-3">
                <div className="p-2 rounded-lg bg-purple-500/20 text-purple-300 mt-0.5">
                  <Sparkles className="w-4 h-4" />
                </div>
                <div className="space-y-1">
                  <h4 className="text-sm font-semibold text-white">Generate with Truth-Locked AI?</h4>
                  <p className="text-xs text-purple-200/80 leading-relaxed">
                    AI will draft a tailored message under 120 words strictly grounded in your verified candidate
                    profile facts. No relationships or unverified achievements will be fabricated.
                  </p>
                </div>
              </div>
              <div className="flex items-center justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={handleCancelAi}
                  className="px-3 py-1.5 text-xs font-medium rounded-lg text-neutral-300 hover:text-white bg-white/5 hover:bg-white/10 transition-colors cursor-pointer"
                  data-testid="cancel-ai-btn"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleConfirmAiGenerate}
                  className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-purple-600 hover:bg-purple-500 text-white transition-colors cursor-pointer flex items-center gap-1.5 shadow-md shadow-purple-900/30"
                  data-testid="confirm-ai-btn"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  Yes, write with AI
                </button>
              </div>
            </div>
          ) : (
            <div className="p-3 rounded-xl bg-purple-950/20 border border-purple-500/20 space-y-2.5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-purple-400" />
                  <span className="text-xs text-neutral-300">
                    Tone:
                  </span>
                  <select
                    value={tone}
                    onChange={(e) => setTone(e.target.value as any)}
                    className="bg-black/40 border border-white/10 text-xs rounded-lg px-2 py-1 text-white focus:outline-none focus:border-purple-500"
                  >
                    <option value="concise">Concise (Recommended)</option>
                    <option value="professional">Professional</option>
                    <option value="enthusiastic">Enthusiastic</option>
                  </select>
                </div>

                <button
                  type="button"
                  onClick={handleInitiateAiClick}
                  disabled={loading}
                  className="px-3 py-1.5 text-xs font-medium rounded-lg bg-purple-600/30 hover:bg-purple-600/40 border border-purple-500/30 text-purple-200 transition-colors flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                  data-testid="write-with-ai-btn"
                >
                  {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                  Write with AI
                </button>
              </div>

              {/* Optional custom notes */}
              <input
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Optional focus/angle (e.g. distributed systems background, latency reduction)"
                className="w-full bg-black/30 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white placeholder:text-neutral-500 focus:outline-none focus:border-purple-500"
              />
            </div>
          )}

          {/* Subject Line Input */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-neutral-300">Subject</label>
            <input
              type="text"
              value={subject}
              onChange={handleSubjectChange}
              placeholder="e.g. Inquiring regarding Software Engineering roles at Company"
              className="w-full bg-[#1A1A1A] border border-white/10 rounded-xl px-3.5 py-2 text-sm text-white focus:outline-none focus:border-purple-500/60 placeholder:text-neutral-600 font-medium"
              data-testid="outreach-subject-input"
            />
          </div>

          {/* Message Body Textarea */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-neutral-300">Message Body</label>
              <span
                className={`text-xs font-mono ${
                  isWordCountOptimal
                    ? 'text-emerald-400'
                    : wordCount > 140
                    ? 'text-rose-400'
                    : 'text-neutral-500'
                }`}
              >
                {wordCount} words {wordCount > 140 ? '(Too long - target < 120)' : ''}
              </span>
            </div>
            <textarea
              rows={7}
              value={body}
              onChange={handleBodyChange}
              placeholder="Write a concise, professional outreach message..."
              className="w-full bg-[#1A1A1A] border border-white/10 rounded-xl p-3.5 text-sm text-neutral-200 focus:outline-none focus:border-purple-500/60 placeholder:text-neutral-600 leading-relaxed font-sans resize-y"
              data-testid="outreach-body-textarea"
            />
          </div>

          {/* Truth-Lock Audit Report */}
          {truthReport && (
            <div
              className={`p-4 rounded-xl border space-y-2.5 ${
                truthReport.status === 'PASS'
                  ? 'bg-emerald-950/20 border-emerald-500/30'
                  : truthReport.status === 'FAIL'
                  ? 'bg-rose-950/20 border-rose-500/30'
                  : 'bg-amber-950/20 border-amber-500/30'
              }`}
              data-testid="truth-lock-report"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <ShieldCheck
                    className={`w-4 h-4 ${
                      truthReport.status === 'PASS'
                        ? 'text-emerald-400'
                        : truthReport.status === 'FAIL'
                        ? 'text-rose-400'
                        : 'text-amber-400'
                    }`}
                  />
                  <h5 className="text-xs font-semibold text-white uppercase tracking-wider">
                    Truth-Lock Audit Status: {truthReport.status}
                  </h5>
                </div>
                <span className="text-xs font-mono text-neutral-400">
                  {truthReport.passedChecks} / {truthReport.totalChecks} checks verified
                </span>
              </div>

              {/* Findings */}
              {truthReport.findings.length > 0 && (
                <div className="space-y-1.5 pt-1">
                  {truthReport.findings.map((finding, idx) => (
                    <div
                      key={idx}
                      className="flex items-start gap-2 text-xs leading-relaxed font-sans"
                    >
                      {finding.status === 'PASS' ? (
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
                      ) : (
                        <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
                      )}
                      <div>
                        <span className="font-medium text-white">{finding.claim}: </span>
                        <span className="text-neutral-300">{finding.reason}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Verified Facts Reference */}
              {truthReport.verifiedFactReferences.length > 0 && (
                <div className="pt-1 flex flex-wrap items-center gap-1.5">
                  <span className="text-[11px] text-neutral-400">Verified facts:</span>
                  {truthReport.verifiedFactReferences.map((ref, idx) => (
                    <span
                      key={idx}
                      className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-black/40 text-neutral-300 border border-white/5"
                    >
                      {ref}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Resume PDF Attachment Dropdown */}
          <div className="p-3.5 rounded-xl bg-[#1A1A1A] border border-white/10 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Paperclip className="w-4 h-4 text-neutral-400" />
              <span className="text-xs text-neutral-300 font-medium">Attach Tailored Resume:</span>
            </div>
            <select
              value={selectedResumeId}
              onChange={(e) => setSelectedResumeId(e.target.value)}
              className="bg-black/40 border border-white/10 text-xs rounded-lg px-2.5 py-1.5 text-white focus:outline-none focus:border-purple-500 max-w-xs truncate"
            >
              <option value="">None (Send text email only)</option>
              {availableResumes.map((res) => (
                <option key={res.id} value={res.id}>
                  {res.jobCompany} — {res.jobTitle}
                </option>
              ))}
            </select>
          </div>

          {/* Status & Error Display */}
          {errorMessage && (
            <div className="p-3 rounded-xl bg-rose-950/30 border border-rose-500/30 text-rose-300 text-xs flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{errorMessage}</span>
            </div>
          )}

          {isSent && (
            <div className="p-3 rounded-xl bg-emerald-950/30 border border-emerald-500/30 text-emerald-300 text-xs flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>Outreach email successfully dispatched via Gmail.</span>
            </div>
          )}

          {isUnknown && (
            <div className="p-3 rounded-xl bg-amber-950/30 border border-amber-500/40 text-amber-300 text-xs space-y-2">
              <div className="flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-amber-400" />
                <div>
                  <p className="font-semibold text-white">Send Outcome Ambiguous</p>
                  <p className="leading-relaxed">
                    A network timeout or ambiguous response occurred during transmission. Automatic resends are
                    strictly blocked to avoid duplicates. Click "Reconcile Status" to verify delivery state.
                  </p>
                </div>
              </div>
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={handleReconcileStatus}
                  disabled={reconciling}
                  className="px-3 py-1 bg-amber-600/30 hover:bg-amber-600/40 border border-amber-500/40 rounded-lg text-amber-200 text-xs font-medium cursor-pointer flex items-center gap-1.5"
                >
                  {reconciling ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                  Reconcile Status
                </button>
              </div>
            </div>
          )}
            </>
          )}
        </div>

        {/* Footer Actions */}
        <div className="px-6 py-4 border-t border-white/10 bg-[#161616] flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span
              className={`text-xs font-mono font-bold px-2 py-0.5 rounded border ${
                status === 'APPROVED'
                  ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                  : status === 'SENT'
                  ? 'bg-sky-500/15 text-sky-300 border-sky-500/30'
                  : 'bg-neutral-800 text-neutral-400 border-white/10'
              }`}
            >
              Status: {status}
            </span>
          </div>

          {activeTab === 'composer' ? (
            <div className="flex items-center gap-2">
              {/* Save Draft */}
              <button
                type="button"
                onClick={handleSaveDraft}
                disabled={saving || !body.trim() || isSuppressed}
                className="px-3.5 py-2 text-xs font-medium rounded-xl bg-neutral-800 hover:bg-neutral-700 text-white border border-white/10 transition-colors cursor-pointer disabled:opacity-50"
                data-testid="save-draft-btn"
              >
                {saving ? 'Saving...' : 'Save Draft'}
              </button>

              {/* Explicit Approval Toggle */}
              <button
                type="button"
                onClick={handleToggleApproval}
                disabled={approving || !body.trim() || isSuppressed}
                className={`px-3.5 py-2 text-xs font-semibold rounded-xl border transition-colors cursor-pointer flex items-center gap-1.5 ${
                  isApproved
                    ? 'bg-amber-500/15 text-amber-300 border-amber-500/30 hover:bg-amber-500/20'
                    : 'bg-emerald-600/20 text-emerald-300 border-emerald-500/30 hover:bg-emerald-600/30'
                } disabled:opacity-50`}
                data-testid="approve-draft-btn"
              >
                {isApproved ? 'Revoke Approval' : 'Approve for Sending'}
              </button>

              {/* Send via Gmail (Phase 4) */}
              <button
                type="button"
                onClick={handleSendViaGmail}
                disabled={
                  sending ||
                  !isApproved ||
                  !isEmailEligibleForSending ||
                  !isGmailConnected ||
                  isSent
                }
                title={
                  !isGmailConnected
                    ? 'Connect Gmail in Settings first'
                    : isSuppressed
                    ? 'Sending blocked: contact has opted out or rejected this vacancy'
                    : !isEmailEligibleForSending
                    ? 'Sending restricted: recipient email must be verified'
                    : !isApproved
                    ? 'Explicit draft approval required before sending'
                    : isSent
                    ? 'Message already sent'
                    : 'Send outreach message via Gmail'
                }
                className="px-4 py-2 text-xs font-semibold rounded-xl bg-purple-600 hover:bg-purple-500 text-white transition-colors cursor-pointer flex items-center gap-1.5 shadow-md shadow-purple-900/30 disabled:opacity-40 disabled:cursor-not-allowed"
                data-testid="send-gmail-btn"
              >
                {sending ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Send className="w-3.5 h-3.5" />
                )}
                {isSent ? 'Sent' : 'Send via Gmail'}
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-xs font-semibold rounded-xl bg-neutral-800 hover:bg-neutral-700 text-white border border-white/10 transition-colors cursor-pointer"
                data-testid="close-timeline-modal-btn"
              >
                Close Timeline
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
