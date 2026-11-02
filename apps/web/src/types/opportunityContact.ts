/**
 * Professional Contact Discovery & Email Evidence Classification Types (Phase 2)
 */

export type StakeholderTier =
  | 'RECRUITER'
  | 'HIRING_MANAGER'
  | 'TECH_LEAD'
  | 'REGIONAL_LEAD'
  | 'OTHER';

export type ContactType = 'INDIVIDUAL' | 'ORGANIZATION_CHANNEL';

export type ChannelPurpose =
  | 'INDIVIDUAL_REPRESENTATIVE'
  | 'GENERAL_CAREERS_INBOX'
  | 'HR_SHARED_INBOX'
  | 'ACCOMMODATIONS_ONLY'
  | 'PRESS_INVESTOR_RELATIONS'
  | 'UNSPECIFIED';

export type ContactabilityStatus =
  | 'PROFILE_ONLY'
  | 'DIRECT_EMAIL_FOUND'
  | 'GENERIC_INBOX_FOUND'
  | 'MULTIPLE_PUBLIC_CHANNELS_FOUND'
  | 'INSUFFICIENT_EVIDENCE';

export type RoleEvidenceStatus =
  | 'CURRENT_CONFIRMED'
  | 'LIKELY_CURRENT'
  | 'FORMER_ROLE'
  | 'UNCLEAR_ASSOCIATION';

export type EmailEvidenceClassification =
  | 'PUBLICLY_LISTED'
  | 'PROVIDER_VERIFIED'
  | 'PATTERN_INFERRED'
  | 'DOMAIN_MAIL_ENABLED'
  | 'UNVERIFIED'
  | 'INVALID_OR_UNSUPPORTED';

export type MXRecordStatus =
  | 'VALID_MX'
  | 'NO_MX'
  | 'UNCHECKED'
  | 'ERROR';

export interface ContactSearchLink {
  title: string;
  query: string;
  url: string;
  platform: 'google' | 'linkedin' | 'careers';
}

export interface DiscoveredContact {
  id: string;
  userId: string;
  opportunityId: string;
  companyName: string;
  fullName: string;
  roleTitle: string;
  stakeholderTier: StakeholderTier;
  contactType?: ContactType;
  channelPurpose?: ChannelPurpose;
  location?: string | null;
  isHyderabad: boolean;
  email?: string | null;
  emailClassification: EmailEvidenceClassification;
  emailEvidenceSummary?: string | null;
  mxStatus: MXRecordStatus;
  linkedinUrl?: string | null;
  githubUrl?: string | null;
  portfolioUrl?: string | null;
  contactabilityStatus?: ContactabilityStatus;
  roleEvidenceStatus?: RoleEvidenceStatus;
  sourceUrls: string[];
  evidenceSnippets: string[];
  searchProviderUsed: string;
  confidenceScore: number;
  rankingScore: number;
  rankingReason: string;
  isDismissed: boolean;
  isReviewed: boolean;
  doNotContact?: boolean;
  suppressionState?: 'NONE' | 'JOB_SPECIFIC_SUPPRESSION' | 'GLOBAL_STAKEHOLDER_SUPPRESSION';
  suppressionReason?: string | null;
  suppressionUpdatedAt?: string | null;
  companyKey?: string;
  associatedOpportunityIds?: string[];
  identityKeys?: string[];
  isDeleted?: boolean;
  deletedAt?: string | null;
  deletedByReason?: string | null;
  archivedAsDuplicateOf?: string | null;
  isAmbiguousMatch?: boolean;
  ambiguityReason?: string | null;
  discoveredAt: string;
  lastCheckedAt?: string | null;
}

export interface ContactDiscoveryResponse {
  opportunityId: string;
  companyName: string;
  contacts: DiscoveredContact[];
  searchLinks: ContactSearchLink[];
  providerUsed: string;
  costPolicyEnforced: string;
  message: string;
  totalExamined?: number;
  newDiscovered?: number;
  existingRefreshed?: number;
  tombstonesSuppressed?: number;
  attemptedAngles?: string[];
  cached?: boolean;
}
