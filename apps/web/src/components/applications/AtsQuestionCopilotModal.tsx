import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Sparkles,
  X,
  CheckCircle2,
  AlertTriangle,
  Copy,
  Check,
  Plus,
  Trash2,
  ShieldCheck,
} from 'lucide-react';
import { ApplicationRecord, QuestionCategory, QuestionInput, QuestionAnswerResult } from '../../types/application';
import { fetchWithAuth } from '../../lib/api';

interface AtsQuestionCopilotModalProps {
  application: ApplicationRecord;
  isOpen: boolean;
  onClose: () => void;
}

export const AtsQuestionCopilotModal: React.FC<AtsQuestionCopilotModalProps> = ({
  application,
  isOpen,
  onClose,
}) => {
  const [questions, setQuestions] = useState<QuestionInput[]>([
    {
      questionId: 'q_001',
      questionText: `Why are you interested in joining ${application.company || 'our company'}?`,
      category: 'why_company',
      constraints: { maxCharacters: 800, tone: 'concise' },
    },
  ]);

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set(['q_001']));
  const [answers, setAnswers] = useState<Record<string, QuestionAnswerResult>>({});
  const [editedAnswers, setEditedAnswers] = useState<Record<string, string>>({});
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const presets = [
    { label: `Why ${application.company}?`, text: `Why are you interested in joining ${application.company}?`, category: 'why_company' as QuestionCategory },
    { label: 'Technical Challenge', text: 'Describe a difficult technical or architectural challenge you solved.', category: 'technical_challenge' as QuestionCategory },
    { label: 'Salary Expectations', text: 'What are your compensation / salary expectations?', category: 'compensation' as QuestionCategory },
    { label: 'Notice Period', text: 'What is your notice period or earliest start date?', category: 'availability' as QuestionCategory },
    { label: 'Greatest Strength', text: 'What is your greatest technical strength or superpower?', category: 'strengths' as QuestionCategory },
    { label: 'Handling Failure', text: 'Tell us about a mistake or engineering failure and what you learned.', category: 'failure_learning' as QuestionCategory },
  ];

  const handleAddPreset = (preset: typeof presets[0]) => {
    const nextId = `q_${String(questions.length + 1).padStart(3, '0')}`;
    const newQ: QuestionInput = {
      questionId: nextId,
      questionText: preset.text,
      category: preset.category,
      constraints: { maxCharacters: 600, tone: 'concise' },
    };
    setQuestions((prev) => [...prev, newQ]);
    setSelectedIds((prev) => new Set([...prev, nextId]));
  };

  const handleToggleSelect = (qid: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(qid)) {
        next.delete(qid);
      } else {
        next.add(qid);
      }
      return next;
    });
  };

  const handleSelectAll = () => {
    setSelectedIds(new Set(questions.map((q) => q.questionId)));
  };

  const handleClearSelection = () => {
    setSelectedIds(new Set());
  };

  const handleRemoveQuestion = (qid: string) => {
    setQuestions((prev) => prev.filter((q) => q.questionId !== qid));
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.delete(qid);
      return next;
    });
    setAnswers((prev) => {
      const copy = { ...prev };
      delete copy[qid];
      return copy;
    });
  };

  const handleBatchGenerate = async () => {
    const selectedQuestions = questions.filter((q) => selectedIds.has(q.questionId));
    if (selectedQuestions.length === 0) return;

    setIsGenerating(true);
    setError(null);

    try {
      const res = await fetchWithAuth(`/api/v1/applications/${application.id}/qa/batch-generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          questions: selectedQuestions,
          includeJobContext: true,
        }),
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.detail || 'Batch question generation failed');
      }

      const data = await res.json();
      const newAnswersMap: Record<string, QuestionAnswerResult> = { ...answers };
      const newEditedMap: Record<string, string> = { ...editedAnswers };

      data.answers.forEach((ans: QuestionAnswerResult) => {
        newAnswersMap[ans.questionId] = ans;
        if (ans.answer) {
          newEditedMap[ans.questionId] = ans.answer;
        }
      });

      setAnswers(newAnswersMap);
      setEditedAnswers(newEditedMap);
    } catch (err: any) {
      setError(err.message || 'Failed to generate answers');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleCopy = (qid: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(qid);
    setTimeout(() => setCopiedId(null), 2000);
  };

  if (!isOpen) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className="w-full max-w-3xl bg-[#0D0D0D] border border-white/15 rounded-2xl shadow-2xl shadow-black/95 overflow-hidden flex flex-col max-h-[92vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 bg-neutral-900/40 shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-purple-500/10 border border-purple-500/20 text-purple-400">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold text-white tracking-tight">ATS Custom Question Co-Pilot</h3>
                <span className="px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center gap-1">
                  <ShieldCheck className="w-3 h-3" />
                  Truth-Locked
                </span>
              </div>
              <p className="text-xs text-neutral-400">
                Grounded in Master Profile • {application.company} ({application.jobTitle})
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="text-neutral-400 hover:text-white p-1 rounded-lg hover:bg-neutral-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable Content Body */}
        <div className="p-6 space-y-5 overflow-y-auto custom-scrollbar flex-1 text-xs">
          {/* Quick Preset Buttons */}
          <div className="space-y-2">
            <span className="text-[11px] font-medium text-neutral-400 uppercase tracking-wider">
              Quick Application Presets:
            </span>
            <div className="flex flex-wrap gap-2">
              {presets.map((p, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => handleAddPreset(p)}
                  className="px-2.5 py-1 rounded-lg bg-neutral-900 hover:bg-neutral-800 border border-white/10 hover:border-purple-500/40 text-neutral-300 hover:text-purple-300 text-xs transition-all flex items-center gap-1"
                >
                  <Plus className="w-3 h-3 text-purple-400" />
                  <span>{p.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Selection Controls */}
          <div className="flex items-center justify-between pt-2 border-t border-white/5 text-[11px] text-neutral-400">
            <div className="flex items-center gap-2">
              <span>{selectedIds.size} of {questions.length} selected</span>
              <button
                type="button"
                onClick={handleSelectAll}
                className="text-purple-400 hover:text-purple-300 underline font-medium"
              >
                Select All
              </button>
              <span>•</span>
              <button
                type="button"
                onClick={handleClearSelection}
                className="hover:text-white underline font-medium"
              >
                Clear
              </button>
            </div>

            <button
              type="button"
              disabled={selectedIds.size === 0 || isGenerating}
              onClick={handleBatchGenerate}
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-gradient-to-r from-purple-600 to-emerald-600 hover:from-purple-500 hover:to-emerald-500 disabled:opacity-40 text-white font-semibold rounded-xl text-xs shadow-lg shadow-purple-950/40 transition-all cursor-pointer"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>{isGenerating ? 'Generating (Single Batch)...' : `Generate Selected (${selectedIds.size})`}</span>
            </button>
          </div>

          {error && (
            <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Question & Answer Cards */}
          <div className="space-y-4">
            {questions.map((q) => {
              const ansResult = answers[q.questionId];
              const isSelected = selectedIds.has(q.questionId);
              const activeText = editedAnswers[q.questionId] || ansResult?.answer || '';

              return (
                <div
                  key={q.questionId}
                  className={`p-4 rounded-xl border transition-all ${
                    isSelected
                      ? 'bg-neutral-900/70 border-purple-500/30 shadow-md shadow-purple-950/20'
                      : 'bg-neutral-900/30 border-white/10 opacity-70'
                  }`}
                >
                  {/* Question Header */}
                  <div className="flex items-start justify-between gap-3 mb-2.5">
                    <div className="flex items-start gap-2.5 flex-1">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => handleToggleSelect(q.questionId)}
                        className="mt-0.5 w-4 h-4 rounded border-white/20 bg-neutral-800 text-purple-600 focus:ring-purple-500"
                      />
                      <div className="flex-1">
                        <span className="text-[10px] font-mono text-neutral-500 mr-2">{q.questionId}</span>
                        <input
                          type="text"
                          value={q.questionText}
                          onChange={(e) => {
                            const val = e.target.value;
                            setQuestions((prev) =>
                              prev.map((item) =>
                                item.questionId === q.questionId ? { ...item, questionText: val } : item
                              )
                            );
                          }}
                          className="w-full bg-transparent text-white font-medium text-xs focus:outline-none focus:border-b focus:border-purple-500"
                        />
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => handleRemoveQuestion(q.questionId)}
                      className="text-neutral-500 hover:text-red-400 p-1 rounded transition-colors"
                      title="Remove question"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  {/* Answer Box if generated */}
                  {ansResult && (
                    <div className="mt-3 pt-3 border-t border-white/10 space-y-2">
                      <div className="flex items-center justify-between text-[11px]">
                        <div className="flex items-center gap-2">
                          {ansResult.status === 'VERIFIED' && (
                            <span className="px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-medium flex items-center gap-1">
                              <CheckCircle2 className="w-3 h-3" />
                              VERIFIED
                            </span>
                          )}
                          {ansResult.status === 'MISSING_REQUIRED_FACTS' && (
                            <span className="px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20 font-medium flex items-center gap-1">
                              <AlertTriangle className="w-3 h-3" />
                              MISSING REQUIRED FACTS ({ansResult.missingFacts.join(', ')})
                            </span>
                          )}
                          {ansResult.status === 'REJECTED' && (
                            <span className="px-2 py-0.5 rounded-full bg-red-500/10 text-red-400 border border-red-500/20 font-medium flex items-center gap-1">
                              <AlertTriangle className="w-3 h-3" />
                              REJECTED: {ansResult.violations.join('; ')}
                            </span>
                          )}
                          {ansResult.isDeterministic && (
                            <span className="text-[10px] text-neutral-400">Direct Profile Fact</span>
                          )}
                        </div>

                        <div className="flex items-center gap-2 text-neutral-400 text-[10px]">
                          <span>{activeText.length} chars</span>
                          <span>•</span>
                          <span>{activeText.split(/\s+/).filter(Boolean).length} words</span>
                        </div>
                      </div>

                      {activeText ? (
                        <div className="relative">
                          <textarea
                            rows={3}
                            value={activeText}
                            onChange={(e) => {
                              const val = e.target.value;
                              setEditedAnswers((prev) => ({ ...prev, [q.questionId]: val }));
                            }}
                            className="w-full p-2.5 rounded-xl bg-neutral-950/80 border border-white/10 text-neutral-200 text-xs focus:outline-none focus:border-purple-500/50 resize-y"
                          />
                          <button
                            type="button"
                            onClick={() => handleCopy(q.questionId, activeText)}
                            className="absolute top-2 right-2 p-1.5 rounded-lg bg-neutral-800/90 hover:bg-neutral-700 text-neutral-300 hover:text-white transition-colors"
                            title="Copy answer to clipboard"
                          >
                            {copiedId === q.questionId ? (
                              <Check className="w-3.5 h-3.5 text-emerald-400" />
                            ) : (
                              <Copy className="w-3.5 h-3.5" />
                            )}
                          </button>
                        </div>
                      ) : (
                        <p className="text-amber-400/90 text-xs italic">
                          Information not found in your Master Profile. Please update your profile preferences or fill this answer manually.
                        </p>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-3.5 border-t border-white/10 bg-neutral-900/60 shrink-0 flex items-center justify-between text-xs">
          <span className="text-[11px] text-neutral-500">
            Truth-Lock prevents AI fabrication. Manual edits are permanently preserved.
          </span>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-white font-medium transition-colors"
          >
            Done
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};
