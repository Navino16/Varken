import { uptimeSeconds } from './uptime';

export interface ServarrStatusLike {
  version?: string | null;
  branch?: string | null;
  startTime?: string;
}

export interface ServarrUpdateLike {
  installed?: boolean;
  installable?: boolean;
}

export interface ServarrHealthLike {
  type?: 'ok' | 'notice' | 'warning' | 'error';
}

/** Server info point content shared by Sonarr, Radarr, Lidarr, Readarr and Prowlarr. */
export function servarrServerInfo(
  status: ServarrStatusLike,
  updates: readonly ServarrUpdateLike[],
  health: readonly ServarrHealthLike[],
  now: Date
): { tags: { version: string; branch: string }; fields: Record<string, number> } {
  const countOf = (type: ServarrHealthLike['type']): number => health.filter((h) => h.type === type).length;
  const fields: Record<string, number> = {
    update_available: updates.some((u) => u.installable === true && u.installed !== true) ? 1 : 0,
    health_errors: countOf('error'),
    health_warnings: countOf('warning'),
    health_notices: countOf('notice'),
  };
  const uptime = uptimeSeconds(status.startTime, now);
  if (uptime !== undefined) {
    fields.uptime_seconds = uptime;
  }
  return { tags: { version: status.version || 'unknown', branch: status.branch || 'unknown' }, fields };
}
