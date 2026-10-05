export type RequirementType =
  | 'skill_technical'
  | 'skill_soft'
  | 'responsibility'
  | 'qualification_experience'
  | 'qualification_education'
  | 'domain_context'

export type RequirementCategory = 'required' | 'preferred'

export type RequirementImportance = 'critical' | 'high' | 'medium' | 'low'

export interface JobRequirementItem {
  id: string
  type: RequirementType
  text: string
  category: RequirementCategory
  keywords: string[]
  importance: RequirementImportance
}

export interface JobAnalysisResult {
  id: string
  jobId: string
  jobTitle: string
  company: string
  roleCategory: string
  roleFocus: string
  summary: string
  requirements: JobRequirementItem[]
  requiredSkills: string[]
  preferredSkills: string[]
  responsibilities: string[]
  qualifications: string[]
  keywords: string[]
  softSkills: string[]
  domainContext: string[]
  modelUsed?: string
  confidence: string
  source: string
}

export type MatchClassification = 'strong' | 'transferable' | 'weak' | 'missing'

export interface RequirementMatchEvidence {
  requirementId: string
  requirementText: string
  requirementType: string
  matchLevel: MatchClassification
  verifiedFactIds: string[]
  matchedTerms: string[]
  candidateEvidence: string
  rationale: string
}

export interface ProfileJobMatchResult {
  jobId: string
  userId: string
  roleCategory: string
  roleFocus: string
  matches: RequirementMatchEvidence[]
  strongMatches: string[]
  transferableMatches: string[]
  missingRequirements: string[]
  matchScore: number
  overallScore: number
}

export interface ApplicationProfileSnapshot {
  id: string
  jobId: string
  userId: string
  roleCategory: string
  roleFocus: string
  selectedFactIds: string[]
  selectedProjectIds: string[]
  selectedCourseIds: string[]
  verifiedSkills: string[]
  requirementMatches: Record<string, string>
  createdAt: string
}

export type AtsEvidenceStatus =
  | 'KEYWORD_MATCH'
  | 'EVIDENCE_MATCH'
  | 'OMITTED_OPPORTUNITY'
  | 'UNSUPPORTED_KEYWORD'
  | 'MISSING_REQUIREMENT'

export interface AtsEvidenceItem {
  keyword: string
  status: AtsEvidenceStatus
  inJob: boolean
  inResume: boolean
  verifiedInProfile: boolean
  sourceFactIds: string[]
  notes: string
}

export interface AtsEvidenceAuditReport {
  jobId: string
  resumeId?: string
  atsScore: number
  truthIntegrityStatus: 'VERIFIED' | 'VIOLATIONS_DETECTED'
  evidenceAudit: AtsEvidenceItem[]
  unsupportedKeywords: string[]
  missingCriticalRequirements: string[]
  omittedOpportunities: string[]
  summary: string
}
