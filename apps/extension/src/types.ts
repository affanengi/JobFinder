/** Unified Data Contracts for JobFinder Web Clipper */

export type WorkMode = 'remote' | 'hybrid' | 'onsite' | null;

export type EmploymentType =
  | 'full_time'
  | 'part_time'
  | 'contract'
  | 'internship'
  | null;

export type SourcePlatform =
  | 'linkedin'
  | 'indeed'
  | 'greenhouse'
  | 'lever'
  | 'ashby'
  | 'workday'
  | 'generic'
  | 'web_clipper';


export type FieldStatus = 'detected' | 'partial' | 'missing' | 'uncertain';

export type ExtractionStatus = 'normal' | 'degraded' | 'timeout-fallback';

export interface FieldQualityInfo {
  status: FieldStatus;
  source?: string;
  confidence: number; // 0.0 to 1.0
  charCount?: number;
  reason?: string;
}

export interface FieldQualityMap {
  title: FieldQualityInfo;
  company: FieldQualityInfo;
  location: FieldQualityInfo;
  workMode: FieldQualityInfo;
  employmentType: FieldQualityInfo;
  salary: FieldQualityInfo;
  description: FieldQualityInfo;
}

export interface ExtractedJobData {
  title: string | null;
  company: string | null;
  location: string | null;
  workMode: WorkMode;
  employmentType: EmploymentType;
  salaryRaw: string | null;
  descriptionText: string | null;
  descriptionHtml: string | null;
  sourceUrl: string;
  sourcePlatform: SourcePlatform;
  confidenceScore: number; // 0.0 to 1.0
  detectedFields: string[];
  missingFields: string[];
  sourceJobId?: string | null;
  fieldQuality?: FieldQualityMap;
  extractionStatus?: ExtractionStatus;
}

export interface ClipJobPayload {
  title: string;
  company: string;
  location?: string | null;
  workMode?: string | null;
  employmentType?: string | null;
  salaryRaw?: string | null;
  sourceUrl: string;
  sourcePlatform: string;
  descriptionText?: string | null;
  descriptionHtml?: string | null;
  candidateNotes?: string | null;
  userEditedFields?: string[];
}

export interface ClipJobResult {
  jobId: string;
  applicationId: string;
  isDuplicate: boolean;
  status: 'created' | 'already_exists' | 'error';
  message: string;
  kanbanDeepLink: string;
}

export interface CheckClipStatusResult {
  isSaved: boolean;
  jobId?: string | null;
  applicationId?: string | null;
  status?: string | null;
  kanbanDeepLink?: string | null;
}

export interface ClipperSettings {
  apiBaseUrl: string;
  clipToken: string;
}

export interface DraftJobData {
  extracted: ExtractedJobData;
  userEdits: Partial<ClipJobPayload>;
  candidateNotes: string;
  savedAt: string;
}
