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
  async initialize(): Promise<void> {}
  async write(points: DataPoint[]): Promise<void> {
    this.points.push(...points);
  }
  async healthCheck(): Promise<boolean> {
    return true;
  }
  async shutdown(): Promise<void> {}
}

const END = new Date('2026-12-02T12:00:00Z');

async function seed(): Promise<{ summary: SeedSummary; points: DataPoint[] }> {
  const output = new MemoryOutput();
  const summary = await seedDemo({ outputs: new Map([['memory', output]]), end: END, days: 3, stepSeconds: 3600 });
  return { summary, points: output.points };
}

const stable = (points: DataPoint[]): string[] =>
  points
    .filter((p) => p.measurement !== 'Varken')
    .map((p) => JSON.stringify([p.measurement, p.timestamp.toISOString(), p.tags, p.fields]))
    .sort();

describe('seedDemo', () => {
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

  it('is deterministic across runs', async () => {
    const first = await seed();
    const second = await seed();

    expect(stable(second.points)).toEqual(stable(first.points));
  });
});
