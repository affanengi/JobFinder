/**
 * Company Directory & Profile Types (Phase 6)
 */

import { CompanyIntelligenceResult } from './companyIntelligence';
import { DiscoveredContact } from './opportunityContact';

export interface CompanyOpportunitySummary {
  id: string;
  title: string;
  location: string;
  workMode: string;
  category: string;
  sourceUrl: string;
  status: string;
}

export interface CompanySummary {
  key: string;
  name: string;
  domain: string;
  opportunityCount: number;
  primaryOpportunityId: string;
  opportunities: CompanyOpportunitySummary[];
  hasIntelligence: boolean;
  intelligenceStatus: string;
  contactsCount: number;
}

export interface CompanyDetail {
  key: string;
  name: string;
  domain: string;
  careersUrl?: string | null;
  primaryOpportunityId: string;
  opportunities: CompanyOpportunitySummary[];
  intelligence?: CompanyIntelligenceResult | null;
  contacts: DiscoveredContact[];
}

export interface BulkCompanyResearchRequest {
  companyKeys: string[];
  forceRefresh?: boolean;
}

export interface BulkCompanyExecutionMetrics {
  totalRequested: number;
  cachedCount: number;
  liveHarvestedCount: number;
  geminiRequestsIssued: number;
  totalContactsDiscovered: number;
  contactsWithDirectEmail: number;
  contactsWithProfileOnly: number;
  durationSeconds: number;
}

export interface BulkCompanyResearchItemResult {
  companyKey: string;
  companyName: string;
  status: 'SUCCESS' | 'PARTIAL_SUCCESS' | 'ERROR';
  intelligence?: CompanyIntelligenceResult | null;
  contacts: DiscoveredContact[];
  error?: string | null;
}

export interface BulkCompanyResearchResponse {
  operationId: string;
  status: 'COMPLETED' | 'PARTIAL_FAILURE' | 'FAILED';
  metrics: BulkCompanyExecutionMetrics;
  results: BulkCompanyResearchItemResult[];
}

export type BulkResearchJobStatus =
  | 'QUEUED'
  | 'HARVESTING'
  | 'SYNTHESIZING'
  | 'SAVING'
  | 'COMPLETED'
  | 'FAILED';

export interface BulkResearchJobDocument {
  jobId: string;
  userId: string;
  companyKeys: string[];
  status: BulkResearchJobStatus;
  progressStage: string;
  progressPct: number;
  currentStageDescription: string;
  results?: BulkCompanyResearchItemResult[];
  metrics?: BulkCompanyExecutionMetrics | null;
  errorMessage?: string | null;
  workerId?: string | null;
  leaseExpiresAt?: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt?: string | null;
}

export interface BulkResearchJobCreateResponse {
  jobId: string;
  status: BulkResearchJobStatus;
  message: string;
}

