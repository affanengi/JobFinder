import React, { useState } from "react";
import {
  Search,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Quote,
  HelpCircle,
  Sparkles,
} from "lucide-react";
import {
  JobRequirementAnalysisItem,
  RequirementCriticality,
  RequirementMatchStatus,
} from "../../../types/scanner";

interface JobMatchExplorerViewProps {
  requirements: JobRequirementAnalysisItem[];
  jobTitle?: string;
  jobCompany?: string;
}

export const JobMatchExplorerView: React.FC<JobMatchExplorerViewProps> = ({
  requirements = [],
  jobTitle = "Target Opportunity",
  jobCompany,
}) => {
  const [searchQuery, setSearchQuery] = useState("");
  const [criticalityFilter, setCriticalityFilter] = useState<"all" | RequirementCriticality>("all");
  const [statusFilter, setStatusFilter] = useState<"all" | RequirementMatchStatus>("all");
  const [selectedIndex, setSelectedIndex] = useState<number>(0);

  const normalizedRequirements = requirements.map((r: any) => ({
    requirement_description: r.requirement_description || r.text || "",
    criticality: (r.criticality || "preferred") as RequirementCriticality,
    match_status: (
      r.match_status === "MEETS" || r.status === "fully_met"
        ? "MEETS"
        : r.match_status === "PARTIAL" || r.status === "partially_met"
        ? "PARTIAL"
        : "MISSING"
    ) as RequirementMatchStatus,
    supporting_evidence: Array.isArray(r.supporting_evidence)
      ? r.supporting_evidence
      : Array.isArray(r.candidate_evidence)
      ? r.candidate_evidence.map((ce: any) => (typeof ce === "string" ? ce : ce.text || ""))
      : [],
    explanation: r.explanation || "",
    missing_evidence: Boolean(r.missing_evidence || (r.candidate_evidence && r.candidate_evidence.length === 0)),
  }));

  const filteredRequirements = normalizedRequirements.filter((req) => {
    if (criticalityFilter !== "all" && req.criticality !== criticalityFilter) return false;
    if (statusFilter !== "all" && req.match_status !== statusFilter) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const inDesc = req.requirement_description.toLowerCase().includes(q);
      const inExp = req.explanation.toLowerCase().includes(q);
      const inEv = req.supporting_evidence.some((e: string) => e.toLowerCase().includes(q));
      return inDesc || inExp || inEv;
    }
    return true;
  });

  const selectedReq = filteredRequirements[selectedIndex] || filteredRequirements[0] || normalizedRequirements[0];

  const mandatoryCount = normalizedRequirements.filter((r) => r.criticality === "mandatory").length;
  const preferredCount = normalizedRequirements.filter((r) => r.criticality === "preferred" || (r as any).criticality === "bonus").length;
  const meetsCount = normalizedRequirements.filter((r) => r.match_status === "MEETS").length;
  const partialCount = normalizedRequirements.filter((r) => r.match_status === "PARTIAL").length;
  const missingCount = normalizedRequirements.filter((r) => r.match_status === "MISSING").length;

  const getStatusBadge = (status: RequirementMatchStatus) => {
    switch (status) {
      case "MEETS":
        return {
          bg: "bg-emerald-500/15 border-emerald-500/30 text-emerald-300",
          icon: <CheckCircle2 size={13} className="text-emerald-400" />,
          label: "Demonstrated in Evidence",
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
          label: status,
        };
    }
  };

  return (
    <div className="h-full flex flex-col space-y-4" data-testid="job-match-explorer-view">
      {/* TOP METRIC CARDS BAR (REFERENCE IMAGE 14) */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 shrink-0">
        <div className="p-3.5 rounded-xl bg-[#161616] border border-white/10 flex items-center justify-between">
          <div>
            <p className="text-[10px] font-mono uppercase tracking-wider text-neutral-400">Total Specs</p>
            <p className="text-base font-bold text-white font-mono mt-0.5">{requirements.length}</p>
          </div>
          <span className="text-xs font-mono text-neutral-400">
            {mandatoryCount} req / {preferredCount} pref
          </span>
        </div>

        <div className="p-3.5 rounded-xl bg-emerald-950/20 border border-emerald-500/20 flex items-center justify-between">
          <div>
            <p className="text-[10px] font-mono uppercase tracking-wider text-emerald-400">Meets Evidence</p>
            <p className="text-base font-bold text-emerald-300 font-mono mt-0.5">{meetsCount}</p>
          </div>
          <CheckCircle2 className="w-5 h-5 text-emerald-400 opacity-60" />
        </div>

        <div className="p-3.5 rounded-xl bg-amber-950/20 border border-amber-500/20 flex items-center justify-between">
          <div>
            <p className="text-[10px] font-mono uppercase tracking-wider text-amber-400">Partial Fit</p>
            <p className="text-base font-bold text-amber-300 font-mono mt-0.5">{partialCount}</p>
          </div>
          <AlertTriangle className="w-5 h-5 text-amber-400 opacity-60" />
        </div>

        <div className="p-3.5 rounded-xl bg-rose-950/20 border border-rose-500/20 flex items-center justify-between">
          <div>
            <p className="text-[10px] font-mono uppercase tracking-wider text-rose-400">Evidence Gaps</p>
            <p className="text-base font-bold text-rose-300 font-mono mt-0.5">{missingCount}</p>
          </div>
          <XCircle className="w-5 h-5 text-rose-400 opacity-60" />
        </div>
      </div>

      {/* FILTER & SEARCH CONTROLS */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 shrink-0 bg-[#161616] p-3 rounded-xl border border-white/10">
        <div className="relative flex-1 max-w-md">
          <Search className="w-3.5 h-3.5 text-neutral-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search role requirements or candidate evidence..."
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setSelectedIndex(0);
            }}
            className="w-full pl-9 pr-3 py-1.5 rounded-lg bg-[#0D0D0D] border border-white/10 text-xs text-white placeholder-neutral-500 focus:outline-none focus:border-emerald-500/50"
          />
        </div>

        {/* Filter Pills */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <div className="flex items-center bg-[#0D0D0D] p-1 rounded-lg border border-white/10 text-xs">
            <button
              type="button"
              onClick={() => {
                setCriticalityFilter("all");
                setSelectedIndex(0);
              }}
              className={`px-2 py-1 rounded text-[11px] font-medium transition-colors ${
                criticalityFilter === "all" ? "bg-white text-black font-bold" : "text-neutral-400 hover:text-white"
              }`}
            >
              All ({requirements.length})
            </button>
            <button
              type="button"
              onClick={() => {
                setCriticalityFilter("mandatory");
                setSelectedIndex(0);
              }}
              className={`px-2 py-1 rounded text-[11px] font-medium transition-colors ${
                criticalityFilter === "mandatory" ? "bg-white text-black font-bold" : "text-neutral-400 hover:text-white"
              }`}
            >
              Mandatory ({mandatoryCount})
            </button>
            <button
              type="button"
              onClick={() => {
                setCriticalityFilter("preferred");
                setSelectedIndex(0);
              }}
              className={`px-2 py-1 rounded text-[11px] font-medium transition-colors ${
                criticalityFilter === "preferred" ? "bg-white text-black font-bold" : "text-neutral-400 hover:text-white"
              }`}
            >
              Preferred ({preferredCount})
            </button>
          </div>

          <div className="flex items-center bg-[#0D0D0D] p-1 rounded-lg border border-white/10 text-xs">
            <button
              type="button"
              onClick={() => {
                setStatusFilter("all");
                setSelectedIndex(0);
              }}
              className={`px-2 py-1 rounded text-[11px] font-medium transition-colors ${
                statusFilter === "all" ? "bg-neutral-800 text-white" : "text-neutral-400 hover:text-white"
              }`}
            >
              All
            </button>
            <button
              type="button"
              onClick={() => {
                setStatusFilter("MEETS");
                setSelectedIndex(0);
              }}
              className={`px-2 py-1 rounded text-[11px] font-medium transition-colors ${
                statusFilter === "MEETS" ? "bg-emerald-500/20 text-emerald-300 font-bold" : "text-neutral-400 hover:text-emerald-400"
              }`}
            >
              Meets
            </button>
            <button
              type="button"
              onClick={() => {
                setStatusFilter("PARTIAL");
                setSelectedIndex(0);
              }}
              className={`px-2 py-1 rounded text-[11px] font-medium transition-colors ${
                statusFilter === "PARTIAL" ? "bg-amber-500/20 text-amber-300 font-bold" : "text-neutral-400 hover:text-amber-400"
              }`}
            >
              Partial
            </button>
            <button
              type="button"
              onClick={() => {
                setStatusFilter("MISSING");
                setSelectedIndex(0);
              }}
              className={`px-2 py-1 rounded text-[11px] font-medium transition-colors ${
                statusFilter === "MISSING" ? "bg-rose-500/20 text-rose-300 font-bold" : "text-neutral-400 hover:text-rose-400"
              }`}
            >
              Missing
            </button>
          </div>
        </div>
      </div>

      {/* TWO-PANEL WORKSPACE (REFERENCE IMAGE 14) */}
      <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-12 gap-4 overflow-hidden">
        {/* LEFT PANEL: REQUIREMENTS LIST (5 cols) */}
        <div className="lg:col-span-5 flex flex-col bg-[#161616] border border-white/10 rounded-2xl overflow-hidden">
          <div className="p-3 border-b border-white/5 bg-[#141414] text-[11px] font-mono text-neutral-400 uppercase tracking-wider flex items-center justify-between">
            <span>Role Requirements ({filteredRequirements.length})</span>
            <span>Select to Cross-Examine</span>
          </div>

          <div className="flex-1 overflow-y-auto p-2 space-y-2 divide-y divide-transparent">
            {filteredRequirements.length === 0 ? (
              <div className="p-8 text-center text-xs text-neutral-400">
                No job requirements matched the search or filter query.
              </div>
            ) : (
              filteredRequirements.map((req, idx) => {
                const isSelected = selectedReq === req;
                const statusInfo = getStatusBadge(req.match_status);
                return (
                  <div
                    key={idx}
                    onClick={() => setSelectedIndex(idx)}
                    className={`p-3 rounded-xl border transition-all cursor-pointer text-xs space-y-1.5 ${
                      isSelected
                        ? "bg-[#222222] border-emerald-500/40 shadow-sm"
                        : "bg-[#111111] border-white/5 hover:border-white/15"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span
                        className={`px-1.5 py-0.5 rounded text-[10px] font-mono uppercase font-bold tracking-wider ${
                          req.criticality === "mandatory"
                            ? "bg-rose-500/10 text-rose-300 border border-rose-500/20"
                            : "bg-teal-500/10 text-teal-300 border border-teal-500/20"
                        }`}
                      >
                        {req.criticality}
                      </span>
                      <span className={`inline-flex items-center gap-1 text-[10px] font-mono px-2 py-0.5 rounded ${statusInfo.bg}`}>
                        {statusInfo.icon}
                        <span>{req.match_status}</span>
                      </span>
                    </div>

                    <p className={`line-clamp-2 leading-relaxed ${isSelected ? "text-white font-medium" : "text-neutral-300"}`}>
                      {req.requirement_description}
                    </p>

                    <div className="flex items-center gap-1 text-[10px] text-neutral-400 font-mono">
                      <span>Evidence:</span>
                      <span className="text-neutral-300">{req.supporting_evidence.length} cited quote(s)</span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* RIGHT PANEL: REQUIREMENT EVIDENCE & CROSS-EXAMINATION DETAIL (7 cols) */}
        <div className="lg:col-span-7 flex flex-col bg-[#161616] border border-white/10 rounded-2xl overflow-hidden">
          {selectedReq ? (
            <div className="flex-1 overflow-y-auto p-5 space-y-5">
              {/* HEADER WITH REQUIREMENT DESCRIPTION */}
              <div className="space-y-2 border-b border-white/10 pb-4">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="flex items-center gap-2">
                    <span
                      className={`px-2.5 py-0.5 rounded-full text-xs font-mono font-bold uppercase tracking-wider ${
                        selectedReq.criticality === "mandatory"
                          ? "bg-rose-500/10 text-rose-300 border border-rose-500/30"
                          : "bg-teal-500/10 text-teal-300 border border-teal-500/30"
                      }`}
                    >
                      {selectedReq.criticality} Requirement
                    </span>
                    <span className="text-xs text-neutral-400 font-mono">
                      {jobCompany ? `@${jobCompany}` : jobTitle}
                    </span>
                  </div>

                  <span
                    className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-mono font-bold border ${
                      getStatusBadge(selectedReq.match_status).bg
                    }`}
                  >
                    {getStatusBadge(selectedReq.match_status).icon}
                    <span>{getStatusBadge(selectedReq.match_status).label}</span>
                  </span>
                </div>

                <h3 className="text-sm sm:text-base font-bold text-white leading-relaxed">
                  "{selectedReq.requirement_description}"
                </h3>
              </div>

              {/* REASONING & ALIGNMENT EXPLANATION */}
              <div className="p-4 rounded-xl bg-[#111111] border border-white/5 space-y-1.5">
                <p className="text-[10px] font-mono uppercase tracking-wider text-neutral-400 flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
                  <span>AI Match Assessment</span>
                </p>
                <p className="text-xs text-neutral-200 leading-relaxed">
                  {selectedReq.explanation}
                </p>
              </div>

              {/* CORROBORATED CANDIDATE EVIDENCE CITATIONS */}
              <div className="space-y-3">
                <p className="text-xs font-bold text-white uppercase tracking-wider flex items-center justify-between">
                  <span className="flex items-center gap-2">
                    <Quote className="w-4 h-4 text-emerald-400" />
                    <span>Corroborated Candidate Evidence ({selectedReq.supporting_evidence.length})</span>
                  </span>
                  <span className="text-[10px] font-mono text-neutral-400">Chronological Quotes</span>
                </p>

                {selectedReq.supporting_evidence.length === 0 ? (
                  <div className="p-5 rounded-xl bg-rose-950/20 border border-rose-500/20 text-xs text-rose-300 space-y-1">
                    <p className="font-bold flex items-center gap-1.5">
                      <AlertTriangle className="w-3.5 h-3.5 text-rose-400" />
                      <span>Zero Supporting Evidence Citations Found</span>
                    </p>
                    <p className="text-[11px] text-rose-200/80 leading-relaxed">
                      No direct statement or achievement in the submitted resume demonstrates this required capability.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2.5">
                    {selectedReq.supporting_evidence.map((quote: string, qIdx: number) => (
                      <div
                        key={qIdx}
                        className="p-3.5 rounded-xl bg-[#0D0D0D] border border-emerald-500/20 text-xs text-neutral-200 space-y-1 relative"
                      >
                        <p className="text-xs italic font-serif leading-relaxed text-emerald-200">
                          "{quote}"
                        </p>
                        <div className="flex items-center gap-1.5 text-[10px] font-mono text-neutral-400 pt-1">
                          <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                          <span>Direct quote from candidate resume</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* MISSING EVIDENCE GAP CALLOUT */}
              {selectedReq.missing_evidence && (
                <div className="p-4 rounded-xl bg-amber-950/20 border border-amber-500/30 text-xs text-amber-200 space-y-1.5">
                  <p className="font-bold text-amber-300 flex items-center gap-1.5">
                    <AlertTriangle className="w-4 h-4 text-amber-400" />
                    <span>Evidence Gap Identified</span>
                  </p>
                  <p className="text-xs text-amber-100/90 leading-relaxed">
                    While candidate background touches related competencies, this specific qualification is not explicitly corroborated with quantified achievements or metrics.
                  </p>
                </div>
              )}
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center p-8 text-neutral-500 text-xs">
              Select a requirement on the left to inspect evidence.
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default JobMatchExplorerView;
