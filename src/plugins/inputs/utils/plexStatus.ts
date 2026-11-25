import type { PointSpec } from '../../../types/plugin.types';
import type { paths } from '../../../types/generated/plex';
import { booleanFlags } from './flags';
import { isNumber, pickNumbers } from './numbers';
import { ageSeconds } from './time';

type Json<P extends keyof paths> = paths[P] extends { get: { responses: { 200: { content: { 'application/json': infer R } } } } } ? R : never;
type Container<P extends keyof paths> = NonNullable<Json<P> extends { MediaContainer?: infer C } ? C : never>;

const label = (value: string | null | undefined): string => value || 'unknown';
const nonNegative = (value: number | undefined): number | undefined => (isNumber(value) && value >= 0 ? value : undefined);
const epochMs = (seconds: number | undefined): number | undefined => (isNumber(seconds) ? seconds * 1000 : undefined);

export function activityPoints(container: Container<'/activities'> | undefined): PointSpec[] {
  const activities = container?.Activity ?? [];
  return [
    { tags: { type: 'Activities' }, fields: { count: activities.length } },
    ...activities.map((a) => ({
      tags: { type: 'Activity', activity_type: label(a.type) },
      fields: { present: 1, ...pickNumbers(a, { progress: 'progress' }), ...booleanFlags({ cancellable: a.cancellable }) },
      floatFields: ['progress'],
    })),
  ];
}

export function backgroundTranscodePoints(container: Container<'/status/sessions/background'> | undefined): PointSpec[] {
  const jobs = container?.TranscodeJob ?? [];
  return [
    { tags: { type: 'BackgroundTranscodes' }, fields: { count: jobs.length } },
    ...jobs.map((job) => ({
      tags: { type: 'BackgroundTranscode', rating_key: label(job.ratingKey) },
      fields: {
        present: 1,
        ...pickNumbers(job, { progress: 'progress', speed: 'speed' }),
        // Plex writes negative sentinels (e.g. size -22) when a value is unknown.
        ...pickNumbers({ remaining: nonNegative(job.remaining), size: nonNegative(job.size) }, { remaining: 'remaining_seconds', size: 'size' }),
      },
      floatFields: ['progress', 'speed'],
    })),
  ];
}

export function butlerPoints(response: Json<'/butler'> | undefined): PointSpec[] {
  return (response?.ButlerTasks?.ButlerTask ?? []).map((task) => ({
    tags: { type: 'ButlerTask', task: label(task.name) },
    fields: {
      ...booleanFlags({ enabled: task.enabled, randomized: task.scheduleRandomized }),
      ...pickNumbers(task, { interval: 'interval_days' }),
    },
  }));
}

export function updaterPoint(container: Container<'/updater/status'> | undefined, now: Date): PointSpec {
  const releases = container?.Release ?? [];
  const fields: Record<string, number> = { ...booleanFlags({ can_install: container?.canInstall }), releases: releases.length };
  const checked = ageSeconds(epochMs(container?.checkedAt), now);
  if (checked !== undefined) {
    fields.checked_age_seconds = checked;
  }
  return { tags: { type: 'Updater', state: releases[0]?.state || 'none', version: releases[0]?.version || 'none' }, fields };
}

const RESOURCE_FIELDS = ['host_cpu_percent', 'host_memory_percent', 'process_cpu_percent', 'process_memory_percent'];

/** Most recent sample only: the point reports current usage. */
export function resourcesPoint(container: Container<'/statistics/resources'> | undefined): PointSpec | undefined {
  const latest = (container?.StatisticsResources ?? [])
    .filter((row) => isNumber(row.at))
    .reduce<NonNullable<Container<'/statistics/resources'>['StatisticsResources']>[number] | undefined>(
      (best, row) => (best === undefined || (row.at as number) > (best.at as number) ? row : best),
      undefined
    );
  if (!latest) {
    return undefined;
  }
  return {
    tags: { type: 'Resources' },
    fields: pickNumbers(latest, {
      hostCpuUtilization: 'host_cpu_percent',
      hostMemoryUtilization: 'host_memory_percent',
      processCpuUtilization: 'process_cpu_percent',
      processMemoryUtilization: 'process_memory_percent',
    }),
    timestamp: new Date((latest.at as number) * 1000),
    floatFields: RESOURCE_FIELDS,
  };
}

export function transcodeSessionsPoint(container: Container<'/transcode/sessions'> | undefined): PointSpec {
  const sessions = container?.TranscodeSession ?? [];
  const count = (predicate: (s: (typeof sessions)[number]) => unknown): number => sessions.filter(predicate).length;
  return {
    tags: { type: 'TranscodeSessions' },
    fields: {
      count: sessions.length,
      video_transcodes: count((s) => s.videoDecision === 'transcode'),
      audio_transcodes: count((s) => s.audioDecision === 'transcode'),
      hw_decoding: count((s) => s.transcodeHwDecoding),
      hw_encoding: count((s) => s.transcodeHwEncoding),
      throttled: count((s) => s.throttled),
    },
  };
}
