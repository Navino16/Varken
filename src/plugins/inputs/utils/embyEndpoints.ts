import type { PointSpec } from '../../../types/plugin.types';
import { booleanFlags } from './flags';
import { eventTimestamp } from './events';
import { isNumber } from './numbers';
import { ageSeconds, dotnetTime } from './time';

type Text = string | null | undefined;

export interface EmbyTaskLike {
  Key?: Text;
  Name?: Text;
  Category?: Text;
  State?: Text;
  CurrentProgressPercentage?: number | null;
  LastExecutionResult?: { Status?: Text; StartTimeUtc?: Text; EndTimeUtc?: Text } | null;
}

export interface EmbyPluginLike {
  Name?: Text;
  Version?: Text;
  Status?: Text;
}

export interface EmbyActivityLike {
  Id?: number;
  Type?: Text;
  Severity?: Text;
  UserId?: Text;
  ItemId?: Text;
  Name?: Text;
  Date?: Text;
}

export interface EmbyUserLike {
  Id?: Text;
  Name?: Text;
  HasPassword?: boolean | null;
  LastActivityDate?: Text;
  LastLoginDate?: Text;
  Policy?: { IsAdministrator?: boolean; IsDisabled?: boolean; IsHidden?: boolean } | null;
}

export interface EmbyDeviceLike {
  Id?: Text;
  Name?: Text;
  CustomName?: Text;
  AppName?: Text;
  AppVersion?: Text;
  LastUserName?: Text;
  DateLastActivity?: Text;
}

export interface EmbyTimerLike {
  Status?: Text;
  StartDate?: Text;
}

export interface FolderStorageLike {
  Path?: Text;
  FreeSpace?: number;
  UsedSpace?: number;
  StorageType?: Text;
}

export interface JellyfinStorageLike {
  ProgramDataFolder?: FolderStorageLike;
  WebFolder?: FolderStorageLike;
  ImageCacheFolder?: FolderStorageLike;
  CacheFolder?: FolderStorageLike;
  LogFolder?: FolderStorageLike;
  InternalMetadataFolder?: FolderStorageLike;
  TranscodingTempFolder?: FolderStorageLike;
  Libraries?: readonly { Name?: Text; Folders?: readonly FolderStorageLike[] | null }[] | null;
}

const DAY_SECONDS = 86_400;
const label = (value: Text): string => value || 'unknown';

export function taskPoints(tasks: readonly EmbyTaskLike[], now: Date): PointSpec[] {
  const points = tasks.map((task): PointSpec => {
    const result = task.LastExecutionResult;
    const start = dotnetTime(result?.StartTimeUtc);
    const end = dotnetTime(result?.EndTimeUtc);
    const fields: Record<string, number> = {};
    if (task.State === 'Running' && isNumber(task.CurrentProgressPercentage)) {
      fields.progress = task.CurrentProgressPercentage;
    }
    const age = ageSeconds(end, now);
    if (age !== undefined) {
      fields.last_execution_age_seconds = age;
    }
    if (start !== undefined && end !== undefined && end >= start) {
      fields.last_duration_seconds = (end - start) / 1000;
    }
    return {
      tags: {
        type: 'Task',
        task: label(task.Key),
        name: label(task.Name),
        category: label(task.Category),
        state: label(task.State),
        last_status: result?.Status || 'never',
      },
      fields,
      floatFields: ['progress', 'last_duration_seconds'],
    };
  });
  return [
    ...points,
    {
      tags: { type: 'Tasks' },
      fields: {
        running: tasks.filter((t) => t.State === 'Running').length,
        failed: tasks.filter((t) => t.LastExecutionResult?.Status === 'Failed').length,
      },
    },
  ];
}

const FAILING_PLUGIN_STATUSES = new Set(['Malfunctioned', 'NotSupported']);

export function pluginPoints(plugins: readonly EmbyPluginLike[]): PointSpec[] {
  const withStatus = plugins.some((p) => p.Status);
  const summary: Record<string, number> = { plugins: plugins.length };
  if (withStatus) {
    summary.plugins_active = plugins.filter((p) => p.Status === 'Active').length;
    summary.plugins_failing = plugins.filter((p) => FAILING_PLUGIN_STATUSES.has(p.Status ?? '')).length;
  }
  return [
    ...plugins.map((plugin) => ({
      tags: { type: 'Plugin', plugin: label(plugin.Name), version: label(plugin.Version), ...(plugin.Status ? { status: plugin.Status } : {}) },
      fields: { installed: 1 },
    })),
    { tags: { type: 'Plugins' }, fields: summary },
  ];
}

export function activityPoint(entry: EmbyActivityLike, hash: string): PointSpec | undefined {
  const time = Date.parse(entry.Date ?? '');
  if (!Number.isFinite(time)) {
    return undefined;
  }
  return {
    tags: {
      type: 'Activity',
      activity_type: label(entry.Type),
      severity: label(entry.Severity),
      user_id: label(entry.UserId),
      item_id: entry.ItemId || 'none',
    },
    fields: { hash, name: entry.Name ?? '' },
    timestamp: eventTimestamp(time, entry.Id),
  };
}

function activeWithin(times: readonly (number | undefined)[], seconds: number, now: Date): number {
  return times.filter((time) => time !== undefined && now.getTime() - time <= seconds * 1000).length;
}

export function userPoints(users: readonly EmbyUserLike[], now: Date): PointSpec[] {
  const lastActivity = users.map((u) => dotnetTime(u.LastActivityDate));
  const points = users.map((user, i): PointSpec => {
    const fields: Record<string, number> = booleanFlags({
      is_admin: user.Policy?.IsAdministrator,
      is_disabled: user.Policy?.IsDisabled,
      is_hidden: user.Policy?.IsHidden,
      has_password: user.HasPassword,
    });
    const activity = ageSeconds(lastActivity[i], now);
    if (activity !== undefined) {
      fields.last_activity_age_seconds = activity;
    }
    const login = ageSeconds(dotnetTime(user.LastLoginDate), now);
    if (login !== undefined) {
      fields.last_login_age_seconds = login;
    }
    return { tags: { type: 'User', user_id: label(user.Id), username: label(user.Name) }, fields };
  });
  return [
    ...points,
    {
      tags: { type: 'Users' },
      fields: {
        users: users.length,
        admins: users.filter((u) => u.Policy?.IsAdministrator).length,
        disabled: users.filter((u) => u.Policy?.IsDisabled).length,
        active_24h: activeWithin(lastActivity, DAY_SECONDS, now),
        active_30d: activeWithin(lastActivity, 30 * DAY_SECONDS, now),
      },
    },
  ];
}

export function devicePoints(devices: readonly EmbyDeviceLike[], now: Date): PointSpec[] {
  const lastActivity = devices.map((d) => dotnetTime(d.DateLastActivity));
  const points = devices.map((device, i): PointSpec => {
    const age = ageSeconds(lastActivity[i], now);
    return {
      tags: {
        type: 'Device',
        device_id: label(device.Id),
        device_name: label(device.CustomName || device.Name),
        app_name: label(device.AppName),
        app_version: label(device.AppVersion),
        last_user: label(device.LastUserName),
      },
      fields: age === undefined ? {} : { last_activity_age_seconds: age },
    };
  });
  return [...points, { tags: { type: 'Devices' }, fields: { devices: devices.length, active_24h: activeWithin(lastActivity, DAY_SECONDS, now) } }];
}

export function liveTvPoint(
  input: { recordings?: number; recordingsInProgress?: number; timers: readonly EmbyTimerLike[] },
  now: Date
): PointSpec {
  const { timers } = input;
  const fields: Record<string, number> = {};
  if (isNumber(input.recordings)) {
    fields.recordings = input.recordings;
  }
  if (isNumber(input.recordingsInProgress)) {
    fields.recordings_in_progress = input.recordingsInProgress;
  }
  fields.timers = timers.length;
  fields.recordings_scheduled = timers.filter((t) => t.Status === 'New').length;
  fields.recordings_failed = timers.filter((t) => t.Status === 'Error' || t.Status === 'ConflictedNotOk').length;
  const next = timers
    .map((t) => dotnetTime(t.StartDate))
    .filter((time): time is number => time !== undefined && time > now.getTime())
    .sort((a, b) => a - b)[0];
  if (next !== undefined) {
    fields.next_recording_in_seconds = Math.round((next - now.getTime()) / 1000);
  }
  return { tags: { type: 'LiveTv' }, fields };
}

const SYSTEM_FOLDERS = {
  ProgramDataFolder: 'program_data',
  WebFolder: 'web',
  ImageCacheFolder: 'image_cache',
  CacheFolder: 'cache',
  LogFolder: 'log',
  InternalMetadataFolder: 'internal_metadata',
  TranscodingTempFolder: 'transcoding_temp',
} as const;

/** Free and used space of the device holding each folder; Jellyfin reports -1 when the device cannot be read. */
function storagePoint(folder: FolderStorageLike, kind: string, library: string): PointSpec {
  const fields: Record<string, number> = {};
  const free = isNumber(folder.FreeSpace) && folder.FreeSpace >= 0 ? folder.FreeSpace : undefined;
  const used = isNumber(folder.UsedSpace) && folder.UsedSpace >= 0 ? folder.UsedSpace : undefined;
  if (free !== undefined) {
    fields.free_bytes = free;
  }
  if (used !== undefined) {
    fields.used_bytes = used;
  }
  if (free !== undefined && used !== undefined && free + used > 0) {
    fields.used_percent = (100 * used) / (free + used);
  }
  return {
    tags: { type: 'Storage', folder: kind, library, path: label(folder.Path), storage_type: label(folder.StorageType) },
    fields,
    floatFields: ['used_percent'],
  };
}

export function storagePoints(storage: JellyfinStorageLike): PointSpec[] {
  const system = (Object.entries(SYSTEM_FOLDERS) as [keyof typeof SYSTEM_FOLDERS, string][]).flatMap(([key, kind]) => {
    const folder = storage[key];
    return folder ? [storagePoint(folder, kind, 'none')] : [];
  });
  const libraries = (storage.Libraries ?? []).flatMap((library) =>
    (library.Folders ?? []).map((folder) => storagePoint(folder, 'library', label(library.Name)))
  );
  return [...system, ...libraries];
}
