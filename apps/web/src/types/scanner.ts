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

export interface AtsScanResult {
  overall_score: number;
  grade: "A+" | "A" | "B" | "C" | "D";
  summary: string;
  category_scores: Record<string, CategoryScore>;
  keyword_matrix: KeywordMatrix;
  bullet_audits: BulletAuditItem[];
  actionable_checklist: ChecklistItem[];
  metadata: ScanMetadata;
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
  createdAt: string;
  updatedAt: string;
}
