import React from 'react';
import { CheckCircle2, Send, Calendar, Trophy, Layers } from 'lucide-react';
import { ApplicationRecord, ActivityDateRange } from '../../types/application';

interface Props {
  applications: ApplicationRecord[];
  filteredApplications?: ApplicationRecord[];
  dateRange?: ActivityDateRange;
}

export const ApplicationMetricsRibbon: React.FC<Props> = ({
  applications,
  filteredApplications,
  dateRange = 'all',
}) => {
  const activeSet = filteredApplications || applications;
  const total = applications.length;

  const totalInFlight = applications.filter((a) =>
    ['applied', 'interviewing', 'offer'].includes(a.status)
  ).length;

  const activePipeline = activeSet.filter((a) =>
    ['saved', 'ready', 'applied', 'interviewing', 'offer'].includes(a.status)
  ).length;

  // Ready to Apply is always unfiltered
  const readyToApply = applications.filter((a) => a.status === 'ready').length;

  // In Flight, Interviewing, and Offers reflect the active filtered set
  const inFlight = activeSet.filter((a) =>
    ['applied', 'interviewing', 'offer'].includes(a.status)
  ).length;

  const interviewing = activeSet.filter((a) => a.status === 'interviewing').length;
  const offers = activeSet.filter((a) => a.status === 'offer').length;

  const rangeLabelMap: Record<ActivityDateRange, string> = {
    today: 'Today',
    '7d': 'Last 7 Days',
    '30d': 'Last 30 Days',
    all: 'All Time',
  };

  const isFiltered = dateRange !== 'all';
  const inFlightSub = isFiltered
    ? `${inFlight} of ${totalInFlight} (${rangeLabelMap[dateRange]})`
    : `${totalInFlight} Total In-Flight`;

  const metrics = [
    {
      label: 'Active Pipeline',
      value: activePipeline,
      sub: `${total} Total Tracked`,
      icon: Layers,
      color: 'text-emerald-400',
      bg: 'bg-emerald-500/10 border-emerald-500/20',
    },
    {
      label: 'Ready to Apply',
      value: readyToApply,
      sub: 'Approved Resumes',
      icon: CheckCircle2,
      color: 'text-emerald-400',
      bg: 'bg-emerald-500/10 border-emerald-500/20',
    },
    {
      label: 'In Flight',
      value: inFlight,
      sub: inFlightSub,
      icon: Send,
      color: 'text-blue-400',
      bg: 'bg-blue-500/10 border-blue-500/20',
    },
    {
      label: 'Interviews Active',
      value: interviewing,
      sub: 'Rounds Scheduled',
      icon: Calendar,
      color: 'text-amber-400',
      bg: 'bg-amber-500/10 border-amber-500/20',
    },
    {
      label: 'Offers Received',
      value: offers,
      sub: 'Concluded Offers',
      icon: Trophy,
      color: 'text-purple-400',
      bg: 'bg-purple-500/10 border-purple-500/20',
    },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
      {metrics.map((m, idx) => {
        const Icon = m.icon;
        return (
          <div
            key={idx}
            className={`p-3.5 rounded-xl border ${m.bg} backdrop-blur-sm flex flex-col justify-between transition-all hover:scale-[1.01]`}
          >
            <div className="flex items-center justify-between mb-1">
              <span className="text-[11px] font-medium text-neutral-400 uppercase tracking-wider">
                {m.label}
              </span>
              <Icon className={`w-4 h-4 ${m.color}`} />
            </div>
            <div>
              <div className="text-2xl font-bold text-white tracking-tight">{m.value}</div>
              <div className="text-[10px] text-neutral-500 mt-0.5">{m.sub}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
};
