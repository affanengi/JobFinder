import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useScrollLock } from '../../hooks/useScrollLock';
import { X, FolderGit2, Loader2, Plus, Trash2, Code2, Link } from 'lucide-react';

export interface ProjectFact {
  id: string;
  name: string;
  description: string;
  bullets: string[];
  technologies: string[];
  url?: string;
  verified: boolean;
}

interface EditProjectModalProps {
  isOpen: boolean;
  project?: ProjectFact | null;
  onSave: (project: ProjectFact) => Promise<void>;
  onClose: () => void;
}

export const EditProjectModal: React.FC<EditProjectModalProps> = ({
  isOpen,
  project,
  onSave,
  onClose,
}) => {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [technologies, setTechnologies] = useState('');
  const [url, setUrl] = useState('');
  const [bullets, setBullets] = useState<string[]>(['', '', '', '']);
  const [isSaving, setIsSaving] = useState(false);
  useScrollLock(isOpen);

  useEffect(() => {
    if (project) {
      setName(project.name || '');
      setDescription(project.description || '');
      setTechnologies(project.technologies ? project.technologies.join(', ') : '');
      setUrl(project.url || '');
      const bList = project.bullets && project.bullets.length > 0 ? [...project.bullets] : ['', '', '', ''];
      while (bList.length < 4) {
        bList.push('');
      }
      setBullets(bList);
    } else {
      setName('');
      setDescription('');
      setTechnologies('');
      setUrl('');
      setBullets(['', '', '', '']);
    }
  }, [project, isOpen]);

  if (!isOpen) return null;

  const handleAddBullet = () => {
    setBullets((prev) => [...prev, '']);
  };

  const handleRemoveBullet = (index: number) => {
    setBullets((prev) => prev.filter((_, i) => i !== index));
  };

  const handleBulletChange = (index: number, val: string) => {
    setBullets((prev) => {
      const updated = [...prev];
      updated[index] = val;
      return updated;
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    try {
      const techArray = technologies
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);
      const filteredBullets = bullets.map((b) => b.trim()).filter(Boolean);

      const updatedProject: ProjectFact = {
        id: project?.id || `proj-${Date.now().toString(36)}`,
        name: name.trim(),
        description: description.trim(),
        technologies: techArray,
        url: url.trim() || undefined,
        bullets: filteredBullets,
        verified: true,
      };

      await onSave(updatedProject);
      onClose();
    } catch (err) {
      console.error('Error saving project:', err);
    } finally {
      setIsSaving(false);
    }
  };

  const isEditMode = !!project;

  return createPortal(
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget && !isSaving) {
          onClose();
        }
      }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/55 backdrop-blur-xl animate-in fade-in duration-150"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-2xl bg-[#161616] border border-white/20 rounded-2xl p-6 shadow-2xl space-y-5 animate-in zoom-in-95 duration-150 max-h-[90vh] flex flex-col"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/10 pb-3 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 flex items-center justify-center">
              <FolderGit2 className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-white">
                {isEditMode ? 'Edit Technical Project' : 'Add Technical Project'}
              </h2>
              <p className="text-[11px] text-[#A3A3A3]">
                Ground your engineering architecture, tech stack, and substantive bullet points.
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

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="space-y-4 overflow-y-auto flex-1 pr-1">
          <div>
            <label className="block text-[11px] font-medium text-[#A3A3A3] mb-1">
              Project Name <span className="text-rose-400">*</span>
            </label>
            <input
              type="text"
              required
              placeholder="e.g. Personal AI Career Agent (jobFinder)"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-[#0D0D0D] border border-white/20 text-xs text-white placeholder-neutral-500 focus:border-white focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-[11px] font-medium text-[#A3A3A3] mb-1">
              Short Description / Architectural Scope <span className="text-rose-400">*</span>
            </label>
            <textarea
              rows={2}
              required
              placeholder="e.g. Full-stack intelligent career automation platform with deterministic truth auditing and 1-shot tailoring."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-[#0D0D0D] border border-white/20 text-xs text-white placeholder-neutral-500 focus:border-white focus:outline-none leading-relaxed"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-medium text-[#A3A3A3] mb-1">
                Technologies & Tools (comma separated)
              </label>
              <div className="relative">
                <Code2 className="w-3.5 h-3.5 text-[#666666] absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="e.g. React, TypeScript, FastAPI, Python, Docker"
                  value={technologies}
                  onChange={(e) => setTechnologies(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 rounded-lg bg-[#0D0D0D] border border-white/20 text-xs text-white placeholder-neutral-500 focus:border-white focus:outline-none"
                />
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-medium text-[#A3A3A3] mb-1">
                Project URL / GitHub Link (optional)
              </label>
              <div className="relative">
                <Link className="w-3.5 h-3.5 text-[#666666] absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="e.g. https://github.com/user/project"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 rounded-lg bg-[#0D0D0D] border border-white/20 text-xs text-white placeholder-neutral-500 focus:border-white focus:outline-none"
                />
              </div>
            </div>
          </div>

          {/* Substantive Bullet Points */}
          <div className="space-y-2 pt-1">
            <div className="flex items-center justify-between">
              <div>
                <label className="block text-[11px] font-medium text-white">
                  Technical Project Bullets (Aim for 4 rich points)
                </label>
                <p className="text-[10px] text-[#888888]">
                  Cover architecture, skills used, complex logic, and verifiable results.
                </p>
              </div>
              <button
                type="button"
                onClick={handleAddBullet}
                className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 text-[11px] font-medium border border-emerald-500/20 cursor-pointer"
              >
                <Plus className="w-3 h-3" />
                <span>Add Bullet</span>
              </button>
            </div>

            <div className="space-y-2">
              {bullets.map((b, idx) => (
                <div key={idx} className="flex items-start gap-2">
                  <span className="text-neutral-500 text-xs mt-2 font-mono">#{idx + 1}</span>
                  <textarea
                    rows={2}
                    placeholder={`Bullet ${idx + 1}: e.g. ${
                      idx === 0
                        ? 'Architected end-to-end event streaming pipeline processing 10k+ events/sec.'
                        : idx === 1
                        ? 'Implemented low-latency caching with Redis reducing API latency by 45%.'
                        : idx === 2
                        ? 'Engineered role-based access control and OAuth2 authentication with JWT.'
                        : 'Designed responsive interface with Tailwind CSS and achieved 99+ Lighthouse score.'
                    }`}
                    value={b}
                    onChange={(e) => handleBulletChange(idx, e.target.value)}
                    className="flex-1 px-3 py-1.5 rounded-lg bg-[#0D0D0D] border border-white/10 text-xs text-neutral-200 placeholder-neutral-600 focus:border-white/30 focus:outline-none leading-relaxed"
                  />
                  {bullets.length > 1 && (
                    <button
                      type="button"
                      onClick={() => handleRemoveBullet(idx)}
                      className="p-1.5 text-[#666666] hover:text-rose-400 hover:bg-white/5 rounded-lg transition-colors cursor-pointer mt-1"
                      title="Remove bullet"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Footer Actions */}
          <div className="flex items-center justify-end gap-2 pt-4 border-t border-white/10 shrink-0">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-2 rounded-xl text-xs font-semibold text-[#A3A3A3] hover:text-white hover:bg-white/5 cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSaving}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-white text-black text-xs font-bold hover:bg-neutral-200 transition-colors cursor-pointer disabled:opacity-50 shadow-sm"
            >
              {isSaving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              <span>{isEditMode ? 'Update Project' : 'Save Project'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
};
