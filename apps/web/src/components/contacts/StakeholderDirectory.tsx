import React, { useState, useEffect } from 'react';
import {
  Users,
  Search,
  RefreshCw,
  ExternalLink,
  Mail,
  ShieldCheck,
  MapPin,
  CheckCircle2,
  XCircle,
  EyeOff,
  Eye,
  Check,
  AlertTriangle,
  Info,
  Loader2,
  Globe,
} from 'lucide-react';
import { fetchWithAuth } from '../../lib/api';
import {
  DiscoveredContact,
  ContactDiscoveryResponse,
  EmailEvidenceClassification,
  StakeholderTier,
  ContactSearchLink,
} from '../../types/opportunityContact';
import { OutreachComposerModal } from '../outreach/OutreachComposerModal';

interface StakeholderDirectoryProps {
  opportunityId: string;
  companyName: string;
  careersUrl?: string;
}

const TIER_CONFIG: Record<StakeholderTier, { label: string; color: string; bg: string; border: string }> = {
  RECRUITER: {
    label: 'Recruiter / Talent',
    color: 'text-purple-400',
    bg: 'bg-purple-500/15',
    border: 'border-purple-500/30',
  },
  HIRING_MANAGER: {
    label: 'Hiring Manager',
    color: 'text-emerald-400',
    bg: 'bg-emerald-500/15',
    border: 'border-emerald-500/30',
  },
  TECH_LEAD: {
    label: 'Technical Lead',
    color: 'text-blue-400',
    bg: 'bg-blue-500/15',
    border: 'border-blue-500/30',
  },
  REGIONAL_LEAD: {
    label: 'Regional / Site Lead',
    color: 'text-teal-400',
    bg: 'bg-teal-500/15',
    border: 'border-teal-500/30',
  },
  OTHER: {
    label: 'Team Stakeholder',
    color: 'text-neutral-300',
    bg: 'bg-neutral-800',
    border: 'border-white/10',
  },
};

const EVIDENCE_CONFIG: Record<
  EmailEvidenceClassification,
  { label: string; color: string; bg: string; border: string; icon: React.FC<{ className?: string }> }
> = {
  PUBLICLY_LISTED: {
    label: 'Publicly Listed',
    color: 'text-emerald-400',
    bg: 'bg-emerald-500/15',
    border: 'border-emerald-500/40',
    icon: CheckCircle2,
  },
  PROVIDER_VERIFIED: {
    label: 'Provider Verified',
    color: 'text-teal-400',
    bg: 'bg-teal-500/15',
    border: 'border-teal-500/40',
    icon: ShieldCheck,
  },
  PATTERN_INFERRED: {
    label: 'Pattern Inferred',
    color: 'text-amber-400',
    bg: 'bg-amber-500/15',
    border: 'border-amber-500/40',
    icon: AlertTriangle,
  },
  DOMAIN_MAIL_ENABLED: {
    label: 'Domain Mail Enabled',
    color: 'text-sky-400',
    bg: 'bg-sky-500/15',
    border: 'border-sky-500/40',
    icon: Mail,
  },
  UNVERIFIED: {
    label: 'Unverified Address',
    color: 'text-neutral-400',
    bg: 'bg-neutral-800',
    border: 'border-neutral-700',
    icon: Info,
  },
  INVALID_OR_UNSUPPORTED: {
    label: 'Invalid / Unsupported',
    color: 'text-rose-400',
    bg: 'bg-rose-500/15',
    border: 'border-rose-500/40',
    icon: XCircle,
  },
};

export const StakeholderDirectory: React.FC<StakeholderDirectoryProps> = ({
  opportunityId,
  companyName,
  careersUrl,
}) => {
  const [contacts, setContacts] = useState<DiscoveredContact[]>([]);
  const [searchLinks, setSearchLinks] = useState<ContactSearchLink[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isDiscovering, setIsDiscovering] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [showDismissed, setShowDismissed] = useState<boolean>(false);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [selectedOutreachContact, setSelectedOutreachContact] = useState<DiscoveredContact | null>(null);

  // Load existing contacts on mount
  useEffect(() => {
    let isMounted = true;

    async function loadContacts() {
      if (!opportunityId) return;
      setIsLoading(true);
      setError(null);
      try {
        const res = await fetchWithAuth(`/api/v1/opportunities/${opportunityId}/contacts`);
        if (res.ok) {
          const data: DiscoveredContact[] = await res.json();
          if (isMounted) setContacts(data);
        } else {
          const errData = await res.json().catch(() => ({}));
          if (isMounted) setError(errData.detail || 'Could not load contacts.');
        }
      } catch (err) {
        if (isMounted) setError('Network error loading discovered contacts.');
      } finally {
        if (isMounted) setIsLoading(false);
      }
    }

    loadContacts();
    return () => {
      isMounted = false;
    };
  }, [opportunityId]);

  const handleDiscoverContacts = async (forceRefresh = true) => {
    setIsDiscovering(true);
    setError(null);

    try {
      const res = await fetchWithAuth(`/api/v1/opportunities/${opportunityId}/contacts/discover`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ forceRefresh }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.detail || 'Contact discovery failed.');
      }

      const data: ContactDiscoveryResponse = await res.json();
      setContacts(data.contacts || []);
      setSearchLinks(data.searchLinks || []);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Discovery failed. Please try again.';
      setError(msg);
    } finally {
      setIsDiscovering(false);
    }
  };

  const handleToggleDismiss = async (contact: DiscoveredContact) => {
    setUpdatingId(contact.id);
    const newDismissed = !contact.isDismissed;

    // Optimistic UI update
    setContacts((prev) =>
      prev.map((c) => (c.id === contact.id ? { ...c, isDismissed: newDismissed } : c))
    );

    try {
      const res = await fetchWithAuth(
        `/api/v1/opportunities/${opportunityId}/contacts/${contact.id}/dismiss`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ isDismissed: newDismissed }),
        }
      );
      if (!res.ok) {
        // Revert on error
        setContacts((prev) =>
          prev.map((c) => (c.id === contact.id ? { ...c, isDismissed: contact.isDismissed } : c))
        );
      }
    } catch (err) {
      setContacts((prev) =>
        prev.map((c) => (c.id === contact.id ? { ...c, isDismissed: contact.isDismissed } : c))
      );
    } finally {
      setUpdatingId(null);
    }
  };

  const handleToggleReview = async (contact: DiscoveredContact) => {
    setUpdatingId(contact.id);
    const newReviewed = !contact.isReviewed;

    // Optimistic UI update
    setContacts((prev) =>
      prev.map((c) => (c.id === contact.id ? { ...c, isReviewed: newReviewed } : c))
    );

    try {
      const res = await fetchWithAuth(
        `/api/v1/opportunities/${opportunityId}/contacts/${contact.id}/review`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ isReviewed: newReviewed }),
        }
      );
      if (!res.ok) {
        setContacts((prev) =>
          prev.map((c) => (c.id === contact.id ? { ...c, isReviewed: contact.isReviewed } : c))
        );
      }
    } catch (err) {
      setContacts((prev) =>
        prev.map((c) => (c.id === contact.id ? { ...c, isReviewed: contact.isReviewed } : c))
      );
    } finally {
      setUpdatingId(null);
    }
  };

  const visibleContacts = contacts.filter((c) => showDismissed || !c.isDismissed);
  const dismissedCount = contacts.filter((c) => c.isDismissed).length;

  return (
    <div className="space-y-5 text-neutral-200">
      {/* Header & Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-white/10">
        <div>
          <div className="flex items-center gap-2">
            <Users className="w-5 h-5 text-purple-400" />
            <h3 className="text-sm font-semibold text-white tracking-wide">
              Hiring Team & Professional Contacts
            </h3>
            <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-medium bg-purple-500/15 border border-purple-500/30 text-purple-300">
              {contacts.length} Discovered
            </span>
          </div>
          <p className="text-xs text-neutral-400 mt-1">
            Attributable professional contacts associated with {companyName}. Ranked by hiring relevance.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {careersUrl && (
            <a
              href={careersUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="px-2.5 py-1.5 rounded-lg text-xs font-mono text-neutral-400 hover:text-white bg-[#1F1F1F] border border-white/10 transition-colors flex items-center gap-1.5 cursor-pointer"
              title="Open Official Careers Page"
            >
              <Globe className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Careers Portal</span>
              <ExternalLink className="w-3 h-3 text-neutral-500" />
            </a>
          )}

          {dismissedCount > 0 && (
            <button
              onClick={() => setShowDismissed(!showDismissed)}
              className="px-2.5 py-1.5 rounded-lg text-xs font-mono text-neutral-400 hover:text-white bg-[#1F1F1F] border border-white/10 transition-colors flex items-center gap-1.5 cursor-pointer"
            >
              {showDismissed ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
              <span>{showDismissed ? 'Hide Dismissed' : `Show Dismissed (${dismissedCount})`}</span>
            </button>
          )}

          <button
            onClick={() => handleDiscoverContacts(true)}
            disabled={isDiscovering}
            className="px-3 py-1.5 rounded-lg text-xs font-medium text-white bg-purple-600 hover:bg-purple-500 disabled:opacity-50 transition-colors flex items-center gap-1.5 cursor-pointer shadow-sm"
          >
            {isDiscovering ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <RefreshCw className="w-3.5 h-3.5" />
            )}
            <span>{isDiscovering ? 'Discovering...' : contacts.length > 0 ? 'Re-scan Contacts' : 'Discover Contacts'}</span>
          </button>
        </div>
      </div>

      {/* Safety Notice & Cost Policy Banner */}
      <div className="p-3 rounded-xl bg-[#141414] border border-white/10 text-xs text-neutral-300 flex items-start gap-2.5">
        <Info className="w-4 h-4 text-purple-400 shrink-0 mt-0.5" />
        <div className="space-y-1">
          <p className="font-medium text-white">Public Contact Discovery & Zero-Email Policy</p>
          <p className="text-[11px] text-neutral-400 leading-relaxed">
            Contacts are retrieved from public company directories, official postings, and attributable professional sources under{' '}
            <span className="font-mono text-purple-300">CostPolicy.FREE_ONLY</span>. JobFinder never initiates automated outreach or email dispatch.
            Email evidence classifications reflect verifiable public attribution only.
          </p>
        </div>
      </div>

      {/* Error Banner */}
      {error && (
        <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-center justify-between">
          <div className="flex items-center gap-2">
            <XCircle className="w-4 h-4 text-rose-400 shrink-0" />
            <span>{error}</span>
          </div>
          <button
            onClick={() => handleDiscoverContacts(true)}
            className="text-xs underline hover:text-white cursor-pointer"
          >
            Retry
          </button>
        </div>
      )}

      {/* Loading Skeleton */}
      {isLoading && (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="p-4 rounded-xl bg-[#141414] border border-white/5 animate-pulse space-y-2">
              <div className="h-4 bg-white/10 rounded w-1/3" />
              <div className="h-3 bg-white/5 rounded w-1/2" />
            </div>
          ))}
        </div>
      )}

      {/* Empty State */}
      {!isLoading && visibleContacts.length === 0 && (
        <div className="p-8 rounded-2xl bg-[#141414] border border-white/10 text-center space-y-4">
          <div className="w-12 h-12 rounded-2xl bg-purple-500/10 border border-purple-500/20 text-purple-400 flex items-center justify-center mx-auto">
            <Users className="w-6 h-6" />
          </div>
          <div className="max-w-md mx-auto space-y-1">
            <h4 className="text-sm font-semibold text-white">No Professional Contacts Discovered Yet</h4>
            <p className="text-xs text-neutral-400">
              Run public contact discovery for {companyName} to identify recruiters, engineering managers, and technical leads.
            </p>
          </div>
          <button
            onClick={() => handleDiscoverContacts(false)}
            disabled={isDiscovering}
            className="px-4 py-2 rounded-xl text-xs font-semibold text-white bg-purple-600 hover:bg-purple-500 transition-colors inline-flex items-center gap-2 cursor-pointer"
          >
            {isDiscovering ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
            <span>Discover Contacts Now</span>
          </button>
        </div>
      )}

      {/* Contact Cards Grid */}
      {!isLoading && visibleContacts.length > 0 && (
        <div className="space-y-3">
          {visibleContacts.map((contact, idx) => {
            const tierStyle = TIER_CONFIG[contact.stakeholderTier] || TIER_CONFIG.OTHER;
            const evidenceStyle = EVIDENCE_CONFIG[contact.emailClassification] || EVIDENCE_CONFIG.UNVERIFIED;
            const EvidenceIcon = evidenceStyle.icon;

            return (
              <div
                key={contact.id}
                className={`p-4 rounded-xl bg-[#141414] border transition-all duration-200 ${
                  contact.isDismissed
                    ? 'opacity-50 border-white/5 bg-[#0e0e0e]'
                    : contact.isReviewed
                    ? 'border-emerald-500/30 shadow-sm'
                    : 'border-white/10 hover:border-white/20'
                }`}
              >
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                  {/* Left: Contact Details */}
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs font-mono font-bold text-neutral-400">#{idx + 1}</span>
                      <h4 className="text-sm font-semibold text-white">{contact.fullName}</h4>

                      {/* Tier Badge */}
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-mono font-semibold uppercase tracking-wider ${tierStyle.bg} ${tierStyle.color} border ${tierStyle.border}`}
                      >
                        {tierStyle.label}
                      </span>

                      {/* Hyderabad / Location Badge */}
                      {contact.isHyderabad && (
                        <span className="px-2 py-0.5 rounded text-[10px] font-mono font-semibold bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 flex items-center gap-1">
                          <MapPin className="w-3 h-3" />
                          <span>Hyderabad Match</span>
                        </span>
                      )}

                      {/* Reviewed Badge */}
                      {contact.isReviewed && (
                        <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center gap-1">
                          <Check className="w-3 h-3" />
                          <span>Reviewed</span>
                        </span>
                      )}

                      {/* Global Opt-Out Suppression Badge */}
                      {(contact.doNotContact || contact.suppressionState === 'GLOBAL_STAKEHOLDER_SUPPRESSION') && (
                        <span className="px-2 py-0.5 rounded text-[10px] font-mono font-semibold bg-rose-500/15 border border-rose-500/30 text-rose-400 flex items-center gap-1">
                          <XCircle className="w-3 h-3" />
                          <span>Opted Out</span>
                        </span>
                      )}

                      {/* Job-Specific Suppression Badge */}
                      {contact.suppressionState === 'JOB_SPECIFIC_SUPPRESSION' && (
                        <span className="px-2 py-0.5 rounded text-[10px] font-mono font-semibold bg-amber-500/15 border border-amber-500/30 text-amber-400 flex items-center gap-1">
                          <AlertTriangle className="w-3 h-3" />
                          <span>Role Rejected</span>
                        </span>
                      )}
                    </div>

                    <div className="text-xs text-neutral-300 font-medium flex items-center gap-2">
                      <span>{contact.roleTitle}</span>
                      <span className="text-neutral-500">•</span>
                      <span className="text-neutral-400">{contact.companyName}</span>
                      {contact.location && !contact.isHyderabad && (
                        <>
                          <span className="text-neutral-500">•</span>
                          <span className="text-neutral-400 flex items-center gap-0.5">
                            <MapPin className="w-3 h-3 text-neutral-500" />
                            {contact.location}
                          </span>
                        </>
                      )}
                    </div>

                    {/* Email & Evidence Badge */}
                    <div className="flex flex-wrap items-center gap-2 pt-1">
                      {contact.email ? (
                        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#1F1F1F] border border-white/10 text-xs font-mono text-neutral-200">
                          <Mail className="w-3.5 h-3.5 text-neutral-400" />
                          <span>{contact.email}</span>
                        </div>
                      ) : (
                        <span className="text-xs text-neutral-500 italic">No direct email published</span>
                      )}

                      {/* 6-Tier Classification Badge */}
                      <div
                        className={`flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-mono font-medium ${evidenceStyle.bg} ${evidenceStyle.color} border ${evidenceStyle.border}`}
                        title={contact.emailEvidenceSummary || undefined}
                      >
                        <EvidenceIcon className="w-3 h-3" />
                        <span>{evidenceStyle.label}</span>
                      </div>

                      {/* MX Status Pill */}
                      {contact.mxStatus && contact.mxStatus !== 'UNCHECKED' && (
                        <span
                          className={`px-1.5 py-0.5 rounded text-[9px] font-mono uppercase font-bold tracking-wider ${
                            contact.mxStatus === 'VALID_MX'
                              ? 'bg-sky-500/10 text-sky-400 border border-sky-500/20'
                              : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                          }`}
                          title="Passive DNS MX record status for email domain"
                        >
                          MX: {contact.mxStatus}
                        </span>
                      )}
                    </div>

                    {/* Ranking explanation */}
                    {contact.rankingReason && (
                      <p className="text-[11px] text-neutral-400 font-mono pt-0.5">
                        <span className="text-neutral-500">Rank logic:</span> {contact.rankingReason}
                      </p>
                    )}

                    {/* Evidence summary snippet */}
                    {contact.emailEvidenceSummary && (
                      <p className="text-[11px] text-neutral-400 leading-relaxed italic bg-black/20 p-2 rounded-lg border border-white/5">
                        {contact.emailEvidenceSummary}
                      </p>
                    )}
                  </div>

                  {/* Right: Actions & Links */}
                  <div className="flex sm:flex-col items-center sm:items-end gap-2 shrink-0 pt-2 sm:pt-0">
                    <div className="flex items-center gap-1.5">
                      {/* Truth-Locked Outreach Action */}
                      <button
                        onClick={() => setSelectedOutreachContact(contact)}
                        className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold border transition-colors cursor-pointer ${
                          contact.doNotContact || contact.suppressionState === 'GLOBAL_STAKEHOLDER_SUPPRESSION'
                            ? 'bg-rose-500/10 border-rose-500/30 text-rose-400'
                            : contact.suppressionState === 'JOB_SPECIFIC_SUPPRESSION'
                            ? 'bg-amber-500/10 border-amber-500/30 text-amber-400'
                            : 'bg-purple-600/20 hover:bg-purple-600/30 border-purple-500/30 text-purple-300'
                        }`}
                        title={
                          contact.doNotContact || contact.suppressionState === 'GLOBAL_STAKEHOLDER_SUPPRESSION'
                            ? 'Contact has opted out of communications'
                            : contact.suppressionState === 'JOB_SPECIFIC_SUPPRESSION'
                            ? 'Role rejected: click to view thread & replies'
                            : 'Open Truth-Locked Outreach Composer'
                        }
                        data-testid={`outreach-btn-${contact.id}`}
                      >
                        <Mail className="w-3.5 h-3.5" />
                        <span>
                          {contact.doNotContact || contact.suppressionState === 'GLOBAL_STAKEHOLDER_SUPPRESSION'
                            ? 'Opted Out'
                            : contact.suppressionState === 'JOB_SPECIFIC_SUPPRESSION'
                            ? 'Rejected'
                            : 'Outreach'}
                        </span>
                      </button>

                      {/* Mark Reviewed */}
                      <button
                        onClick={() => handleToggleReview(contact)}
                        disabled={updatingId === contact.id}
                        className={`p-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer border ${
                          contact.isReviewed
                            ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/30'
                            : 'bg-[#1F1F1F] border-white/10 text-neutral-400 hover:text-white'
                        }`}
                        title={contact.isReviewed ? 'Unmark reviewed' : 'Mark as reviewed'}
                      >
                        <Check className="w-3.5 h-3.5" />
                      </button>

                      {/* Dismiss / Restore */}
                      <button
                        onClick={() => handleToggleDismiss(contact)}
                        disabled={updatingId === contact.id}
                        className={`p-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer border ${
                          contact.isDismissed
                            ? 'bg-amber-500/20 border-amber-500/40 text-amber-300 hover:bg-amber-500/30'
                            : 'bg-[#1F1F1F] border-white/10 text-neutral-400 hover:text-white'
                        }`}
                        title={contact.isDismissed ? 'Restore contact' : 'Dismiss contact'}
                      >
                        {contact.isDismissed ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                      </button>

                      {/* Source Link */}
                      {contact.sourceUrls.length > 0 && (
                        <a
                          href={contact.sourceUrls[0]}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="p-1.5 rounded-lg text-xs font-medium bg-[#1F1F1F] border border-white/10 text-neutral-400 hover:text-white transition-colors cursor-pointer"
                          title="View attributable public source"
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                        </a>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Fallback Browser Search Query Links ($0 Zero-Cost Exploration) */}
      {searchLinks.length > 0 && (
        <div className="p-4 rounded-xl bg-[#141414] border border-white/10 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Globe className="w-4 h-4 text-purple-400" />
              <h4 className="text-xs font-semibold text-white tracking-wide uppercase">
                Free Browser Search Exploration Links
              </h4>
            </div>
            <span className="text-[10px] font-mono text-neutral-500">$0 Free Fallback</span>
          </div>
          <p className="text-xs text-neutral-400 leading-relaxed">
            Click any pre-formatted query below to explore publicly indexed recruiters and engineering managers directly in your browser:
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
            {searchLinks.map((link, idx) => (
              <a
                key={idx}
                href={link.url}
                target="_blank"
                rel="noopener noreferrer"
                className="p-2.5 rounded-lg bg-[#1F1F1F] border border-white/5 hover:border-purple-500/40 text-xs font-mono text-neutral-300 hover:text-white transition-all flex items-center justify-between group cursor-pointer"
              >
                <div className="truncate mr-2">
                  <span className="font-semibold text-white block truncate">{link.title}</span>
                  <span className="text-[10px] text-neutral-500 block truncate">{link.query}</span>
                </div>
                <ExternalLink className="w-3.5 h-3.5 text-neutral-500 group-hover:text-purple-400 shrink-0" />
              </a>
            ))}
          </div>
        </div>
      )}

      {/* Outreach Composer Modal (Truth-Locked) */}
      <OutreachComposerModal
        isOpen={!!selectedOutreachContact}
        onClose={() => setSelectedOutreachContact(null)}
        contact={selectedOutreachContact}
        opportunityId={opportunityId}
        companyName={companyName}
      />
    </div>
  );
};

