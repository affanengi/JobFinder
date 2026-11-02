import React, { useState, useEffect } from 'react';
import { 
  Building2, 
  ArrowLeft, 
  ExternalLink, 
  ShieldCheck, 
  AlertTriangle, 
  ShieldAlert, 
  Search, 
  UserCheck, 
  Mail, 
  Briefcase, 
  Loader2, 
  CheckCircle2, 
  Globe, 
  Sparkles,
  ChevronRight,
  Info,
  RefreshCw,
  Trash2
} from 'lucide-react';
import { fetchWithAuth } from '../lib/api';
import { CompanyDetail } from '../types/company';
import { CompanyIntelligenceResult } from '../types/companyIntelligence';
import { ContactSearchLink, DiscoveredContact, EmailEvidenceClassification, RoleEvidenceStatus } from '../types/opportunityContact';
import { CompanyLogo } from '../components/recommendations/CompanyFilterRibbon';
import { DeleteConfirmModal } from '../components/ui/DeleteConfirmModal';

interface CompanyProfilePageProps {
  companyKey: string;
  onBackToDirectory: () => void;
  onSelectContact: (contactId: string, opportunityId: string) => void;
}

export const CompanyProfilePage: React.FC<CompanyProfilePageProps> = ({
  companyKey,
  onBackToDirectory,
  onSelectContact,
}) => {
  const [detail, setDetail] = useState<CompanyDetail | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [runningScamShield, setRunningScamShield] = useState<boolean>(false);
  const [discoveringContacts, setDiscoveringContacts] = useState<boolean>(false);
  const [actionFeedback, setActionFeedback] = useState<{
    type: 'success' | 'info' | 'error';
    text: string;
  } | null>(null);
  const [searchLinks, setSearchLinks] = useState<ContactSearchLink[]>([]);
  const [contactToDelete, setContactToDelete] = useState<DiscoveredContact | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const handleConfirmDeleteContact = async () => {
    if (!contactToDelete) return;
    const oppId = contactToDelete.opportunityId || detail?.primaryOpportunityId;
    if (!oppId) return;

    setDeleteError(null);
    try {
      const res = await fetchWithAuth(`/api/v1/opportunities/${oppId}/contacts/${contactToDelete.id}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.detail || `Failed to delete contact (${res.status})`);
      }

      setDetail((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          contacts: prev.contacts.filter((c) => c.id !== contactToDelete.id),
        };
      });
      const deletedName = contactToDelete.fullName;
      setContactToDelete(null);
      setActionFeedback({
        type: 'success',
        text: `Contact "${deletedName}" was deleted and suppressed.`,
      });
    } catch (err: any) {
      const msg = err.message || 'An unexpected error occurred while deleting the contact.';
      setDeleteError(msg);
      throw err;
    }
  };

  const fetchCompanyDetail = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetchWithAuth(`/api/v1/companies/${companyKey}`);
      if (!res.ok) {
        throw new Error(`Failed to load company profile (${res.status})`);
      }
      const data: CompanyDetail = await res.json();
      setDetail(data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error loading company profile.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (companyKey) {
      fetchCompanyDetail();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyKey]);

  const handleRunScamShield = async () => {
    if (!detail) return;
    try {
      setRunningScamShield(true);
      setActionFeedback(null);
      const res = await fetchWithAuth(`/api/v1/opportunities/${detail.primaryOpportunityId}/research`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ forceRefresh: true }),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.detail || `Scam Shield audit failed (${res.status})`);
      }
      const intel: CompanyIntelligenceResult = await res.json();
      setDetail((prev) => (prev ? { ...prev, intelligence: intel } : prev));
      setActionFeedback({
        type: 'success',
        text: 'Scam Shield research completed successfully!',
      });
    } catch (err: unknown) {
      setActionFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'Scam Shield research failed.',
      });
    } finally {
      setRunningScamShield(false);
    }
  };

  const handleDiscoverContacts = async () => {
    if (!detail) return;
    try {
      setDiscoveringContacts(true);
      setActionFeedback(null);
      const res = await fetchWithAuth(`/api/v1/opportunities/${detail.primaryOpportunityId}/contacts/discover`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ forceRefresh: true }),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.detail || `Contact discovery failed (${res.status})`);
      }
      const result = await res.json();
      const discovered: DiscoveredContact[] = result.contacts || [];
      const links: ContactSearchLink[] = result.searchLinks || [];
      setDetail((prev) => (prev ? { ...prev, contacts: discovered } : prev));
      setSearchLinks(links);

      if (discovered.length > 0) {
        setActionFeedback({
          type: 'success',
          text: `Discovered ${discovered.length} professional contacts for ${detail.name}!`,
        });
      } else {
        setActionFeedback({
          type: 'info',
          text: result.message || `No public contacts found with sufficient evidence for ${detail.name}. Check the exploration links below.`,
        });
      }
    } catch (err: unknown) {
      setActionFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'Contact discovery failed.',
      });
    } finally {
      setDiscoveringContacts(false);
    }
  };

  const getEvidenceBadge = (classification: EmailEvidenceClassification) => {
    switch (classification) {
      case 'PROVIDER_VERIFIED':
        return (
          <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
            Provider Verified
          </span>
        );
      case 'PUBLICLY_LISTED':
        return (
          <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-sky-500/10 text-sky-400 border border-sky-500/30">
            Publicly Listed
          </span>
        );
      case 'PATTERN_INFERRED':
        return (
          <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-amber-500/10 text-amber-400 border border-amber-500/30">
            Pattern Inferred (Unverified)
          </span>
        );
      case 'DOMAIN_MAIL_ENABLED':
        return (
          <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-blue-500/10 text-blue-400 border border-blue-500/30">
            Domain Mail Routing
          </span>
        );
      case 'UNVERIFIED':
      default:
        return (
          <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-neutral-800 text-neutral-400 border border-neutral-700">
            Unverified
          </span>
        );
    }
  };

  const getRoleBadge = (status?: RoleEvidenceStatus) => {
    switch (status) {
      case 'CURRENT_CONFIRMED':
        return (
          <span className="whitespace-nowrap shrink-0 inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
            Confirmed Current
          </span>
        );
      case 'FORMER_ROLE':
        return (
          <span className="whitespace-nowrap shrink-0 inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-semibold bg-rose-500/10 text-rose-400 border border-rose-500/20">
            Former Role
          </span>
        );
      case 'UNCLEAR_ASSOCIATION':
        return (
          <span className="whitespace-nowrap shrink-0 inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-medium bg-neutral-800 text-neutral-400 border border-neutral-700">
            Unclear Role
          </span>
        );
      case 'LIKELY_CURRENT':
      default:
        return (
          <span className="whitespace-nowrap shrink-0 inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-medium bg-neutral-800 text-neutral-300 border border-neutral-700">
            Likely Current
          </span>
        );
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center p-16 space-y-4">
        <Loader2 className="w-8 h-8 animate-spin text-emerald-400" />
        <p className="text-xs text-neutral-400">Loading company profile...</p>
      </div>
    );
  }

  if (error || !detail) {
    return (
      <div className="p-8 rounded-2xl bg-rose-500/10 border border-rose-500/20 text-center space-y-3">
        <AlertTriangle className="w-8 h-8 text-rose-400 mx-auto" />
        <h3 className="text-sm font-semibold text-rose-200">Unable to Load Company</h3>
        <p className="text-xs text-rose-300">{error || 'Company not found'}</p>
        <button
          onClick={onBackToDirectory}
          className="px-4 py-2 bg-[#1A1A1A] hover:bg-[#222222] border border-white/10 rounded-xl text-xs font-semibold text-white transition"
        >
          Return to Directory
        </button>
      </div>
    );
  }

  const intel = detail.intelligence;

  return (
    <div className="space-y-8 animate-in fade-in duration-150">
      {/* Breadcrumb Navigation */}
      <nav aria-label="Breadcrumbs" className="flex items-center gap-2 text-xs text-neutral-400">
        <button
          onClick={onBackToDirectory}
          className="hover:text-white transition flex items-center gap-1 font-medium"
        >
          <Building2 className="w-3.5 h-3.5 text-emerald-400" />
          Companies & Contacts
        </button>
        <span className="text-neutral-600">/</span>
        <span className="text-white font-semibold">{detail.name}</span>
      </nav>

      {/* Wireframe 2 Header Card */}
      <div className="p-6 md:p-8 rounded-2xl bg-[#141414] border border-white/10 flex flex-col md:flex-row items-start md:items-center justify-between gap-6 shadow-sm">
        <div className="flex items-center gap-5">
          <div className="w-20 h-20 md:w-24 md:h-24 rounded-2xl bg-[#1E1E1E] border border-white/10 flex items-center justify-center p-4 shrink-0 shadow-inner">
            <CompanyLogo company={detail.name} domain={detail.domain} size={64} />
          </div>

          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="text-2xl font-bold tracking-tight text-white">{detail.name}</h1>
              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-neutral-800 text-neutral-300 border border-neutral-700 font-mono">
                {detail.domain}
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-4 text-xs text-neutral-400 pt-0.5">
              <span className="flex items-center gap-1.5">
                <Briefcase className="w-3.5 h-3.5 text-neutral-500" />
                {detail.opportunities.length} {detail.opportunities.length === 1 ? 'Active Opportunity' : 'Active Opportunities'}
              </span>

              {detail.careersUrl && (
                <a
                  href={detail.careersUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-1 text-emerald-400 hover:text-emerald-300 transition hover:underline"
                >
                  <Globe className="w-3.5 h-3.5" />
                  Careers Page
                  <ExternalLink className="w-3 h-3 ml-0.5" />
                </a>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <button
            onClick={onBackToDirectory}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-neutral-300 border border-white/10 text-xs font-semibold transition"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Back to Directory
          </button>
        </div>
      </div>

      {actionFeedback && (
        <div
          role="status"
          aria-live="polite"
          className={`p-3.5 rounded-xl text-xs flex items-center gap-2.5 transition-all shadow-sm ${
            actionFeedback.type === 'success'
              ? 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-300'
              : actionFeedback.type === 'info'
              ? 'bg-sky-500/10 border border-sky-500/30 text-sky-300'
              : 'bg-rose-500/10 border border-rose-500/30 text-rose-300'
          }`}
        >
          {actionFeedback.type === 'success' && <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />}
          {actionFeedback.type === 'info' && <Info className="w-4 h-4 text-sky-400 shrink-0" />}
          {actionFeedback.type === 'error' && <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />}
          <span className="font-medium">{actionFeedback.text}</span>
        </div>
      )}

      {/* Middle: Company Overview & Scam Shield Legitimacy */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Attributable Overview */}
        <div className="lg:col-span-1 p-6 rounded-2xl bg-[#141414] border border-white/10 space-y-4">
          <div className="flex items-center justify-between border-b border-white/5 pb-3">
            <h2 className="text-sm font-semibold text-white flex items-center gap-2">
              <Info className="w-4 h-4 text-emerald-400" />
              Company Overview
            </h2>
            <span className="text-[10px] text-neutral-500 font-mono">Verified Intel</span>
          </div>

          <div className="text-xs text-neutral-300 leading-relaxed space-y-3">
            {intel?.riskTier === 'INSUFFICIENT_EVIDENCE' || (!intel?.overview && !intel?.summary) ? (
              <div className="space-y-3">
                <div className="p-3.5 bg-neutral-900/60 border border-amber-500/20 rounded-xl space-y-2">
                  <div className="flex items-center gap-1.5 text-amber-400 font-medium text-xs">
                    <AlertTriangle className="w-3.5 h-3.5" />
                    <span>Company information could not be retrieved</span>
                  </div>
                  <p className="text-neutral-400 text-[11px] leading-relaxed">
                    Public corporate web evidence for {detail.name} could not be retrieved from verified sources during automated harvesting.
                  </p>
                  <button
                    onClick={handleRunScamShield}
                    disabled={runningScamShield}
                    className="mt-1 px-3 py-1.5 text-xs rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/30 transition flex items-center gap-1.5 font-medium disabled:opacity-50"
                  >
                    <RefreshCw className={`w-3 h-3 ${runningScamShield ? 'animate-spin' : ''}`} />
                    Retry Company Research
                  </button>
                </div>
                {intel?.officialDomain && (
                  <div className="pt-2 text-[11px] text-neutral-400 border-t border-white/5 space-y-1">
                    <div>
                      Canonical Domain: <span className="text-white font-mono">{intel.officialDomain}</span>
                    </div>
                    {intel.researchedAt && (
                      <div className="text-neutral-500">
                        Last Attempted: {new Date(intel.researchedAt).toLocaleDateString()}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-neutral-200 leading-relaxed font-normal">
                  {intel.overview || intel.summary}
                </p>

                {intel.industry && (
                  <div>
                    <span className="inline-block px-2.5 py-1 rounded-md bg-neutral-800 text-neutral-300 text-[11px] font-medium border border-white/5">
                      Industry: {intel.industry}
                    </span>
                  </div>
                )}

                {intel.productsAndServices && intel.productsAndServices.length > 0 && (
                  <div className="space-y-1.5 pt-1">
                    <span className="text-[11px] font-medium text-neutral-400">Products & Services:</span>
                    <div className="flex flex-wrap gap-1.5">
                      {intel.productsAndServices.map((prod, idx) => (
                        <span key={idx} className="px-2 py-0.5 rounded-md bg-emerald-500/10 text-emerald-300 border border-emerald-500/20 text-[10px] font-medium">
                          {prod}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {intel.headquarters && (
                  <div className="text-[11px] text-neutral-400">
                    Headquarters: <span className="text-white font-medium">{intel.headquarters}</span>
                  </div>
                )}

                {intel.companySize && (
                  <div className="text-[11px] text-neutral-400">
                    Company Size: <span className="text-white font-medium">{intel.companySize}</span>
                  </div>
                )}

                {intel.officialDomain && (
                  <div className="pt-2 text-[11px] text-neutral-400 border-t border-white/5 space-y-1">
                    <div>
                      Verified Domain: <span className="text-white font-mono">{intel.officialDomain}</span>
                    </div>
                    {intel.researchedAt && (
                      <div className="text-neutral-500">
                        Audited: {new Date(intel.researchedAt).toLocaleDateString()}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Scam Shield Legitimacy Assessment */}
        <div className="lg:col-span-2 p-6 rounded-2xl bg-[#141414] border border-white/10 space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/5 pb-3">
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-emerald-400" />
              <h2 className="text-sm font-semibold text-white">Scam Shield Legitimacy Assessment</h2>
            </div>

            {intel ? (
              <div className="flex items-center gap-2">
                {intel.riskTier === 'NO_OBVIOUS_RED_FLAGS_FOUND' && (
                  <span className="px-3 py-1 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 flex items-center gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5" /> Low Risk • No Obvious Red Flags
                  </span>
                )}
                {intel.riskTier === 'NEEDS_VERIFICATION' && (
                  <span className="px-3 py-1 rounded-full text-xs font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/30 flex items-center gap-1.5">
                    <AlertTriangle className="w-3.5 h-3.5" /> Caution • Needs Verification
                  </span>
                )}
                {intel.riskTier === 'INSUFFICIENT_EVIDENCE' && (
                  <span className="px-3 py-1 rounded-full text-xs font-semibold bg-sky-500/10 text-sky-400 border border-sky-500/30 flex items-center gap-1.5">
                    <Info className="w-3.5 h-3.5" /> Research Incomplete • Insufficient Evidence
                  </span>
                )}
                {intel.riskTier === 'SIGNIFICANT_RED_FLAGS' && (
                  <span className="px-3 py-1 rounded-full text-xs font-semibold bg-rose-500/10 text-rose-400 border border-rose-500/30 flex items-center gap-1.5">
                    <ShieldAlert className="w-3.5 h-3.5" /> High Risk • Red Flags Detected
                  </span>
                )}
              </div>
            ) : (
              <span className="px-2.5 py-0.5 rounded-full text-xs font-medium bg-neutral-800 text-neutral-400 border border-neutral-700">
                Not Researched
              </span>
            )}
          </div>

          {/* Critical Foundational Disclaimer */}
          <div className="p-3 bg-neutral-900/60 border border-white/5 rounded-xl text-[11px] text-neutral-400 leading-relaxed flex items-start gap-2">
            <Info className="w-4 h-4 text-neutral-500 shrink-0 mt-0.5" />
            <span>
              <strong>Note:</strong> Absence of detected red flags does not guarantee a company's authenticity, and absence of public evidence does not establish suspicion. JobFinder evaluates verifiable public data, domain consistency, and requisition alignment.
            </span>
          </div>

          {intel ? (
            <div className="space-y-4">
              {/* Evaluated Dimensions */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                {[
                  { key: 'domainConsistency', label: 'Domain Consistency' },
                  { key: 'paymentSolicitations', label: 'Payment Solicitations' },
                  { key: 'communicationChannels', label: 'Communication Channel' },
                  { key: 'publicScamReports', label: 'Public Scam Reports' },
                  { key: 'requisitionConsistency', label: 'Requisition Consistency' },
                ].map(({ key, label }) => {
                  const dim = intel.evaluatedDimensions?.[key];
                  const status = dim?.status || 'INSUFFICIENT_EVIDENCE';
                  const isPass = status === 'PASS';
                  const isFail = status === 'FAIL';
                  const isWarn = status === 'WARN';
                  return (
                    <div key={key} className="p-3 rounded-xl bg-neutral-900/40 border border-white/5 flex flex-col justify-between gap-1">
                      <div className="flex items-center justify-between">
                        <span className="text-neutral-300 font-medium">{label}</span>
                        <span className={`text-[11px] font-semibold ${
                          isPass ? 'text-emerald-400' : isFail ? 'text-rose-400' : isWarn ? 'text-amber-400' : 'text-neutral-400'
                        }`}>
                          {status.replace('_', ' ')}
                        </span>
                      </div>
                      {dim?.evidence && (
                        <p className="text-[11px] text-neutral-400 line-clamp-2 mt-0.5">
                          {dim.evidence}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Insufficient Evidence Notice with Retry */}
              {intel.riskTier === 'INSUFFICIENT_EVIDENCE' && (
                <div className="text-xs text-neutral-300 bg-neutral-900/60 p-3.5 rounded-xl border border-white/10 flex items-center justify-between gap-3">
                  <div className="space-y-0.5">
                    <span className="text-[11px] font-semibold text-neutral-200">
                      Automated evidence extraction was inconclusive
                    </span>
                    <p className="text-[10px] text-neutral-400">
                      No red flags were detected, but verifiable public pages could not be extracted to confirm legitimacy.
                    </p>
                  </div>
                  <button
                    onClick={handleRunScamShield}
                    disabled={runningScamShield}
                    className="px-3 py-1.5 text-xs rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/30 transition flex items-center gap-1.5 shrink-0 font-medium disabled:opacity-50"
                  >
                    <RefreshCw className={`w-3 h-3 ${runningScamShield ? 'animate-spin' : ''}`} />
                    Retry Audit
                  </button>
                </div>
              )}

              {/* Rationale & Red Flags (Only displayed when actual risk signals exist) */}
              {intel.redFlags && intel.redFlags.length > 0 && intel.riskTier !== 'INSUFFICIENT_EVIDENCE' && (
                <div className="text-xs text-rose-300 bg-rose-500/10 p-3.5 rounded-xl border border-rose-500/20 space-y-1">
                  <span className="text-[10px] uppercase font-bold tracking-wider text-rose-400">
                    Flagged Risks
                  </span>
                  <ul className="list-disc list-inside space-y-0.5 text-[11px]">
                    {intel.redFlags.map((flag, idx) => (
                      <li key={idx}>{flag}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ) : (
            <div className="py-6 text-center space-y-3">
              <p className="text-xs text-neutral-400">
                This organization has not yet undergone autonomous Scam Shield verification.
              </p>
              <button
                onClick={handleRunScamShield}
                disabled={runningScamShield}
                className="inline-flex items-center gap-1.5 px-4 py-2 bg-emerald-500 hover:bg-emerald-600 text-black font-semibold rounded-xl text-xs transition disabled:opacity-50 shadow-lg shadow-emerald-500/10"
              >
                {runningScamShield ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    Auditing Legitimacy...
                  </>
                ) : (
                  <>
                    <Sparkles className="w-3.5 h-3.5" />
                    Run Scam Shield Audit
                  </>
                )}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Wireframe 2 Bottom: Professional Contacts Section */}
      <div className="p-6 md:p-8 rounded-2xl bg-[#141414] border border-white/10 space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/5 pb-4">
          <div className="space-y-1">
            <h2 className="text-base font-bold text-white flex items-center gap-2">
              <UserCheck className="w-5 h-5 text-emerald-400" />
              Discovered Hiring Stakeholders & Contacts ({detail.contacts.length})
            </h2>
            <p className="text-xs text-neutral-400">
              Verified hiring managers, recruiters, and engineering leads discovered through public sources.
            </p>
          </div>

          <button
            onClick={handleDiscoverContacts}
            disabled={discoveringContacts}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-white/5 hover:bg-white/10 text-neutral-200 border border-white/10 rounded-xl text-xs font-semibold transition disabled:opacity-50"
          >
            {discoveringContacts ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin text-emerald-400" />
                Discovering...
              </>
            ) : (
              <>
                <Search className="w-3.5 h-3.5 text-emerald-400" />
                {detail.contacts.length === 0 ? 'Discover Contacts' : 'Refresh Contacts'}
              </>
            )}
          </button>
        </div>

        {/* Contacts Grid */}
        {detail.contacts.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {detail.contacts.map((contact) => (
              <article
                key={contact.id}
                className="group p-5 rounded-xl bg-[#1A1A1A] hover:bg-[#1E1E1E] border border-white/10 hover:border-white/20 transition flex flex-col justify-between space-y-4"
              >
                <div className="space-y-2.5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1 space-y-0.5">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <button
                          type="button"
                          onClick={() => onSelectContact(contact.id, contact.opportunityId || detail.primaryOpportunityId)}
                          className="text-left font-bold text-white group-hover:text-emerald-300 transition truncate cursor-pointer hover:underline focus:outline-none"
                          title={`Reach out to ${contact.fullName}`}
                        >
                          <h3 className="text-sm font-bold truncate">
                            {contact.fullName}
                          </h3>
                        </button>
                        {contact.contactType === 'ORGANIZATION_CHANNEL' && (
                          <span className="whitespace-nowrap shrink-0 px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-500/10 text-amber-400 border border-amber-500/30">
                            Org Channel
                          </span>
                        )}
                        {contact.isAmbiguousMatch && (
                          <span
                            className="whitespace-nowrap shrink-0 px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-500/10 text-amber-400 border border-amber-500/30"
                            title={contact.ambiguityReason || 'Multiple contacts discovered with identical or similar name'}
                          >
                            Ambiguous Match
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-neutral-400 truncate" title={contact.roleTitle}>
                        {contact.roleTitle}
                      </p>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0 self-start pt-0.5">
                      {contact.suppressionState === 'GLOBAL_STAKEHOLDER_SUPPRESSION' && (
                        <span className="whitespace-nowrap shrink-0 px-2 py-0.5 rounded-full text-[9px] font-bold bg-rose-500/10 text-rose-400 border border-rose-500/30">
                          Opted Out
                        </span>
                      )}
                      {getRoleBadge(contact.roleEvidenceStatus)}
                      <button
                        type="button"
                        onClick={() => {
                          setContactToDelete(contact);
                          setDeleteError(null);
                        }}
                        title={`Delete ${contact.fullName}`}
                        aria-label={`Delete ${contact.fullName}`}
                        className="p-1.5 rounded-lg text-neutral-500 hover:text-rose-400 hover:bg-rose-500/10 transition cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  {/* Channel / Email display */}
                  {contact.email ? (
                    <div className="flex items-center gap-1.5 text-xs text-neutral-300 font-mono">
                      <Mail className="w-3.5 h-3.5 text-neutral-400 shrink-0" />
                      <span className="truncate">{contact.email}</span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1.5 text-xs text-sky-400 font-medium">
                      <Globe className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                      <span>Profile-Discovered Candidate</span>
                    </div>
                  )}

                  {/* Multi-Channel Profile Links */}
                  {(contact.linkedinUrl || contact.githubUrl || contact.portfolioUrl) && (
                    <div className="flex flex-wrap items-center gap-1.5 pt-1">
                      {contact.linkedinUrl && (
                        <a
                          href={contact.linkedinUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-[10px] text-sky-400 hover:text-sky-300 font-medium hover:underline bg-sky-500/10 px-2 py-0.5 rounded border border-sky-500/20"
                        >
                          LinkedIn <ExternalLink className="w-2.5 h-2.5" />
                        </a>
                      )}
                      {contact.githubUrl && (
                        <a
                          href={contact.githubUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-[10px] text-neutral-300 hover:text-white font-medium hover:underline bg-neutral-800 px-2 py-0.5 rounded border border-neutral-700"
                        >
                          GitHub <ExternalLink className="w-2.5 h-2.5" />
                        </a>
                      )}
                      {contact.portfolioUrl && (
                        <a
                          href={contact.portfolioUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-[10px] text-emerald-400 hover:text-emerald-300 font-medium hover:underline bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20"
                        >
                          Portfolio <ExternalLink className="w-2.5 h-2.5" />
                        </a>
                      )}
                    </div>
                  )}
                </div>

                <div className="pt-2 border-t border-white/5 flex items-center justify-between">
                  <div>
                    {contact.email ? (
                      getEvidenceBadge(contact.emailClassification)
                    ) : contact.contactabilityStatus === 'PROFILE_ONLY' ? (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-sky-500/10 text-sky-400 border border-sky-500/30">
                        Profile Only
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-neutral-800 text-neutral-400 border border-neutral-700">
                        Multi-Channel
                      </span>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => onSelectContact(contact.id, contact.opportunityId || detail.primaryOpportunityId)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 hover:text-emerald-300 border border-emerald-500/30 text-xs font-semibold transition cursor-pointer"
                  >
                    <span>Draft Outreach</span>
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="space-y-6">
            <div className="p-8 text-center rounded-xl bg-neutral-900/30 border border-dashed border-white/10 space-y-3 max-w-md mx-auto">
              <UserCheck className="w-8 h-8 text-neutral-500 mx-auto opacity-50" />
              <div className="space-y-1">
                <h4 className="text-xs font-semibold text-white">No Stakeholders Discovered Yet</h4>
                <p className="text-[11px] text-neutral-400">
                  Click &quot;Discover Contacts&quot; above to search public evidence for recruiters and hiring managers at {detail.name}.
                </p>
              </div>
              <button
                onClick={handleDiscoverContacts}
                disabled={discoveringContacts}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-emerald-500 hover:bg-emerald-600 text-black font-semibold rounded-lg text-xs transition disabled:opacity-50"
              >
                {discoveringContacts ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    Searching...
                  </>
                ) : (
                  <>
                    <Sparkles className="w-3.5 h-3.5" />
                    Discover Contacts
                  </>
                )}
              </button>
            </div>

            {searchLinks.length > 0 && (
              <div className="p-4 rounded-xl bg-[#141414] border border-white/10 space-y-3">
                <div className="flex items-center gap-2">
                  <Globe className="w-4 h-4 text-emerald-400" />
                  <h4 className="text-xs font-semibold text-white tracking-wide uppercase">
                    Free Web Search Shortcuts ({detail.name})
                  </h4>
                </div>
                <p className="text-[11px] text-neutral-400">
                  Open targeted professional search queries in your browser with zero external API fees:
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 pt-1">
                  {searchLinks.map((link, idx) => (
                    <a
                      key={idx}
                      href={link.url}
                      target="_blank"
                      rel="noreferrer"
                      className="p-3 rounded-lg bg-[#1A1A1A] hover:bg-[#222222] border border-white/5 hover:border-emerald-500/30 transition flex items-center justify-between group text-xs"
                    >
                      <div className="space-y-0.5 pr-2 truncate">
                        <span className="font-medium text-white group-hover:text-emerald-300 transition truncate block">
                          {link.title}
                        </span>
                        <span className="text-[10px] text-neutral-500 font-mono block truncate">
                          {link.query}
                        </span>
                      </div>
                      <ExternalLink className="w-3.5 h-3.5 text-neutral-500 group-hover:text-emerald-400 shrink-0" />
                    </a>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Associated Active Opportunities */}
      {detail.opportunities.length > 0 && (
        <div className="p-6 rounded-2xl bg-[#141414] border border-white/10 space-y-4">
          <h2 className="text-sm font-semibold text-white flex items-center gap-2 border-b border-white/5 pb-3">
            <Briefcase className="w-4 h-4 text-emerald-400" />
            Open Opportunities at {detail.name} ({detail.opportunities.length})
          </h2>

          <div className="divide-y divide-white/5">
            {detail.opportunities.map((opp) => (
              <div key={opp.id} className="py-3 flex flex-wrap items-center justify-between gap-3 text-xs">
                <div>
                  <div className="font-semibold text-white">{opp.title}</div>
                  <div className="text-neutral-400 text-[11px]">
                    {opp.location} • <span className="capitalize">{opp.workMode}</span> • <span className="capitalize">{opp.category}</span>
                  </div>
                </div>

                <a
                  href={opp.sourceUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-emerald-400 hover:text-emerald-300 font-medium transition"
                >
                  View Job Listing <ExternalLink className="w-3 h-3 ml-0.5" />
                </a>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Delete Contact Confirmation Modal */}
      <DeleteConfirmModal
        isOpen={!!contactToDelete}
        title="Delete Contact"
        itemName={contactToDelete?.fullName}
        message={`Are you sure you want to delete ${contactToDelete?.fullName}? This contact will be soft-deleted and tombstoned so future discovery will not resurrect them.`}
        confirmLabel="Delete Contact"
        errorMessage={deleteError}
        onConfirm={handleConfirmDeleteContact}
        onClose={() => {
          setContactToDelete(null);
          setDeleteError(null);
        }}
      />
    </div>
  );
};
