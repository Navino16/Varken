import type { PointSpec } from '../../../types/plugin.types';
import { booleanFlags } from './flags';
import { eventTimestamp } from './events';
import { isNumber, pickNumbers } from './numbers';
import { dotnetTime } from './time';

export interface ServarrQueueLike {
  size?: number;
  sizeleft?: number;
  estimatedCompletionTime?: string | null;
  status?: string | null;
  trackedDownloadState?: string;
  trackedDownloadStatus?: string;
  downloadClient?: string | null;
  indexer?: string | null;
}

export interface ServarrHealthItemLike {
  source?: string | null;
  type?: 'ok' | 'notice' | 'warning' | 'error';
  message?: string | null;
}

export interface ServarrDiskLike {
  path?: string | null;
  label?: string | null;
  freeSpace?: number;
  totalSpace?: number;
}

export interface ServarrRootFolderLike {
  path?: string | null;
  name?: string | null;
  accessible?: boolean;
  freeSpace?: number | null;
  totalSpace?: number | null;
  unmappedFolders?: readonly unknown[] | null;
}

export interface ServarrQueueStatusLike {
  totalCount?: number;
  count?: number;
  unknownCount?: number;
  errors?: boolean;
  warnings?: boolean;
  unknownErrors?: boolean;
  unknownWarnings?: boolean;
}

export interface ServarrTaskLike {
  name?: string | null;
  taskName?: string | null;
  interval?: number;
  lastExecution?: string;
  lastDuration?: string;
  nextExecution?: string;
}

export interface ServarrHistoryLike {
  id?: number;
  date?: string;
  eventType?: string;
  quality?: { quality?: { name?: string | null } } | null;
  data?: { [key: string]: string | null } | null;
}

export interface ServarrStatusInput {
  health: readonly ServarrHealthItemLike[];
  disks: readonly ServarrDiskLike[];
  roots: readonly ServarrRootFolderLike[];
  queue: ServarrQueueStatusLike;
  tasks: readonly ServarrTaskLike[];
}

const label = (value: string | null | undefined): string => value || 'unknown';

/** .NET TimeSpan `[d.]hh:mm:ss[.fffffff]` → seconds. */
export function parseTimeSpan(span: string | null | undefined): number | undefined {
  const match = /^(?:(\d+)\.)?(\d+):(\d{2}):(\d{2})(\.\d+)?$/.exec(span ?? '');
  if (!match) {
    return undefined;
  }
  const [, days, hours, minutes, seconds, fraction] = match;
  return Number(days ?? 0) * 86400 + Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds) + Number(fraction ?? 0);
}

export function queueEnrichment(
  item: ServarrQueueLike,
  now: Date
): { tags: Record<string, string>; fields: Record<string, number>; floatFields: string[] } {
  const fields: Record<string, number> = {};
  if (isNumber(item.size)) {
    fields.size = Math.round(item.size);
  }
  if (isNumber(item.sizeleft)) {
    fields.sizeleft = Math.round(item.sizeleft);
  }
  if (isNumber(item.size) && isNumber(item.sizeleft) && item.size > 0 && item.sizeleft >= 0 && item.sizeleft <= item.size) {
    fields.progress = (100 * (item.size - item.sizeleft)) / item.size;
  }
  const eta = dotnetTime(item.estimatedCompletionTime);
  if (eta !== undefined) {
    fields.eta_seconds = Math.max(0, Math.floor((eta - now.getTime()) / 1000));
  }
  return {
    tags: {
      status: label(item.status),
      tracked_download_state: label(item.trackedDownloadState),
      tracked_download_status: label(item.trackedDownloadStatus),
      download_client: label(item.downloadClient),
      indexer: label(item.indexer),
    },
    fields,
    floatFields: ['progress'],
  };
}

export function healthPoints(health: readonly ServarrHealthItemLike[], hash: (s: string) => string): PointSpec[] {
  const countOf = (type: ServarrHealthItemLike['type']): number => health.filter((h) => h.type === type).length;
  const issues = health
    .filter((h) => h.type !== 'ok')
    .map((h) => ({
      tags: { type: 'HealthIssue', source: label(h.source), level: label(h.type) },
      fields: { message: h.message ?? '', hash: hash(`${h.source ?? ''}${h.message ?? ''}`) },
    }));
  return [{ tags: { type: 'Health' }, fields: { errors: countOf('error'), warnings: countOf('warning'), notices: countOf('notice') } }, ...issues];
}

export function taskPoints(tasks: readonly ServarrTaskLike[], now: Date): PointSpec[] {
  return tasks.map((task) => {
    const fields: Record<string, number> = pickNumbers(task, { interval: 'interval_minutes' });
    const last = dotnetTime(task.lastExecution);
    if (last !== undefined) {
      fields.last_execution_age_seconds = Math.floor((now.getTime() - last) / 1000);
    }
    const duration = parseTimeSpan(task.lastDuration);
    if (duration !== undefined) {
      fields.last_duration_seconds = duration;
    }
    const next = dotnetTime(task.nextExecution);
    if (next !== undefined) {
      fields.next_execution_in_seconds = Math.round((next - now.getTime()) / 1000);
    }
    return { tags: { type: 'Task', task: label(task.taskName), name: label(task.name) }, fields, floatFields: ['last_duration_seconds'] };
  });
}

function diskPoint(disk: ServarrDiskLike): PointSpec {
  const fields = pickNumbers(disk, { freeSpace: 'free_bytes', totalSpace: 'total_bytes' });
  if (isNumber(disk.freeSpace) && isNumber(disk.totalSpace) && disk.totalSpace > 0) {
    fields.used_percent = (100 * (disk.totalSpace - disk.freeSpace)) / disk.totalSpace;
  }
  return { tags: { type: 'DiskSpace', path: label(disk.path), label: label(disk.label) }, fields, floatFields: ['used_percent'] };
}

function rootFolderPoint(root: ServarrRootFolderLike): PointSpec {
  const tags: Record<string, string> = { type: 'RootFolder', path: label(root.path) };
  if (root.name !== undefined) {
    tags.name = label(root.name);
  }
  const fields = { ...booleanFlags({ accessible: root.accessible }), ...pickNumbers(root, { freeSpace: 'free_bytes', totalSpace: 'total_bytes' }) };
  if (Array.isArray(root.unmappedFolders)) {
    fields.unmapped_folders = root.unmappedFolders.length;
  }
  return { tags, fields };
}

function queueStatusPoint(queue: ServarrQueueStatusLike): PointSpec {
  return {
    tags: { type: 'QueueStatus' },
    fields: {
      ...pickNumbers(queue, { totalCount: 'total_count', count: 'count', unknownCount: 'unknown_count' }),
      ...booleanFlags({
        has_errors: queue.errors,
        has_warnings: queue.warnings,
        has_unknown_errors: queue.unknownErrors,
        has_unknown_warnings: queue.unknownWarnings,
      }),
    },
  };
}

export function statusPoints(input: ServarrStatusInput, now: Date, hash: (s: string) => string): PointSpec[] {
  return [
    ...healthPoints(input.health, hash),
    ...input.disks.map(diskPoint),
    ...input.roots.map(rootFolderPoint),
    queueStatusPoint(input.queue),
    ...taskPoints(input.tasks, now),
  ];
}

export function totalsPoint(totals: { missing?: number; cutoff_unmet?: number; blocklist?: number }): PointSpec {
  return { tags: { type: 'Totals' }, fields: pickNumbers(totals, { missing: 'missing', cutoff_unmet: 'cutoff_unmet', blocklist: 'blocklist' }) };
}

export function historyPoint(record: ServarrHistoryLike, idTags: Record<string, number>, hash: string): PointSpec | undefined {
  const time = Date.parse(record.date ?? '');
  if (!Number.isFinite(time)) {
    return undefined;
  }
  const data = record.data ?? {};
  const fields: Record<string, string | number> = { hash };
  const size = Number(data.size);
  if (data.size && Number.isFinite(size) && size > 0) {
    fields.size = size;
  }
  return {
    tags: {
      type: 'History',
      event_type: label(record.eventType),
      quality: label(record.quality?.quality?.name),
      download_client: label(data.downloadClientName || data.downloadClient),
      indexer: label(data.indexer),
      ...idTags,
    },
    fields,
    timestamp: eventTimestamp(time, record.id),
  };
}

const MIN_RELEASE_TIME = Date.UTC(1000, 0, 1);

/** Whole days since a release date; undefined when absent, unparsable, in the future or .NET `DateTime.MinValue`. */
export function releaseAgeDays(date: string | null | undefined, now: Date): number | undefined {
  const time = Date.parse(date ?? '');
  if (!Number.isFinite(time) || time < MIN_RELEASE_TIME || time > now.getTime()) {
    return undefined;
  }
  return Math.floor((now.getTime() - time) / 86_400_000);
}

/** `{ itemField: summaryField }` → summary fields summing the numeric item fields (0 when no item has one). */
export function sumFields(specs: readonly PointSpec[], keys: Record<string, string>): Record<string, number> {
  const sums: Record<string, number> = {};
  for (const [key, field] of Object.entries(keys)) {
    sums[field] = specs.reduce((total, spec) => total + (isNumber(spec.fields[key]) ? (spec.fields[key] as number) : 0), 0);
  }
  return sums;
}
