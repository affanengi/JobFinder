import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useScrollLock } from '../../hooks/useScrollLock';
import { 
  X, 
  Download, 
  FileText, 
  Sparkles, 
  CheckCircle2, 
  AlertTriangle, 
  Loader2, 
  RefreshCw, 
  Code, 
  ShieldCheck, 
  Copy, 
  Check, 
  ArrowRight,
  Plus,
  Trash2,
  Zap,
  ChevronDown,
  Mail,
  Send,
  User,
  Phone,
  MapPin,
  Globe,
  Linkedin,
  Github
} from 'lucide-react';
import { fetchWithAuth } from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import { CoverLetterStudioPane, TailoredCoverLetterDTO, CoverLetterTone } from './CoverLetterStudioPane';

export interface ResumeBullet {
  text: string;
  source_fact_ids: string[];
}

export interface ResumeSkillCategory {
  category: string;
  items: string[];
  source_fact_ids: string[];
}

export interface ResumeExperienceItem {
  experience_fact_id?: string;
  company: string;
  title: string;
  location?: string;
  startDate?: string;
  endDate?: string;
  current: boolean;
  bullets: ResumeBullet[];
}

export interface ResumeProjectItem {
  project_fact_id?: string;
  name: string;
  technologies: string[];
  url?: string;
  bullets: ResumeBullet[];
}

export interface ResumeEducationItem {
  education_fact_id?: string;
  institution: string;
  degree: string;
  field?: string;
  startDate?: string;
  endDate?: string;
  grade?: string;
}

export interface ResumeCourseCertificationItem {
  course_fact_id?: string;
  title: string;
  completionYear?: string;
  certificateUrl?: string;
  description?: string;
  provider?: string;
  instructor?: string;
}

export interface StructuredResumeContent {
  personal: {
    fullName: string;
    email: string;
    phone?: string;
    city?: string;
    country?: string;
    github?: string;
    linkedin?: string;
    portfolio?: string;
  };
  summary: string;
  summary_fact_ids: string[];
  education: ResumeEducationItem[];
  skills: ResumeSkillCategory[];
  projects: ResumeProjectItem[];
  course_certifications?: ResumeCourseCertificationItem[];
  experience: ResumeExperienceItem[];
  leadership?: ResumeExperienceItem[];
  job_alignment?: {
    matched_skills: string[];
    transferable_strengths: string[];
    skill_gaps: string[];
    fit_summary?: string;
  };
}

export interface ResumeValidationResult {
  is_valid: boolean;
  truth_score: number;
  verified_fact_count: number;
  violations: string[];
  truth_violations: string[];
  structural_violations: string[];
  transferable_highlights: string[];
  skill_gaps: string[];
  status: 'PASSED' | 'BLOCKED';
}

export interface TailoredResumeDTO {
  id: string;
  userId: string;
  jobId: string;
  jobTitle: string;
  jobCompany: string;
  structuredContent: StructuredResumeContent;
  validationResult: ResumeValidationResult;
  latexCode: string;
  createdAt?: string;
  updatedAt?: string;
}

interface ResumeStudioModalProps {
  isOpen: boolean;
  onClose: () => void;
  jobId: string;
  jobTitle: string;
  jobCompany: string;
  initialTab?: 'resume' | 'cover_letter';
  existingResume?: TailoredResumeDTO | null;
  onApplicationApproved?: (resumeId: string) => void;
}

export const ResumeStudioModal: React.FC<ResumeStudioModalProps> = ({
  isOpen,
  onClose,
  jobId,
  jobTitle,
  jobCompany,
  initialTab = 'resume',
  existingResume,
  onApplicationApproved,
}) => {
  const { user } = useAuth();
  const [activeMainTab, setActiveMainTab] = useState<'resume' | 'cover_letter'>(initialTab);
  
  const [userProfile, setUserProfile] = useState<any>(null);

  const mergePersonalWithProfile = (
    personal: StructuredResumeContent['personal'] | undefined,
    profileData?: any
  ): StructuredResumeContent['personal'] => {
    const prof = profileData?.personal || userProfile?.personal || {};
    const links = prof.links || {};

    const defaultFullName = prof.fullName || 'Mohammed Affan Razvi';
    const defaultEmail = prof.email || 'mohammedaffanrazvi604@gmail.com';
    const defaultPhone = prof.phone || '+91 8978293087';
    const defaultCity = prof.city || 'Hyderabad';
    const defaultCountry = prof.country || 'India';
    const defaultGithub = links.github || 'https://github.com/affanengi';
    const defaultLinkedin = links.linkedin || 'https://www.linkedin.com/in/mohammed-affan-razvi-855a202ab/';
    const defaultPortfolio = links.portfolio || 'https://my-portfolio-henna-tau-72.vercel.app/';

    const isPlaceholderEmail = (e?: string) => !e || e.includes('example.com') || e.includes('affan@test.com');
    const isPlaceholderPhone = (p?: string) => !p || p.includes('98765 43210');
    const isPlaceholderGithub = (g?: string) => !g || g.endsWith('/affanrazvi');
    const isPlaceholderLinkedin = (l?: string) => !l || l.endsWith('/affanrazvi');
    const isPlaceholderPortfolio = (pf?: string) => !pf || pf.includes('affanrazvi.dev');

    return {
      fullName: personal?.fullName?.trim() || defaultFullName,
      email: !isPlaceholderEmail(personal?.email) ? personal!.email : defaultEmail,
      phone: !isPlaceholderPhone(personal?.phone) ? personal!.phone : defaultPhone,
      city: personal?.city?.trim() || defaultCity,
      country: personal?.country?.trim() || defaultCountry,
      github: !isPlaceholderGithub(personal?.github) ? personal!.github : defaultGithub,
      linkedin: !isPlaceholderLinkedin(personal?.linkedin) ? personal!.linkedin : defaultLinkedin,
      portfolio: !isPlaceholderPortfolio(personal?.portfolio) ? personal!.portfolio : defaultPortfolio,
    };
  };

  // State initialization
  const [resumeData, setResumeData] = useState<TailoredResumeDTO | null>(() => {
    if (!existingResume) return null;
    return {
      ...existingResume,
      structuredContent: {
        ...existingResume.structuredContent,
        personal: mergePersonalWithProfile(existingResume.structuredContent.personal),
      }
    };
  });
  const [coverLetterData, setCoverLetterData] = useState<TailoredCoverLetterDTO | null>(null);
  const [cachedExistingResume, setCachedExistingResume] = useState<TailoredResumeDTO | null>(null);
  const [structuredContent, setStructuredContent] = useState<StructuredResumeContent | null>(() => {
    if (!existingResume?.structuredContent) return null;
    return {
      ...existingResume.structuredContent,
      personal: mergePersonalWithProfile(existingResume.structuredContent.personal),
    };
  });
  const [latexCode, setLatexCode] = useState<string>(
    existingResume ? existingResume.latexCode : ''
  );
  const [pdfBlobUrl, setPdfBlobUrl] = useState<string | null>(null);
  
  // Loading and Generation Status
  const [isCheckingCache, setIsCheckingCache] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatingScope, setGeneratingScope] = useState<'resume' | 'cover_letter' | 'both'>('resume');
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [isRecompiling, setIsRecompiling] = useState(false);
  const [isSavingResume, setIsSavingResume] = useState(false);
  const [isApproving, setIsApproving] = useState(false);
  const [saveToast, setSaveToast] = useState<string | null>(null);
  
  // Regeneration Dropdown State
  const [regenOption, setRegenOption] = useState<'both' | 'resume' | 'cover_letter'>('resume');
  const [isRegenMenuOpen, setIsRegenMenuOpen] = useState(false);
  const regenMenuRef = useRef<HTMLDivElement>(null);

  const [isRegeneratingCoverLetter, setIsRegeneratingCoverLetter] = useState(false);
  const [activeLeftTab, setActiveLeftTab] = useState<'content' | 'latex'>('content');
  const [copiedLatex, setCopiedLatex] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [customInstructions, setCustomInstructions] = useState('');
  const [showCustomInstructions, setShowCustomInstructions] = useState(false);

  // Track the currently active jobId
  const currentJobIdRef = useRef<string | null>(null);

  const showSaveToast = (msg: string) => {
    setSaveToast(msg);
    setTimeout(() => setSaveToast(null), 3000);
  };

  useScrollLock(isOpen);

  // Reset currentJobIdRef on close to enable re-checking cache upon reopening
  useEffect(() => {
    if (!isOpen) {
      currentJobIdRef.current = null;
    }
  }, [isOpen]);

  // Elapsed-time based live tracking for active generation
  useEffect(() => {
    let interval: any;
    if (isGenerating) {
      setElapsedSeconds(0);
      interval = setInterval(() => {
        setElapsedSeconds((prev) => prev + 1);
      }, 1000);
    } else {
      setElapsedSeconds(0);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isGenerating]);

  const getProgressStageText = (seconds: number) => {
    if (seconds < 8) {
      return `Analyzing ${jobCompany} job requirements & mapping candidate verified facts...`;
    }
    if (seconds < 20) {
      return 'Synthesizing truth-grounded ATS achievement bullets with verified metrics...';
    }
    if (seconds < 35) {
      return 'Validating claims against the Verified Master Profile...';
    }
    return 'Compiling clean ATS LaTeX typography & generating PDF preview...';
  };


  // Automatically fetch Master Profile to auto-fill candidate personal facts
  useEffect(() => {
    if (!isOpen) return;
    fetchWithAuth('/api/v1/profile')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data) {
          setUserProfile(data);
          setStructuredContent((prev) => {
            if (!prev) return prev;
            const merged = mergePersonalWithProfile(prev.personal, data);
            const isDifferent =
              merged.email !== prev.personal?.email ||
              merged.phone !== prev.personal?.phone ||
              merged.github !== prev.personal?.github ||
              merged.linkedin !== prev.personal?.linkedin ||
              merged.city !== prev.personal?.city ||
              merged.country !== prev.personal?.country ||
              merged.portfolio !== prev.personal?.portfolio ||
              merged.fullName !== prev.personal?.fullName;

            if (isDifferent) {
              const next = { ...prev, personal: merged };
              renderPdfFromStructured(next);
              return next;
            }
            return prev;
          });
        }
      })
      .catch((err) => console.error('Failed to load profile for resume studio:', err));
  }, [isOpen]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (regenMenuRef.current && !regenMenuRef.current.contains(e.target as Node)) {
        setIsRegenMenuOpen(false);
      }
    };
    if (isRegenMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isRegenMenuOpen]);

  useEffect(() => {
    setActiveMainTab(initialTab);
  }, [initialTab]);

  const renderPdfFromStructured = async (content: StructuredResumeContent) => {
    try {
      const res = await fetchWithAuth('/api/v1/resumes/render-pdf-direct', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(content),
      });

      if (res.ok) {
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        setPdfBlobUrl(url);
      }
    } catch (err) {
      console.error('Error rendering PDF:', err);
    }
  };

  // Reset and initialize on modal open/close
  useEffect(() => {
    if (!isOpen) {
      currentJobIdRef.current = null;
      setCachedExistingResume(null);
      setErrorMessage(null);
      setIsGenerating(false);
      return;
    }
    if (!jobId) return;

    if (currentJobIdRef.current !== jobId) {
      currentJobIdRef.current = jobId;
      setErrorMessage(null);

      if (existingResume) {
        // Explicit existing resume passed as prop (e.g. from ResumesPage 'Open Studio')
        const enhancedContent = {
          ...existingResume.structuredContent,
          personal: mergePersonalWithProfile(existingResume.structuredContent.personal),
        };
        setResumeData({
          ...existingResume,
          structuredContent: enhancedContent,
        });
        setStructuredContent(enhancedContent);
        setLatexCode(existingResume.latexCode);
        renderPdfFromStructured(enhancedContent);
        setIsCheckingCache(false);

        fetchWithAuth(`/api/v1/cover-letters/job/${jobId}`)
          .then((res) => (res.ok ? res.json() : null))
          .then((data) => {
            if (data) setCoverLetterData(data);
          })
          .catch(() => {});
      } else {
        // Opened from Opportunities Page ('Tailor Resume') - ALWAYS present Choice Hub first!
        setResumeData(null);
        setStructuredContent(null);
        setLatexCode('');
        setPdfBlobUrl(null);
        setCachedExistingResume(null);
        setIsCheckingCache(true);

        Promise.all([
          fetchWithAuth(`/api/v1/resumes/job/${jobId}`)
            .then((res) => (res.ok ? res.json() : null))
            .catch(() => null),
          fetchWithAuth(`/api/v1/cover-letters/job/${jobId}`)
            .then((res) => (res.ok ? res.json() : null))
            .catch(() => null),
        ]).then(([cachedResume, cachedCl]) => {
          setIsCheckingCache(false);
          if (cachedResume) {
            const enhancedContent = {
              ...cachedResume.structuredContent,
              personal: mergePersonalWithProfile(cachedResume.structuredContent.personal),
            };
            // Retain cached resume in state for user to open, but DO NOT auto-bypass Choice Hub!
            setCachedExistingResume({
              ...cachedResume,
              structuredContent: enhancedContent,
            });
          }
          if (cachedCl) {
            setCoverLetterData(cachedCl);
          } else {
            setCoverLetterData(null);
          }
        });
      }
    }
  }, [isOpen, jobId, existingResume]);

  // Explicit User-Initiated Generation
  const handleGenerateScope = async (mode: 'resume' | 'cover_letter' | 'both', force = true) => {
    setIsGenerating(true);
    setGeneratingScope(mode);
    setErrorMessage(null);

    try {
      const res = await fetchWithAuth('/api/v1/artifacts/generate', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'X-User-Id': user?.uid || 'user_default',
        },
        body: JSON.stringify({
          jobId: jobId,
          mode: mode,
          coverLetterTone: 'professional',
          customInstructions: customInstructions.trim() || undefined,
          forceRegenerate: force,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `Generation failed with status ${res.status}`);
      }

      const data = await res.json();
      if (data.resume) {
        const enhancedContent = {
          ...data.resume.structuredContent,
          personal: mergePersonalWithProfile(data.resume.structuredContent.personal),
        };
        setResumeData({
          ...data.resume,
          structuredContent: enhancedContent,
        });
        setStructuredContent(enhancedContent);
        setLatexCode(data.resume.latexCode);
        await renderPdfFromStructured(enhancedContent);
        showSaveToast('Tailored ATS Resume generated successfully!');
      }
      if (data.coverLetter) {
        setCoverLetterData(data.coverLetter);
        if (mode === 'cover_letter') {
          showSaveToast('Tailored Cover Letter generated!');
        }
      }
    } catch (err: unknown) {
      console.error('Generation failed:', err);
      const msg = err instanceof Error ? err.message : 'Failed to generate tailored application.';
      setErrorMessage(msg);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleRegenerateCoverLetterOnly = async (tone: CoverLetterTone = 'professional', instructions?: string) => {
    setIsRegeneratingCoverLetter(true);
    try {
      const res = await fetchWithAuth('/api/v1/artifacts/generate', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'X-User-Id': user?.uid || 'user_default',
        },
        body: JSON.stringify({
          jobId: jobId,
          mode: 'cover_letter',
          coverLetterTone: tone,
          customInstructions: instructions || customInstructions || undefined,
          forceRegenerate: true,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        if (data.coverLetter) {
          setCoverLetterData(data.coverLetter);
          showSaveToast(`Cover letter regenerated (${tone} tone)!`);
        }
      } else {
        const err = await res.json().catch(() => ({}));
        showSaveToast(err.detail || 'Failed to regenerate cover letter.');
      }
    } catch (err) {
      console.error(err);
      showSaveToast('Error regenerating cover letter.');
    } finally {
      setIsRegeneratingCoverLetter(false);
    }
  };

  const handleRecompile = async () => {
    if (!structuredContent) return;
    setIsRecompiling(true);
    try {
      const valRes = await fetchWithAuth('/api/v1/resumes/validate-and-render', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(structuredContent),
      });

      if (valRes.ok) {
        const data = await valRes.json();
        if (data.validationResult && resumeData) {
          setResumeData({ ...resumeData, validationResult: data.validationResult });
        }
        if (data.latexCode) {
          setLatexCode(data.latexCode);
        }
      }

      await renderPdfFromStructured(structuredContent);
      showSaveToast('PDF recompiled successfully!');
    } catch (err) {
      console.error('Recompilation error:', err);
    } finally {
      setIsRecompiling(false);
    }
  };

  const handleSaveResumeEdits = async () => {
    if (!resumeData || !structuredContent) return;
    setIsSavingResume(true);
    try {
      const res = await fetchWithAuth(`/api/v1/resumes/${resumeData.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(structuredContent),
      });

      if (res.ok) {
        const updated: TailoredResumeDTO = await res.json();
        setResumeData(updated);
        setStructuredContent(updated.structuredContent);
        setLatexCode(updated.latexCode);
        await renderPdfFromStructured(updated.structuredContent);
        showSaveToast('Saved changes to Cloud Firestore!');
      } else {
        showSaveToast('Failed to save changes.');
      }
    } catch (err) {
      console.error('Save error:', err);
      showSaveToast('Failed to save changes.');
    } finally {
      setIsSavingResume(false);
    }
  };

  const handleDownloadPdf = async () => {
    if (!resumeData) return;
    try {
      const res = await fetchWithAuth(`/api/v1/resumes/${resumeData.id}/pdf`);
      if (res.ok) {
        const blob = await res.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const sanitized = jobCompany.replace(/[^a-zA-Z0-9_-]/g, '');
        a.download = `ATS_Resume_${sanitized || 'Application'}.pdf`;
        document.body.appendChild(a);
        a.click();
        a.remove();
      }
    } catch (err) {
      console.error('PDF download error:', err);
    }
  };

  const handleDownloadTex = async () => {
    if (!resumeData) return;
    try {
      const res = await fetchWithAuth(`/api/v1/resumes/${resumeData.id}/tex`);
      if (res.ok) {
        const text = await res.text();
        const blob = new Blob([text], { type: 'text/plain' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const sanitized = jobCompany.replace(/[^a-zA-Z0-9_-]/g, '');
        a.download = `ATS_Resume_${sanitized || 'Application'}.tex`;
        document.body.appendChild(a);
        a.click();
        a.remove();
      }
    } catch (err) {
      console.error('LaTeX download error:', err);
    }
  };

  const handleCopyLatex = () => {
    if (!latexCode) return;
    navigator.clipboard.writeText(latexCode);
    setCopiedLatex(true);
    setTimeout(() => setCopiedLatex(false), 2000);
  };

  if (!isOpen) return null;

  return createPortal(
    <div 
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xl flex items-center justify-center p-3 sm:p-5 md:p-6 animate-in fade-in duration-200"
      onClick={(e) => {
        if (e.target === e.currentTarget && !isGenerating) {
          onClose();
        }
      }}
    >
      <div 
        className="w-full h-full max-w-[1400px] max-h-[92vh] bg-[#121212] border border-white/20 rounded-2xl md:rounded-3xl shadow-2xl flex flex-col overflow-hidden animate-in zoom-in-95 duration-200 relative"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Toast Notification */}
        {saveToast && (
          <div className="absolute top-16 right-6 z-50 px-3.5 py-2 rounded-xl bg-[#1F1F1F] border border-emerald-500/40 text-emerald-400 text-xs font-mono shadow-2xl flex items-center gap-2 animate-in slide-in-from-top-2 duration-150">
            <CheckCircle2 className="w-4 h-4" />
            <span>{saveToast}</span>
          </div>
        )}

        {/* Top Header Bar */}
        <div className="px-6 py-4 border-b border-white/10 bg-[#161616] flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-white/10 flex items-center justify-center border border-white/20">
              <Zap className="w-4 h-4 text-emerald-400" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-bold text-white tracking-tight">
                  Application Studio
                </h2>
                <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 font-semibold">
                  Zero Hallucination
                </span>
              </div>
              <p className="text-xs text-[#A3A3A3] truncate max-w-md">
                {jobTitle} • <span className="text-white font-medium">{jobCompany}</span>
              </p>
            </div>
          </div>

          {/* Center: Top Document Navigation Tabs */}
          <div className="flex items-center gap-1 bg-[#0D0D0D] p-1 rounded-xl border border-white/20">
            <button
              onClick={() => setActiveMainTab('resume')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                activeMainTab === 'resume'
                  ? 'bg-white text-black font-bold shadow-sm'
                  : 'text-[#A3A3A3] hover:text-white hover:bg-white/5'
              }`}
            >
              <FileText className="w-3.5 h-3.5" />
              <span>ATS Resume (1-Page)</span>
              {resumeData && (
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 ml-0.5"></span>
              )}
            </button>

            <button
              onClick={() => setActiveMainTab('cover_letter')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                activeMainTab === 'cover_letter'
                  ? 'bg-white text-black font-bold shadow-sm'
                  : 'text-[#A3A3A3] hover:text-white hover:bg-white/5'
              }`}
            >
              <Mail className="w-3.5 h-3.5 text-teal-400" />
              <span>Cover Letter</span>
              {coverLetterData && (
                <span className="w-1.5 h-1.5 rounded-full bg-teal-400 ml-0.5"></span>
              )}
            </button>
          </div>

          {/* Right: Close Button */}
          <button
            onClick={onClose}
            disabled={isGenerating}
            className="p-1.5 rounded-xl text-[#A3A3A3] hover:text-white hover:bg-white/10 transition-colors cursor-pointer disabled:opacity-30"
            title="Close Studio (Esc)"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        {isCheckingCache ? (
          <div className="flex-1 flex flex-col items-center justify-center p-8 space-y-3">
            <Loader2 className="w-8 h-8 text-emerald-400 animate-spin" />
            <p className="text-xs text-[#A3A3A3] font-mono">Checking saved application artifacts from Cloud Firestore...</p>
          </div>
        ) : errorMessage ? (
          /* Error State with Retry Button */
          <div className="flex-1 flex flex-col items-center justify-center p-8 space-y-4 max-w-md mx-auto text-center">
            <div className="w-12 h-12 rounded-2xl bg-rose-500/10 border border-rose-500/30 text-rose-400 flex items-center justify-center">
              <AlertTriangle className="w-6 h-6" />
            </div>
            <div className="space-y-1">
              <h3 className="text-sm font-bold text-white">Generation Issue</h3>
              <p className="text-xs text-rose-300">{errorMessage}</p>
            </div>
            <div className="flex items-center gap-3 pt-2">
              <button
                onClick={() => setErrorMessage(null)}
                className="px-3.5 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-white text-xs font-medium cursor-pointer"
              >
                Back to Options
              </button>
              <button
                onClick={() => handleGenerateScope(generatingScope, true)}
                className="px-4 py-2 rounded-xl bg-white text-black hover:bg-neutral-200 text-xs font-bold transition-colors cursor-pointer"
              >
                Retry Generation
              </button>
            </div>
          </div>
        ) : !resumeData && activeMainTab === 'resume' ? (
          /* PRE-GENERATION STUDIO DASHBOARD (User Choice Hub) */
          <div className="flex-1 flex flex-col items-center justify-center p-6 md:p-12 overflow-y-auto">
            <div className="max-w-2xl w-full space-y-6">
              <div className="text-center space-y-1.5">
                <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs font-mono font-semibold">
                  <ShieldCheck className="w-3.5 h-3.5" />
                  <span>Grounded in Verified Profile Skills & Truth Metrics</span>
                </div>
                <h3 className="text-lg font-bold text-white tracking-tight">
                  Tailor Application for {jobCompany}
                </h3>
                <p className="text-xs text-[#A3A3A3] max-w-lg mx-auto leading-relaxed">
                  Select your tailoring mode below. Gemini will synthesize content using exclusively your candidate-confirmed verified facts.
                </p>
              </div>

              {/* Saved Version Found Banner */}
              {cachedExistingResume && !isGenerating && (
                <div className="p-4 rounded-2xl bg-[#161616] border border-emerald-500/40 flex items-center justify-between gap-4 animate-in fade-in">
                  <div className="space-y-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                      <span className="text-xs font-bold text-white">Previously Tailored Resume Found</span>
                      <span className="text-[10px] font-mono text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-md border border-emerald-500/20 font-bold">
                        Score: {cachedExistingResume.validationResult?.truth_score || 100}%
                      </span>
                    </div>
                    <p className="text-[11px] text-[#A3A3A3] leading-relaxed truncate">
                      You already have a saved tailored resume for <span className="text-white font-semibold">{jobCompany}</span>. Open it or generate a fresh version below.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setResumeData(cachedExistingResume);
                      setStructuredContent(cachedExistingResume.structuredContent);
                      setLatexCode(cachedExistingResume.latexCode);
                      renderPdfFromStructured(cachedExistingResume.structuredContent);
                    }}
                    className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-emerald-500 text-black hover:bg-emerald-400 text-xs font-bold shrink-0 transition-colors cursor-pointer shadow-md"
                  >
                    <FileText className="w-3.5 h-3.5" />
                    <span>Open Saved Resume</span>
                  </button>
                </div>
              )}

              {/* Generation Choice Cards */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Option 1: Resume Only (Recommended) */}
                <div 
                  onClick={() => !isGenerating && handleGenerateScope('resume', true)}
                  className={`p-5 rounded-2xl bg-[#161616] border border-white/20 hover:border-emerald-500/50 hover:bg-[#1A1A1A] transition-all group flex flex-col justify-between space-y-4 ${
                    isGenerating ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'
                  }`}
                >
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="w-9 h-9 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 flex items-center justify-center">
                        <FileText className="w-5 h-5" />
                      </div>
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 font-semibold">
                        Fast • Recommended
                      </span>
                    </div>
                    <h4 className="text-sm font-bold text-white group-hover:text-emerald-400 transition-colors">
                      Tailor ATS Resume Only
                    </h4>
                    <p className="text-xs text-[#A3A3A3] leading-relaxed">
                      Generates a dense 1-page ATS resume with verified action verbs, technical depth, and candidate-confirmed metrics.
                    </p>
                  </div>

                  <button
                    type="button"
                    disabled={isGenerating}
                    className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-white text-black font-bold text-xs group-hover:bg-emerald-400 transition-colors cursor-pointer shadow-md disabled:opacity-80"
                  >
                    {isGenerating && generatingScope === 'resume' ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin text-black" />
                        <span>Tailoring ATS Resume...</span>
                      </>
                    ) : (
                      <>
                        <Zap className="w-3.5 h-3.5" />
                        <span>Generate Tailored Resume</span>
                      </>
                    )}
                  </button>
                </div>

                {/* Option 2: Full Application Package */}
                <div 
                  onClick={() => !isGenerating && handleGenerateScope('both', true)}
                  className={`p-5 rounded-2xl bg-[#161616] border border-white/20 hover:border-teal-500/50 hover:bg-[#1A1A1A] transition-all group flex flex-col justify-between space-y-4 ${
                    isGenerating ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'
                  }`}
                >
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="w-9 h-9 rounded-xl bg-teal-500/10 border border-teal-500/30 text-teal-400 flex items-center justify-center">
                        <Sparkles className="w-5 h-5" />
                      </div>
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-teal-500/20 text-teal-300 font-semibold">
                        Full Package
                      </span>
                    </div>
                    <h4 className="text-sm font-bold text-white group-hover:text-teal-400 transition-colors">
                      Resume + Cover Letter
                    </h4>
                    <p className="text-xs text-[#A3A3A3] leading-relaxed">
                      Generates both the tailored ATS resume and an authentic 3-paragraph cover letter in a unified 1-shot AI pass.
                    </p>
                  </div>

                  <button
                    type="button"
                    disabled={isGenerating}
                    className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-white/10 text-white font-semibold text-xs border border-white/20 group-hover:bg-teal-400 group-hover:text-black transition-colors cursor-pointer shadow-md disabled:opacity-80"
                  >
                    {isGenerating && generatingScope === 'both' ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin text-white" />
                        <span>Generating Full Package...</span>
                      </>
                    ) : (
                      <>
                        <Send className="w-3.5 h-3.5" />
                        <span>Generate Both in 1-Shot</span>
                      </>
                    )}
                  </button>
                </div>
              </div>

              {/* Live Inline Generation Status for Pre-Gen Hub */}
              {isGenerating && (
                <div className="text-center space-y-2 py-2 animate-in fade-in max-w-md mx-auto">
                  <div className="inline-flex items-center gap-2 text-xs font-mono text-emerald-400 font-semibold">
                    <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
                    <span>
                      {generatingScope === 'resume'
                        ? `Tailoring 1-Page ATS Resume for ${jobCompany}...`
                        : `Tailoring Application Package for ${jobCompany}...`}
                    </span>
                    <span className="px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-[10px] text-emerald-300 font-mono">
                      Elapsed: {elapsedSeconds}s
                    </span>
                  </div>
                  <p className="text-[11px] text-[#A3A3A3] transition-all">
                    {getProgressStageText(elapsedSeconds)}
                  </p>
                </div>
              )}

              {/* Optional Custom Guidance Collapsible */}
              <div className="pt-2">
                <button
                  type="button"
                  onClick={() => setShowCustomInstructions(!showCustomInstructions)}
                  className="text-xs text-[#A3A3A3] hover:text-white flex items-center gap-1.5 font-mono cursor-pointer transition-colors"
                >
                  <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-150 ${showCustomInstructions ? 'rotate-180' : ''}`} />
                  <span>{showCustomInstructions ? 'Hide Custom Tailoring Focus' : '+ Add Custom Tailoring Focus (Optional)'}</span>
                </button>

                {showCustomInstructions && (
                  <div className="mt-2 animate-in fade-in slide-in-from-top-1 duration-150">
                    <textarea
                      rows={2}
                      placeholder="e.g., Emphasize Python / FastAPI backend capabilities, focus on automation and n8n workflows..."
                      value={customInstructions}
                      onChange={(e) => setCustomInstructions(e.target.value)}
                      className="w-full p-3 rounded-xl bg-[#0D0D0D] border border-white/20 text-xs text-white placeholder:text-[#555555] focus:border-white/40 focus:outline-none resize-none leading-relaxed"
                    />
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : activeMainTab === 'cover_letter' ? (
          /* COVER LETTER STUDIO PANE */
          <div className="flex-1 min-h-0 overflow-hidden">
            <CoverLetterStudioPane
              jobTitle={jobTitle}
              jobCompany={jobCompany}
              coverLetter={coverLetterData}
              onCoverLetterUpdated={(updated) => setCoverLetterData(updated)}
              onRegenerate={handleRegenerateCoverLetterOnly}
              isRegenerating={isRegeneratingCoverLetter}
              showSaveToast={showSaveToast}
            />
          </div>
        ) : resumeData && structuredContent ? (
          /* ATS RESUME STUDIO SPLIT-PANE */
          <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 min-h-0 overflow-hidden divide-y lg:divide-y-0 lg:divide-x divide-white/10">
            {/* LEFT PANE: Structured Interactive Field Editor */}
            <div className="lg:col-span-6 flex flex-col h-full overflow-hidden min-h-0 bg-[#0D0D0D]">
              {/* Left Sub-Header: Mode Switcher, Recompile & Save */}
              <div className="px-4 py-2.5 bg-[#161616] border-b border-white/10 flex items-center justify-between gap-3 shrink-0">
                <div className="flex items-center gap-1 bg-[#0D0D0D] p-1 rounded-xl border border-white/15 shrink-0">
                  <button
                    type="button"
                    onClick={() => setActiveLeftTab('content')}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all cursor-pointer ${
                      activeLeftTab === 'content'
                        ? 'bg-white text-black font-bold shadow-sm'
                        : 'text-[#A3A3A3] hover:text-white'
                    }`}
                  >
                    <FileText className="w-3.5 h-3.5 shrink-0" />
                    <span className="whitespace-nowrap">Structured Fields</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveLeftTab('latex')}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all cursor-pointer ${
                      activeLeftTab === 'latex'
                        ? 'bg-white text-black font-bold shadow-sm'
                        : 'text-[#A3A3A3] hover:text-white'
                    }`}
                  >
                    <Code className="w-3.5 h-3.5 shrink-0" />
                    <span className="whitespace-nowrap">LaTeX Source</span>
                  </button>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  {/* Regen AI Split Dropdown Button */}
                  <div className="relative inline-flex items-center rounded-xl bg-white/5 border border-white/10 shrink-0 h-8" ref={regenMenuRef}>
                    <button
                      type="button"
                      onClick={() => handleGenerateScope(regenOption, true)}
                      disabled={isGenerating || isRegeneratingCoverLetter}
                      className="inline-flex items-center gap-1.5 px-2.5 h-full text-neutral-200 hover:text-white hover:bg-white/10 text-xs font-medium rounded-l-xl transition-colors cursor-pointer disabled:opacity-50 whitespace-nowrap"
                      title={`Regenerate with AI: ${regenOption === "both" ? "Both (Resume + Cover Letter)" : regenOption === "resume" ? "Resume Only" : "Cover Letter Only"}`}
                    >
                      {isGenerating || isRegeneratingCoverLetter ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin text-emerald-400 shrink-0" />
                      ) : (
                        <RefreshCw className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                      )}
                      <span className="whitespace-nowrap">
                        {isGenerating || isRegeneratingCoverLetter
                          ? "Regenerating..."
                          : regenOption === "both"
                          ? "Regen Both"
                          : regenOption === "resume"
                          ? "Regen Resume"
                          : "Regen Letter"}
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setIsRegenMenuOpen(!isRegenMenuOpen)}
                      disabled={isGenerating || isRegeneratingCoverLetter}
                      className="px-1.5 h-full flex items-center justify-center text-neutral-400 hover:text-white hover:bg-white/10 border-l border-white/10 rounded-r-xl transition-colors cursor-pointer disabled:opacity-50 shrink-0"
                      title="Select AI Generation Scope"
                    >
                      <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-150 ${isRegenMenuOpen ? "rotate-180" : ""}`} />
                    </button>

                    {/* Dropdown Menu */}
                    {isRegenMenuOpen && (
                      <div className="absolute top-full right-0 sm:left-0 sm:right-auto mt-1.5 w-60 bg-[#161616] border border-white/20 rounded-xl shadow-2xl py-1 z-50 text-xs animate-in fade-in zoom-in-95 duration-100">
                        <button
                          type="button"
                          onClick={() => {
                            setRegenOption("resume");
                            setIsRegenMenuOpen(false);
                          }}
                          className={`w-full flex items-center justify-between px-3 py-2 text-left hover:bg-white/10 transition-colors cursor-pointer ${regenOption === "resume" ? "text-emerald-400 font-semibold" : "text-neutral-300"}`}
                        >
                          <div className="flex items-center gap-2">
                            <FileText className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                            <div>
                              <div className="font-medium whitespace-nowrap">Resume Only</div>
                              <div className="text-[10px] text-neutral-400 whitespace-nowrap">Keep cover letter untouched</div>
                            </div>
                          </div>
                          {regenOption === "resume" && <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0 ml-2" />}
                        </button>

                        <button
                          type="button"
                          onClick={() => {
                            setRegenOption("both");
                            setIsRegenMenuOpen(false);
                          }}
                          className={`w-full flex items-center justify-between px-3 py-2 text-left hover:bg-white/10 transition-colors cursor-pointer ${regenOption === "both" ? "text-emerald-400 font-semibold" : "text-neutral-300"}`}
                        >
                          <div className="flex items-center gap-2">
                            <Sparkles className="w-3.5 h-3.5 text-teal-400 shrink-0" />
                            <div>
                              <div className="font-medium whitespace-nowrap">Both (Resume + Cover Letter)</div>
                              <div className="text-[10px] text-neutral-400 whitespace-nowrap">Unified 1-shot generation</div>
                            </div>
                          </div>
                          {regenOption === "both" && <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0 ml-2" />}
                        </button>

                        <button
                          type="button"
                          onClick={() => {
                            setRegenOption("cover_letter");
                            setIsRegenMenuOpen(false);
                          }}
                          className={`w-full flex items-center justify-between px-3 py-2 text-left hover:bg-white/10 transition-colors cursor-pointer ${regenOption === "cover_letter" ? "text-emerald-400 font-semibold" : "text-neutral-300"}`}
                        >
                          <div className="flex items-center gap-2">
                            <Mail className="w-3.5 h-3.5 text-teal-400 shrink-0" />
                            <div>
                              <div className="font-medium whitespace-nowrap">Cover Letter Only</div>
                              <div className="text-[10px] text-neutral-400 whitespace-nowrap">Keep resume untouched</div>
                            </div>
                          </div>
                          {regenOption === "cover_letter" && <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0 ml-2" />}
                        </button>
                      </div>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={handleRecompile}
                    disabled={isRecompiling}
                    className="inline-flex items-center gap-1.5 px-3 h-8 rounded-xl bg-white/10 hover:bg-white/15 text-white text-xs font-semibold whitespace-nowrap transition-colors cursor-pointer disabled:opacity-50 shrink-0"
                    title="Recompile PDF from local fields (Zero API Cost)"
                  >
                    {isRecompiling ? <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" /> : <RefreshCw className="w-3.5 h-3.5 text-emerald-400 shrink-0" />}
                    <span className="whitespace-nowrap">Recompile</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleSaveResumeEdits}
                    disabled={isSavingResume}
                    className="inline-flex items-center gap-1.5 px-3.5 h-8 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-black text-xs font-bold whitespace-nowrap transition-colors cursor-pointer disabled:opacity-50 shrink-0 shadow-sm"
                    title="Save edits to Cloud Firestore"
                  >
                    {isSavingResume ? <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" /> : <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />}
                    <span className="whitespace-nowrap">Save</span>
                  </button>
                </div>
              </div>

              {/* Left Content Scrollable Container */}
              <div className="flex-1 overflow-y-auto p-5 space-y-6">
                {activeLeftTab === 'content' ? (
                  <>
                    {/* Personal & Contact Information Form */}
                    <div className="space-y-3 bg-[#161616] p-4 rounded-xl border border-white/10">
                      <div className="flex items-center justify-between">
                        <label className="text-xs font-bold text-white uppercase tracking-wider font-mono flex items-center gap-2">
                          <User className="w-3.5 h-3.5 text-emerald-400" />
                          Personal &amp; Contact Information
                        </label>
                        <span className="text-[10px] font-mono text-emerald-400">
                          Editable &amp; Compilable
                        </span>
                      </div>

                      <div className="space-y-3">
                        {/* Full Name */}
                        <div>
                          <label className="text-[10px] font-mono uppercase text-[#888888] mb-1 flex items-center gap-1.5">
                            <User className="w-3 h-3 text-[#888888]" />
                            Full Name
                          </label>
                          <input
                            type="text"
                            value={structuredContent.personal?.fullName || ''}
                            onChange={(e) =>
                              setStructuredContent({
                                ...structuredContent,
                                personal: {
                                  ...structuredContent.personal,
                                  fullName: e.target.value,
                                },
                              })
                            }
                            placeholder="e.g. Mohammed Affan Razvi"
                            className="w-full bg-[#0D0D0D] border border-white/15 focus:border-emerald-500/50 focus:outline-none rounded-xl px-3 py-2 text-xs text-neutral-200 transition-colors"
                          />
                        </div>

                        {/* Email & Phone */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          <div>
                            <label className="text-[10px] font-mono uppercase text-[#888888] mb-1 flex items-center gap-1.5">
                              <Mail className="w-3 h-3 text-[#888888]" />
                              Email Address
                            </label>
                            <input
                              type="email"
                              value={structuredContent.personal?.email || ''}
                              onChange={(e) =>
                                setStructuredContent({
                                  ...structuredContent,
                                  personal: {
                                    ...structuredContent.personal,
                                    email: e.target.value,
                                  },
                                })
                              }
                              placeholder="mohammedaffanrazvi604@gmail.com"
                              className="w-full bg-[#0D0D0D] border border-white/15 focus:border-emerald-500/50 focus:outline-none rounded-xl px-3 py-2 text-xs text-neutral-200 transition-colors"
                            />
                          </div>
                          <div>
                            <label className="text-[10px] font-mono uppercase text-[#888888] mb-1 flex items-center gap-1.5">
                              <Phone className="w-3 h-3 text-[#888888]" />
                              Phone Number
                            </label>
                            <input
                              type="tel"
                              value={structuredContent.personal?.phone || ''}
                              onChange={(e) =>
                                setStructuredContent({
                                  ...structuredContent,
                                  personal: {
                                    ...structuredContent.personal,
                                    phone: e.target.value,
                                  },
                                })
                              }
                              placeholder="+91 8978293087"
                              className="w-full bg-[#0D0D0D] border border-white/15 focus:border-emerald-500/50 focus:outline-none rounded-xl px-3 py-2 text-xs text-neutral-200 transition-colors"
                            />
                          </div>
                        </div>

                        {/* LinkedIn & GitHub */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          <div>
                            <label className="text-[10px] font-mono uppercase text-[#888888] mb-1 flex items-center gap-1.5">
                              <Linkedin className="w-3 h-3 text-[#888888]" />
                              LinkedIn URL
                            </label>
                            <input
                              type="url"
                              value={structuredContent.personal?.linkedin || ''}
                              onChange={(e) =>
                                setStructuredContent({
                                  ...structuredContent,
                                  personal: {
                                    ...structuredContent.personal,
                                    linkedin: e.target.value,
                                  },
                                })
                              }
                              placeholder="https://www.linkedin.com/in/mohammed-affan-razvi-855a202ab/"
                              className="w-full bg-[#0D0D0D] border border-white/15 focus:border-emerald-500/50 focus:outline-none rounded-xl px-3 py-2 text-xs text-neutral-200 transition-colors"
                            />
                          </div>
                          <div>
                            <label className="text-[10px] font-mono uppercase text-[#888888] mb-1 flex items-center gap-1.5">
                              <Github className="w-3 h-3 text-[#888888]" />
                              GitHub URL
                            </label>
                            <input
                              type="url"
                              value={structuredContent.personal?.github || ''}
                              onChange={(e) =>
                                setStructuredContent({
                                  ...structuredContent,
                                  personal: {
                                    ...structuredContent.personal,
                                    github: e.target.value,
                                  },
                                })
                              }
                              placeholder="https://github.com/affanengi"
                              className="w-full bg-[#0D0D0D] border border-white/15 focus:border-emerald-500/50 focus:outline-none rounded-xl px-3 py-2 text-xs text-neutral-200 transition-colors"
                            />
                          </div>
                        </div>

                        {/* City & Country */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          <div>
                            <label className="text-[10px] font-mono uppercase text-[#888888] mb-1 flex items-center gap-1.5">
                              <MapPin className="w-3 h-3 text-[#888888]" />
                              City / Region
                            </label>
                            <input
                              type="text"
                              value={structuredContent.personal?.city || ''}
                              onChange={(e) =>
                                setStructuredContent({
                                  ...structuredContent,
                                  personal: {
                                    ...structuredContent.personal,
                                    city: e.target.value,
                                  },
                                })
                              }
                              placeholder="Hyderabad"
                              className="w-full bg-[#0D0D0D] border border-white/15 focus:border-emerald-500/50 focus:outline-none rounded-xl px-3 py-2 text-xs text-neutral-200 transition-colors"
                            />
                          </div>
                          <div>
                            <label className="text-[10px] font-mono uppercase text-[#888888] mb-1 flex items-center gap-1.5">
                              <Globe className="w-3 h-3 text-[#888888]" />
                              Country
                            </label>
                            <input
                              type="text"
                              value={structuredContent.personal?.country || ''}
                              onChange={(e) =>
                                setStructuredContent({
                                  ...structuredContent,
                                  personal: {
                                    ...structuredContent.personal,
                                    country: e.target.value,
                                  },
                                })
                              }
                              placeholder="India"
                              className="w-full bg-[#0D0D0D] border border-white/15 focus:border-emerald-500/50 focus:outline-none rounded-xl px-3 py-2 text-xs text-neutral-200 transition-colors"
                            />
                          </div>
                        </div>

                        {/* Portfolio Website */}
                        <div>
                          <label className="text-[10px] font-mono uppercase text-[#888888] mb-1 flex items-center gap-1.5">
                            <Globe className="w-3 h-3 text-[#888888]" />
                            Portfolio Website
                          </label>
                          <input
                            type="url"
                            value={structuredContent.personal?.portfolio || ''}
                            onChange={(e) =>
                              setStructuredContent({
                                ...structuredContent,
                                personal: {
                                  ...structuredContent.personal,
                                  portfolio: e.target.value,
                                },
                              })
                            }
                            placeholder="https://my-portfolio-henna-tau-72.vercel.app/"
                            className="w-full bg-[#0D0D0D] border border-white/15 focus:border-emerald-500/50 focus:outline-none rounded-xl px-3 py-2 text-xs text-neutral-200 transition-colors"
                          />
                        </div>
                      </div>
                    </div>

                    {/* Professional Summary Field */}
                    <div className="space-y-2 bg-[#161616] p-4 rounded-xl border border-white/10">
                      <div className="flex items-center justify-between">
                        <label className="text-xs font-bold text-white uppercase tracking-wider font-mono">
                          Professional Summary
                        </label>
                        <span className="text-[10px] font-mono text-emerald-400">
                          {structuredContent.summary.length} characters
                        </span>
                      </div>
                      <textarea
                        rows={5}
                        value={structuredContent.summary}
                        onChange={(e) => setStructuredContent({ ...structuredContent, summary: e.target.value })}
                        className="w-full bg-[#0D0D0D] border border-white/15 focus:border-white/30 focus:outline-none rounded-xl p-3 text-xs text-neutral-200 leading-relaxed resize-none"
                      />
                    </div>

                    {/* Technical Skills Categories */}
                    <div className="space-y-3 bg-[#161616] p-4 rounded-xl border border-white/10">
                      <div className="flex items-center justify-between">
                        <label className="text-xs font-bold text-white uppercase tracking-wider font-mono">
                          Technical Skills
                        </label>
                        <span className="text-[10px] font-mono text-[#888888]">
                          {structuredContent.skills.length} categories
                        </span>
                      </div>

                      <div className="space-y-3">
                        {structuredContent.skills.map((cat, catIdx) => (
                          <div key={catIdx} className="space-y-1.5 p-3 rounded-lg bg-[#0D0D0D] border border-white/10">
                            <input
                              type="text"
                              value={cat.category}
                              onChange={(e) => {
                                const updatedSkills = [...structuredContent.skills];
                                updatedSkills[catIdx].category = e.target.value;
                                setStructuredContent({ ...structuredContent, skills: updatedSkills });
                              }}
                              className="font-bold text-xs text-white bg-transparent border-b border-white/10 focus:border-white/30 focus:outline-none pb-1 w-full"
                            />
                            <input
                              type="text"
                              value={cat.items.join(', ')}
                              onChange={(e) => {
                                const updatedSkills = [...structuredContent.skills];
                                updatedSkills[catIdx].items = e.target.value.split(',').map((s) => s.trim()).filter(Boolean);
                                setStructuredContent({ ...structuredContent, skills: updatedSkills });
                              }}
                              className="text-xs text-neutral-300 bg-transparent focus:outline-none w-full font-mono"
                              placeholder="Comma separated skills..."
                            />
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Professional Experience */}
                    <div className="space-y-3 bg-[#161616] p-4 rounded-xl border border-white/10">
                      <div className="flex items-center justify-between">
                        <label className="text-xs font-bold text-white uppercase tracking-wider font-mono">
                          Professional Experience ({structuredContent.experience.length})
                        </label>
                      </div>

                      <div className="space-y-4">
                        {structuredContent.experience.map((exp, expIdx) => (
                          <div key={expIdx} className="space-y-2 p-3.5 rounded-xl bg-[#0D0D0D] border border-white/10">
                            <div className="flex items-center justify-between gap-2">
                              <input
                                type="text"
                                value={exp.title}
                                onChange={(e) => {
                                  const updatedExp = [...structuredContent.experience];
                                  updatedExp[expIdx].title = e.target.value;
                                  setStructuredContent({ ...structuredContent, experience: updatedExp });
                                }}
                                className="font-bold text-xs text-white bg-transparent border-b border-white/10 focus:border-white/30 focus:outline-none pb-0.5 flex-1"
                              />
                              <input
                                type="text"
                                value={exp.company}
                                onChange={(e) => {
                                  const updatedExp = [...structuredContent.experience];
                                  updatedExp[expIdx].company = e.target.value;
                                  setStructuredContent({ ...structuredContent, experience: updatedExp });
                                }}
                                className="text-xs text-neutral-400 bg-transparent border-b border-white/10 focus:border-white/30 focus:outline-none pb-0.5"
                              />
                            </div>
                            <div className="space-y-2 pl-1">
                              {exp.bullets.map((b, bIdx) => (
                                <div key={bIdx} className="flex items-start gap-1.5">
                                  <span className="text-neutral-500 text-xs mt-1">•</span>
                                  <textarea
                                    rows={2}
                                    value={b.text}
                                    onChange={(e) => {
                                      const updatedExp = [...structuredContent.experience];
                                      updatedExp[expIdx].bullets[bIdx].text = e.target.value;
                                      setStructuredContent({ ...structuredContent, experience: updatedExp });
                                    }}
                                    className="flex-1 bg-[#141414] border border-white/10 focus:border-white/30 focus:outline-none rounded-lg p-1.5 text-xs text-neutral-200 leading-relaxed"
                                  />
                                  <button
                                    type="button"
                                    onClick={() => {
                                      const updatedExp = [...structuredContent.experience];
                                      updatedExp[expIdx].bullets = updatedExp[expIdx].bullets.filter((_, idx) => idx !== bIdx);
                                      setStructuredContent({ ...structuredContent, experience: updatedExp });
                                    }}
                                    className="p-1 text-[#666666] hover:text-rose-400 transition-colors mt-1"
                                    title="Delete bullet"
                                  >
                                    <Trash2 className="w-3 h-3" />
                                  </button>
                                </div>
                              ))}

                              <button
                                type="button"
                                onClick={() => {
                                  const updatedExp = [...structuredContent.experience];
                                  updatedExp[expIdx].bullets.push({ text: '', source_fact_ids: [] });
                                  setStructuredContent({ ...structuredContent, experience: updatedExp });
                                }}
                                className="flex items-center gap-1 text-[11px] text-emerald-400 hover:text-emerald-300 font-medium pt-1 cursor-pointer"
                              >
                                <Plus className="w-3 h-3" />
                                <span>Add Substantive Bullet Point</span>
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Technical Projects */}
                    <div className="space-y-3 bg-[#161616] p-4 rounded-xl border border-white/10">
                      <div className="flex items-center justify-between">
                        <label className="text-xs font-bold text-white uppercase tracking-wider font-mono">
                          Technical Projects ({structuredContent.projects.length})
                        </label>
                      </div>

                      <div className="space-y-4">
                        {structuredContent.projects.map((proj, pIdx) => (
                          <div key={pIdx} className="space-y-2 p-3.5 rounded-xl bg-[#0D0D0D] border border-white/10">
                            <div className="flex items-center justify-between gap-2">
                              <input
                                type="text"
                                value={proj.name}
                                onChange={(e) => {
                                  const updatedProjects = [...structuredContent.projects];
                                  updatedProjects[pIdx].name = e.target.value;
                                  setStructuredContent({ ...structuredContent, projects: updatedProjects });
                                }}
                                className="font-bold text-xs text-white bg-transparent border-b border-white/10 focus:border-white/30 focus:outline-none pb-0.5 flex-1"
                              />
                            </div>

                            <input
                              type="text"
                              value={proj.technologies.join(', ')}
                              onChange={(e) => {
                                const updatedProjects = [...structuredContent.projects];
                                updatedProjects[pIdx].technologies = e.target.value.split(',').map((t) => t.trim()).filter(Boolean);
                                setStructuredContent({ ...structuredContent, projects: updatedProjects });
                              }}
                              className="text-[11px] font-mono text-neutral-400 bg-transparent focus:outline-none w-full"
                              placeholder="Technologies (comma separated)..."
                            />

                            <div className="space-y-2 pl-1 pt-1">
                              {proj.bullets.map((b, bIdx) => (
                                <div key={bIdx} className="flex items-start gap-1.5">
                                  <span className="text-neutral-500 text-xs mt-1">•</span>
                                  <textarea
                                    rows={2}
                                    value={b.text}
                                    onChange={(e) => {
                                      const updatedProjects = [...structuredContent.projects];
                                      updatedProjects[pIdx].bullets[bIdx].text = e.target.value;
                                      setStructuredContent({ ...structuredContent, projects: updatedProjects });
                                    }}
                                    className="flex-1 bg-[#141414] border border-white/10 focus:border-white/30 focus:outline-none rounded-lg p-1.5 text-xs text-neutral-200 leading-relaxed"
                                  />
                                  <button
                                    type="button"
                                    onClick={() => {
                                      const updatedProjects = [...structuredContent.projects];
                                      updatedProjects[pIdx].bullets = updatedProjects[pIdx].bullets.filter((_, idx) => idx !== bIdx);
                                      setStructuredContent({ ...structuredContent, projects: updatedProjects });
                                    }}
                                    className="p-1 text-[#666666] hover:text-rose-400 transition-colors mt-1"
                                    title="Delete bullet"
                                  >
                                    <Trash2 className="w-3 h-3" />
                                  </button>
                                </div>
                              ))}

                              <button
                                type="button"
                                onClick={() => {
                                  const updatedProjects = [...structuredContent.projects];
                                  updatedProjects[pIdx].bullets.push({ text: '', source_fact_ids: [] });
                                  setStructuredContent({ ...structuredContent, projects: updatedProjects });
                                }}
                                className="flex items-center gap-1 text-[11px] text-emerald-400 hover:text-emerald-300 font-medium pt-1 cursor-pointer"
                              >
                                <Plus className="w-3 h-3" />
                                <span>Add Substantive Bullet Point</span>
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Courses & Certifications */}
                    {structuredContent.course_certifications && structuredContent.course_certifications.length > 0 && (
                      <div className="space-y-3 bg-[#161616] p-4 rounded-xl border border-white/10">
                        <div className="flex items-center justify-between">
                          <label className="text-xs font-bold text-white uppercase tracking-wider font-mono">
                            Courses &amp; Certifications ({structuredContent.course_certifications.length})
                          </label>
                        </div>

                        <div className="space-y-3">
                          {structuredContent.course_certifications.map((cert, cIdx) => (
                            <div key={cIdx} className="space-y-2 p-3.5 rounded-xl bg-[#0D0D0D] border border-white/10">
                              <div className="flex items-center justify-between gap-2">
                                <input
                                  type="text"
                                  value={cert.title}
                                  onChange={(e) => {
                                    const updated = [...(structuredContent.course_certifications || [])];
                                    updated[cIdx].title = e.target.value;
                                    setStructuredContent({ ...structuredContent, course_certifications: updated });
                                  }}
                                  className="font-bold text-xs text-white bg-transparent border-b border-white/10 focus:border-white/30 focus:outline-none pb-0.5 flex-1"
                                />
                                <input
                                  type="text"
                                  value={cert.completionYear || ''}
                                  placeholder="Year"
                                  onChange={(e) => {
                                    const updated = [...(structuredContent.course_certifications || [])];
                                    updated[cIdx].completionYear = e.target.value;
                                    setStructuredContent({ ...structuredContent, course_certifications: updated });
                                  }}
                                  className="text-xs text-neutral-400 bg-transparent border-b border-white/10 focus:border-white/30 focus:outline-none pb-0.5 w-16 text-right font-mono"
                                />
                              </div>
                              <div className="flex items-center gap-2 text-[11px] text-neutral-400">
                                {cert.provider && <span>Provider: {cert.provider}</span>}
                                {cert.instructor && <span>• Instructor: {cert.instructor}</span>}
                              </div>
                              {cert.certificateUrl && (
                                <div className="text-[11px] font-mono text-emerald-400 truncate">
                                  <a href={cert.certificateUrl} target="_blank" rel="noopener noreferrer" className="hover:underline">
                                    Certificate: {cert.certificateUrl}
                                  </a>
                                </div>
                              )}
                              {cert.description !== undefined && (
                                <textarea
                                  rows={2}
                                  value={cert.description || ''}
                                  onChange={(e) => {
                                    const updated = [...(structuredContent.course_certifications || [])];
                                    updated[cIdx].description = e.target.value;
                                    setStructuredContent({ ...structuredContent, course_certifications: updated });
                                  }}
                                  className="w-full bg-[#141414] border border-white/10 focus:border-white/30 focus:outline-none rounded-lg p-1.5 text-xs text-neutral-200 leading-relaxed"
                                  placeholder="Verified description..."
                                />
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Leadership & Activities */}
                    {structuredContent.leadership && structuredContent.leadership.length > 0 && (
                      <div className="space-y-3 bg-[#161616] p-4 rounded-xl border border-white/10">
                        <div className="flex items-center justify-between">
                          <label className="text-xs font-bold text-white uppercase tracking-wider font-mono">
                            Leadership &amp; Activities ({structuredContent.leadership.length})
                          </label>
                        </div>

                        <div className="space-y-4">
                          {structuredContent.leadership.map((lead, leadIdx) => (
                            <div key={leadIdx} className="space-y-2 p-3.5 rounded-xl bg-[#0D0D0D] border border-white/10">
                              <div className="flex items-center justify-between gap-2">
                                <input
                                  type="text"
                                  value={lead.title}
                                  onChange={(e) => {
                                    const updatedLead = [...(structuredContent.leadership || [])];
                                    updatedLead[leadIdx].title = e.target.value;
                                    setStructuredContent({ ...structuredContent, leadership: updatedLead });
                                  }}
                                  className="font-bold text-xs text-white bg-transparent border-b border-white/10 focus:border-white/30 focus:outline-none pb-0.5 flex-1"
                                />
                                <input
                                  type="text"
                                  value={lead.company}
                                  onChange={(e) => {
                                    const updatedLead = [...(structuredContent.leadership || [])];
                                    updatedLead[leadIdx].company = e.target.value;
                                    setStructuredContent({ ...structuredContent, leadership: updatedLead });
                                  }}
                                  className="text-xs text-neutral-400 bg-transparent border-b border-white/10 focus:border-white/30 focus:outline-none pb-0.5"
                                />
                              </div>
                              <div className="space-y-2 pl-1">
                                {lead.bullets.map((b, bIdx) => (
                                  <div key={bIdx} className="flex items-start gap-1.5">
                                    <span className="text-neutral-500 text-xs mt-1">•</span>
                                    <textarea
                                      rows={2}
                                      value={b.text}
                                      onChange={(e) => {
                                        const updatedLead = [...(structuredContent.leadership || [])];
                                        updatedLead[leadIdx].bullets[bIdx].text = e.target.value;
                                        setStructuredContent({ ...structuredContent, leadership: updatedLead });
                                      }}
                                      className="flex-1 bg-[#141414] border border-white/10 focus:border-white/30 focus:outline-none rounded-lg p-1.5 text-xs text-neutral-200 leading-relaxed"
                                    />
                                    <button
                                      type="button"
                                      onClick={() => {
                                        const updatedLead = [...(structuredContent.leadership || [])];
                                        updatedLead[leadIdx].bullets = updatedLead[leadIdx].bullets.filter((_, idx) => idx !== bIdx);
                                        setStructuredContent({ ...structuredContent, leadership: updatedLead });
                                      }}
                                      className="p-1 text-[#666666] hover:text-rose-400 transition-colors mt-1"
                                      title="Delete bullet"
                                    >
                                      <Trash2 className="w-3 h-3" />
                                    </button>
                                  </div>
                                ))}

                                <button
                                  type="button"
                                  onClick={() => {
                                    const updatedLead = [...(structuredContent.leadership || [])];
                                    updatedLead[leadIdx].bullets.push({ text: '', source_fact_ids: [] });
                                    setStructuredContent({ ...structuredContent, leadership: updatedLead });
                                  }}
                                  className="flex items-center gap-1 text-[11px] text-emerald-400 hover:text-emerald-300 font-medium pt-1 cursor-pointer"
                                >
                                  <Plus className="w-3 h-3" />
                                  <span>Add Substantive Bullet Point</span>
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                ) : (
                  /* LaTeX Source Tab */
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-mono text-[#A3A3A3]">Overleaf-compatible single-column LaTeX source:</span>
                      <button
                        onClick={handleCopyLatex}
                        className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white/10 hover:bg-white/20 text-white text-xs font-mono transition-colors cursor-pointer"
                      >
                        {copiedLatex ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                        <span>{copiedLatex ? 'Copied!' : 'Copy LaTeX'}</span>
                      </button>
                    </div>
                    <pre className="p-4 rounded-xl bg-[#0D0D0D] border border-white/20 text-[11px] font-mono text-neutral-300 overflow-x-auto leading-relaxed max-h-[60vh]">
                      {latexCode}
                    </pre>
                  </div>
                )}
              </div>
            </div>

            {/* RIGHT PANE: ReportLab Canonical PDF Preview & Truth Audit Badge */}
            <div className="lg:col-span-6 flex flex-col h-full overflow-hidden min-h-0 bg-[#0A0A0A]">
              {/* Right Sub-Header: Truth Status & Actions */}
              <div className="px-5 py-2.5 bg-[#181818] border-b border-white/10 flex items-center justify-between shrink-0">
                <div className="flex items-center gap-2">
                  <div className={`px-2.5 py-1 rounded-xl text-xs font-mono font-bold border flex items-center gap-1.5 ${
                    resumeData.validationResult.is_valid
                      ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-400'
                      : 'bg-rose-500/15 border-rose-500/40 text-rose-400'
                  }`}>
                    <ShieldCheck className="w-3.5 h-3.5" />
                    <span>Grounded in Verified Profile</span>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={handleDownloadTex}
                    className="flex items-center gap-1 px-3 py-1.5 rounded-xl bg-[#222222] hover:bg-neutral-700 border border-white/20 text-white text-xs font-semibold transition-colors cursor-pointer"
                    title="Download .TEX LaTeX source file"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>.TEX</span>
                  </button>

                  <button
                    onClick={handleDownloadPdf}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white text-black hover:bg-neutral-200 text-xs font-bold transition-colors cursor-pointer shadow-md"
                    title="Download ReportLab Canonical ATS PDF"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Download PDF</span>
                  </button>
                </div>
              </div>

              {/* PDF Viewer Container */}
              <div className="flex-1 p-4 overflow-hidden min-h-0 flex flex-col relative">
                {pdfBlobUrl ? (
                  <iframe
                    src={pdfBlobUrl}
                    title="ReportLab Resume PDF"
                    className="w-full h-full flex-1 rounded-xl border border-white/20 bg-white shadow-2xl min-h-0"
                  />
                ) : (
                  <div className="flex-1 flex items-center justify-center text-xs text-[#A3A3A3]">
                    <Loader2 className="w-5 h-5 animate-spin mr-2" />
                    Compiling ReportLab PDF...
                  </div>
                )}
              </div>

              {/* Right Footer: Human-In-The-Loop Approval */}
              <div className="px-5 py-3 bg-[#161616] border-t border-white/10 flex items-center justify-between shrink-0">
                <div className="text-[11px] text-[#A3A3A3]">
                  Review the compiled PDF above before approving your application.
                </div>
                <button
                  onClick={async () => {
                    if (isApproving) return;
                    setIsApproving(true);
                    try {
                      const res = await fetchWithAuth('/api/v1/applications/approve-package', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                          jobId,
                          tailoredResumeId: resumeData.id,
                          resumeId: resumeData.id,
                          coverLetterId: coverLetterData?.id || undefined,
                          note: 'Candidate approved application package from Resume Studio',
                        }),
                      });
                      if (!res.ok) {
                        const err = await res.json().catch(() => ({}));
                        throw new Error(err.detail || 'Failed to approve resume package.');
                      }
                      if (onApplicationApproved) onApplicationApproved(resumeData.id);
                      onClose();
                    } catch (err: any) {
                      console.error('Failed to sync approved package to applications:', err);
                      showSaveToast(err.message || 'Error approving application package.');
                    } finally {
                      setIsApproving(false);
                    }
                  }}
                  disabled={!resumeData.validationResult.is_valid || isApproving}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 disabled:opacity-40 text-black text-xs font-bold transition-all cursor-pointer shadow-lg"
                >
                  {isApproving ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <CheckCircle2 className="w-4 h-4" />
                  )}
                  <span>{isApproving ? 'Approving Package...' : 'Approve Resume for Application'}</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>,
    document.body
  );
};
