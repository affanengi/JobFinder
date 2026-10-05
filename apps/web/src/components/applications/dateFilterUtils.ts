import { ApplicationRecord, ActivityDateRange } from '../../types/application';

/**
 * Filter an application record based on the selected activity date range.
 *
 * SCOPE RULE:
 * - Saved / Draft ('saved') and Ready to Apply ('ready') are active preparation/action
 *   queues and are NEVER filtered by date.
 * - Historical progression stages ('applied', 'interviewing', 'offer', 'rejected', 'archived')
 *   are filtered against their stage-specific transition timestamp.
 */
export function isApplicationInDateRange(
  app: ApplicationRecord,
  range: ActivityDateRange,
  now: Date = new Date()
): boolean {
  if (range === 'all') return true;

  // Active inventory/prep queues remain permanently unaffected
  if (app.status === 'saved' || app.status === 'ready') {
    return true;
  }

  // Resolve stage-specific transition timestamp
  let timestampStr: string | undefined | null = null;
  if (app.status === 'applied') {
    timestampStr = app.stageTimestamps?.applied || app.appliedAt || app.createdAt;
  } else if (app.status === 'interviewing') {
    timestampStr =
      app.stageTimestamps?.interviewing ||
      app.interviewEvents?.[0]?.scheduledAt ||
      app.updatedAt;
  } else if (app.status === 'offer') {
    timestampStr =
      app.stageTimestamps?.offer ||
      (app.offerOutcome as any)?.decidedAt ||
      app.updatedAt;
  } else if (app.status === 'rejected') {
    timestampStr = app.stageTimestamps?.rejected || app.updatedAt;
  } else if (app.status === 'archived') {
    timestampStr = app.stageTimestamps?.archived || app.updatedAt;
  } else {
    timestampStr = app.updatedAt || app.createdAt;
  }

  if (!timestampStr) return false;

  const appDate = new Date(timestampStr);
  if (isNaN(appDate.getTime())) return true; // Gracefully retain if unparseable

  if (range === 'today') {
    return appDate.toDateString() === now.toDateString();
  }

  const diffMs = now.getTime() - appDate.getTime();
  const diffDays = diffMs / (1000 * 60 * 60 * 24);

  if (range === '7d') {
    return diffDays >= 0 && diffDays <= 7;
  }

  if (range === '30d') {
    return diffDays >= 0 && diffDays <= 30;
  }

  return true;
}

/**
 * Produce a human-friendly relative timestamp for cards (e.g. "Applied 2d ago", "Applied today").
 */
export function getRelativeTimeLabel(
  dateStr?: string | null,
  prefix: string = 'Applied',
  now: Date = new Date()
): string | null {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return `${prefix}: ${dateStr}`;

  if (d.toDateString() === now.toDateString()) {
    return `${prefix} today`;
  }

  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) {
    return `${prefix} yesterday`;
  }

  const diffMs = now.getTime() - d.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays >= 1 && diffDays <= 13) {
    return `${prefix} ${diffDays}d ago`;
  }
  if (diffDays >= 14 && diffDays <= 45) {
    const weeks = Math.round(diffDays / 7);
    return `${prefix} ${weeks}w ago`;
  }

  return `${prefix}: ${d.toLocaleDateString()}`;
}
