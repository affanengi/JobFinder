import React, { useState, useEffect, useCallback } from 'react';
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
} from 'lucide-react';
import { fetchWithAuth } from '../lib/api';
import { Modal } from '../components/ui/Modal';

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
  preferredCredentialId?: string | null;
  preferredRouteSkipped?: boolean;
  preferredRouteSkipReason?: string | null;
  attemptedHops?: HopDetail[];
  timestamp: string;
}

export interface TelemetrySummary {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  successRate: number;
  averageLatencyMs: number;
  fallbackCount: number;
  providerDistribution: Record<string, number>;
  taskDistribution: Record<string, number>;
}

export interface CredentialMeta {
  id: string;
  friendlyName: string;
  provider: string;
}

const TASK_OPTIONS = [
  { value: '', label: 'All Tasks' },
  { value: 'resume_tailoring', label: 'Resume Tailoring' },
  { value: 'cover_letter_gen', label: 'Cover Letter Generation' },
  { value: 'ats_scanner', label: 'ATS Scanner' },
  { value: 'qa_copilot', label: 'QA Copilot' },
  { value: 'job_matching', label: 'Job Matching' },
  { value: 'profile_extraction', label: 'Profile Extraction' },
];

const PROVIDER_OPTIONS = [
  { value: '', label: 'All Providers' },
  { value: 'gemini', label: 'Google Gemini' },
  { value: 'openrouter', label: 'OpenRouter' },
  { value: 'groq', label: 'Groq' },
];

export const RecentActivitiesPage: React.FC = () => {
  const [summary, setSummary] = useState<TelemetrySummary | null>(null);
  const [credentials, setCredentials] = useState<CredentialMeta[]>([]);
  const [executions, setExecutions] = useState<ExecutionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

interface CredentialApiItem {
  id?: string;
  credentialId?: string;
  friendlyName?: string;
  name?: string;
  provider: string;
}

  // Load credentials once to map friendly names
  useEffect(() => {
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
  }, []);

  // Fetch Summary
  const fetchSummary = useCallback(async () => {
    try {
      const res = await fetchWithAuth('/api/v1/ai/telemetry/summary');
      if (res.ok) {
        const data = await res.json();
        setSummary(data);
      }
    } catch (e) {
      console.error('Failed to load telemetry summary:', e);
    }
  }, []);

  // Fetch Paginated History
  const fetchHistory = useCallback(
    async (cursor: string | null = null, isRefresh = false) => {
      if (isRefresh) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }
      setError(null);

      try {
        const params = new URLSearchParams({ limit: '15' });
        if (cursor) params.set('cursor', cursor);
        if (selectedTask) params.set('task', selectedTask);
        if (selectedProvider) params.set('provider', selectedProvider);

        const res = await fetchWithAuth(`/api/v1/ai/telemetry/history?${params.toString()}`);
        if (!res.ok) {
          throw new Error(`Failed to load AI activity history: HTTP ${res.status}`);
        }

        const data = await res.json();
        setExecutions(data.items || []);
        setNextCursor(data.next_cursor || null);
        setHasMore(Boolean(data.has_more));
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Error fetching activity records.';
        setError(msg);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [selectedTask, selectedProvider]
  );

  // Initial load or filter change
  useEffect(() => {
    setPageIndex(1);
    setCursorStack([null]);
    fetchSummary();
    fetchHistory(null);
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
    const match = credentials.find((c) => c.id === credId);
    if (match) return match.friendlyName;
    if (credId.startsWith('server_')) return 'Default Server Key';
    return credId;
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
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              fetchSummary();
              const currentCursor = cursorStack[pageIndex - 1] ?? null;
              fetchHistory(currentCursor, true);
            }}
            disabled={refreshing}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-surface-subtle border border-border text-emerald-400 hover:text-emerald-300 transition-colors cursor-pointer disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      {/* Top Metric Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-surface-subtle p-3.5 rounded-xl border border-border">
          <div className="flex items-center justify-between text-primary-secondary">
            <span className="text-[11px] font-semibold uppercase tracking-wider">Total Invocations</span>
            <Zap className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="text-xl font-bold text-white mt-1.5">{summary?.totalRequests ?? 0}</div>
          <div className="text-[10px] text-primary-secondary mt-0.5">Across all models & tasks</div>
        </div>

        <div className="bg-surface-subtle p-3.5 rounded-xl border border-border">
          <div className="flex items-center justify-between text-primary-secondary">
            <span className="text-[11px] font-semibold uppercase tracking-wider">Success Rate</span>
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="text-xl font-bold text-white mt-1.5">
            {summary?.totalRequests ? `${summary.successRate}%` : '—'}
          </div>
          <div className="text-[10px] text-primary-secondary mt-0.5">
            {summary?.successfulRequests ?? 0} succeeded / {summary?.failedRequests ?? 0} failed
          </div>
        </div>

        <div className="bg-surface-subtle p-3.5 rounded-xl border border-border">
          <div className="flex items-center justify-between text-primary-secondary">
            <span className="text-[11px] font-semibold uppercase tracking-wider">Avg Latency</span>
            <Clock className="w-4 h-4 text-sky-400" />
          </div>
          <div className="text-xl font-bold text-white mt-1.5">
            {summary?.averageLatencyMs ? `${summary.averageLatencyMs}ms` : '—'}
          </div>
          <div className="text-[10px] text-primary-secondary mt-0.5">End-to-end execution time</div>
        </div>

        <div className="bg-surface-subtle p-3.5 rounded-xl border border-border">
          <div className="flex items-center justify-between text-primary-secondary">
            <span className="text-[11px] font-semibold uppercase tracking-wider">Fallbacks Triggered</span>
            <Layers className="w-4 h-4 text-amber-400" />
          </div>
          <div className="text-xl font-bold text-white mt-1.5">{summary?.fallbackCount ?? 0}</div>
          <div className="text-[10px] text-primary-secondary mt-0.5">Model, credential, or provider hops</div>
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
        </div>

        <div className="text-xs text-primary-secondary font-mono">
          Page {pageIndex} {hasMore ? '(More available)' : '(End of log)'}
        </div>
      </div>

      {/* Table Content */}
      <div className="bg-surface-subtle/30 rounded-xl border border-border overflow-hidden">
        {error ? (
          <div className="p-6 text-center text-xs text-red-400 flex items-center justify-center gap-2">
            <AlertTriangle className="w-4 h-4" />
            {error}
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
                            <span
                              title={`Correlated 1-shot operation: ${item.operationId}`}
                              className="px-1.5 py-0.5 rounded font-mono text-[10px] bg-purple-500/10 text-purple-300 border border-purple-500/20"
                            >
                              {item.operationId.slice(0, 14)}...
                            </span>
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
                          {item.preferredCredentialId ? (
                            item.preferredRouteSkipped ? (
                              <span
                                title={`Skipped reason: ${item.preferredRouteSkipReason || 'UNKNOWN'}`}
                                className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-500/10 text-amber-300 border border-amber-500/20"
                              >
                                Skipped ({item.preferredRouteSkipReason || 'FALLBACK'})
                              </span>
                            ) : (
                              <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-emerald-500/10 text-emerald-300 border border-emerald-500/20">
                                Preferred Attempted
                              </span>
                            )
                          ) : (
                            <span className="text-[10px] text-primary-secondary">No Preference</span>
                          )}
                        </td>

                        {/* Outcome */}
                        <td className="py-3 px-3 whitespace-nowrap">
                          {item.success ? (
                            <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-400">
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              Success
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-[11px] font-medium text-red-400">
                              <XCircle className="w-3.5 h-3.5" />
                              {item.failureCategory || 'Failed'}
                            </span>
                          )}
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
                          {item.latencyMs}ms
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
            {/* Metadata Summary Banner */}
            <div className="bg-[#141414] p-3 rounded-lg border border-border grid grid-cols-2 sm:grid-cols-3 gap-2.5 font-mono text-[11px]">
              <div>
                <span className="text-primary-secondary block text-[10px] uppercase font-sans">Timestamp</span>
                <span className="text-white">{formatDateTime(selectedItemForTrace.timestamp)}</span>
              </div>
              <div>
                <span className="text-primary-secondary block text-[10px] uppercase font-sans">Total Latency</span>
                <span className="text-white">{selectedItemForTrace.latencyMs}ms</span>
              </div>
              <div>
                <span className="text-primary-secondary block text-[10px] uppercase font-sans">Final Outcome</span>
                <span className={selectedItemForTrace.success ? 'text-emerald-400 font-semibold' : 'text-red-400 font-semibold'}>
                  {selectedItemForTrace.success ? 'SUCCESS' : selectedItemForTrace.failureCategory || 'FAILED'}
                </span>
              </div>
              <div>
                <span className="text-primary-secondary block text-[10px] uppercase font-sans">Execution ID</span>
                <span className="text-white/80">{selectedItemForTrace.executionId}</span>
              </div>
              {selectedItemForTrace.operationId && (
                <div className="col-span-2">
                  <span className="text-primary-secondary block text-[10px] uppercase font-sans">
                    Correlated 1-Shot Operation ID
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
                    : 'None (Default policy priority)'}
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

            {/* Hops Trace Sequence */}
            <div>
              <h4 className="font-semibold text-white text-xs mb-2 flex items-center gap-1.5">
                <Layers className="w-3.5 h-3.5 text-emerald-400" />
                Attempted Hops Sequence ({selectedItemForTrace.hopsCount} Hop{selectedItemForTrace.hopsCount > 1 ? 's' : ''})
              </h4>

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
                </div>
              ) : (
                <div className="p-3 bg-[#141414] rounded-lg border border-border text-center text-primary-secondary">
                  Single direct attempt using {selectedItemForTrace.providerUsed} ({selectedItemForTrace.modelUsed}).
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
