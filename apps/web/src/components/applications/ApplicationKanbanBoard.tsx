import React, { useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Layers,
  CheckCircle2,
  Send,
  Calendar,
  Trophy,
  XCircle,
  Archive,
} from 'lucide-react';
import { ApplicationRecord, ApplicationStage, ActivityDateRange } from '../../types/application';
import { ApplicationCard } from './ApplicationCard';

interface Props {
  applications: ApplicationRecord[];
  dateRange?: ActivityDateRange;
  onResetDateFilter?: () => void;
  onSelect: (app: ApplicationRecord) => void;
  onMoveStage: (app: ApplicationRecord, newStage: ApplicationStage, note?: string) => void;
  onPreviewResume?: (resumeId: string) => void;
  onAutofillPrompt?: (app: ApplicationRecord) => void;
  onOpenQaCopilot?: (app: ApplicationRecord) => void;
  onMissingResume?: (app: ApplicationRecord) => void;
  onPromptOutcome?: (app: ApplicationRecord) => void;
}

interface ColumnConfig {
  stage: ApplicationStage;
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  color: string;
  badgeBg: string;
  borderColor: string;
}

// Deterministic legal transitions enforced by backend state machine
const LEGAL_TRANSITIONS: Record<ApplicationStage, ApplicationStage[]> = {
  saved: ['ready', 'archived'],
  ready: ['saved', 'applied', 'archived'],
  applied: ['ready', 'interviewing', 'rejected', 'archived'],
  interviewing: ['applied', 'offer', 'rejected', 'archived'],
  offer: ['interviewing', 'archived'],
  rejected: ['interviewing', 'applied', 'archived', 'saved'],
  archived: ['saved'],
};

export const ApplicationKanbanBoard: React.FC<Props> = ({
  applications,
  dateRange,
  onResetDateFilter,
  onSelect,
  onMoveStage,
  onPreviewResume,
  onAutofillPrompt,
  onOpenQaCopilot,
  onMissingResume,
  onPromptOutcome,
}) => {
  const [concludedOpen, setConcludedOpen] = useState(false);
  const [draggingAppId, setDraggingAppId] = useState<string | null>(null);
  const [dragOverStage, setDragOverStage] = useState<ApplicationStage | null>(null);

  const activeColumns: ColumnConfig[] = [
    {
      stage: 'saved',
      title: 'Saved / Draft',
      icon: Layers,
      color: 'text-neutral-400',
      badgeBg: 'bg-neutral-800 text-neutral-300',
      borderColor: 'border-neutral-800',
    },
    {
      stage: 'ready',
      title: 'Ready to Apply',
      icon: CheckCircle2,
      color: 'text-emerald-400',
      badgeBg: 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20',
      borderColor: 'border-emerald-500/30',
    },
    {
      stage: 'applied',
      title: 'Applied',
      icon: Send,
      color: 'text-blue-400',
      badgeBg: 'bg-blue-500/10 text-blue-400 border border-blue-500/20',
      borderColor: 'border-blue-500/30',
    },
    {
      stage: 'interviewing',
      title: 'Interviewing',
      icon: Calendar,
      color: 'text-amber-400',
      badgeBg: 'bg-amber-500/10 text-amber-400 border border-amber-500/20',
      borderColor: 'border-amber-500/30',
    },
    {
      stage: 'offer',
      title: 'Offers',
      icon: Trophy,
      color: 'text-purple-400',
      badgeBg: 'bg-purple-500/10 text-purple-400 border border-purple-500/20',
      borderColor: 'border-purple-500/30',
    },
  ];

  const concludedColumns: ColumnConfig[] = [
    {
      stage: 'rejected',
      title: 'Rejected',
      icon: XCircle,
      color: 'text-red-400',
      badgeBg: 'bg-red-500/10 text-red-400 border border-red-500/20',
      borderColor: 'border-red-500/20',
    },
    {
      stage: 'archived',
      title: 'Archived',
      icon: Archive,
      color: 'text-neutral-500',
      badgeBg: 'bg-neutral-800 text-neutral-400',
      borderColor: 'border-neutral-800',
    },
  ];

  const rejectedCount = applications.filter((a) => a.status === 'rejected').length;
  const archivedCount = applications.filter((a) => a.status === 'archived').length;

  const handleCardDragStart = (e: React.DragEvent, app: ApplicationRecord) => {
    e.dataTransfer.setData('text/plain', app.id);
    e.dataTransfer.setData('application/json', JSON.stringify({ id: app.id, status: app.status }));
    e.dataTransfer.effectAllowed = 'move';
    setDraggingAppId(app.id);
  };

  const handleCardDragEnd = () => {
    setDraggingAppId(null);
    setDragOverStage(null);
  };

  const handleColumnDragOver = (e: React.DragEvent, targetStage: ApplicationStage) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dragOverStage !== targetStage) {
      setDragOverStage(targetStage);
    }
  };

  const handleColumnDragLeave = (e: React.DragEvent, targetStage: ApplicationStage) => {
    if (e.relatedTarget && !e.currentTarget.contains(e.relatedTarget as Node)) {
      if (dragOverStage === targetStage) {
        setDragOverStage(null);
      }
    }
  };

  const handleColumnDrop = (e: React.DragEvent, targetStage: ApplicationStage) => {
    e.preventDefault();
    setDragOverStage(null);

    let appId = '';
    try {
      if (typeof e.dataTransfer?.getData === 'function') {
        appId = e.dataTransfer.getData('text/plain');
      }
    } catch {}
    if (!appId && (e.dataTransfer as any)?.data?.['text/plain']) {
      appId = (e.dataTransfer as any).data['text/plain'];
    }
    if (!appId && draggingAppId) {
      appId = draggingAppId;
    }
    setDraggingAppId(null);

    if (!appId) return;

    const app = applications.find((a) => a.id === appId);
    if (!app) return;
    // Dropped in the same column: no-op
    if (app.status === targetStage) return;

    // 1. Gated: Saved -> Ready requires an APPROVED tailored resume snapshot
    if (app.status === 'saved' && targetStage === 'ready') {
      const hasApprovedResume = Boolean(app.resumeSnapshot?.resumeId);
      if (!hasApprovedResume) {
        // Intercept: block drop and open missing resume modal
        if (onMissingResume) {
          onMissingResume(app);
        }
        return;
      }
      onMoveStage(app, 'ready', 'Moved to Ready to Apply via drag-and-drop');
      return;
    }

    // 2. Interviewing -> Offer prompts outcome decision (Offer vs Rejected)
    if (app.status === 'interviewing' && targetStage === 'offer') {
      if (onPromptOutcome) {
        onPromptOutcome(app);
      } else {
        onMoveStage(app, 'offer', 'Received formal offer!');
      }
      return;
    }

    // 3. General legal transition check
    const allowed = LEGAL_TRANSITIONS[app.status] || [];
    if (!allowed.includes(targetStage)) {
      // Invalid drop: do not mutate state, card remains in original column
      return;
    }

    // 4. Execute validated transition
    onMoveStage(app, targetStage, `Moved to ${targetStage} via drag-and-drop`);
  };

  return (
    <div className="space-y-6">
      {/* Active Pipeline 5-Column Grid */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-4 items-start">
        {activeColumns.map((col) => {
          const colApps = applications.filter((a) => a.status === col.stage);
          const Icon = col.icon;
          const isTarget = dragOverStage === col.stage;

          return (
            <div
              key={col.stage}
              data-stage={col.stage}
              data-testid={"kanban-column-" + col.stage}
              onDragOver={(e) => handleColumnDragOver(e, col.stage)}
              onDragLeave={(e) => handleColumnDragLeave(e, col.stage)}
              onDrop={(e) => handleColumnDrop(e, col.stage)}
              className={`bg-neutral-950/60 rounded-2xl border p-3 flex flex-col min-h-[450px] shadow-sm transition-all duration-150 ${
                isTarget
                  ? 'border-emerald-500/70 bg-emerald-500/5 ring-2 ring-emerald-500/20 scale-[1.005]'
                  : col.borderColor
              }`}
            >
              {/* Column Header */}
              <div className="flex items-center justify-between pb-3 border-b border-neutral-800/80 mb-3 px-1">
                <div className="flex items-center gap-1.5">
                  <Icon className={`w-4 h-4 ${col.color}`} />
                  <span className="text-xs font-bold text-neutral-200">{col.title}</span>
                </div>
                <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${col.badgeBg}`}>
                  {colApps.length}
                </span>
              </div>

              {/* Cards Container */}
              <div className="space-y-2.5 flex-1">
                {colApps.length === 0 ? (
                  <div
                    className={`h-32 flex flex-col items-center justify-center text-center p-3 rounded-xl border border-dashed transition-colors text-[11px] ${
                      isTarget
                        ? 'border-emerald-500/40 text-emerald-400 bg-emerald-500/5 font-semibold pointer-events-none'
                        : 'border-neutral-800/60 text-neutral-500'
                    }`}
                  >
                    <span>
                      {isTarget
                        ? 'Drop here to move'
                        : ['applied', 'interviewing', 'offer'].includes(col.stage) && dateRange && dateRange !== 'all'
                        ? `No applications ${dateRange === 'today' ? 'submitted today' : dateRange === '7d' ? 'in last 7 days' : 'in last 30 days'}`
                        : 'No applications'}
                    </span>
                    {!isTarget && ['applied', 'interviewing', 'offer'].includes(col.stage) && dateRange && dateRange !== 'all' && onResetDateFilter && (
                      <button
                        type="button"
                        onClick={onResetDateFilter}
                        className="text-emerald-400 hover:text-emerald-300 hover:underline mt-1.5 text-[10px] cursor-pointer"
                      >
                        View All Time
                      </button>
                    )}
                  </div>
                ) : (
                  colApps.map((app) => (
                    <ApplicationCard
                      key={app.id}
                      application={app}
                      onSelect={onSelect}
                      onMoveStage={onMoveStage}
                      onPreviewResume={onPreviewResume}
                      onAutofillPrompt={onAutofillPrompt}
                      onOpenQaCopilot={onOpenQaCopilot}
                      isDraggable={true}
                      onDragStart={handleCardDragStart}
                      onDragEnd={handleCardDragEnd}
                      isDragging={draggingAppId === app.id}
                    />
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Collapsible Concluded Section (Rejected & Archived) */}
      <div className="rounded-2xl border border-neutral-800/80 bg-neutral-950/40 overflow-hidden">
        <button
          type="button"
          onClick={() => setConcludedOpen(!concludedOpen)}
          className="w-full px-4 py-3 flex items-center justify-between text-xs font-semibold text-neutral-400 hover:text-neutral-200 hover:bg-neutral-900/40 transition-colors cursor-pointer"
        >
          <div className="flex items-center gap-2">
            {concludedOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
            <span>Concluded Applications</span>
            <span className="text-[11px] font-normal text-neutral-500">
              ({rejectedCount} Rejected, {archivedCount} Archived)
            </span>
          </div>
          <span className="text-[10px] text-neutral-500">
            {concludedOpen ? 'Hide' : 'Show'}
          </span>
        </button>

        {concludedOpen && (
          <div className="p-4 border-t border-neutral-800/60 grid grid-cols-1 md:grid-cols-2 gap-4">
            {concludedColumns.map((col) => {
              const colApps = applications.filter((a) => a.status === col.stage);
              const Icon = col.icon;
              const isTarget = dragOverStage === col.stage;

              return (
                <div
                  key={col.stage}
                  data-stage={col.stage}
                  data-testid={"kanban-column-" + col.stage}
                  onDragOver={(e) => handleColumnDragOver(e, col.stage)}
                  onDragLeave={(e) => handleColumnDragLeave(e, col.stage)}
                  onDrop={(e) => handleColumnDrop(e, col.stage)}
                  className={`bg-neutral-900/40 rounded-xl border p-3 flex flex-col min-h-[250px] transition-all duration-150 ${
                    isTarget
                      ? 'border-emerald-500/70 bg-emerald-500/5 ring-2 ring-emerald-500/20'
                      : col.borderColor
                  }`}
                >
                  <div className="flex items-center justify-between pb-2 border-b border-neutral-800 mb-3 px-1">
                    <div className="flex items-center gap-1.5">
                      <Icon className={`w-3.5 h-3.5 ${col.color}`} />
                      <span className="text-xs font-semibold text-neutral-300">{col.title}</span>
                    </div>
                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${col.badgeBg}`}>
                      {colApps.length}
                    </span>
                  </div>

                  <div className="space-y-2.5 flex-1">
                    {colApps.length === 0 ? (
                      <div
                        className={`h-24 pointer-events-none flex items-center justify-center text-center p-3 rounded-lg border border-dashed text-[11px] ${
                          isTarget
                            ? 'border-emerald-500/40 text-emerald-400 bg-emerald-500/5 font-semibold'
                            : 'border-neutral-800 text-neutral-600'
                        }`}
                      >
                        <span>{isTarget ? 'Drop here to conclude' : 'No concluded applications'}</span>
                      </div>
                    ) : (
                      colApps.map((app) => (
                        <ApplicationCard
                          key={app.id}
                          application={app}
                          onSelect={onSelect}
                          onMoveStage={onMoveStage}
                          onPreviewResume={onPreviewResume}
                          onAutofillPrompt={onAutofillPrompt}
                      onOpenQaCopilot={onOpenQaCopilot}
                          isDraggable={true}
                          onDragStart={handleCardDragStart}
                          onDragEnd={handleCardDragEnd}
                          isDragging={draggingAppId === app.id}
                        />
                      ))
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
