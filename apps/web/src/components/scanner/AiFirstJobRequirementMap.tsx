import React, { useState } from "react";
import {
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Search,
  Quote,
  HelpCircle,
} from "lucide-react";
import { JobRequirementAnalysisItem, RequirementCriticality, RequirementMatchStatus } from "../../types/scanner";

interface AiFirstJobRequirementMapProps {
  requirements: JobRequirementAnalysisItem[];
}

export const AiFirstJobRequirementMap: React.FC<AiFirstJobRequirementMapProps> = ({
  requirements = [],
}) => {
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [criticalityFilter, setCriticalityFilter] = useState<"all" | RequirementCriticality>("all");
  const [statusFilter, setStatusFilter] = useState<"all" | RequirementMatchStatus>("all");

  const filteredRequirements = requirements.filter((req) => {
    if (criticalityFilter !== "all" && req.criticality !== criticalityFilter) return false;
    if (statusFilter !== "all" && req.match_status !== statusFilter) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const inDesc = req.requirement_description.toLowerCase().includes(q);
      const inExp = req.explanation.toLowerCase().includes(q);
      const inEv = req.supporting_evidence.some((e) => e.toLowerCase().includes(q));
      return inDesc || inExp || inEv;
    }
    return true;
  });

  const meetsCount = requirements.filter((r) => r.match_status === "MEETS").length;
  const partialCount = requirements.filter((r) => r.match_status === "PARTIAL").length;
  const missingCount = requirements.filter((r) => r.match_status === "MISSING").length;

  const getStatusBadge = (status: RequirementMatchStatus) => {
    switch (status) {
      case "MEETS":
        return {
          bg: "bg-emerald-500/15 border-emerald-500/30 text-emerald-300",
          icon: <CheckCircle2 size={13} className="text-emerald-400" />,
          label: "Demonstrated in Resume",
        };
      case "PARTIAL":
        return {
          bg: "bg-amber-500/15 border-amber-500/30 text-amber-300",
          icon: <AlertTriangle size={13} className="text-amber-400" />,
          label: "Partially Demonstrated",
        };
      case "MISSING":
        return {
          bg: "bg-rose-500/15 border-rose-500/30 text-rose-300",
          icon: <XCircle size={13} className="text-rose-400" />,
          label: "Missing in Evidence",
        };
      default:
        return {
          bg: "bg-neutral-800 border-neutral-700 text-neutral-300",
          icon: <HelpCircle size={13} className="text-neutral-400" />,
          label: "Unverified",
        };
    }
  };

  const getCriticalityBadge = (crit: RequirementCriticality) => {
    switch (crit) {
      case "mandatory":
        return "bg-rose-500/10 text-rose-300 border-rose-500/30 font-bold";
      case "preferred":
        return "bg-blue-500/10 text-blue-300 border-blue-500/30 font-medium";
      case "bonus":
        return "bg-purple-500/10 text-purple-300 border-purple-500/30 font-normal";
      default:
        return "bg-neutral-800 text-neutral-300 border-neutral-700";
    }
  };

  return (
    <div
      className="bg-[#141414] border border-white/15 rounded-2xl p-6 space-y-6 shadow-sm"
      data-testid="ai-job-requirement-map"
    >
      {/* HEADER & SUMMARY METRICS */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-white/10 pb-4">
        <div>
          <h3 className="text-sm font-bold uppercase tracking-wider text-white flex items-center gap-2">
            <span>Job Requirement Evidence Map</span>
            <span className="text-xs text-neutral-400 font-mono font-normal">
              ({requirements.length} atomic requirements)
            </span>
          </h3>
          <p className="text-xs text-neutral-400 mt-0.5">
            Evaluates contextual demonstration in resume evidence. Distinguishes missing documentation from candidate inability.
          </p>
        </div>

        {/* METRIC PILLS */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="px-2.5 py-1 rounded-lg text-xs font-mono font-bold bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 flex items-center gap-1.5">
            <CheckCircle2 size={12} /> {meetsCount} Meets
          </span>
          <span className="px-2.5 py-1 rounded-lg text-xs font-mono font-bold bg-amber-500/10 border border-amber-500/30 text-amber-400 flex items-center gap-1.5">
            <AlertTriangle size={12} /> {partialCount} Partial
          </span>
          <span className="px-2.5 py-1 rounded-lg text-xs font-mono font-bold bg-rose-500/10 border border-rose-500/30 text-rose-400 flex items-center gap-1.5">
            <XCircle size={12} /> {missingCount} Missing
          </span>
        </div>
      </div>

      {/* FILTER CONTROLS */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search requirements or evidence..."
            className="w-full pl-9 pr-3 py-1.5 rounded-xl bg-[#0D0D0D] border border-white/10 text-xs text-white placeholder-neutral-500 focus:outline-none focus:border-emerald-500"
          />
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Criticality Filter */}
          <div className="flex items-center bg-[#0D0D0D] p-1 rounded-xl border border-white/10 text-xs">
            <button
              onClick={() => setCriticalityFilter("all")}
              className={`px-2.5 py-1 rounded-lg transition-colors cursor-pointer ${
                criticalityFilter === "all" ? "bg-[#222] text-white font-bold" : "text-neutral-400 hover:text-white"
              }`}
            >
              All Types
            </button>
            <button
              onClick={() => setCriticalityFilter("mandatory")}
              className={`px-2.5 py-1 rounded-lg transition-colors cursor-pointer ${
                criticalityFilter === "mandatory" ? "bg-[#222] text-white font-bold" : "text-neutral-400 hover:text-white"
              }`}
            >
              Mandatory
            </button>
            <button
              onClick={() => setCriticalityFilter("preferred")}
              className={`px-2.5 py-1 rounded-lg transition-colors cursor-pointer ${
                criticalityFilter === "preferred" ? "bg-[#222] text-white font-bold" : "text-neutral-400 hover:text-white"
              }`}
            >
              Preferred
            </button>
          </div>

          {/* Status Filter */}
          <div className="flex items-center bg-[#0D0D0D] p-1 rounded-xl border border-white/10 text-xs">
            <button
              onClick={() => setStatusFilter("all")}
              className={`px-2.5 py-1 rounded-lg transition-colors cursor-pointer ${
                statusFilter === "all" ? "bg-[#222] text-white font-bold" : "text-neutral-400 hover:text-white"
              }`}
            >
              All Statuses
            </button>
            <button
              onClick={() => setStatusFilter("MEETS")}
              className={`px-2.5 py-1 rounded-lg transition-colors cursor-pointer ${
                statusFilter === "MEETS" ? "bg-[#222] text-white font-bold" : "text-neutral-400 hover:text-white"
              }`}
            >
              Meets
            </button>
            <button
              onClick={() => setStatusFilter("PARTIAL")}
              className={`px-2.5 py-1 rounded-lg transition-colors cursor-pointer ${
                statusFilter === "PARTIAL" ? "bg-[#222] text-white font-bold" : "text-neutral-400 hover:text-white"
              }`}
            >
              Partial
            </button>
            <button
              onClick={() => setStatusFilter("MISSING")}
              className={`px-2.5 py-1 rounded-lg transition-colors cursor-pointer ${
                statusFilter === "MISSING" ? "bg-[#222] text-white font-bold" : "text-neutral-400 hover:text-white"
              }`}
            >
              Missing
            </button>
          </div>
        </div>
      </div>

      {/* REQUIREMENTS LIST */}
      {filteredRequirements.length === 0 ? (
        <div className="p-8 rounded-xl bg-[#0D0D0D] border border-white/5 text-center text-xs text-neutral-400">
          No requirements match the search or filter criteria.
        </div>
      ) : (
        <div className="space-y-3">
          {filteredRequirements.map((req, idx) => {
            const statusConfig = getStatusBadge(req.match_status);
            return (
              <div
                key={idx}
                className="p-4 rounded-xl bg-[#0D0D0D] border border-white/10 space-y-3 hover:border-white/20 transition-all"
              >
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="space-y-1 flex-1 min-w-[240px]">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`text-[10px] font-mono uppercase px-2 py-0.5 rounded border ${getCriticalityBadge(req.criticality)}`}>
                        {req.criticality}
                      </span>
                      {req.missing_evidence && req.match_status !== "MEETS" && (
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20">
                          Lack of Evidence in Resume
                        </span>
                      )}
                    </div>
                    <h4 className="text-xs font-bold text-white leading-snug">
                      {req.requirement_description}
                    </h4>
                  </div>

                  <span className={`px-2.5 py-1 rounded-lg text-xs font-mono font-bold border flex items-center gap-1.5 shrink-0 ${statusConfig.bg}`}>
                    {statusConfig.icon}
                    <span>{statusConfig.label}</span>
                  </span>
                </div>

                {/* EXPLANATION */}
                <p className="text-xs text-neutral-300 leading-relaxed font-sans">
                  {req.explanation}
                </p>

                {/* SUPPORTING EVIDENCE QUOTES */}
                {req.supporting_evidence && req.supporting_evidence.length > 0 && (
                  <div className="space-y-1.5 pt-1">
                    <span className="text-[10px] font-mono uppercase tracking-wider text-neutral-400 font-semibold flex items-center gap-1">
                      <Quote size={10} className="text-emerald-400" />
                      Candidate Resume Evidence ({req.supporting_evidence.length})
                    </span>
                    <div className="space-y-1">
                      {req.supporting_evidence.map((quote, qIdx) => (
                        <div
                          key={qIdx}
                          className="p-2 rounded-lg bg-[#141414] border border-emerald-500/20 text-[11px] text-emerald-200 font-mono leading-relaxed"
                        >
                          "{quote}"
                        </div>
                      ))}
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
