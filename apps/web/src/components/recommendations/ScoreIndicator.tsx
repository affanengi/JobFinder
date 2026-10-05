import { cn } from '../../lib/utils'
import { MatchCategory } from '../../types/job'

interface ScoreIndicatorProps {
  score: number
  category?: MatchCategory
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

  const config = getCategoryConfig(score)

  const sizeStyles = {
    sm: 'text-xs px-2 py-0.5',
    md: 'text-xs px-2.5 py-1',
    lg: 'text-sm px-3 py-1.5',
  }

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
      <span className="font-bold tabular-nums">{score}%</span>
      {showLabel && <span className="opacity-90 font-medium">· {config.label}</span>}
    </div>
  )
}
