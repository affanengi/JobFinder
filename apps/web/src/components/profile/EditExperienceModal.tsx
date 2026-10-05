import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useScrollLock } from '../../hooks/useScrollLock';
import { X, Briefcase, Calendar, MapPin, Building, Plus, Trash2, Loader2 } from 'lucide-react';

export interface ExperienceFact {
  id: string;
  company: string;
  title: string;
  location?: string;
  startDate?: string;
  endDate?: string;
  current: boolean;
  bullets: string[];
  verified: boolean;
  category?: string | null;
  employmentType?: string | null;
}

interface EditExperienceModalProps {
  isOpen: boolean;
  onClose: () => void;
  experience: ExperienceFact | null;
  onSave: (exp: ExperienceFact) => Promise<void>;
}

export const EditExperienceModal: React.FC<EditExperienceModalProps> = ({
  isOpen,
  onClose,
  experience,
  onSave,
}) => {
  const [company, setCompany] = useState('');
  const [title, setTitle] = useState('');
  const [location, setLocation] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [current, setCurrent] = useState(false);
  const [bullets, setBullets] = useState<string[]>([]);
  const [isSaving, setIsSaving] = useState(false);

  // Lock body scroll when modal is open
  useScrollLock(isOpen);

  useEffect(() => {
    if (experience) {
      setCompany(experience.company || '');
      setTitle(experience.title || '');
      setLocation(experience.location || '');
      setStartDate(experience.startDate || '');
      setEndDate(experience.endDate || '');
      setCurrent(experience.current || false);
      setBullets(experience.bullets && experience.bullets.length > 0 ? [...experience.bullets] : ['']);
    } else {
      setCompany('');
      setTitle('');
      setLocation('');
      setStartDate('');
      setEndDate('');
      setCurrent(false);
      setBullets(['']);
    }
  }, [experience, isOpen]);

  if (!isOpen) return null;

  const handleAddBullet = () => {
    setBullets([...bullets, '']);
  };

  const handleUpdateBullet = (idx: number, text: string) => {
    const updated = [...bullets];
    updated[idx] = text;
    setBullets(updated);
  };

  const handleRemoveBullet = (idx: number) => {
    const updated = bullets.filter((_, i) => i !== idx);
    setBullets(updated.length > 0 ? updated : ['']);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    try {
      const filteredBullets = bullets.map((b) => b.trim()).filter(Boolean);
      const updatedExp: ExperienceFact = {
        id: experience?.id || `exp-${Date.now().toString(36)}`,
        company: company.trim(),
        title: title.trim(),
        location: location.trim() || undefined,
        startDate: startDate.trim() || undefined,
        endDate: current ? undefined : endDate.trim() || undefined,
        current,
        bullets: filteredBullets.length > 0 ? filteredBullets : ['Contributed to engineering operations and initiatives.'],
        verified: true,
      };
      await onSave(updatedExp);
      onClose();
    } catch (err) {
      console.error('Error saving experience:', err);
    } finally {
      setIsSaving(false);
    }
  };

  const isEditMode = !!experience;

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
        className="w-full max-w-xl bg-[#161616] border border-white/20 rounded-2xl p-6 shadow-2xl space-y-5 animate-in zoom-in-95 duration-150 max-h-[90vh] overflow-y-auto"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/10 pb-3">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 flex items-center justify-center">
              <Briefcase className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-white">
                {isEditMode ? 'Edit Experience / Leadership' : 'Add Experience / Leadership'}
              </h2>
              <p className="text-[11px] text-[#A3A3A3]">
                Manage technical clubs, internships, and professional leadership roles.
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

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-[11px] font-medium text-[#A3A3A3] mb-1">
              Role / Position Title <span className="text-rose-400">*</span>
            </label>
            <input
              type="text"
              required
              placeholder="e.g. Co-Founder & Technical Lead"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-[#0D0D0D] border border-white/20 text-xs text-white placeholder-neutral-500 focus:border-white focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-[11px] font-medium text-[#A3A3A3] mb-1">
              Organization / Club / Company <span className="text-rose-400">*</span>
            </label>
            <div className="relative">
              <Building className="w-3.5 h-3.5 text-[#666666] absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                required
                placeholder="e.g. Techniva (Technical Club), ScaleAI Labs"
                value={company}
                onChange={(e) => setCompany(e.target.value)}
                className="w-full pl-9 pr-3 py-2 rounded-lg bg-[#0D0D0D] border border-white/20 text-xs text-white placeholder-neutral-500 focus:border-white focus:outline-none"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-medium text-[#A3A3A3] mb-1">Location</label>
              <div className="relative">
                <MapPin className="w-3.5 h-3.5 text-[#666666] absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="e.g. Hyderabad, Telangana"
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 rounded-lg bg-[#0D0D0D] border border-white/20 text-xs text-white placeholder-neutral-500 focus:border-white focus:outline-none"
                />
              </div>
            </div>

            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <label className="text-[11px] font-medium text-[#A3A3A3]">Timeline</label>
                <label className="flex items-center gap-1.5 text-[11px] text-neutral-400 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={current}
                    onChange={(e) => setCurrent(e.target.checked)}
                    className="rounded bg-[#0D0D0D] border-white/20 text-emerald-500 focus:ring-0 cursor-pointer"
                  />
                  <span>Currently Active</span>
                </label>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="relative">
                  <Calendar className="w-3 text-[#666666] absolute left-2.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    placeholder="Start (2024)"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="w-full pl-8 pr-2 py-2 rounded-lg bg-[#0D0D0D] border border-white/20 text-xs text-white placeholder-neutral-500 focus:border-white focus:outline-none"
                  />
                </div>
                <div className="relative">
                  <input
                    type="text"
                    disabled={current}
                    placeholder={current ? 'Present' : 'End (2026)'}
                    value={current ? 'Present' : endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    className="w-full px-2.5 py-2 rounded-lg bg-[#0D0D0D] border border-white/20 text-xs text-white placeholder-neutral-500 focus:border-white focus:outline-none disabled:opacity-50"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Key Achievements / Bullets */}
          <div className="space-y-2 pt-2 border-t border-white/10">
            <div className="flex items-center justify-between">
              <label className="text-[11px] font-medium text-[#A3A3A3]">Key Highlights & Responsibilities</label>
              <button
                type="button"
                onClick={handleAddBullet}
                className="flex items-center gap-1 text-[11px] font-semibold text-emerald-400 hover:text-emerald-300 cursor-pointer"
              >
                <Plus className="w-3 h-3" />
                <span>Add Bullet</span>
              </button>
            </div>

            <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
              {bullets.map((bullet, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <span className="text-neutral-500 text-xs">•</span>
                  <input
                    type="text"
                    placeholder={`Highlight #${idx + 1}`}
                    value={bullet}
                    onChange={(e) => handleUpdateBullet(idx, e.target.value)}
                    className="flex-1 px-3 py-1.5 rounded-lg bg-[#0D0D0D] border border-white/20 text-xs text-white placeholder-neutral-500 focus:border-white focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => handleRemoveBullet(idx)}
                    className="p-1 text-neutral-500 hover:text-rose-400 transition-colors cursor-pointer"
                    title="Remove point"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Footer Actions */}
          <div className="flex items-center justify-end gap-2 pt-4 border-t border-white/10">
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
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-white text-black text-xs font-bold hover:bg-neutral-200 transition-colors cursor-pointer disabled:opacity-50"
            >
              {isSaving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              <span>{isEditMode ? 'Update Experience' : 'Save Experience'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
};
