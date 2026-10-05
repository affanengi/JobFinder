import React, { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { useScrollLock } from "../../hooks/useScrollLock";
import { X, Award, ExternalLink, Calendar, Building2, Loader2, User } from "lucide-react";

export interface CourseCertificationFact {
  id: string;
  title: string;
  certificateUrl?: string | null;
  completionYear?: string | null;
  description?: string | null;
  provider?: string | null;
  instructor?: string | null;
  credentialId?: string | null;
  skills?: string[];
  verified?: boolean;
  source?: string;
  createdAt?: string;
  updatedAt?: string;
}

interface EditCourseModalProps {
  isOpen: boolean;
  onClose: () => void;
  course: CourseCertificationFact | null;
  onSave: (course: CourseCertificationFact) => Promise<void>;
}

export const EditCourseModal: React.FC<EditCourseModalProps> = ({
  isOpen,
  onClose,
  course,
  onSave,
}) => {
  const [title, setTitle] = useState("");
  const [completionYear, setCompletionYear] = useState("");
  const [certificateUrl, setCertificateUrl] = useState("");
  const [provider, setProvider] = useState("");
  const [instructor, setInstructor] = useState("");
  const [description, setDescription] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  useScrollLock(isOpen);

  useEffect(() => {
    if (course) {
      setTitle(course.title || "");
      setCompletionYear(course.completionYear || "");
      setCertificateUrl(course.certificateUrl || "");
      setProvider(course.provider || "");
      setInstructor(course.instructor || "");
      setDescription(course.description || "");
    } else {
      setTitle("");
      setCompletionYear("2024");
      setCertificateUrl("");
      setProvider("");
      setInstructor("");
      setDescription("");
    }
  }, [course, isOpen]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;

    setIsSaving(true);
    try {
      const savedCourse: CourseCertificationFact = {
        id: course?.id || `course-cert-${Date.now()}`,
        title: title.trim(),
        completionYear: completionYear.trim() || undefined,
        certificateUrl: certificateUrl.trim() || undefined,
        provider: provider.trim() || undefined,
        instructor: instructor.trim() || undefined,
        description: description.trim() || undefined,
        verified: true,
        source: course?.source || "candidate_confirmed",
        createdAt: course?.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      await onSave(savedCourse);
      onClose();
    } catch (err) {
      console.error("Failed to save course certification:", err);
    } finally {
      setIsSaving(false);
    }
  };

  return createPortal(
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget && !isSaving) {
          onClose();
        }
      }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xl animate-in fade-in duration-150"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg bg-[#161616] border border-white/20 rounded-2xl p-6 shadow-2xl space-y-5 animate-in zoom-in-95 duration-150 max-h-[90vh] overflow-y-auto"
      >
        <div className="flex items-center justify-between border-b border-white/10 pb-3">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 flex items-center justify-center text-xs">
              <Award className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-white">
                {course ? "Edit Verified Course / Certification" : "Add Course / Certification"}
              </h2>
              <p className="text-[11px] text-[#A3A3A3]">
                Candidate-confirmed course record with verifiable link for ATS tailoring.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-[#A3A3A3] hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-[11px] font-medium text-[#A3A3A3] mb-1">
              Course / Certification Title <span className="text-rose-400">*</span>
            </label>
            <div className="relative">
              <Award className="w-3.5 h-3.5 text-[#666666] absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                required
                placeholder="e.g. R Programming for Beginners"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full pl-9 pr-3 py-2 rounded-lg bg-[#0D0D0D] border border-white/20 text-xs text-white placeholder:text-[#555555] focus:border-white focus:outline-none"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-[11px] font-medium text-[#A3A3A3] mb-1">Completion Year</label>
              <div className="relative">
                <Calendar className="w-3.5 h-3.5 text-[#666666] absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="e.g. 2024"
                  value={completionYear}
                  onChange={(e) => setCompletionYear(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 rounded-lg bg-[#0D0D0D] border border-white/20 text-xs text-white placeholder:text-[#555555] focus:border-white focus:outline-none"
                />
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-medium text-[#A3A3A3] mb-1">Provider / Platform</label>
              <div className="relative">
                <Building2 className="w-3.5 h-3.5 text-[#666666] absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="e.g. Udemy, Simplilearn"
                  value={provider}
                  onChange={(e) => setProvider(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 rounded-lg bg-[#0D0D0D] border border-white/20 text-xs text-white placeholder:text-[#555555] focus:border-white focus:outline-none"
                />
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-medium text-[#A3A3A3] mb-1">Instructor (Optional)</label>
              <div className="relative">
                <User className="w-3.5 h-3.5 text-[#666666] absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="e.g. Dr. Angela Yu"
                  value={instructor}
                  onChange={(e) => setInstructor(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 rounded-lg bg-[#0D0D0D] border border-white/20 text-xs text-white placeholder:text-[#555555] focus:border-white focus:outline-none"
                />
              </div>
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-medium text-[#A3A3A3] mb-1">Certificate URL (Verifiable Link)</label>
            <div className="relative">
              <ExternalLink className="w-3.5 h-3.5 text-[#666666] absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="url"
                placeholder="https://..."
                value={certificateUrl}
                onChange={(e) => setCertificateUrl(e.target.value)}
                className="w-full pl-9 pr-3 py-2 rounded-lg bg-[#0D0D0D] border border-white/20 text-xs text-white placeholder:text-[#555555] focus:border-white focus:outline-none font-mono"
              />
            </div>
            <p className="text-[10px] text-neutral-500 mt-1">
              User-provided verified profile evidence with certificate link. JobFinder will preserve this URL without external modification.
            </p>
          </div>

          <div>
            <label className="block text-[11px] font-medium text-[#A3A3A3] mb-1">
              User-Approved Description (Zero-Fabrication)
            </label>
            <div className="relative">
              <textarea
                rows={3}
                placeholder="Candidate-approved summary of what was completed (AI will only format this, never invent skills or curriculum)."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="w-full p-3 rounded-lg bg-[#0D0D0D] border border-white/20 text-xs text-white placeholder:text-[#555555] focus:border-white focus:outline-none leading-relaxed"
              />
            </div>
            <p className="text-[10px] text-neutral-500 mt-1">
              Strict Truth-Lock guarantee: AI will never invent bullet points, skills, or curriculum beyond your approved facts.
            </p>
          </div>

          <div className="flex items-center justify-end gap-2 pt-3 border-t border-white/10">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold text-[#A3A3A3] hover:text-white hover:bg-white/5 cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSaving || !title.trim()}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-white text-black text-xs font-semibold hover:bg-neutral-200 transition-colors cursor-pointer disabled:opacity-50"
            >
              {isSaving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              <span>{course ? "Update Course" : "Add & Sync to Firestore"}</span>
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
};
