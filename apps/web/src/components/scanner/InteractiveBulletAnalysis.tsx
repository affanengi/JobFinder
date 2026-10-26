import React, { useState, useEffect, useRef } from "react";
import {
  AlertTriangle,
  XCircle,
  ChevronDown,
  ChevronUp,
  Sparkles,
  Check,
  Square,
  CheckSquare,
  Info,
  Tag,
  Sliders,
  ExternalLink,
} from "lucide-react";
import { BulletAuditItem, JobRequirementMatchItem } from "../../types/scanner";

interface InteractiveBulletAnalysisProps {
  bullets: BulletAuditItem[];
  requirementMatches?: JobRequirementMatchItem[];
  highlightedBulletId?: string | null;
  onSelectRequirement?: (requirementId: string) => void;
  selectedBulletIds: Set<string>;
  onToggleBulletSelection: (bulletId: string) => void;
  onSelectAllBullets: () => void;
  onSelectNeedsAttention: () => void;
  onClearSelection: () => void;
  onOpenBulkOptimizer: () => void;
  bulkOptimizing?: boolean;
  onApplySingleRewrite?: (bulletId: string, newText: string) => Promise<void> | void;
  isReadOnly?: boolean;
}

export const InteractiveBulletAnalysis: React.FC<InteractiveBulletAnalysisProps> = ({
  bullets,
  requirementMatches = [],
  highlightedBulletId,
  onSelectRequirement,
  selectedBulletIds,
  onToggleBulletSelection,
  onSelectAllBullets,
  onSelectNeedsAttention,
  onClearSelection,
  onOpenBulkOptimizer,
  bulkOptimizing = false,
  onApplySingleRewrite: _onApplySingleRewrite,
  isReadOnly = false,
}) => {
  const [filter, setFilter] = useState<"all" | "weak" | "strong">("all");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [expandedBulletIds, setExpandedBulletIds] = useState<Set<string>>(new Set());

  const bulletRefs = useRef<Record<string, HTMLDivElement | null>>({});

  // Auto-scroll and expand highlighted bullet from JobMatchMap cross-navigation
  useEffect(() => {
    if (highlightedBulletId) {
      setExpandedBulletIds((prev) => new Set([...prev, highlightedBulletId]));
      const el = bulletRefs.current[highlightedBulletId];
      if (el && typeof el.scrollIntoView === "function") {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    }
  }, [highlightedBulletId]);

  const toggleExpand = (id: string) => {
    setExpandedBulletIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const expandAll = () => {
    setExpandedBulletIds(new Set(bullets.map((b) => b.id)));
  };

  const collapseAll = () => {
    setExpandedBulletIds(new Set());
  };

  const filteredBullets = bullets.filter((b) => {
    if (filter === "weak") {
      const isWeak = b.status !== "strong" || !b.has_action_verb || !b.has_metric;
      if (!isWeak) return false;
    }
    if (filter === "strong" && b.status !== "strong") {
      return false;
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const inText = b.text.toLowerCase().includes(q);
      const inRole = b.role_or_project.toLowerCase().includes(q);
      const inSec = b.section.toLowerCase().includes(q);
      return inText || inRole || inSec;
    }
    return true;
  });

  const getRubricScoreColor = (score: number) => {
    if (score >= 21) return "text-emerald-400 bg-emerald-500/10 border-emerald-500/30";
    if (score >= 16) return "text-amber-400 bg-amber-500/10 border-amber-500/30";
    return "text-rose-400 bg-rose-500/10 border-rose-500/30";
  };

  const getEvidenceClassificationBadge = (cls?: string) => {
    switch (cls) {
      case "demonstrated":
        return "bg-emerald-500/15 border-emerald-500/30 text-emerald-300";
      case "listed":
        return "bg-amber-500/15 border-amber-500/30 text-amber-300";
      case "transferable":
        return "bg-violet-500/15 border-violet-500/30 text-violet-300";
      default:
        return "bg-neutral-800 border-neutral-700 text-neutral-400";
    }
  };

  return (
    <div className="bg-[#141414] border border-white/15 rounded-2xl p-5 sm:p-6 space-y-5 shadow-sm" data-testid="interactive-bullet-analysis">
      {/* HEADER & FILTERS */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-white/10 pb-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Sliders className="w-4 h-4 text-emerald-400" />
            <h3 className="text-xs font-bold uppercase tracking-wider text-white">
              Interactive Bullet Analysis
            </h3>
          </div>
          <p className="text-xs text-neutral-400">
            Examine bullets against the 4-dimensional rubric (Action & Scope, Substance, Credibility, Relevance).
          </p>
        </div>

        {/* CONTROLS */}
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="text"
            placeholder="Search bullets or roles..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="bg-[#0D0D0D] border border-white/15 rounded-lg px-2.5 py-1 text-xs text-white placeholder-neutral-500 focus:outline-none focus:border-emerald-400"
          />

          <div className="flex items-center bg-[#0D0D0D] p-1 rounded-xl border border-white/10 text-xs">
            <button
              onClick={() => setFilter("all")}
              className={`px-2.5 py-1 rounded-lg transition-colors cursor-pointer font-medium ${
                filter === "all" ? "bg-[#222] text-white font-bold" : "text-neutral-400 hover:text-white"
              }`}
            >
              All ({bullets.length})
            </button>
            <button
              onClick={() => setFilter("weak")}
              className={`px-2.5 py-1 rounded-lg transition-colors cursor-pointer font-medium ${
                filter === "weak" ? "bg-[#222] text-amber-400 font-bold" : "text-neutral-400 hover:text-white"
              }`}
            >
              Needs Attention ({bullets.filter((b) => b.status !== "strong" || !b.has_action_verb || !b.has_metric).length})
            </button>
            <button
              onClick={() => setFilter("strong")}
              className={`px-2.5 py-1 rounded-lg transition-colors cursor-pointer font-medium ${
                filter === "strong" ? "bg-[#222] text-emerald-400 font-bold" : "text-neutral-400 hover:text-white"
              }`}
            >
              Strong ({bullets.filter((b) => b.status === "strong").length})
            </button>
          </div>

          <div className="flex items-center gap-1 text-[11px] text-neutral-400">
            <button
              onClick={expandAll}
              className="px-2 py-1 hover:text-white transition-colors cursor-pointer"
            >
              Expand All
            </button>
            <span>•</span>
            <button
              onClick={collapseAll}
              className="px-2 py-1 hover:text-white transition-colors cursor-pointer"
            >
              Collapse
            </button>
          </div>
        </div>
      </div>

      {/* BULK ACTION BAR */}
      <div className="p-3 bg-[#0D0D0D] border border-white/10 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
        <div className="flex items-center gap-3">
          <span className="text-neutral-400">
            {isReadOnly ? (
              <span className="text-neutral-300 font-medium">
                {bullets.length} bullets evaluated in historical audit
              </span>
            ) : (
              <>
                <strong className="text-white">{selectedBulletIds.size}</strong> of {bullets.length} selected
              </>
            )}
          </span>
          {!isReadOnly && (
            <div className="flex items-center gap-1.5">
              <button
                onClick={onSelectNeedsAttention}
                className="px-2 py-1 rounded-lg bg-[#1F1F1F] hover:bg-neutral-700 text-amber-300 font-medium transition-colors cursor-pointer"
              >
                Select Needs Attention
              </button>
              <button
                onClick={onSelectAllBullets}
                className="px-2 py-1 rounded-lg bg-[#1F1F1F] hover:bg-neutral-700 text-neutral-300 hover:text-white font-medium transition-colors cursor-pointer"
              >
                Select All
              </button>
              {selectedBulletIds.size > 0 && (
                <button
                  onClick={onClearSelection}
                  className="px-2 py-1 rounded-lg text-neutral-500 hover:text-white transition-colors cursor-pointer"
                >
                  Clear
                </button>
              )}
            </div>
          )}
        </div>

        {isReadOnly ? (
          <span className="px-2.5 py-1 rounded-lg bg-neutral-900 border border-white/10 text-xs font-mono text-neutral-400">
            Read-Only Historical Rubric
          </span>
        ) : (
          <button
            onClick={onOpenBulkOptimizer}
            disabled={selectedBulletIds.size === 0 || bulkOptimizing}
            className="flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-black font-bold text-xs transition-all cursor-pointer shadow-md disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Sparkles size={13} className="text-black" />
            <span>✨ Optimize Selected ({selectedBulletIds.size}) with AI</span>
          </button>
        )}
      </div>

      {/* BULLET CARDS LIST */}
      <div className="space-y-3">
        {filteredBullets.length === 0 ? (
          <div className="p-8 text-center bg-[#0D0D0D] rounded-xl border border-white/5 text-xs text-neutral-400">
            No bullets match current filter criteria.
          </div>
        ) : (
          filteredBullets.map((bullet) => {
            const isSelected = selectedBulletIds.has(bullet.id);
            const isExpanded = expandedBulletIds.has(bullet.id);
            const isHighlighted = highlightedBulletId === bullet.id;
            const rubric = bullet.rubric_breakdown;

            return (
              <div
                key={bullet.id}
                ref={(el) => {
                  bulletRefs.current[bullet.id] = el;
                }}
                className={`rounded-xl border transition-all ${
                  isHighlighted
                    ? "ring-2 ring-emerald-400 border-emerald-400/80 bg-[#141b14] shadow-lg"
                    : isSelected
                    ? "bg-[#161616] border-emerald-500/40 shadow-sm"
                    : bullet.status === "strong"
                    ? "bg-[#0D0D0D] border-emerald-500/20"
                    : bullet.status === "moderate"
                    ? "bg-[#121210] border-amber-500/20"
                    : "bg-[#141010] border-rose-500/20"
                } p-4 space-y-3`}
              >
                {/* COMPACT TOP ROW */}
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2.5 flex-1 min-w-0">
                    {!isReadOnly && (
                      <button
                        onClick={() => onToggleBulletSelection(bullet.id)}
                        className="text-neutral-400 hover:text-emerald-400 transition-colors cursor-pointer shrink-0"
                        title={isSelected ? "Deselect" : "Select for optimization"}
                      >
                        {isSelected ? (
                          <CheckSquare size={16} className="text-emerald-400" />
                        ) : (
                          <Square size={16} />
                        )}
                      </button>
                    )}

                    <span className="text-[10px] font-mono uppercase tracking-wider text-neutral-400 bg-[#1F1F1F] px-2 py-0.5 rounded border border-white/10 shrink-0">
                      {bullet.section}
                    </span>

                    <span className="text-xs font-bold text-white truncate max-w-sm">
                      {bullet.role_or_project}
                    </span>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <span
                      className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded border ${
                        bullet.status === "strong"
                          ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
                          : bullet.status === "moderate"
                          ? "bg-amber-500/10 text-amber-400 border-amber-500/30"
                          : "bg-rose-500/10 text-rose-400 border-rose-500/30"
                      }`}
                    >
                      Score {bullet.score}/100
                    </span>

                    <button
                      onClick={() => toggleExpand(bullet.id)}
                      className="p-1 rounded text-neutral-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
                      title={isExpanded ? "Collapse rubric" : "Expand 4-dimension rubric"}
                    >
                      {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                    </button>
                  </div>
                </div>

                {/* ORIGINAL BULLET TEXT (PRESERVED UNCHANGED) */}
                <p className="text-xs text-neutral-200 leading-relaxed pl-6 font-sans">
                  {bullet.text}
                </p>

                {/* COMPACT INDICATORS & REQUIREMENT TAGS */}
                <div className="flex flex-wrap items-center gap-2 text-[10px] font-mono pl-6 pt-0.5">
                  {bullet.has_action_verb ? (
                    <span className="px-2 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 flex items-center gap-1">
                      <Check size={10} /> Action Verb ({bullet.verb || "power verb"})
                    </span>
                  ) : (
                    <span className="px-2 py-0.5 rounded bg-rose-500/10 border border-rose-500/30 text-rose-400 flex items-center gap-1">
                      <XCircle size={10} /> Missing Strong Action Verb
                    </span>
                  )}

                  {bullet.has_metric ? (
                    <span className="px-2 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 flex items-center gap-1">
                      <Check size={10} /> Quantified Metric
                    </span>
                  ) : (
                    <span className="px-2 py-0.5 rounded bg-amber-500/10 border border-amber-500/30 text-amber-400 flex items-center gap-1">
                      <AlertTriangle size={10} /> Missing Numerical Impact
                    </span>
                  )}

                  {bullet.evidence_classification && (
                    <span
                      className={`px-2 py-0.5 rounded border capitalize ${getEvidenceClassificationBadge(
                        bullet.evidence_classification
                      )}`}
                    >
                      Evidence: {bullet.evidence_classification}
                    </span>
                  )}

                  {/* CROSS-NAVIGATION REQUIREMENT TAGS */}
                  {bullet.matched_requirement_ids && bullet.matched_requirement_ids.length > 0 && (
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-neutral-500">Matches:</span>
                      {bullet.matched_requirement_ids.map((reqId) => {
                        const matchedReq = requirementMatches.find((r) => r.id === reqId);
                        const label = matchedReq ? matchedReq.name : reqId;
                        return (
                          <button
                            key={reqId}
                            onClick={() => onSelectRequirement && onSelectRequirement(reqId)}
                            className="px-2 py-0.5 rounded bg-sky-500/10 hover:bg-sky-500/20 border border-sky-500/30 text-sky-300 flex items-center gap-1 transition-colors cursor-pointer group"
                            title="Click to view requirement in Job Match Map"
                          >
                            <Tag size={9} />
                            <span>{label}</span>
                            <ExternalLink size={9} className="opacity-60 group-hover:opacity-100" />
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* EXPANDED 4-DIMENSIONAL RUBRIC VIEW */}
                {isExpanded && (
                  <div className="pl-6 pt-3 mt-2 border-t border-white/10 space-y-4 animate-fade-in">
                    {rubric ? (
                      <div className="space-y-3">
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-bold uppercase tracking-wider text-neutral-300">
                            4-Dimension Contextual Rubric (0 - 25 pts each)
                          </span>
                          <span className="font-mono text-neutral-400 text-[11px]">
                            Total: {rubric.action_scope_score + rubric.technical_substance_score + rubric.outcome_credibility_score + rubric.job_relevance_score} / 100
                          </span>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
                          {/* Dimension 1: Action & Scope */}
                          <div className="p-2.5 rounded-lg bg-[#141414] border border-white/10 space-y-1">
                            <div className="flex items-center justify-between text-[11px]">
                              <span className="text-neutral-400">Action & Scope</span>
                              <span className={`px-1.5 py-0.2 rounded font-mono font-bold border text-[10px] ${getRubricScoreColor(rubric.action_scope_score)}`}>
                                {rubric.action_scope_score}/25
                              </span>
                            </div>
                            <div className="w-full h-1 bg-neutral-800 rounded-full overflow-hidden">
                              <div
                                className="h-full bg-emerald-400"
                                style={{ width: `${(rubric.action_scope_score / 25) * 100}%` }}
                              />
                            </div>
                          </div>

                          {/* Dimension 2: Technical Substance */}
                          <div className="p-2.5 rounded-lg bg-[#141414] border border-white/10 space-y-1">
                            <div className="flex items-center justify-between text-[11px]">
                              <span className="text-neutral-400">Technical Substance</span>
                              <span className={`px-1.5 py-0.2 rounded font-mono font-bold border text-[10px] ${getRubricScoreColor(rubric.technical_substance_score)}`}>
                                {rubric.technical_substance_score}/25
                              </span>
                            </div>
                            <div className="w-full h-1 bg-neutral-800 rounded-full overflow-hidden">
                              <div
                                className="h-full bg-emerald-400"
                                style={{ width: `${(rubric.technical_substance_score / 25) * 100}%` }}
                              />
                            </div>
                          </div>

                          {/* Dimension 3: Outcome Credibility */}
                          <div className="p-2.5 rounded-lg bg-[#141414] border border-white/10 space-y-1">
                            <div className="flex items-center justify-between text-[11px]">
                              <span className="text-neutral-400">Outcome Credibility</span>
                              <span className={`px-1.5 py-0.2 rounded font-mono font-bold border text-[10px] ${getRubricScoreColor(rubric.outcome_credibility_score)}`}>
                                {rubric.outcome_credibility_score}/25
                              </span>
                            </div>
                            <div className="w-full h-1 bg-neutral-800 rounded-full overflow-hidden">
                              <div
                                className="h-full bg-emerald-400"
                                style={{ width: `${(rubric.outcome_credibility_score / 25) * 100}%` }}
                              />
                            </div>
                          </div>

                          {/* Dimension 4: Role Relevance */}
                          <div className="p-2.5 rounded-lg bg-[#141414] border border-white/10 space-y-1">
                            <div className="flex items-center justify-between text-[11px]">
                              <span className="text-neutral-400">Role Relevance</span>
                              <span className={`px-1.5 py-0.2 rounded font-mono font-bold border text-[10px] ${getRubricScoreColor(rubric.job_relevance_score)}`}>
                                {rubric.job_relevance_score}/25
                              </span>
                            </div>
                            <div className="w-full h-1 bg-neutral-800 rounded-full overflow-hidden">
                              <div
                                className="h-full bg-emerald-400"
                                style={{ width: `${(rubric.job_relevance_score / 25) * 100}%` }}
                              />
                            </div>
                          </div>
                        </div>

                        {/* Rubric Notes */}
                        {rubric.rubric_notes && rubric.rubric_notes.length > 0 && (
                          <div className="p-2.5 rounded-lg bg-[#121212] border border-white/5 space-y-1">
                            <div className="text-[10px] font-mono uppercase text-neutral-400">Evaluator Rubric Observations:</div>
                            <ul className="list-disc list-inside space-y-0.5 text-[11px] text-neutral-300">
                              {rubric.rubric_notes.map((note, idx) => (
                                <li key={idx}>{note}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="p-3 rounded-lg bg-[#121212] border border-amber-500/20 text-xs text-amber-300/80 flex items-center gap-2">
                        <Info size={14} className="shrink-0 text-amber-400" />
                        <span>
                          Contextual 4-dimension rubric breakdown not available in legacy report. Re-scan this resume to generate full contextual analysis.
                        </span>
                      </div>
                    )}

                    {/* DETECTED ISSUES & SUGGESTED FOCUS */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                      {bullet.issues && bullet.issues.length > 0 && (
                        <div className="p-3 rounded-lg bg-[#181212] border border-rose-500/20 space-y-1.5">
                          <div className="text-[10px] font-mono uppercase text-rose-400 font-bold flex items-center gap-1">
                            <XCircle size={11} /> Specific Weaknesses & Missing Context:
                          </div>
                          <ul className="list-disc list-inside space-y-1 text-rose-200/90 text-[11px]">
                            {bullet.issues.map((iss, idx) => (
                              <li key={idx}>{iss}</li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {bullet.suggested_focus && (
                        <div className="p-3 rounded-lg bg-[#121612] border border-emerald-500/20 space-y-1.5">
                          <div className="text-[10px] font-mono uppercase text-emerald-400 font-bold flex items-center gap-1">
                            <Sparkles size={11} /> Recommended Improvement Guidance:
                          </div>
                          <p className="text-emerald-200/90 text-[11px] leading-relaxed">
                            {bullet.suggested_focus}
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
