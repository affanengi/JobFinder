import React, { useState, useEffect } from 'react';
import {
  RefreshCw,
  MessageSquare,
  AlertTriangle,
  CheckCircle2,
  HelpCircle,
  XCircle,
  ExternalLink,
  ShieldAlert,
  Loader2,
  Calendar,
  Send,
  ChevronDown,
  ChevronUp,
  ShieldCheck,
} from 'lucide-react';
import { fetchWithAuth } from '../../lib/api';
import {
  OutreachReply,
  ReplyIntentLabel,
  ThreadTimelineResponse,
  SyncRepliesResponse,
} from '../../types/outreach';

interface ThreadTimelineProps {
  opportunityId: string;
  outreachId: string;
  onClose?: () => void;
  onReplyUpdated?: (reply: OutreachReply) => void;
}

export const ThreadTimeline: React.FC<ThreadTimelineProps> = ({
  opportunityId,
  outreachId,
  onReplyUpdated,
}) => {
  const [loading, setLoading] = useState<boolean>(true);
  const [syncing, setSyncing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [timeline, setTimeline] = useState<ThreadTimelineResponse | null>(null);
  const [expandedOutreach, setExpandedOutreach] = useState<boolean>(false);

  // Manual review state
  const [editingReplyId, setEditingReplyId] = useState<string | null>(null);
  const [reviewIntent, setReviewIntent] = useState<ReplyIntentLabel>('POSITIVE_INTEREST');
  const [reviewNotes, setReviewNotes] = useState<string>('');
  const [savingReview, setSavingReview] = useState<boolean>(false);

  const fetchTimeline = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetchWithAuth(
        `/opportunities/${opportunityId}/outreach/${outreachId}/timeline`
      );
      if (!res.ok) {
        throw new Error(`Failed to load thread timeline (${res.status})`);
      }
      const data: ThreadTimelineResponse = await res.json();
      setTimeline(data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to fetch timeline.');
    } finally {
      setLoading(false);
    }
  };

  const syncReplies = async () => {
    try {
      setSyncing(true);
      setError(null);
      const res = await fetchWithAuth(
        `/opportunities/${opportunityId}/outreach/${outreachId}/sync-replies`,
        { method: 'POST' }
      );
      if (!res.ok) {
        throw new Error(`Sync failed (${res.status})`);
      }
      const data: SyncRepliesResponse = await res.json();
      if (!data.hasReadPermission) {
        setError(data.message);
      }
      // Refresh timeline after sync
      await fetchTimeline();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error synchronizing replies.');
    } finally {
      setSyncing(false);
    }
  };

  useEffect(() => {
    if (opportunityId && outreachId) {
      fetchTimeline();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opportunityId, outreachId]);

  const handleManualReviewSubmit = async (replyId: string) => {
    try {
      setSavingReview(true);
      const res = await fetchWithAuth(
        `/opportunities/${opportunityId}/outreach/${outreachId}/replies/${replyId}/manual-review`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            intent: reviewIntent,
            notes: reviewNotes,
          }),
        }
      );
      if (!res.ok) {
        throw new Error(`Manual review failed (${res.status})`);
      }
      const updatedReply: OutreachReply = await res.json();
      if (timeline) {
        setTimeline({
          ...timeline,
          replies: timeline.replies.map((r) => (r.id === replyId ? updatedReply : r)),
        });
      }
      setEditingReplyId(null);
      setReviewNotes('');
      if (onReplyUpdated) {
        onReplyUpdated(updatedReply);
      }
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Failed to submit manual review.');
    } finally {
      setSavingReview(false);
    }
  };

  const getIntentBadge = (intent: ReplyIntentLabel) => {
    switch (intent) {
      case 'POSITIVE_INTEREST':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
            <CheckCircle2 className="w-3.5 h-3.5" /> Positive Interest
          </span>
        );
      case 'INFORMATION_REQUEST':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold bg-sky-500/10 text-sky-400 border border-sky-500/30">
            <MessageSquare className="w-3.5 h-3.5" /> Info Request
          </span>
        );
      case 'REFERRAL_CONFIRMED':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold bg-purple-500/10 text-purple-400 border border-purple-500/30">
            <ShieldCheck className="w-3.5 h-3.5" /> Referral Confirmed
          </span>
        );
      case 'JOB_REJECTION':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/30">
            <AlertTriangle className="w-3.5 h-3.5" /> Role Rejected
          </span>
        );
      case 'DO_NOT_CONTACT':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold bg-rose-500/10 text-rose-400 border border-rose-500/30">
            <XCircle className="w-3.5 h-3.5" /> Opt-Out (Do Not Contact)
          </span>
        );
      case 'NEEDS_MANUAL_REVIEW':
      default:
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold bg-yellow-500/10 text-yellow-400 border border-yellow-500/30">
            <HelpCircle className="w-3.5 h-3.5" /> Needs Review
          </span>
        );
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center p-12 text-muted space-y-3">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
        <p className="text-sm font-medium">Loading thread timeline...</p>
      </div>
    );
  }

  if (error && !timeline) {
    return (
      <div className="p-6 bg-rose-500/10 border border-rose-500/20 rounded-xl text-center space-y-3">
        <AlertTriangle className="w-8 h-8 text-rose-400 mx-auto" />
        <p className="text-sm text-rose-300 font-medium">{error}</p>
        <button
          onClick={fetchTimeline}
          className="px-4 py-2 bg-surface hover:bg-surface-hover border border-border text-xs font-semibold rounded-lg text-foreground transition"
        >
          Retry
        </button>
      </div>
    );
  }

  if (!timeline) return null;

  const { outreach, replies, hasReadPermission } = timeline;

  return (
    <div className="space-y-6 text-foreground font-sans">
      {/* Top Controls Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 p-4 bg-surface-subtle border border-border rounded-xl">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-foreground">
            Thread Activity:
          </span>
          <span className="px-2 py-0.5 text-xs font-medium bg-primary/10 text-primary border border-primary/20 rounded-full">
            {replies.length} {replies.length === 1 ? 'Reply' : 'Replies'}
          </span>
          {outreach.lastReplyIntent && (
            <div className="ml-2">{getIntentBadge(outreach.lastReplyIntent)}</div>
          )}
        </div>

        <button
          onClick={syncReplies}
          disabled={syncing}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-primary/10 hover:bg-primary/20 text-primary border border-primary/30 rounded-lg text-xs font-semibold transition disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} />
          {syncing ? 'Checking Gmail...' : 'Check for Replies'}
        </button>
      </div>

      {/* Gmail Read Permission Banner if not granted */}
      {!hasReadPermission && (
        <div className="p-4 bg-amber-500/10 border border-amber-500/30 rounded-xl flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
          <div className="space-y-1 text-xs">
            <h4 className="font-semibold text-amber-300">
              Gmail Read Permission Needed for Automatic Reply Tracking
            </h4>
            <p className="text-amber-200/80 leading-relaxed">
              JobFinder requires read-only permission (<code>gmail.readonly</code>) to monitor replies to this outreach thread.
              Without this permission, JobFinder cannot detect responses from candidates or hiring managers.
            </p>
            <div className="pt-2">
              <a
                href="/api/v1/auth/gmail/authorize?include_read=true"
                className="inline-flex items-center gap-1 px-3 py-1.5 bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 rounded-lg font-semibold transition"
              >
                Grant Read Access <ExternalLink className="w-3 h-3 ml-1" />
              </a>
            </div>
          </div>
        </div>
      )}

      {/* Sent Message Summary (Collapsible) */}
      <div className="border border-border rounded-xl bg-surface overflow-hidden">
        <div
          onClick={() => setExpandedOutreach(!expandedOutreach)}
          className="p-4 bg-surface-subtle flex items-center justify-between cursor-pointer hover:bg-surface-hover/50 transition select-none"
        >
          <div className="flex items-center gap-2">
            <Send className="w-4 h-4 text-primary" />
            <span className="text-xs font-semibold text-foreground">
              Sent Outreach: <span className="font-medium text-muted">{outreach.subject}</span>
            </span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-muted flex items-center gap-1">
              <Calendar className="w-3.5 h-3.5" />
              {outreach.sentAt ? new Date(outreach.sentAt).toLocaleString() : 'Sent'}
            </span>
            {expandedOutreach ? (
              <ChevronUp className="w-4 h-4 text-muted" />
            ) : (
              <ChevronDown className="w-4 h-4 text-muted" />
            )}
          </div>
        </div>

        {expandedOutreach && (
          <div className="p-4 space-y-3 border-t border-border bg-surface text-xs">
            <div className="text-muted">
              To: <span className="text-foreground font-medium">{outreach.recipientName}</span>{' '}
              &lt;{outreach.recipientEmail}&gt;
            </div>
            <div className="p-3 bg-surface-subtle border border-border rounded-lg text-foreground whitespace-pre-wrap font-mono text-[11px] leading-relaxed">
              {outreach.body}
            </div>
          </div>
        )}
      </div>

      {/* Inbound Replies Timeline */}
      <div className="space-y-4">
        <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <MessageSquare className="w-4 h-4 text-primary" />
          Inbound Replies ({replies.length})
        </h3>

        {replies.length === 0 ? (
          <div className="p-8 text-center border border-dashed border-border rounded-xl bg-surface-subtle/50 space-y-2">
            <MessageSquare className="w-8 h-8 text-muted mx-auto opacity-40" />
            <p className="text-sm font-medium text-muted">No replies detected yet.</p>
            <p className="text-xs text-muted/70 max-w-sm mx-auto">
              When {outreach.recipientName} replies to this thread in Gmail, their message will be safely ingested, classified, and displayed here.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {replies.map((reply) => (
              <div
                key={reply.id}
                className="p-5 border border-border rounded-xl bg-surface space-y-3 relative transition hover:border-border-hover"
              >
                {/* Header */}
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 pb-3">
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center text-primary text-xs font-bold">
                      {reply.senderName ? reply.senderName[0].toUpperCase() : 'R'}
                    </div>
                    <div>
                      <div className="text-xs font-semibold text-foreground">
                        {reply.senderName || reply.senderEmail}
                      </div>
                      <div className="text-[11px] text-muted">{reply.senderEmail}</div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    {getIntentBadge(reply.intent)}
                    <span className="text-[11px] text-muted flex items-center gap-1">
                      <Calendar className="w-3 h-3" />
                      {new Date(reply.receivedAt).toLocaleTimeString([], {
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                  </div>
                </div>

                {/* Suppression Warning Banner */}
                {reply.suppressionState === 'GLOBAL_STAKEHOLDER_SUPPRESSION' && (
                  <div className="p-3 bg-rose-500/10 border border-rose-500/30 rounded-lg flex items-start gap-2 text-xs text-rose-300">
                    <ShieldAlert className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                    <div>
                      <span className="font-semibold">Global Opt-Out Active:</span> Contact has explicitly requested no further communications. All future sending is blocked.
                    </div>
                  </div>
                )}

                {reply.suppressionState === 'JOB_SPECIFIC_SUPPRESSION' && (
                  <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg flex items-start gap-2 text-xs text-amber-300">
                    <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                    <div>
                      <span className="font-semibold">Role Rejection (Job-Specific):</span> Outreach for this specific vacancy is stopped. Contact remains eligible for other job opportunities.
                    </div>
                  </div>
                )}

                {/* AI Rationale & Quote */}
                {reply.intentRationale && (
                  <div className="p-3 bg-surface-subtle border border-border/60 rounded-lg text-xs space-y-1">
                    <span className="text-[10px] uppercase font-bold tracking-wider text-muted">
                      AI Intent Rationale
                    </span>
                    <p className="text-foreground/90 leading-relaxed font-sans">
                      {reply.intentRationale}
                    </p>
                  </div>
                )}

                {/* Body Text */}
                <div className="p-3.5 bg-surface-subtle border border-border/80 rounded-lg text-xs font-mono text-foreground/90 whitespace-pre-wrap leading-relaxed max-h-60 overflow-y-auto">
                  {reply.bodyText || reply.snippet}
                </div>

                {/* Manual Review Controls */}
                <div className="pt-2 flex items-center justify-between">
                  <span className="text-[11px] text-muted">
                    {reply.isManuallyReviewed
                      ? `Manually Reviewed ${reply.manualNotes ? `("${reply.manualNotes}")` : ''}`
                      : 'AI Classified'}
                  </span>

                  {editingReplyId !== reply.id ? (
                    <button
                      onClick={() => {
                        setEditingReplyId(reply.id);
                        setReviewIntent(reply.intent);
                        setReviewNotes(reply.manualNotes || '');
                      }}
                      className="text-xs text-primary hover:underline font-medium"
                    >
                      {reply.isManuallyReviewed ? 'Edit Review' : 'Manual Review / Reclassify'}
                    </button>
                  ) : (
                    <div className="w-full mt-3 p-3.5 bg-surface-subtle border border-border rounded-lg space-y-3">
                      <div className="text-xs font-semibold text-foreground">
                        Manual Intent Override
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {(
                          [
                            'POSITIVE_INTEREST',
                            'INFORMATION_REQUEST',
                            'REFERRAL_CONFIRMED',
                            'JOB_REJECTION',
                            'DO_NOT_CONTACT',
                            'NEEDS_MANUAL_REVIEW',
                          ] as ReplyIntentLabel[]
                        ).map((opt) => (
                          <button
                            key={opt}
                            type="button"
                            onClick={() => setReviewIntent(opt)}
                            className={`px-2.5 py-1.5 rounded-lg text-xs font-medium border text-left transition ${
                              reviewIntent === opt
                                ? 'bg-primary/20 text-primary border-primary'
                                : 'bg-surface border-border text-muted hover:text-foreground'
                            }`}
                          >
                            {opt}
                          </button>
                        ))}
                      </div>

                      <div>
                        <input
                          type="text"
                          value={reviewNotes}
                          onChange={(e) => setReviewNotes(e.target.value)}
                          placeholder="Optional notes or context..."
                          className="w-full px-3 py-1.5 bg-surface border border-border rounded-lg text-xs text-foreground placeholder:text-muted focus:outline-none focus:border-primary"
                        />
                      </div>

                      <div className="flex items-center justify-end gap-2 pt-1">
                        <button
                          type="button"
                          onClick={() => setEditingReplyId(null)}
                          className="px-3 py-1.5 text-xs text-muted hover:text-foreground font-medium"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          disabled={savingReview}
                          onClick={() => handleManualReviewSubmit(reply.id)}
                          className="px-3 py-1.5 bg-primary text-white text-xs font-semibold rounded-lg hover:bg-primary-hover transition disabled:opacity-50"
                        >
                          {savingReview ? 'Saving...' : 'Save Override'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
