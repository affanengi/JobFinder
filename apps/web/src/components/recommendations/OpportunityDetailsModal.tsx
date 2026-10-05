import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { 
  X, 
  Sparkles, 
  MapPin, 
  CheckCircle2, 
  AlertTriangle, 
  ArrowUpRight, 
  Bookmark, 
  Calendar, 
  GraduationCap, 
  Clock, 
  DollarSign, 
  ShieldCheck, 
  Briefcase,
  Layers,
  FileCheck,
  Loader2,
  Info,
  Check
} from 'lucide-react';
import { useScrollLock } from '../../hooks/useScrollLock';
import { CompanyLogo, getCanonicalCompanyInfo } from './CompanyFilterRibbon';
import { StructuredJobDescription, JobDescriptionBlock } from './StructuredJobDescription';
import { fetchWithAuth } from '../../lib/api';
import { ProfileJobMatchResult, ApplicationProfileSnapshot } from '../../types/jobAnalysis';

export interface OpportunityDetailsDTO {
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

interface OpportunityDetailsModalProps {
  job: OpportunityDetailsDTO | null;
  isOpen: boolean;
  onClose: () => void;
  onTailorResume: (job: OpportunityDetailsDTO) => void;
  onToggleSave: (job: OpportunityDetailsDTO) => void;
}

export function isValidExternalUrl(url?: string | null): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export const OpportunityDetailsModal: React.FC<OpportunityDetailsModalProps> = ({
  job,
  isOpen,
  onClose,
  onTailorResume,
  onToggleSave,
}) => {
  useScrollLock(isOpen);

  const [activeTab, setActiveTab] = useState<'overview' | 'requirements'>('overview');
  const [matchData, setMatchData] = useState<ProfileJobMatchResult | null>(null);
  const [isLoadingMatch, setIsLoadingMatch] = useState<boolean>(false);
  const [snapshotResult, setSnapshotResult] = useState<ApplicationProfileSnapshot | null>(null);
  const [isCreatingSnapshot, setIsCreatingSnapshot] = useState<boolean>(false);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    if (isOpen) {
      window.addEventListener('keydown', handleKeyDown);
      return () => window.removeEventListener('keydown', handleKeyDown);
    }
  }, [isOpen, onClose]);

  // Reset tab on job change
  useEffect(() => {
    setActiveTab('overview');
    setMatchData(null);
    setSnapshotResult(null);
  }, [job?.id]);

  if (!isOpen || !job) return null;

  const handleFetchMatch = async () => {
    setIsLoadingMatch(true);
    try {
      const res = await fetchWithAuth(`/api/v1/jobs/${job.id}/match`);
      if (res.ok) {
        const data = await res.json();
        setMatchData(data);
      }
    } catch (err) {
      console.error('Failed to load deterministic match evidence:', err);
    } finally {
      setIsLoadingMatch(false);
    }
  };

  const handleCreateSnapshot = async () => {
    setIsCreatingSnapshot(true);
    try {
      const res = await fetchWithAuth(`/api/v1/jobs/${job.id}/snapshot`, { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        setSnapshotResult(data);
      }
    } catch (err) {
      console.error('Failed to create application snapshot:', err);
    } finally {
      setIsCreatingSnapshot(false);
    }
  };

  const companyInfo = getCanonicalCompanyInfo(job.company);
  const isSaved = job.status === 'saved';
  const hasValidUrl = isValidExternalUrl(job.sourceUrl);

  const expText = job.experienceText || (job.experienceYearsRequired ? `${job.experienceYearsRequired}+ yrs exp` : 'Fresher OK');
  const expLower = expText.toLowerCase();
  const isFresher = expLower.includes('fresher') || expLower.includes('0 - 1') || expLower.includes('0-1') || expLower.includes('intern') || expLower.includes('entry');
  const isWarningExp = !isFresher && (
    (job.experienceYearsRequired !== undefined && job.experienceYearsRequired >= 2) ||
    expLower.includes('2+') || expLower.includes('3+') || expLower.includes('senior') || expLower.includes('lead')
  );

  return createPortal(
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 md:p-6 bg-black/65 backdrop-blur-xl animate-in fade-in duration-150"
      role="dialog"
      aria-modal="true"
      aria-labelledby="opportunity-details-title"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-3xl bg-[#0D0D0D] border border-white/15 rounded-2xl shadow-2xl flex flex-col max-h-[88vh] overflow-hidden animate-in zoom-in-95 duration-150 text-white"
      >
        {/* Modal Header */}
        <div className="px-6 py-5 border-b border-white/10 flex items-start justify-between gap-4 bg-[#111111] shrink-0">
          <div className="flex items-start gap-3.5 min-w-0 flex-1">
            <div className="mt-1 shrink-0 p-1.5 rounded-xl bg-white/5 border border-white/10">
              <CompanyLogo company={companyInfo.canonicalName} domain={companyInfo.domain} size={28} />
            </div>
            <div className="min-w-0 flex-1 space-y-1.5">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs font-semibold text-neutral-300">{companyInfo.canonicalName}</span>
                <span className="text-xs text-neutral-600">•</span>
                <span className="text-xs text-neutral-400 flex items-center gap-1">
                  <MapPin className="w-3 h-3 text-neutral-400" />
                  <span>{job.location}</span>
                </span>
              </div>
              <h2 id="opportunity-details-title" className="text-base sm:text-lg font-bold text-white tracking-tight leading-snug">
                {job.title}
              </h2>
              {/* Badges in header */}
              <div className="flex items-center gap-2 flex-wrap pt-0.5">
                <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-indigo-500/10 border border-indigo-500/30 text-indigo-400 capitalize font-medium">
                  {job.workMode}
                </span>

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
                  <Calendar className="w-3 h-3 text-neutral-400" />
                  <span>{job.postedDateText || 'Active'}</span>
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
            </div>
          </div>

          {/* Right Section: Match Score Badge & Close */}
          <div className="flex items-center gap-3 shrink-0">
            <div className={`px-3 py-1.5 rounded-xl border text-center flex flex-col items-center ${
              job.fitScore >= 90
                ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-400'
                : job.fitScore >= 75
                ? 'bg-teal-500/10 border-teal-500/40 text-teal-400'
                : job.fitScore >= 50
                ? 'bg-amber-500/10 border-amber-500/40 text-amber-400'
                : 'bg-rose-500/10 border-rose-500/40 text-rose-400'
            }`}>
              <span className="text-xs font-mono font-bold leading-none">{job.fitScore}%</span>
              <span className="text-[9px] font-mono uppercase tracking-wider opacity-80 mt-0.5">{job.matchTier}</span>
            </div>

            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-neutral-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
              aria-label="Close details"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Navigation Sub-Tabs */}
        <div className="px-6 py-2 bg-[#141414] border-b border-white/10 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setActiveTab('overview')}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                activeTab === 'overview'
                  ? 'bg-white/15 text-white font-semibold'
                  : 'text-neutral-400 hover:text-neutral-200'
              }`}
            >
              Overview & Details
            </button>
            <button
              onClick={() => {
                setActiveTab('requirements');
                if (!matchData && !isLoadingMatch) {
                  handleFetchMatch();
                }
              }}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer ${
                activeTab === 'requirements'
                  ? 'bg-white/15 text-white font-semibold'
                  : 'text-neutral-400 hover:text-neutral-200'
              }`}
            >
              <Layers className="w-3.5 h-3.5 text-emerald-400" />
              <span>Requirements & Evidence</span>
              {matchData && (
                <span className="px-1.5 py-0.2 rounded-full text-[10px] font-mono bg-emerald-500/20 text-emerald-400">
                  {matchData.matches.length}
                </span>
              )}
            </button>
          </div>

          {activeTab === 'requirements' && (
            <button
              onClick={handleFetchMatch}
              disabled={isLoadingMatch}
              className="text-[11px] font-mono text-neutral-400 hover:text-white flex items-center gap-1 cursor-pointer disabled:opacity-50"
            >
              {isLoadingMatch && <Loader2 className="w-3 h-3 animate-spin" />}
              <span>{isLoadingMatch ? 'Analyzing...' : 'Refresh Evidence'}</span>
            </button>
          )}
        </div>

        {/* Scrollable Body Content */}
        <div className="p-6 overflow-y-auto space-y-5 flex-1 text-sm">
          {activeTab === 'overview' ? (
            <>
              {/* AI Reasoning Box */}
              <div className="p-4 rounded-xl bg-[#141414] border border-white/10 space-y-3">
                <div className="flex items-center gap-2 text-xs font-mono font-semibold text-white">
                  <Sparkles className="w-4 h-4 text-emerald-400" />
                  <span>AI Fit & Verified Alignment</span>
                </div>
                <p className="text-xs sm:text-sm leading-relaxed text-neutral-300">{job.fitReason}</p>

                {/* Matched vs Missing Skills Matrix */}
                <div className="pt-2 border-t border-white/10 space-y-2">
                  <div className="flex items-center justify-between text-[11px] font-mono text-neutral-400">
                    <span>Requirements Match Breakdown</span>
                    <span>{job.matchedSkills.length} Matched · {job.missingSkills.length} Gaps</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {job.matchedSkills.map((skill, i) => (
                      <span
                        key={`match-${i}`}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 font-mono font-medium"
                        title="Verified skill from your profile"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5 shrink-0 text-emerald-400" />
                        <span>{skill}</span>
                      </span>
                    ))}
                    {job.missingSkills.map((missing, i) => (
                      <span
                        key={`miss-${i}`}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs bg-amber-500/10 border border-amber-500/30 text-amber-400 font-mono font-medium"
                        title="Skill required by job but not in your verified profile"
                      >
                        <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-amber-400" />
                        <span>{missing}</span>
                      </span>
                    ))}
                  </div>
                </div>
              </div>

              {/* Role Specifics Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
                <div className="p-3 bg-[#141414] rounded-xl border border-white/10 space-y-1">
                  <div className="text-neutral-400 text-[11px] flex items-center gap-1">
                    <DollarSign className="w-3.5 h-3.5 text-emerald-400" />
                    <span>Compensation</span>
                  </div>
                  <div className="font-medium text-white truncate">
                    {job.salaryText || 'Competitive'}
                  </div>
                </div>

                <div className="p-3 bg-[#141414] rounded-xl border border-white/10 space-y-1">
                  <div className="text-neutral-400 text-[11px] flex items-center gap-1">
                    <Briefcase className="w-3.5 h-3.5 text-indigo-400" />
                    <span>Employment Type</span>
                  </div>
                  <div className="font-medium text-white capitalize truncate">
                    {job.employmentType ? job.employmentType.replace('_', ' ') : 'Full-time'}
                  </div>
                </div>

                <div className="p-3 bg-[#141414] rounded-xl border border-white/10 space-y-1 col-span-2 sm:col-span-1">
                  <div className="text-neutral-400 text-[11px] flex items-center gap-1">
                    <GraduationCap className="w-3.5 h-3.5 text-sky-400" />
                    <span>Seniority Level</span>
                  </div>
                  <div className="font-medium text-white capitalize truncate">
                    {job.seniority ? job.seniority.replace('_', ' ') : 'Junior / Entry'}
                  </div>
                </div>
              </div>

              {/* Full Job Description */}
              <div className="space-y-3 pt-2">
                <h3 className="text-xs font-mono uppercase tracking-wider text-neutral-400 font-semibold">
                  Full Job Description
                </h3>
                <div className="p-4 sm:p-5 rounded-xl bg-[#141414] border border-white/10">
                  <StructuredJobDescription description={job.description} blocks={job.descriptionBlocks} jobTitle={job.title} />
                </div>
              </div>
            </>
          ) : (
            /* Requirements & Evidence Tab */
            <div className="space-y-5">
              {isLoadingMatch && (
                <div className="p-8 text-center space-y-2 bg-[#141414] rounded-xl border border-white/10">
                  <Loader2 className="w-6 h-6 animate-spin text-emerald-400 mx-auto" />
                  <p className="text-xs text-neutral-300">Extracting atomic requirements and matching profile facts...</p>
                </div>
              )}

              {!isLoadingMatch && matchData && (
                <>
                  {/* Category & Evidence Priorities Header */}
                  <div className="p-4 rounded-xl bg-[#141414] border border-white/10 space-y-2.5">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="px-2.5 py-1 rounded text-xs font-mono font-bold bg-indigo-500/15 border border-indigo-500/40 text-indigo-400 uppercase">
                          {matchData.roleCategory.replace('_', ' ')}
                        </span>
                        <span className="text-xs text-neutral-400">Deterministic Match Score:</span>
                        <span className="text-xs font-mono font-bold text-emerald-400">{matchData.overallScore}%</span>
                      </div>

                      <button
                        onClick={handleCreateSnapshot}
                        disabled={isCreatingSnapshot}
                        className="flex items-center gap-1 px-3 py-1 rounded-lg text-xs font-medium bg-white/10 hover:bg-white/20 border border-white/20 text-white transition-colors cursor-pointer disabled:opacity-50"
                        title="Snapshot canonical profile facts for this application view"
                      >
                        {isCreatingSnapshot ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : snapshotResult ? (
                          <Check className="w-3.5 h-3.5 text-emerald-400" />
                        ) : (
                          <FileCheck className="w-3.5 h-3.5" />
                        )}
                        <span>{snapshotResult ? 'Snapshot Created' : 'Create Snapshot'}</span>
                      </button>
                    </div>

                    <div className="text-xs text-neutral-300 space-y-1">
                      <span className="font-semibold text-neutral-200">Role Evidence Priorities: </span>
                      <span className="text-neutral-400">{matchData.roleFocus}</span>
                    </div>

                    {snapshotResult && (
                      <div className="p-2.5 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-[11px] font-mono text-emerald-400 flex items-center justify-between">
                        <span>ApplicationProfileSnapshot: {snapshotResult.id}</span>
                        <span>{snapshotResult.selectedFactIds.length} facts referenced</span>
                      </div>
                    )}
                  </div>

                  {/* Requirements Matrix */}
                  <div className="space-y-3">
                    <h3 className="text-xs font-mono uppercase tracking-wider text-neutral-400 font-semibold flex items-center justify-between">
                      <span>Requirement-to-Profile Grounding</span>
                      <span>
                        {matchData.strongMatches.length} Direct · {matchData.transferableMatches.length} Transferable · {matchData.missingRequirements.length} Missing
                      </span>
                    </h3>

                    {/* Requirement Items */}
                    <div className="space-y-2.5">
                      {matchData.matches.map((item) => (
                        <div
                          key={item.requirementId}
                          className={`p-3.5 rounded-xl border text-xs space-y-2 ${
                            item.matchLevel === 'strong'
                              ? 'bg-[#121612] border-emerald-500/30'
                              : item.matchLevel === 'transferable'
                              ? 'bg-[#181611] border-amber-500/30'
                              : 'bg-[#151515] border-white/10'
                          }`}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="space-y-1 flex-1">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className={`px-2 py-0.5 rounded text-[10px] font-mono uppercase font-bold ${
                                  item.matchLevel === 'strong'
                                    ? 'bg-emerald-500/20 text-emerald-400'
                                    : item.matchLevel === 'transferable'
                                    ? 'bg-amber-500/20 text-amber-400'
                                    : 'bg-neutral-800 text-neutral-400'
                                }`}>
                                  {item.matchLevel === 'strong'
                                    ? 'Direct Match'
                                    : item.matchLevel === 'transferable'
                                    ? 'Transferable Match'
                                    : 'Missing Fact'}
                                </span>
                                <span className="text-[10px] font-mono text-neutral-500 uppercase">{item.requirementType}</span>
                              </div>
                              <p className="font-medium text-white">{item.requirementText}</p>
                            </div>
                          </div>

                          {/* Candidate Evidence */}
                          <div className="pt-1.5 border-t border-white/10 space-y-1 text-[11px]">
                            <div className="text-neutral-400 flex items-start gap-1.5">
                              <span className="font-semibold text-neutral-300 shrink-0">Profile Evidence:</span>
                              <span className="text-neutral-300">{item.candidateEvidence}</span>
                            </div>
                            <div className="text-neutral-400 flex items-start gap-1.5">
                              <span className="font-semibold text-neutral-300 shrink-0">Rationale:</span>
                              <span className="italic text-neutral-400">{item.rationale}</span>
                            </div>
                            {item.verifiedFactIds && item.verifiedFactIds.length > 0 && (
                              <div className="flex items-center gap-1.5 flex-wrap pt-0.5">
                                <span className="text-[10px] font-mono text-neutral-500">Fact IDs:</span>
                                {item.verifiedFactIds.map((fid) => (
                                  <span
                                    key={fid}
                                    className="px-1.5 py-0.5 rounded text-[9px] font-mono bg-white/5 border border-white/10 text-neutral-400"
                                  >
                                    {fid}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              )}

              {!isLoadingMatch && !matchData && (
                <div className="p-8 text-center space-y-3 bg-[#141414] rounded-xl border border-white/10">
                  <Info className="w-8 h-8 text-neutral-400 mx-auto" />
                  <p className="text-xs text-neutral-300">
                    Run deterministic requirement extraction to view atomic requirements, profile evidence traceability, and transferable skill analysis.
                  </p>
                  <button
                    onClick={handleFetchMatch}
                    className="px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-black font-semibold text-xs transition-colors cursor-pointer"
                  >
                    Analyze Requirements
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Modal Sticky Footer */}
        <div className="px-6 py-4 border-t border-white/10 bg-[#111111] flex flex-wrap items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2 text-xs text-neutral-400 font-mono">
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
            <span>Verified via {job.sourceAdapter ? job.sourceAdapter.toUpperCase() : 'ATS Board'}</span>
          </div>

          <div className="flex items-center gap-2.5">
            <button
              onClick={() => onToggleSave(job)}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium border transition-colors cursor-pointer ${
                isSaved
                  ? 'bg-white text-black border-white shadow-sm font-semibold'
                  : 'bg-[#1F1F1F] border-white/15 text-neutral-300 hover:text-white hover:bg-white/10'
              }`}
              title={isSaved ? 'Remove from saved' : 'Save opportunity'}
            >
              <Bookmark className="w-3.5 h-3.5" />
              <span>{isSaved ? 'Saved' : 'Save'}</span>
            </button>

            <button
              onClick={() => onTailorResume(job)}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-black font-semibold text-xs transition-colors cursor-pointer shadow-sm"
              title="Generate ATS Resume & Cover Letter Grounded in Verified Profile"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>Tailor Resume</span>
            </button>

            {hasValidUrl ? (
              <a
                href={job.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-white text-black font-semibold text-xs hover:bg-neutral-200 transition-colors cursor-pointer shrink-0"
              >
                <span>Apply on Portal</span>
                <ArrowUpRight className="w-3.5 h-3.5" />
              </a>
            ) : (
              <button
                disabled
                className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-neutral-800 text-neutral-500 font-semibold text-xs cursor-not-allowed shrink-0"
                title="Direct URL not available for manual entry"
              >
                <span>Apply on Portal</span>
                <ArrowUpRight className="w-3.5 h-3.5 opacity-40" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
};
