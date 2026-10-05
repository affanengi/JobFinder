export type AutofillStatus =
  | 'IDLE'
  | 'CREATING'
  | 'INITIALIZING'
  | 'BROWSER_LAUNCHED'
  | 'LAUNCHING_BROWSER'
  | 'PORTAL_LOADING'
  | 'NAVIGATING'
  | 'AUTHENTICATION_REQUIRED'
  | 'PAUSED_FOR_LOGIN'
  | 'DETECTING_APPLICATION_STATE'
  | 'APPLY_CTA_AVAILABLE'
  | 'APPLY_ACTION_IN_PROGRESS'
  | 'FORM_LOADING'
  | 'FORM_READY'
  | 'FILLING'
  | 'POPULATING'
  | 'ATTACHING_RESUME'
  | 'MULTI_STEP_FORM'
  | 'HUMAN_REVIEW_REQUIRED'
  | 'READY_FOR_SUBMISSION'
  | 'FORM_NOT_FOUND'
  | 'APPLY_CTA_AMBIGUOUS'
  | 'CROSS_ORIGIN_FRAME_BLOCKED'
  | 'PAUSED_FOR_CAPTCHA'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED'
  | 'BROWSER_CLOSED'
  | 'EXPIRED';

export type FieldSafetyCategory =
  | 'safe_identity'
  | 'sensitive'
  | 'custom_question'
  | 'file_upload'
  | 'SAFE_AUTOFILL'
  | 'RESUME_UPLOAD'
  | 'COVER_LETTER'
  | 'UNKNOWN'
  | 'SENSITIVE'
  | 'LEGAL_OR_IMMIGRATION'
  | 'DEMOGRAPHIC'
  | 'CUSTOM_QUESTION'
  | 'CAPTCHA'
  | 'MFA_OR_LOGIN'
  | 'SUBMISSION_CONTROL';

export interface AutofillEventDTO {
  eventId?: string;
  sessionId: string;
  timestamp: string;
  eventType?: string;
  step?: string;
  message: string;
  fieldSelector?: string | null;
  fieldCategory?: FieldSafetyCategory | null;
  status: AutofillStatus;
  fieldsFilled?: string[];
  fieldsSkipped?: string[];
  fieldsRequiringReview?: string[];
  detectedCustomQuestions?: DetectedFormField[];
  resumeAttached?: boolean;
  captchaDetected?: boolean;
  diagnostics?: Record<string, any> | null;
}

export interface AutofillSessionDTO {
  sessionId: string;
  userId: string;
  applicationId: string;
  portalUrl: string;
  atsType: string;
  status: AutofillStatus;
  createdAt: string;
  lastActivityAt: string;
  fieldsFilled: string[];
  fieldsSkipped: string[];
  fieldsRequiringReview: string[];
  detectedCustomQuestions?: DetectedFormField[];
  resumeAttached: boolean;
  captchaDetected: boolean;
  diagnostics?: Record<string, any> | null;
  failureReason?: string | null;
}


export interface DetectedFormField {
  questionId: string;
  selector: string;
  tag: string;
  label: string;
  category: string;
  maxLength?: number | null;
  currentValue?: string;
  frameSelector?: string | null;
}

export interface BatchFillAnswer {
  questionId: string;
  answerText: string;
}

export interface BatchFillPayload {
  sessionId: string;
  answers: BatchFillAnswer[];
}

export interface EducationEntry {
  id?: string;
  school: string;
  degree: string;
  discipline: string;
  startYear: string;
  endYear: string;
}

export interface AutofillProfile {
  firstName?: string | null;
  lastName?: string | null;
  fullName?: string | null;
  email?: string | null;
  phone?: string | null;
  streetAddress?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
  country?: string | null;
  gender?: string | null;
  pronouns?: string | null;
  linkedinUrl?: string | null;
  githubUrl?: string | null;
  portfolioUrl?: string | null;
  school?: string | null;
  degree?: string | null;
  discipline?: string | null;
  startYear?: string | null;
  endYear?: string | null;
  educations?: EducationEntry[];
  experienceLevel?: string | null;
  yearsOfExperience?: number | null;
  updatedAt?: string;
}
