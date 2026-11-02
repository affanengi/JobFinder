import React, { useState, useEffect, useMemo, useRef } from 'react';
import { 
  Building2, 
  Search, 
  Briefcase, 
  ShieldCheck, 
  AlertTriangle, 
  ShieldAlert, 
  ChevronRight,
  ArrowRight,
  AlertCircle,
  Loader2
} from 'lucide-react';
import { fetchWithAuth } from '../lib/api';
import { 
  CompanySummary, 
  BulkCompanyResearchResponse, 
  BulkResearchJobDocument, 
  BulkResearchJobCreateResponse 
} from '../types/company';
import { CompanyLogo } from '../components/recommendations/CompanyFilterRibbon';
import { BulkActionBar } from '../components/companies/BulkActionBar';
import { BulkResearchProgressModal, ProgressStage } from '../components/companies/BulkResearchProgressModal';

const ACTIVE_JOB_STORAGE_KEY = 'jobfinder_active_bulk_job_id';

interface CompanyDirectoryPageProps {
  onSelectCompany: (companyKey: string) => void;
  onNavigateToOpportunities?: () => void;
}

export const CompanyDirectoryPage: React.FC<CompanyDirectoryPageProps> = ({
  onSelectCompany,
  onNavigateToOpportunities,
}) => {
  const [companies, setCompanies] = useState<CompanySummary[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [debouncedQuery, setDebouncedQuery] = useState<string>('');

  // Bulk Research Multi-Select State
  const [selectedCompanyKeys, setSelectedCompanyKeys] = useState<string[]>([]);
  const [selectionWarning, setSelectionWarning] = useState<string | null>(null);
  const [isBulkResearching, setIsBulkResearching] = useState<boolean>(false);
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
  const [progressStage, setProgressStage] = useState<ProgressStage>('harvesting');
  const [bulkResponse, setBulkResponse] = useState<BulkCompanyResearchResponse | null>(null);
  const [bulkError, setBulkError] = useState<string | null>(null);

  // Persistent Job State
  const [activeJobId, setActiveJobId] = useState<string | null>(() => {
    try {
      return localStorage.getItem(ACTIVE_JOB_STORAGE_KEY);
    } catch {
      return null;
    }
  });
  const [activeJob, setActiveJob] = useState<BulkResearchJobDocument | null>(null);
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Debounce search query by 200ms
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(searchQuery);
    }, 200);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const fetchCompanies = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetchWithAuth('/api/v1/companies');
      if (!res.ok) {
        throw new Error(`Failed to load company directory (${res.status})`);
      }
      const data: CompanySummary[] = await res.json();
      setCompanies(data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error fetching companies.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCompanies();
  }, []);

  // Check for active job on backend on mount
  useEffect(() => {
    const checkActiveJob = async () => {
      try {
        const res = await fetchWithAuth('/api/v1/companies/bulk-research/jobs/active');
        if (res.ok) {
          const job: BulkResearchJobDocument = await res.json();
          if (job && job.jobId) {
            setActiveJobId(job.jobId);
            setActiveJob(job);
            setIsBulkResearching(true);
            try {
              localStorage.setItem(ACTIVE_JOB_STORAGE_KEY, job.jobId);
            } catch {
              // ignore storage issues
            }
          }
        }
      } catch {
        // active job check is best effort
      }
    };

    checkActiveJob();
  }, []);

  // Poll active bulk research job
  useEffect(() => {
    if (!activeJobId) {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
      return;
    }

    const pollJob = async () => {
      try {
        const res = await fetchWithAuth(`/api/v1/companies/bulk-research/jobs/${activeJobId}`);
        if (!res.ok) {
          if (res.status === 404) {
            setActiveJobId(null);
            setIsBulkResearching(false);
            try {
              localStorage.removeItem(ACTIVE_JOB_STORAGE_KEY);
            } catch {
              // ignore
            }
          }
          return;
        }

        const job: BulkResearchJobDocument = await res.json();
        setActiveJob(job);

        // Map status to progress stage
        if (job.status === 'HARVESTING') {
          setProgressStage('harvesting');
          setIsBulkResearching(true);
        } else if (job.status === 'SYNTHESIZING') {
          setProgressStage('synthesizing');
          setIsBulkResearching(true);
        } else if (job.status === 'SAVING') {
          setProgressStage('saving');
          setIsBulkResearching(true);
        } else if (job.status === 'COMPLETED') {
          setProgressStage('completed');
          setIsBulkResearching(false);
          const responsePayload: BulkCompanyResearchResponse = {
            operationId: job.jobId,
            status: 'COMPLETED',
            metrics: job.metrics || {
              totalRequested: job.companyKeys.length,
              cachedCount: 0,
              liveHarvestedCount: job.companyKeys.length,
              geminiRequestsIssued: job.companyKeys.length,
              totalContactsDiscovered: (job.results || []).reduce((acc, r) => acc + (r.contacts?.length || 0), 0),
              contactsWithDirectEmail: (job.results || []).reduce((acc, r) => acc + (r.contacts?.filter((c) => c.email)?.length || 0), 0),
              contactsWithProfileOnly: (job.results || []).reduce((acc, r) => acc + (r.contacts?.filter((c) => !c.email)?.length || 0), 0),
              durationSeconds: 0,
            },
            results: job.results || [],
          };
          setBulkResponse(responsePayload);
          try {
            localStorage.removeItem(ACTIVE_JOB_STORAGE_KEY);
          } catch {
            // ignore
          }
          fetchCompanies();
        } else if (job.status === 'FAILED') {
          setProgressStage('error');
          setIsBulkResearching(false);
          setBulkError(job.errorMessage || 'Bulk research job encountered an unexpected error.');
          try {
            localStorage.removeItem(ACTIVE_JOB_STORAGE_KEY);
          } catch {
            // ignore
          }
        }
      } catch {
        // network polling glitch: continue next interval
      }
    };

    // Immediate poll then 2000ms intervals
    pollJob();
    pollIntervalRef.current = setInterval(pollJob, 2000);

    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
    };
  }, [activeJobId]);

  const handleToggleCompany = (key: string, checked: boolean) => {
    if (checked) {
      if (selectedCompanyKeys.length >= 5) {
        setSelectionWarning('Maximum 5 companies can be researched per batch to comply with Free-Tier limits.');
        return;
      }
      setSelectionWarning(null);
      setSelectedCompanyKeys((prev) => (prev.includes(key) ? prev : [...prev, key]));
    } else {
      setSelectionWarning(null);
      setSelectedCompanyKeys((prev) => prev.filter((k) => k !== key));
    }
  };

  const selectedCompaniesList = useMemo(() => {
    const keys = activeJob?.companyKeys?.length ? activeJob.companyKeys : selectedCompanyKeys;
    return companies
      .filter((c) => keys.includes(c.key))
      .map((c) => ({ key: c.key, name: c.name, domain: c.domain }));
  }, [companies, selectedCompanyKeys, activeJob]);

  const handleStartBulkResearch = async () => {
    if (selectedCompanyKeys.length === 0 || isBulkResearching) return;

    setIsBulkResearching(true);
    setIsModalOpen(true);
    setProgressStage('harvesting');
    setBulkError(null);
    setBulkResponse(null);

    try {
      const res = await fetchWithAuth('/api/v1/companies/bulk-research/jobs', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          companyKeys: selectedCompanyKeys,
          forceRefresh: false,
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.detail || `Failed to start bulk research job (${res.status})`);
      }

      const createData: BulkResearchJobCreateResponse = await res.json();
      setActiveJobId(createData.jobId);
      try {
        localStorage.setItem(ACTIVE_JOB_STORAGE_KEY, createData.jobId);
      } catch {
        // ignore
      }
    } catch (err: unknown) {
      setBulkError(err instanceof Error ? err.message : 'Unknown error starting bulk research.');
      setProgressStage('error');
      setIsBulkResearching(false);
    }
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    if (!isBulkResearching && (bulkResponse || progressStage === 'completed' || progressStage === 'error')) {
      setSelectedCompanyKeys([]);
      setBulkResponse(null);
      setActiveJob(null);
      setActiveJobId(null);
      fetchCompanies();
    }
  };

  const filteredCompanies = useMemo(() => {
    if (!debouncedQuery.trim()) return companies;
    const q = debouncedQuery.toLowerCase().trim();
    return companies.filter(
      (c) => c.name.toLowerCase().includes(q) || c.domain.toLowerCase().includes(q)
    );
  }, [companies, debouncedQuery]);

  const getLegitimacyBadge = (status: string) => {
    switch (status) {
      case 'NO_OBVIOUS_RED_FLAGS_FOUND':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
            <ShieldCheck className="w-3 h-3" /> No Red Flags
          </span>
        );
      case 'NEEDS_VERIFICATION':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/20">
            <AlertTriangle className="w-3 h-3" /> Verification Needed
          </span>
        );
      case 'SIGNIFICANT_RED_FLAGS':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-rose-500/10 text-rose-400 border border-rose-500/20">
            <ShieldAlert className="w-3 h-3" /> Red Flags
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-neutral-800 text-neutral-400 border border-neutral-700">
            Unresearched
          </span>
        );
    }
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-150">
      {/* Top Header & Search Bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-white/10 pb-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white flex items-center gap-2.5">
            <Building2 className="w-6 h-6 text-emerald-400" />
            Companies & Contacts
          </h1>
          <p className="text-xs text-neutral-400 mt-1">
            Browse hiring organizations, verify Scam Shield legitimacy, and connect with discovered contacts.
          </p>
        </div>

        {/* Search Input */}
        <div className="relative w-full md:w-80">
          <Search className="w-4 h-4 text-neutral-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search companies by name or domain..."
            aria-label="Search companies"
            className="w-full pl-9 pr-4 py-2 bg-[#141414] border border-white/10 rounded-xl text-xs text-white placeholder:text-neutral-500 focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/50 transition"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-500 hover:text-white text-xs"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {/* Directory Metrics Strip */}
      {!loading && !error && companies.length > 0 && (
        <div className="flex items-center justify-between text-xs text-neutral-400">
          <div>
            Showing <span className="font-semibold text-white">{filteredCompanies.length}</span>{' '}
            {filteredCompanies.length === 1 ? 'organization' : 'organizations'} across active opportunities
          </div>
        </div>
      )}

      {/* Loading Skeleton */}
      {loading && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div
              key={i}
              className="p-6 rounded-2xl bg-[#141414] border border-white/10 space-y-4 animate-pulse"
            >
              <div className="w-16 h-16 rounded-2xl bg-neutral-800 mx-auto" />
              <div className="h-4 bg-neutral-800 rounded w-2/3 mx-auto" />
              <div className="h-3 bg-neutral-800/60 rounded w-1/2 mx-auto" />
              <div className="pt-2 border-t border-white/5 flex justify-between">
                <div className="h-3 bg-neutral-800 rounded w-16" />
                <div className="h-3 bg-neutral-800 rounded w-20" />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Error State */}
      {!loading && error && (
        <div className="p-8 rounded-2xl bg-rose-500/10 border border-rose-500/20 text-center space-y-3">
          <AlertTriangle className="w-8 h-8 text-rose-400 mx-auto" />
          <h3 className="text-sm font-semibold text-rose-200">Failed to Load Companies</h3>
          <p className="text-xs text-rose-300 max-w-md mx-auto">{error}</p>
          <button
            onClick={fetchCompanies}
            className="px-4 py-2 bg-[#1A1A1A] hover:bg-[#222222] border border-white/10 rounded-xl text-xs font-semibold text-white transition"
          >
            Retry Connection
          </button>
        </div>
      )}

      {/* Empty State: No Companies Saved/Captured */}
      {!loading && !error && companies.length === 0 && (
        <div className="p-12 text-center rounded-2xl border border-dashed border-white/10 bg-[#141414]/50 space-y-4 max-w-xl mx-auto">
          <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400 mx-auto">
            <Building2 className="w-6 h-6" />
          </div>
          <div className="space-y-1">
            <h3 className="text-sm font-semibold text-white">No Companies in Directory Yet</h3>
            <p className="text-xs text-neutral-400 leading-relaxed">
              When you explore, save, or discover job opportunities, their employers will be automatically indexed, deduplicated, and displayed in this directory.
            </p>
          </div>
          {onNavigateToOpportunities && (
            <button
              onClick={onNavigateToOpportunities}
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-emerald-500 hover:bg-emerald-600 text-black font-semibold rounded-xl text-xs transition"
            >
              Explore Opportunities <ArrowRight className="w-3.5 h-3.5 ml-1" />
            </button>
          )}
        </div>
      )}

      {/* No Search Results */}
      {!loading && !error && companies.length > 0 && filteredCompanies.length === 0 && (
        <div className="p-10 text-center rounded-2xl border border-white/10 bg-[#141414] space-y-3">
          <Search className="w-8 h-8 text-neutral-500 mx-auto" />
          <h3 className="text-sm font-semibold text-white">No companies matching "{debouncedQuery}"</h3>
          <p className="text-xs text-neutral-400">
            Check for typos or try searching for a different company or domain.
          </p>
          <button
            onClick={() => setSearchQuery('')}
            className="px-3.5 py-1.5 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-xs font-medium text-white transition"
          >
            Clear Search
          </button>
        </div>
      )}

      {/* Selection Limit Warning Banner */}
      {selectionWarning && (
        <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-between text-xs text-amber-300 animate-in fade-in">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 text-amber-400" />
            <span>{selectionWarning}</span>
          </div>
          <button
            type="button"
            onClick={() => setSelectionWarning(null)}
            className="text-amber-400 hover:text-white text-xs px-2 py-0.5"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Wireframe 1: Clean 3-Column Responsive Grid */}
      {!loading && !error && filteredCompanies.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 pb-20">
          {filteredCompanies.map((company) => {
            const isSelected = selectedCompanyKeys.includes(company.key);
            const isMaxReached = selectedCompanyKeys.length >= 5;
            const isSelectionMode = selectedCompanyKeys.length > 0;

            const handleCardClick = () => {
              if (isSelectionMode) {
                if (isSelected) {
                  handleToggleCompany(company.key, false);
                } else if (!isMaxReached) {
                  handleToggleCompany(company.key, true);
                } else {
                  setSelectionWarning('Maximum 5 companies can be researched per batch to comply with Free-Tier limits.');
                }
              } else {
                onSelectCompany(company.key);
              }
            };

            return (
              <div
                key={company.key}
                onClick={handleCardClick}
                role="button"
                tabIndex={0}
                aria-label={
                  isSelectionMode
                    ? `${isSelected ? 'Deselect' : 'Select'} ${company.name}`
                    : `View ${company.name} profile`
                }
                onKeyDown={(e) => {
                  if (e.target !== e.currentTarget) return;
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    handleCardClick();
                  }
                }}
                className={`relative group p-6 rounded-2xl transition-all duration-200 cursor-pointer flex flex-col justify-between space-y-5 shadow-sm hover:shadow-md select-none focus:outline-none focus:ring-2 focus:ring-emerald-500/50 ${
                  isSelected
                    ? 'bg-[#151f19] border-2 border-emerald-500/70 shadow-emerald-500/10'
                    : 'bg-[#141414] hover:bg-[#181818] border border-white/10 hover:border-emerald-500/40 hover:shadow-emerald-500/5'
                }`}
              >
                {/* Checkbox for Bulk Selection: Google Photos-style reveal */}
                <div
                  data-testid={`company-checkbox-wrapper-${company.key}`}
                  className={`absolute top-4 right-4 z-10 transition-opacity duration-150 ${
                    isSelectionMode
                      ? 'opacity-100'
                      : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-within:opacity-100 [@media(hover:none)]:opacity-70'
                  }`}
                  onClick={(e) => e.stopPropagation()}
                >
                  <label
                    className="flex items-center cursor-pointer p-1 rounded-lg hover:bg-white/10 transition"
                    title={
                      isSelected
                        ? 'Deselect company'
                        : isMaxReached
                        ? 'Maximum 5 companies selected'
                        : 'Select for bulk research'
                    }
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      disabled={!isSelected && isMaxReached}
                      onChange={(e) => handleToggleCompany(company.key, e.target.checked)}
                      aria-label={`Select ${company.name} for bulk research`}
                      className="w-4 h-4 rounded border-neutral-600 bg-neutral-900 text-emerald-500 focus:ring-emerald-500/40 focus:ring-offset-0 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition"
                    />
                  </label>
                </div>

                {/* Top: Logo Container & Company Identity */}
                <div className="flex flex-col items-center text-center space-y-4">
                  <div className="w-20 h-20 rounded-2xl bg-[#1E1E1E] border border-white/10 group-hover:border-emerald-500/30 flex items-center justify-center p-3 transition shadow-inner">
                    <CompanyLogo company={company.name} domain={company.domain} size={48} />
                  </div>

                  <div className="space-y-1">
                    <h3 className="text-base font-bold text-white group-hover:text-emerald-300 transition flex items-center justify-center gap-1.5">
                      {company.name}
                    </h3>
                    <p className="text-xs text-neutral-400 font-mono">
                      {company.domain}
                    </p>
                  </div>
                </div>

                {/* Middle: Badges & Info */}
                <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
                  {getLegitimacyBadge(company.intelligenceStatus)}
                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-medium bg-neutral-800/80 text-neutral-300 border border-neutral-700/60">
                    <Briefcase className="w-3 h-3 text-neutral-400" />
                    {company.opportunityCount} {company.opportunityCount === 1 ? 'Opening' : 'Openings'}
                  </span>
                  {company.contactsCount > 0 && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-purple-500/10 text-purple-300 border border-purple-500/20">
                      {company.contactsCount} Contacts
                    </span>
                  )}
                </div>

                {/* Bottom Card Footer: Explicit Profile Navigation */}
                <div
                  role="button"
                  tabIndex={0}
                  aria-label={`View Profile & Contacts for ${company.name}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectCompany(company.key);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.stopPropagation();
                      e.preventDefault();
                      onSelectCompany(company.key);
                    }
                  }}
                  className="pt-3 border-t border-white/5 flex items-center justify-between text-xs text-neutral-400 hover:text-white transition cursor-pointer"
                >
                  <span className="text-[11px] font-medium group-hover:text-emerald-300">View Profile & Contacts</span>
                  <ChevronRight className="w-4 h-4 text-neutral-500 group-hover:text-emerald-400 group-hover:translate-x-0.5 transition" />
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Floating Action Bar */}
      <BulkActionBar
        selectedCount={selectedCompanyKeys.length}
        maxSelection={5}
        onResearch={handleStartBulkResearch}
        onClear={() => {
          setSelectedCompanyKeys([]);
          setSelectionWarning(null);
        }}
        isLoading={isBulkResearching}
      />

      {/* Floating Background Progress Indicator (when modal is closed during research) */}
      {activeJob && !isModalOpen && (activeJob.status === 'QUEUED' || activeJob.status === 'HARVESTING' || activeJob.status === 'SYNTHESIZING' || activeJob.status === 'SAVING') && (
        <div
          role="button"
          tabIndex={0}
          onClick={() => setIsModalOpen(true)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              setIsModalOpen(true);
            }
          }}
          className="fixed bottom-6 right-6 z-40 bg-[#161616]/95 backdrop-blur-md border border-emerald-500/40 rounded-2xl p-3.5 shadow-2xl flex items-center gap-3.5 cursor-pointer hover:border-emerald-500/80 transition-all hover:scale-[1.02] group select-none animate-in fade-in slide-in-from-bottom-2 duration-300"
          aria-label="View background bulk research progress"
        >
          <div className="w-8 h-8 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center shrink-0">
            <Loader2 className="w-4 h-4 text-emerald-400 animate-spin" />
          </div>
          <div>
            <div className="text-xs font-bold text-white group-hover:text-emerald-300 flex items-center gap-2">
              <span>Bulk Research in Progress</span>
              <span className="px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                {activeJob.progressPct}%
              </span>
            </div>
            <div className="text-[11px] text-neutral-400 truncate max-w-[220px]">
              {activeJob.currentStageDescription || 'Click to view details'}
            </div>
          </div>
        </div>
      )}

      {/* Interactive Progress Modal */}
      <BulkResearchProgressModal
        isOpen={isModalOpen}
        onClose={handleCloseModal}
        selectedCompanies={selectedCompaniesList}
        isLoading={isBulkResearching}
        progressStage={progressStage}
        progressPct={activeJob?.progressPct}
        stageDescription={activeJob?.currentStageDescription}
        response={bulkResponse}
        error={bulkError}
        onNavigateToCompany={onSelectCompany}
      />
    </div>
  );
};
