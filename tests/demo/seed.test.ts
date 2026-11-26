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

const stable = (points: DataPoint[]): string[] =>
  points
    .filter((p) => p.measurement !== 'Varken')
    .map((p) => JSON.stringify([p.measurement, p.timestamp.toISOString(), p.tags, p.fields]))
    .sort();

describe('seedDemo', { timeout: 60_000 }, () => {
  it('writes every input plugin and Varken', async () => {
    const { summary, points } = await seed();
    const plugins = [...getInputPluginRegistry().values()].map((Plugin) => new Plugin().metadata.name);

    expect(summary.measurements).toEqual([...plugins, 'Varken'].sort());
    expect(summary.steps).toBe(73);
    expect(summary.points).toBe(points.length);
    expect(summary.start).toEqual(new Date('2026-11-29T12:00:00Z'));
  });

  it('spreads snapshots over the window', async () => {
    const { points } = await seed();

    expect(new Set(points.filter((p) => p.measurement === 'Plex').map((p) => p.timestamp.getTime())).size).toBeGreaterThanOrEqual(70);
    expect(points.every((p) => p.timestamp.getTime() <= END.getTime())).toBe(true);
  });

  it('writes in batches of at most 5000 points', async () => {
    const { summary, batches } = await seed();

    expect(Math.max(...batches)).toBeLessThanOrEqual(5000);
    expect(batches.length).toBeLessThan(summary.steps / 4);
  });

  it('counts one output write per step in the self-metrics', async () => {
    const { points } = await seed();
    const writes = points.filter((p) => p.measurement === 'Varken' && p.tags.type === 'Output').map((p) => Number(p.fields.writes));

    expect(writes.length).toBeGreaterThan(60);
    expect(writes.every((count) => count === 1)).toBe(true);
  });

  it('is deterministic across runs', async () => {
    const first = await seed();
    const second = await seed();

    expect(stable(second.points)).toEqual(stable(first.points));
  });

  it('emits events from every event collector', async () => {
    const { points } = await seed();
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
    const { summary, points } = await seed();
    const isEvent = (p: DataPoint): boolean => ['History', 'Play'].includes(String(p.tags.type)) || (p.tags.type === 'Activity' && p.measurement !== 'Plex');
    const events = points.filter(isEvent);

    expect(events.length).toBeGreaterThan(0);
    for (const event of events) {
      expect(event.timestamp.getTime()).toBeGreaterThan(summary.start.getTime());
      expect(event.timestamp.getTime()).toBeLessThanOrEqual(END.getTime());
    }
  });

  it('varies live sessions with the hour', async () => {
    const { points } = await seed();
    const counts = new Set(points.filter((p) => p.measurement === 'Tautulli' && 'stream_count' in p.fields).map((p) => p.fields.stream_count));

    expect(counts.size).toBeGreaterThanOrEqual(3);
    expect(counts.has(0)).toBe(true);
  });

  it('records the Readarr outage', async () => {
    const { points } = await seed();
    const readarr = points.filter((p) => p.measurement === 'Varken' && p.tags.type === 'Collector' && p.tags.plugin === 'Readarr');
    const last = Math.max(...readarr.map((p) => p.timestamp.getTime()));

    expect(readarr.some((p) => Number(p.fields.errors) > 0)).toBe(true);
    expect(readarr.some((p) => p.fields.circuit_state === 2)).toBe(true);
    expect(readarr.filter((p) => p.timestamp.getTime() === last).every((p) => p.fields.circuit_state === 0)).toBe(true);
  });
});
