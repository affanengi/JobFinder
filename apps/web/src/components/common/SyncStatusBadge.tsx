import React from 'react';
import { useSync, SyncStatus } from '../../context/SyncContext';

export interface SyncStatusBadgeProps {
  className?: string;
  variant?: 'pill' | 'dashboard';
  statusOverride?: SyncStatus;
}

export const SyncStatusBadge: React.FC<SyncStatusBadgeProps> = ({
  className = '',
  variant = 'pill',
  statusOverride,
}) => {
  const sync = useSync();
  const status = statusOverride || sync.status;

  const getStatusConfig = () => {
    switch (status) {
      case 'SIGNED_OUT':
        return {
          label: 'Guest Mode · Local Only',
          pillClasses: 'bg-neutral-800/80 border-neutral-700/80 text-neutral-400',
          dotClasses: 'bg-neutral-500',
          detail: sync.statusDetail || 'Signing in enables account-specific cloud persistence.',
        };
      case 'CONNECTING_CLOUD':
        return {
          label: 'Connecting to Cloud...',
          pillClasses: 'bg-amber-500/10 border-amber-500/30 text-amber-400',
          dotClasses: 'bg-amber-400 animate-pulse',
          detail: sync.statusDetail || 'Awaiting cloud synchronization confirmation.',
        };
      case 'SYNCED':
        return {
          label: 'Cloud Synced',
          pillClasses: 'bg-emerald-500/10 border-emerald-500/40 text-emerald-400',
          dotClasses: 'bg-emerald-400 animate-pulse',
          detail: sync.statusDetail || 'Changes confirmed persisted to Google Cloud Firestore.',
        };
      case 'DEGRADED':
        return {
          label: 'Sync Degraded',
          pillClasses: 'bg-rose-500/10 border-rose-500/30 text-rose-400',
          dotClasses: 'bg-rose-400',
          detail: sync.statusDetail || 'A recent cloud persistence operation failed.',
        };
    }
  };

  const config = getStatusConfig();

  if (variant === 'dashboard') {
    return (
      <div
        data-testid="sync-status-badge"
        className={`inline-flex items-center gap-2 text-xs font-medium text-neutral-400 ${className}`}
        title={config.detail}
      >
        <span className={`w-2 h-2 rounded-full ${config.dotClasses}`} />
        <span className="text-neutral-300 font-mono text-[11px]">{config.label}</span>
      </div>
    );
  }

  return (
    <div
      data-testid="sync-status-badge"
      className={`hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[11px] font-medium font-mono transition-colors shadow-sm select-none ${config.pillClasses} ${className}`}
      title={config.detail}
      role="status"
      aria-label={`Cloud Synchronization Status: ${config.label}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${config.dotClasses}`} />
      <span>{config.label}</span>
    </div>
  );
};
