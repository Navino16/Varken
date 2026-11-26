import type { PointSpec } from '../../../types/plugin.types';
import type { components } from '../../../types/generated/tautulli';
import { numberOf } from './numbers';
import { ageSeconds } from './time';
import { bucketRange, type Bucket } from './buckets';

type Graph = components['schemas']['Graph'];
type HomeStat = components['schemas']['HomeStat'];
type WatchTimeStat = components['schemas']['WatchTimeStat'];
type MediaInfoRow = components['schemas']['MediaInfoRow'];

export function seriesKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function seriesFields(graph: Graph, index: number): Record<string, number> {
  const fields: Record<string, number> = {};
  for (const series of graph.series ?? []) {
    const value = series.data?.[index];
    if (series.name && typeof value === 'number' && Number.isFinite(value)) {
      fields[seriesKey(series.name)] = value;
    }
  }
  return fields;
}

export function graphSnapshotPoints(type: string, categoryTag: string, graph: Graph): PointSpec[] {
  const points: PointSpec[] = [];
  for (const [index, category] of (graph.categories ?? []).entries()) {
    const fields = seriesFields(graph, index);
    if (Object.keys(fields).length > 0) {
      points.push({ tags: { type, [categoryTag]: category }, fields });
    }
  }
  return points;
}

/** Tautulli's last category is its current day or month, still in progress; `skipped` lists categories that do not parse. */
export function completedBuckets(graph: Graph, unit: 'day' | 'month'): { buckets: Bucket[]; skipped: string[] } {
  const categories = graph.categories ?? [];
  const buckets: Bucket[] = [];
  const skipped: string[] = [];
  for (const [index, category] of categories.slice(0, -1).entries()) {
    const fields = seriesFields(graph, index);
    if (Object.keys(fields).length === 0) {
      continue;
    }
    const range = bucketRange(category, unit);
    if (range) {
      buckets.push({ category, ...range, fields });
    } else {
      skipped.push(category);
    }
  }
  return { buckets, skipped };
}

type HomeStatRow = NonNullable<HomeStat['rows']>[number];

const LABELS: Record<string, keyof HomeStatRow> = { top_users: 'friendly_name', top_platforms: 'platform_name', top_libraries: 'section_name' };

function rowLabel(statId: string, row: HomeStatRow): string | undefined {
  const label = row[LABELS[statId] ?? 'title'];
  return typeof label === 'string' && label !== '' ? label : undefined;
}

export function homeStatPoints(stats: readonly HomeStat[], now: Date): PointSpec[] {
  const points: PointSpec[] = [];
  for (const stat of stats) {
    if (!stat.stat_id) {
      continue;
    }
    for (const [index, row] of (stat.rows ?? []).entries()) {
      const fields: Record<string, string | number> = {};
      const label = rowLabel(stat.stat_id, row);
      if (label !== undefined) {
        fields.title = label;
      }
      const put = (key: string, value: number | undefined): void => {
        if (value !== undefined) {
          fields[key] = value;
        }
      };
      put('plays', numberOf(row.total_plays));
      put('duration_seconds', numberOf(row.total_duration));
      put('users_watched', numberOf(row.users_watched));
      put('count', numberOf(row.count));
      const lastPlay = numberOf(row.last_play ?? row.last_watch);
      put('last_play_age_seconds', ageSeconds(lastPlay === undefined ? undefined : lastPlay * 1000, now));
      points.push({ tags: { type: 'HomeStat', stat_id: stat.stat_id, rank: index + 1 }, fields });
    }
  }
  return points;
}

export function watchTimeFields(stats: readonly WatchTimeStat[]): Record<string, number> {
  const fields: Record<string, number> = {};
  for (const stat of stats) {
    if (stat.query_days === undefined) {
      continue;
    }
    const suffix = stat.query_days === 0 ? 'all' : `${stat.query_days}d`;
    if (stat.total_plays !== undefined) {
      fields[`plays_${suffix}`] = stat.total_plays;
    }
    if (stat.total_time !== undefined) {
      fields[`watch_seconds_${suffix}`] = stat.total_time;
    }
  }
  return fields;
}

export function mediaInfoPoints(tags: Record<string, string | number>, rows: readonly MediaInfoRow[]): PointSpec[] {
  const groups = new Map<string, { resolution: string; codec: string; items: number; size?: number }>();
  for (const row of rows) {
    const resolution = row.video_resolution || 'unknown';
    const codec = row.video_codec || 'unknown';
    const key = `${resolution}\u0000${codec}`;
    const group = groups.get(key) ?? { resolution, codec, items: 0 };
    group.items += 1;
    const size = numberOf(row.file_size);
    if (size !== undefined) {
      group.size = (group.size ?? 0) + size;
    }
    groups.set(key, group);
  }
  return [...groups.values()].map((group): PointSpec => {
    const fields: Record<string, number> = { items: group.items };
    if (group.size !== undefined) {
      fields.file_size = group.size;
    }
    return { tags: { type: 'MediaInfo', ...tags, video_resolution: group.resolution, video_codec: group.codec }, fields };
  });
}
