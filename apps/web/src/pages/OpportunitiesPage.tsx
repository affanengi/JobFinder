import React, { useState, useEffect } from 'react';
import { 
  Sparkles, 
  Search, 
  MapPin, 
  CheckCircle2, 
  AlertTriangle, 
  ArrowUpRight, 
  Bookmark, 
  Trash2, 
  DollarSign, 
  Plus, 
  Loader2, 
  RefreshCw, 
  Globe, 
  GraduationCap, 
  Clock,
  Layers,
  SlidersHorizontal,
  LayoutGrid,
  List,
  Calendar,
} from 'lucide-react';
import { AddJobModal, CanonicalJobDTO } from '../components/recommendations/AddJobModal';
import { ThemeDropdown } from '../components/common/ThemeDropdown';
import { fetchWithAuth } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { ResumeStudioModal } from '../components/resume/ResumeStudioModal';
import { DeleteConfirmModal } from '../components/ui/DeleteConfirmModal';
import { CompanyFilterRibbon, CompanyMetric, getCanonicalCompanyInfo } from '../components/recommendations/CompanyFilterRibbon';
import { OpportunityDetailsModal } from '../components/recommendations/OpportunityDetailsModal';
import { JobDescriptionBlock } from '../components/recommendations/StructuredJobDescription';

interface ScoredOpportunityDTO {
  id: string;
  title: string;
  company: string;
  location: string;
  workMode: 'remote' | 'hybrid' | 'onsite';
  category: 'technical' | 'data' | 'qa' | 'non_technical';
  employmentType: string;
  seniority: string;
  fitScore: number;
  matchTier: 'Strong' | 'Good' | 'Moderate' | 'Low' | 'Not a Match';
  fitReason: string;
  matchedSkills: string[];
  missingSkills: string[];
  experienceYearsRequired?: number;
  experienceText?: string;
  postedAt?: string;
  postedDateText?: string;
  salaryText?: string;
  description: string;
  descriptionBlocks?: JobDescriptionBlock[];
  sourceUrl: string;
  sourceAdapter: string;
  status?: 'recommended' | 'saved' | 'applied' | 'archived';
}

const CATEGORY_OPTIONS = [
  { value: 'all', label: 'All Roles' },
  { value: 'technical', label: 'AI & Technical' },
  { value: 'data', label: 'Data & Analytics' },
  { value: 'qa', label: 'QA & Testing' },
  { value: 'non_technical', label: 'Business & Ops' },
];

const WORK_MODE_OPTIONS = [
  { value: 'all', label: 'All Work Modes' },
  { value: 'remote', label: 'Remote Only' },
  { value: 'hybrid', label: 'Hybrid' },
  { value: 'onsite', label: 'Onsite' },
];

const SCORE_OPTIONS = [
  { value: 'all', label: 'All Match Scores' },
  { value: '90', label: 'Strong (90%+)' },
  { value: '75', label: 'Good (75%+)' },
  { value: '50', label: 'Moderate (50%+)' },
  { value: '35', label: 'Low (35%+)' },
];

interface OpportunitiesPageProps {
  onCountChange?: (count: number) => void;
}

export const OpportunitiesPage: React.FC<OpportunitiesPageProps> = ({ onCountChange }) => {
  const { user } = useAuth();
  const [opportunities, setOpportunities] = useState<ScoredOpportunityDTO[]>([]);
  const [activeSubTab, setActiveSubTab] = useState<'recommended' | 'saved' | 'applied' | 'archived'>('recommended');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedWorkMode, setSelectedWorkMode] = useState<string>('all');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [selectedScoreFilter, setSelectedScoreFilter] = useState<string>('all');
  
  const [isLoading, setIsLoading] = useState(true);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isDiscovering, setIsDiscovering] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Resume Studio state
  const [selectedJobForResume, setSelectedJobForResume] = useState<ScoredOpportunityDTO | null>(null);
  const [isResumeModalOpen, setIsResumeModalOpen] = useState(false);
  const [jobToDismiss, setJobToDismiss] = useState<ScoredOpportunityDTO | null>(null);

  // Details Modal & Company Ribbon filter state
  const [selectedCompany, setSelectedCompany] = useState<string | null>(null);
  const [selectedDetailsJob, setSelectedDetailsJob] = useState<ScoredOpportunityDTO | null>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3500);
  };

  const fetchRecommendations = async () => {
    setIsLoading(true);
    try {
      const res = await fetchWithAuth('/api/v1/recommendations');
      if (res.ok) {
        const data: ScoredOpportunityDTO[] = await res.json();
        const mapped = data.map((item) => ({
          ...item,
          status: item.status || 'recommended',
        }));
        setOpportunities(mapped);
        if (onCountChange) {
          onCountChange(mapped.filter((o) => o.status === 'recommended').length);
        }
      }
    } catch (err) {
      console.error('Failed to load recommended opportunities:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchRecommendations();
  }, [user]);

  const handleRunDiscovery = async () => {
    setIsDiscovering(true);
    try {
      const res = await fetchWithAuth('/api/v1/jobs/discover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          limitPerCompany: 15,
        }),
      });

      if (!res.ok) {
        throw new Error('Discovery request failed');
      }

      await fetchRecommendations();
      showToast('Live discovery complete! Ingested jobs across Ashby, Lever & Greenhouse.');
    } catch (err) {
      console.error(err);
      showToast('Error running live discovery. Please try again.');
    } finally {
      setIsDiscovering(false);
    }
  };

  const handleJobAdded = async (newJob: CanonicalJobDTO) => {
    await fetchRecommendations();
    showToast(`Added "${newJob.title}" at ${newJob.company}! Scored against your verified profile.`);
  };

  const updateStatus = async (id: string, newStatus: 'recommended' | 'saved' | 'applied' | 'archived') => {
    setOpportunities((prev) => {
      const updated = prev.map((item) => (item.id === id ? { ...item, status: newStatus } : item));
      if (onCountChange) {
        onCountChange(updated.filter((o) => o.status === 'recommended').length);
      }
      return updated;
    });

    try {
      await fetchWithAuth(`/api/v1/recommendations/${id}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });

      if (newStatus === 'saved') {
        showToast('Saved opportunity to Cloud Firestore!');
      } else if (newStatus === 'archived') {
        showToast('Archived opportunity.');
      } else if (newStatus === 'recommended') {
        showToast('Moved back to recommended feed.');
      }
    } catch (err) {
      console.error('Failed to save status to Firestore:', err);
      showToast('Failed to save status to server.');
    }
  };

  const handleOpenResumeStudio = (job: ScoredOpportunityDTO) => {
    setSelectedJobForResume(job);
    setIsResumeModalOpen(true);
  };

  const companyMetrics = React.useMemo(() => {
    const tabJobs = opportunities.filter((o) => (o.status || 'recommended') === activeSubTab);
    const countsMap = new Map<string, { canonicalName: string; domain: string; count: number }>();

    for (const job of tabJobs) {
      const info = getCanonicalCompanyInfo(job.company);
      const existing = countsMap.get(info.key);
      if (existing) {
        existing.count += 1;
      } else {
        countsMap.set(info.key, {
          canonicalName: info.canonicalName,
          domain: info.domain,
          count: 1,
        });
      }
    }

    const list: CompanyMetric[] = Array.from(countsMap.entries()).map(([key, val]) => ({
      key,
      canonicalName: val.canonicalName,
      domain: val.domain,
      count: val.count,
    }));

    list.sort((a, b) => b.count - a.count || a.canonicalName.localeCompare(b.canonicalName));
    return {
      companies: list,
      totalCount: tabJobs.length,
    };
  }, [opportunities, activeSubTab]);

  const filteredOpportunities = opportunities.filter((item) => {
    const itemStatus = item.status || 'recommended';
    if (itemStatus !== activeSubTab) return false;

    if (selectedCompany) {
      const info = getCanonicalCompanyInfo(item.company);
      if (info.key !== selectedCompany) return false;
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchText = `${item.title} ${item.company} ${item.location} ${item.matchedSkills.join(' ')}`.toLowerCase();
      if (!matchText.includes(q)) return false;
    }

    if (selectedCategory !== 'all' && item.category !== selectedCategory) {
      return false;
    }

    if (selectedWorkMode !== 'all' && item.workMode !== selectedWorkMode) {
      return false;
    }

    if (selectedScoreFilter === '90' && item.fitScore < 90) return false;
    if (selectedScoreFilter === '75' && item.fitScore < 75) return false;
    if (selectedScoreFilter === '50' && item.fitScore < 50) return false;
    if (selectedScoreFilter === '35' && item.fitScore < 35) return false;

    return true;
  });

  const countByStatus = (status: string) => opportunities.filter((o) => (o.status || 'recommended') === status).length;

  const getCategoryLabel = (cat: string) => {
    switch (cat) {
      case 'technical':
        return 'Technical / AI';
      case 'data':
        return 'Data & Analytics';
      case 'qa':
        return 'QA & Testing';
      case 'non_technical':
        return 'Business & Ops';
      default:
        return cat;
    }
  };

  return (
    <div className="space-y-6">
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-50 px-4 py-2.5 rounded-xl bg-[#161616] border border-white/20 text-white text-xs shadow-2xl flex items-center gap-2 animate-in fade-in slide-in-from-bottom-2 duration-200">
          <Sparkles className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Top Action & Sub-Tabs Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-white/10 pb-4">
        {/* Status Filter Tabs with Counts */}
        <div className="flex items-center gap-1.5 p-1 bg-[#161616] rounded-xl border border-white/10">
          {(['recommended', 'saved', 'applied', 'archived'] as const).map((tab) => {
            const count = countByStatus(tab);
            const isActive = activeSubTab === tab;
            return (
              <button
                key={tab}
                onClick={() => {
                  setActiveSubTab(tab);
                  setSelectedCompany(null);
                }}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium capitalize transition-all cursor-pointer flex items-center gap-2 ${
                  isActive
                    ? 'bg-white text-black font-semibold shadow-sm'
                    : 'text-[#A3A3A3] hover:text-white hover:bg-white/5'
                }`}
              >
                <span>{tab}</span>
                <span
                  className={`text-[10px] px-1.5 py-0.2 rounded-full font-mono ${
                    isActive ? 'bg-black/10 text-black font-bold' : 'bg-[#1F1F1F] text-[#A3A3A3]'
                  }`}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        {/* Global Action Buttons */}
        <div className="flex items-center gap-2.5">
          <button
            onClick={handleRunDiscovery}
            disabled={isDiscovering}
            className="flex items-center gap-2 px-3 py-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 text-xs font-semibold transition-colors cursor-pointer disabled:opacity-50"
            title="Fetch live positions from Ashby, Lever & Greenhouse boards"
          >
            {isDiscovering ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <RefreshCw className="w-3.5 h-3.5" />
            )}
            <span>{isDiscovering ? 'Ingesting Jobs...' : 'Run Discovery'}</span>
          </button>

          <button
            onClick={() => setIsAddModalOpen(true)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white text-black hover:bg-neutral-200 text-xs font-semibold transition-colors cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add Opportunity</span>
          </button>
        </div>
      </div>

      {/* Company Filter Ribbon */}
      <CompanyFilterRibbon
        companies={companyMetrics.companies}
        selectedCompany={selectedCompany}
        onSelectCompany={setSelectedCompany}
        totalCount={companyMetrics.totalCount}
      />

      {/* Unified Filter Toolbar with View Mode Switcher */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 bg-[#161616] p-3 rounded-2xl border border-white/20">
        {/* Left Side: Search + Dropdowns Grouped Closely */}
        <div className="flex flex-wrap items-center gap-2.5 flex-1 min-w-0">
          <div className="relative min-w-[200px] max-w-xs flex-1">
            <Search className="w-3.5 h-3.5 text-[#666666] absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search role, skills, company..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-1.5 rounded-lg bg-[#0D0D0D] border border-white/20 text-xs text-white placeholder-[#666666] focus:outline-none focus:border-white transition-colors"
            />
          </div>

          <ThemeDropdown
            options={CATEGORY_OPTIONS}
            selectedValue={selectedCategory}
            onChange={setSelectedCategory}
            icon={<Layers className="w-3.5 h-3.5 text-[#A3A3A3]" />}
          />

          <ThemeDropdown
            options={WORK_MODE_OPTIONS}
            selectedValue={selectedWorkMode}
            onChange={setSelectedWorkMode}
            icon={<Globe className="w-3.5 h-3.5 text-[#A3A3A3]" />}
          />

          <ThemeDropdown
            options={SCORE_OPTIONS}
            selectedValue={selectedScoreFilter}
            onChange={setSelectedScoreFilter}
            icon={<SlidersHorizontal className="w-3.5 h-3.5 text-[#A3A3A3]" />}
          />
        </div>

        {/* Right Side: View Mode Switcher (Grid vs List View) */}
        <div className="flex items-center gap-1 bg-[#0D0D0D] p-1 rounded-xl border border-white/20 self-end lg:self-auto">
          <button
            type="button"
            onClick={() => setViewMode('grid')}
            className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
              viewMode === 'grid'
                ? 'bg-white text-black font-bold shadow-sm'
                : 'text-[#A3A3A3] hover:text-white hover:bg-white/5'
            }`}
            title="Grid View (Cards)"
          >
            <LayoutGrid className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setViewMode('list')}
            className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
              viewMode === 'list'
                ? 'bg-white text-black font-bold shadow-sm'
                : 'text-[#A3A3A3] hover:text-white hover:bg-white/5'
            }`}
            title="Line View (Compact List)"
          >
            <List className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Opportunities Presentation (Grid or List View) */}
      {isLoading ? (
        <div className="flex flex-col items-center justify-center py-20 space-y-3">
          <Loader2 className="w-6 h-6 animate-spin text-white" />
          <p className="text-xs text-[#A3A3A3]">Evaluating and scoring opportunities against your verified profile...</p>
        </div>
      ) : filteredOpportunities.length === 0 ? (
        <div className="text-center py-16 border border-dashed border-white/10 rounded-2xl bg-[#161616]/40 space-y-3">
          <Sparkles className="w-6 h-6 text-[#666666] mx-auto" />
          <h3 className="text-sm font-semibold text-white">No opportunities found in &quot;{activeSubTab}&quot;</h3>
          <p className="text-xs text-[#A3A3A3] max-w-sm mx-auto">
            {activeSubTab === 'recommended'
              ? 'Click "Run Discovery" above to ingest open positions across Ashby, Lever, and Greenhouse.'
              : `You haven't marked any opportunities as ${activeSubTab} yet.`}
          </p>
        </div>
      ) : viewMode === 'grid' ? (
        /* GRID VIEW (2-Column Cards) */
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filteredOpportunities.map((job) => {
            const expText = job.experienceText || (job.experienceYearsRequired ? `${job.experienceYearsRequired}+ yrs experience` : 'Fresher OK');
            const expLower = expText.toLowerCase();
            const isFresher = expLower.includes('fresher') || expLower.includes('0 - 1') || expLower.includes('0-1') || expLower.includes('intern') || expLower.includes('entry');
            const isWarningExp = !isFresher && (
              (job.experienceYearsRequired !== undefined && job.experienceYearsRequired >= 2) ||
              expLower.includes('1+') ||
              expLower.includes('2+') ||
              expLower.includes('3+') ||
              expLower.includes('4+') ||
              expLower.includes('5+') ||
              expLower.includes('7+') ||
              expLower.includes('senior') ||
              expLower.includes('lead') ||
              expLower.includes('manager') ||
              expLower.includes('director') ||
              job.title.toLowerCase().includes('director') ||
              job.title.toLowerCase().includes('manager') ||
              job.title.toLowerCase().includes('lead')
            );
            const isIndia = job.location.toLowerCase().includes('india') || job.location.toLowerCase().includes('bangalore') || job.location.toLowerCase().includes('hyderabad') || job.location.toLowerCase().includes('mumbai') || job.location.toLowerCase().includes('pune') || job.location.toLowerCase().includes('delhi');
            const postedTag = job.postedDateText || 'Active posting';

            return (
              <div
                key={job.id}
                onClick={() => setSelectedDetailsJob(job)}
                className="group relative bg-[#161616] border border-white/20 hover:border-white/40 rounded-2xl p-5 flex flex-col justify-between transition-all hover:shadow-xl space-y-4 cursor-pointer"
              >
                <div>
                  {/* Top Row: Title, Company, Match Badge */}
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-1">
                      <h3 className="text-sm font-bold text-white group-hover:text-emerald-400 transition-colors leading-snug">
                        <a 
                          href={job.sourceUrl} 
                          target="_blank" 
                          rel="noopener noreferrer" 
                          onClick={(e) => e.stopPropagation()}
                          className="hover:underline flex items-center gap-1.5"
                        >
                          <span>{job.title}</span>
                          <ArrowUpRight className="w-3 h-3 opacity-60 group-hover:opacity-100" />
                        </a>
                      </h3>
                      <div className="flex items-center gap-2 text-xs text-[#A3A3A3]">
                        <span className="font-semibold text-neutral-300">{job.company}</span>
                        <span>•</span>
                        <span className="truncate max-w-[150px]">{job.location}</span>
                      </div>
                    </div>

                    {/* Match Score Badge */}
                    <div className="flex flex-col items-end shrink-0">
                      <div className={`px-2.5 py-1 rounded-xl text-xs font-mono font-bold border ${
                        job.fitScore >= 90
                          ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-400'
                          : job.fitScore >= 75
                          ? 'bg-teal-500/10 border-teal-500/40 text-teal-400'
                          : job.fitScore >= 50
                          ? 'bg-amber-500/10 border-amber-500/40 text-amber-400'
                          : job.fitScore >= 35
                          ? 'bg-rose-500/10 border-rose-500/40 text-rose-400'
                          : 'bg-neutral-800/80 border-neutral-700/80 text-neutral-400'
                      }`}>
                        {job.fitScore}%
                      </div>
                      <span className={`text-[10px] font-mono mt-0.5 ${
                        job.fitScore >= 90 
                          ? 'text-emerald-400' 
                          : job.fitScore >= 75 
                          ? 'text-teal-400' 
                          : job.fitScore >= 50 
                          ? 'text-amber-400' 
                          : job.fitScore >= 35 
                          ? 'text-rose-400' 
                          : 'text-neutral-500'
                      }`}>
                        • {job.matchTier?.includes('Match') ? job.matchTier : `${job.matchTier} Match`}
                      </span>
                    </div>
                  </div>

                  {/* Badges: Location, Experience, Category, Date, Provider */}
                  <div className="flex flex-wrap items-center gap-1.5 mt-2.5">
                    {job.workMode === 'remote' ? (
                      <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-sky-500/10 border border-sky-500/30 text-sky-400 flex items-center gap-1 font-semibold">
                        <Globe className="w-3 h-3 text-sky-400" />
                        <span>Remote</span>
                      </span>
                    ) : isIndia ? (
                      <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 flex items-center gap-1 font-semibold">
                        <MapPin className="w-3 h-3 text-emerald-400" />
                        <span>India ({job.workMode})</span>
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-indigo-500/10 border border-indigo-500/30 text-indigo-400 capitalize">
                        {job.workMode}
                      </span>
                    )}

                    <span className={`px-2 py-0.5 rounded text-[10px] font-mono flex items-center gap-1 font-semibold ${
                      isFresher
                        ? 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-400'
                        : isWarningExp
                        ? 'bg-amber-500/10 border border-amber-500/30 text-amber-400'
                        : 'bg-[#1F1F1F] border border-white/20 text-neutral-300'
                    }`}>
                      {isFresher ? (
                        <GraduationCap className="w-3 h-3 text-emerald-400" />
                      ) : isWarningExp ? (
                        <AlertTriangle className="w-3 h-3 text-amber-400" />
                      ) : (
                        <Clock className="w-3 h-3 text-neutral-400" />
                      )}
                      <span>{expText}</span>
                    </span>

                    <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-[#1F1F1F] border border-white/10 text-neutral-300 flex items-center gap-1">
                      <Calendar className="w-3 h-3 text-[#A3A3A3]" />
                      <span>{postedTag}</span>
                    </span>

                    <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-[#1F1F1F] border border-white/10 text-[#A3A3A3]">
                      {getCategoryLabel(job.category)}
                    </span>

                    {job.sourceAdapter && (
                      <span className={`px-2 py-0.5 rounded text-[10px] font-mono uppercase font-bold tracking-wider ${
                        job.sourceAdapter.toLowerCase() === 'ashby'
                          ? 'bg-violet-500/15 border border-violet-500/40 text-violet-400'
                          : job.sourceAdapter.toLowerCase() === 'lever'
                          ? 'bg-teal-500/15 border border-teal-500/40 text-teal-400'
                          : 'bg-emerald-500/15 border border-emerald-500/40 text-emerald-400'
                      }`}>
                        {job.sourceAdapter}
                      </span>
                    )}
                  </div>

                  {/* AI Reasoning Box */}
                  <div className="mt-3 p-3 rounded-lg bg-[#0D0D0D] border border-white/10 text-xs text-[#A3A3A3] space-y-1">
                    <div className="flex items-center gap-1 text-[10px] font-mono text-white">
                      <Sparkles className="w-3 h-3 text-emerald-400" />
                      <span>Why this matches:</span>
                    </div>
                    <p className="text-[11px] leading-relaxed text-[#A3A3A3]">{job.fitReason}</p>
                  </div>

                  {/* Requirements Match Matrix */}
                  <div className="mt-3 space-y-1.5">
                    <div className="flex flex-wrap gap-1.5">
                      {job.matchedSkills.map((req, i) => (
                        <span
                          key={`match-${i}`}
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 font-mono"
                          title="Verified skill from your profile"
                        >
                          <CheckCircle2 className="w-3 h-3 shrink-0" />
                          <span>{req}</span>
                        </span>
                      ))}
                      {job.missingSkills.map((missing, i) => (
                        <span
                          key={`miss-${i}`}
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] bg-amber-500/10 border border-amber-500/30 text-amber-400 font-mono"
                          title="Skill required by job but not in your verified profile"
                        >
                          <AlertTriangle className="w-3 h-3 shrink-0" />
                          <span>{missing}</span>
                        </span>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Bottom Action Footer */}
                <div className="pt-3 border-t border-white/10 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-1 text-xs font-mono font-medium text-emerald-400">
                    <DollarSign className="w-3.5 h-3.5 shrink-0" />
                    <span className="truncate max-w-[150px]">{job.salaryText || 'Competitive Compensation'}</span>
                  </div>

                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleOpenResumeStudio(job);
                      }}
                      className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/40 text-emerald-400 font-semibold text-xs transition-colors cursor-pointer shadow-sm"
                      title="Generate ATS Resume & Cover Letter Grounded in Verified Profile"
                    >
                      <Sparkles className="w-3 h-3" />
                      <span>Tailor Resume</span>
                    </button>

                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        updateStatus(job.id, job.status === 'saved' ? 'recommended' : 'saved');
                      }}
                      className={`p-1.5 rounded-lg border transition-colors cursor-pointer ${
                        job.status === 'saved'
                          ? 'bg-white text-black border-white shadow-sm'
                          : 'border-white/10 text-[#A3A3A3] hover:text-white hover:bg-white/5'
                      }`}
                      title={job.status === 'saved' ? 'Remove from saved' : 'Save opportunity'}
                    >
                      <Bookmark className="w-3.5 h-3.5" />
                    </button>

                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setJobToDismiss(job);
                      }}
                      className="p-1.5 rounded-lg border border-white/10 text-[#A3A3A3] hover:text-rose-400 hover:bg-rose-500/10 transition-colors cursor-pointer"
                      title="Dismiss"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>

                    <a
                      href={job.sourceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-white text-black font-semibold text-xs hover:bg-neutral-200 transition-colors cursor-pointer shrink-0"
                    >
                      <span>Apply</span>
                      <ArrowUpRight className="w-3.5 h-3.5" />
                    </a>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        /* LIST / LINE VIEW (Single Horizontal Rows) */
        <div className="space-y-2.5">
          {filteredOpportunities.map((job) => {
            const expText = job.experienceText || (job.experienceYearsRequired ? `${job.experienceYearsRequired}+ yrs experience` : 'Fresher OK');
            const expLower = expText.toLowerCase();
            const isFresher = expLower.includes('fresher') || expLower.includes('0 - 1') || expLower.includes('0-1') || expLower.includes('intern') || expLower.includes('entry');
            const isWarningExp = !isFresher && (
              (job.experienceYearsRequired !== undefined && job.experienceYearsRequired >= 2) ||
              expLower.includes('1+') ||
              expLower.includes('2+') ||
              expLower.includes('3+') ||
              expLower.includes('4+') ||
              expLower.includes('5+') ||
              expLower.includes('7+') ||
              expLower.includes('senior') ||
              expLower.includes('lead') ||
              expLower.includes('manager') ||
              expLower.includes('director') ||
              job.title.toLowerCase().includes('director') ||
              job.title.toLowerCase().includes('manager') ||
              job.title.toLowerCase().includes('lead')
            );
            const isIndia = job.location.toLowerCase().includes('india') || job.location.toLowerCase().includes('bangalore') || job.location.toLowerCase().includes('hyderabad') || job.location.toLowerCase().includes('mumbai') || job.location.toLowerCase().includes('pune') || job.location.toLowerCase().includes('delhi');
            const postedTag = job.postedDateText || 'Active';

            return (
              <div
                key={job.id}
                onClick={() => setSelectedDetailsJob(job)}
                className="group bg-[#161616] border border-white/20 hover:border-white/40 rounded-xl p-3.5 flex flex-col md:flex-row md:items-center justify-between gap-3 transition-all hover:bg-[#1C1C1C] cursor-pointer"
              >
                {/* Left Section: Title, Company, Location & Badges */}
                <div className="flex-1 min-w-0 space-y-1.5">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h4 className="text-xs font-bold text-white group-hover:text-emerald-400 transition-colors truncate max-w-sm">
                      <a 
                        href={job.sourceUrl} 
                        target="_blank" 
                        rel="noopener noreferrer" 
                        onClick={(e) => e.stopPropagation()}
                        className="hover:underline flex items-center gap-1"
                      >
                        <span>{job.title}</span>
                        <ArrowUpRight className="w-3 h-3 opacity-60" />
                      </a>
                    </h4>
                    <span className="text-xs font-semibold text-neutral-300">{job.company}</span>
                    <span className="text-xs text-[#666666]">•</span>
                    <span className="text-xs text-[#A3A3A3] truncate max-w-[120px]">{job.location}</span>
                  </div>

                  {/* Badges in a compact row */}
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {job.workMode === 'remote' ? (
                      <span className="px-1.5 py-0.2 rounded text-[10px] font-mono bg-sky-500/10 border border-sky-500/30 text-sky-400 font-semibold">
                        Remote
                      </span>
                    ) : isIndia ? (
                      <span className="px-1.5 py-0.2 rounded text-[10px] font-mono bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 font-semibold">
                        India
                      </span>
                    ) : null}

                    <span className={`px-1.5 py-0.2 rounded text-[10px] font-mono font-semibold flex items-center gap-1 ${
                      isFresher
                        ? 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-400'
                        : isWarningExp
                        ? 'bg-amber-500/10 border border-amber-500/30 text-amber-400'
                        : 'bg-[#1F1F1F] border border-white/20 text-neutral-300'
                    }`}>
                      {isFresher ? (
                        <GraduationCap className="w-3 h-3 text-emerald-400" />
                      ) : isWarningExp ? (
                        <AlertTriangle className="w-3 h-3 text-amber-400" />
                      ) : null}
                      <span>{expText}</span>
                    </span>

                    <span className="px-1.5 py-0.2 rounded text-[10px] font-mono bg-[#1F1F1F] border border-white/10 text-neutral-300 flex items-center gap-1">
                      <Calendar className="w-3 h-3 text-[#A3A3A3]" />
                      <span>{postedTag}</span>
                    </span>

                    {job.sourceAdapter && (
                      <span className={`px-1.5 py-0.2 rounded text-[10px] font-mono uppercase font-bold ${
                        job.sourceAdapter.toLowerCase() === 'ashby'
                          ? 'bg-violet-500/15 border border-violet-500/40 text-violet-400'
                          : job.sourceAdapter.toLowerCase() === 'lever'
                          ? 'bg-teal-500/15 border border-teal-500/40 text-teal-400'
                          : 'bg-emerald-500/15 border border-emerald-500/40 text-emerald-400'
                      }`}>
                        {job.sourceAdapter}
                      </span>
                    )}
                  </div>
                </div>

                {/* Right Section: Match Score & Action Buttons */}
                <div className="flex items-center gap-2.5 shrink-0 self-end md:self-center">
                  <span className={`px-2 py-0.5 rounded-lg text-xs font-mono font-bold border ${
                    job.fitScore >= 90
                      ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-400'
                      : job.fitScore >= 75
                      ? 'bg-teal-500/10 border-teal-500/40 text-teal-400'
                      : job.fitScore >= 50
                      ? 'bg-amber-500/10 border-amber-500/40 text-amber-400'
                      : job.fitScore >= 35
                      ? 'bg-rose-500/10 border-rose-500/40 text-rose-400'
                      : 'bg-neutral-800/80 border-neutral-700/80 text-neutral-400'
                  }`}>
                    {job.fitScore}%
                  </span>

                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleOpenResumeStudio(job);
                    }}
                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/40 text-emerald-400 font-semibold text-xs transition-colors cursor-pointer"
                    title="Tailor ATS Resume"
                  >
                    <Sparkles className="w-3 h-3" />
                    <span>Tailor</span>
                  </button>

                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      updateStatus(job.id, job.status === 'saved' ? 'recommended' : 'saved');
                    }}
                    className={`p-1.5 rounded-lg border transition-colors cursor-pointer ${
                      job.status === 'saved'
                        ? 'bg-white text-black border-white shadow-sm'
                        : 'border-white/10 text-[#A3A3A3] hover:text-white hover:bg-white/5'
                    }`}
                    title={job.status === 'saved' ? 'Remove from saved' : 'Save opportunity'}
                  >
                    <Bookmark className="w-3.5 h-3.5" />
                  </button>

                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setJobToDismiss(job);
                    }}
                    className="p-1.5 rounded-lg border border-white/10 text-[#A3A3A3] hover:text-rose-400 hover:bg-rose-500/10 transition-colors cursor-pointer"
                    title="Dismiss"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>

                  <a
                    href={job.sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-white text-black font-semibold text-xs hover:bg-neutral-200 transition-colors cursor-pointer"
                  >
                    <span>Apply</span>
                    <ArrowUpRight className="w-3 h-3" />
                  </a>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Opportunity Details Modal */}
      <OpportunityDetailsModal
        isOpen={selectedDetailsJob !== null}
        job={selectedDetailsJob}
        onClose={() => setSelectedDetailsJob(null)}
        onTailorResume={(job) => {
          setSelectedDetailsJob(null);
          handleOpenResumeStudio(job);
        }}
        onToggleSave={(job) => {
          const newStatus = job.status === 'saved' ? 'recommended' : 'saved';
          updateStatus(job.id, newStatus);
          setSelectedDetailsJob((prev) => (prev && prev.id === job.id ? { ...prev, status: newStatus } : prev));
        }}
      />

      {/* Add Job Modal */}
      <AddJobModal
        isOpen={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
        onJobAdded={handleJobAdded}
      />

      {/* Interactive Resume Studio Modal */}
      {selectedJobForResume && (
        <ResumeStudioModal
          isOpen={isResumeModalOpen}
          onClose={() => {
            setIsResumeModalOpen(false);
            setSelectedJobForResume(null);
          }}
          jobId={selectedJobForResume.id}
          jobTitle={selectedJobForResume.title}
          jobCompany={selectedJobForResume.company}
          onApplicationApproved={(_resumeId) => {
            showToast(`Resume approved! Ready to prepare application for ${selectedJobForResume.company}.`);
          }}
        />
      )}

      {/* Dismiss Confirmation Modal */}
      {jobToDismiss && (
        <DeleteConfirmModal
          isOpen={!!jobToDismiss}
          title="Dismiss Opportunity"
          itemName={`${jobToDismiss.title} (${jobToDismiss.company})`}
          message="Are you sure you want to dismiss this opportunity? It will be archived and hidden from your active recommendations."
          confirmLabel="Dismiss"
          onConfirm={() => {
            if (jobToDismiss) {
              updateStatus(jobToDismiss.id, 'archived');
              setJobToDismiss(null);
            }
          }}
          onClose={() => setJobToDismiss(null)}
        />
      )}
    </div>
  );
};
