import React, { useState } from "react";
import {
  Download,
  Copy,
  Check,
  Save,
  FileText,
  ShieldCheck,
  RefreshCw,
  Sliders,
  Loader2,
  Code,
  User,
  Building,
  Award,
  Sparkles,
} from "lucide-react";
import { fetchWithAuth } from "../../lib/api";

export type CoverLetterTone = "professional" | "enthusiastic" | "technical" | "concise";

export interface CoverLetterContent {
  recipientName: string;
  companyName: string;
  jobTitle: string;
  date: string;
  greeting: string;
  subject?: string;
  paragraph1_hook: string;
  paragraph2_evidence: string;
  paragraph3_impact: string;
  signOff: string;
  fullName: string;
  email: string;
  phone?: string;
  city?: string;
  country?: string;
  linkedin?: string;
  github?: string;
  sourceFactIds?: string[];
}

export interface CoverLetterValidationResult {
  is_valid: boolean;
  violations: string[];
  warnings: string[];
}

export interface TailoredCoverLetterDTO {
  id: string;
  userId: string;
  jobId: string;
  tone: CoverLetterTone;
  content: CoverLetterContent;
  markdownText: string;
  validationResult: CoverLetterValidationResult;
  createdAt?: string;
  updatedAt?: string;
}

export interface CoverLetterStudioPaneProps {
  coverLetter: TailoredCoverLetterDTO | null;
  jobTitle: string;
  jobCompany: string;
  isRegenerating?: boolean;
  isGenerating?: boolean;
  onRegenerate: (tone: CoverLetterTone, instructions?: string) => void;
  onCoverLetterUpdated?: (updated: TailoredCoverLetterDTO) => void;
  onSaveEdits?: (updated: TailoredCoverLetterDTO) => void;
  showSaveToast?: (msg: string) => void;
}

export const CoverLetterStudioPane: React.FC<CoverLetterStudioPaneProps> = ({
  coverLetter,
  jobTitle,
  jobCompany,
  isRegenerating = false,
  isGenerating = false,
  onRegenerate,
  onCoverLetterUpdated,
  onSaveEdits,
  showSaveToast,
}) => {
  const isBusy = isRegenerating || isGenerating;
  const [selectedTone, setSelectedTone] = useState<CoverLetterTone>(coverLetter?.tone || "professional");
  const [copied, setCopied] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isDownloadingPdf, setIsDownloadingPdf] = useState(false);
  const [isDownloadingTex, setIsDownloadingTex] = useState(false);

  // Local editable state for manual editing (zero AI calls on edits)
  const [content, setContent] = useState<CoverLetterContent>(() => {
    if (coverLetter?.content) {
      return {
        ...coverLetter.content,
        subject: coverLetter.content.subject || `Application for ${coverLetter.content.jobTitle || jobTitle}`,
        city: coverLetter.content.city || "Hyderabad",
        country: coverLetter.content.country || "India",
        signOff: coverLetter.content.signOff || "Sincerely,",
        greeting: coverLetter.content.greeting || "Dear Hiring Team,",
      };
    }
    return {
      recipientName: "Hiring Team",
      companyName: jobCompany || "Target Company",
      jobTitle: jobTitle || "Target Role",
      date: new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }),
      greeting: "Dear Hiring Team,",
      subject: `Application for ${jobTitle || "Target Role"}`,
      paragraph1_hook: "",
      paragraph2_evidence: "",
      paragraph3_impact: "",
      signOff: "Sincerely,",
      fullName: "Mohammed Affan Razvi",
      email: "affan@example.com",
      phone: "+91 9876543210",
      city: "Hyderabad",
      country: "India",
      linkedin: "https://www.linkedin.com/in/mohammed-affan-razvi-855a202ab/",
      github: "https://github.com/affanengi",
      sourceFactIds: [],
    };
  });

  // Sync if coverLetter prop changes externally (e.g. initial fetch complete)
  React.useEffect(() => {
    if (coverLetter?.content) {
      setContent({
        ...coverLetter.content,
        subject: coverLetter.content.subject || `Application for ${coverLetter.content.jobTitle || jobTitle}`,
        city: coverLetter.content.city || "Hyderabad",
        country: coverLetter.content.country || "India",
        signOff: coverLetter.content.signOff || "Sincerely,",
        greeting: coverLetter.content.greeting || "Dear Hiring Team,",
      });
      setSelectedTone(coverLetter.tone || "professional");
    }
  }, [coverLetter, jobTitle]);

  const handleFieldChange = (field: keyof CoverLetterContent, value: any) => {
    setContent((prev) => ({
      ...prev,
      [field]: value,
    }));
  };

  const handleSaveEdits = async () => {
    if (!coverLetter?.id) return;
    setIsSaving(true);
    try {
      const res = await fetchWithAuth(`/api/v1/cover-letters/${coverLetter.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content,
          tone: selectedTone,
        }),
      });
      if (res.ok) {
        const savedDto = await res.json();
        onCoverLetterUpdated?.(savedDto);
        onSaveEdits?.(savedDto);
        showSaveToast?.("Cover letter saved to database (0 AI calls)");
      } else {
        showSaveToast?.("Failed to save cover letter");
      }
    } catch (err) {
      console.error("Error saving cover letter:", err);
      showSaveToast?.("Error saving cover letter");
    } finally {
      setIsSaving(false);
    }
  };

  const handleCopyToClipboard = () => {
    const loc = content.city ? `${content.city}, ${content.country || "India"}` : (content.country || "");
    const contactLine = [content.email, content.phone, loc, content.linkedin, content.github]
      .filter(Boolean)
      .join(" | ");

    const md = `# ${content.fullName}\n${contactLine}\n\n**Date:** ${content.date}  \n**To:** ${content.recipientName}  \n**Company:** ${content.companyName}  \n**Position:** ${content.jobTitle}  \n**Subject:** ${content.subject}  \n\n${content.greeting}\n\n${content.paragraph1_hook}\n\n${content.paragraph2_evidence}\n\n${content.paragraph3_impact}\n\n${content.signOff}\n**${content.fullName}**`;

    navigator.clipboard.writeText(md);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownloadPdf = async () => {
    setIsDownloadingPdf(true);
    try {
      let res: Response;
      if (coverLetter?.id) {
        res = await fetchWithAuth(`/api/v1/cover-letters/${coverLetter.id}/pdf`);
      } else {
        res = await fetchWithAuth("/api/v1/cover-letters/render-pdf-direct", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(content),
        });
      }

      if (res.ok) {
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        const safeCo = (content.companyName || "Application").replace(/[^a-zA-Z0-9_-]/g, "_");
        a.download = `Cover_Letter_${safeCo}.pdf`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }
    } catch (err) {
      console.error("Error downloading Cover Letter PDF:", err);
    } finally {
      setIsDownloadingPdf(false);
    }
  };

  const handleDownloadTex = async () => {
    setIsDownloadingTex(true);
    try {
      if (coverLetter?.id) {
        const res = await fetchWithAuth(`/api/v1/cover-letters/${coverLetter.id}/tex`);
        if (res.ok) {
          const text = await res.text();
          const blob = new Blob([text], { type: "application/x-tex;charset=utf-8" });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          const safeCo = (content.companyName || "Application").replace(/[^a-zA-Z0-9_-]/g, "_");
          a.download = `Cover_Letter_${safeCo}.tex`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
          return;
        }
      }
    } catch (err) {
      console.error("Error downloading Cover Letter LaTeX:", err);
    } finally {
      setIsDownloadingTex(false);
    }
  };

  const handleDownloadMarkdown = async () => {
    if (coverLetter?.id) {
      const res = await fetchWithAuth(`/api/v1/cover-letters/${coverLetter.id}/markdown`);
      if (res.ok) {
        const text = await res.text();
        const blob = new Blob([text], { type: "text/markdown;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        const safeCo = (content.companyName || "Application").replace(/[^a-zA-Z0-9_-]/g, "_");
        a.download = `Cover_Letter_${safeCo}.md`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }
    } else {
      const loc = content.city ? `${content.city}, ${content.country || "India"}` : (content.country || "");
      const contactLine = [content.email, content.phone, loc, content.linkedin, content.github]
        .filter(Boolean)
        .join(" | ");
      const md = `# ${content.fullName}\n${contactLine}\n\n**Date:** ${content.date}  \n**To:** ${content.recipientName}  \n**Company:** ${content.companyName}  \n**Position:** ${content.jobTitle}  \n**Subject:** ${content.subject}  \n\n${content.greeting}\n\n${content.paragraph1_hook}\n\n${content.paragraph2_evidence}\n\n${content.paragraph3_impact}\n\n${content.signOff}\n**${content.fullName}**`;
      const blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `Cover_Letter_${(content.companyName || "Application").replace(/\s+/g, "_")}.md`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }
  };

  const totalWords = [
    content.paragraph1_hook,
    content.paragraph2_evidence,
    content.paragraph3_impact,
  ]
    .join(" ")
    .split(/\s+/)
    .filter(Boolean).length;

  const readingTimeMins = Math.max(1, Math.ceil(totalWords / 200));

  return (
    <div className="flex flex-col h-full bg-[#0D0D0D] text-white">
      {/* Top Tone & Control Bar */}
      <div className="px-6 py-3 border-b border-white/10 flex items-center justify-between flex-wrap gap-3 bg-[#111111]">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-mono font-medium">
            <ShieldCheck className="w-3.5 h-3.5" />
            <span>Grounded in Verified Profile</span>
          </div>

          <div className="flex items-center gap-2 pl-2 border-l border-white/10">
            <Sliders className="w-3.5 h-3.5 text-[#888888]" />
            <span className="text-xs text-[#888888] font-mono">Tone:</span>
            <div className="flex items-center bg-[#1A1A1A] p-0.5 rounded-lg border border-white/10">
              {(["professional", "enthusiastic", "technical", "concise"] as CoverLetterTone[]).map((t) => (
                <button
                  key={t}
                  onClick={() => {
                    // Only update tone state locally (zero AI request on tab click)
                    setSelectedTone(t);
                  }}
                  disabled={isBusy}
                  className={`px-2.5 py-1 text-[11px] font-medium rounded-md capitalize transition-all cursor-pointer ${
                    selectedTone === t
                      ? "bg-white text-black font-bold shadow-sm"
                      : "text-[#888888] hover:text-white"
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => onRegenerate(selectedTone)}
            disabled={isBusy}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/30 text-xs font-semibold text-emerald-400 transition-colors cursor-pointer disabled:opacity-50"
            title="Regenerate cover letter with Gemini API"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isBusy ? "animate-spin text-emerald-400" : ""}`} />
            <span>Regenerate (1 Gemini Call)</span>
          </button>
        </div>
      </div>

      {/* Main Two-Column Layout */}
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 overflow-hidden">
        {/* LEFT COLUMN: Structured Form Editor (Zero AI calls on edits) */}
        <div className="lg:col-span-6 p-5 border-r border-white/10 overflow-y-auto space-y-4 bg-[#0A0A0A]">
          <div className="flex items-center justify-between pb-2 border-b border-white/10">
            <h3 className="text-xs font-mono uppercase tracking-wider text-[#888888] flex items-center gap-2">
              <FileText className="w-3.5 h-3.5 text-emerald-400" />
              Direct Structure Editor (Zero AI Cost)
            </h3>
            <span className="text-[10px] font-mono text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded">
              Instant Local Recompile
            </span>
          </div>

          {/* Candidate Profile Details */}
          <div className="p-4 rounded-xl bg-[#141414] border border-white/10 space-y-3">
            <div className="text-[11px] font-mono uppercase tracking-wider text-[#888888] flex items-center gap-2 font-semibold">
              <User className="w-3.5 h-3.5 text-emerald-400" />
              <span>Candidate Contact Header</span>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] font-mono text-[#888888]">Full Name</label>
                <input
                  type="text"
                  value={content.fullName}
                  onChange={(e) => handleFieldChange("fullName", e.target.value)}
                  className="w-full mt-0.5 px-2.5 py-1.5 rounded-lg bg-[#0D0D0D] border border-white/10 text-xs text-white focus:outline-none focus:border-white/30"
                />
              </div>
              <div>
                <label className="text-[10px] font-mono text-[#888888]">Email</label>
                <input
                  type="email"
                  value={content.email}
                  onChange={(e) => handleFieldChange("email", e.target.value)}
                  className="w-full mt-0.5 px-2.5 py-1.5 rounded-lg bg-[#0D0D0D] border border-white/10 text-xs text-white focus:outline-none focus:border-white/30"
                />
              </div>
              <div>
                <label className="text-[10px] font-mono text-[#888888]">Phone</label>
                <input
                  type="text"
                  value={content.phone || ""}
                  onChange={(e) => handleFieldChange("phone", e.target.value)}
                  className="w-full mt-0.5 px-2.5 py-1.5 rounded-lg bg-[#0D0D0D] border border-white/10 text-xs text-white focus:outline-none focus:border-white/30"
                />
              </div>
              <div>
                <label className="text-[10px] font-mono text-[#888888]">City & Country</label>
                <div className="grid grid-cols-2 gap-1 mt-0.5">
                  <input
                    type="text"
                    value={content.city || ""}
                    placeholder="City"
                    onChange={(e) => handleFieldChange("city", e.target.value)}
                    className="w-full px-2 py-1.5 rounded-lg bg-[#0D0D0D] border border-white/10 text-xs text-white focus:outline-none focus:border-white/30"
                  />
                  <input
                    type="text"
                    value={content.country || ""}
                    placeholder="Country"
                    onChange={(e) => handleFieldChange("country", e.target.value)}
                    className="w-full px-2 py-1.5 rounded-lg bg-[#0D0D0D] border border-white/10 text-xs text-white focus:outline-none focus:border-white/30"
                  />
                </div>
              </div>
              <div>
                <label className="text-[10px] font-mono text-[#888888]">LinkedIn URL</label>
                <input
                  type="text"
                  value={content.linkedin || ""}
                  placeholder="https://linkedin.com/in/..."
                  onChange={(e) => handleFieldChange("linkedin", e.target.value)}
                  className="w-full mt-0.5 px-2.5 py-1.5 rounded-lg bg-[#0D0D0D] border border-white/10 text-xs text-white focus:outline-none focus:border-white/30"
                />
              </div>
              <div>
                <label className="text-[10px] font-mono text-[#888888]">GitHub URL</label>
                <input
                  type="text"
                  value={content.github || ""}
                  placeholder="https://github.com/..."
                  onChange={(e) => handleFieldChange("github", e.target.value)}
                  className="w-full mt-0.5 px-2.5 py-1.5 rounded-lg bg-[#0D0D0D] border border-white/10 text-xs text-white focus:outline-none focus:border-white/30"
                />
              </div>
            </div>
          </div>

          {/* Application Metadata & Recipient */}
          <div className="p-4 rounded-xl bg-[#141414] border border-white/10 space-y-3">
            <div className="text-[11px] font-mono uppercase tracking-wider text-[#888888] flex items-center gap-2 font-semibold">
              <Building className="w-3.5 h-3.5 text-emerald-400" />
              <span>Application & Recipient Target</span>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] font-mono text-[#888888]">Recipient Name / Team</label>
                <input
                  type="text"
                  value={content.recipientName}
                  onChange={(e) => handleFieldChange("recipientName", e.target.value)}
                  className="w-full mt-0.5 px-2.5 py-1.5 rounded-lg bg-[#0D0D0D] border border-white/10 text-xs text-white focus:outline-none focus:border-white/30"
                />
              </div>
              <div>
                <label className="text-[10px] font-mono text-[#888888]">Company Name</label>
                <input
                  type="text"
                  value={content.companyName}
                  onChange={(e) => handleFieldChange("companyName", e.target.value)}
                  className="w-full mt-0.5 px-2.5 py-1.5 rounded-lg bg-[#0D0D0D] border border-white/10 text-xs text-white focus:outline-none focus:border-white/30"
                />
              </div>
              <div>
                <label className="text-[10px] font-mono text-[#888888]">Target Role</label>
                <input
                  type="text"
                  value={content.jobTitle}
                  onChange={(e) => handleFieldChange("jobTitle", e.target.value)}
                  className="w-full mt-0.5 px-2.5 py-1.5 rounded-lg bg-[#0D0D0D] border border-white/10 text-xs text-white focus:outline-none focus:border-white/30"
                />
              </div>
              <div>
                <label className="text-[10px] font-mono text-[#888888]">Application Date</label>
                <input
                  type="text"
                  value={content.date}
                  onChange={(e) => handleFieldChange("date", e.target.value)}
                  className="w-full mt-0.5 px-2.5 py-1.5 rounded-lg bg-[#0D0D0D] border border-white/10 text-xs text-white focus:outline-none focus:border-white/30"
                />
              </div>
              <div className="col-span-2">
                <label className="text-[10px] font-mono text-[#888888]">Subject Line</label>
                <input
                  type="text"
                  value={content.subject || ""}
                  placeholder={`Application for ${content.jobTitle}`}
                  onChange={(e) => handleFieldChange("subject", e.target.value)}
                  className="w-full mt-0.5 px-2.5 py-1.5 rounded-lg bg-[#0D0D0D] border border-white/10 text-xs text-white focus:outline-none focus:border-white/30"
                />
              </div>
              <div className="col-span-2">
                <label className="text-[10px] font-mono text-[#888888]">Salutation / Greeting</label>
                <input
                  type="text"
                  value={content.greeting}
                  onChange={(e) => handleFieldChange("greeting", e.target.value)}
                  className="w-full mt-0.5 px-2.5 py-1.5 rounded-lg bg-[#0D0D0D] border border-white/10 text-xs text-white focus:outline-none focus:border-white/30"
                />
              </div>
            </div>
          </div>

          {/* Paragraph 1: Hook */}
          <div className="p-4 rounded-xl bg-[#141414] border border-white/10 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-mono uppercase tracking-wider text-[#888888] flex items-center gap-1.5 font-semibold">
                <FileText className="w-3.5 h-3.5 text-emerald-400" />
                <span>1. Introduction & Mission Hook</span>
              </span>
              <span className="text-[10px] font-mono text-[#888888]">
                {content.paragraph1_hook.split(/\s+/).filter(Boolean).length} words
              </span>
            </div>
            <p className="text-[11px] text-[#888888]">
              States role enthusiasm, alignment with {content.companyName || "company"}, and summarizes candidate core identity.
            </p>
            <textarea
              rows={4}
              value={content.paragraph1_hook}
              onChange={(e) => handleFieldChange("paragraph1_hook", e.target.value)}
              className="w-full p-3 rounded-xl bg-[#0D0D0D] border border-white/10 text-xs text-neutral-200 leading-relaxed focus:outline-none focus:border-white/30 resize-y"
              placeholder="Enter opening hook paragraph..."
            />
          </div>

          {/* Paragraph 2: Core Evidence */}
          <div className="p-4 rounded-xl bg-[#141414] border border-white/10 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-mono uppercase tracking-wider text-[#888888] flex items-center gap-1.5 font-semibold">
                <Award className="w-3.5 h-3.5 text-emerald-400" />
                <span>2. Verified Technical Evidence</span>
              </span>
              <span className="text-[10px] font-mono text-[#888888]">
                {content.paragraph2_evidence.split(/\s+/).filter(Boolean).length} words
              </span>
            </div>
            <p className="text-[11px] text-[#888888]">
              Highlights verified projects, achievements, and concrete technical solutions directly solving job needs.
            </p>
            <textarea
              rows={5}
              value={content.paragraph2_evidence}
              onChange={(e) => handleFieldChange("paragraph2_evidence", e.target.value)}
              className="w-full p-3 rounded-xl bg-[#0D0D0D] border border-white/10 text-xs text-neutral-200 leading-relaxed focus:outline-none focus:border-white/30 resize-y"
              placeholder="Enter core technical evidence paragraph..."
            />
          </div>

          {/* Paragraph 3: Impact & Close */}
          <div className="p-4 rounded-xl bg-[#141414] border border-white/10 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-mono uppercase tracking-wider text-[#888888] flex items-center gap-1.5 font-semibold">
                <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
                <span>3. Culture Fit & Closing Call to Action</span>
              </span>
              <span className="text-[10px] font-mono text-[#888888]">
                {content.paragraph3_impact.split(/\s+/).filter(Boolean).length} words
              </span>
            </div>
            <p className="text-[11px] text-[#888888]">
              Connects work ethic, mission alignment, and eager call to action for discussion.
            </p>
            <textarea
              rows={4}
              value={content.paragraph3_impact}
              onChange={(e) => handleFieldChange("paragraph3_impact", e.target.value)}
              className="w-full p-3 rounded-xl bg-[#0D0D0D] border border-white/10 text-xs text-neutral-200 leading-relaxed focus:outline-none focus:border-white/30 resize-y"
              placeholder="Enter closing paragraph..."
            />
          </div>

          {/* Sign Off */}
          <div className="p-4 rounded-xl bg-[#141414] border border-white/10 flex items-center justify-between gap-4">
            <div className="flex-1">
              <label className="text-[10px] font-mono text-[#888888]">Formal Sign-off</label>
              <input
                type="text"
                value={content.signOff}
                onChange={(e) => handleFieldChange("signOff", e.target.value)}
                className="w-full mt-0.5 px-2.5 py-1.5 rounded-lg bg-[#0D0D0D] border border-white/10 text-xs text-white focus:outline-none focus:border-white/30"
              />
            </div>
            <div className="flex-1">
              <label className="text-[10px] font-mono text-[#888888]">Candidate Signature Name</label>
              <input
                type="text"
                value={content.fullName}
                onChange={(e) => handleFieldChange("fullName", e.target.value)}
                className="w-full mt-0.5 px-2.5 py-1.5 rounded-lg bg-[#0D0D0D] border border-white/10 text-xs text-white focus:outline-none focus:border-white/30"
              />
            </div>
          </div>
        </div>

        {/* RIGHT COLUMN: Realistic Overleaf Document Paper Preview */}
        <div className="lg:col-span-6 bg-[#080808] p-5 overflow-y-auto flex flex-col justify-between max-h-full">
          <div>
            {/* Top Preview Meta Header */}
            <div className="flex items-center justify-between pb-3 border-b border-white/10 mb-4">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-emerald-400" />
                <span className="text-[11px] font-mono text-emerald-400 font-semibold">
                  Grounded in Verified Profile
                </span>
              </div>
              <div className="text-[10px] font-mono text-[#888888] flex items-center gap-2">
                <span>{totalWords} words</span>
                <span>•</span>
                <span>~{readingTimeMins} min read</span>
              </div>
            </div>

            {/* Overleaf Standalone Document Paper Mockup */}
            <div className="bg-white text-[#0f172a] rounded-lg p-8 shadow-2xl space-y-4 font-serif text-[12.5px] leading-relaxed max-w-xl mx-auto border border-neutral-300">
              {/* 1. Header (Centered) */}
              <div className="text-center space-y-1 font-sans border-b border-neutral-200 pb-3">
                <h1 className="text-lg font-bold text-neutral-900 tracking-tight">
                  {content.fullName || "Mohammed Affan Razvi"}
                </h1>
                <div className="text-[11px] text-neutral-600">
                  {content.city ? `${content.city}, ${content.country || "India"}` : (content.country || "India")}
                </div>
                <div className="text-[10.5px] text-neutral-700 flex items-center justify-center gap-1.5 flex-wrap font-sans">
                  {content.email && <span>{content.email}</span>}
                  {content.phone && (
                    <>
                      <span>|</span>
                      <span>{content.phone}</span>
                    </>
                  )}
                  {content.linkedin && (
                    <>
                      <span>|</span>
                      <a href={content.linkedin} target="_blank" rel="noreferrer" className="text-neutral-900 underline hover:text-emerald-700">
                        LinkedIn
                      </a>
                    </>
                  )}
                  {content.github && (
                    <>
                      <span>|</span>
                      <a href={content.github} target="_blank" rel="noreferrer" className="text-neutral-900 underline hover:text-emerald-700">
                        GitHub
                      </a>
                    </>
                  )}
                </div>
              </div>

              {/* 2. Date & Recipient Grid (Recipient Left, Date Right) */}
              <div className="flex items-start justify-between text-[11.5px] font-sans pt-1">
                <div className="space-y-0.5">
                  <div className="font-bold text-neutral-900">{content.recipientName || "Hiring Team"}</div>
                  <div className="text-neutral-700">{content.companyName || "Target Company"}</div>
                </div>
                <div className="font-bold text-neutral-900 text-right">
                  {content.date}
                </div>
              </div>

              {/* 3. Salutation & Subject */}
              <div className="font-sans space-y-1 pt-1">
                <div className="text-neutral-900 text-[12px]">
                  {content.greeting || "Dear Hiring Team,"}
                </div>
                <div className="font-bold text-neutral-900 text-[12px]">
                  Subject: {content.subject || `Application for ${content.jobTitle}`}
                </div>
              </div>

              {/* 4. Body Paragraphs */}
              <p className="text-neutral-800 text-justify leading-relaxed font-sans text-[12px]">
                {content.paragraph1_hook || (
                  <span className="text-neutral-400 italic">Paragraph 1 (Introduction & Hook) will appear here...</span>
                )}
              </p>

              <p className="text-neutral-800 text-justify leading-relaxed font-sans text-[12px]">
                {content.paragraph2_evidence || (
                  <span className="text-neutral-400 italic">Paragraph 2 (Core Evidence & Project Alignment) will appear here...</span>
                )}
              </p>

              <p className="text-neutral-800 text-justify leading-relaxed font-sans text-[12px]">
                {content.paragraph3_impact || (
                  <span className="text-neutral-400 italic">Paragraph 3 (Transferable Impact & Closing) will appear here...</span>
                )}
              </p>

              {/* 5. Closing Sign-off */}
              <div className="pt-3 font-sans space-y-4 text-neutral-900">
                <div>{content.signOff || "Sincerely,"}</div>
                <div className="font-bold text-[12.5px]">{content.fullName || "Mohammed Affan Razvi"}</div>
              </div>
            </div>
          </div>

          {/* Bottom Action Bar */}
          <div className="pt-4 mt-4 border-t border-white/10 flex items-center justify-between gap-2 flex-wrap">
            <button
              onClick={handleSaveEdits}
              disabled={isSaving}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-emerald-500 text-black text-xs font-semibold hover:bg-emerald-400 transition-colors cursor-pointer shadow-md disabled:opacity-50"
            >
              {isSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
              <span>Save Changes</span>
            </button>

            <div className="flex items-center gap-2">
              <button
                onClick={handleCopyToClipboard}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/15 text-white text-xs font-semibold transition-colors cursor-pointer"
                title="Copy markdown text to clipboard"
              >
                {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copied ? "Copied!" : "Copy Text"}</span>
              </button>

              <button
                onClick={handleDownloadTex}
                disabled={isDownloadingTex}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-[#1F1F1F] hover:bg-white/10 border border-white/15 text-neutral-300 hover:text-white text-xs font-mono transition-colors cursor-pointer disabled:opacity-50"
                title="Download Overleaf Standalone LaTeX (.tex)"
              >
                {isDownloadingTex ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Code className="w-3.5 h-3.5" />}
                <span>.TEX</span>
              </button>

              <button
                onClick={handleDownloadMarkdown}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/15 text-white text-xs font-semibold transition-colors cursor-pointer"
                title="Download Markdown (.md)"
              >
                <FileText className="w-3.5 h-3.5 text-neutral-300" />
                <span>Markdown</span>
              </button>

              <button
                onClick={handleDownloadPdf}
                disabled={isDownloadingPdf}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white text-black hover:bg-neutral-200 text-xs font-bold transition-colors cursor-pointer shadow-sm disabled:opacity-50"
                title="Download ReportLab ATS PDF"
              >
                {isDownloadingPdf ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Download className="w-3.5 h-3.5" />
                )}
                <span>Download PDF</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
