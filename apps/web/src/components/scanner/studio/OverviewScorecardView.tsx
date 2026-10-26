import React from "react";
import {
  Sparkles,
  CheckCircle2,
  AlertTriangle,
  CheckSquare,
} from "lucide-react";
import { RadialScoreGauge } from "../ExecutiveSummaryDashboard";
import { ChecklistItem } from "../../../types/scanner";

interface OverviewScorecardViewProps {
  overallScore: number;
  overallExplanation?: string;
  executiveSummary?: string;
  strengths?: string[];
  gaps?: string[];
  recommendations?: string[];
  checklistItems?: ChecklistItem[];
  isHistorical?: boolean;
}

export const OverviewScorecardView: React.FC<OverviewScorecardViewProps> = ({
  overallScore,
  overallExplanation,
  executiveSummary,
  strengths = [],
  gaps = [],
  recommendations = [],
  checklistItems = [],
  isHistorical = false,
}) => {
  return (
    <div className="h-full flex flex-col space-y-5 overflow-y-auto" data-testid="overview-scorecard-view">
      {/* HERO SCORE & SUMMARY CARD */}
      <div className="p-6 rounded-2xl bg-[#161616] border border-white/10 flex flex-col sm:flex-row items-center gap-6">
        <RadialScoreGauge score={overallScore} />
        <div className="space-y-2 flex-1 text-center sm:text-left">
          <div className="flex items-center justify-center sm:justify-start gap-2">
            <span className="text-xs font-mono font-bold uppercase tracking-wider text-emerald-400">
              Authoritative AI Match Score
            </span>
            <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              {overallScore >= 90 ? "Grade A+" : overallScore >= 80 ? "Grade A" : overallScore >= 70 ? "Grade B" : "Grade C"}
            </span>
          </div>
          <p className="text-sm text-white font-medium leading-relaxed">
            {overallExplanation || "Candidate demonstrates strong background alignment with targeted role specifications."}
          </p>
          {executiveSummary && executiveSummary !== overallExplanation && (
            <p className="text-xs text-neutral-400 leading-relaxed">
              {executiveSummary}
            </p>
          )}
        </div>
      </div>

      {/* 3-COLUMN QUALITATIVE INSIGHTS GRID */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 flex-1">
        {/* STRENGTHS */}
        <div className="p-5 rounded-2xl bg-[#161616] border border-emerald-500/20 space-y-3">
          <div className="flex items-center gap-2 text-xs font-bold text-emerald-400 uppercase tracking-wider">
            <CheckCircle2 size={14} />
            <span>Evidence-Backed Strengths</span>
          </div>
          {strengths.length === 0 ? (
            <p className="text-xs text-neutral-400">No specific strengths highlighted.</p>
          ) : (
            <ul className="text-xs text-neutral-300 space-y-2 pl-4 list-disc">
              {strengths.map((str, idx) => (
                <li key={idx} className="leading-relaxed">{str}</li>
              ))}
            </ul>
          )}
        </div>

        {/* GAPS */}
        <div className="p-5 rounded-2xl bg-[#161616] border border-rose-500/20 space-y-3">
          <div className="flex items-center gap-2 text-xs font-bold text-rose-400 uppercase tracking-wider">
            <AlertTriangle size={14} />
            <span>Critical Evidence Gaps</span>
          </div>
          {gaps.length === 0 ? (
            <p className="text-xs text-neutral-400">Zero critical gaps detected against job specs.</p>
          ) : (
            <ul className="text-xs text-rose-200/90 space-y-2 pl-4 list-disc">
              {gaps.map((gap, idx) => (
                <li key={idx} className="leading-relaxed">{gap}</li>
              ))}
            </ul>
          )}
        </div>

        {/* RECOMMENDATIONS */}
        <div className="p-5 rounded-2xl bg-[#161616] border border-blue-500/20 space-y-3">
          <div className="flex items-center gap-2 text-xs font-bold text-blue-400 uppercase tracking-wider">
            <Sparkles size={14} />
            <span>Recommended Actions</span>
          </div>
          {recommendations.length === 0 ? (
            <p className="text-xs text-neutral-400">Resume already achieves strong alignment.</p>
          ) : (
            <ul className="text-xs text-blue-200/90 space-y-2 pl-4 list-disc">
              {recommendations.map((rec, idx) => (
                <li key={idx} className="leading-relaxed">{rec}</li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* 4. PRIORITIZED ACTION CHECKLIST */}
      {checklistItems && checklistItems.length > 0 && (
        <div className="p-6 rounded-2xl bg-[#161616] border border-white/10 space-y-4 shrink-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CheckSquare className="w-4 h-4 text-emerald-400" />
              <h3 className="text-xs font-bold text-white uppercase tracking-wider">
                Prioritized Action Checklist ({checklistItems.length})
              </h3>
            </div>
            {isHistorical && (
              <span className="text-[10px] font-mono text-neutral-400 bg-neutral-900 px-2 py-0.5 rounded border border-white/5">
                Saved Checklist Snapshot
              </span>
            )}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {checklistItems.map((item, idx) => (
              <div
                key={item.id || idx}
                className="p-3.5 rounded-xl bg-[#0F0F0F] border border-white/5 space-y-1.5"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[10px] font-mono uppercase tracking-wider text-neutral-400 font-bold">
                    {item.category}
                  </span>
                  <div className="flex items-center gap-1.5">
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase ${
                        item.priority === "critical"
                          ? "bg-rose-500/10 text-rose-400 border border-rose-500/20"
                          : item.priority === "high"
                          ? "bg-amber-500/10 text-amber-400 border border-amber-500/20"
                          : "bg-blue-500/10 text-blue-400 border border-blue-500/20"
                      }`}
                    >
                      {item.priority}
                    </span>
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase ${
                        item.passed
                          ? "bg-emerald-500/10 text-emerald-400"
                          : "bg-neutral-800 text-neutral-400"
                      }`}
                    >
                      {item.passed ? "Passed" : "Action Needed"}
                    </span>
                  </div>
                </div>
                <h4 className="text-xs font-bold text-white leading-snug">{item.title}</h4>
                <p className="text-[11px] text-neutral-300 leading-relaxed font-sans">{item.description}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default OverviewScorecardView;
