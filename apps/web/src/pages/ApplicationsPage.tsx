import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Plus,
  RefreshCw,
  Search,
  Kanban,
  Table as TableIcon,
  Layers,
  AlertCircle,
  CheckCircle2,
  Clock,
  ChevronDown,
  Check,
} from 'lucide-react';
import { ApplicationRecord, ApplicationStage, EventSource, ActivityDateRange } from '../types/application';
import { isApplicationInDateRange } from '../components/applications/dateFilterUtils';
import { ApplicationMetricsRibbon } from '../components/applications/ApplicationMetricsRibbon';
import { ApplicationKanbanBoard } from '../components/applications/ApplicationKanbanBoard';
import { ApplicationTableView } from '../components/applications/ApplicationTableView';
import { ApplicationDetailsDrawer } from '../components/applications/ApplicationDetailsDrawer';
import { AddExternalAppModal } from '../components/applications/AddExternalAppModal';
import { MissingResumeModal } from '../components/applications/MissingResumeModal';
import { OutcomeDecisionModal } from '../components/applications/OutcomeDecisionModal';
import { PlaywrightAutofillModal } from '../components/applications/PlaywrightAutofillModal';
import { AtsQuestionCopilotModal } from '../components/applications/AtsQuestionCopilotModal';
import { ResumeStudioModal } from '../components/resume/ResumeStudioModal';
import { fetchWithAuth } from '../lib/api';

export const ApplicationsPage: React.FC = () => {
  const [applications, setApplications] = useState<ApplicationRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<'kanban' | 'table'>('kanban');
  const [selectedAppId, setSelectedAppId] = useState<string | null>(null);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [dateRange, setDateRange] = useState<ActivityDateRange>('7d');
  const [isFilterDropdownOpen, setIsFilterDropdownOpen] = useState(false);
  const [autofillApp, setAutofillApp] = useState<ApplicationRecord | null>(null);
  const [qaModalApp, setQaModalApp] = useState<ApplicationRecord | null>(null);
  const [missingResumeApp, setMissingResumeApp] = useState<ApplicationRecord | null>(null);
  const [outcomeDecisionApp, setOutcomeDecisionApp] = useState<ApplicationRecord | null>(null);
  const [resumeStudioApp, setResumeStudioApp] = useState<ApplicationRecord | null>(null);
  const [toast, setToast] = useState<{ text: string; type: 'info' | 'success' | 'error' } | null>(null);

  const showToast = (text: string, type: 'info' | 'success' | 'error' = 'info') => {
    setToast({ text, type });
    setTimeout(() => setToast(null), 3500);
  };

  // Fetch applications from backend
  const fetchApplications = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    setError(null);
    try {
      const res = await fetchWithAuth('/api/v1/applications');
      if (!res.ok) {
        throw new Error(`Failed to load applications: HTTP ${res.status}`);
      }
      const data: ApplicationRecord[] = await res.json();
      setApplications(data);
    } catch (err: any) {
      console.error('Error fetching applications:', err);
      setError(err?.message || 'Failed to load applications.');
    } finally {
      if (!quiet) setLoading(false);
    }
  }, []);

  // Initial sync from saved opportunities & fetch
  useEffect(() => {
    const init = async () => {
      setLoading(true);
      try {
        // Idempotently sync any saved opportunities that don't have application records yet
        await fetchWithAuth('/api/v1/applications/sync-from-saved', { method: 'POST' }).catch((e) => {
          console.warn('Initial sync-from-saved notice:', e);
        });
      } finally {
        await fetchApplications(true);
        setLoading(false);
      }
    };
    init();
  }, [fetchApplications]);

  // Window focus & visibility auto-refresh (seamless integration with Web Clipper)
  useEffect(() => {
    const handleVisibilityOrFocus = () => {
      if (document.visibilityState === 'visible') {
        fetchApplications(true);
      }
    };
    window.addEventListener('focus', handleVisibilityOrFocus);
    document.addEventListener('visibilitychange', handleVisibilityOrFocus);
    return () => {
      window.removeEventListener('focus', handleVisibilityOrFocus);
      document.removeEventListener('visibilitychange', handleVisibilityOrFocus);
    };
  }, [fetchApplications]);

  // Deep-link selection from Web Clipper (?selected=app_...)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const selected = params.get('selected');
    if (selected && applications.some((a) => a.id === selected)) {
      setSelectedAppId(selected);
    }
  }, [applications]);

  // Manual Trigger Sync
  const handleSyncFromSaved = async () => {
    setSyncing(true);
    try {
      const res = await fetchWithAuth('/api/v1/applications/sync-from-saved', { method: 'POST' });
      if (res.ok) {
        const result = await res.json();
        showToast(
          `Sync complete: ${result.createdCount} new applications created (${result.totalSynced} active opportunities).`,
          'success'
        );
        await fetchApplications(true);
      } else {
        throw new Error('Sync returned an error');
      }
    } catch (err: any) {
      showToast('Failed to sync saved opportunities.', 'error');
    } finally {
      setSyncing(false);
    }
  };

  // State Transition Update
  const handleUpdateStatus = async (
    targetAppId: string,
    newStatus: ApplicationStage,
    note?: string,
    eventSource: EventSource = 'candidate'
  ) => {
    try {
      const res = await fetchWithAuth(`/api/v1/applications/${targetAppId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          newStatus,
          note,
          eventSource,
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.detail || `Transition to ${newStatus} failed.`);
      }

      const updatedApp: ApplicationRecord = await res.json();
      setApplications((prev) => prev.map((a) => (a.id === targetAppId ? updatedApp : a)));
      showToast(`Status updated to "${newStatus.toUpperCase()}"`, 'success');
    } catch (err: any) {
      showToast(err.message || 'Failed to update status', 'error');
      throw err;
    }
  };

  // Candidate Notes Update
  const handleUpdateNotes = async (targetAppId: string, notes: string) => {
    try {
      const res = await fetchWithAuth(`/api/v1/applications/${targetAppId}/notes`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes }),
      });

      if (!res.ok) {
        throw new Error('Failed to save notes');
      }

      const updatedApp: ApplicationRecord = await res.json();
      setApplications((prev) => prev.map((a) => (a.id === targetAppId ? updatedApp : a)));
    } catch (err: any) {
      showToast(err.message || 'Failed to save notes', 'error');
      throw err;
    }
  };

  // Add Interview Round
  const handleAddInterviewRound = async (
    targetAppId: string,
    roundData: { round: string; scheduledAt?: string; interviewer?: string; notes?: string }
  ) => {
    try {
      const res = await fetchWithAuth(`/api/v1/applications/${targetAppId}/interview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(roundData),
      });

      if (!res.ok) {
        throw new Error('Failed to record interview event');
      }

      const updatedApp: ApplicationRecord = await res.json();
      setApplications((prev) => prev.map((a) => (a.id === targetAppId ? updatedApp : a)));
      showToast('Interview round recorded in timeline.', 'success');
    } catch (err: any) {
      showToast(err.message || 'Failed to add interview round', 'error');
      throw err;
    }
  };

  // Add External / Referral Application
  const handleAddExternalApp = async (appData: {
    company: string;
    jobTitle: string;
    location: string;
    portalUrl?: string;
    salarySnippet?: string;
    initialStatus: ApplicationStage;
    appliedDate?: string;
    notes?: string;
    isExternal: boolean;
  }) => {
    const res = await fetchWithAuth('/api/v1/applications', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(appData),
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.detail || 'Failed to create application');
    }

    const created: ApplicationRecord = await res.json();
    setApplications((prev) => [created, ...prev]);
    showToast(`Application for ${created.company} added to pipeline!`, 'success');
  };

  // PDF Preview / Download Helper
  const handlePreviewResume = async (resumeId: string) => {
    try {
      const res = await fetchWithAuth(`/api/v1/resumes/${resumeId}/pdf`);
      if (!res.ok) throw new Error('PDF not ready or not found');
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      window.open(url, '_blank');
      setTimeout(() => window.URL.revokeObjectURL(url), 15000);
    } catch (err: any) {
      showToast(err.message || 'Could not load PDF resume', 'error');
    }
  };

  // Handle Outcome Decision Choice (Offer vs Rejected)
  const handleOutcomeDecision = async (app: ApplicationRecord, outcome: 'offer' | 'rejected') => {
    try {
      if (outcome === 'offer') {
        await handleUpdateStatus(app.id, 'offer', 'Received formal job offer', 'candidate');
      } else {
        await handleUpdateStatus(app.id, 'rejected', 'Recorded rejection outcome', 'candidate');
      }
    } catch (err) {
      // Toast already shown in handleUpdateStatus
    } finally {
      setOutcomeDecisionApp(null);
    }
  };

  // Filter by date range (only applies to historical stages: applied, interviewing, offer, rejected, archived)
  const dateFilteredApplications = useMemo(() => {
    return applications.filter((a) => isApplicationInDateRange(a, dateRange));
  }, [applications, dateRange]);

  // Filtered applications for search
  const displayedApplications = useMemo(() => {
    if (!searchQuery.trim()) return dateFilteredApplications;
    const q = searchQuery.toLowerCase();
    return dateFilteredApplications.filter(
      (a) =>
        a.company.toLowerCase().includes(q) ||
        a.jobTitle.toLowerCase().includes(q) ||
        a.location?.toLowerCase().includes(q)
    );
  }, [dateFilteredApplications, searchQuery]);

  const selectedApp = useMemo(() => {
    if (!selectedAppId) return null;
    return applications.find((a) => a.id === selectedAppId) || null;
  }, [applications, selectedAppId]);

  return (
    <div className="space-y-6 max-w-7xl mx-auto p-4 md:p-8 animate-in fade-in duration-200">
      {/* Toast Notification */}
      {toast && (
        <div
          className={`fixed bottom-6 right-6 z-50 px-4 py-3 rounded-xl shadow-2xl flex items-center gap-3 text-sm font-medium border backdrop-blur-md transition-all ${
            toast.type === 'success'
              ? 'bg-emerald-950/90 text-emerald-200 border-emerald-500/40'
              : toast.type === 'error'
              ? 'bg-red-950/90 text-red-200 border-red-500/40'
              : 'bg-neutral-900/90 text-neutral-200 border-neutral-700'
          }`}
        >
          {toast.type === 'success' ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          ) : (
            <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
          )}
          <span>{toast.text}</span>
        </div>
      )}

      {/* Header Section */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-border pb-5">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
              <Layers className="w-5 h-5" />
            </div>
            <h1 className="text-xl md:text-2xl font-bold text-white tracking-tight">
              Application Pipeline & Outcome Tracker
            </h1>
          </div>
          <p className="text-xs text-primary-secondary mt-1.5 max-w-2xl">
            Candidate-driven command center for active submissions, immutable ATS resume snapshots, and outcome history.
            Submissions remain 100% human-verified.
          </p>
        </div>

        {/* Header Action Buttons */}
        <div className="flex items-center gap-2.5 shrink-0">
          <button
            onClick={handleSyncFromSaved}
            disabled={syncing}
            className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-neutral-300 bg-surface border border-border hover:bg-surface-hover active:bg-surface rounded-xl transition-all disabled:opacity-50"
            title="Idempotently sync newly saved opportunities into the application pipeline"
          >
            <RefreshCw className={`w-3.5 h-3.5 text-emerald-400 ${syncing ? 'animate-spin' : ''}`} />
            <span>{syncing ? 'Syncing...' : 'Sync Saved'}</span>
          </button>

          <button
            onClick={() => setIsAddModalOpen(true)}
            className="flex items-center gap-2 px-4 py-2 text-xs font-bold text-black bg-emerald-500 hover:bg-emerald-400 active:bg-emerald-600 rounded-xl shadow-lg shadow-emerald-500/20 transition-all cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>Add Application</span>
          </button>
        </div>
      </div>

      {/* Metrics Ribbon */}
      <ApplicationMetricsRibbon
        applications={applications}
        filteredApplications={dateFilteredApplications}
        dateRange={dateRange}
      />

      {/* View Switcher, Date Filter & Search Bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 pt-2">
        {/* Search & Activity Filter Group */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 w-full sm:w-auto">
          {/* Search */}
          <div className="relative w-full sm:w-72">
            <Search className="w-4 h-4 text-neutral-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search company, title, location..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-4 py-2 text-xs bg-surface border border-border rounded-xl text-white placeholder-neutral-500 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition-all"
            />
          </div>

          {/* Activity Date Filter Dropdown */}
          <div className="relative">
            <button
              type="button"
              data-testid="activity-date-filter-button"
              onClick={() => setIsFilterDropdownOpen((prev) => !prev)}
              className="w-full sm:w-auto flex items-center justify-between gap-2 px-3 py-2 text-xs font-medium text-neutral-200 bg-surface border border-border hover:border-border-strong hover:bg-surface-hover rounded-xl transition-all cursor-pointer shadow-sm"
              title="Filter historical stages (Applied, Interviewing, Offers)"
            >
              <div className="flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                <span>
                  Activity:{' '}
                  <span className="text-white font-semibold">
                    {dateRange === 'today'
                      ? 'Today'
                      : dateRange === '7d'
                      ? 'Last 7 Days'
                      : dateRange === '30d'
                      ? 'Last 30 Days'
                      : 'All Time'}
                  </span>
                </span>
              </div>
              <ChevronDown
                className={`w-3.5 h-3.5 text-neutral-400 transition-transform duration-150 ${
                  isFilterDropdownOpen ? 'rotate-180' : ''
                }`}
              />
            </button>

            {isFilterDropdownOpen && (
              <>
                <div
                  className="fixed inset-0 z-20"
                  onClick={() => setIsFilterDropdownOpen(false)}
                />
                <div className="absolute left-0 mt-1.5 w-52 bg-neutral-900 border border-neutral-800 rounded-xl shadow-2xl z-30 p-1 space-y-0.5 animate-in fade-in zoom-in-95 duration-100">
                  <div className="px-2.5 py-1.5 text-[10px] font-semibold text-neutral-500 uppercase tracking-wider">
                    Pipeline Activity
                  </div>
                  {[
                    { id: 'today', label: 'Today', desc: 'Applied / transitioned today' },
                    { id: '7d', label: 'Last 7 Days', desc: 'Default recent activity' },
                    { id: '30d', label: 'Last 30 Days', desc: 'Past 1 month activity' },
                    { id: 'all', label: 'All Time', desc: 'Full application backlog' },
                  ].map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      data-testid={`activity-option-${opt.id}`}
                      onClick={() => {
                        setDateRange(opt.id as ActivityDateRange);
                        setIsFilterDropdownOpen(false);
                      }}
                      className={`w-full flex items-center justify-between px-2.5 py-2 rounded-lg text-xs text-left transition-colors cursor-pointer ${
                        dateRange === opt.id
                          ? 'bg-emerald-500/15 text-emerald-300 font-semibold'
                          : 'text-neutral-300 hover:bg-neutral-800/80 hover:text-white'
                      }`}
                    >
                      <div>
                        <div className="font-medium">{opt.label}</div>
                        <div className="text-[10px] text-neutral-500 font-normal">{opt.desc}</div>
                      </div>
                      {dateRange === opt.id && <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>

        {/* View Mode Toggle */}
        <div className="flex items-center gap-1 bg-surface p-1 rounded-xl border border-border self-end sm:self-auto">
          <button
            onClick={() => setActiveView('kanban')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer ${
              activeView === 'kanban'
                ? 'bg-emerald-500 text-black font-bold shadow-sm'
                : 'text-neutral-400 hover:text-white'
            }`}
          >
            <Kanban className="w-3.5 h-3.5" />
            <span>Pipeline Board</span>
          </button>
          <button
            onClick={() => setActiveView('table')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer ${
              activeView === 'table'
                ? 'bg-emerald-500 text-black font-bold shadow-sm'
                : 'text-neutral-400 hover:text-white'
            }`}
          >
            <TableIcon className="w-3.5 h-3.5" />
            <span>Table View</span>
          </button>
        </div>
      </div>

      {/* Main Content Area */}
      {loading ? (
        <div className="py-20 flex flex-col items-center justify-center gap-3 text-neutral-400">
          <div className="w-8 h-8 border-2 border-emerald-500/20 border-t-emerald-500 rounded-full animate-spin" />
          <span className="text-xs font-medium">Loading application pipeline...</span>
        </div>
      ) : error ? (
        <div className="p-6 bg-red-500/10 border border-red-500/30 rounded-2xl text-center space-y-3">
          <AlertCircle className="w-8 h-8 text-red-400 mx-auto" />
          <div className="text-sm font-semibold text-red-300">{error}</div>
          <button
            onClick={() => fetchApplications()}
            className="px-4 py-2 bg-red-500/20 hover:bg-red-500/30 text-red-300 rounded-xl text-xs font-medium transition-all cursor-pointer"
          >
            Retry
          </button>
        </div>
      ) : applications.length === 0 ? (
        <div className="py-20 border border-dashed border-border rounded-2xl flex flex-col items-center justify-center text-center px-4">
          <div className="p-4 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 mb-3">
            <Layers className="w-8 h-8" />
          </div>
          <h3 className="text-base font-bold text-white mb-1">No Applications Tracked Yet</h3>
          <p className="text-xs text-neutral-400 max-w-sm mb-5">
            Save opportunities in the Job Finder or click below to sync saved opportunities or add an external referral application.
          </p>
          <div className="flex items-center gap-3">
            <button
              onClick={handleSyncFromSaved}
              className="flex items-center gap-2 px-4 py-2 text-xs font-medium text-neutral-300 bg-surface border border-border hover:bg-surface-hover rounded-xl transition-all cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5 text-emerald-400" />
              <span>Sync Saved Opportunities</span>
            </button>
            <button
              onClick={() => setIsAddModalOpen(true)}
              className="flex items-center gap-2 px-4 py-2 text-xs font-bold text-black bg-emerald-500 hover:bg-emerald-400 rounded-xl shadow-lg shadow-emerald-500/20 transition-all cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>Add Off-Platform Application</span>
            </button>
          </div>
        </div>
      ) : activeView === 'kanban' ? (
        <ApplicationKanbanBoard
          applications={displayedApplications}
          dateRange={dateRange}
          onResetDateFilter={() => setDateRange('all')}
          onSelect={(app) => setSelectedAppId(app.id)}
          onMoveStage={(app, newStage, note) => handleUpdateStatus(app.id, newStage, note, 'candidate')}
          onPreviewResume={handlePreviewResume}
          onAutofillPrompt={(app) => setAutofillApp(app)}
          onOpenQaCopilot={(app) => setQaModalApp(app)}
          onMissingResume={(app) => setMissingResumeApp(app)}
          onPromptOutcome={(app) => setOutcomeDecisionApp(app)}
        />
      ) : (
        <ApplicationTableView
          applications={displayedApplications}
          onSelect={(app) => setSelectedAppId(app.id)}
          onPreviewResume={handlePreviewResume}
          onMoveStage={(app, newStage, note) => handleUpdateStatus(app.id, newStage, note, 'candidate')}
        />
      )}

      {/* Details Slide-Over Drawer */}
      <ApplicationDetailsDrawer
        application={selectedApp}
        onClose={() => setSelectedAppId(null)}
        onUpdateStatus={async (newStatus, note, eventSource) => {
          if (selectedApp) {
            await handleUpdateStatus(selectedApp.id, newStatus, note, eventSource);
          }
        }}
        onUpdateNotes={async (notes) => {
          if (selectedApp) {
            await handleUpdateNotes(selectedApp.id, notes);
          }
        }}
        onAddInterviewRound={async (roundData) => {
          if (selectedApp) {
            await handleAddInterviewRound(selectedApp.id, roundData);
          }
        }}
        onPreviewResume={handlePreviewResume}
        onAutofillPrompt={(app) => setAutofillApp(app)}
      />

      {/* Add Off-Platform Application Modal */}
      <AddExternalAppModal
        isOpen={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
        onSubmit={handleAddExternalApp}
      />

      {/* Missing Tailored Resume Modal (Notion Dark Theme) */}
      <MissingResumeModal
        isOpen={Boolean(missingResumeApp)}
        application={missingResumeApp}
        onClose={() => setMissingResumeApp(null)}
        onOpenResumeStudio={(app) => {
          setMissingResumeApp(null);
          setResumeStudioApp(app);
        }}
      />

      {/* Outcome Decision Modal (Offer Received vs Rejected vs Cancel) */}
      <OutcomeDecisionModal
        isOpen={Boolean(outcomeDecisionApp)}
        application={outcomeDecisionApp}
        onClose={() => setOutcomeDecisionApp(null)}
        onSelectOutcome={handleOutcomeDecision}
      />

      {/* Resume Studio Modal for Application Gating */}
      {resumeStudioApp && (
        <ResumeStudioModal
          isOpen={Boolean(resumeStudioApp)}
          onClose={() => setResumeStudioApp(null)}
          jobId={resumeStudioApp.jobId || resumeStudioApp.id}
          jobTitle={resumeStudioApp.jobTitle}
          jobCompany={resumeStudioApp.company}
          onApplicationApproved={async () => {
            await fetchApplications(true);
            showToast(
              `Resume approved! ${resumeStudioApp.jobTitle} moved to Ready to Apply.`,
              'success'
            );
            setResumeStudioApp(null);
          }}
        />
      )}

      {/* ATS Custom Question Co-Pilot Modal */}
      {qaModalApp && (
        <AtsQuestionCopilotModal
          application={qaModalApp}
          isOpen={!!qaModalApp}
          onClose={() => setQaModalApp(null)}
        />
      )}

      {/* Playwright Deterministic Autofill Modal */}
      <PlaywrightAutofillModal
        isOpen={!!autofillApp}
        application={autofillApp}
        onClose={() => setAutofillApp(null)}
        onSuccess={(updatedApp) => {
          setApplications((prev) =>
            prev.map((a) => (a.id === updatedApp.id ? updatedApp : a))
          );
          showToast(
            `Application for ${updatedApp.company} moved to Applied.`,
            'success'
          );
          setAutofillApp(null);
        }}
      />
    </div>
  );
};
