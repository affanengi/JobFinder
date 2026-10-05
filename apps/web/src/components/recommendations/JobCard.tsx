import { Building2, MapPin, DollarSign, Bookmark, ArrowUpRight, Sparkles } from 'lucide-react'
import { JobOpportunity } from '../../types/job'
import { ScoreIndicator } from './ScoreIndicator'
import { MatchGapsPills } from './MatchGapsPills'
import { Button } from '../ui/Button'
import { Badge } from '../ui/Badge'

interface JobCardProps {
  job: JobOpportunity
  onApply: (job: JobOpportunity) => void
  onSave: (job: JobOpportunity) => void
  onSkip: (job: JobOpportunity) => void
  onReject: (job: JobOpportunity) => void
  onViewDetails: (job: JobOpportunity) => void
  isSaved?: boolean
}

export function JobCard({
  job,
  onApply,
  onSave,
  onSkip,
  onReject,
  onViewDetails,
  isSaved = false
}: JobCardProps) {
  const formattedSalary = job.salary
    ? `${job.salary.currency} ${job.salary.min?.toLocaleString()}${
        job.salary.max ? ` - ${job.salary.max.toLocaleString()}` : ''
      }/${job.salary.period}`
    : null

  return (
    <div className="group bg-surface hover:bg-surface-hover/80 rounded-xl border border-border hover:border-border-strong p-5 transition-all duration-150 shadow-sm flex flex-col justify-between gap-4">
      {/* Header: Title, Company, Fit Score */}
      <div className="space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <h3
              onClick={() => onViewDetails(job)}
              className="text-sm md:text-base font-semibold text-primary hover:underline cursor-pointer tracking-tight"
            >
              {job.title}
            </h3>
            <div className="flex flex-wrap items-center gap-2 text-xs text-primary-secondary">
              <span className="inline-flex items-center gap-1 font-medium text-primary">
                <Building2 className="w-3.5 h-3.5 text-primary-muted" />
                {job.company}
              </span>
              <span>·</span>
              <span className="inline-flex items-center gap-1">
                <MapPin className="w-3.5 h-3.5 text-primary-muted" />
                {job.location}
              </span>
              <span>·</span>
              <Badge variant="outline" size="sm" className="capitalize">
                {job.workMode}
              </Badge>
              <Badge variant="outline" size="sm" className="capitalize">
                {job.employmentType.replace('_', ' ')}
              </Badge>
            </div>
          </div>

          {/* Structured Match Fit Indicator */}
          <ScoreIndicator
            score={job.recommendation.score}
            category={job.recommendation.category}
            size="md"
          />
        </div>

        {/* AI Transparent Reasoning Summary */}
        <div className="p-3 bg-surface-subtle rounded-lg border border-border/80 text-xs text-primary-secondary leading-relaxed space-y-1.5">
          <div className="flex items-center gap-1.5 text-[11px] font-semibold text-primary">
            <Sparkles className="w-3.5 h-3.5 text-accent" />
            <span>Why this matches:</span>
          </div>
          <p className="line-clamp-2">{job.recommendation.reasoning}</p>
        </div>

        {/* Match / Gaps Pills */}
        <MatchGapsPills
          matched={job.recommendation.matchedRequirements}
          gaps={job.recommendation.gaps}
          unknowns={job.recommendation.unknowns}
          maxItems={3}
        />
      </div>

      {/* Footer: Compensation & Actions */}
      <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-border">
        <div className="text-xs text-primary-secondary">
          {formattedSalary ? (
            <span className="inline-flex items-center gap-1 font-medium text-primary">
              <DollarSign className="w-3.5 h-3.5 text-success" />
              {formattedSalary}
            </span>
          ) : (
            <span className="text-primary-muted text-[11px]">Salary not disclosed</span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onSave(job)}
            className={isSaved ? 'text-white' : ''}
            title={isSaved ? 'Saved' : 'Save opportunity'}
          >
            <Bookmark className={`w-3.5 h-3.5 ${isSaved ? 'fill-white' : ''}`} />
            <span>{isSaved ? 'Saved' : 'Save'}</span>
          </Button>

          <Button variant="ghost" size="sm" onClick={() => onSkip(job)}>
            Skip
          </Button>

          <Button variant="ghost" size="sm" onClick={() => onReject(job)} className="text-danger hover:text-danger">
            Reject
          </Button>

          <Button variant="primary" size="sm" onClick={() => onApply(job)}>
            <span>Prepare Resume</span>
            <ArrowUpRight className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>
    </div>
  )
}
