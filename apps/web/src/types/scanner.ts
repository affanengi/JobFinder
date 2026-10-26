export interface CategoryCheckItem {
  name: string;
  passed: boolean;
  score: number;
  max_score: number;
  detail: string;
}

export interface CategoryScore {
  name: string;
  score: number;
  max_score: number;
  percentage: number;
  status: "pass" | "warning" | "fail";
  summary: string;
  checks: CategoryCheckItem[];
}

export interface KeywordMatchDetail {
  id: string;
  name: string;
  category: string;
  importance: "High" | "Medium" | "Bonus";
  status: "matched" | "missing" | "transferable";
  recommendation?: string;
}

export interface KeywordMatrix {
  matched: KeywordMatchDetail[];
  missing: KeywordMatchDetail[];
  transferable: KeywordMatchDetail[];
  match_percentage: number;
  total_jd_keywords: number;
  matched_count: number;
  missing_count: number;
  transferable_count: number;
}

export interface BulletRubricBreakdown {
  action_scope_score: number;
  technical_substance_score: number;
  outcome_credibility_score: number;
  job_relevance_score: number;
  rubric_notes: string[];
}

export interface BulletAuditItem {
  id: string;
  section: string;
  role_or_project: string;
  text: string;
  score: number;
  status: "strong" | "moderate" | "weak";
  has_action_verb: boolean;
  has_metric: boolean;
  has_weak_opener: boolean;
  verb?: string | null;
  word_count: number;
  issues: string[];

  // Additive contextual fields (strictly optional)
  rubric_breakdown?: BulletRubricBreakdown;
  matched_requirement_ids?: string[];
  evidence_classification?: "demonstrated" | "listed" | "transferable" | "none";
  suggested_focus?: string;
}

export interface ChecklistItem {
  id: string;
  priority: "critical" | "high" | "medium" | "low";
  category: string;
  title: string;
  description: string;
  passed: boolean;
  impact_points: number;
}

export interface ScanMetadata {
  resume_id?: string;
  job_id?: string;
  source_type: "tailored_resume" | "file_upload";
  file_name?: string;
  page_count: number;
  word_count: number;
  estimated_read_time: string;
  taxonomy_version: string;
}

export interface ReadinessAssessment {
  core_alignment_tier: "high" | "moderate" | "low" | "unaligned";
  substance_tier: "substantive" | "moderate" | "superficial";
  parseability_tier: "optimal" | "acceptable" | "needs_reformatting";
  mandatory_coverage_pct: number;
  summary_verdict: string;
}

export interface RequirementEvidenceItem {
  bullet_id: string;
  quote: string;
  role_or_project?: string;
  section?: string;
}

export interface JobRequirementMatchItem {
  id: string;
  name: string;
  description?: string;
  category?: string;
  is_mandatory: boolean;
  evidence_status: "demonstrated" | "listed" | "missing" | "unverified";
  explanation?: string;
  linked_evidence: RequirementEvidenceItem[];
}

export interface AtsScanResult {
  overall_score: number;
  grade: "A+" | "A" | "B" | "C" | "D";
  summary: string;
  category_scores: Record<string, CategoryScore>;
  keyword_matrix: KeywordMatrix;
  bullet_audits: BulletAuditItem[];
  actionable_checklist: ChecklistItem[];
  metadata: ScanMetadata;

  // Additive contextual fields (strictly optional)
  readiness?: ReadinessAssessment;
  requirement_matches?: JobRequirementMatchItem[];
  analysis_mode?: "contextual_ai" | "deterministic_structural" | "legacy_deterministic";
  confidence_level?: "high" | "moderate" | "low";
}

export interface OptimizedBulletItem {
  bullet_id: string;
  text: string;
  style: string;
  has_action_verb: boolean;
  has_metric: boolean;
  rationale: string;
  is_valid: boolean;
  validation_issues: string[];
}

export interface BulkAiBulletRewriteResponse {
  set_a: OptimizedBulletItem[];
  set_b: OptimizedBulletItem[];
  total_processed: number;
  validation_passed: boolean;
}

export interface SavedScanReportDTO {
  id: string;
  userId: string;
  reportName: string;
  sourceType: "tailored_resume" | "file_upload";
  resumeId?: string;
  resumeContentHash?: string;
  jobId?: string;
  jobTitle?: string;
  jobCompany?: string;
  overallScore: number;
  grade: string;
  scanResult: AtsScanResult;
  taxonomyVersion: string;
  scoring_version?: string;
  ai_analysis?: AtsAnalysisResult;
  audit_report?: TruthLockAuditReport;
  provenance?: ScanProvenanceMetadata;
  createdAt: string;
  updatedAt: string;
}

// =========================================================================
// AI-FIRST CONTEXTUAL ATS SCANNER TYPES (PHASE 6 & 7)
// =========================================================================

export type RequirementCriticality = "mandatory" | "preferred" | "bonus";
export type RequirementMatchStatus = "MEETS" | "PARTIAL" | "MISSING";
export type KeywordCoverageStatus = "present_and_relevant" | "present_weak" | "not_found";
export type SectionName = "summary" | "experience" | "projects" | "skills" | "education" | "certifications" | "other";
export type RewriteValidationStatus = "grounded" | "unverified" | "pending_review";
export type ValidationStatus = "pass" | "fail" | "review_required";
export type EvidenceViolationSeverity = "blocking" | "advisory";

export interface JobRequirementAnalysisItem {
  requirement_description: string;
  criticality: RequirementCriticality;
  match_status: RequirementMatchStatus;
  supporting_evidence: string[];
  explanation: string;
  missing_evidence: boolean;
}

export interface ResumeSectionAnalysisItem {
  section_name: string;
  findings: string[];
  supporting_evidence: string[];
  gaps: string[];
  recommendations: string[];
}

export interface ContextualKeywordItem {
  keyword: string;
  status: KeywordCoverageStatus;
  explanation: string;
  supporting_evidence?: string | null;
}

export interface GroundedRewriteProposalItem {
  original_text: string;
  proposed_text: string;
  explanation: string;
  factual_basis: string;
  validation_status: RewriteValidationStatus;
}

export interface AtsAnalysisResult {
  overall_score: number;
  overall_explanation: string;
  executive_summary: string;
  requirements: JobRequirementAnalysisItem[];
  section_analysis: ResumeSectionAnalysisItem[];
  keyword_analysis: ContextualKeywordItem[];
  strengths: string[];
  gaps: string[];
  recommendations: string[];
  rewrite_proposals: GroundedRewriteProposalItem[];
}

export interface EvidenceAuditFinding {
  target_type: "requirement" | "rewrite_proposal" | "keyword" | "section" | "general";
  target_identifier: string;
  status: ValidationStatus;
  severity: EvidenceViolationSeverity;
  evidence_source: "resume" | "profile" | "job_description" | "unknown";
  cited_text?: string | null;
  reason: string;
  is_blocking: boolean;
}

export interface TruthLockAuditReport {
  is_valid: boolean;
  status: ValidationStatus;
  total_checks: number;
  passed_checks: number;
  blocking_violations_count: number;
  advisory_warnings_count: number;
  findings: EvidenceAuditFinding[];
  original_ai_score: number;
  summary: string;
  audited_at: string;
}

export interface ScanProvenanceMetadata {
  scoring_version: string;
  operation_id?: string | null;
  provider_used: string;
  model_used: string;
  credential_id_used: string;
  latency_ms: number;
  timestamp: string;
  tenant_isolated: boolean;
  truth_lock_passed: boolean;
}

export interface AtsScanRequest {
  resume_id?: string | null;
  raw_resume_text?: string | null;
  job_id?: string | null;
  job_description?: string | null;
  role_category?: string | null;
  save_report?: boolean;
  report_name?: string | null;
}

export interface AtsScanResponse {
  analysis: AtsAnalysisResult;
  audit_report: TruthLockAuditReport;
  provenance: ScanProvenanceMetadata;
  saved_report_id?: string | null;
}

