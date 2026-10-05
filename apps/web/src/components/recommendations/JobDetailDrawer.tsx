import { ExternalLink, ShieldCheck, Sparkles, CheckCircle2, AlertTriangle, HelpCircle } from 'lucide-react'
import { JobOpportunity } from '../../types/job'
import { Drawer } from '../ui/Drawer'
import { ScoreIndicator } from './ScoreIndicator'
import { ScoreBreakdown } from './ScoreBreakdown'
import { Button } from '../ui/Button'
import { Badge } from '../ui/Badge'

interface JobDetailDrawerProps {
  job: JobOpportunity | null
  isOpen: boolean
  onClose: () => void
  onApply: (job: JobOpportunity) => void
  onSave: (job: JobOpportunity) => void
}

export function JobDetailDrawer({
  job,
  isOpen,
  onClose,
  onApply,
  onSave
}: JobDetailDrawerProps) {
  if (!job) return null

  const formattedSalary = job.salary
    ? `${job.salary.currency} ${job.salary.min?.toLocaleString()}${
        job.salary.max ? ` - ${job.salary.max.toLocaleString()}` : ''
      }/${job.salary.period}`
    : 'Compensation not disclosed'

  return (
    <Drawer
      isOpen={isOpen}
      onClose={onClose}
      width="max-w-2xl"
      title={
        <div className="flex items-center gap-3">
          <ScoreIndicator
            score={job.recommendation.score}
            category={job.recommendation.category}
            size="sm"
          />
          <span className="text-base font-semibold text-primary">{job.title}</span>
        </div>
      }
      subtitle={
        <div className="flex items-center gap-2 text-xs text-primary-secondary">
          <span className="font-medium text-primary">{job.company}</span>
          <span>·</span>
          <span>{job.location}</span>
          <span>·</span>
          <span className="capitalize">{job.workMode}</span>
        </div>
      }
    >
      {/* Top CTA Card */}
      <div className="bg-surface-subtle p-4 rounded-xl border border-border flex items-center justify-between gap-4">
        <div>
          <div className="text-xs font-semibold text-primary">Ready to apply to this role?</div>
          <div className="text-[11px] text-primary-secondary mt-0.5">
            AI will draft a tailored, truth-audited ATS resume without hallucinations.
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" onClick={() => onSave(job)}>
            Save
          </Button>
          <Button variant="primary" size="sm" onClick={() => onApply(job)}>
            Prepare Resume
          </Button>
        </div>
      </div>

      {/* Structured Recommendation Match Section */}
      <div className="space-y-4">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-primary-secondary">
          AI Fit & Match Audit
        </h4>

        {/* Score Breakdown Bar Component */}
        <ScoreBreakdown breakdown={job.recommendation.breakdown} />

        {/* Transparent Reasoning Card */}
        <div className="p-4 bg-surface-subtle rounded-lg border border-border space-y-2">
          <div className="flex items-center gap-2 text-xs font-semibold text-primary">
            <Sparkles className="w-4 h-4 text-accent" />
            <span>Fit Explanation</span>
          </div>
          <p className="text-xs text-primary-secondary leading-relaxed">
            {job.recommendation.reasoning}
          </p>
        </div>

        {/* Matched Signals vs Gaps Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {/* Matched Requirements */}
          <div className="p-4 bg-surface-subtle rounded-lg border border-border space-y-2">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-success">
              <CheckCircle2 className="w-4 h-4" />
              <span>Matched ({job.recommendation.matchedRequirements.length})</span>
            </div>
            <ul className="space-y-1.5">
              {job.recommendation.matchedRequirements.map((m, idx) => (
                <li key={idx} className="text-xs text-primary-secondary flex items-start gap-1.5">
                  <span className="text-success font-bold">✓</span>
                  <span>{m}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Gaps & Unknowns */}
          <div className="p-4 bg-surface-subtle rounded-lg border border-border space-y-2">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-warning">
              <AlertTriangle className="w-4 h-4" />
              <span>Potential Gaps ({job.recommendation.gaps.length})</span>
            </div>
            <ul className="space-y-1.5">
              {job.recommendation.gaps.map((g, idx) => (
                <li key={idx} className="text-xs text-primary-secondary flex items-start gap-1.5">
                  <span className="text-warning font-bold">⚠</span>
                  <span>{g}</span>
                </li>
              ))}
              {job.recommendation.unknowns.map((u, idx) => (
                <li key={idx} className="text-xs text-primary-muted flex items-start gap-1.5">
                  <HelpCircle className="w-3.5 h-3.5 text-info shrink-0 mt-0.5" />
                  <span>{u}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      {/* Role Details */}
      <div className="space-y-3 pt-2 border-t border-border">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-primary-secondary">
          Role Details
        </h4>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-xs">
          <div className="p-3 bg-surface-subtle rounded-lg border border-border">
            <div className="text-primary-muted text-[11px]">Seniority</div>
            <div className="font-medium text-primary mt-0.5">{job.seniority}</div>
          </div>
          <div className="p-3 bg-surface-subtle rounded-lg border border-border">
            <div className="text-primary-muted text-[11px]">Work Mode</div>
            <div className="font-medium text-primary mt-0.5 capitalize">{job.workMode}</div>
          </div>
          <div className="p-3 bg-surface-subtle rounded-lg border border-border">
            <div className="text-primary-muted text-[11px]">Compensation</div>
            <div className="font-medium text-primary mt-0.5">{formattedSalary}</div>
          </div>
        </div>
      </div>

      {/* Full Description & Responsibilities */}
      <div className="space-y-4 pt-2 border-t border-border">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-primary-secondary">
          Description & Responsibilities
        </h4>
        <p className="text-xs text-primary-secondary leading-relaxed">{job.description}</p>

        <div className="space-y-2">
          <div className="text-xs font-semibold text-primary">Key Responsibilities:</div>
          <ul className="space-y-1.5">
            {job.responsibilities.map((r, idx) => (
              <li key={idx} className="text-xs text-primary-secondary flex items-start gap-2">
                <span className="text-primary-muted">•</span>
                <span>{r}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="space-y-2">
          <div className="text-xs font-semibold text-primary">Required Skills:</div>
          <div className="flex flex-wrap gap-1.5">
            {job.requiredSkills.map((s, idx) => (
              <Badge key={idx} variant="default" size="sm">
                {s}
              </Badge>
            ))}
          </div>
        </div>
      </div>

      {/* Source Provenance */}
      <div className="pt-4 border-t border-border flex items-center justify-between text-xs text-primary-secondary">
        <div className="flex items-center gap-1.5">
          <ShieldCheck className="w-4 h-4 text-success" />
          <span>Source: {job.source.sourceName}</span>
        </div>
        <a
          href={job.source.sourceUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-white hover:underline font-medium"
        >
          <span>Open original posting</span>
          <ExternalLink className="w-3.5 h-3.5" />
        </a>
      </div>
    </Drawer>
  )
}
