import { describe, it, expect, vi } from 'vitest';
import { getInputPluginRegistry } from '../../src/plugins/inputs';
import type { DataPoint, OutputPlugin, PluginMetadata } from '../../src/types/plugin.types';
import { seedDemo, type SeedSummary } from './seed';

vi.mock('../../src/core/Logger', async () => {
  const { loggerMock } = await import('../fixtures/logger');
  return loggerMock();
});

class MemoryOutput implements OutputPlugin {
  readonly metadata: PluginMetadata = { name: 'Memory', version: '1.0.0', description: 'Keeps written points' };
  readonly points: DataPoint[] = [];
  readonly batches: number[] = [];
  async initialize(): Promise<void> {}
  async write(points: DataPoint[]): Promise<void> {
    this.batches.push(points.length);
    this.points.push(...points);
  }
  async healthCheck(): Promise<boolean> {
    return true;
  }
  async shutdown(): Promise<void> {}
}

const END = new Date('2026-12-02T12:00:00Z');

async function seed(): Promise<{ summary: SeedSummary; points: DataPoint[]; batches: number[] }> {
  const output = new MemoryOutput();
  const summary = await seedDemo({ outputs: new Map([['memory', output]]), end: END, days: 3, stepSeconds: 3600 });
  return { summary, points: output.points, batches: output.batches };
}

let shared: ReturnType<typeof seed> | undefined;
/** One seed for the read-only tests; the first test to run reports its contract violations. */
const seedOnce = (): ReturnType<typeof seed> => (shared ??= seed());

const stable = (points: DataPoint[]): string[] =>
  points
    .filter((p) => p.measurement !== 'Varken')
    .map((p) => JSON.stringify([p.measurement, p.timestamp.toISOString(), p.tags, p.fields]))
    .sort();

describe('seedDemo', { timeout: 60_000 }, () => {
  it('writes every input plugin and Varken', async () => {
    const { summary, points } = await seedOnce();
    const plugins = [...getInputPluginRegistry().values()].map((Plugin) => new Plugin().metadata.name);

    expect(summary.measurements).toEqual([...plugins, 'Varken'].sort());
    expect(summary.steps).toBe(73);
    expect(summary.points).toBe(points.length);
    expect(summary.start).toEqual(new Date('2026-11-29T12:00:00Z'));
  });

  it('spreads snapshots over the window', async () => {
    const { points } = await seedOnce();

    expect(new Set(points.filter((p) => p.measurement === 'Plex').map((p) => p.timestamp.getTime())).size).toBeGreaterThanOrEqual(70);
    expect(points.every((p) => p.timestamp.getTime() <= END.getTime())).toBe(true);
  });

  it('writes in batches of at most 5000 points', async () => {
    const { summary, batches } = await seedOnce();

    expect(Math.max(...batches)).toBeLessThanOrEqual(5000);
    expect(batches.length).toBeLessThan(summary.steps / 4);
  });

  it('counts output writes like production: one per collector run with points, self-metrics excluded', async () => {
    const { summary, points } = await seedOnce();
    const varken = (type: string): DataPoint[] => points.filter((p) => p.measurement === 'Varken' && p.tags.type === type);
    const total = (list: DataPoint[], field: string): number => list.reduce((sum, p) => sum + Number(p.fields[field] ?? 0), 0);

    expect(total(varken('Output'), 'points')).toBe(total(varken('Collector'), 'points'));
    expect(total(varken('Output'), 'writes')).toBeGreaterThan(summary.steps * 5);
  });

  it('is deterministic across runs', async () => {
    const first = await seedOnce();
    const second = await seed();

    expect(stable(second.points)).toEqual(stable(first.points));
  });

  it('emits events from every event collector', async () => {
    const { points } = await seedOnce();
    const types = new Set(points.map((p) => `${p.measurement}/${p.tags.type}`));
    const expected = [
      ...['Sonarr', 'Radarr', 'Lidarr', 'Readarr', 'Prowlarr', 'Bazarr'].map((m) => `${m}/History`),
      'Jellyfin/Activity',
      'Emby/Activity',
      'Plex/Play',
      'Plex/Bandwidth',
      ...['Play', 'RecentlyAdded', 'PlaysByDate', 'PlaysByStreamType', 'ConcurrentStreams', 'PlaysByMonth'].map((t) => `Tautulli/${t}`),
      'Bazarr/HistoryStats',
    ];

    expect(expected.filter((type) => !types.has(type))).toEqual([]);
  });

  it('dates events inside the simulated window', async () => {
    const { summary, points } = await seedOnce();
    const isEvent = (p: DataPoint): boolean => ['History', 'Play'].includes(String(p.tags.type)) || (p.tags.type === 'Activity' && p.measurement !== 'Plex');
    const events = points.filter(isEvent);

    expect(events.length).toBeGreaterThan(0);
    for (const event of events) {
      expect(event.timestamp.getTime()).toBeGreaterThan(summary.start.getTime());
      expect(event.timestamp.getTime()).toBeLessThanOrEqual(END.getTime());
    }
  });

  it('samples Plex resource usage along the simulated clock', async () => {
    const { summary, points } = await seedOnce();
    const resources = points.filter((p) => p.measurement === 'Plex' && p.tags.type === 'Resources');

    expect(new Set(resources.map((p) => p.timestamp.getTime())).size).toBeGreaterThanOrEqual(70);
    expect(resources.every((p) => p.timestamp.getTime() >= summary.start.getTime())).toBe(true);
    expect(new Set(resources.map((p) => p.fields.host_cpu_percent)).size).toBeGreaterThan(10);
  });

  it('varies live sessions with the hour', async () => {
    const { points } = await seedOnce();
    const counts = new Set(points.filter((p) => p.measurement === 'Tautulli' && 'stream_count' in p.fields).map((p) => p.fields.stream_count));

    expect(counts.size).toBeGreaterThanOrEqual(3);
    expect(counts.has(0)).toBe(true);
  });

  it('records the Readarr outage', async () => {
    const { points } = await seedOnce();
    const readarr = points.filter((p) => p.measurement === 'Varken' && p.tags.type === 'Collector' && p.tags.plugin === 'Readarr');
    const last = Math.max(...readarr.map((p) => p.timestamp.getTime()));

    expect(readarr.some((p) => Number(p.fields.errors) > 0)).toBe(true);
    expect(readarr.some((p) => p.fields.circuit_state === 2)).toBe(true);
    expect(readarr.filter((p) => p.timestamp.getTime() === last).every((p) => p.fields.circuit_state === 0)).toBe(true);
  });

  it('runs every collector without error outside the Readarr outage', async () => {
    const { points } = await seedOnce();
    const failing = points.filter((p) => p.measurement === 'Varken' && p.tags.type === 'Collector' && p.tags.plugin !== 'Readarr' && Number(p.fields.errors) > 0);

    expect(failing.map((p) => p.tags.collector)).toEqual([]);
  });

  it('restores the process timezone and real timers', async () => {
    const tz = process.env.TZ;
    process.env.TZ = 'Europe/Paris';
    try {
      await seed();
      expect(process.env.TZ).toBe('Europe/Paris');
      expect(vi.isFakeTimers()).toBe(false);
    } finally {
      process.env.TZ = tz;
    }
  });
});
