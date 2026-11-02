import React, { useState, useEffect } from 'react';
import {
  Building2,
  ArrowLeft,
  Mail,
  ShieldCheck,
  AlertTriangle,
  ShieldAlert,
  Sparkles,
  Save,
  Send,
  Paperclip,
  Loader2,
  CheckCircle2,
  Clock,
  Globe,
  Copy,
  ExternalLink,
} from 'lucide-react';
import { fetchWithAuth } from '../lib/api';
import { DiscoveredContact, EmailEvidenceClassification } from '../types/opportunityContact';
import { OutreachMessage, SendOutreachResponse } from '../types/outreach';
import { TailoredResumeDTO } from '../components/resume/ResumeStudioModal';
import { AiDraftConfirmationModal } from '../components/outreach/AiDraftConfirmationModal';
import { ThreadTimeline } from '../components/outreach/ThreadTimeline';

interface ContactOutreachPageProps {
  companyKey: string;
  contactId: string;
  opportunityId: string;
  onBackToCompany: () => void;
  onBackToDirectory: () => void;
}

export const ContactOutreachPage: React.FC<ContactOutreachPageProps> = ({
  companyKey,
  contactId,
  opportunityId,
  onBackToCompany,
  onBackToDirectory,
}) => {
  const [contact, setContact] = useState<DiscoveredContact | null>(null);
  const [outreach, setOutreach] = useState<OutreachMessage | null>(null);
  const [resumes, setResumes] = useState<TailoredResumeDTO[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Email Composer Form State
  const [subject, setSubject] = useState<string>('');
  const [body, setBody] = useState<string>('');
  const [selectedResumeId, setSelectedResumeId] = useState<string>('');

  // Operational State
  const [isAiModalOpen, setIsAiModalOpen] = useState<boolean>(false);
  const [isGeneratingAi, setIsGeneratingAi] = useState<boolean>(false);
  const [isSavingDraft, setIsSavingDraft] = useState<boolean>(false);
  const [isSending, setIsSending] = useState<boolean>(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error' | 'warning'; message: string } | null>(null);
  const [gmailStatus, setGmailStatus] = useState<{ connected: boolean; email?: string } | null>(null);
  const [copied, setCopied] = useState<boolean>(false);

  const fetchContactAndOutreach = async () => {
    try {
      setLoading(true);
      setError(null);

      // 1. Fetch Contact Details
      const contactsRes = await fetchWithAuth(`/api/v1/opportunities/${opportunityId}/contacts`);
      if (contactsRes.ok) {
        const rawContacts = await contactsRes.json();
        const contactsList: DiscoveredContact[] = Array.isArray(rawContacts)
          ? rawContacts
          : Array.isArray(rawContacts.contacts)
          ? rawContacts.contacts
          : [];
        const found = contactsList.find((c) => c.id === contactId);
        if (found) {
          setContact(found);
          // Set initial default subject if empty
          if (!subject) {
            setSubject(`Regarding ${found.companyName} Engineering Opportunities — Inquiry`);
          }
        }
      }

      // 2. Fetch Active Outreach Draft if any
      const outreachRes = await fetchWithAuth(
        `/api/v1/opportunities/${opportunityId}/contacts/${contactId}/outreach`
      );
      if (outreachRes.ok) {
        const draft: OutreachMessage | null = await outreachRes.json();
        if (draft) {
          setOutreach(draft);
          setSubject(draft.subject || '');
          setBody(draft.body || '');
          if (draft.resumeAttachmentId) {
            setSelectedResumeId(draft.resumeAttachmentId);
          }
        }
      }

      // 3. Fetch Candidate Resumes for Attachment
      const resumesRes = await fetchWithAuth('/api/v1/resumes');
      if (resumesRes.ok) {
        const allResumes: TailoredResumeDTO[] = await resumesRes.json();
        setResumes(allResumes);
      }

      // 4. Fetch Gmail OAuth Status
      const gmailRes = await fetchWithAuth('/api/v1/auth/gmail/status');
      if (gmailRes.ok) {
        const statusData = await gmailRes.json();
        setGmailStatus({
          connected: statusData.connected || false,
          email: statusData.gmailAddress || undefined,
        });
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error loading contact information.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (opportunityId && contactId) {
      fetchContactAndOutreach();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opportunityId, contactId]);

  // Section D: Strict 8-Step Flow - Confirmed AI Generation
  const handleConfirmAiGeneration = async () => {
    setIsAiModalOpen(false);
    try {
      setIsGeneratingAi(true);
      setFeedback(null);

      const res = await fetchWithAuth(
        `/api/v1/opportunities/${opportunityId}/contacts/${contactId}/outreach/generate`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tone: 'professional',
            resumeAttachmentId: selectedResumeId || undefined,
          }),
        }
      );

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error((errData && errData.detail) || `AI Generation failed (${res.status})`);
      }

      const generated: OutreachMessage = await res.json();
      setOutreach(generated);
      // Insert AI-generated draft into the editable composer for candidate review
      setSubject(generated.subject);
      setBody(generated.body);
      setFeedback({
        type: 'success',
        message: 'Tailored outreach draft generated with Truth-Lock grounding! Review and edit below.',
      });
    } catch (err: unknown) {
      setFeedback({
        type: 'error',
        message: err instanceof Error ? err.message : 'AI generation failed. Your draft was preserved.',
      });
    } finally {
      setIsGeneratingAi(false);
    }
  };

  // Section C: Save Draft Action
  const handleSaveDraft = async () => {
    if (!subject.trim() || !body.trim()) {
      setFeedback({ type: 'warning', message: 'Subject and message body cannot be empty.' });
      return;
    }

    try {
      setIsSavingDraft(true);
      setFeedback(null);

      const endpoint = outreach
        ? `/api/v1/opportunities/${opportunityId}/outreach/${outreach.id}`
        : `/api/v1/opportunities/${opportunityId}/contacts/${contactId}/outreach`;
      const method = outreach ? 'PUT' : 'POST';

      const res = await fetchWithAuth(endpoint, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subject,
          body,
          resumeAttachmentId: selectedResumeId || undefined,
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error((errData && errData.detail) || `Save draft failed (${res.status})`);
      }

      const saved: OutreachMessage = await res.json();
      setOutreach(saved);
      setFeedback({ type: 'success', message: 'Outreach draft saved successfully!' });
    } catch (err: unknown) {
      setFeedback({
        type: 'error',
        message: err instanceof Error ? err.message : 'Error saving draft.',
      });
    } finally {
      setIsSavingDraft(false);
    }
  };

  const handleCopyDraft = async () => {
    try {
      const draftText = `Subject: ${subject}\n\n${body}`;
      await navigator.clipboard.writeText(draftText);
      setCopied(true);
      setFeedback({ type: 'success', message: 'Outreach draft copied to clipboard!' });
      setTimeout(() => setCopied(false), 3000);
    } catch {
      setFeedback({ type: 'error', message: 'Failed to copy draft to clipboard.' });
    }
  };

  // Section C: Send via Gmail Action (Distinct from Draft Generation)
  const handleSendViaGmail = async () => {
    if (!outreach) {
      setFeedback({ type: 'warning', message: 'Please save your draft first before sending.' });
      return;
    }

    if (!contact?.email || !contact.email.trim()) {
      setFeedback({
        type: 'error',
        message: 'Sending blocked: No recipient email address available. Gmail dispatch requires a verified email address.',
      });
      return;
    }

    if (!gmailStatus?.connected) {
      setFeedback({
        type: 'warning',
        message: 'Gmail is not connected. Please connect your Gmail account in Settings before sending.',
      });
      return;
    }

    if (contact?.suppressionState === 'GLOBAL_STAKEHOLDER_SUPPRESSION' || contact?.doNotContact) {
      setFeedback({
        type: 'error',
        message: 'Sending blocked: Contact has explicitly opted out of communications.',
      });
      return;
    }

    if (contact?.suppressionState === 'JOB_SPECIFIC_SUPPRESSION') {
      setFeedback({
        type: 'error',
        message: 'Sending blocked: Candidate was rejected for this specific opportunity.',
      });
      return;
    }

    const confirmSend = window.confirm(
      `Send this outreach email to ${contact?.fullName} (${contact?.email}) via Gmail?`
    );
    if (!confirmSend) return;

    try {
      setIsSending(true);
      setFeedback(null);

      // Step 1: Approve draft if not yet approved
      if (outreach.status !== 'APPROVED') {
        const approveRes = await fetchWithAuth(
          `/api/v1/opportunities/${opportunityId}/outreach/${outreach.id}/approve`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ isApproved: true }),
          }
        );
        if (!approveRes.ok) {
          throw new Error('Failed to approve outreach draft for sending.');
        }
      }

      // Step 2: Send via Gmail
      const sendRes = await fetchWithAuth(
        `/api/v1/opportunities/${opportunityId}/outreach/${outreach.id}/send`,
        { method: 'POST' }
      );

      if (!sendRes.ok) {
        const errData = await sendRes.json().catch(() => ({}));
        throw new Error((errData && errData.detail) || `Send failed (${sendRes.status})`);
      }

      const sendResult: SendOutreachResponse = await sendRes.json();
      setOutreach((prev) => (prev ? { ...prev, status: 'SENT', sentAt: new Date().toISOString() } : prev));
      setFeedback({
        type: 'success',
        message: `Email successfully dispatched via Gmail! (Message ID: ${sendResult.gmailMessageId})`,
      });
    } catch (err: unknown) {
      setFeedback({
        type: 'error',
        message: err instanceof Error ? err.message : 'Error sending email via Gmail.',
      });
    } finally {
      setIsSending(false);
    }
  };

  const getEvidenceBadge = (classification: EmailEvidenceClassification) => {
    switch (classification) {
      case 'PROVIDER_VERIFIED':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
            <CheckCircle2 className="w-3.5 h-3.5" /> Provider Verified
          </span>
        );
      case 'PUBLICLY_LISTED':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-sky-500/10 text-sky-400 border border-sky-500/30">
            <Mail className="w-3.5 h-3.5" /> Publicly Listed
          </span>
        );
      case 'PATTERN_INFERRED':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-500/10 text-amber-400 border border-amber-500/30">
            <AlertTriangle className="w-3.5 h-3.5" /> Pattern Inferred (Unverified)
          </span>
        );
      case 'DOMAIN_MAIL_ENABLED':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-500/10 text-blue-400 border border-blue-500/30">
            <Globe className="w-3.5 h-3.5" /> Domain Mail Routing
          </span>
        );
      case 'UNVERIFIED':
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-neutral-800 text-neutral-400 border border-neutral-700">
            <AlertTriangle className="w-3.5 h-3.5 text-neutral-500" /> Unverified
          </span>
        );
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center p-16 space-y-4">
        <Loader2 className="w-8 h-8 animate-spin text-emerald-400" />
        <p className="text-xs text-neutral-400">Loading contact details and composer...</p>
      </div>
    );
  }

  if (error || !contact) {
    return (
      <div className="p-8 rounded-2xl bg-rose-500/10 border border-rose-500/20 text-center space-y-3">
        <AlertTriangle className="w-8 h-8 text-rose-400 mx-auto" />
        <h3 className="text-sm font-semibold text-rose-200">Unable to Load Contact</h3>
        <p className="text-xs text-rose-300">{error || 'Contact not found'}</p>
        <button
          onClick={onBackToCompany}
          className="px-4 py-2 bg-[#1A1A1A] hover:bg-[#222222] border border-white/10 rounded-xl text-xs font-semibold text-white transition"
        >
          Return to Company Profile
        </button>
      </div>
    );
  }

  const isSuppressed =
    contact.suppressionState === 'GLOBAL_STAKEHOLDER_SUPPRESSION' ||
    contact.suppressionState === 'JOB_SPECIFIC_SUPPRESSION' ||
    contact.doNotContact;

  return (
    <div className="space-y-6 animate-in fade-in duration-150">
      {/* Breadcrumbs */}
      <nav aria-label="Breadcrumbs" className="flex items-center gap-2 text-xs text-neutral-400">
        <button
          onClick={onBackToDirectory}
          className="hover:text-white transition flex items-center gap-1 font-medium"
        >
          <Building2 className="w-3.5 h-3.5 text-emerald-400" />
          Companies & Contacts
        </button>
        <span className="text-neutral-600">/</span>
        <button onClick={onBackToCompany} className="hover:text-white transition font-medium">
          {contact.companyName || companyKey}
        </button>
        <span className="text-neutral-600">/</span>
        <span className="text-white font-semibold">{contact.fullName}</span>
      </nav>

      {/* Operational Feedback Banner */}
      {feedback && (
        <div
          role="status"
          className={`p-4 rounded-xl border text-xs flex items-start justify-between gap-3 ${
            feedback.type === 'success'
              ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
              : feedback.type === 'warning'
              ? 'bg-amber-500/10 border-amber-500/30 text-amber-300'
              : 'bg-rose-500/10 border-rose-500/30 text-rose-300'
          }`}
        >
          <div className="flex items-start gap-2.5">
            {feedback.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
            ) : (
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            )}
            <span>{feedback.message}</span>
          </div>
          <button
            onClick={() => setFeedback(null)}
            className="text-neutral-400 hover:text-white text-xs"
          >
            ✕
          </button>
        </div>
      )}

      {/* Wireframe 3 - Card 1: Contact Details */}
      <div className="p-6 md:p-8 rounded-2xl bg-[#141414] border border-white/10 space-y-5 shadow-sm">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-white/5 pb-4">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-2xl bg-[#1E1E1E] border border-white/10 flex items-center justify-center text-emerald-400 text-lg font-bold">
              {contact.fullName.charAt(0)}
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight text-white">{contact.fullName}</h1>
              <p className="text-xs text-neutral-400">
                {contact.roleTitle} • <span className="text-neutral-300 font-medium">{contact.companyName}</span>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {getEvidenceBadge(contact.emailClassification)}
            <button
              onClick={onBackToCompany}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-neutral-300 border border-white/10 text-xs font-medium transition"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              Company Profile
            </button>
          </div>
        </div>

        {/* Contact Metadata Details */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs text-neutral-300">
          <div className="p-3 bg-neutral-900/40 rounded-xl border border-white/5 space-y-1">
            <span className="text-[10px] uppercase font-bold text-neutral-500">Direct Email</span>
            <div className="font-mono text-white truncate">{contact.email}</div>
          </div>

          <div className="p-3 bg-neutral-900/40 rounded-xl border border-white/5 space-y-1">
            <span className="text-[10px] uppercase font-bold text-neutral-500">Tier / Position</span>
            <div className="text-white capitalize">{contact.stakeholderTier?.toLowerCase() || 'Other'}</div>
          </div>

          <div className="p-3 bg-neutral-900/40 rounded-xl border border-white/5 space-y-1">
            <span className="text-[10px] uppercase font-bold text-neutral-500">Confidence Score</span>
            <div className="text-white">{Math.round((contact.confidenceScore ?? 1.0) * 100)}% Match Evidence</div>
          </div>
        </div>

        {/* Suppression Warning Banner */}
        {contact.suppressionState === 'GLOBAL_STAKEHOLDER_SUPPRESSION' && (
          <div className="p-3.5 bg-rose-500/10 border border-rose-500/30 rounded-xl flex items-start gap-2.5 text-xs text-rose-300">
            <ShieldAlert className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
            <div>
              <span className="font-semibold">Global Opt-Out Active:</span> This stakeholder explicitly requested not to be contacted. All future sending is blocked.
            </div>
          </div>
        )}

        {contact.suppressionState === 'JOB_SPECIFIC_SUPPRESSION' && (
          <div className="p-3.5 bg-amber-500/10 border border-amber-500/30 rounded-xl flex items-start gap-2.5 text-xs text-amber-300">
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
            <div>
              <span className="font-semibold">Role Rejection (Job-Specific):</span> Candidate application rejected for this specific opportunity. Sending is paused for this role.
            </div>
          </div>
        )}
      </div>

      {/* Wireframe 3 - Card 2: Email Composer */}
      <div className="p-6 md:p-8 rounded-2xl bg-[#141414] border border-white/10 space-y-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/5 pb-4">
          <div className="space-y-1">
            <h2 className="text-base font-bold text-white flex items-center gap-2">
              <Mail className="w-4 h-4 text-emerald-400" />
              Email Outreach Composer
            </h2>
            <p className="text-xs text-neutral-400">
              Draft a personalized, high-conversion message or let Truth-Lock generate factual outreach.
            </p>
          </div>

          {/* Action Bar Right: Write with AI Button */}
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setIsAiModalOpen(true)}
              disabled={isGeneratingAi || isSuppressed}
              className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 rounded-xl text-xs font-semibold transition disabled:opacity-50"
            >
              {isGeneratingAi ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Synthesizing Truth-Lock Draft...
                </>
              ) : (
                <>
                  <Sparkles className="w-3.5 h-3.5" />
                  Write with AI
                </>
              )}
            </button>
          </div>
        </div>

        {/* Composer Form Fields */}
        <div className="space-y-4">
          {/* Recipient Field (Pre-filled with Safety Guards) */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-neutral-300">Recipient</label>
              {contact.contactType === 'ORGANIZATION_CHANNEL' && (
                <span className="text-[10px] font-bold text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/20">
                  Organization Channel ({contact.channelPurpose?.replace(/_/g, ' ') || 'Shared Mailbox'})
                </span>
              )}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-2.5 rounded-xl bg-neutral-900/60 border border-white/5 text-xs text-neutral-300">
              <div className="flex items-center gap-2 font-mono">
                <span className="text-white font-medium font-sans">{contact.fullName}</span>
                {contact.email ? (
                  <span className="text-neutral-400">&lt;{contact.email}&gt;</span>
                ) : (
                  <span className="text-sky-400 font-sans text-xs italic">
                    (Profile-Only • No direct email address discovered)
                  </span>
                )}
              </div>
              {contact.linkedinUrl && (
                <a
                  href={contact.linkedinUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-[11px] text-sky-400 hover:text-sky-300 font-medium bg-sky-500/10 px-2.5 py-1 rounded-lg border border-sky-500/20 hover:bg-sky-500/20 transition"
                >
                  Open LinkedIn Profile <ExternalLink className="w-3 h-3" />
                </a>
              )}
            </div>
            {!contact.email && (
              <p className="text-[11px] text-amber-400/90 flex items-center gap-1 mt-1">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                Gmail transmission is disabled because no deliverable email address was found. Use &quot;Copy Draft&quot; below to message this contact manually via LinkedIn or another public profile.
              </p>
            )}
          </div>

          {/* Subject Line Input */}
          <div className="space-y-1.5">
            <label htmlFor="outreach-subject" className="text-xs font-semibold text-neutral-300">
              Subject Line
            </label>
            <input
              id="outreach-subject"
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="e.g. Regarding Senior Backend Engineering Opportunity"
              className="w-full px-3.5 py-2 bg-neutral-900 border border-white/10 rounded-xl text-xs text-white placeholder:text-neutral-500 focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/50 transition"
            />
          </div>

          {/* Full-width Message Textarea */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label htmlFor="outreach-body" className="text-xs font-semibold text-neutral-300">
                Email Message Body
              </label>
              {outreach?.truthLockReport && (
                <span className="text-[10px] text-emerald-400 flex items-center gap-1 font-mono">
                  <ShieldCheck className="w-3 h-3" /> Truth-Lock Verified ({outreach.truthLockReport.passedChecks} checks passed)
                </span>
              )}
            </div>
            <textarea
              id="outreach-body"
              rows={10}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Write your personalized outreach note or click 'Write with AI' above to generate grounded outreach..."
              className="w-full px-3.5 py-3 bg-neutral-900 border border-white/10 rounded-xl text-xs text-white placeholder:text-neutral-500 focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/50 transition font-sans leading-relaxed"
            />
          </div>

          {/* Resume Attachment Control */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 bg-neutral-900/40 rounded-xl border border-white/5">
            <div className="flex items-center gap-2.5">
              <Paperclip className="w-4 h-4 text-emerald-400 shrink-0" />
              <div>
                <div className="text-xs font-semibold text-white">Attach Verified Resume Asset</div>
                <div className="text-[11px] text-neutral-400">
                  Select a Master Profile export or tailored PDF package.
                </div>
              </div>
            </div>

            <select
              value={selectedResumeId}
              onChange={(e) => setSelectedResumeId(e.target.value)}
              className="px-3 py-1.5 bg-[#141414] border border-white/10 rounded-lg text-xs text-white focus:outline-none focus:border-emerald-500/50"
            >
              <option value="">No attachment (Text only)</option>
              {resumes.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.jobTitle} ({r.jobCompany}) — PDF Export
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Composer Actions: Save Draft vs Copy Draft vs Send via Gmail */}
        <div className="space-y-3 pt-4 border-t border-white/5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="text-[11px] text-neutral-400 flex items-center gap-2">
              <Clock className="w-3.5 h-3.5 text-neutral-500" />
              <span>
                {outreach?.sentAt
                  ? `Dispatched on ${new Date(outreach.sentAt).toLocaleString()}`
                  : outreach?.updatedAt
                  ? `Last saved ${new Date(outreach.updatedAt).toLocaleTimeString()}`
                  : 'Unsaved draft'}
              </span>
            </div>

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={handleCopyDraft}
                disabled={!body.trim()}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-white/5 hover:bg-white/10 text-neutral-300 border border-white/10 rounded-xl text-xs font-semibold transition disabled:opacity-50"
              >
                {copied ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                {copied ? 'Copied Draft' : 'Copy Draft'}
              </button>

              <button
                type="button"
                onClick={handleSaveDraft}
                disabled={isSavingDraft || isSuppressed}
                className="inline-flex items-center gap-1.5 px-4 py-2 bg-white/5 hover:bg-white/10 text-neutral-300 border border-white/10 rounded-xl text-xs font-semibold transition disabled:opacity-50"
              >
                {isSavingDraft ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                Save Draft
              </button>

              <button
                type="button"
                onClick={handleSendViaGmail}
                disabled={isSending || isSuppressed || !body.trim() || !contact.email || !contact.email.trim()}
                title={!contact.email ? 'Sending via Gmail is disabled because contact has no deliverable email' : undefined}
                className="inline-flex items-center gap-1.5 px-5 py-2 bg-emerald-500 hover:bg-emerald-600 text-black font-semibold rounded-xl text-xs shadow-lg shadow-emerald-500/10 transition disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isSending ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    Sending via Gmail...
                  </>
                ) : (
                  <>
                    <Send className="w-3.5 h-3.5" />
                    Send via Gmail
                  </>
                )}
              </button>
            </div>
          </div>

          <p className="text-[10px] text-neutral-500 italic text-right">
            * JobFinder operates under strict safety protocols and does not automate messaging on third-party networks such as LinkedIn.
          </p>
        </div>
      </div>


      {/* Phase 5 Thread & Inbound Reply History */}
      {outreach && (outreach.status === 'SENT' || outreach.gmailThreadId) && (
        <div className="p-6 md:p-8 rounded-2xl bg-[#141414] border border-white/10 space-y-4">
          <h2 className="text-base font-bold text-white flex items-center gap-2">
            <Clock className="w-4 h-4 text-emerald-400" />
            Conversation Thread & Reply History
          </h2>
          <ThreadTimeline
            opportunityId={opportunityId}
            outreachId={outreach.id}
            onReplyUpdated={() => {
              fetchContactAndOutreach();
            }}
          />
        </div>
      )}

      {/* Strict 8-Step AI Draft Confirmation Modal */}
      <AiDraftConfirmationModal
        isOpen={isAiModalOpen}
        onConfirm={handleConfirmAiGeneration}
        onCancel={() => setIsAiModalOpen(false)}
        hasExistingText={Boolean(body.trim())}
      />
    </div>
  );
};
