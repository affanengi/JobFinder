import React, { useState } from "react";
import {
  Search,
  Zap,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Quote,
} from "lucide-react";
import { ContextualKeywordItem, KeywordCoverageStatus } from "../../../types/scanner";

interface KeywordExplorerViewProps {
  keywords: ContextualKeywordItem[];
}

export const KeywordExplorerView: React.FC<KeywordExplorerViewProps> = ({
  keywords = [],
}) => {
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | KeywordCoverageStatus>("all");

  const filteredKeywords = keywords.filter((kw) => {
    if (statusFilter !== "all" && kw.status !== statusFilter) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const inWord = kw.keyword.toLowerCase().includes(q);
      const inExp = kw.explanation.toLowerCase().includes(q);
      const inQuote = kw.supporting_evidence?.toLowerCase().includes(q) || false;
      return inWord || inExp || inQuote;
    }
    return true;
  });

  const matchedCount = keywords.filter((k) => k.status === "present_and_relevant").length;
  const weakCount = keywords.filter((k) => k.status === "present_weak").length;
  const missingCount = keywords.filter((k) => k.status === "not_found").length;

  return (
    <div className="h-full flex flex-col space-y-4" data-testid="keyword-explorer-view">
      {/* TOP SUMMARY STATS */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 shrink-0">
        <div className="p-3.5 rounded-xl bg-[#161616] border border-white/10 flex items-center justify-between">
          <div>
            <p className="text-[10px] font-mono uppercase tracking-wider text-neutral-400">Total Competencies</p>
            <p className="text-base font-bold text-white font-mono mt-0.5">{keywords.length}</p>
          </div>
          <Zap className="w-5 h-5 text-neutral-400 opacity-60" />
        </div>

        <div className="p-3.5 rounded-xl bg-emerald-950/20 border border-emerald-500/20 flex items-center justify-between">
          <div>
            <p className="text-[10px] font-mono uppercase tracking-wider text-emerald-400">Matched in Context</p>
            <p className="text-base font-bold text-emerald-300 font-mono mt-0.5">{matchedCount}</p>
          </div>
          <CheckCircle2 className="w-5 h-5 text-emerald-400 opacity-60" />
        </div>

        <div className="p-3.5 rounded-xl bg-amber-950/20 border border-amber-500/20 flex items-center justify-between">
          <div>
            <p className="text-[10px] font-mono uppercase tracking-wider text-amber-400">Weak Context</p>
            <p className="text-base font-bold text-amber-300 font-mono mt-0.5">{weakCount}</p>
          </div>
          <AlertTriangle className="w-5 h-5 text-amber-400 opacity-60" />
        </div>

        <div className="p-3.5 rounded-xl bg-rose-950/20 border border-rose-500/20 flex items-center justify-between">
          <div>
            <p className="text-[10px] font-mono uppercase tracking-wider text-rose-400">Missing in Resume</p>
            <p className="text-base font-bold text-rose-300 font-mono mt-0.5">{missingCount}</p>
          </div>
          <XCircle className="w-5 h-5 text-rose-400 opacity-60" />
        </div>
      </div>

      {/* SEARCH AND FILTER BAR */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 shrink-0 bg-[#161616] p-3 rounded-xl border border-white/10">
        <div className="relative flex-1 max-w-md">
          <Search className="w-3.5 h-3.5 text-neutral-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search keywords, explanations, or quotes..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-3 py-1.5 rounded-lg bg-[#0D0D0D] border border-white/10 text-xs text-white placeholder-neutral-500 focus:outline-none focus:border-teal-500/50"
          />
        </div>

        {/* Status Filter Buttons */}
        <div className="flex items-center bg-[#0D0D0D] p-1 rounded-lg border border-white/10 text-xs">
          <button
            type="button"
            onClick={() => setStatusFilter("all")}
            className={`px-2.5 py-1 rounded text-[11px] font-medium transition-colors ${
              statusFilter === "all" ? "bg-white text-black font-bold" : "text-neutral-400 hover:text-white"
            }`}
          >
            All ({keywords.length})
          </button>
          <button
            type="button"
            onClick={() => setStatusFilter("present_and_relevant")}
            className={`px-2.5 py-1 rounded text-[11px] font-medium transition-colors ${
              statusFilter === "present_and_relevant"
                ? "bg-emerald-500/20 text-emerald-300 font-bold"
                : "text-neutral-400 hover:text-emerald-400"
            }`}
          >
            Matched ({matchedCount})
          </button>
          <button
            type="button"
            onClick={() => setStatusFilter("present_weak")}
            className={`px-2.5 py-1 rounded text-[11px] font-medium transition-colors ${
              statusFilter === "present_weak"
                ? "bg-amber-500/20 text-amber-300 font-bold"
                : "text-neutral-400 hover:text-amber-400"
            }`}
          >
            Weak ({weakCount})
          </button>
          <button
            type="button"
            onClick={() => setStatusFilter("not_found")}
            className={`px-2.5 py-1 rounded text-[11px] font-medium transition-colors ${
              statusFilter === "not_found"
                ? "bg-rose-500/20 text-rose-300 font-bold"
                : "text-neutral-400 hover:text-rose-400"
            }`}
          >
            Missing ({missingCount})
          </button>
        </div>
      </div>

      {/* KEYWORDS CARDS GRID */}
      <div className="flex-1 overflow-y-auto">
        {filteredKeywords.length === 0 ? (
          <div className="p-12 text-center text-xs text-neutral-400">
            No keywords matched your search query or filter.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {filteredKeywords.map((kw, idx) => (
              <div
                key={idx}
                className="p-4 rounded-xl bg-[#161616] border border-white/10 space-y-2.5 flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-center justify-between gap-2 mb-1.5">
                    <span className="text-sm font-bold text-white font-mono flex items-center gap-1.5">
                      <Zap className="w-3.5 h-3.5 text-teal-400" />
                      <span>{kw.keyword}</span>
                    </span>

                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase tracking-wider border ${
                        kw.status === "present_and_relevant"
                          ? "bg-emerald-500/10 text-emerald-300 border-emerald-500/20"
                          : kw.status === "present_weak"
                          ? "bg-amber-500/10 text-amber-300 border-amber-500/20"
                          : "bg-rose-500/10 text-rose-300 border-rose-500/20"
                      }`}
                    >
                      {kw.status === "present_and_relevant"
                        ? "Matched"
                        : kw.status === "present_weak"
                        ? "Weak"
                        : "Missing"}
                    </span>
                  </div>

                  <p className="text-xs text-neutral-300 leading-relaxed font-normal">
                    {kw.explanation}
                  </p>
                </div>

                {kw.supporting_evidence && (
                  <div className="p-2.5 rounded-lg bg-[#0E0E0E] border border-white/5 space-y-1">
                    <span className="text-[10px] font-mono text-neutral-400 uppercase tracking-wider flex items-center gap-1">
                      <Quote className="w-3 h-3 text-emerald-400" />
                      <span>Resume Citation</span>
                    </span>
                    <p className="text-[11px] font-serif italic text-emerald-200/90 leading-relaxed">
                      "{kw.supporting_evidence}"
                    </p>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default KeywordExplorerView;
