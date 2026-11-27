import type { VarkenConfig } from '../config/schemas/config.schema';
import type { InputKey, ResolvedSource, SourceSpec } from './model';

export const MEASUREMENTS: Record<InputKey | 'varken', string> = {
  sonarr: 'Sonarr',
  radarr: 'Radarr',
  readarr: 'Readarr',
  lidarr: 'Lidarr',
  prowlarr: 'Prowlarr',
  bazarr: 'Bazarr',
  tautulli: 'Tautulli',
  plex: 'Plex',
  jellyfin: 'Jellyfin',
  emby: 'Emby',
  ombi: 'Ombi',
  overseerr: 'Overseerr',
  varken: 'Varken',
};

export interface SourceContext {
  config: Pick<VarkenConfig, 'inputs' | 'global'>;
  pairedPlex: ReadonlySet<number>;
}

interface Schedule {
  enabled?: boolean;
  intervalSeconds?: number;
  intervalDays?: number;
}

function valueAt(instance: object, path: string): unknown {
  return path.split('.').reduce<unknown>((value, key) => (value as Record<string, unknown> | undefined)?.[key], instance);
}

/** One source per configured instance that writes the spec's points. */
export function resolveSources(spec: SourceSpec, ctx: SourceContext): ResolvedSource[] {
  const measurement = MEASUREMENTS[spec.plugin];
  if (spec.plugin === 'varken') {
    const selfMetrics = ctx.config.global.selfMetrics;
    return selfMetrics.enabled ? [{ spec, measurement, intervalSeconds: selfMetrics.intervalSeconds, label: measurement }] : [];
  }
  const instances: { id: number }[] = ctx.config.inputs[spec.plugin] ?? [];
  return instances.flatMap((instance) => {
    const schedule = valueAt(instance, spec.collector ?? '') as Schedule | undefined;
    if (schedule?.enabled !== true || !(spec.requires ?? []).every((path) => valueAt(instance, path) === true)) {
      return [];
    }
    if (spec.streaming && spec.plugin === 'plex' && ctx.pairedPlex.has(instance.id)) {
      return [];
    }
    const interval = schedule.intervalSeconds ?? (schedule.intervalDays ?? 1) * 86_400;
    return [{ spec, measurement, server: instance.id, intervalSeconds: Math.max(interval, spec.minIntervalSeconds ?? 0), label: `${measurement} ${instance.id}` }];
  });
}
