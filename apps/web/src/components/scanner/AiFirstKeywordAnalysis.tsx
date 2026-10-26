import React, { useState } from "react";
import {
  Search,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  HelpCircle,
  Quote,
  Info,
} from "lucide-react";
import { ContextualKeywordItem, KeywordCoverageStatus } from "../../types/scanner";

interface AiFirstKeywordAnalysisProps {
  keywords: ContextualKeywordItem[];
}

export const AiFirstKeywordAnalysis: React.FC<AiFirstKeywordAnalysisProps> = ({
  keywords = [],
}) => {
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<"all" | KeywordCoverageStatus>("all");

  const filteredKeywords = keywords.filter((item) => {
    if (statusFilter !== "all" && item.status !== statusFilter) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const inKw = item.keyword.toLowerCase().includes(q);
      const inExp = item.explanation.toLowerCase().includes(q);
      const inEv = (item.supporting_evidence || "").toLowerCase().includes(q);
      return inKw || inExp || inEv;
    }
    return true;
  });

  const getStatusConfig = (status: KeywordCoverageStatus) => {
    switch (status) {
      case "present_and_relevant":
        return {
          badge: "bg-emerald-500/15 border-emerald-500/30 text-emerald-300",
          icon: <CheckCircle2 size={12} className="text-emerald-400" />,
          label: "Demonstrated in Context",
        };
      case "present_weak":
        return {
          badge: "bg-amber-500/15 border-amber-500/30 text-amber-300",
          icon: <AlertTriangle size={12} className="text-amber-400" />,
          label: "Weakly Demonstrated",
        };
      case "not_found":
        return {
          badge: "bg-rose-500/15 border-rose-500/30 text-rose-300",
          icon: <XCircle size={12} className="text-rose-400" />,
          label: "Not Found in Resume",
        };
      default:
        return {
          badge: "bg-neutral-800 border-neutral-700 text-neutral-300",
          icon: <HelpCircle size={12} className="text-neutral-400" />,
          label: "Unverified",
        };
    }
  };

  const relevantCount = keywords.filter((k) => k.status === "present_and_relevant").length;
  const weakCount = keywords.filter((k) => k.status === "present_weak").length;
  const missingCount = keywords.filter((k) => k.status === "not_found").length;

  return (
    <div
      className="bg-[#141414] border border-white/15 rounded-2xl p-6 space-y-6 shadow-sm"
      data-testid="ai-keyword-analysis"
    >
      {/* HEADER ROW */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-white/10 pb-4">
        <div>
          <h3 className="text-sm font-bold uppercase tracking-wider text-white flex items-center gap-2">
            <span>Contextual Competency & Keyword Analysis</span>
            <span className="text-xs text-neutral-400 font-mono font-normal">
              ({keywords.length} competencies evaluated)
            </span>
          </h3>
          <p className="text-xs text-neutral-400 mt-0.5">
            Evaluates contextual relevance and applied depth. Real ATS algorithms reward authentic qualification over keyword stuffing.
          </p>
        </div>

        {/* PILLS */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="px-2.5 py-1 rounded-lg text-xs font-mono font-bold bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 flex items-center gap-1.5">
            <CheckCircle2 size={12} /> {relevantCount} Grounded
          </span>
          <span className="px-2.5 py-1 rounded-lg text-xs font-mono font-bold bg-amber-500/10 border border-amber-500/30 text-amber-400 flex items-center gap-1.5">
            <AlertTriangle size={12} /> {weakCount} Weak Context
          </span>
          <span className="px-2.5 py-1 rounded-lg text-xs font-mono font-bold bg-rose-500/10 border border-rose-500/30 text-rose-400 flex items-center gap-1.5">
            <XCircle size={12} /> {missingCount} Missing
          </span>
        </div>
      </div>

      {/* CALLOUT BANNER ON RELEVANCE VS KEYWORD REPETITION */}
      <div className="p-3.5 bg-blue-950/20 border border-blue-500/20 rounded-xl text-xs text-blue-200/90 flex items-start gap-2.5">
        <Info size={16} className="text-blue-400 shrink-0 mt-0.5" />
        <span>
          <strong>Contextual Relevance Note:</strong> Merely repeating keywords without substantive technical context or demonstrated achievements does not guarantee ranking improvements. Target competencies should be evidenced in active project or work bullets.
        </span>
      </div>

      {/* CONTROLS */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search keywords or explanations..."
            className="w-full pl-9 pr-3 py-1.5 rounded-xl bg-[#0D0D0D] border border-white/10 text-xs text-white placeholder-neutral-500 focus:outline-none focus:border-emerald-500"
          />
        </div>

        <div className="flex items-center bg-[#0D0D0D] p-1 rounded-xl border border-white/10 text-xs">
          <button
            onClick={() => setStatusFilter("all")}
            className={`px-2.5 py-1 rounded-lg transition-colors cursor-pointer ${
              statusFilter === "all" ? "bg-[#222] text-white font-bold" : "text-neutral-400 hover:text-white"
            }`}
          >
            All ({keywords.length})
          </button>
          <button
            onClick={() => setStatusFilter("present_and_relevant")}
            className={`px-2.5 py-1 rounded-lg transition-colors cursor-pointer ${
              statusFilter === "present_and_relevant" ? "bg-[#222] text-white font-bold" : "text-neutral-400 hover:text-white"
            }`}
          >
            Grounded ({relevantCount})
          </button>
          <button
            onClick={() => setStatusFilter("present_weak")}
            className={`px-2.5 py-1 rounded-lg transition-colors cursor-pointer ${
              statusFilter === "present_weak" ? "bg-[#222] text-white font-bold" : "text-neutral-400 hover:text-white"
            }`}
          >
            Weak ({weakCount})
          </button>
          <button
            onClick={() => setStatusFilter("not_found")}
            className={`px-2.5 py-1 rounded-lg transition-colors cursor-pointer ${
              statusFilter === "not_found" ? "bg-[#222] text-white font-bold" : "text-neutral-400 hover:text-white"
            }`}
          >
            Missing ({missingCount})
          </button>
        </div>
      </div>

      {/* KEYWORDS GRID */}
      {filteredKeywords.length === 0 ? (
        <div className="p-8 rounded-xl bg-[#0D0D0D] border border-white/5 text-center text-xs text-neutral-400">
          No competencies match the search or filter criteria.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {filteredKeywords.map((item, idx) => {
            const statusConfig = getStatusConfig(item.status);
            return (
              <div
                key={idx}
                className="p-4 rounded-xl bg-[#0D0D0D] border border-white/10 space-y-2 hover:border-white/20 transition-all flex flex-col justify-between"
              >
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-bold text-white font-mono">
                      {item.keyword}
                    </span>
                    <span className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold border flex items-center gap-1 ${statusConfig.badge}`}>
                      {statusConfig.icon}
                      <span>{statusConfig.label}</span>
                    </span>
                  </div>

                  <p className="text-xs text-neutral-300 leading-relaxed font-sans">
                    {item.explanation}
                  </p>
                </div>

                {item.supporting_evidence && (
                  <div className="pt-2 border-t border-white/5">
                    <span className="text-[10px] font-mono text-neutral-400 flex items-center gap-1 mb-1">
                      <Quote size={10} className="text-emerald-400" /> Quoted Excerpt:
                    </span>
                    <div className="p-2 rounded bg-[#141414] border border-white/5 text-[11px] font-mono text-neutral-300 italic">
                      "{item.supporting_evidence}"
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
