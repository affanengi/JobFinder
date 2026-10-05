import React, { useState, useEffect } from "react";
import { 
  FileText, 
  ShieldCheck, 
  Download, 
  Sparkles, 
  Clock, 
  Loader2, 
  ArrowRight,
  Code,
  Building,
  Trash2,
  Mail,
  Gauge
} from "lucide-react";
import { fetchWithAuth } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { ResumeStudioModal, TailoredResumeDTO } from "../components/resume/ResumeStudioModal";
import { TailoredCoverLetterDTO } from "../components/resume/CoverLetterStudioPane";
import { DeleteConfirmModal } from "../components/ui/DeleteConfirmModal";

interface ResumesPageProps {
  onNavigateToOpportunities?: () => void;
  onNavigateToScanner?: (resumeId: string, jobId?: string) => void;
}

export const ResumesPage: React.FC<ResumesPageProps> = ({ 
  onNavigateToOpportunities,
  onNavigateToScanner,
}) => {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<"resumes" | "cover_letters">("resumes");
  const [resumes, setResumes] = useState<TailoredResumeDTO[]>([]);
  const [coverLetters, setCoverLetters] = useState<TailoredCoverLetterDTO[]>([]);
  const [loading, setLoading] = useState(true);

  // Selected for studio
  const [studioConfig, setStudioConfig] = useState<{
    isOpen: boolean;
    jobId: string;
    jobTitle: string;
    jobCompany: string;
    initialTab: "resume" | "cover_letter";
    existingResume?: TailoredResumeDTO | null;
  } | null>(null);

  // Deletion modals
  const [resumeToDelete, setResumeToDelete] = useState<TailoredResumeDTO | null>(null);
  const [letterToDelete, setLetterToDelete] = useState<TailoredCoverLetterDTO | null>(null);

  // Action loaders
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  const fetchResumes = async () => {
    try {
      const res = await fetchWithAuth("/api/v1/resumes", {
        headers: {
          "X-User-Id": user?.uid || "user_default",
        },
      });
      if (res.ok) {
        const data = await res.json();
        setResumes(Array.isArray(data) ? data : []);
      }
    } catch (err: any) {
      console.error("Error fetching tailored resumes:", err);
    }
  };

  const fetchCoverLetters = async () => {
    try {
      const res = await fetchWithAuth("/api/v1/cover-letters", {
        headers: {
          "X-User-Id": user?.uid || "user_default",
        },
      });
      if (res.ok) {
        const data = await res.json();
        setCoverLetters(Array.isArray(data) ? data : []);
      }
    } catch (err: any) {
      console.error("Error fetching cover letters:", err);
    }
  };

  const loadAll = async () => {
    setLoading(true);
    try {
      await Promise.all([fetchResumes(), fetchCoverLetters()]);
    } catch (err: any) {
      console.error("Error loading application artifacts:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAll();
  }, [user]);

  // Resume Actions
  const handleDownloadResumePdf = async (resume: TailoredResumeDTO) => {
    setDownloadingId(resume.id);
    try {
      const res = await fetchWithAuth(`/api/v1/resumes/${resume.id}/pdf`);
      if (res.ok) {
        const blob = await res.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        const safeCompany = resume.jobCompany.replace(/\s+/g, "_");
        a.download = `${safeCompany}_${resume.id}.pdf`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
      }
    } catch (err) {
      console.error("Error downloading resume PDF:", err);
    } finally {
      setDownloadingId(null);
    }
  };

  const handleDownloadResumeTex = async (resume: TailoredResumeDTO) => {
    try {
      const res = await fetchWithAuth(`/api/v1/resumes/${resume.id}/tex`);
      if (res.ok) {
        const text = await res.text();
        const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        const safeCompany = resume.jobCompany.replace(/\s+/g, "_");
        a.download = `${safeCompany}_${resume.id}.tex`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
      }
    } catch (err) {
      console.error("Error downloading resume LaTeX:", err);
    }
  };

  const handleConfirmDeleteResume = async () => {
    if (!resumeToDelete) return;
    try {
      const res = await fetchWithAuth(`/api/v1/resumes/${resumeToDelete.id}`, {
        method: "DELETE",
        headers: {
          "X-User-Id": user?.uid || "user_default",
        },
      });
      if (res.ok) {
        setResumes((prev) => prev.filter((r) => r.id !== resumeToDelete.id));
        setResumeToDelete(null);
      }
    } catch (err) {
      console.error("Error deleting resume:", err);
    }
  };

  // Cover Letter Actions
  const handleDownloadLetterPdf = async (letter: TailoredCoverLetterDTO) => {
    setDownloadingId(letter.id);
    try {
      const res = await fetchWithAuth(`/api/v1/cover-letters/${letter.id}/pdf`);
      if (res.ok) {
        const blob = await res.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        const safeCompany = (letter.content.companyName || "Application").replace(/[^a-zA-Z0-9_-]/g, "_");
        a.download = `Cover_Letter_${safeCompany}.pdf`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
      }
    } catch (err) {
      console.error("Error downloading cover letter PDF:", err);
    } finally {
      setDownloadingId(null);
    }
  };

  const handleDownloadLetterTex = async (letter: TailoredCoverLetterDTO) => {
    try {
      const res = await fetchWithAuth(`/api/v1/cover-letters/${letter.id}/tex`);
      if (res.ok) {
        const text = await res.text();
        const blob = new Blob([text], { type: "application/x-tex;charset=utf-8" });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        const safeCompany = (letter.content.companyName || "Application").replace(/[^a-zA-Z0-9_-]/g, "_");
        a.download = `Cover_Letter_${safeCompany}.tex`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
      }
    } catch (err) {
      console.error("Error downloading cover letter LaTeX:", err);
    }
  };

  const handleDownloadLetterMd = async (letter: TailoredCoverLetterDTO) => {
    try {
      const res = await fetchWithAuth(`/api/v1/cover-letters/${letter.id}/markdown`);
      if (res.ok) {
        const text = await res.text();
        const blob = new Blob([text], { type: "text/markdown;charset=utf-8" });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        const safeCompany = (letter.content.companyName || "Application").replace(/[^a-zA-Z0-9_-]/g, "_");
        a.download = `Cover_Letter_${safeCompany}.md`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
      }
    } catch (err) {
      console.error("Error downloading cover letter Markdown:", err);
    }
  };

  const handleConfirmDeleteLetter = async () => {
    if (!letterToDelete) return;
    try {
      const res = await fetchWithAuth(`/api/v1/cover-letters/${letterToDelete.id}`, {
        method: "DELETE",
        headers: {
          "X-User-Id": user?.uid || "user_default",
        },
      });
      if (res.ok) {
        setCoverLetters((prev) => prev.filter((l) => l.id !== letterToDelete.id));
        setLetterToDelete(null);
      }
    } catch (err) {
      console.error("Error deleting cover letter:", err);
    }
  };

  return (
    <div className="space-y-6 max-w-6xl mx-auto px-4 sm:px-6 py-6 animate-fade-in">
      {/* Header Banner */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-white/10 pb-6">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="px-2 py-0.5 rounded-md text-[10px] font-mono font-bold bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 uppercase tracking-wider">
              Application Artifacts Hub
            </span>
            <span className="text-xs text-[#888888] font-mono">100% Grounded</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-white flex items-center gap-2.5">
            <FileText className="w-6 h-6 text-emerald-400" />
            <span>Resumes & Tailoring</span>
          </h1>
          <p className="text-xs text-[#A3A3A3] leading-relaxed max-w-2xl">
            Access, view, download, and manage your saved ATS-optimized resumes and tailored cover letters. All documents are grounded exclusively in your verified career truth.
          </p>
        </div>

        {/* View Switcher Tabs */}
        <div className="flex items-center bg-[#161616] p-1 rounded-xl border border-white/10 self-start md:self-auto shrink-0">
          <button
            onClick={() => setActiveTab("resumes")}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
              activeTab === "resumes"
                ? "bg-emerald-500 text-black shadow-md font-bold"
                : "text-[#888888] hover:text-white"
            }`}
          >
            <FileText className="w-3.5 h-3.5" />
            <span>Resumes</span>
            <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-mono ${
              activeTab === "resumes" ? "bg-black/20 text-black" : "bg-white/10 text-neutral-300"
            }`}>
              {resumes.length}
            </span>
          </button>

          <button
            onClick={() => setActiveTab("cover_letters")}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
              activeTab === "cover_letters"
                ? "bg-emerald-500 text-black shadow-md font-bold"
                : "text-[#888888] hover:text-white"
            }`}
          >
            <Mail className="w-3.5 h-3.5" />
            <span>Cover Letters</span>
            <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-mono ${
              activeTab === "cover_letters" ? "bg-black/20 text-black" : "bg-white/10 text-neutral-300"
            }`}>
              {coverLetters.length}
            </span>
          </button>
        </div>
      </div>

      {/* Content Area */}
      {loading ? (
        <div className="flex flex-col items-center justify-center py-20 space-y-3">
          <Loader2 className="w-6 h-6 text-emerald-400 animate-spin" />
          <p className="text-xs text-[#888888] font-mono">Loading saved application documents...</p>
        </div>
      ) : activeTab === "resumes" ? (
        /* ================= RESUMES TAB ================= */
        resumes.length === 0 ? (
          <div className="bg-[#121212] border border-dashed border-white/20 rounded-2xl p-10 text-center space-y-4 max-w-lg mx-auto">
            <div className="w-12 h-12 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center mx-auto text-[#888888]">
              <FileText className="w-6 h-6" />
            </div>
            <div className="space-y-1">
              <h3 className="text-sm font-bold text-white">No Tailored Resumes Yet</h3>
              <p className="text-xs text-[#A3A3A3] leading-relaxed">
                When you click <span className="text-emerald-400 font-semibold">Tailor</span> on any opportunity and approve the resume, it is automatically saved here for one-click PDF and LaTeX download.
              </p>
            </div>
            {onNavigateToOpportunities && (
              <button
                onClick={onNavigateToOpportunities}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-white text-black font-bold text-xs hover:bg-neutral-200 transition-colors cursor-pointer"
              >
                <span>Explore Opportunities</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {resumes.map((resume) => {
              const matchedCount = resume.structuredContent?.job_alignment?.matched_skills?.length || 0;
              const transferCount = resume.structuredContent?.job_alignment?.transferable_strengths?.length || 0;
              const projectCount = resume.structuredContent?.projects?.length || 0;
              const displayDate = resume.updatedAt || resume.createdAt;
              const dateStr = displayDate ? new Date(displayDate).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "Recent";
              const isUpdated = Boolean(resume.updatedAt && resume.updatedAt !== resume.createdAt);

              return (
                <div
                  key={resume.id}
                  className="bg-[#161616] border border-white/20 hover:border-white/40 rounded-2xl p-5 space-y-4 shadow-sm transition-all hover:bg-[#1A1A1A] flex flex-col justify-between group"
                >
                  <div className="space-y-3">
                    {/* Card Top Row */}
                    <div className="flex items-start justify-between gap-3">
                      <div className="space-y-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <Building className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                          <span className="text-xs font-bold text-neutral-300">{resume.jobCompany}</span>
                        </div>
                        <h3 className="text-sm font-bold text-white tracking-tight truncate">
                          {resume.jobTitle}
                        </h3>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <span className="px-2 py-0.5 rounded-lg text-[10px] font-mono font-bold bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 flex items-center gap-1">
                          <ShieldCheck className="w-3 h-3" />
                          <span>Score: {resume.validationResult.truth_score}%</span>
                        </span>

                        {/* Delete Button */}
                        <button
                          onClick={() => setResumeToDelete(resume)}
                          className="p-1 rounded-lg text-[#666666] hover:text-rose-400 hover:bg-white/5 transition-colors cursor-pointer"
                          title="Delete tailored resume"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    {/* Summary Snippet */}
                    {resume.structuredContent?.summary && (
                      <p className="text-xs text-neutral-300 line-clamp-2 leading-relaxed bg-[#0D0D0D] p-3 rounded-xl border border-white/10">
                        {resume.structuredContent.summary}
                      </p>
                    )}

                    {/* Alignment & Verified Metrics */}
                    <div className="flex flex-wrap items-center gap-2 text-[10px] font-mono text-[#888888]">
                      <span className="px-2 py-0.5 rounded bg-[#222222] border border-white/10 text-neutral-300">
                        {matchedCount} Verified Skills
                      </span>
                      {transferCount > 0 && (
                        <span className="px-2 py-0.5 rounded bg-sky-500/10 border border-sky-500/20 text-sky-300">
                          {transferCount} Transferable Highlights
                        </span>
                      )}
                      <span className="px-2 py-0.5 rounded bg-[#222222] border border-white/10 text-neutral-300">
                        {projectCount} Projects
                      </span>
                      <span className="flex items-center gap-1 text-[#666666] ml-auto">
                        <Clock className="w-3 h-3" />
                        <span>{isUpdated ? "Updated " + dateStr : dateStr}</span>
                      </span>
                    </div>
                  </div>

                  {/* Actions Footer */}
                  <div className="flex items-center justify-between gap-2 pt-3 border-t border-white/10 flex-wrap">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setStudioConfig({
                          isOpen: true,
                          jobId: resume.jobId,
                          jobTitle: resume.jobTitle,
                          jobCompany: resume.jobCompany,
                          initialTab: "resume",
                          existingResume: resume,
                        })}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#222222] hover:bg-neutral-700 border border-white/20 text-white text-xs font-semibold transition-colors cursor-pointer"
                      >
                        <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
                        <span>Open Studio</span>
                      </button>

                      {/* Run ATS Scan Button */}
                      {onNavigateToScanner && (
                        <button
                          onClick={() => onNavigateToScanner(resume.id, resume.jobId)}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/40 text-emerald-300 hover:text-emerald-200 text-xs font-semibold transition-colors cursor-pointer"
                          title="Run 100-Point ATS Scanner on this resume"
                        >
                          <Gauge className="w-3.5 h-3.5 text-emerald-400" />
                          <span>Run ATS Scan</span>
                        </button>
                      )}
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleDownloadResumeTex(resume)}
                        className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-[#1F1F1F] hover:bg-white/10 border border-white/15 text-neutral-300 hover:text-white text-xs font-mono transition-colors cursor-pointer"
                        title="Download LaTeX Source (.tex)"
                      >
                        <Code className="w-3 h-3" />
                        <span>.TEX</span>
                      </button>

                      <button
                        onClick={() => handleDownloadResumePdf(resume)}
                        disabled={downloadingId === resume.id}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white text-black hover:bg-neutral-200 text-xs font-bold transition-colors cursor-pointer shadow-sm disabled:opacity-50"
                        title="Download ATS ReportLab PDF"
                      >
                        {downloadingId === resume.id ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Download className="w-3.5 h-3.5" />
                        )}
                        <span>Download PDF</span>
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )
      ) : (
        /* ================= COVER LETTERS TAB ================= */
        coverLetters.length === 0 ? (
          <div className="bg-[#121212] border border-dashed border-white/20 rounded-2xl p-10 text-center space-y-4 max-w-lg mx-auto">
            <div className="w-12 h-12 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center mx-auto text-[#888888]">
              <Mail className="w-6 h-6 text-emerald-400" />
            </div>
            <div className="space-y-1">
              <h3 className="text-sm font-bold text-white">No Tailored Cover Letters Yet</h3>
              <p className="text-xs text-[#A3A3A3] leading-relaxed">
                When you generate or approve a tailored cover letter in the studio, it is automatically saved here for one-click PDF, LaTeX, and Markdown export.
              </p>
            </div>
            {onNavigateToOpportunities && (
              <button
                onClick={onNavigateToOpportunities}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-white text-black font-bold text-xs hover:bg-neutral-200 transition-colors cursor-pointer"
              >
                <span>Explore Opportunities</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {coverLetters.map((letter) => {
              const fullText = [
                letter.content.paragraph1_hook,
                letter.content.paragraph2_evidence,
                letter.content.paragraph3_impact,
                letter.content.signOff
              ].filter(Boolean).join(" ");
              const wordCount = fullText.split(/\s+/).filter(Boolean).length;
              const displayDate = letter.updatedAt || letter.createdAt;
              const dateStr = displayDate ? new Date(displayDate).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "Recent";
              const isUpdated = Boolean(letter.updatedAt && letter.updatedAt !== letter.createdAt);

              return (
                <div
                  key={letter.id}
                  className="bg-[#161616] border border-white/20 hover:border-white/40 rounded-2xl p-5 space-y-4 shadow-sm transition-all hover:bg-[#1A1A1A] flex flex-col justify-between group"
                >
                  <div className="space-y-3">
                    {/* Card Top Row */}
                    <div className="flex items-start justify-between gap-3">
                      <div className="space-y-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <Building className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                          <span className="text-xs font-bold text-neutral-300">{letter.content.companyName}</span>
                        </div>
                        <h3 className="text-sm font-bold text-white tracking-tight truncate">
                          {letter.content.jobTitle}
                        </h3>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <span className="px-2 py-0.5 rounded-lg text-[10px] font-mono font-bold bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 capitalize">
                          {letter.tone} Tone
                        </span>

                        <button
                          onClick={() => setLetterToDelete(letter)}
                          className="p-1 rounded-lg text-[#666666] hover:text-rose-400 hover:bg-white/5 transition-colors cursor-pointer"
                          title="Delete tailored cover letter"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    {/* Hook Snippet */}
                    <div className="bg-[#0D0D0D] p-3 rounded-xl border border-white/10 space-y-1.5">
                      <div className="text-[10px] font-mono font-semibold text-[#888888] uppercase tracking-wider">
                        Hook & Subject
                      </div>
                      <p className="text-xs text-neutral-300 line-clamp-2 leading-relaxed">
                        {letter.content.paragraph1_hook || "Authentic introduction tailored to role requirements..."}
                      </p>
                    </div>

                    {/* Metadata Badges */}
                    <div className="flex flex-wrap items-center gap-2 text-[10px] font-mono text-[#888888]">
                      <span className="px-2 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 flex items-center gap-1 font-semibold">
                        <ShieldCheck className="w-3 h-3" />
                        <span>Grounded in Verified Profile</span>
                      </span>
                      <span className="px-2 py-0.5 rounded bg-[#222222] border border-white/10 text-neutral-300">
                        {wordCount} words
                      </span>
                      <span className="flex items-center gap-1 text-[#666666] ml-auto">
                        <Clock className="w-3 h-3" />
                        <span>{isUpdated ? "Updated " + dateStr : dateStr}</span>
                      </span>
                    </div>
                  </div>

                  {/* Actions Footer */}
                  <div className="flex items-center justify-between gap-2 pt-3 border-t border-white/10 flex-wrap">
                    <button
                      onClick={() => setStudioConfig({
                        isOpen: true,
                        jobId: letter.jobId,
                        jobTitle: letter.content.jobTitle,
                        jobCompany: letter.content.companyName,
                        initialTab: "cover_letter",
                        existingResume: resumes.find((r) => r.jobId === letter.jobId) || null,
                      })}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#222222] hover:bg-neutral-700 border border-white/20 text-white text-xs font-semibold transition-colors cursor-pointer"
                    >
                      <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
                      <span>Open Studio</span>
                    </button>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleDownloadLetterTex(letter)}
                        className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-[#1F1F1F] hover:bg-white/10 border border-white/15 text-neutral-300 hover:text-white text-xs font-mono transition-colors cursor-pointer"
                        title="Download Overleaf Standalone LaTeX (.tex)"
                      >
                        <Code className="w-3 h-3" />
                        <span>.TEX</span>
                      </button>

                      <button
                        onClick={() => handleDownloadLetterMd(letter)}
                        className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-[#1F1F1F] hover:bg-white/10 border border-white/15 text-neutral-300 hover:text-white text-xs font-mono transition-colors cursor-pointer"
                        title="Download Markdown (.md)"
                      >
                        <FileText className="w-3 h-3" />
                        <span>.MD</span>
                      </button>

                      <button
                        onClick={() => handleDownloadLetterPdf(letter)}
                        disabled={downloadingId === letter.id}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white text-black hover:bg-neutral-200 text-xs font-bold transition-colors cursor-pointer shadow-sm disabled:opacity-50"
                        title="Download ReportLab ATS PDF"
                      >
                        {downloadingId === letter.id ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Download className="w-3.5 h-3.5" />
                        )}
                        <span>Download PDF</span>
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )
      )}

      {/* Resume Studio Modal */}
      {studioConfig && (
        <ResumeStudioModal
          isOpen={studioConfig.isOpen}
          onClose={() => {
            setStudioConfig(null);
            loadAll();
          }}
          jobId={studioConfig.jobId}
          jobTitle={studioConfig.jobTitle}
          jobCompany={studioConfig.jobCompany}
          initialTab={studioConfig.initialTab}
          existingResume={studioConfig.existingResume}
          onApplicationApproved={() => {
            loadAll();
          }}
        />
      )}

      {/* Delete Resume Confirmation Modal */}
      {resumeToDelete && (
        <DeleteConfirmModal
          isOpen={!!resumeToDelete}
          title="Delete Tailored Resume"
          itemName={`${resumeToDelete.jobCompany} — ${resumeToDelete.jobTitle}`}
          message="Are you sure you want to delete this tailored resume? This will permanently remove the structured content, LaTeX source, and compiled PDF from Cloud Firestore."
          onConfirm={handleConfirmDeleteResume}
          onClose={() => setResumeToDelete(null)}
        />
      )}

      {/* Delete Cover Letter Confirmation Modal */}
      {letterToDelete && (
        <DeleteConfirmModal
          isOpen={!!letterToDelete}
          title="Delete Tailored Cover Letter"
          itemName={`${letterToDelete.content.companyName} — ${letterToDelete.content.jobTitle}`}
          message="Are you sure you want to delete this tailored cover letter? This will permanently remove the structured document, LaTeX source, and compiled PDF from Cloud Firestore."
          onConfirm={handleConfirmDeleteLetter}
          onClose={() => setLetterToDelete(null)}
        />
      )}
    </div>
  );
};

export default ResumesPage;
