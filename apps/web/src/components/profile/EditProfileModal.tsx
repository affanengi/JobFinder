import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useScrollLock } from '../../hooks/useScrollLock';
import { X, User, Mail, Phone, MapPin, Github, Linkedin, Globe, Loader2 } from 'lucide-react';

export interface UserProfileDTO {
  userId: string;
  personal: {
    fullName: string;
    email: string;
    phone?: string;
    city?: string;
    country?: string;
    links?: {
      github?: string;
      linkedin?: string;
      portfolio?: string;
    };
  };
  summary?: string;
  profileVersion: number;
}

interface EditProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
  profile: UserProfileDTO;
  onSave: (updated: Partial<UserProfileDTO>) => Promise<void>;
}

export const EditProfileModal: React.FC<EditProfileModalProps> = ({
  isOpen,
  onClose,
  profile,
  onSave,
}) => {
  const [fullName, setFullName] = useState(profile.personal.fullName || '');
  const [email, setEmail] = useState(profile.personal.email || '');
  const [phone, setPhone] = useState(profile.personal.phone || '');
  const [city, setCity] = useState(profile.personal.city || 'Hyderabad');
  const [country] = useState(profile.personal.country || 'India');
  const [github, setGithub] = useState(profile.personal.links?.github || '');
  const [linkedin, setLinkedin] = useState(profile.personal.links?.linkedin || '');
  const [portfolio, setPortfolio] = useState(profile.personal.links?.portfolio || '');
  const [summary, setSummary] = useState(profile.summary || '');
  const [isSaving, setIsSaving] = useState(false);

  // Lock body scroll when modal is open
  useScrollLock(isOpen);

  useEffect(() => {
    if (profile) {
      setFullName(profile.personal.fullName || '');
      setEmail(profile.personal.email || '');
      setPhone(profile.personal.phone || '');
      setCity(profile.personal.city || 'Hyderabad');
      setGithub(profile.personal.links?.github || '');
      setLinkedin(profile.personal.links?.linkedin || '');
      setPortfolio(profile.personal.links?.portfolio || '');
      setSummary(profile.summary || '');
    }
  }, [profile, isOpen]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    try {
      await onSave({
        personal: {
          fullName,
          email,
          phone,
          city,
          country,
          links: {
            github: github || undefined,
            linkedin: linkedin || undefined,
            portfolio: portfolio || undefined,
          },
        },
        summary,
      });
      onClose();
    } catch (err) {
      console.error(err);
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
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/55 backdrop-blur-xl animate-in fade-in duration-150"
    >
      <div 
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-xl bg-[#161616] border border-white/20 rounded-2xl p-6 shadow-2xl space-y-5 max-h-[90vh] overflow-y-auto animate-in zoom-in-95 duration-150"
      >
        <div className="flex items-center justify-between border-b border-white/10 pb-3">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded bg-white text-black font-black flex items-center justify-center text-xs">
              AR
            </div>
            <div>
              <h2 className="text-sm font-semibold text-white">Edit Master Profile Details</h2>
              <p className="text-[11px] text-[#A3A3A3]">Update your contact details, URLs, and summary in Cloud Firestore.</p>
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
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-medium text-[#A3A3A3] mb-1">Full Name</label>
              <div className="relative">
                <User className="w-3.5 h-3.5 text-[#666666] absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  required
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 rounded-lg bg-[#0D0D0D] border border-white/20 text-xs text-white focus:border-white focus:outline-none"
                />
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-medium text-[#A3A3A3] mb-1">Email</label>
              <div className="relative">
                <Mail className="w-3.5 h-3.5 text-[#666666] absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 rounded-lg bg-[#0D0D0D] border border-white/20 text-xs text-white focus:border-white focus:outline-none"
                />
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-medium text-[#A3A3A3] mb-1">Phone Number</label>
              <div className="relative">
                <Phone className="w-3.5 h-3.5 text-[#666666] absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="+91 98765 43210"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 rounded-lg bg-[#0D0D0D] border border-white/20 text-xs text-white focus:border-white focus:outline-none"
                />
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-medium text-[#A3A3A3] mb-1">City / Country</label>
              <div className="relative">
                <MapPin className="w-3.5 h-3.5 text-[#666666] absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  placeholder="Hyderabad, India"
                  className="w-full pl-9 pr-3 py-2 rounded-lg bg-[#0D0D0D] border border-white/20 text-xs text-white focus:border-white focus:outline-none"
                />
              </div>
            </div>
          </div>

          <div className="space-y-3 pt-2 border-t border-white/10">
            <h3 className="text-xs font-mono uppercase text-[#A3A3A3]">Social & Portfolio Links</h3>
            
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-medium text-[#A3A3A3] mb-1">GitHub URL</label>
                <div className="relative">
                  <Github className="w-3.5 h-3.5 text-[#666666] absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="url"
                    placeholder="https://github.com/yourusername"
                    value={github}
                    onChange={(e) => setGithub(e.target.value)}
                    className="w-full pl-9 pr-3 py-2 rounded-lg bg-[#0D0D0D] border border-white/20 text-xs text-white focus:border-white focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-medium text-[#A3A3A3] mb-1">LinkedIn URL</label>
                <div className="relative">
                  <Linkedin className="w-3.5 h-3.5 text-[#666666] absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="url"
                    placeholder="https://linkedin.com/in/yourusername"
                    value={linkedin}
                    onChange={(e) => setLinkedin(e.target.value)}
                    className="w-full pl-9 pr-3 py-2 rounded-lg bg-[#0D0D0D] border border-white/20 text-xs text-white focus:border-white focus:outline-none"
                  />
                </div>
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-medium text-[#A3A3A3] mb-1">Portfolio Website</label>
              <div className="relative">
                <Globe className="w-3.5 h-3.5 text-[#666666] absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="url"
                  placeholder="https://yourportfolio.dev"
                  value={portfolio}
                  onChange={(e) => setPortfolio(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 rounded-lg bg-[#0D0D0D] border border-white/20 text-xs text-white focus:border-white focus:outline-none"
                />
              </div>
            </div>
          </div>

          <div className="pt-2 border-t border-white/10">
            <label className="block text-[11px] font-medium text-[#A3A3A3] mb-1">Professional Summary</label>
            <textarea
              rows={3}
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              placeholder="Verified career summary..."
              className="w-full p-3 rounded-lg bg-[#0D0D0D] border border-white/20 text-xs text-white focus:border-white focus:outline-none resize-none"
            />
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
              disabled={isSaving}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-white text-black text-xs font-semibold hover:bg-neutral-200 transition-colors cursor-pointer disabled:opacity-50"
            >
              {isSaving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              <span>Save & Sync to Firestore</span>
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
};
