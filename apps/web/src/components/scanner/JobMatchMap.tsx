import React, { useState } from "react";
import {
  CheckCircle2,
  AlertTriangle,
  XCircle,
  HelpCircle,
  Search,
  ExternalLink,
  Info,
  ChevronRight,
  FileText,
  Layers,
} from "lucide-react";
import { JobRequirementMatchItem, KeywordMatrix } from "../../types/scanner";

interface JobMatchMapProps {
  requirements: JobRequirementMatchItem[];
  keywordMatrix?: KeywordMatrix;
  selectedRequirementId?: string | null;
  onSelectRequirement?: (reqId: string) => void;
  onFocusBulletInAnalysis?: (bulletId: string) => void;
}

export const JobMatchMap: React.FC<JobMatchMapProps> = ({
  requirements = [],
  keywordMatrix,
  selectedRequirementId,
  onSelectRequirement,
  onFocusBulletInAnalysis,
}) => {
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [importanceFilter, setImportanceFilter] = useState<"all" | "mandatory" | "preferred">("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [internalSelectedId, setInternalSelectedId] = useState<string | null>(
    selectedRequirementId || (requirements.length > 0 ? requirements[0].id : null)
  );

  const activeSelectedId = selectedRequirementId ?? internalSelectedId;

  const handleSelect = (id: string) => {
    setInternalSelectedId(id);
    if (onSelectRequirement) {
      onSelectRequirement(id);
    }
  };

  const filteredRequirements = requirements.filter((req) => {
    if (importanceFilter === "mandatory" && !req.is_mandatory) return false;
    if (importanceFilter === "preferred" && req.is_mandatory) return false;
    if (statusFilter !== "all" && req.evidence_status !== statusFilter) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const inName = req.name.toLowerCase().includes(q);
      const inCat = (req.category || "").toLowerCase().includes(q);
      const inDesc = (req.description || "").toLowerCase().includes(q);
      return inName || inCat || inDesc;
    }
    return true;
  });

  const mandatoryList = filteredRequirements.filter((r) => r.is_mandatory);
  const preferredList = filteredRequirements.filter((r) => !r.is_mandatory);

  const selectedReq = requirements.find((r) => r.id === activeSelectedId) || requirements[0];

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "demonstrated":
        return {
          bg: "bg-emerald-500/15 border-emerald-500/30 text-emerald-300",
          icon: <CheckCircle2 size={12} className="text-emerald-400" />,
          label: "Demonstrated",
        };
      case "listed":
        return {
          bg: "bg-amber-500/15 border-amber-500/30 text-amber-300",
          icon: <AlertTriangle size={12} className="text-amber-400" />,
          label: "Listed",
        };
      case "missing":
        return {
          bg: "bg-rose-500/15 border-rose-500/30 text-rose-300",
          icon: <XCircle size={12} className="text-rose-400" />,
          label: "Missing in Resume",
        };
      default:
        return {
          bg: "bg-neutral-800 border-neutral-700 text-neutral-300",
          icon: <HelpCircle size={12} className="text-neutral-400" />,
          label: "Unverified",
        };
    }
  };

  // If no requirement matches exist (Legacy Report fallback)
  if (requirements.length === 0) {
    return (
      <div className="bg-[#141414] border border-white/15 rounded-2xl p-6 space-y-6 shadow-sm" data-testid="job-match-map-legacy">
        <div className="p-4 rounded-xl bg-[#0D0D0D] border border-amber-500/20 text-xs text-amber-300 flex items-start gap-3">
          <Info className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <span className="font-bold block">Legacy Report Format</span>
            <p className="text-neutral-300">
              Interactive Job Match Map evidence links are not present in this historical report. Standard taxonomy keyword matches are shown below.
            </p>
          </div>
        </div>

        {keywordMatrix && (
          <div className="space-y-4">
            <h4 className="text-xs font-bold uppercase tracking-wider text-white">
              Matched Taxonomy Keywords ({keywordMatrix.matched_count})
            </h4>
            <div className="flex flex-wrap gap-2">
              {keywordMatrix.matched.map((kw) => (
                <span
                  key={kw.id}
                  className="px-3 py-1 rounded-xl text-xs bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 font-medium"
                >
                  {kw.name} ({kw.category.replace(/_/g, " ")})
                </span>
              ))}
            </div>

            {keywordMatrix.missing.length > 0 && (
              <>
                <h4 className="text-xs font-bold uppercase tracking-wider text-white pt-2">
                  Missing Target Keywords ({keywordMatrix.missing_count})
                </h4>
                <div className="flex flex-wrap gap-2">
                  {keywordMatrix.missing.map((kw) => (
                    <span
                      key={kw.id}
                      className="px-3 py-1 rounded-xl text-xs bg-rose-500/10 border border-rose-500/30 text-rose-300 font-medium"
                    >
                      {kw.name}
                    </span>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="bg-[#141414] border border-white/15 rounded-2xl p-5 sm:p-6 space-y-5 shadow-sm" data-testid="job-match-map">
      {/* HEADER & CANDIDATE TRANSPARENCY NOTICE */}
      <div className="space-y-3 border-b border-white/10 pb-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Layers className="w-4 h-4 text-emerald-400" />
              <h3 className="text-xs font-bold uppercase tracking-wider text-white">
                Interactive Job Description Match Map
              </h3>
            </div>
            <p className="text-xs text-neutral-400">
              Trace target job requirements directly to verified resume evidence with 4-state proof grading.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-[11px] font-mono text-neutral-400">
              {mandatoryList.length} Mandatory • {preferredList.length} Preferred
            </span>
          </div>
        </div>

        {/* CANDIDATE SKILL VS RESUME MENTION CLARIFICATION */}
        <div className="p-3 bg-[#0D0D0D] border border-white/10 rounded-xl text-[11px] text-neutral-400 flex items-center gap-2.5">
          <Info size={14} className="text-emerald-400 shrink-0" />
          <span>
            <strong>Evaluation Integrity:</strong> A status of{" "}
            <em className="text-rose-400 font-mono">Missing in Resume</em> does not mean you lack the competency in your career. It simply indicates that no explicit supporting evidence was found in this targeted resume version.
          </span>
        </div>
      </div>

      {/* FILTER & SEARCH TOOLBAR */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-[#0D0D0D] p-2 rounded-xl border border-white/10 text-xs">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={14} className="absolute left-3 top-2.5 text-neutral-500" />
          <input
            type="text"
            placeholder="Search requirements or competencies..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-[#141414] border border-white/10 rounded-lg pl-8 pr-3 py-1.5 text-xs text-white placeholder-neutral-500 focus:outline-none focus:border-emerald-400"
          />
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center bg-[#141414] p-0.5 rounded-lg border border-white/10 text-[11px]">
            <button
              onClick={() => setImportanceFilter("all")}
              className={`px-2.5 py-1 rounded-md transition-colors cursor-pointer ${
                importanceFilter === "all" ? "bg-[#242424] text-white font-bold" : "text-neutral-400 hover:text-white"
              }`}
            >
              All Requirements
            </button>
            <button
              onClick={() => setImportanceFilter("mandatory")}
              className={`px-2.5 py-1 rounded-md transition-colors cursor-pointer ${
                importanceFilter === "mandatory" ? "bg-[#242424] text-white font-bold" : "text-neutral-400 hover:text-white"
              }`}
            >
              Mandatory
            </button>
            <button
              onClick={() => setImportanceFilter("preferred")}
              className={`px-2.5 py-1 rounded-md transition-colors cursor-pointer ${
                importanceFilter === "preferred" ? "bg-[#242424] text-white font-bold" : "text-neutral-400 hover:text-white"
              }`}
            >
              Preferred
            </button>
          </div>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="bg-[#141414] border border-white/10 rounded-lg px-2.5 py-1.5 text-[11px] text-white focus:outline-none focus:border-emerald-400"
          >
            <option value="all">All Evidence States</option>
            <option value="demonstrated">Demonstrated</option>
            <option value="listed">Listed</option>
            <option value="missing">Missing in Resume</option>
            <option value="unverified">Unverified</option>
          </select>
        </div>
      </div>

      {/* TWO-COLUMN LAYOUT (DESKTOP) / VERTICALLY STACKED (MOBILE) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* LEFT COLUMN: REQUIREMENTS LIST (5 cols) */}
        <div className="lg:col-span-5 space-y-4 max-h-[600px] overflow-y-auto pr-1">
          {/* Mandatory Group */}
          {mandatoryList.length > 0 && (
            <div className="space-y-2">
              <div className="text-[10px] font-mono uppercase tracking-wider text-neutral-400 font-bold px-1">
                Mandatory Requirements ({mandatoryList.length})
              </div>
              <div className="space-y-1.5">
                {mandatoryList.map((req) => {
                  const statusInfo = getStatusBadge(req.evidence_status);
                  const isSelected = selectedReq?.id === req.id;

                  return (
                    <div
                      key={req.id}
                      onClick={() => handleSelect(req.id)}
                      className={`p-3 rounded-xl border transition-all cursor-pointer ${
                        isSelected
                          ? "bg-[#1C1C1C] border-emerald-500/50 shadow-md ring-1 ring-emerald-500/30"
                          : "bg-[#0D0D0D] border-white/10 hover:border-white/20"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="space-y-1 min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-bold text-white truncate">
                              {req.name}
                            </span>
                          </div>
                          {req.category && (
                            <span className="text-[10px] font-mono text-neutral-400 block truncate">
                              {req.category.replace(/_/g, " ")}
                            </span>
                          )}
                        </div>

                        <div className="flex items-center gap-1.5 shrink-0">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold border flex items-center gap-1 ${statusInfo.bg}`}
                          >
                            {statusInfo.icon}
                            <span>{statusInfo.label}</span>
                          </span>
                          <ChevronRight
                            size={14}
                            className={`transition-colors ${
                              isSelected ? "text-emerald-400" : "text-neutral-600"
                            }`}
                          />
                        </div>
                      </div>

                      <div className="mt-2 flex items-center justify-between text-[10px] text-neutral-400 font-mono">
                        <span>
                          {req.linked_evidence.length}{" "}
                          {req.linked_evidence.length === 1 ? "bullet link" : "bullet links"}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Preferred Group */}
          {preferredList.length > 0 && (
            <div className="space-y-2 pt-2">
              <div className="text-[10px] font-mono uppercase tracking-wider text-neutral-400 font-bold px-1">
                Preferred / Bonus ({preferredList.length})
              </div>
              <div className="space-y-1.5">
                {preferredList.map((req) => {
                  const statusInfo = getStatusBadge(req.evidence_status);
                  const isSelected = selectedReq?.id === req.id;

                  return (
                    <div
                      key={req.id}
                      onClick={() => handleSelect(req.id)}
                      className={`p-3 rounded-xl border transition-all cursor-pointer ${
                        isSelected
                          ? "bg-[#1C1C1C] border-emerald-500/50 shadow-md ring-1 ring-emerald-500/30"
                          : "bg-[#0D0D0D] border-white/10 hover:border-white/20"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="space-y-1 min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-bold text-white truncate">
                              {req.name}
                            </span>
                          </div>
                          {req.category && (
                            <span className="text-[10px] font-mono text-neutral-400 block truncate">
                              {req.category.replace(/_/g, " ")}
                            </span>
                          )}
                        </div>

                        <div className="flex items-center gap-1.5 shrink-0">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold border flex items-center gap-1 ${statusInfo.bg}`}
                          >
                            {statusInfo.icon}
                            <span>{statusInfo.label}</span>
                          </span>
                          <ChevronRight
                            size={14}
                            className={`transition-colors ${
                              isSelected ? "text-emerald-400" : "text-neutral-600"
                            }`}
                          />
                        </div>
                      </div>

                      <div className="mt-2 flex items-center justify-between text-[10px] text-neutral-400 font-mono">
                        <span>
                          {req.linked_evidence.length}{" "}
                          {req.linked_evidence.length === 1 ? "bullet link" : "bullet links"}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {filteredRequirements.length === 0 && (
            <div className="p-8 text-center bg-[#0D0D0D] rounded-xl border border-white/5 text-xs text-neutral-400">
              No requirements match current filter.
            </div>
          )}
        </div>

        {/* RIGHT COLUMN: SELECTED REQUIREMENT EVIDENCE DETAILS (7 cols) */}
        <div className="lg:col-span-7">
          {selectedReq ? (
            <div className="bg-[#0D0D0D] border border-white/10 rounded-xl p-5 space-y-4">
              {/* DETAIL HEADER */}
              <div className="space-y-2 border-b border-white/10 pb-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase border ${
                        selectedReq.is_mandatory
                          ? "bg-rose-500/10 border-rose-500/30 text-rose-300"
                          : "bg-violet-500/10 border-violet-500/30 text-violet-300"
                      }`}
                    >
                      {selectedReq.is_mandatory ? "Mandatory Qualification" : "Preferred Qualification"}
                    </span>
                    {selectedReq.category && (
                      <span className="px-2 py-0.5 rounded text-[10px] font-mono text-neutral-400 bg-[#1A1A1A] border border-white/5">
                        {selectedReq.category.replace(/_/g, " ")}
                      </span>
                    )}
                  </div>

                  <span
                    className={`px-2.5 py-0.5 rounded text-xs font-mono font-bold border flex items-center gap-1.5 ${
                      getStatusBadge(selectedReq.evidence_status).bg
                    }`}
                  >
                    {getStatusBadge(selectedReq.evidence_status).icon}
                    <span>{getStatusBadge(selectedReq.evidence_status).label}</span>
                  </span>
                </div>

                <h4 className="text-base font-bold text-white">{selectedReq.name}</h4>
                {selectedReq.description && (
                  <p className="text-xs text-neutral-300 leading-relaxed">
                    {selectedReq.description}
                  </p>
                )}
                {selectedReq.explanation && (
                  <p className="text-[11px] text-neutral-400 italic">
                    {selectedReq.explanation}
                  </p>
                )}
              </div>

              {/* LINKED RESUME EVIDENCE CARDS */}
              <div className="space-y-3">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-bold uppercase tracking-wider text-neutral-300">
                    Supporting Resume Evidence ({selectedReq.linked_evidence.length})
                  </span>
                </div>

                {selectedReq.linked_evidence.length === 0 ? (
                  <div className="p-6 bg-[#141414] rounded-xl border border-white/5 text-center space-y-2">
                    <XCircle className="w-6 h-6 text-neutral-500 mx-auto" />
                    <div className="text-xs font-bold text-neutral-300">
                      No explicit evidence detected in current resume
                    </div>
                    <p className="text-[11px] text-neutral-400 max-w-sm mx-auto">
                      If you possess this competency, consider adding a targeted bullet in your experience or projects demonstrating hands-on application.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2.5">
                    {selectedReq.linked_evidence.map((ev, idx) => (
                      <div
                        key={idx}
                        className="p-3.5 bg-[#141414] border border-white/10 rounded-xl space-y-2"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <FileText size={12} className="text-emerald-400 shrink-0" />
                            <span className="text-[10px] font-mono text-neutral-400 uppercase">
                              {ev.section || "Experience"}
                              {ev.role_or_project ? ` • ${ev.role_or_project}` : ""}
                            </span>
                          </div>

                          {/* CROSS-NAVIGATION BUTTON */}
                          {onFocusBulletInAnalysis && (
                            <button
                              onClick={() => onFocusBulletInAnalysis(ev.bullet_id)}
                              className="text-[11px] font-semibold text-emerald-400 hover:text-emerald-300 flex items-center gap-1 transition-colors cursor-pointer group"
                              title="Jump to this bullet in Bullet Analysis"
                            >
                              <span>Focus Bullet</span>
                              <ExternalLink size={10} className="group-hover:translate-x-0.5 transition-transform" />
                            </button>
                          )}
                        </div>

                        <p className="text-xs text-neutral-200 leading-relaxed italic bg-[#0A0A0A] p-2.5 rounded-lg border border-white/5">
                          "{ev.quote}"
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="p-12 text-center bg-[#0D0D0D] rounded-xl border border-white/5 text-xs text-neutral-400">
              Select a requirement on the left to inspect linked resume evidence.
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
