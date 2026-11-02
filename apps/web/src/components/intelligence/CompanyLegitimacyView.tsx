import React, { useState, useEffect } from 'react';
import {
  ShieldCheck,
  ShieldAlert,
  AlertTriangle,
  AlertOctagon,
  CheckCircle2,
  XCircle,
  ExternalLink,
  RefreshCw,
  Loader2,
  Info,
  Calendar,
  Sparkles,
  Search,
  Globe,
} from 'lucide-react';
import { fetchWithAuth } from '../../lib/api';
import {
  CompanyIntelligenceResult,
  CompanyRiskTier,
  DimensionStatus,
} from '../../types/companyIntelligence';

interface CompanyLegitimacyViewProps {
  opportunityId: string;
  companyName: string;
  opportunityUrl?: string;
}

const DIMENSION_LABELS: Record<string, string> = {
  domainConsistency: 'Domain & Corporate Identity',
  paymentSolicitations: 'Upfront Fees & Payment Solicitations',
  communicationChannels: 'Official Communication Channels',
  publicScamReports: 'Public Scam & Impersonation Index',
  requisitionConsistency: 'Requisition & Compensation Consistency',
};

export const CompanyLegitimacyView: React.FC<CompanyLegitimacyViewProps> = ({
  opportunityId,
  companyName,
  opportunityUrl,
}) => {
  const [intel, setIntel] = useState<CompanyIntelligenceResult | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Load existing cached intelligence on mount or opportunity change
  useEffect(() => {
    let isMounted = true;

    async function loadExistingIntel() {
      if (!opportunityId) return;
      setIsLoading(true);
      setError(null);
      try {
        const res = await fetchWithAuth(`/api/v1/opportunities/${opportunityId}/intelligence`);
        if (res.ok) {
          const data: CompanyIntelligenceResult = await res.json();
          if (isMounted) setIntel(data);
        } else if (res.status === 404) {
          // Not researched yet; keep intel null
          if (isMounted) setIntel(null);
        } else {
          const errData = await res.json().catch(() => ({}));
          if (isMounted) setError(errData.detail || 'Could not load company intelligence.');
        }
      } catch (err) {
        if (isMounted) setError('Network error loading intelligence records.');
      } finally {
        if (isMounted) setIsLoading(false);
      }
    }

    loadExistingIntel();
    return () => {
      isMounted = false;
    };
  }, [opportunityId]);

  const handleRunResearch = async (forceRefresh = false) => {
    if (forceRefresh) {
      setIsRefreshing(true);
    } else {
      setIsLoading(true);
    }
    setError(null);

    try {
      const res = await fetchWithAuth(`/api/v1/opportunities/${opportunityId}/research`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ forceRefresh }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.detail || 'Company research failed. Please try again.');
      }

      const data: CompanyIntelligenceResult = await res.json();
      setIntel(data);
    } catch (err: any) {
      setError(err.message || 'An error occurred during company legitimacy research.');
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  };

  const getRiskBadge = (tier: CompanyRiskTier) => {
    switch (tier) {
      case 'NO_OBVIOUS_RED_FLAGS_FOUND':
        return {
          icon: <ShieldCheck className="w-5 h-5 text-emerald-400" />,
          title: 'No Obvious Red Flags Detected',
          badgeClass: 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300',
          desc: 'Careers portal matches employer identity and recruitment operates through standard corporate channels.',
        };
      case 'NEEDS_VERIFICATION':
        return {
          icon: <AlertTriangle className="w-5 h-5 text-amber-400" />,
          title: 'Needs Independent Verification',
          badgeClass: 'bg-amber-500/10 border-amber-500/30 text-amber-300',
          desc: 'Retrieved evidence is sparse or ambiguous. We recommend checking the employer directly on LinkedIn or their primary website.',
        };
      case 'INSUFFICIENT_EVIDENCE':
        return {
          icon: <Info className="w-5 h-5 text-sky-400" />,
          title: 'Research Incomplete • Insufficient Evidence',
          badgeClass: 'bg-sky-500/10 border-sky-500/30 text-sky-300',
          desc: 'Public corporate web evidence could not be retrieved from verified sources. Absence of evidence does not indicate suspicion or risk. Independent verification is recommended.',
        };
      case 'SIGNIFICANT_RED_FLAGS':
        return {
          icon: <AlertOctagon className="w-5 h-5 text-rose-400" />,
          title: 'Significant Red Flags Detected',
          badgeClass: 'bg-rose-500/10 border-rose-500/40 text-rose-300',
          desc: 'High risk indicators detected: upfront payment solicitations, unauthorized communication channels, or recruitment impersonation patterns.',
        };
      default:
        return {
          icon: <ShieldAlert className="w-5 h-5 text-neutral-400" />,
          title: 'Unverified Employer',
          badgeClass: 'bg-neutral-800 border-neutral-700 text-neutral-300',
          desc: 'Company has not yet been audited for legitimacy.',
        };
    }
  };

  const getDimensionStatusBadge = (status: DimensionStatus) => {
    switch (status) {
      case 'PASS':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono font-medium bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
            <CheckCircle2 className="w-3 h-3" /> PASS
          </span>
        );
      case 'WARN':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono font-medium bg-amber-500/15 text-amber-400 border border-amber-500/30">
            <AlertTriangle className="w-3 h-3" /> REVIEW
          </span>
        );
      case 'FAIL':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono font-medium bg-rose-500/15 text-rose-400 border border-rose-500/30">
            <XCircle className="w-3 h-3" /> FAIL
          </span>
        );
      case 'INSUFFICIENT_EVIDENCE':
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono font-medium bg-neutral-800 text-neutral-400 border border-neutral-700">
            INSUFFICIENT DATA
          </span>
        );
    }
  };

  // Loading State
  if (isLoading && !intel) {
    return (
      <div className="p-8 flex flex-col items-center justify-center text-center space-y-4">
        <div className="p-3 bg-indigo-500/10 border border-indigo-500/20 rounded-2xl">
          <Loader2 className="w-8 h-8 text-indigo-400 animate-spin" />
        </div>
        <div className="space-y-1">
          <h4 className="text-sm font-semibold text-white">Extracting & Analyzing Company Intelligence</h4>
          <p className="text-xs text-neutral-400 max-w-md">
            Agent Reach is retrieving public careers pages for <span className="text-white font-medium">{companyName}</span>, followed by multi-dimensional scam screening via JobFinder AI Hub.
          </p>
        </div>
      </div>
    );
  }

  // Error State
  if (error && !intel) {
    return (
      <div className="p-6 space-y-4">
        <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 flex items-start gap-3">
          <AlertOctagon className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
          <div className="space-y-1 text-xs">
            <p className="font-semibold text-rose-200">Company Intelligence Research Failed</p>
            <p>{error}</p>
          </div>
        </div>
        <button
          onClick={() => handleRunResearch(false)}
          className="px-4 py-2 bg-white/10 hover:bg-white/20 text-white rounded-xl text-xs font-medium transition-colors flex items-center gap-2 cursor-pointer"
        >
          <RefreshCw className="w-3.5 h-3.5" /> Retry Research
        </button>
      </div>
    );
  }

  // Empty State (Not Researched Yet)
  if (!intel) {
    return (
      <div className="p-8 flex flex-col items-center justify-center text-center space-y-4 bg-[#111111]/40 border border-white/5 rounded-2xl m-4">
        <div className="p-3 bg-neutral-800/80 border border-neutral-700 rounded-2xl text-neutral-400">
          <Search className="w-8 h-8" />
        </div>
        <div className="space-y-1.5 max-w-md">
          <h4 className="text-sm font-semibold text-white">No Research Generated Yet</h4>
          <p className="text-xs text-neutral-400 leading-relaxed">
            Verify the legitimacy of <span className="text-white font-medium">{companyName}</span> before applying or sharing personal details. JobFinder inspects public hiring domains, recruiter communication channels, and fee triggers.
          </p>
        </div>
        <button
          onClick={() => handleRunResearch(false)}
          disabled={isLoading}
          className="mt-2 px-5 py-2.5 rounded-xl text-xs font-semibold bg-gradient-to-r from-indigo-500 to-indigo-600 hover:from-indigo-600 hover:to-indigo-700 text-white shadow-lg shadow-indigo-500/25 transition-all flex items-center gap-2 cursor-pointer disabled:opacity-50"
        >
          <Sparkles className="w-4 h-4" />
          Research Company & Scam Shield
        </button>
      </div>
    );
  }

  // Loaded State
  const riskBadge = getRiskBadge(intel.riskTier);
  const formattedDate = new Date(intel.researchedAt).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <div className="p-6 space-y-6 text-white max-w-4xl mx-auto">
      {/* Risk Tier Hero Banner */}
      <div className={`p-4 sm:p-5 rounded-2xl border flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 ${riskBadge.badgeClass}`}>
        <div className="flex items-start gap-3.5">
          <div className="p-2 rounded-xl bg-black/30 border border-white/10 shrink-0 mt-0.5">
            {riskBadge.icon}
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-mono font-bold tracking-wider uppercase">
                {intel.riskTier}
              </span>
            </div>
            <h3 className="text-base font-bold text-white tracking-tight">{riskBadge.title}</h3>
            <p className="text-xs text-neutral-300 leading-relaxed max-w-xl">{riskBadge.desc}</p>
          </div>
        </div>

        <button
          onClick={() => handleRunResearch(true)}
          disabled={isRefreshing}
          className="px-3.5 py-2 rounded-xl text-xs font-medium bg-black/40 hover:bg-black/60 border border-white/10 text-white transition-colors flex items-center gap-2 shrink-0 cursor-pointer disabled:opacity-50"
          title="Force fresh extraction via Agent Reach and AI Hub"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
          <span>{isRefreshing ? 'Re-analyzing...' : 'Refresh'}</span>
        </button>
      </div>

      {/* Domain & Source Provenance Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
        <div className="p-3.5 rounded-xl bg-[#141414] border border-white/10 flex items-center justify-between">
          <span className="text-neutral-400 flex items-center gap-1.5">
            <Globe className="w-3.5 h-3.5 text-neutral-500" /> Official Corporate Domain:
          </span>
          <span className="font-mono text-white font-medium">{intel.officialDomain || 'N/A'}</span>
        </div>

        <div className="p-3.5 rounded-xl bg-[#141414] border border-white/10 flex items-center justify-between">
          <span className="text-neutral-400 flex items-center gap-1.5">
            <Calendar className="w-3.5 h-3.5 text-neutral-500" /> Researched At:
          </span>
          <span className="text-neutral-300 font-mono text-[11px]">{formattedDate}</span>
        </div>
      </div>

      {/* Target URL Reference */}
      {(intel.careersUrl || opportunityUrl) && (
        <div className="p-3 rounded-xl bg-[#141414] border border-white/10 flex items-center justify-between gap-3 text-xs">
          <span className="text-neutral-400 truncate">
            Source URL: <span className="text-neutral-300">{intel.careersUrl || opportunityUrl}</span>
          </span>
          <a
            href={intel.careersUrl || opportunityUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-indigo-400 hover:text-indigo-300 inline-flex items-center gap-1 font-medium shrink-0"
          >
            Open Source <ExternalLink className="w-3 h-3" />
          </a>
        </div>
      )}

      {/* Executive Summary */}
      <div className="p-4 rounded-xl bg-[#141414] border border-white/10 space-y-1.5">
        <h4 className="text-xs font-semibold text-neutral-300 uppercase tracking-wider font-mono">
          Executive Evidence Summary
        </h4>
        <p className="text-xs sm:text-sm text-neutral-200 leading-relaxed">{intel.summary}</p>
      </div>

      {/* Red Flags Callout (if any) */}
      {intel.redFlags && intel.redFlags.length > 0 && (
        <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/30 space-y-2">
          <h4 className="text-xs font-bold text-rose-300 uppercase tracking-wider flex items-center gap-2">
            <AlertOctagon className="w-4 h-4 text-rose-400" /> Warning Signals & Red Flags ({intel.redFlags.length})
          </h4>
          <ul className="space-y-1.5 pl-5 list-disc text-xs text-rose-200">
            {intel.redFlags.map((flag, idx) => (
              <li key={idx} className="leading-relaxed">{flag}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Positive Signals (if any) */}
      {intel.positiveSignals && intel.positiveSignals.length > 0 && (
        <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/30 space-y-2">
          <h4 className="text-xs font-bold text-emerald-300 uppercase tracking-wider flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400" /> Authentic Positive Signals ({intel.positiveSignals.length})
          </h4>
          <ul className="space-y-1.5 pl-5 list-disc text-xs text-emerald-200">
            {intel.positiveSignals.map((signal, idx) => (
              <li key={idx} className="leading-relaxed">{signal}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Multi-Dimensional Legitimacy Breakdown */}
      <div className="space-y-3">
        <h4 className="text-xs font-semibold text-neutral-300 uppercase tracking-wider font-mono">
          Multi-Dimensional Legitimacy Assessment
        </h4>
        <div className="space-y-2">
          {Object.entries(intel.evaluatedDimensions || {}).map(([dimKey, dimVal]) => (
            <div
              key={dimKey}
              className="p-3.5 rounded-xl bg-[#141414] border border-white/10 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5"
            >
              <div className="space-y-1 min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-white">
                    {DIMENSION_LABELS[dimKey] || dimKey}
                  </span>
                </div>
                <p className="text-xs text-neutral-400 leading-relaxed">{dimVal.evidence}</p>
              </div>
              <div className="shrink-0 flex items-center gap-2">
                {getDimensionStatusBadge(dimVal.status)}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Mandatory Regulatory Disclaimer */}
      <div className="p-3.5 rounded-xl bg-neutral-900/60 border border-white/5 flex items-start gap-3 text-xs text-neutral-400 leading-relaxed">
        <Info className="w-4 h-4 text-neutral-500 shrink-0 mt-0.5" />
        <p>{intel.disclaimer}</p>
      </div>
    </div>
  );
};
