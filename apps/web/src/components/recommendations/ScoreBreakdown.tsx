import { ScoreBreakdown as IScoreBreakdown } from '../../types/job'

interface ScoreBreakdownProps {
  breakdown: IScoreBreakdown
}

export function ScoreBreakdown({ breakdown }: ScoreBreakdownProps) {
  const categories = [
    { label: 'Skills Alignment', weight: '30%', score: breakdown.skills },
    { label: 'Project & Experience Fit', weight: '20%', score: breakdown.experience },
    { label: 'Role / Title Preference', weight: '15%', score: breakdown.rolePreference },
    { label: 'Education & Degree Level', weight: '10%', score: breakdown.education },
    { label: 'Work Mode & Location', weight: '10%', score: breakdown.location },
    { label: 'Seniority Level Fit', weight: '5%', score: breakdown.seniority },
    { label: 'Compensation Alignment', weight: '5%', score: breakdown.compensation },
    { label: 'Historical Signal', weight: '5%', score: breakdown.historicalSignal },
  ]

  return (
    <div className="space-y-3 bg-surface-subtle p-4 rounded-lg border border-border">
      <div className="flex items-center justify-between text-xs font-semibold text-primary">
        <span>Hybrid Match Score Breakdown</span>
        <span className="text-primary-secondary font-normal text-[11px]">8 Weighted Factors</span>
      </div>

      <div className="space-y-2 pt-1">
        {categories.map((cat, idx) => (
          <div key={idx} className="space-y-1">
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-primary-secondary">
                {cat.label} <span className="text-primary-muted">({cat.weight})</span>
              </span>
              <span className="font-semibold text-primary tabular-nums">{cat.score}%</span>
            </div>
            <div className="w-full bg-[#121212] h-1.5 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-300 ${
                  cat.score >= 90
                    ? 'bg-success'
                    : cat.score >= 75
                    ? 'bg-white'
                    : cat.score >= 50
                    ? 'bg-warning'
                    : 'bg-danger'
                }`}
                style={{ width: `${cat.score}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
