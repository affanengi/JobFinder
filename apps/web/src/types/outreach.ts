/**
 * Truth-Lock Personalized Outreach & Gmail Lifecycle Types (Phase 3 & 4)
 */

import { EmailEvidenceClassification } from './opportunityContact';

export type OutreachStatus =
  | 'DRAFT'
  | 'PENDING_APPROVAL'
  | 'APPROVED'
  | 'SENDING'
  | 'SENT'
  | 'SEND_FAILED'
  | 'SEND_STATUS_UNKNOWN';

export interface TruthLockFinding {
  status: 'PASS' | 'FAIL' | 'REVIEW_REQUIRED';
  field: string;
  claim: string;
  reason: string;
  isBlocking: boolean;
}

export interface TruthLockReport {
  status: 'PASS' | 'REVIEW_REQUIRED' | 'FAIL';
  totalChecks: number;
  passedChecks: number;
  findings: TruthLockFinding[];
  verifiedFactReferences: string[];
}

export interface OutreachMessage {
  id: string;
  userId: string;
  opportunityId: string;
  contactId: string;
  recipientEmail?: string | null;
  recipientName: string;
  recipientTitle?: string | null;
  companyName: string;
  emailClassification: EmailEvidenceClassification;
  subject: string;
  body: string;
  status: OutreachStatus;
  truthLockReport: TruthLockReport;
  resumeAttachmentId?: string | null;
  resumeAttachmentName?: string | null;
  gmailMessageId?: string | null;
  gmailThreadId?: string | null;
  sentAt?: string | null;
  sendError?: string | null;
  correlationId: string;
  lastReplyAt?: string | null;
  lastReplyIntent?: ReplyIntentLabel | null;
  replyCount?: number;
  createdAt: string;
  updatedAt: string;
}

export type ReplyIntentLabel =
  | 'POSITIVE_INTEREST'
  | 'INFORMATION_REQUEST'
  | 'REFERRAL_CONFIRMED'
  | 'JOB_REJECTION'
  | 'DO_NOT_CONTACT'
  | 'NEEDS_MANUAL_REVIEW';

export interface OutreachReply {
  id: string;
  outreachId: string;
  userId: string;
  opportunityId: string;
  contactId: string;
  gmailMessageId: string;
  gmailThreadId: string;
  senderEmail: string;
  senderName?: string | null;
  recipientEmail: string;
  subject: string;
  snippet: string;
  bodyText: string;
  receivedAt: string;
  intent: ReplyIntentLabel;
  intentRationale: string;
  intentConfidence: number;
  evidenceSnippet: string;
  processingStatus: 'PENDING' | 'CLASSIFIED' | 'CLASSIFICATION_FAILED' | 'MANUALLY_REVIEWED';
  suppressionState: 'NONE' | 'JOB_SPECIFIC_SUPPRESSION' | 'GLOBAL_STAKEHOLDER_SUPPRESSION';
  isManuallyReviewed: boolean;
  manualNotes?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ManualReviewReplyRequest {
  intent: ReplyIntentLabel;
  notes?: string;
  overrideSuppression?: 'NONE' | 'JOB_SPECIFIC_SUPPRESSION' | 'GLOBAL_STAKEHOLDER_SUPPRESSION';
}

export interface ThreadTimelineResponse {
  outreach: OutreachMessage;
  replies: OutreachReply[];
  totalReplies: number;
  hasReadPermission: boolean;
}

export interface SyncRepliesResponse {
  outreachId?: string;
  newRepliesCount: number;
  totalRepliesCount: number;
  replies: OutreachReply[];
  hasReadPermission: boolean;
  message: string;
}

export interface GenerateOutreachRequest {
  notes?: string;
  tone?: 'professional' | 'enthusiastic' | 'concise';
  resumeAttachmentId?: string;
}

export interface SaveOutreachDraftRequest {
  subject: string;
  body: string;
  resumeAttachmentId?: string;
}

export interface ApproveOutreachRequest {
  isApproved: boolean;
}

export interface SendOutreachResponse {
  outreachId: string;
  status: OutreachStatus;
  gmailMessageId?: string | null;
  correlationId: string;
  message: string;
}

