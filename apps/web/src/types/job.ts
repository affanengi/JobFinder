export type WorkMode = 'remote' | 'hybrid' | 'onsite' | 'unknown'

export type EmploymentType = 'internship' | 'full_time' | 'part_time' | 'contract' | 'temporary'

export type RecommendationStatus = 'new' | 'viewed' | 'approved' | 'saved' | 'skipped' | 'rejected'

export type MatchCategory = 'strong_match' | 'good_match' | 'possible_match' | 'weak_match' | 'reject'

export interface ScoreBreakdown {
  skills: number // 30%
  experience: number // 20%
  rolePreference: number // 15%
  education: number // 10%
  location: number // 10%
  seniority: number // 5%
  compensation: number // 5%
  historicalSignal: number // 5%
}

export interface JobSourceRef {
  sourceName: string
  sourceType: 'api' | 'feed' | 'company_page' | 'manual'
  sourceUrl: string
  sourceJobId?: string
  retrievedAt: string
}

export interface JobOpportunity {
  id: string
  title: string
  company: string
  companyLogo?: string
  location: string
  workMode: WorkMode
  employmentType: EmploymentType
  seniority: string
  salary?: {
    min?: number
    max?: number
    currency: string
    period: 'hour' | 'month' | 'year'
  }
  description: string
  responsibilities: string[]
  requiredSkills: string[]
  preferredSkills: string[]
  educationRequirements: string[]
  experienceRequirements: string[]
  applicationUrl: string
  postedAt: string
  discoveredAt: string
  source: JobSourceRef
  
  // Structured Recommendation Signals (adheres to SCHEMA.md)
  recommendation: {
    id: string
    score: number // 0-100
    category: MatchCategory
    breakdown: ScoreBreakdown
    matchedRequirements: string[]
    gaps: string[]
    unknowns: string[]
    reasoning: string
    status: RecommendationStatus
  }
}
