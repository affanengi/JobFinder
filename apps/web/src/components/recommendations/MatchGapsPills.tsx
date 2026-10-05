import { CheckCircle2, AlertTriangle, HelpCircle } from 'lucide-react'
import { Badge } from '../ui/Badge'

interface MatchGapsPillsProps {
  matched: string[]
  gaps: string[]
  unknowns?: string[]
  maxItems?: number
}

export function MatchGapsPills({
  matched,
  gaps,
  unknowns = [],
  maxItems = 3
}: MatchGapsPillsProps) {
  const visibleMatched = matched.slice(0, maxItems)
  const visibleGaps = gaps.slice(0, 2)
  const visibleUnknowns = unknowns.slice(0, 1)

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {visibleMatched.map((item, idx) => (
        <Badge key={`m-${idx}`} variant="success" size="sm">
          <CheckCircle2 className="w-3 h-3 text-success shrink-0" />
          <span className="truncate max-w-[180px]">{item}</span>
        </Badge>
      ))}

      {visibleGaps.map((item, idx) => (
        <Badge key={`g-${idx}`} variant="warning" size="sm">
          <AlertTriangle className="w-3 h-3 text-warning shrink-0" />
          <span className="truncate max-w-[180px]">{item}</span>
        </Badge>
      ))}

      {visibleUnknowns.map((item, idx) => (
        <Badge key={`u-${idx}`} variant="info" size="sm">
          <HelpCircle className="w-3 h-3 text-info shrink-0" />
          <span className="truncate max-w-[180px]">{item}</span>
        </Badge>
      ))}

      {matched.length > maxItems && (
        <Badge variant="neutral" size="sm">
          +{matched.length - maxItems} more
        </Badge>
      )}
    </div>
  )
}
