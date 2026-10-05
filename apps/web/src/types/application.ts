export type ApplicationStage =
  | 'saved'
  | 'ready'
  | 'applied'
  | 'interviewing'
  | 'offer'
  | 'rejected'
  | 'archived';

export type EventSource = 'candidate' | 'employer' | 'system_sync';

export type OfferOutcome = 'accepted' | 'declined' | 'expired' | 'pending';

export type ActivityDateRange = 'today' | '7d' | '30d' | 'all';

export interface StageTransitionEvent {
  id: string;
  fromStage: ApplicationStage | null;
  toStage: ApplicationStage;
  eventName: string;
  authorizedActor: string;
  eventSource: EventSource;
  timestamp: string;
  note?: string | null;
}

export interface ResumeArtifactSnapshot {
  resumeId: string;
  version: number;
  jobId: string;
  targetRole: string;
  skillsUsed: string[];
  bulletCount: number;
  pdfRenderHash?: string | null;
  approvedAt: string;
}

export interface CoverLetterSnapshot {
  coverLetterId: string;
  approvedAt: string;
}

export interface AtsScoreSnapshot {
  overallScore: number;
  evaluatedAt: string;
  scannerVersion: string;
  breakdown: Record<string, number>;
}

export interface InterviewRoundEvent {
  id: string;
  round: string;
  scheduledAt?: string | null;
  interviewer?: string | null;
  meetingLink?: string | null;
  feedback?: string | null;
  notes?: string | null;
}

export interface ApplicationRecord {
  id: string;
  userId: string;
  jobId?: string | null;
  isExternal: boolean;
  company: string;
  jobTitle: string;
  location: string;
  portalUrl?: string | null;
  salarySnippet?: string | null;
  status: ApplicationStage;
  stageTimestamps: Record<string, string>;
  appliedAt?: string | null;
  offerOutcome?: OfferOutcome | null;
  tailoredResumeId?: string | null;
  resumeSnapshot?: ResumeArtifactSnapshot | null;
  coverLetterSnapshot?: CoverLetterSnapshot | null;
  atsScoreSnapshot?: AtsScoreSnapshot | null;
  notes: string;
  interviewEvents: InterviewRoundEvent[];
  history: StageTransitionEvent[];
  customQuestions?: CustomQuestionAnswer[];
  createdAt: string;
  updatedAt: string;
}

export interface CreateApplicationPayload {
  jobId?: string;
  isExternal?: boolean;
  company: string;
  jobTitle: string;
  location?: string;
  portalUrl?: string;
  salarySnippet?: string;
  initialStatus: ApplicationStage;
  appliedDate?: string;
  notes?: string;
}

export interface UpdateStatusPayload {
  newStatus: ApplicationStage;
  expectedStatus?: ApplicationStage;
  note?: string;
  eventSource?: EventSource;
  offerOutcome?: OfferOutcome;
  appliedDate?: string;
}


export type QuestionCategory =
  | 'technical_challenge'
  | 'leadership_teamwork'
  | 'why_company'
  | 'why_role'
  | 'technical_experience'
  | 'strengths'
  | 'failure_learning'
  | 'compensation'
  | 'availability'
  | 'custom';

export interface QuestionConstraints {
  targetWordCount?: number;
  maxCharacters?: number;
  tone?: 'concise' | 'technical' | 'enthusiastic' | 'leadership';
}

export interface QuestionInput {
  questionId: string;
  questionText: string;
  category?: QuestionCategory;
  constraints?: QuestionConstraints;
}

export interface BatchGeneratePayload {
  questions: QuestionInput[];
  sessionId?: string;
  includeJobContext?: boolean;
  optionalJobDescription?: string;
  optionalCompany?: string;
  optionalJobTitle?: string;
}

export interface QuestionAnswerResult {
  questionId: string;
  status: 'VERIFIED' | 'REQUIRES_REVIEW' | 'MISSING_REQUIRED_FACTS' | 'REJECTED';
  answer?: string | null;
  isDeterministic: boolean;
  groundedFactIds: string[];
  missingFacts: string[];
  violations: string[];
  characterCount: number;
  wordCount: number;
}

export interface BatchGenerateResponse {
  answers: QuestionAnswerResult[];
  modelUsed: string;
  generatedAt: string;
}

export interface CustomQuestionAnswer {
  qaId: string;
  questionId: string;
  questionText: string;
  category: QuestionCategory;
  constraints: QuestionConstraints;
  generatedAnswer: string;
  currentAnswer: string;
  userEdited: boolean;
  status: 'VERIFIED' | 'REQUIRES_REVIEW' | 'MISSING_REQUIRED_FACTS' | 'REJECTED';
  groundedFactIds: string[];
  missingFactsDetected: string[];
  characterCount: number;
  wordCount: number;
  profileVersion: number;
  jobContextUsed: boolean;
  modelUsed: string;
  createdAt: string;
  updatedAt: string;
}
