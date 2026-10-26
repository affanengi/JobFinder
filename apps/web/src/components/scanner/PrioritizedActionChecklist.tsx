import React, { useState } from "react";
import {
  CheckCircle2,
  XCircle,
  AlertTriangle,
} from "lucide-react";
import { ChecklistItem } from "../../types/scanner";

interface PrioritizedActionChecklistProps {
  items: ChecklistItem[];
  onFocusBullet?: (bulletId: string) => void;
  onFocusRequirement?: (reqId: string) => void;
}

export const PrioritizedActionChecklist: React.FC<PrioritizedActionChecklistProps> = ({
  items,
}) => {
  const [filterMode, setFilterMode] = useState<"all" | "actionable" | "passed">("actionable");

  // Priority sorting: critical (0) -> high (1) -> medium (2) -> low (3)
  const priorityRank: Record<string, number> = {
    critical: 0,
    high: 1,
    medium: 2,
    low: 3,
  };

  const sortedItems = [...items].sort((a, b) => {
    // Incomplete items come before passed items
    if (a.passed !== b.passed) {
      return a.passed ? 1 : -1;
    }
    const rankA = priorityRank[a.priority] ?? 4;
    const rankB = priorityRank[b.priority] ?? 4;
    return rankA - rankB;
  });

  const filteredItems = sortedItems.filter((item) => {
    if (filterMode === "actionable") return !item.passed;
    if (filterMode === "passed") return item.passed;
    return true;
  });

  const getPriorityBadge = (priority: string) => {
    switch (priority) {
      case "critical":
        return "bg-rose-500/15 border-rose-500/30 text-rose-400";
      case "high":
        return "bg-amber-500/15 border-amber-500/30 text-amber-400";
      case "medium":
        return "bg-sky-500/15 border-sky-500/30 text-sky-400";
      default:
        return "bg-neutral-800 border-neutral-700 text-neutral-300";
    }
  };

  return (
    <div className="bg-[#141414] border border-white/15 rounded-2xl p-5 sm:p-6 space-y-5 shadow-sm" data-testid="prioritized-action-checklist">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-white/10 pb-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            <h3 className="text-xs font-bold uppercase tracking-wider text-white">
              Prioritized Action Checklist
            </h3>
          </div>
          <p className="text-xs text-neutral-400">
            Material content improvements ranked by ATS impact — address mandatory role alignment and evidence depth first.
          </p>
        </div>

        <div className="flex items-center bg-[#0D0D0D] p-1 rounded-xl border border-white/10 text-xs">
          <button
            onClick={() => setFilterMode("actionable")}
            className={`px-3 py-1 rounded-lg transition-colors cursor-pointer font-medium flex items-center gap-1.5 ${
              filterMode === "actionable"
                ? "bg-[#222] text-amber-300 font-bold"
                : "text-neutral-400 hover:text-white"
            }`}
          >
            <span>Actionable ({items.filter((i) => !i.passed).length})</span>
          </button>
          <button
            onClick={() => setFilterMode("all")}
            className={`px-3 py-1 rounded-lg transition-colors cursor-pointer font-medium ${
              filterMode === "all"
                ? "bg-[#222] text-white font-bold"
                : "text-neutral-400 hover:text-white"
            }`}
          >
            All ({items.length})
          </button>
          <button
            onClick={() => setFilterMode("passed")}
            className={`px-3 py-1 rounded-lg transition-colors cursor-pointer font-medium ${
              filterMode === "passed"
                ? "bg-[#222] text-emerald-400 font-bold"
                : "text-neutral-400 hover:text-white"
            }`}
          >
            Passed ({items.filter((i) => i.passed).length})
          </button>
        </div>
      </div>

      {filteredItems.length === 0 ? (
        <div className="p-8 text-center bg-[#0D0D0D] rounded-xl border border-white/5 space-y-2">
          <CheckCircle2 className="w-8 h-8 text-emerald-400 mx-auto" />
          <div className="text-xs font-bold text-white">All Actionable Checks Completed!</div>
          <p className="text-[11px] text-neutral-400">
            Your resume satisfies all priority ATS structural, keyword, and quantification checks.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {filteredItems.map((item) => (
            <div
              key={item.id}
              className={`p-4 rounded-xl border flex flex-col justify-between space-y-3 transition-all ${
                item.passed
                  ? "bg-[#101310] border-emerald-500/20"
                  : item.priority === "critical"
                  ? "bg-[#181214] border-rose-500/30"
                  : "bg-[#161411] border-amber-500/30"
              }`}
            >
              <div className="space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    {item.passed ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                    ) : item.priority === "critical" ? (
                      <XCircle className="w-4 h-4 text-rose-400 shrink-0" />
                    ) : (
                      <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
                    )}
                    <span className="text-xs font-bold text-white">{item.title}</span>
                  </div>

                  <span
                    className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase border shrink-0 ${getPriorityBadge(
                      item.priority
                    )}`}
                  >
                    {item.priority}
                  </span>
                </div>

                <p className="text-[11px] text-neutral-300 leading-relaxed pl-6">
                  {item.description}
                </p>
              </div>

              {/* Rationale & Action Guidance */}
              <div className="pl-6 pt-2 border-t border-white/5 flex items-center justify-between text-[10px] text-neutral-400">
                <span className="font-mono text-neutral-400">
                  Category: {item.category}
                </span>
                {item.impact_points > 0 && !item.passed && (
                  <span className="text-emerald-400 font-mono font-bold">
                    +{item.impact_points} pts potential
                  </span>
                )}
                {item.passed && (
                  <span className="text-emerald-400 font-mono flex items-center gap-1">
                    <CheckCircle2 size={10} /> Verified Passing
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
