import React, { useState } from "react";
import {
  FileText,
  CheckCircle2,
  Sparkles,
} from "lucide-react";
import {
  ResumeSectionAnalysisItem,
  BulletAuditItem,
} from "../../../types/scanner";
import { TailoredResumeDTO } from "../../resume/ResumeStudioModal";

interface ResumeEvidenceViewProps {
  sections: ResumeSectionAnalysisItem[];
  bulletAudits?: BulletAuditItem[];
  resumeData?: TailoredResumeDTO | null;
}

export const ResumeEvidenceView: React.FC<ResumeEvidenceViewProps> = ({
  sections = [],
  bulletAudits = [],
}) => {
  const [selectedSectionIdx, setSelectedSectionIdx] = useState<number>(0);
  const [selectedBulletIdx, setSelectedBulletIdx] = useState<number>(0);

  const selectedSection = sections[selectedSectionIdx] || sections[0];
  const selectedBullet = bulletAudits[selectedBulletIdx] || bulletAudits[0];

  return (
    <div className="h-full flex flex-col space-y-4" data-testid="resume-evidence-view">
      {/* SECTION PILLS NAV */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1 shrink-0">
        {sections.length > 0 ? (
          sections.map((sec, idx) => (
            <button
              key={idx}
              type="button"
              onClick={() => {
                setSelectedSectionIdx(idx);
                setSelectedBulletIdx(0);
              }}
              className={`px-3 py-1.5 rounded-xl text-xs font-semibold capitalize transition-all cursor-pointer flex items-center gap-1.5 shrink-0 border ${
                selectedSectionIdx === idx
                  ? "bg-white text-black font-bold border-white shadow-sm"
                  : "bg-[#161616] text-neutral-400 border-white/10 hover:text-white"
              }`}
            >
              <FileText className="w-3.5 h-3.5" />
              <span>{sec.section_name}</span>
            </button>
          ))
        ) : (
          <span className="text-xs text-neutral-400">All standard resume sections evaluated.</span>
        )}
      </div>

      {/* TWO-PANEL EVIDENCE WORKSPACE (REFERENCE IMAGE 13) */}
      <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-12 gap-4 overflow-hidden">
        {/* LEFT PANEL: RESUME ENTRIES & STATEMENTS (5 cols) */}
        <div className="lg:col-span-5 flex flex-col bg-[#161616] border border-white/10 rounded-2xl overflow-hidden">
          <div className="p-3 border-b border-white/5 bg-[#141414] text-[11px] font-mono text-neutral-400 uppercase tracking-wider flex items-center justify-between">
            <span>
              {selectedSection ? `${selectedSection.section_name} Entries` : "Resume Evidence"}
            </span>
            <span>Select to Inspect</span>
          </div>

          <div className="flex-1 overflow-y-auto p-2 space-y-2">
            {bulletAudits.length > 0 ? (
              bulletAudits.map((bullet, idx) => {
                const isSelected = selectedBulletIdx === idx;
                return (
                  <div
                    key={idx}
                    onClick={() => setSelectedBulletIdx(idx)}
                    className={`p-3 rounded-xl border transition-all cursor-pointer text-xs space-y-1.5 ${
                      isSelected
                        ? "bg-[#222222] border-emerald-500/40 shadow-sm"
                        : "bg-[#111111] border-white/5 hover:border-white/15"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-mono uppercase tracking-wider text-neutral-400">
                        {bullet.section || bullet.role_or_project || "Experience"}
                      </span>
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold ${
                          bullet.score >= 80
                            ? "bg-emerald-500/10 text-emerald-400"
                            : bullet.score >= 65
                            ? "bg-amber-500/10 text-amber-400"
                            : "bg-rose-500/10 text-rose-400"
                        }`}
                      >
                        {bullet.score} / 100
                      </span>
                    </div>

                    <p className={`line-clamp-2 leading-relaxed ${isSelected ? "text-white font-medium" : "text-neutral-300"}`}>
                      {bullet.text}
                    </p>
                  </div>
                );
              })
            ) : selectedSection ? (
              <div className="p-4 space-y-3">
                <div className="p-3.5 rounded-xl bg-[#111111] border border-white/5 space-y-2">
                  <h4 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                    <span>Evidence Findings</span>
                  </h4>
                  <ul className="text-xs text-neutral-300 space-y-1.5 pl-4 list-disc">
                    {selectedSection.findings.map((finding, fIdx) => (
                      <li key={fIdx} className="leading-relaxed">{finding}</li>
                    ))}
                  </ul>
                </div>
              </div>
            ) : (
              <div className="p-8 text-center text-xs text-neutral-400">
                No section evidence entries available for inspection.
              </div>
            )}
          </div>
        </div>

        {/* RIGHT PANEL: FORENSIC RUBRIC ASSESSMENT (7 cols) */}
        <div className="lg:col-span-7 flex flex-col bg-[#161616] border border-white/10 rounded-2xl overflow-hidden">
          <div className="flex-1 overflow-y-auto p-5 space-y-5">
            {selectedBullet ? (
              <>
                {/* BULLET TEXT HERO */}
                <div className="space-y-2 border-b border-white/10 pb-4">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-mono uppercase tracking-wider text-neutral-400">
                      Statement Evaluated
                    </span>
                    <span className="text-xs font-mono font-bold text-emerald-400">
                      Score: {bulletAudits[selectedBulletIdx]?.score ?? 85} / 100
                    </span>
                  </div>
                  <p className="text-sm font-medium text-white leading-relaxed">
                    "{selectedBullet.text}"
                  </p>
                </div>

                {/* SECTION-LEVEL EVIDENCE FINDINGS */}
                {selectedSection && selectedSection.findings && selectedSection.findings.length > 0 && (
                  <div className="p-3.5 rounded-xl bg-[#111111] border border-white/5 space-y-2">
                    <h4 className="text-xs font-bold text-emerald-400 uppercase tracking-wider flex items-center gap-1.5">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>{selectedSection.section_name} Evidence Findings</span>
                    </h4>
                    <ul className="text-xs text-neutral-300 space-y-1.5 pl-4 list-disc">
                      {selectedSection.findings.map((finding, idx) => (
                        <li key={idx} className="leading-relaxed">{finding}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* 4-DIMENSION RUBRIC BREAKDOWN (REFERENCE IMAGE 13) */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="p-3.5 rounded-xl bg-[#111111] border border-white/5 space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-neutral-400">Action Verb Power</span>
                      <span className="font-mono text-emerald-400 font-bold">
                        {selectedBullet.rubric_breakdown?.action_scope_score ?? 20} / 25
                      </span>
                    </div>
                    <p className="text-[11px] text-neutral-300">
                      Verb: <span className="text-white font-mono">{selectedBullet.verb || "Direct Action"}</span>
                    </p>
                  </div>

                  <div className="p-3.5 rounded-xl bg-[#111111] border border-white/5 space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-neutral-400">Quantified Metric</span>
                      <span className="font-mono text-emerald-400 font-bold">
                        {selectedBullet.rubric_breakdown?.technical_substance_score ?? 20} / 25
                      </span>
                    </div>
                    <p className="text-[11px] text-neutral-300">
                      Metric: <span className="text-white font-mono">{selectedBullet.has_metric ? "Verified Impact Metric" : "Descriptive"}</span>
                    </p>
                  </div>

                  <div className="p-3.5 rounded-xl bg-[#111111] border border-white/5 space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-neutral-400">Technical Context</span>
                      <span className="font-mono text-emerald-400 font-bold">
                        {selectedBullet.rubric_breakdown?.job_relevance_score ?? 20} / 25
                      </span>
                    </div>
                    <p className="text-[11px] text-neutral-300">Domain Taxonomy Alignment</p>
                  </div>

                  <div className="p-3.5 rounded-xl bg-[#111111] border border-white/5 space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-neutral-400">Brevity & Focus</span>
                      <span className="font-mono text-emerald-400 font-bold">
                        {selectedBullet.rubric_breakdown?.outcome_credibility_score ?? 20} / 25
                      </span>
                    </div>
                    <p className="text-[11px] text-neutral-300">Concise ATS Presentation</p>
                  </div>
                </div>

                {/* SUGGESTED REFINEMENT */}
                {selectedBullet.suggested_focus && (
                  <div className="p-4 rounded-xl bg-emerald-950/20 border border-emerald-500/30 space-y-2">
                    <div className="flex items-center gap-2 text-xs font-bold text-emerald-400 uppercase tracking-wider">
                      <Sparkles className="w-3.5 h-3.5" />
                      <span>Grounded Narrative Refinement Focus</span>
                    </div>
                    <p className="text-xs text-emerald-100 font-mono leading-relaxed">
                      "{selectedBullet.suggested_focus}"
                    </p>
                  </div>
                )}
              </>
            ) : selectedSection ? (
              <div className="space-y-4">
                <div className="space-y-1 border-b border-white/10 pb-3">
                  <h3 className="text-base font-bold text-white capitalize">
                    {selectedSection.section_name} Evaluation
                  </h3>
                  <p className="text-xs text-neutral-400">
                    Comprehensive ATS section parsing, formatting, and content density analysis.
                  </p>
                </div>

                <div className="p-4 rounded-xl bg-[#111111] border border-white/5 space-y-2">
                  <h4 className="text-xs font-bold text-emerald-400 uppercase tracking-wider flex items-center gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>Evidence-Backed Findings</span>
                  </h4>
                  <ul className="text-xs text-neutral-300 space-y-2 pl-4 list-disc">
                    {selectedSection.findings.map((finding, idx) => (
                      <li key={idx} className="leading-relaxed">{finding}</li>
                    ))}
                  </ul>
                </div>

                {selectedSection.recommendations && selectedSection.recommendations.length > 0 && (
                  <div className="p-4 rounded-xl bg-blue-950/20 border border-blue-500/30 space-y-2">
                    <h4 className="text-xs font-bold text-blue-400 uppercase tracking-wider flex items-center gap-1.5">
                      <Sparkles className="w-3.5 h-3.5" />
                      <span>Section Recommendations</span>
                    </h4>
                    <ul className="text-xs text-blue-100 space-y-1.5 pl-4 list-disc">
                      {selectedSection.recommendations.map((rec, idx) => (
                        <li key={idx} className="leading-relaxed">{rec}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            ) : (
              <div className="p-8 text-center text-xs text-neutral-400">
                Select an evidence entry to view forensic breakdown.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ResumeEvidenceView;
