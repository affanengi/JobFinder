import { cn } from '../../lib/utils'
import { MatchCategory } from '../../types/job'

interface ScoreIndicatorProps {
  score?: number | null
  category?: MatchCategory | 'Unscored'
  size?: 'sm' | 'md' | 'lg'
  showLabel?: boolean
  className?: string
}

export function ScoreIndicator({
  score,
  size = 'md',
  showLabel = true,
  className
}: ScoreIndicatorProps) {
  const sizeStyles = {
    sm: 'text-xs px-2 py-0.5',
    md: 'text-xs px-2.5 py-1',
    lg: 'text-sm px-3 py-1.5',
  }

  if (score === null || score === undefined) {
    return (
      <div
        className={cn(
          'inline-flex items-center gap-1.5 rounded-full border font-medium tracking-tight bg-white/5 text-neutral-400 border-white/10',
          sizeStyles[size],
          className
        )}
      >
        <span className="font-bold">Unscored</span>
        {showLabel && <span className="opacity-90 font-medium">· Incomplete Profile</span>}
      </div>
    )
  }

  const getCategoryConfig = (score: number) => {
    if (score >= 90) {
      return {
        label: 'Strong Match',
        bg: 'bg-success-soft',
        text: 'text-success',
        border: 'border-success-border',
      }
    }
    if (score >= 80) {
      return {
        label: 'Good Match',
        bg: 'bg-white/10',
        text: 'text-white',
        border: 'border-white/20',
      }
    }
    if (score >= 65) {
      return {
        label: 'Possible Match',
        bg: 'bg-warning-soft',
        text: 'text-warning',
        border: 'border-warning-border',
      }
    }
    if (score >= 50) {
      return {
        label: 'Weak Match',
        bg: 'bg-warning-soft',
        text: 'text-warning',
        border: 'border-warning-border',
      }
    }
    return {
      label: 'Low Fit / Reject',
      bg: 'bg-danger-soft',
      text: 'text-danger',
      border: 'border-danger-border',
    }
  }

  const safeScore = typeof score === 'number' && !isNaN(score) ? Math.round(score) : 0
  const config = getCategoryConfig(safeScore)


  return (
    <div
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border font-medium tracking-tight',
        config.bg,
        config.text,
        config.border,
        sizeStyles[size],
        className
      )}
    >
      <span className="font-bold tabular-nums">{safeScore}%</span>
      {showLabel && <span className="opacity-90 font-medium">· {config.label}</span>}
    </div>
  )
}
