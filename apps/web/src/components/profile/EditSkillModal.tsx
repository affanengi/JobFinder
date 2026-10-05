import React, { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { useScrollLock } from "../../hooks/useScrollLock";
import { X, Wrench, Award, Tag, Loader2 } from "lucide-react";

export interface SkillFact {
  id: string;
  name: string;
  category: string;
  proficiency: string;
  verified: boolean;
  source?: string;
}

interface EditSkillModalProps {
  isOpen: boolean;
  onClose: () => void;
  skill: SkillFact | null;
  onSave: (skill: SkillFact) => Promise<void>;
}

export const CATEGORY_OPTIONS = [
  { value: "programming", label: "Languages / Programming" },
  { value: "web", label: "Frontend Frameworks & UI" },
  { value: "backend", label: "Backend & Databases" },
  { value: "ai_ml", label: "AI & Generative AI" },
  { value: "automation", label: "Automation & Integrations" },
  { value: "tools", label: "Tools & Platforms" },
  { value: "cloud", label: "Cloud & Deployment" },
  { value: "data", label: "Data & Databases" },
  { value: "productivity", label: "Data & Productivity" },
  { value: "engineering", label: "Software Engineering" },
  { value: "soft", label: "Professional & Soft Skills" },
  { value: "languages_spoken", label: "Spoken & Written Languages" },
  { value: "other", label: "Other / General" },
];

export const PROFICIENCY_OPTIONS = [
  { value: "advanced", label: "Advanced (Proficient / Expert)" },
  { value: "intermediate", label: "Intermediate (Working Knowledge)" },
  { value: "beginner", label: "Beginner (Foundational)" },
];

export const EditSkillModal: React.FC<EditSkillModalProps> = ({
  isOpen,
  onClose,
  skill,
  onSave,
}) => {
  const [name, setName] = useState("");
  const [category, setCategory] = useState("programming");
  const [proficiency, setProficiency] = useState("advanced");
  const [isSaving, setIsSaving] = useState(false);

  useScrollLock(isOpen);

  useEffect(() => {
    if (skill) {
      setName(skill.name);
      setCategory(skill.category || "programming");
      setProficiency(skill.proficiency || "advanced");
    } else {
      setName("");
      setCategory("programming");
      setProficiency("advanced");
    }
  }, [skill, isOpen]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    setIsSaving(true);
    try {
      const savedSkill: SkillFact = {
        id: skill?.id || `skill-custom-${Date.now()}`,
        name: name.trim(),
        category,
        proficiency,
        verified: true,
        source: "candidate_confirmed",
      };
      await onSave(savedSkill);
      onClose();
    } catch (err) {
      console.error("Failed to save skill:", err);
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
        className="w-full max-w-lg bg-[#161616] border border-white/20 rounded-2xl p-6 shadow-2xl space-y-5 animate-in zoom-in-95 duration-150"
      >
        <div className="flex items-center justify-between border-b border-white/10 pb-3">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 flex items-center justify-center text-xs">
              <Wrench className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-white">
                {skill ? "Edit Verified Skill" : "Add Verified Skill"}
              </h2>
              <p className="text-[11px] text-[#A3A3A3]">
                Candidate-confirmed technical and professional skills for ATS tailoring.
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
            <label className="block text-[11px] font-medium text-[#A3A3A3] mb-1">Skill Name</label>
            <div className="relative">
              <Wrench className="w-3.5 h-3.5 text-[#666666] absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                required
                placeholder="e.g. React.js, Python, PostgreSQL, English (Fluent)..."
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full pl-9 pr-3 py-2 rounded-lg bg-[#0D0D0D] border border-white/20 text-xs text-white placeholder:text-[#555555] focus:border-white focus:outline-none"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-medium text-[#A3A3A3] mb-1">Domain / Category</label>
              <div className="relative">
                <Tag className="w-3.5 h-3.5 text-[#666666] absolute left-3 top-1/2 -translate-y-1/2" />
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 rounded-lg bg-[#0D0D0D] border border-white/20 text-xs text-white focus:border-white focus:outline-none"
                >
                  {CATEGORY_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-medium text-[#A3A3A3] mb-1">Proficiency Level</label>
              <div className="relative">
                <Award className="w-3.5 h-3.5 text-[#666666] absolute left-3 top-1/2 -translate-y-1/2" />
                <select
                  value={proficiency}
                  onChange={(e) => setProficiency(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 rounded-lg bg-[#0D0D0D] border border-white/20 text-xs text-white focus:border-white focus:outline-none"
                >
                  {PROFICIENCY_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
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
              disabled={isSaving || !name.trim()}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-white text-black text-xs font-semibold hover:bg-neutral-200 transition-colors cursor-pointer disabled:opacity-50"
            >
              {isSaving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              <span>{skill ? "Update Skill" : "Add & Sync to Firestore"}</span>
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
};
