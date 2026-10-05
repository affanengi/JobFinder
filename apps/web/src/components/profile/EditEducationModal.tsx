import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useScrollLock } from '../../hooks/useScrollLock';
import { X, GraduationCap, Calendar, Award, Building, BookOpen, Loader2 } from 'lucide-react';

export interface EducationFact {
  id: string;
  institution: string;
  degree: string;
  field?: string;
  startDate?: string;
  endDate?: string;
  grade?: string;
  location?: string;
  verified: boolean;
}

interface EditEducationModalProps {
  isOpen: boolean;
  onClose: () => void;
  education: EducationFact | null;
  onSave: (edu: EducationFact) => Promise<void>;
}

export const EditEducationModal: React.FC<EditEducationModalProps> = ({
  isOpen,
  onClose,
  education,
  onSave,
}) => {
  const [degree, setDegree] = useState('');
  const [institution, setInstitution] = useState('');
  const [field, setField] = useState('');
  const [endDate, setEndDate] = useState('');
  const [grade, setGrade] = useState('');
  const [location, setLocation] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  // Lock body scroll when modal is open
  useScrollLock(isOpen);

  useEffect(() => {
    if (education) {
      setDegree(education.degree || '');
      setInstitution(education.institution || '');
      setField(education.field || '');
      setEndDate(education.endDate || '');
      setGrade(education.grade || '');
      setLocation(education.location || '');
    } else {
      setDegree('');
      setInstitution('');
      setField('');
      setEndDate('');
      setGrade('');
      setLocation('');
    }
  }, [education, isOpen]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    try {
      const updatedEdu: EducationFact = {
        id: education?.id || `edu-${Date.now().toString(36)}`,
        degree: degree.trim(),
        institution: institution.trim(),
        field: field.trim() || undefined,
        endDate: endDate.trim() || undefined,
        grade: grade.trim() || undefined,
        location: location.trim() || undefined,
        verified: true,
      };
      await onSave(updatedEdu);
      onClose();
    } catch (err) {
      console.error('Error saving education:', err);
    } finally {
      setIsSaving(false);
    }
  };

  const isEditMode = !!education;

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
        className="w-full max-w-lg bg-[#161616] border border-white/20 rounded-2xl p-6 shadow-2xl space-y-5 animate-in zoom-in-95 duration-150"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/10 pb-3">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 flex items-center justify-center">
              <GraduationCap className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-white">
                {isEditMode ? 'Edit Education Record' : 'Add Education Record'}
              </h2>
              <p className="text-[11px] text-[#A3A3A3]">
                Manage degrees, junior colleges, schooling, and academic grades.
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
              Degree / Qualification <span className="text-rose-400">*</span>
            </label>
            <div className="relative">
              <BookOpen className="w-3.5 h-3.5 text-[#666666] absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                required
                placeholder="e.g. Bachelor of Technology, MPC, 10th Standard"
                value={degree}
                onChange={(e) => setDegree(e.target.value)}
                className="w-full pl-9 pr-3 py-2 rounded-lg bg-[#0D0D0D] border border-white/20 text-xs text-white placeholder-neutral-500 focus:border-white focus:outline-none"
              />
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-medium text-[#A3A3A3] mb-1">
              Institution / School / College <span className="text-rose-400">*</span>
            </label>
            <div className="relative">
              <Building className="w-3.5 h-3.5 text-[#666666] absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                required
                placeholder="e.g. Global Institute of Engineering & Technology"
                value={institution}
                onChange={(e) => setInstitution(e.target.value)}
                className="w-full pl-9 pr-3 py-2 rounded-lg bg-[#0D0D0D] border border-white/20 text-xs text-white placeholder-neutral-500 focus:border-white focus:outline-none"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-medium text-[#A3A3A3] mb-1">Field of Study</label>
              <input
                type="text"
                placeholder="e.g. Computer Science, MPC"
                value={field}
                onChange={(e) => setField(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-[#0D0D0D] border border-white/20 text-xs text-white placeholder-neutral-500 focus:border-white focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-[11px] font-medium text-[#A3A3A3] mb-1">Graduation Year / End Date</label>
              <div className="relative">
                <Calendar className="w-3.5 h-3.5 text-[#666666] absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="e.g. 2026, 2021"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 rounded-lg bg-[#0D0D0D] border border-white/20 text-xs text-white placeholder-neutral-500 focus:border-white focus:outline-none"
                />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-medium text-[#A3A3A3] mb-1">
                Grade / Percentage / CGPA
              </label>
              <div className="relative">
                <Award className="w-3.5 h-3.5 text-[#666666] absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="e.g. 8.2 CGPA, 85%, 9.1 GPA"
                  value={grade}
                  onChange={(e) => setGrade(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 rounded-lg bg-[#0D0D0D] border border-white/20 text-xs text-white placeholder-neutral-500 focus:border-white focus:outline-none"
                />
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-medium text-[#A3A3A3] mb-1">Location</label>
              <input
                type="text"
                placeholder="e.g. Hyderabad, Telangana"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-[#0D0D0D] border border-white/20 text-xs text-white placeholder-neutral-500 focus:border-white focus:outline-none"
              />
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
              <span>{isEditMode ? 'Update Education' : 'Save Education'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
};
