import { Search, SlidersHorizontal, LayoutGrid, List } from 'lucide-react'
import { WorkMode, EmploymentType } from '../../types/job'

interface FilterBarProps {
  searchQuery: string
  onSearchChange: (q: string) => void
  selectedWorkMode: WorkMode | 'all'
  onWorkModeChange: (wm: WorkMode | 'all') => void
  selectedType: EmploymentType | 'all'
  onTypeChange: (t: EmploymentType | 'all') => void
  minScore: number
  onMinScoreChange: (score: number) => void
  viewMode: 'grid' | 'table'
  onViewModeChange: (vm: 'grid' | 'table') => void
  totalCount: number
}

export function FilterBar({
  searchQuery,
  onSearchChange,
  selectedWorkMode,
  onWorkModeChange,
  selectedType,
  onTypeChange,
  minScore,
  onMinScoreChange,
  viewMode,
  onViewModeChange,
  totalCount
}: FilterBarProps) {
  return (
    <div className="space-y-3 bg-surface p-4 rounded-xl border border-border shadow-sm">
      <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
        {/* Search Input */}
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-primary-muted" />
          <input
            type="text"
            placeholder="Search by role, company, or skills (e.g. Python, Playwright, React)..."
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            className="w-full pl-9 pr-4 py-2 bg-surface-subtle border border-border rounded-lg text-xs text-primary placeholder:text-primary-muted focus:outline-none focus:border-white focus:ring-1 focus:ring-white transition-colors"
          />
        </div>

        {/* View Mode Toggle */}
        <div className="flex items-center gap-2">
          <div className="flex items-center p-1 bg-surface-subtle rounded-lg border border-border">
            <button
              onClick={() => onViewModeChange('grid')}
              className={`p-1.5 rounded-md transition-colors ${
                viewMode === 'grid'
                  ? 'bg-white text-black font-semibold'
                  : 'text-primary-secondary hover:text-primary'
              }`}
              title="Grid View"
            >
              <LayoutGrid className="w-4 h-4" />
            </button>
            <button
              onClick={() => onViewModeChange('table')}
              className={`p-1.5 rounded-md transition-colors ${
                viewMode === 'table'
                  ? 'bg-white text-black font-semibold'
                  : 'text-primary-secondary hover:text-primary'
              }`}
              title="Table View"
            >
              <List className="w-4 h-4" />
            </button>
          </div>
          <span className="text-xs text-primary-secondary tabular-nums pl-1">
            {totalCount} {totalCount === 1 ? 'role' : 'roles'}
          </span>
        </div>
      </div>

      {/* Filter Chips Bar */}
      <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-border/60">
        <div className="flex items-center gap-1.5 text-xs text-primary-muted pr-2">
          <SlidersHorizontal className="w-3.5 h-3.5" />
          <span>Filters:</span>
        </div>

        {/* Score Threshold Filter */}
        <div className="flex items-center gap-1 bg-surface-subtle p-0.5 rounded-md border border-border text-[11px]">
          <button
            onClick={() => onMinScoreChange(0)}
            className={`px-2 py-1 rounded transition-colors ${
              minScore === 0 ? 'bg-white text-black font-semibold' : 'text-primary-secondary hover:text-primary'
            }`}
          >
            All
          </button>
          <button
            onClick={() => onMinScoreChange(80)}
            className={`px-2 py-1 rounded transition-colors ${
              minScore === 80 ? 'bg-white text-black font-semibold' : 'text-primary-secondary hover:text-primary'
            }`}
          >
            Good (80%+)
          </button>
          <button
            onClick={() => onMinScoreChange(90)}
            className={`px-2 py-1 rounded transition-colors ${
              minScore === 90 ? 'bg-white text-black font-semibold' : 'text-primary-secondary hover:text-primary'
            }`}
          >
            Strong (90%+)
          </button>
        </div>

        {/* Work Mode Filter */}
        <select
          value={selectedWorkMode}
          onChange={(e) => onWorkModeChange(e.target.value as WorkMode | 'all')}
          className="bg-surface-subtle border border-border rounded-md px-2.5 py-1 text-[11px] text-primary focus:outline-none focus:border-white transition-colors cursor-pointer"
        >
          <option value="all">All Work Modes</option>
          <option value="remote">Remote Only</option>
          <option value="hybrid">Hybrid</option>
          <option value="onsite">On-Site</option>
        </select>

        {/* Employment Type Filter */}
        <select
          value={selectedType}
          onChange={(e) => onTypeChange(e.target.value as EmploymentType | 'all')}
          className="bg-surface-subtle border border-border rounded-md px-2.5 py-1 text-[11px] text-primary focus:outline-none focus:border-white transition-colors cursor-pointer"
        >
          <option value="all">All Types</option>
          <option value="internship">Internships</option>
          <option value="full_time">Full-Time</option>
          <option value="contract">Contract</option>
        </select>
      </div>
    </div>
  )
}
