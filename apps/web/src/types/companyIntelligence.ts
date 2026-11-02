/**
 * TypeScript definitions for Company Intelligence & Scam Shield Engine.
 */

export type CompanyRiskTier =
  | 'NO_OBVIOUS_RED_FLAGS_FOUND'
  | 'NEEDS_VERIFICATION'
  | 'SIGNIFICANT_RED_FLAGS'
  | 'INSUFFICIENT_EVIDENCE';

export type DimensionStatus = 'PASS' | 'WARN' | 'FAIL' | 'INSUFFICIENT_EVIDENCE';

export interface EvaluatedDimensionItem {
  status: DimensionStatus;
  evidence: string;
  confidence: number;
}

export interface CompanyIntelligenceResult {
  id: string;
  userId: string;
  opportunityId: string;
  companyName: string;
  officialDomain?: string | null;
  careersUrl: string;
  riskTier: CompanyRiskTier;
  overview?: string | null;
  summary: string;
  evaluatedDimensions: Record<string, EvaluatedDimensionItem>;
  redFlags: string[];
  positiveSignals: string[];
  sourceUrls: string[];
  researchedAt: string;
  ttlExpiresAt: string;
  disclaimer: string;
  rawContentSnippet?: string | null;
  productsAndServices?: string[];
  industry?: string | null;
  headquarters?: string | null;
  companySize?: string | null;
  evidenceStatus?: string;
}
