import React, { useState } from 'react';
import { FileText, ChevronRight, Building2, MapPin } from 'lucide-react';
import { ApplicationRecord, ApplicationStage } from '../../types/application';

interface Props {
  applications: ApplicationRecord[];
  onSelect: (app: ApplicationRecord) => void;
  onPreviewResume?: (resumeId: string) => void;
  onMoveStage: (app: ApplicationRecord, newStage: ApplicationStage, note?: string) => void;
}

export const ApplicationTableView: React.FC<Props> = ({
  applications,
  onSelect,
  onPreviewResume,
  onMoveStage: _onMoveStage,
}) => {
  const [filterStage, setFilterStage] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');

  const filterTabs = [
    { id: 'all', label: 'All Tracked' },
    { id: 'active', label: 'Active Pipeline' },
    { id: 'saved', label: 'Saved' },
    { id: 'ready', label: 'Ready' },
    { id: 'applied', label: 'Applied' },
    { id: 'interviewing', label: 'Interviewing' },
    { id: 'offer', label: 'Offers' },
    { id: 'concluded', label: 'Concluded' },
  ];

  const filteredApps = applications.filter((app) => {
    // Stage Filter
    if (filterStage === 'active') {
      if (!['saved', 'ready', 'applied', 'interviewing', 'offer'].includes(app.status)) return false;
    } else if (filterStage === 'concluded') {
      if (!['rejected', 'archived'].includes(app.status)) return false;
    } else if (filterStage !== 'all') {
      if (app.status !== filterStage) return false;
    }

    // Search query
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchCompany = app.company.toLowerCase().includes(q);
      const matchTitle = app.jobTitle.toLowerCase().includes(q);
      const matchLocation = app.location.toLowerCase().includes(q);
      if (!matchCompany && !matchTitle && !matchLocation) return false;
    }

    return true;
  });

  const getStageBadge = (stage: ApplicationStage) => {
    switch (stage) {
      case 'ready':
        return 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20';
      case 'applied':
        return 'bg-blue-500/10 text-blue-400 border border-blue-500/20';
      case 'interviewing':
        return 'bg-amber-500/10 text-amber-400 border border-amber-500/20';
      case 'offer':
        return 'bg-purple-500/10 text-purple-400 border border-purple-500/20';
      case 'rejected':
        return 'bg-red-500/10 text-red-400 border border-red-500/20';
      case 'archived':
        return 'bg-neutral-800 text-neutral-400 border border-neutral-700';
      case 'saved':
      default:
        return 'bg-neutral-800 text-neutral-300 border border-neutral-700';
    }
  };

  return (
    <div className="space-y-4">
      {/* Search & Filter Bar */}
      <div className="flex flex-col md:flex-row items-center justify-between gap-3 bg-neutral-950/60 p-3 rounded-2xl border border-neutral-800">
        <div className="flex items-center gap-1.5 overflow-x-auto w-full md:w-auto pb-1 md:pb-0">
          {filterTabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setFilterStage(tab.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${
                filterStage === tab.id
                  ? 'bg-emerald-500 text-black font-semibold'
                  : 'text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800/60'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <input
          type="text"
          placeholder="Filter by role or company..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full md:w-64 px-3 py-1.5 bg-neutral-900 border border-neutral-800 rounded-lg text-xs text-white placeholder-neutral-500 focus:outline-none focus:border-emerald-500"
        />
      </div>

      {/* Table */}
      <div className="bg-neutral-950/60 rounded-2xl border border-neutral-800 overflow-hidden shadow-sm">
        <table className="w-full text-left text-xs">
          <thead className="bg-neutral-900/60 border-b border-neutral-800 text-neutral-400 uppercase text-[10px] tracking-wider font-semibold">
            <tr>
              <th className="py-3 px-4">Role & Company</th>
              <th className="py-3 px-4">Stage</th>
              <th className="py-3 px-4">ATS Match</th>
              <th className="py-3 px-4">Tailored Resume</th>
              <th className="py-3 px-4">Applied Date</th>
              <th className="py-3 px-4 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-800/80">
            {filteredApps.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-12 text-center text-neutral-500 text-xs">
                  No applications match your filter criteria.
                </td>
              </tr>
            ) : (
              filteredApps.map((app) => {
                const atsScore = app.atsScoreSnapshot?.overallScore;
                const resumeId = app.resumeSnapshot?.resumeId || app.tailoredResumeId;
                return (
                  <tr
                    key={app.id}
                    onClick={() => onSelect(app)}
                    className="hover:bg-neutral-900/50 cursor-pointer transition-colors"
                  >
                    <td className="py-3.5 px-4 font-medium">
                      <div className="font-semibold text-white group-hover:text-emerald-400">
                        {app.jobTitle}
                      </div>
                      <div className="flex items-center gap-1.5 text-[11px] text-neutral-400 mt-0.5">
                        <Building2 className="w-3 h-3 text-neutral-500" />
                        <span>{app.company}</span>
                        <span className="text-neutral-600">•</span>
                        <MapPin className="w-3 h-3 text-neutral-500" />
                        <span>{app.location}</span>
                      </div>
                    </td>

                    <td className="py-3.5 px-4">
                      <span
                        className={`inline-block px-2.5 py-0.5 rounded-full text-[10px] font-semibold capitalize ${getStageBadge(
                          app.status
                        )}`}
                      >
                        {app.status === 'ready' ? 'Ready to Apply' : app.status}
                      </span>
                    </td>

                    <td className="py-3.5 px-4">
                      {atsScore !== undefined ? (
                        <span
                          className={`font-semibold text-xs ${
                            atsScore >= 80
                              ? 'text-emerald-400'
                              : atsScore >= 60
                              ? 'text-amber-400'
                              : 'text-neutral-400'
                          }`}
                        >
                          {atsScore}%
                        </span>
                      ) : (
                        <span className="text-neutral-600">—</span>
                      )}
                    </td>

                    <td className="py-3.5 px-4">
                      {resumeId ? (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            if (onPreviewResume) onPreviewResume(resumeId);
                          }}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/20 text-[10px] font-medium transition-colors"
                        >
                          <FileText className="w-3 h-3" />
                          <span>View PDF</span>
                        </button>
                      ) : (
                        <span className="text-neutral-600 text-[11px]">None</span>
                      )}
                    </td>

                    <td className="py-3.5 px-4 text-neutral-400 text-[11px]">
                      {app.appliedAt ? new Date(app.appliedAt).toLocaleDateString() : '—'}
                    </td>

                    <td className="py-3.5 px-4 text-right">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onSelect(app);
                        }}
                        className="p-1 text-neutral-400 hover:text-white rounded hover:bg-neutral-800 transition-colors"
                        title="View Details"
                      >
                        <ChevronRight className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};
