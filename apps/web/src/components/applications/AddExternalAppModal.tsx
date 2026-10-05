import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Plus, Building2, Briefcase, MapPin, Globe, Calendar, FileText, AlertCircle } from 'lucide-react';
import { ApplicationStage } from '../../types/application';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (appData: {
    company: string;
    jobTitle: string;
    location: string;
    portalUrl?: string;
    salarySnippet?: string;
    initialStatus: ApplicationStage;
    appliedDate?: string;
    notes?: string;
    isExternal: boolean;
  }) => Promise<void>;
}

export const AddExternalAppModal: React.FC<Props> = ({ isOpen, onClose, onSubmit }) => {
  const [company, setCompany] = useState('');
  const [jobTitle, setJobTitle] = useState('');
  const [location, setLocation] = useState('Remote');
  const [portalUrl, setPortalUrl] = useState('');
  const [currency, setCurrency] = useState<'INR' | 'USD'>('INR');
  const [salaryAmount, setSalaryAmount] = useState('');
  const [initialStatus, setInitialStatus] = useState<ApplicationStage>('saved');
  const [appliedDate, setAppliedDate] = useState(new Date().toISOString().split('T')[0]);
  const [notes, setNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!company.trim() || !jobTitle.trim()) {
      setError('Company name and Job Title are required.');
      return;
    }

    setIsSubmitting(true);
    setError(null);

    let formattedSalary = salaryAmount.trim();
    if (formattedSalary) {
      if (!formattedSalary.startsWith('₹') && !formattedSalary.startsWith('$')) {
        const symbol = currency === 'INR' ? '₹' : '$';
        formattedSalary = `${symbol} ${formattedSalary}`;
      }
    }

    try {
      await onSubmit({
        company: company.trim(),
        jobTitle: jobTitle.trim(),
        location: location.trim() || 'Remote',
        portalUrl: portalUrl.trim() || undefined,
        salarySnippet: formattedSalary || undefined,
        initialStatus,
        appliedDate: initialStatus === 'applied' ? appliedDate : undefined,
        notes: notes.trim() || undefined,
        isExternal: true,
      });

      // Reset form and close
      setCompany('');
      setJobTitle('');
      setLocation('Remote');
      setPortalUrl('');
      setCurrency('INR');
      setSalaryAmount('');
      setInitialStatus('saved');
      setNotes('');
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Failed to add application.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg bg-[#0D0D0D] border border-white/15 rounded-2xl shadow-2xl shadow-black/95 overflow-hidden flex flex-col max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 bg-[#121212]">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
              <Plus className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base md:text-lg font-bold text-white tracking-tight">Add External Application</h2>
              <p className="text-xs text-neutral-400">Track off-platform referrals, direct emails, or LinkedIn submissions</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-neutral-400 hover:text-white rounded-lg hover:bg-neutral-850 transition-colors"
            title="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Form */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          {error && (
            <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-xl text-red-400 text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Job Title & Company */}
          <div className="space-y-3.5">
            <div>
              <label className="block text-xs font-semibold text-neutral-300 mb-1.5 flex items-center gap-1.5">
                <Briefcase className="w-3.5 h-3.5 text-emerald-400" />
                <span>Job Title</span>
                <span className="text-red-400">*</span>
              </label>
              <input
                type="text"
                required
                placeholder="e.g. AI Automation Intern / Engineer"
                value={jobTitle}
                onChange={(e) => setJobTitle(e.target.value)}
                className="w-full px-3.5 py-2.5 bg-[#161616] border border-white/10 rounded-xl text-sm text-white placeholder-neutral-500 focus:outline-none focus:border-emerald-500/80 focus:ring-1 focus:ring-emerald-500/50 transition-colors"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-neutral-300 mb-1.5 flex items-center gap-1.5">
                <Building2 className="w-3.5 h-3.5 text-emerald-400" />
                <span>Company Name</span>
                <span className="text-red-400">*</span>
              </label>
              <input
                type="text"
                required
                placeholder="e.g. HextGen AI, Google, Acme Corp"
                value={company}
                onChange={(e) => setCompany(e.target.value)}
                className="w-full px-3.5 py-2.5 bg-[#161616] border border-white/10 rounded-xl text-sm text-white placeholder-neutral-500 focus:outline-none focus:border-emerald-500/80 focus:ring-1 focus:ring-emerald-500/50 transition-colors"
              />
            </div>
          </div>

          {/* Location & Salary Range with Currency Dropdown */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
            <div>
              <label className="block text-xs font-semibold text-neutral-300 mb-1.5 flex items-center gap-1.5">
                <MapPin className="w-3.5 h-3.5 text-neutral-400" />
                <span>Location</span>
              </label>
              <input
                type="text"
                placeholder="e.g. Hyderabad, Remote, Bengaluru"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                className="w-full px-3.5 py-2.5 bg-[#161616] border border-white/10 rounded-xl text-sm text-white placeholder-neutral-500 focus:outline-none focus:border-emerald-500/80 focus:ring-1 focus:ring-emerald-500/50 transition-colors"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-neutral-300 mb-1.5 flex items-center gap-1.5">
                <span className="text-emerald-400 font-bold text-xs w-3.5 text-center">{currency === 'INR' ? '₹' : '$'}</span>
                <span>Salary Range</span>
              </label>
              <div className="flex items-center w-full bg-[#161616] border border-white/10 rounded-xl focus-within:border-emerald-500/80 focus-within:ring-1 focus-within:ring-emerald-500/50 transition-all overflow-hidden">
                <input
                  type="text"
                  placeholder={currency === 'INR' ? 'e.g. 15000-20000 / mo' : 'e.g. 140k - 165k'}
                  value={salaryAmount}
                  onChange={(e) => setSalaryAmount(e.target.value)}
                  className="flex-1 min-w-0 px-3.5 py-2.5 bg-transparent text-sm text-white placeholder-neutral-500 focus:outline-none"
                />
                <div className="border-l border-white/10 bg-[#1c1c1c] shrink-0 flex items-center">
                  <select
                    value={currency}
                    onChange={(e) => setCurrency(e.target.value as 'INR' | 'USD')}
                    className="bg-transparent py-2.5 px-3 text-xs font-semibold text-emerald-400 hover:text-emerald-300 focus:outline-none cursor-pointer"
                  >
                    <option value="INR" className="bg-[#161616] text-white">₹ Rupees</option>
                    <option value="USD" className="bg-[#161616] text-white">$ Dollars</option>
                  </select>
                </div>
              </div>
            </div>
          </div>

          {/* Application Portal / Listing URL */}
          <div>
            <label className="block text-xs font-semibold text-neutral-300 mb-1.5 flex items-center gap-1.5">
              <Globe className="w-3.5 h-3.5 text-neutral-400" />
              <span>Job Listing / Portal URL</span>
            </label>
            <input
              type="url"
              placeholder="https://www.linkedin.com/jobs/view/..."
              value={portalUrl}
              onChange={(e) => setPortalUrl(e.target.value)}
              className="w-full px-3.5 py-2.5 bg-[#161616] border border-white/10 rounded-xl text-sm text-white placeholder-neutral-500 focus:outline-none focus:border-emerald-500/80 focus:ring-1 focus:ring-emerald-500/50 transition-colors"
            />
            <p className="text-[11px] text-neutral-500 mt-1">Direct LinkedIn or company job link — clickable right from your dashboard</p>
          </div>

          {/* Initial Pipeline Stage & Submission Date */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5 pt-1">
            <div>
              <label className="block text-xs font-semibold text-neutral-300 mb-1.5">
                Initial Status
              </label>
              <select
                value={initialStatus}
                onChange={(e) => setInitialStatus(e.target.value as ApplicationStage)}
                className="w-full px-3 py-2.5 bg-[#161616] border border-white/10 rounded-xl text-sm text-white focus:outline-none focus:border-emerald-500/80 focus:ring-1 focus:ring-emerald-500/50 cursor-pointer"
              >
                <option value="saved" className="bg-[#161616] text-white">Draft / Preparing (Saved)</option>
                <option value="applied" className="bg-[#161616] text-white">Already Applied (Submitted)</option>
                <option value="interviewing" className="bg-[#161616] text-white">Interviewing</option>
              </select>
            </div>

            {initialStatus === 'applied' && (
              <div>
                <label className="block text-xs font-semibold text-neutral-300 mb-1.5 flex items-center gap-1.5">
                  <Calendar className="w-3.5 h-3.5 text-emerald-400" />
                  Submission Date
                </label>
                <input
                  type="date"
                  value={appliedDate}
                  onChange={(e) => setAppliedDate(e.target.value)}
                  className="w-full px-3 py-2.5 bg-[#161616] border border-white/10 rounded-xl text-sm text-white focus:outline-none focus:border-emerald-500/80 focus:ring-1 focus:ring-emerald-500/50"
                />
              </div>
            )}
          </div>

          {/* Initial Notes & Referral Context */}
          <div>
            <label className="block text-xs font-semibold text-neutral-300 mb-1.5 flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <FileText className="w-3.5 h-3.5 text-neutral-400" />
                <span>Notes & Referral Context</span>
              </div>
              <span className="text-[11px] text-neutral-500 font-normal">Optional personal scratchpad</span>
            </label>
            <textarea
              rows={3}
              placeholder="e.g. Applied via LinkedIn Easy Apply; contact person is recruiter Jane; follow up in 1 week..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full px-3.5 py-2.5 bg-[#161616] border border-white/10 rounded-xl text-sm text-white placeholder-neutral-500 focus:outline-none focus:border-emerald-500/80 focus:ring-1 focus:ring-emerald-500/50 resize-none transition-colors"
            />
          </div>

          {/* Footer Actions */}
          <div className="flex items-center justify-end gap-3 pt-3 border-t border-white/10">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-neutral-400 hover:text-white rounded-xl hover:bg-neutral-800/60 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-5 py-2 text-sm font-bold text-black bg-emerald-500 hover:bg-emerald-400 active:bg-emerald-600 rounded-xl shadow-lg shadow-emerald-500/20 disabled:opacity-50 flex items-center gap-2 transition-all cursor-pointer"
            >
              {isSubmitting ? (
                <>
                  <div className="w-4 h-4 border-2 border-black/30 border-t-black rounded-full animate-spin" />
                  <span>Adding...</span>
                </>
              ) : (
                <span>Add Application</span>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
};
