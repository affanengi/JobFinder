import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Activity,
  RefreshCw,
  Filter,
  CheckCircle2,
  XCircle,
  ChevronLeft,
  ChevronRight,
  Layers,
  Clock,
  Zap,
  ShieldCheck,
  AlertTriangle,
  Copy,
  Check,
  HelpCircle,
} from 'lucide-react';
import { fetchWithAuth } from '../lib/api';
import { Modal } from '../components/ui/Modal';
import { useAuth } from '../context/AuthContext';
import { AuthRequiredEmptyState } from '../components/common/AuthRequiredEmptyState';

export interface HopDetail {
  provider: string;
  model: string;
  credential_id: string;
  status: 'SUCCESS' | 'FAILED';
  latency_ms: number;
  error?: string;
}

export interface ExecutionItem {
  executionId: string;
  userId: string;
  operationId?: string | null;
  task: string;
  providerUsed: string;
  modelUsed: string;
  credentialIdUsed: string;
  success: boolean;
  latencyMs: number;
  fallbackLevel: number;
  hopsCount: number;
  failureCategory?: string | null;
  costTier: string;
  preferenceConfigured?: boolean | null;
  preferredCredentialId?: string | null;
  preferredRouteSkipped?: boolean;
  preferredRouteSkipReason?: string | null;
  preferenceStatus?: string;
  executionResult?: string;
  routeClassification?: string;
  executionOutcome?: string;
  traceStatus?: string;
  attemptedHops?: HopDetail[] | null;
  timestamp: string;
}

export interface TelemetrySummary {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  indeterminateRequests?: number;
  successRate: number | null;
  averageLatencyMs: number | null;
  fallbackCount: number;
  providerDistribution: Record<string, number>;
  taskDistribution: Record<string, number>;
}

export interface CredentialMeta {
  id: string;
  friendlyName: string;
  provider: string;
}

interface CredentialApiItem {
  id?: string;
  credentialId?: string;
  friendlyName?: string;
  name?: string;
  provider: string;
}

const TASK_OPTIONS = [
  { value: '', label: 'All Tasks' },
  { value: 'resume_tailoring', label: 'Resume Tailoring' },
  { value: 'cover_letter_gen', label: 'Cover Letter Generation' },
  { value: 'dual_artifact_gen', label: 'Dual Artifact Generation' },
  { value: 'ats_bullet_rewrite', label: 'ATS Bullet Rewrite' },
  { value: 'ats_bulk_rewrite', label: 'ATS Bulk Rewrite' },
  { value: 'ats_scan_analysis', label: 'ATS Scan' },
  { value: 'qa_copilot', label: 'QA Copilot' },
  { value: 'resume_parsing', label: 'Resume Parsing' },
  { value: 'job_ingestion', label: 'Job Ingestion' },
  { value: 'job_analysis', label: 'Job Analysis' },
];

const PROVIDER_OPTIONS = [
  { value: '', label: 'All Providers' },
  { value: 'gemini', label: 'Google Gemini' },
  { value: 'openrouter', label: 'OpenRouter' },
  { value: 'groq', label: 'Groq' },
];

export const RecentActivitiesPage: React.FC = () => {
  const { user } = useAuth();
  const [summary, setSummary] = useState<TelemetrySummary | null>(null);
  const [credentials, setCredentials] = useState<CredentialMeta[]>([]);
  const [executions, setExecutions] = useState<ExecutionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [tableError, setTableError] = useState<string | null>(null);
  const [summaryError, setSummaryError] = useState<string | null>(null);

  // Filters
  const [selectedTask, setSelectedTask] = useState<string>('');
  const [selectedProvider, setSelectedProvider] = useState<string>('');

  // Cursor-based pagination state
  const [pageIndex, setPageIndex] = useState<number>(1);
  const [cursorStack, setCursorStack] = useState<(string | null)[]>([null]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState<boolean>(false);

  // Hop Trace Modal
  const [selectedItemForTrace, setSelectedItemForTrace] = useState<ExecutionItem | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Race condition protection & abort controllers
  const activeRequestIdRef = useRef<number>(0);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Copy helper
  const handleCopy = (text: string, label: string) => {
    navigator.clipboard?.writeText(text);
    setCopiedId(label);
    setTimeout(() => setCopiedId(null), 2000);
  };

  // Load credentials once to map friendly names
  useEffect(() => {
    if (!user) {
      setCredentials([]);
      return;
    }
    fetchWithAuth('/api/v1/ai/credentials')
      .then((res) => (res.ok ? res.json() : []))
      .then((data: CredentialApiItem[]) => {
        if (Array.isArray(data)) {
          setCredentials(
            data.map((c) => ({
              id: c.credentialId || c.id || 'unknown',
              friendlyName: c.friendlyName || c.name || 'Unnamed Key',
              provider: c.provider,
            }))
          );
        }
      })
      .catch(() => {});
  }, [user]);

  // Fetch Summary with filter synchronization
  const fetchSummary = useCallback(
    async (signal?: AbortSignal, currentReqId?: number) => {
      if (!user) {
        setSummary(null);
        setSummaryError(null);
        return;
      }
      setSummaryError(null);
      try {
        const params = new URLSearchParams();
        if (selectedTask) params.set('task', selectedTask);
        if (selectedProvider) params.set('provider', selectedProvider);

        const url = `/api/v1/ai/telemetry${params.toString() ? `?${params.toString()}` : ''}`;
        const res = await fetchWithAuth(url, { signal });
        if (currentReqId !== undefined && currentReqId !== activeRequestIdRef.current) return;

        if (res.ok) {
          const data = await res.json();
          // Safe unboxing of TelemetryResponse.summary
          setSummary(data.summary ?? data);
        } else {
          setSummaryError(`Summary metrics unavailable (HTTP ${res.status})`);
        }
      } catch (e: unknown) {
        if (e instanceof Error && e.name === 'AbortError') return;
        if (currentReqId !== undefined && currentReqId !== activeRequestIdRef.current) return;
        setSummaryError('Failed to load activity summary metrics');
      }
    },
    [user, selectedTask, selectedProvider]
  );

  // Fetch Paginated History
  const fetchHistory = useCallback(
    async (cursor: string | null = null, isRefresh = false, signal?: AbortSignal, currentReqId?: number) => {
      if (!user) {
        setExecutions([]);
        setTableError(null);
        setLoading(false);
        setRefreshing(false);
        return;
      }
      if (isRefresh) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }
      setTableError(null);

      try {
        const params = new URLSearchParams({ limit: '15' });
        if (cursor) params.set('cursor', cursor);
        if (selectedTask) params.set('task', selectedTask);
        if (selectedProvider) params.set('provider', selectedProvider);

        const res = await fetchWithAuth(`/api/v1/ai/telemetry/history?${params.toString()}`, { signal });
        if (currentReqId !== undefined && currentReqId !== activeRequestIdRef.current) return;

        if (!res.ok) {
          throw new Error(`Failed to load AI activity history: HTTP ${res.status}`);
        }

        const data = await res.json();
        setExecutions(data.items || []);
        // Reconcile camelCase and snake_case cursor pagination contracts
        setNextCursor(data.nextCursor ?? data.next_cursor ?? null);
        setHasMore(Boolean(data.hasMore ?? data.has_more));
      } catch (err: unknown) {
        if (err instanceof Error && err.name === 'AbortError') return;
        if (currentReqId !== undefined && currentReqId !== activeRequestIdRef.current) return;
        const msg = err instanceof Error ? err.message : 'Error fetching activity records.';
        setTableError(msg);
      } finally {
        if (currentReqId === undefined || currentReqId === activeRequestIdRef.current) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [user, selectedTask, selectedProvider]
  );

  // Synchronous filter change and initial load handling
  useEffect(() => {
    // Increment monotonic request counter and abort previous in-flight requests
    const nextReqId = ++activeRequestIdRef.current;
    abortControllerRef.current?.abort();
    const abortCtrl = new AbortController();
    abortControllerRef.current = abortCtrl;

    setPageIndex(1);
    setCursorStack([null]);

    fetchSummary(abortCtrl.signal, nextReqId);
    fetchHistory(null, false, abortCtrl.signal, nextReqId);

    return () => {
      abortCtrl.abort();
    };
  }, [fetchSummary, fetchHistory, selectedTask, selectedProvider]);

  // Handle Next Page
  const handleNextPage = () => {
    if (!hasMore || !nextCursor) return;
    setCursorStack((prev) => [...prev, nextCursor]);
    setPageIndex((prev) => prev + 1);
    fetchHistory(nextCursor);
  };

  // Handle Previous Page
  const handlePrevPage = () => {
    if (pageIndex <= 1) return;
    const targetIdx = pageIndex - 2;
    const prevCursor = cursorStack[targetIdx] ?? null;
    setCursorStack((prev) => prev.slice(0, targetIdx + 1));
    setPageIndex((prev) => prev - 1);
    fetchHistory(prevCursor);
  };

  const getCredentialName = (credId: string) => {
    if (!credId) return 'Unrecorded Credential';
    const match = credentials.find((c) => c.id === credId);
    if (match) return match.friendlyName;
    if (credId.startsWith('server_')) return 'Default Server Key';
    return `Key (${credId})`;
  };

  const formatDateTime = (isoString: string) => {
    try {
      const d = new Date(isoString);
      return d.toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });
    } catch {
      return isoString;
    }
  };

  // Render Table Preference Badge
  const renderPreferenceBadge = (item: ExecutionItem) => {
    const status = item.preferenceStatus;

    if (status === 'CONFIRMED_PREFERRED_ATTEMPTED') {
      return (
        <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-emerald-500/10 text-emerald-300 border border-emerald-500/20">
          Preferred Attempted
        </span>
      );
    }
    if (status === 'CONFIRMED_PREFERRED_SKIPPED_REASON') {
      return (
        <span
          title={`Bypassed: ${item.preferredRouteSkipReason}`}
          className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-500/10 text-amber-300 border border-amber-500/20"
        >
          Skipped ({item.preferredRouteSkipReason})
        </span>
      );
    }
    if (status === 'CONFIRMED_PREFERRED_SKIPPED_NO_REASON') {
      return (
        <span
          title="Bypassed (Reason Unrecorded)"
          className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-500/10 text-amber-300 border border-amber-500/20"
        >
          Skipped (Reason Unrecorded)
        </span>
      );
    }
    if (status === 'CONFIRMED_PREFERRED_UNVERIFIED') {
      return (
        <span
          title="Preferred credential was pinned; hop details missing"
          className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-500/10 text-amber-300/80 border border-amber-500/20"
        >
          Preferred Pinned (Trace Missing)
        </span>
      );
    }
    if (status === 'PREFERRED_FIRST_HOP_MISMATCH') {
      return (
        <span
          title="Preferred was pinned, but Hop 1 targeted a different credential"
          className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-500/10 text-amber-300 border border-amber-500/20"
        >
          Preferred Pinned (Hop Mismatch)
        </span>
      );
    }
    if (status === 'CONFIRMED_NO_PREFERENCE') {
      return (
        <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-slate-500/10 text-slate-400 border border-slate-500/20">
          No Preference
        </span>
      );
    }
    if (status === 'PREFERENCE_NOT_RECORDED') {
      return (
        <span
          title="Telemetry pre-dates preference tracking (Historical)"
          className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-slate-800/40 text-slate-400 border border-slate-700/40"
        >
          Preference Not Recorded
        </span>
      );
    }
    if (status === 'PREFERENCE_CONTRADICTORY_EVIDENCE') {
      return (
        <span
          title="Internal conflict between preference flags and hop sequence"
          className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-rose-500/10 text-rose-300 border border-rose-500/20"
        >
          Preference Conflict
        </span>
      );
    }

    // Fallback based on raw fields
    if (item.preferredCredentialId) {
      if (item.preferredRouteSkipped) {
        return (
          <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-500/10 text-amber-300 border border-amber-500/20">
            Skipped ({item.preferredRouteSkipReason || 'Reason Unrecorded'})
          </span>
        );
      }
      return (
        <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-emerald-500/10 text-emerald-300 border border-emerald-500/20">
          Preferred Attempted
        </span>
      );
    }
    if (item.preferenceConfigured === false) {
      return <span className="text-[10px] text-primary-secondary">No Preference</span>;
    }
    return <span className="text-[10px] text-primary-secondary">Preference Not Recorded</span>;
  };

  // Render Table Outcome Badge
  const renderOutcomeBadge = (item: ExecutionItem) => {
    const outcome = item.executionOutcome;

    if (outcome === 'DIRECT_SUCCESS') {
      return (
        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-400">
          <CheckCircle2 className="w-3.5 h-3.5" />
          Direct Success
        </span>
      );
    }
    if (outcome === 'FALLBACK_SUCCESS') {
      return (
        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-400">
          <CheckCircle2 className="w-3.5 h-3.5" />
          Fallback Success
        </span>
      );
    }
    if (outcome === 'SUCCESS_UNKNOWN_ROUTE') {
      return (
        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-400">
          <CheckCircle2 className="w-3.5 h-3.5" />
          Success (Route Unverified)
        </span>
      );
    }
    if (outcome === 'DIRECT_FAILURE') {
      return (
        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-red-400">
          <XCircle className="w-3.5 h-3.5" />
          {item.failureCategory || 'Direct Failed'}
        </span>
      );
    }
    if (outcome === 'FALLBACK_FAILURE') {
      return (
        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-red-400">
          <XCircle className="w-3.5 h-3.5" />
          {item.failureCategory || 'Fallback Failed'}
        </span>
      );
    }
    if (outcome === 'FAILURE_UNKNOWN_ROUTE') {
      return (
        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-red-400">
          <XCircle className="w-3.5 h-3.5" />
          {item.failureCategory || 'Failed (Route Unverified)'}
        </span>
      );
    }
    if (outcome === 'CONTRADICTORY_OUTCOME') {
      return (
        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-rose-400">
          <AlertTriangle className="w-3.5 h-3.5" />
          Outcome Conflict
        </span>
      );
    }
    if (outcome === 'INDETERMINATE_OUTCOME') {
      return <span className="text-[11px] text-slate-400">Outcome Unrecorded</span>;
    }

    // Direct fallback from boolean success
    return item.success ? (
      <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-400">
        <CheckCircle2 className="w-3.5 h-3.5" />
        Success
      </span>
    ) : (
      <span className="inline-flex items-center gap-1 text-[11px] font-medium text-red-400">
        <XCircle className="w-3.5 h-3.5" />
        {item.failureCategory || 'Failed'}
      </span>
    );
  };

  // Render Fallback Narrative in Modal
  const renderFallbackNarrative = (item: ExecutionItem) => {
    const hops = item.attemptedHops;
    const prefId = item.preferredCredentialId;
    const firstHop = hops && hops.length > 0 ? hops[0] : null;

    if (item.preferenceStatus === 'CONFIRMED_PREFERRED_SKIPPED_REASON') {
      return `Preferred credential was bypassed before attempt (${item.preferredRouteSkipReason}) → Fallback succeeded on ${getCredentialName(item.credentialIdUsed)}`;
    }
    if (firstHop && prefId && firstHop.credential_id === prefId && firstHop.status === 'FAILED' && item.success) {
      return `Preferred credential failed in Hop 1 (${firstHop.error || 'Provider Error'}) → Fallback succeeded on ${getCredentialName(item.credentialIdUsed)}`;
    }
    if (item.hopsCount > 1 && item.success && (!firstHop || !prefId || firstHop.status !== 'FAILED')) {
      return `Execution required fallback (${item.hopsCount} hops) → Earlier attempts unverified, final success on ${getCredentialName(item.credentialIdUsed)}`;
    }
    if (item.routeClassification === 'UNKNOWN_ROUTE') {
      return `Route chronology was not recorded for this execution → Final landed credential: ${getCredentialName(item.credentialIdUsed)}`;
    }
    if (item.hopsCount === 1 && !item.fallbackLevel) {
      return `Direct attempt executed successfully without fallback on ${getCredentialName(item.credentialIdUsed)}`;
    }
    return `Execution resolved on ${getCredentialName(item.credentialIdUsed)}`;
  };

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-border/80 pb-4">
        <div>
          <h1 className="text-xl font-bold text-white flex items-center gap-2.5">
            <Activity className="w-5 h-5 text-emerald-400" />
            Recent AI Activities
          </h1>
          <p className="text-xs text-primary-secondary mt-1">
            Real-time audit log of all model invocations, routing decisions, fallback traces, and multi-credential hops.
          </p>
        </div>
        {user && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                const nextReqId = ++activeRequestIdRef.current;
                fetchSummary(undefined, nextReqId);
                const currentCursor = cursorStack[pageIndex - 1] ?? null;
                fetchHistory(currentCursor, true, undefined, nextReqId);
              }}
              disabled={refreshing}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-surface-subtle border border-border text-emerald-400 hover:text-emerald-300 transition-colors cursor-pointer disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
              Refresh
            </button>
          </div>
        )}
      </div>

      {!user ? (
        <AuthRequiredEmptyState
          icon={Activity}
          badge="AI Auditing & Observability"
          title="Sign In to View Recent AI Activities"
          description="Track and inspect every AI model invocation in real time. JobFinder provides transparent audit logs with provider routing decisions, token usage, latency metrics, and fallback trace trees."
          benefits={[
            "Real-time invocation logs for Gemini, OpenAI, Claude, Groq, and OpenRouter",
            "Full hop trace inspection revealing automatic rate-limit cooldown recovery",
            "Token consumption, latency breakdown, and cost policy enforcement records",
            "Correlated batch operation tracking with immutable telemetry records"
          ]}
          primaryActionText="Sign In / Create Account"
          authModalTitle="Sign in to View AI Activities"
          authModalSubtitle="View your model invocation traces, routing logs, and audit records."
        />
      ) : (
        <>
          {/* Summary Error Notice */}
      {summaryError && (
        <div className="bg-amber-950/20 border border-amber-500/30 p-2.5 rounded-xl flex items-center justify-between text-xs text-amber-300">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-400" />
            <span>{summaryError}</span>
          </div>
          <button
            type="button"
            onClick={() => fetchSummary()}
            className="underline hover:text-white cursor-pointer"
          >
            Retry Summary
          </button>
        </div>
      )}

      {/* Top Metric Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-surface-subtle p-3.5 rounded-xl border border-border">
          <div className="flex items-center justify-between text-primary-secondary">
            <span className="text-[11px] font-semibold uppercase tracking-wider">Total Invocations</span>
            <Zap className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="text-xl font-bold text-white mt-1.5">{summary?.totalRequests ?? 0}</div>
          <div className="text-[10px] text-primary-secondary mt-0.5">
            {selectedTask || selectedProvider ? 'Matching selected filters' : 'Across all models & tasks'}
          </div>
        </div>

        <div className="bg-surface-subtle p-3.5 rounded-xl border border-border">
          <div className="flex items-center justify-between text-primary-secondary">
            <span className="text-[11px] font-semibold uppercase tracking-wider">Success Rate</span>
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="text-xl font-bold text-white mt-1.5">
            {summary && summary.successRate !== null ? `${summary.successRate}%` : '—'}
          </div>
          <div className="text-[10px] text-primary-secondary mt-0.5">
            {summary?.indeterminateRequests && summary.indeterminateRequests > 0
              ? `${summary.successfulRequests} succeeded / ${summary.failedRequests} failed (${summary.indeterminateRequests} unrecorded)`
              : `${summary?.successfulRequests ?? 0} succeeded / ${summary?.failedRequests ?? 0} failed`}
          </div>
        </div>

        <div className="bg-surface-subtle p-3.5 rounded-xl border border-border">
          <div className="flex items-center justify-between text-primary-secondary">
            <span className="text-[11px] font-semibold uppercase tracking-wider">Avg Latency</span>
            <Clock className="w-4 h-4 text-sky-400" />
          </div>
          <div className="text-xl font-bold text-white mt-1.5">
            {summary && summary.averageLatencyMs !== null ? `${summary.averageLatencyMs}ms` : '—'}
          </div>
          <div className="text-[10px] text-primary-secondary mt-0.5">Excludes unrecorded latencies</div>
        </div>

        <div className="bg-surface-subtle p-3.5 rounded-xl border border-border">
          <div className="flex items-center justify-between text-primary-secondary">
            <span className="text-[11px] font-semibold uppercase tracking-wider">Fallbacks Triggered</span>
            <Layers className="w-4 h-4 text-amber-400" />
          </div>
          <div className="text-xl font-bold text-white mt-1.5">{summary?.fallbackCount ?? 0}</div>
          <div className="text-[10px] text-primary-secondary mt-0.5">Logical executions requiring hops</div>
        </div>
      </div>

      {/* Filter Ribbon */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-surface-subtle/60 p-3 rounded-xl border border-border">
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="flex items-center gap-1.5 text-xs text-primary-secondary font-medium">
            <Filter className="w-3.5 h-3.5" />
            Filters:
          </div>
          <select
            value={selectedTask}
            aria-label="Filter by task"
            onChange={(e) => setSelectedTask(e.target.value)}
            className="bg-[#141414] text-xs text-white border border-border rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-emerald-500/50"
          >
            {TASK_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>

          <select
            value={selectedProvider}
            aria-label="Filter by provider"
            onChange={(e) => setSelectedProvider(e.target.value)}
            className="bg-[#141414] text-xs text-white border border-border rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-emerald-500/50"
          >
            {PROVIDER_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>

          {(selectedTask || selectedProvider) && (
            <button
              type="button"
              onClick={() => {
                setSelectedTask('');
                setSelectedProvider('');
              }}
              className="text-xs text-emerald-400 hover:text-emerald-300 underline cursor-pointer ml-1"
            >
              Reset Filters
            </button>
          )}
        </div>

        <div className="text-xs text-primary-secondary font-mono">
          Page {pageIndex} {hasMore ? '(More available)' : '(End of log)'}
        </div>
      </div>

      {/* Table Content */}
      <div className="bg-surface-subtle/30 rounded-xl border border-border overflow-hidden">
        {tableError ? (
          <div className="p-8 text-center text-xs text-red-400 space-y-2">
            <div className="flex items-center justify-center gap-2">
              <AlertTriangle className="w-4 h-4" />
              <span>{tableError}</span>
            </div>
            <button
              type="button"
              onClick={() => fetchHistory(null)}
              className="px-3 py-1 rounded bg-surface-subtle border border-border text-white text-xs hover:bg-white/10 cursor-pointer"
            >
              Retry
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-primary-secondary">
              <thead className="bg-[#141414] text-white font-medium border-b border-border text-[11px] uppercase tracking-wider">
                <tr>
                  <th className="py-3 px-3.5 whitespace-nowrap">Date & Time</th>
                  <th className="py-3 px-3">Task</th>
                  <th className="py-3 px-3">Operation ID</th>
                  <th className="py-3 px-3">Provider</th>
                  <th className="py-3 px-3">Credential Used</th>
                  <th className="py-3 px-3">Model</th>
                  <th className="py-3 px-3">Preferred Route</th>
                  <th className="py-3 px-3">Outcome</th>
                  <th className="py-3 px-3">Fallback</th>
                  <th className="py-3 px-3 text-right">Latency</th>
                  <th className="py-3 px-3 text-center">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {loading ? (
                  <tr>
                    <td colSpan={11} className="py-12 text-center text-xs text-primary-secondary">
                      <div className="inline-flex items-center gap-2">
                        <RefreshCw className="w-4 h-4 animate-spin text-emerald-400" />
                        Loading activity history...
                      </div>
                    </td>
                  </tr>
                ) : executions.length === 0 ? (
                  <tr>
                    <td colSpan={11} className="py-12 text-center text-xs text-primary-secondary">
                      No AI activities found matching the selected filters.
                    </td>
                  </tr>
                ) : (
                  executions.map((item) => {
                    const hasHops = item.hopsCount > 1 || (item.attemptedHops && item.attemptedHops.length > 1);
                    return (
                      <tr
                        key={item.executionId}
                        className="hover:bg-surface-subtle/60 transition-colors group cursor-pointer"
                        onClick={() => setSelectedItemForTrace(item)}
                      >
                        {/* Date & Time */}
                        <td className="py-3 px-3.5 whitespace-nowrap font-mono text-[11px] text-white/90">
                          {formatDateTime(item.timestamp)}
                        </td>

                        {/* Task */}
                        <td className="py-3 px-3 font-medium text-white whitespace-nowrap">
                          {item.task}
                        </td>

                        {/* Operation ID (Correlated batch) */}
                        <td className="py-3 px-3 whitespace-nowrap">
                          {item.operationId ? (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleCopy(item.operationId!, `op_${item.executionId}`);
                              }}
                              title={`Click to copy Operation ID: ${item.operationId}`}
                              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded font-mono text-[10px] bg-purple-500/10 text-purple-300 border border-purple-500/20 hover:bg-purple-500/20 transition-colors cursor-pointer"
                            >
                              <span>{item.operationId.slice(0, 14)}...</span>
                              {copiedId === `op_${item.executionId}` ? (
                                <Check className="w-2.5 h-2.5 text-emerald-400" />
                              ) : (
                                <Copy className="w-2.5 h-2.5 opacity-60 hover:opacity-100" />
                              )}
                            </button>
                          ) : (
                            <span className="text-[11px] text-primary-secondary/50">—</span>
                          )}
                        </td>

                        {/* Provider */}
                        <td className="py-3 px-3 uppercase text-[11px] font-semibold text-white/80 whitespace-nowrap">
                          {item.providerUsed}
                        </td>

                        {/* Credential */}
                        <td className="py-3 px-3 text-[11px] text-white/90 whitespace-nowrap">
                          {getCredentialName(item.credentialIdUsed)}
                        </td>

                        {/* Model */}
                        <td className="py-3 px-3 font-mono text-[11px] text-emerald-400 whitespace-nowrap">
                          {item.modelUsed}
                        </td>

                        {/* Preferred Route Status */}
                        <td className="py-3 px-3 whitespace-nowrap">
                          {renderPreferenceBadge(item)}
                        </td>

                        {/* Outcome */}
                        <td className="py-3 px-3 whitespace-nowrap">
                          {renderOutcomeBadge(item)}
                        </td>

                        {/* Fallback */}
                        <td className="py-3 px-3 whitespace-nowrap">
                          {item.fallbackLevel === 0 ? (
                            <span className="text-[11px] text-primary-secondary">Direct (L0)</span>
                          ) : (
                            <span
                              className={`px-1.5 py-0.5 rounded text-[10px] font-semibold border ${
                                item.fallbackLevel === 1
                                  ? 'bg-sky-500/10 text-sky-300 border-sky-500/20'
                                  : item.fallbackLevel === 2
                                  ? 'bg-amber-500/10 text-amber-300 border-amber-500/20'
                                  : 'bg-red-500/10 text-red-300 border-red-500/20'
                              }`}
                            >
                              {item.fallbackLevel === 1
                                ? 'L1 Model'
                                : item.fallbackLevel === 2
                                ? 'L2 Credential'
                                : 'L3 Provider'}{' '}
                              ({item.hopsCount} hops)
                            </span>
                          )}
                        </td>

                        {/* Latency */}
                        <td className="py-3 px-3 text-right font-mono text-[11px] text-white whitespace-nowrap">
                          {item.latencyMs ? `${Math.round(item.latencyMs)}ms` : '—'}
                        </td>

                        {/* Action: Trace inspect */}
                        <td className="py-3 px-3 text-center whitespace-nowrap">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedItemForTrace(item);
                            }}
                            className={`px-2 py-1 rounded text-[10px] font-medium transition-colors cursor-pointer ${
                              hasHops
                                ? 'bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/30'
                                : 'bg-surface-subtle hover:bg-white/10 text-primary-secondary hover:text-white border border-border'
                            }`}
                          >
                            {hasHops ? 'Inspect Hops' : 'Details'}
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* Cursor Pagination Bar */}
        <div className="flex items-center justify-between px-4 py-3 bg-[#141414] border-t border-border">
          <div className="text-xs text-primary-secondary">
            Showing Page <span className="font-semibold text-white">{pageIndex}</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handlePrevPage}
              disabled={pageIndex <= 1 || loading}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium bg-surface-subtle border border-border text-white hover:bg-white/10 transition-colors disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
              Previous
            </button>
            <button
              type="button"
              onClick={handleNextPage}
              disabled={!hasMore || loading}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium bg-surface-subtle border border-border text-white hover:bg-white/10 transition-colors disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
            >
              Next
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>
      </>
      )}

      {/* Hop Trace & Execution Details Modal */}
      {selectedItemForTrace && (
        <Modal
          isOpen={true}
          onClose={() => setSelectedItemForTrace(null)}
          maxWidth="2xl"
          title={
            <div className="flex items-center gap-2">
              <Layers className="w-4 h-4 text-emerald-400" />
              <span>Execution Trace: {selectedItemForTrace.task}</span>
            </div>
          }
          description="Detailed breakdown of model selection, quota handling, and fallback hops."
        >
          <div className="space-y-4 text-xs">
            {/* Top Macroscopic Route Summary Banner */}
            <div className="bg-emerald-950/20 border border-emerald-500/30 p-3 rounded-lg text-xs space-y-1">
              <div className="font-semibold text-white flex items-center justify-between">
                <span>Route Summary</span>
                <span className="font-mono text-[10px] text-emerald-400">
                  {selectedItemForTrace.traceStatus || 'TRACE_UNAVAILABLE'}
                </span>
              </div>
              <p className="text-primary-secondary text-[11px]">
                {renderFallbackNarrative(selectedItemForTrace)}
              </p>
            </div>

            {/* Metadata Summary Banner */}
            <div className="bg-[#141414] p-3 rounded-lg border border-border grid grid-cols-2 sm:grid-cols-3 gap-2.5 font-mono text-[11px]">
              <div>
                <span className="text-primary-secondary block text-[10px] uppercase font-sans">Timestamp</span>
                <span className="text-white">{formatDateTime(selectedItemForTrace.timestamp)}</span>
              </div>
              <div>
                <span className="text-primary-secondary block text-[10px] uppercase font-sans">Total Latency</span>
                <span className="text-white">
                  {selectedItemForTrace.latencyMs ? `${Math.round(selectedItemForTrace.latencyMs)}ms` : '—'}
                </span>
              </div>
              <div>
                <span className="text-primary-secondary block text-[10px] uppercase font-sans">Final Outcome</span>
                <span
                  className={
                    selectedItemForTrace.success
                      ? 'text-emerald-400 font-semibold'
                      : 'text-red-400 font-semibold'
                  }
                >
                  {selectedItemForTrace.success
                    ? 'SUCCESS'
                    : selectedItemForTrace.failureCategory || 'FAILED'}
                </span>
              </div>
              <div>
                <span className="text-primary-secondary block text-[10px] uppercase font-sans flex items-center gap-1">
                  Execution ID
                  <button
                    type="button"
                    onClick={() => handleCopy(selectedItemForTrace.executionId, 'execId')}
                    className="text-primary-secondary hover:text-white"
                  >
                    {copiedId === 'execId' ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                  </button>
                </span>
                <span className="text-white/80">{selectedItemForTrace.executionId}</span>
              </div>
              {selectedItemForTrace.operationId && (
                <div className="col-span-2">
                  <span className="text-primary-secondary block text-[10px] uppercase font-sans flex items-center gap-1">
                    Correlated 1-Shot Operation ID
                    <button
                      type="button"
                      onClick={() => handleCopy(selectedItemForTrace.operationId!, 'opId')}
                      className="text-primary-secondary hover:text-white"
                    >
                      {copiedId === 'opId' ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                    </button>
                  </span>
                  <span className="text-purple-300 font-semibold">{selectedItemForTrace.operationId}</span>
                </div>
              )}
            </div>

            {/* Preferred Routing Diagnosis */}
            <div className="bg-surface-subtle p-3 rounded-lg border border-border">
              <h4 className="font-semibold text-white text-xs mb-1.5 flex items-center gap-1.5">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                Task-Specific Routing Status
              </h4>
              <div className="space-y-1 text-primary-secondary text-[11px]">
                <div>
                  <span className="text-white">Preferred Credential Configured: </span>
                  {selectedItemForTrace.preferredCredentialId
                    ? getCredentialName(selectedItemForTrace.preferredCredentialId)
                    : selectedItemForTrace.preferenceConfigured === false
                    ? 'None (Default policy priority)'
                    : 'Preference Not Recorded (Historical)'}
                </div>
                {selectedItemForTrace.preferredRouteSkipped && (
                  <div className="text-amber-300 flex items-center gap-1 mt-1">
                    <AlertTriangle className="w-3.5 h-3.5" />
                    Preferred credential was bypassed due to:{' '}
                    <span className="font-semibold uppercase font-mono">
                      {selectedItemForTrace.preferredRouteSkipReason || 'FALLBACK_OR_LIMIT'}
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* Hops Trace Sequence / Chronology */}
            <div>
              <h4 className="font-semibold text-white text-xs mb-2 flex items-center gap-1.5">
                <Layers className="w-3.5 h-3.5 text-emerald-400" />
                Attempted Hops Sequence ({selectedItemForTrace.hopsCount} Hop
                {selectedItemForTrace.hopsCount > 1 ? 's' : ''})
              </h4>

              {/* Complete Multi-Hop Stepper */}
              {selectedItemForTrace.attemptedHops && selectedItemForTrace.attemptedHops.length > 0 ? (
                <div className="space-y-2">
                  {selectedItemForTrace.attemptedHops.map((hop, idx) => (
                    <div
                      key={idx}
                      className={`p-3 rounded-lg border text-xs ${
                        hop.status === 'SUCCESS'
                          ? 'bg-emerald-950/20 border-emerald-500/30'
                          : 'bg-red-950/20 border-red-500/30'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span
                            className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${
                              hop.status === 'SUCCESS'
                                ? 'bg-emerald-500 text-black'
                                : 'bg-red-500 text-white'
                            }`}
                          >
                            {idx + 1}
                          </span>
                          <span className="font-semibold text-white uppercase text-[11px]">
                            {hop.provider} &middot; <span className="font-mono text-emerald-400">{hop.model}</span>
                          </span>
                        </div>
                        <span className="font-mono text-[11px] text-white/80">
                          {hop.latency_ms ? `${Math.round(hop.latency_ms)}ms` : ''}
                        </span>
                      </div>

                      <div className="mt-1.5 pl-7 text-[11px] text-primary-secondary space-y-0.5">
                        <div>
                          Credential: <span className="text-white/90">{getCredentialName(hop.credential_id)}</span>
                        </div>
                        {hop.error && (
                          <div className="text-red-300 font-mono text-[10px] mt-1 bg-red-950/50 p-2 rounded border border-red-800/40 break-words">
                            Error: {hop.error}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}

                  {/* If partial trace: show incomplete note */}
                  {selectedItemForTrace.traceStatus === 'INCOMPLETE_MULTI_HOP' &&
                    selectedItemForTrace.hopsCount > selectedItemForTrace.attemptedHops.length && (
                      <div className="p-2.5 bg-amber-950/20 rounded-lg border border-amber-500/30 text-amber-300 text-[11px] flex items-center gap-2">
                        <AlertTriangle className="w-3.5 h-3.5" />
                        <span>
                          Notice: Only {selectedItemForTrace.attemptedHops.length} of{' '}
                          {selectedItemForTrace.hopsCount} hops were captured in this historical trace.
                        </span>
                      </div>
                    )}
                </div>
              ) : selectedItemForTrace.traceStatus === 'RECORDED_DIRECT' ? (
                <div className="p-3 bg-[#141414] rounded-lg border border-border text-center text-primary-secondary">
                  Single direct attempt using {selectedItemForTrace.providerUsed} ({selectedItemForTrace.modelUsed}) on{' '}
                  {getCredentialName(selectedItemForTrace.credentialIdUsed)}.
                </div>
              ) : selectedItemForTrace.traceStatus === 'INCOMPLETE_MULTI_HOP' ? (
                <div className="p-4 bg-amber-950/20 rounded-lg border border-amber-500/30 space-y-1.5 text-[11px]">
                  <div className="font-semibold text-amber-300 flex items-center gap-1.5">
                    <AlertTriangle className="w-4 h-4 text-amber-400" />
                    Historical Multi-Hop Notice
                  </div>
                  <p className="text-primary-secondary">
                    Detailed step-by-step trace was not captured for this execution. Aggregate recorded facts: Level{' '}
                    {selectedItemForTrace.fallbackLevel} Fallback ({selectedItemForTrace.hopsCount} hops), resolved on{' '}
                    <span className="text-white font-medium">
                      {getCredentialName(selectedItemForTrace.credentialIdUsed)}
                    </span>{' '}
                    using {selectedItemForTrace.providerUsed} ({selectedItemForTrace.modelUsed}).
                  </p>
                </div>
              ) : selectedItemForTrace.traceStatus === 'CONTRADICTORY_TELEMETRY' ? (
                <div className="p-4 bg-rose-950/20 rounded-lg border border-rose-500/30 space-y-1.5 text-[11px]">
                  <div className="font-semibold text-rose-300 flex items-center gap-1.5">
                    <AlertTriangle className="w-4 h-4 text-rose-400" />
                    Telemetry Discrepancy Detected
                  </div>
                  <p className="text-primary-secondary">
                    Inconsistent trace counts detected in raw record (Claimed hops: {selectedItemForTrace.hopsCount},
                    recorded hops: {selectedItemForTrace.attemptedHops?.length ?? 0}, fallback level:{' '}
                    {selectedItemForTrace.fallbackLevel}).
                  </p>
                </div>
              ) : (
                <div className="p-4 bg-[#141414] rounded-lg border border-border text-center text-primary-secondary space-y-1 text-[11px]">
                  <HelpCircle className="w-4 h-4 text-slate-500 mx-auto" />
                  <p>Detailed hop trace sequence was not recorded for this historical execution.</p>
                  <p className="text-white/80">
                    Landed model: {selectedItemForTrace.providerUsed} ({selectedItemForTrace.modelUsed}) on{' '}
                    {getCredentialName(selectedItemForTrace.credentialIdUsed)}.
                  </p>
                </div>
              )}
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};

export default RecentActivitiesPage;
