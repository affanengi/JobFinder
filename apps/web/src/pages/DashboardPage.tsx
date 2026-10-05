import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Sparkles,
  ShieldCheck,
  ArrowRight,
  Send,
  CheckCircle2,
  Bookmark,
  ExternalLink,
  Layers,
  FileText,
  ScanText,
  Cpu,
  Clock,
  Building2,
  RefreshCw,
  Check,
  ChevronRight,
} from 'lucide-react';
import { ScoreIndicator } from '../components/recommendations/ScoreIndicator';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { fetchWithAuth } from '../lib/api';
import { ApplicationRecord } from '../types/application';
import { getRelativeTimeLabel } from '../components/applications/dateFilterUtils';

interface ScoredJob {
  id: string;
  title: string;
  company: string;
  location: string;
  workMode: string;
  status?: string;
  requiredSkills?: string[];
  recommendation?: {
    score: number;
    category: any;
    reasoning?: string;
  };
}

interface ProfileSummary {
  fullName: string;
  headline?: string;
  skillsCount: number;
  experiencesCount: number;
  projectsCount: number;
}

interface ToolkitStats {
  resumesCount: number;
  latestScan?: {
    name: string;
    score: number;
    grade: string;
  } | null;
  aiCredentialsCount: number;
  aiProvidersCount: number;
  aiHealthy: boolean;
}

interface DashboardPageProps {
  onNavigateToOpportunities: () => void;
  onNavigateToTab?: (tab: string, param?: string) => void;
}

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

export function DashboardPage({
  onNavigateToOpportunities,
  onNavigateToTab,
}: DashboardPageProps) {
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<ProfileSummary | null>(null);
  const [recommendations, setRecommendations] = useState<ScoredJob[]>([]);
  const [applications, setApplications] = useState<ApplicationRecord[]>([]);
  const [toolkit, setToolkit] = useState<ToolkitStats>({
    resumesCount: 0,
    latestScan: null,
    aiCredentialsCount: 0,
    aiProvidersCount: 0,
    aiHealthy: true,
  });
  const [actionSuccessAppId, setActionSuccessAppId] = useState<string | null>(null);

  const loadDashboardData = useCallback(async () => {
    setLoading(true);
    try {
      const [
        profileRes,
        recsRes,
        appsRes,
        resumesRes,
        scansRes,
        aiCredsRes,
        aiHealthRes,
      ] = await Promise.all([
        fetchWithAuth('/api/v1/profile').then((r) => (r.ok ? r.json() : null)).catch(() => null),
        fetchWithAuth('/api/v1/recommendations').then((r) => (r.ok ? r.json() : [])).catch(() => []),
        fetchWithAuth('/api/v1/applications').then((r) => (r.ok ? r.json() : [])).catch(() => []),
        fetchWithAuth('/api/v1/resumes').then((r) => (r.ok ? r.json() : [])).catch(() => []),
        fetchWithAuth('/api/v1/scanner/reports').then((r) => (r.ok ? r.json() : [])).catch(() => []),
        fetchWithAuth('/api/v1/ai/credentials').then((r) => (r.ok ? r.json() : [])).catch(() => []),
        fetchWithAuth('/api/v1/ai/health').then((r) => (r.ok ? r.json() : null)).catch(() => null),
      ]);

      if (profileRes) {
        setProfile({
          fullName: profileRes.personal?.fullName || profileRes.fullName || 'Candidate',
          headline: profileRes.headline || profileRes.personal?.headline,
          skillsCount: Array.isArray(profileRes.skills) ? profileRes.skills.length : 0,
          experiencesCount: Array.isArray(profileRes.experience) ? profileRes.experience.length : 0,
          projectsCount: Array.isArray(profileRes.projects) ? profileRes.projects.length : 0,
        });
      }

      if (Array.isArray(recsRes)) {
        setRecommendations(recsRes);
      }

      if (Array.isArray(appsRes)) {
        setApplications(appsRes);
      }

      const providers = new Set(
        Array.isArray(aiCredsRes) ? aiCredsRes.map((c: any) => c.provider) : []
      );
      const latestScan = Array.isArray(scansRes) && scansRes.length > 0 ? scansRes[0] : null;

      setToolkit({
        resumesCount: Array.isArray(resumesRes) ? resumesRes.length : 0,
        latestScan: latestScan
          ? {
              name: latestScan.reportName || latestScan.jobTitle || 'ATS Report',
              score: latestScan.overallScore ?? 0,
              grade: latestScan.grade || 'A',
            }
          : null,
        aiCredentialsCount: Array.isArray(aiCredsRes) ? aiCredsRes.length : 0,
        aiProvidersCount: providers.size,
        aiHealthy: aiHealthRes?.healthyCredentialsCount !== 0,
      });
    } catch (e) {
      console.error('Failed to load dashboard data:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDashboardData();
  }, [loadDashboardData]);

  // Navigate helper
  const navigateTo = (tab: string, param?: string) => {
    if (onNavigateToTab) {
      onNavigateToTab(tab, param);
    } else if (tab === 'opportunities') {
      onNavigateToOpportunities();
    }
  };

  // 1. High-Fit Matches (Score >= 80% and unapplied)
  const highFitCount = useMemo(() => {
    return recommendations.filter(
      (j) => (!j.status || j.status === 'recommended') && (j.recommendation?.score ?? 0) >= 80
    ).length;
  }, [recommendations]);

  const unactionedTotal = useMemo(() => {
    return recommendations.filter((j) => !j.status || j.status === 'recommended').length;
  }, [recommendations]);

  // 2. Ready to Submit
  const readyApplications = useMemo(() => {
    return applications.filter((a) => a.status === 'ready');
  }, [applications]);

  // 3. In Flight Applications & recent activity
  const inFlightCount = useMemo(() => {
    return applications.filter((a) =>
      ['applied', 'interviewing', 'offer'].includes(a.status)
    ).length;
  }, [applications]);

  const appliedLast7Days = useMemo(() => {
    const now = Date.now();
    return applications.filter((a) => {
      if (!['applied', 'interviewing', 'offer'].includes(a.status)) return false;
      const ts = a.stageTimestamps?.applied || a.appliedAt || a.createdAt;
      if (!ts) return false;
      const diffDays = (now - new Date(ts).getTime()) / (1000 * 60 * 60 * 24);
      return diffDays >= 0 && diffDays <= 7;
    }).length;
  }, [applications]);

  // 4. Saved Opportunities
  const savedOpportunities = useMemo(() => {
    return recommendations.filter((j) => j.status === 'saved');
  }, [recommendations]);

  // Top 3 live recommendations
  const topMatches = useMemo(() => {
    return recommendations
      .filter((j) => !j.status || j.status === 'recommended')
      .sort((a, b) => (b.recommendation?.score ?? 0) - (a.recommendation?.score ?? 0))
      .slice(0, 3);
  }, [recommendations]);

  // Recent 4 applications sorted by updatedAt/appliedAt
  const recentApplications = useMemo(() => {
    return [...applications]
      .sort((a, b) => {
        const tA = new Date(a.updatedAt || a.createdAt).getTime();
        const tB = new Date(b.updatedAt || b.createdAt).getTime();
        return tB - tA;
      })
      .slice(0, 4);
  }, [applications]);

  // Quick Action: Mark application applied from Dashboard
  const handleMarkApplied = async (appId: string) => {
    try {
      const res = await fetchWithAuth(`/api/v1/applications/${appId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          newStatus: 'applied',
          note: 'Marked as applied via Dashboard action banner',
          eventSource: 'candidate',
        }),
      });
      if (res.ok) {
        setActionSuccessAppId(appId);
        setTimeout(() => setActionSuccessAppId(null), 3000);
        await loadDashboardData();
      }
    } catch (e) {
      console.error('Failed to mark applied:', e);
    }
  };

  const firstName = profile?.fullName ? profile.fullName.split(' ')[0] : 'Candidate';

  return (
    <div className="space-y-6 max-w-6xl mx-auto p-4 md:p-8 animate-in fade-in duration-150">
      {/* 1. Command Header */}
      <div className="bg-surface rounded-2xl border border-border p-6 md:p-8 shadow-sm space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-surface-subtle text-primary-secondary text-xs font-medium border border-border">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
            <span>Autonomous Discovery Active · Human-Controlled Execution</span>
          </div>

          <div className="inline-flex items-center gap-2 text-xs font-medium text-neutral-400">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-neutral-300">Firestore Synced • AI Hub Active</span>
          </div>
        </div>

        <div className="pt-1">
          <h1 className="text-2xl md:text-3xl font-bold text-white tracking-tight">
            {getGreeting()}, {firstName}
          </h1>
          <p className="text-xs md:text-sm text-neutral-400 mt-1 max-w-2xl leading-relaxed">
            {profile?.headline ||
              (profile && profile.skillsCount > 0
                ? `Career Command Center · ${profile.skillsCount} Verified Skills & ${profile.projectsCount} Proven Projects`
                : 'Your personal AI career command center with zero-hallucination verification.')}
          </p>
        </div>
      </div>

      {/* 2. Live Career Pulse (4 KPI Cards) */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3.5">
        {/* High-Fit Matches */}
        <div
          onClick={onNavigateToOpportunities}
          className="bg-surface hover:bg-surface-hover/80 p-5 rounded-2xl border border-border hover:border-emerald-500/40 transition-all cursor-pointer shadow-sm group flex flex-col justify-between"
        >
          <div className="flex items-center justify-between text-neutral-400 mb-1">
            <span className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wider">
              High-Fit Matches
            </span>
            <Sparkles className="w-4 h-4 text-emerald-400 group-hover:scale-110 transition-transform" />
          </div>
          <div>
            <div className="text-3xl font-bold text-white tracking-tight tabular-nums">
              {loading ? '—' : highFitCount}
            </div>
            <div className="text-[11px] text-emerald-400 font-medium mt-1 flex items-center gap-1">
              <span>Score ≥ 80%</span>
              <span className="text-neutral-500">• {unactionedTotal} Total</span>
            </div>
          </div>
        </div>

        {/* Ready to Submit */}
        <div
          onClick={() => navigateTo('applications')}
          className="bg-surface hover:bg-surface-hover/80 p-5 rounded-2xl border border-border hover:border-emerald-500/40 transition-all cursor-pointer shadow-sm group flex flex-col justify-between"
        >
          <div className="flex items-center justify-between text-neutral-400 mb-1">
            <span className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wider">
              Ready to Submit
            </span>
            <CheckCircle2 className="w-4 h-4 text-emerald-400 group-hover:scale-110 transition-transform" />
          </div>
          <div>
            <div className="text-3xl font-bold text-emerald-400 tracking-tight tabular-nums">
              {loading ? '—' : readyApplications.length}
            </div>
            <div className="text-[11px] text-neutral-400 font-medium mt-1">
              {readyApplications.length === 1 ? '1 Approved Resume' : `${readyApplications.length} Approved Resumes`}
            </div>
          </div>
        </div>

        {/* Active Submissions */}
        <div
          onClick={() => navigateTo('applications')}
          className="bg-surface hover:bg-surface-hover/80 p-5 rounded-2xl border border-border hover:border-blue-500/40 transition-all cursor-pointer shadow-sm group flex flex-col justify-between"
        >
          <div className="flex items-center justify-between text-neutral-400 mb-1">
            <span className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wider">
              In-Flight Apps
            </span>
            <Send className="w-4 h-4 text-blue-400 group-hover:scale-110 transition-transform" />
          </div>
          <div>
            <div className="text-3xl font-bold text-white tracking-tight tabular-nums">
              {loading ? '—' : inFlightCount}
            </div>
            <div className="text-[11px] text-neutral-400 font-medium mt-1">
              {appliedLast7Days} active in last 7 days
            </div>
          </div>
        </div>

        {/* Saved Backlog */}
        <div
          onClick={onNavigateToOpportunities}
          className="bg-surface hover:bg-surface-hover/80 p-5 rounded-2xl border border-border hover:border-purple-500/40 transition-all cursor-pointer shadow-sm group flex flex-col justify-between"
        >
          <div className="flex items-center justify-between text-neutral-400 mb-1">
            <span className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wider">
              Saved Backlog
            </span>
            <Bookmark className="w-4 h-4 text-purple-400 group-hover:scale-110 transition-transform" />
          </div>
          <div>
            <div className="text-3xl font-bold text-white tracking-tight tabular-nums">
              {loading ? '—' : savedOpportunities.length}
            </div>
            <div className="text-[11px] text-neutral-400 font-medium mt-1">
              Roles waiting tailoring
            </div>
          </div>
        </div>
      </div>

      {/* 3. Action Required ("Needs Your Attention") */}
      {readyApplications.length > 0 ? (
        <div className="bg-emerald-950/20 border border-emerald-500/30 rounded-2xl p-5 md:p-6 shadow-sm">
          <div className="flex items-center justify-between gap-3 pb-3 border-b border-emerald-500/20 mb-4">
            <div className="flex items-center gap-2">
              <span className="flex h-2 w-2 relative">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
              </span>
              <span className="text-xs font-bold text-emerald-400 uppercase tracking-wider">
                Action Required: Ready for Submission ({readyApplications.length})
              </span>
            </div>
            <button
              onClick={() => navigateTo('applications')}
              className="text-xs text-emerald-400 hover:text-emerald-300 font-medium inline-flex items-center gap-1 cursor-pointer"
            >
              <span>View in pipeline</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="space-y-3">
            {readyApplications.slice(0, 2).map((app) => (
              <div
                key={app.id}
                className="bg-neutral-900/80 rounded-xl border border-neutral-800 p-4 flex flex-col md:flex-row items-start md:items-center justify-between gap-4"
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-semibold text-white">{app.jobTitle}</h3>
                    {app.location && (
                      <span className="text-[10px] text-neutral-400 px-2 py-0.5 rounded bg-neutral-800">
                        {app.location}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 text-xs text-neutral-400">
                    <Building2 className="w-3.5 h-3.5 text-neutral-500" />
                    <span>{app.company}</span>
                    {app.atsScoreSnapshot?.overallScore !== undefined && (
                      <>
                        <span className="text-neutral-600">•</span>
                        <span className="text-emerald-400 font-semibold">
                          {app.atsScoreSnapshot.overallScore}% ATS Match
                        </span>
                      </>
                    )}
                    {app.resumeSnapshot?.resumeId && (
                      <>
                        <span className="text-neutral-600">•</span>
                        <span className="text-neutral-300 flex items-center gap-1">
                          <Check className="w-3 h-3 text-emerald-400" /> Tailored Resume Ready
                        </span>
                      </>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2 w-full md:w-auto justify-end">
                  {app.portalUrl && (
                    <a
                      href={app.portalUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="px-3 py-1.5 rounded-lg border border-neutral-700 hover:bg-neutral-800 text-neutral-200 text-xs font-medium inline-flex items-center gap-1.5 transition-colors"
                    >
                      <span>Open Portal</span>
                      <ExternalLink className="w-3.5 h-3.5 text-neutral-400" />
                    </a>
                  )}

                  <button
                    onClick={() => handleMarkApplied(app.id)}
                    disabled={actionSuccessAppId === app.id}
                    className="px-3.5 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 active:bg-emerald-600 text-black text-xs font-bold shadow-md shadow-emerald-500/20 transition-all inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                  >
                    {actionSuccessAppId === app.id ? (
                      <>
                        <Check className="w-3.5 h-3.5" />
                        <span>Applied!</span>
                      </>
                    ) : (
                      <>
                        <Send className="w-3.5 h-3.5" />
                        <span>Mark as Applied</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : savedOpportunities.length > 0 ? (
        <div className="bg-purple-950/20 border border-purple-500/30 rounded-2xl p-5 shadow-sm flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="text-xs font-bold text-purple-400 uppercase tracking-wider flex items-center gap-1.5">
              <Bookmark className="w-3.5 h-3.5" />
              <span>Next Recommended Action: Tailor Saved Role</span>
            </div>
            <p className="text-xs text-neutral-300">
              You have <span className="text-white font-semibold">{savedOpportunities.length} saved roles</span> in your preparation queue. Tailor a zero-hallucination resume to advance to Ready to Apply.
            </p>
          </div>
          <button
            onClick={onNavigateToOpportunities}
            className="px-3.5 py-2 rounded-xl bg-purple-500 hover:bg-purple-400 text-black text-xs font-bold transition-all shadow-md shadow-purple-500/20 inline-flex items-center gap-1.5 shrink-0 cursor-pointer"
          >
            <span>Tailor Resume</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      ) : null}

      {/* 4. Strongest Recommended Matches */}
      <div className="space-y-3.5">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-white tracking-tight flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-emerald-400" />
            <span>Strongest Recommended Matches</span>
          </h2>
          <button
            onClick={onNavigateToOpportunities}
            className="text-xs text-neutral-400 hover:text-white font-medium inline-flex items-center gap-1 transition-colors cursor-pointer"
          >
            <span>View all opportunities ({unactionedTotal})</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>

        {loading ? (
          <div className="py-12 flex flex-col items-center justify-center gap-2 text-neutral-500">
            <RefreshCw className="w-5 h-5 animate-spin text-emerald-400" />
            <span className="text-xs">Evaluating opportunities against your verified profile...</span>
          </div>
        ) : topMatches.length === 0 ? (
          <div className="p-8 border border-dashed border-border rounded-2xl text-center space-y-2">
            <p className="text-xs text-neutral-400">
              No recommended opportunities match your current filters.
            </p>
            <Button variant="outline" size="sm" onClick={() => navigateTo('settings')}>
              Adjust Job Discovery Settings
            </Button>
          </div>
        ) : (
          <div className="space-y-2.5">
            {topMatches.map((job) => (
              <div
                key={job.id}
                className="bg-surface hover:bg-surface-hover/80 p-4 md:p-5 rounded-xl border border-border hover:border-border-strong transition-all flex flex-col md:flex-row items-start md:items-center justify-between gap-4 shadow-sm"
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-semibold text-white">{job.title}</h3>
                    {job.workMode && (
                      <Badge variant="outline" size="sm" className="capitalize text-[10px]">
                        {job.workMode}
                      </Badge>
                    )}
                  </div>
                  <div className="text-xs text-neutral-400 flex items-center gap-2">
                    <span className="font-medium text-neutral-300">{job.company}</span>
                    <span className="text-neutral-600">•</span>
                    <span>{job.location}</span>
                    {Array.isArray(job.requiredSkills) && job.requiredSkills.length > 0 && (
                      <>
                        <span className="text-neutral-600">•</span>
                        <span className="text-neutral-500 line-clamp-1">
                          {job.requiredSkills.slice(0, 3).join(', ')}
                        </span>
                      </>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-3 w-full md:w-auto justify-between md:justify-end shrink-0">
                  {job.recommendation && (
                    <ScoreIndicator
                      score={job.recommendation.score}
                      category={job.recommendation.category}
                      size="sm"
                    />
                  )}
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={onNavigateToOpportunities}
                    className="cursor-pointer"
                  >
                    <span>Review & Apply</span>
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 5. Lower Split Section: Recent Activity & Career Assets */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Left Column: Recent Pipeline Activity */}
        <div className="bg-surface rounded-2xl border border-border p-5 space-y-3.5 shadow-sm">
          <div className="flex items-center justify-between border-b border-border pb-3">
            <h3 className="text-xs font-bold text-neutral-300 uppercase tracking-wider flex items-center gap-2">
              <Clock className="w-3.5 h-3.5 text-blue-400" />
              <span>Recent Pipeline Activity</span>
            </h3>
            <button
              onClick={() => navigateTo('applications')}
              className="text-[11px] text-neutral-400 hover:text-white transition-colors cursor-pointer"
            >
              View Pipeline ➔
            </button>
          </div>

          {recentApplications.length === 0 ? (
            <div className="py-8 text-center text-xs text-neutral-500">
              No recent application activity logged yet.
            </div>
          ) : (
            <div className="space-y-3">
              {recentApplications.map((app) => {
                const isApplied = app.status === 'applied';
                const isReady = app.status === 'ready';
                const isInterviewing = app.status === 'interviewing';
                const isOffer = app.status === 'offer';

                const activityLabel = isApplied
                  ? `Applied to ${app.company}`
                  : isReady
                  ? `Ready to Apply: ${app.company}`
                  : isInterviewing
                  ? `Interviewing at ${app.company}`
                  : isOffer
                  ? `Offer from ${app.company}`
                  : `Saved ${app.company}`;

                const dateStr =
                  app.stageTimestamps?.applied ||
                  app.stageTimestamps?.ready ||
                  app.updatedAt ||
                  app.createdAt;

                return (
                  <div
                    key={app.id}
                    onClick={() => navigateTo('applications')}
                    className="p-2.5 rounded-xl hover:bg-neutral-900/60 transition-colors cursor-pointer flex items-center justify-between gap-3 text-xs"
                  >
                    <div className="flex items-center gap-2.5">
                      <div
                        className={`p-1.5 rounded-lg shrink-0 ${
                          isApplied
                            ? 'bg-blue-500/10 text-blue-400'
                            : isReady
                            ? 'bg-emerald-500/10 text-emerald-400'
                            : isInterviewing
                            ? 'bg-amber-500/10 text-amber-400'
                            : isOffer
                            ? 'bg-purple-500/10 text-purple-400'
                            : 'bg-neutral-800 text-neutral-400'
                        }`}
                      >
                        {isApplied ? (
                          <Send className="w-3.5 h-3.5" />
                        ) : isReady ? (
                          <CheckCircle2 className="w-3.5 h-3.5" />
                        ) : isInterviewing ? (
                          <Clock className="w-3.5 h-3.5" />
                        ) : isOffer ? (
                          <Check className="w-3.5 h-3.5" />
                        ) : (
                          <Layers className="w-3.5 h-3.5" />
                        )}
                      </div>
                      <div>
                        <div className="font-medium text-white">{activityLabel}</div>
                        <div className="text-[10px] text-neutral-400 line-clamp-1">{app.jobTitle}</div>
                      </div>
                    </div>

                    <div className="text-[10px] text-neutral-500 shrink-0 text-right">
                      {getRelativeTimeLabel(dateStr, '')}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Right Column: Career Assets & AI Status */}
        <div className="bg-surface rounded-2xl border border-border p-5 space-y-3.5 shadow-sm flex flex-col justify-between">
          <div className="border-b border-border pb-3">
            <h3 className="text-xs font-bold text-neutral-300 uppercase tracking-wider flex items-center gap-2">
              <Cpu className="w-3.5 h-3.5 text-emerald-400" />
              <span>Career Assets & AI System</span>
            </h3>
          </div>

          <div className="space-y-3">
            {/* Tailored Resumes */}
            <div
              onClick={() => navigateTo('resumes')}
              className="p-3 rounded-xl bg-neutral-900/60 border border-neutral-800 hover:border-neutral-700 transition-all cursor-pointer flex items-center justify-between"
            >
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-400">
                  <FileText className="w-4 h-4" />
                </div>
                <div>
                  <div className="text-xs font-semibold text-white">
                    {toolkit.resumesCount} Tailored Resumes
                  </div>
                  <div className="text-[10px] text-neutral-400">
                    Compiled via ReportLab • 100% Truth-Locked
                  </div>
                </div>
              </div>
              <ChevronRight className="w-4 h-4 text-neutral-500" />
            </div>

            {/* ATS Scanner */}
            <div
              onClick={() => navigateTo('scanner')}
              className="p-3 rounded-xl bg-neutral-900/60 border border-neutral-800 hover:border-neutral-700 transition-all cursor-pointer flex items-center justify-between"
            >
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-blue-500/10 text-blue-400">
                  <ScanText className="w-4 h-4" />
                </div>
                <div>
                  <div className="text-xs font-semibold text-white">
                    {toolkit.latestScan
                      ? `ATS Score: ${toolkit.latestScan.score}% (Grade ${toolkit.latestScan.grade})`
                      : '100-Point ATS Scanner'}
                  </div>
                  <div className="text-[10px] text-neutral-400 line-clamp-1">
                    {toolkit.latestScan ? toolkit.latestScan.name : 'Ready to evaluate candidate resumes'}
                  </div>
                </div>
              </div>
              <ChevronRight className="w-4 h-4 text-neutral-500" />
            </div>

            {/* AI Hub Credentials & Providers */}
            <div
              onClick={() => navigateTo('settings')}
              className="p-3 rounded-xl bg-neutral-900/60 border border-neutral-800 hover:border-neutral-700 transition-all cursor-pointer flex items-center justify-between"
            >
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-purple-500/10 text-purple-400">
                  <Cpu className="w-4 h-4" />
                </div>
                <div>
                  <div className="text-xs font-semibold text-white">
                    {toolkit.aiCredentialsCount} AI Credentials · {toolkit.aiProvidersCount} Providers
                  </div>
                  <div className="text-[10px] text-emerald-400 font-medium">
                    {toolkit.aiHealthy ? '100% Operational • 0 Active Cooldowns' : 'Diagnostic check recommended'}
                  </div>
                </div>
              </div>
              <ChevronRight className="w-4 h-4 text-neutral-500" />
            </div>
          </div>

          <div className="pt-2 text-[10px] text-neutral-500 border-t border-border flex items-center justify-between">
            <span>Human-in-the-Loop Safe</span>
            <span>Zero Hallucination Guaranteed</span>
          </div>
        </div>
      </div>
    </div>
  );
}
