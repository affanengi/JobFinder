import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useScrollLock } from '../../hooks/useScrollLock';
import { 
  X, 
  Link as LinkIcon, 
  FileText, 
  Sparkles, 
  CheckCircle2, 
  AlertCircle, 
  Loader2,
  Building2,
  MapPin,
  DollarSign
} from 'lucide-react';

export interface CanonicalJobDTO {
  id: string;
  title: string;
  company: string;
  location: string;
  workMode: 'remote' | 'hybrid' | 'onsite';
  employmentType: string;
  seniority: string;
  compensation?: {
    min?: number;
    max?: number;
    currency: string;
    interval: string;
    rawString?: string;
  };
  description: string;
  requiredSkills: string[];
  department?: string;
  sourceRef: {
    adapter: string;
    originalUrl: string;
  };
}

interface AddJobModalProps {
  isOpen: boolean;
  onClose: () => void;
  onJobAdded: (job: CanonicalJobDTO) => void;
}

export const AddJobModal: React.FC<AddJobModalProps> = ({ isOpen, onClose, onJobAdded }) => {
  const [activeTab, setActiveTab] = useState<'url' | 'text'>('url');
  const [url, setUrl] = useState('');
  const [textTitle, setTextTitle] = useState('');
  const [textCompany, setTextCompany] = useState('');
  const [rawText, setRawText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [extractedJob, setExtractedJob] = useState<CanonicalJobDTO | null>(null);

  // Lock body scroll when modal is open
  useScrollLock(isOpen);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isLoading) onClose();
    };
    if (isOpen) {
      window.addEventListener('keydown', handleKeyDown);
      return () => window.removeEventListener('keydown', handleKeyDown);
    }
  }, [isOpen, isLoading, onClose]);

  if (!isOpen) return null;

  const handleIngestUrl = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim()) return;

    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/v1/jobs/ingest/url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.trim() }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail || 'Failed to ingest and extract job from URL');
      }

      const job: CanonicalJobDTO = await res.json();
      setExtractedJob(job);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'An error occurred during URL extraction.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleIngestText = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!textTitle.trim() || !textCompany.trim() || !rawText.trim()) return;

    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/v1/jobs/ingest/text', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: textTitle.trim(),
          company: textCompany.trim(),
          raw_text: rawText.trim(),
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail || 'Failed to extract skills and normalize job from text');
      }

      const job: CanonicalJobDTO = await res.json();
      setExtractedJob(job);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'An error occurred during text extraction.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleConfirmAdd = () => {
    if (!extractedJob) return;
    onJobAdded(extractedJob);
    // Reset and close
    setExtractedJob(null);
    setUrl('');
    setTextTitle('');
    setTextCompany('');
    setRawText('');
    onClose();
  };

  return createPortal(
    <div 
      onClick={(e) => {
        if (e.target === e.currentTarget && !isLoading) {
          onClose();
        }
      }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 backdrop-blur-xl p-4 animate-in fade-in duration-150"
    >
      <div 
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-2xl bg-[#161616] border border-white/20 rounded-2xl p-6 shadow-2xl space-y-5 animate-in zoom-in-95 duration-150 max-h-[90vh] overflow-y-auto"
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between border-b border-white/10 pb-4">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 flex items-center justify-center">
              <Sparkles className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white">Add Custom Job Opportunity</h3>
              <p className="text-[11px] text-[#A3A3A3]">
                Ingest via Live URL or Raw Description Text to extract skills and score match fit.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-[#A3A3A3] hover:text-white hover:bg-white/10 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tab Selection */}
        {!extractedJob && (
          <div className="flex items-center gap-2 p-1 bg-[#0D0D0D] border border-white/10 rounded-xl">
            <button
              onClick={() => { setActiveTab('url'); setError(null); }}
              className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-xs font-medium transition-all ${
                activeTab === 'url'
                  ? 'bg-white text-black font-semibold shadow-sm'
                  : 'text-[#A3A3A3] hover:text-white'
              }`}
            >
              <LinkIcon className="w-3.5 h-3.5" />
              <span>Import via Job URL</span>
            </button>
            <button
              onClick={() => { setActiveTab('text'); setError(null); }}
              className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-xs font-medium transition-all ${
                activeTab === 'text'
                  ? 'bg-white text-black font-semibold shadow-sm'
                  : 'text-[#A3A3A3] hover:text-white'
              }`}
            >
              <FileText className="w-3.5 h-3.5" />
              <span>Paste Raw Description</span>
            </button>
          </div>
        )}

        {/* Error Notice */}
        {error && (
          <div className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-start gap-2.5">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-400" />
            <div className="flex-1">
              <span className="font-semibold block">Ingestion Notice</span>
              <span>{error}</span>
            </div>
          </div>
        )}

        {/* Form Body */}
        <div>
          {!extractedJob ? (
            <>
              {activeTab === 'url' ? (
                <form onSubmit={handleIngestUrl} className="space-y-4">
                  <div>
                    <label className="block text-[#A3A3A3] text-[11px] font-mono mb-1.5">
                      LIVE POSTING URL (Greenhouse, Lever, Ashby, Workable, etc.)
                    </label>
                    <div className="relative">
                      <LinkIcon className="w-3.5 h-3.5 text-[#666666] absolute left-3 top-1/2 -translate-y-1/2" />
                      <input
                        type="url"
                        required
                        placeholder="https://boards.greenhouse.io/company/jobs/12345"
                        value={url}
                        onChange={(e) => setUrl(e.target.value)}
                        className="w-full pl-9 pr-3 py-2 rounded-lg bg-[#0D0D0D] border border-white/20 text-white placeholder-[#666666] focus:outline-none focus:border-white text-xs"
                      />
                    </div>
                  </div>

                  <div className="pt-2 flex justify-end">
                    <button
                      type="submit"
                      disabled={isLoading || !url.trim()}
                      className="px-4 py-2 rounded-lg bg-white text-black font-semibold text-xs hover:bg-neutral-200 transition-colors disabled:opacity-50 flex items-center gap-2 cursor-pointer"
                    >
                      {isLoading ? (
                        <>
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          <span>Ingesting & Normalizing...</span>
                        </>
                      ) : (
                        <>
                          <Sparkles className="w-3.5 h-3.5" />
                          <span>Ingest & Normalize Job</span>
                        </>
                      )}
                    </button>
                  </div>
                </form>
              ) : (
                <form onSubmit={handleIngestText} className="space-y-4">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[#A3A3A3] text-[11px] font-mono mb-1.5">JOB TITLE</label>
                      <input
                        type="text"
                        required
                        placeholder="e.g. AI Automation Intern"
                        value={textTitle}
                        onChange={(e) => setTextTitle(e.target.value)}
                        className="w-full px-3 py-2 rounded-lg bg-[#0D0D0D] border border-white/20 text-white placeholder-[#666666] focus:outline-none focus:border-white text-xs"
                      />
                    </div>
                    <div>
                      <label className="block text-[#A3A3A3] text-[11px] font-mono mb-1.5">COMPANY</label>
                      <input
                        type="text"
                        required
                        placeholder="e.g. Acme AI"
                        value={textCompany}
                        onChange={(e) => setTextCompany(e.target.value)}
                        className="w-full px-3 py-2 rounded-lg bg-[#0D0D0D] border border-white/20 text-white placeholder-[#666666] focus:outline-none focus:border-white text-xs"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-[#A3A3A3] text-[11px] font-mono mb-1.5">
                      RAW JOB DESCRIPTION / REQUIREMENTS TEXT
                    </label>
                    <textarea
                      required
                      rows={6}
                      placeholder="Paste the full job posting text or requirements here..."
                      value={rawText}
                      onChange={(e) => setRawText(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg bg-[#0D0D0D] border border-white/20 text-white placeholder-[#666666] focus:outline-none focus:border-white text-xs leading-relaxed"
                    />
                  </div>

                  <div className="pt-2 flex justify-end">
                    <button
                      type="submit"
                      disabled={isLoading || !textTitle.trim() || !textCompany.trim() || !rawText.trim()}
                      className="px-4 py-2 rounded-lg bg-white text-black font-semibold text-xs hover:bg-neutral-200 transition-colors disabled:opacity-50 flex items-center gap-2 cursor-pointer"
                    >
                      {isLoading ? (
                        <>
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          <span>Normalizing Description...</span>
                        </>
                      ) : (
                        <>
                          <Sparkles className="w-3.5 h-3.5" />
                          <span>Normalize & Extract Job</span>
                        </>
                      )}
                    </button>
                  </div>
                </form>
              )}
            </>
          ) : (
            /* Extracted Normalized Job Preview */
            <div className="space-y-4 animate-in fade-in duration-200">
              <div className="flex items-center gap-2 text-emerald-400 font-mono text-[11px]">
                <CheckCircle2 className="w-4 h-4" />
                <span>Successfully normalized into Canonical Job Opportunity</span>
              </div>

              <div className="p-4 rounded-lg bg-[#0D0D0D] border border-white/20 space-y-3">
                <div className="flex items-start justify-between">
                  <div>
                    <h4 className="text-sm font-semibold text-white">{extractedJob.title}</h4>
                    <div className="flex items-center gap-2 mt-1 text-[11px] text-[#A3A3A3]">
                      <span className="flex items-center gap-1"><Building2 className="w-3 h-3" />{extractedJob.company}</span>
                      <span>•</span>
                      <span className="flex items-center gap-1"><MapPin className="w-3 h-3" />{extractedJob.location}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-[#1F1F1F] border border-white/10 text-white capitalize">
                      {extractedJob.workMode}
                    </span>
                    <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-[#1F1F1F] border border-white/10 text-emerald-400 capitalize">
                      {extractedJob.employmentType.replace('_', ' ')}
                    </span>
                  </div>
                </div>

                {extractedJob.compensation && (
                  <div className="flex items-center gap-1.5 text-emerald-400 font-mono text-xs">
                    <DollarSign className="w-3.5 h-3.5" />
                    <span>
                      {extractedJob.compensation.currency} {extractedJob.compensation.min?.toLocaleString()}
                      {extractedJob.compensation.max ? ` - ${extractedJob.compensation.max.toLocaleString()}` : ''} / {extractedJob.compensation.interval}
                    </span>
                  </div>
                )}

                <div>
                  <span className="text-[10px] font-mono text-[#A3A3A3] uppercase block mb-1.5">
                    Normalized Skills ({extractedJob.requiredSkills.length})
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {extractedJob.requiredSkills.map((skill, idx) => (
                      <span
                        key={idx}
                        className="px-2 py-0.5 rounded text-[11px] font-mono bg-[#1F1F1F] border border-white/10 text-[#A3A3A3]"
                      >
                        {skill}
                      </span>
                    ))}
                  </div>
                </div>

                <div className="text-[11px] text-[#A3A3A3] line-clamp-3 leading-relaxed border-t border-white/10 pt-2">
                  {extractedJob.description}
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setExtractedJob(null)}
                  className="px-3 py-1.5 rounded-lg border border-white/20 text-[#A3A3A3] hover:text-white text-xs transition-colors"
                >
                  Edit / Try Another
                </button>
                <button
                  type="button"
                  onClick={handleConfirmAdd}
                  className="px-4 py-1.5 rounded-lg bg-white text-black font-semibold text-xs hover:bg-neutral-200 transition-colors flex items-center gap-1.5 cursor-pointer"
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>Add to Live Opportunities</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
};
