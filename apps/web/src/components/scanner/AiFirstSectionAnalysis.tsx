import React, { useState } from "react";
import {
  FileText,
  CheckCircle2,
  AlertCircle,
  Lightbulb,
  ChevronDown,
  ChevronUp,
  Quote,
} from "lucide-react";
import { ResumeSectionAnalysisItem } from "../../types/scanner";

interface AiFirstSectionAnalysisProps {
  sections: ResumeSectionAnalysisItem[];
}

export const AiFirstSectionAnalysis: React.FC<AiFirstSectionAnalysisProps> = ({
  sections = [],
}) => {
  const [expandedSection, setExpandedSection] = useState<string | null>(
    sections.length > 0 ? sections[0].section_name : null
  );

  const toggleSection = (name: string) => {
    setExpandedSection(expandedSection === name ? null : name);
  };

  return (
    <div
      className="bg-[#141414] border border-white/15 rounded-2xl p-6 space-y-5 shadow-sm"
      data-testid="ai-section-analysis"
    >
      <div className="border-b border-white/10 pb-4">
        <h3 className="text-sm font-bold uppercase tracking-wider text-white flex items-center gap-2">
          <span>Resume Section Evaluation</span>
          <span className="text-xs text-neutral-400 font-mono font-normal">
            ({sections.length} sections analyzed)
          </span>
        </h3>
        <p className="text-xs text-neutral-400 mt-0.5">
          Comprehensive review of sections present in the resume. Identifies grounded strengths, evidence gaps, and actionable enhancements.
        </p>
      </div>

      {sections.length === 0 ? (
        <div className="p-8 rounded-xl bg-[#0D0D0D] border border-white/5 text-center text-xs text-neutral-400">
          No section analysis data available for this scan.
        </div>
      ) : (
        <div className="space-y-3">
          {sections.map((sec, idx) => {
            const isExpanded = expandedSection === sec.section_name;
            const hasGaps = sec.gaps && sec.gaps.length > 0;

            return (
              <div
                key={idx}
                className="rounded-xl border border-white/10 bg-[#0D0D0D] overflow-hidden transition-all"
              >
                {/* SECTION HEADER ROW */}
                <button
                  onClick={() => toggleSection(sec.section_name)}
                  className="w-full p-4 flex items-center justify-between text-left hover:bg-white/[0.02] transition-colors cursor-pointer"
                >
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-400">
                      <FileText size={16} />
                    </div>
                    <div>
                      <h4 className="text-xs font-bold text-white uppercase tracking-wider">
                        {sec.section_name}
                      </h4>
                      <p className="text-[11px] text-neutral-400">
                        {sec.findings?.length || 0} strengths • {sec.gaps?.length || 0} gaps • {sec.recommendations?.length || 0} recommendations
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    {hasGaps && (
                      <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-amber-500/10 border border-amber-500/30 text-amber-400">
                        Attention Recommended
                      </span>
                    )}
                    {isExpanded ? <ChevronUp size={16} className="text-neutral-400" /> : <ChevronDown size={16} className="text-neutral-400" />}
                  </div>
                </button>

                {/* EXPANDED CONTENT */}
                {isExpanded && (
                  <div className="p-4 pt-0 border-t border-white/5 space-y-4 animate-fade-in text-xs">
                    {/* FINDINGS */}
                    {sec.findings && sec.findings.length > 0 && (
                      <div className="space-y-1.5 pt-3">
                        <span className="text-[10px] font-mono uppercase tracking-wider text-emerald-400 font-bold flex items-center gap-1.5">
                          <CheckCircle2 size={12} /> Key Strengths & Substantive Observations
                        </span>
                        <ul className="space-y-1 pl-4 list-disc text-neutral-300">
                          {sec.findings.map((f, fIdx) => (
                            <li key={fIdx} className="leading-relaxed">
                              {f}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* SUPPORTING EVIDENCE QUOTES */}
                    {sec.supporting_evidence && sec.supporting_evidence.length > 0 && (
                      <div className="space-y-1.5 pt-1">
                        <span className="text-[10px] font-mono uppercase tracking-wider text-neutral-400 font-bold flex items-center gap-1.5">
                          <Quote size={11} className="text-neutral-400" /> Cited Evidence From Section
                        </span>
                        <div className="space-y-1">
                          {sec.supporting_evidence.map((quote, qIdx) => (
                            <div
                              key={qIdx}
                              className="p-2 rounded-lg bg-[#141414] border border-white/5 text-[11px] text-neutral-300 font-mono italic"
                            >
                              "{quote}"
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* GAPS */}
                    {sec.gaps && sec.gaps.length > 0 && (
                      <div className="space-y-1.5 pt-1">
                        <span className="text-[10px] font-mono uppercase tracking-wider text-amber-400 font-bold flex items-center gap-1.5">
                          <AlertCircle size={12} /> Presentation & Evidence Deficiencies
                        </span>
                        <ul className="space-y-1 pl-4 list-disc text-amber-200/90">
                          {sec.gaps.map((g, gIdx) => (
                            <li key={gIdx} className="leading-relaxed">
                              {g}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* RECOMMENDATIONS */}
                    {sec.recommendations && sec.recommendations.length > 0 && (
                      <div className="space-y-1.5 pt-1">
                        <span className="text-[10px] font-mono uppercase tracking-wider text-blue-400 font-bold flex items-center gap-1.5">
                          <Lightbulb size={12} /> Actionable Grounded Improvements
                        </span>
                        <ul className="space-y-1 pl-4 list-disc text-blue-200/90">
                          {sec.recommendations.map((r, rIdx) => (
                            <li key={rIdx} className="leading-relaxed">
                              {r}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
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
