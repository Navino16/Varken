import { describe, it, expect } from 'vitest';
import { GlobalConfigSchema, InputsConfigSchema } from '../../src/config/schemas/config.schema';
import type { SourceSpec } from '../../src/dashboards/model';
import { MEASUREMENTS, resolveSources, type SourceContext } from '../../src/dashboards/sources';
import { getInputPluginRegistry } from '../../src/plugins/inputs';

function context(inputs: Record<string, unknown>, options: { selfMetrics?: boolean; pairedPlex?: number[] } = {}): SourceContext {
  return {
    config: {
      inputs: InputsConfigSchema.parse(inputs),
      global: GlobalConfigSchema.parse({ selfMetrics: { enabled: options.selfMetrics ?? true, intervalSeconds: 60 } }),
    },
    pairedPlex: new Set(options.pairedPlex ?? []),
  };
}

const queue: SourceSpec = { plugin: 'sonarr', collector: 'queue', type: 'Queue', fields: [{ name: 'size', kind: 'number' }] };
const sonarr = (id: number, intervalSeconds: number, enabled = true): object => ({
  id,
  url: `http://sonarr-${id}.test`,
  apiKey: 'key',
  queue: { enabled, intervalSeconds },
});

describe('MEASUREMENTS', () => {
  it('names every input plugin after its measurement', () => {
    for (const [key, Plugin] of getInputPluginRegistry()) {
      expect(MEASUREMENTS[key as keyof typeof MEASUREMENTS]).toBe(new Plugin().metadata.name);
    }
    expect(MEASUREMENTS.varken).toBe('Varken');
  });
});

describe('resolveSources', () => {
  it('gives each instance its own collector interval', () => {
    const sources = resolveSources(queue, context({ sonarr: [sonarr(1, 30), sonarr(2, 120)] }));

    expect(sources.map((s) => [s.measurement, s.server, s.intervalSeconds, s.label])).toEqual([
      ['Sonarr', 1, 30, 'Sonarr 1'],
      ['Sonarr', 2, 120, 'Sonarr 2'],
    ]);
  });

  it('skips instances whose collector is disabled', () => {
    expect(resolveSources(queue, context({ sonarr: [sonarr(1, 30, false)] }))).toEqual([]);
  });

  it('skips services that are not configured', () => {
    expect(resolveSources(queue, context({ radarr: [{ id: 1, url: 'http://radarr.test', apiKey: 'key' }] }))).toEqual([]);
  });

  it('requires every extra config flag', () => {
    const geoip: SourceSpec = { plugin: 'tautulli', collector: 'activity', requires: ['geoip.enabled'], type: 'Session', fields: [{ name: 'lat', kind: 'number' }] };
    const base = { id: 1, url: 'http://tautulli.test', apiKey: 'key', activity: { enabled: true, intervalSeconds: 30 } };

    expect(resolveSources(geoip, context({ tautulli: [base] }))).toEqual([]);
    expect(resolveSources(geoip, context({ tautulli: [{ ...base, geoip: { enabled: true } }] }))).toHaveLength(1);
  });

  it('leaves paired Plex instances out of streaming sources only', () => {
    const plex = (id: number): object => ({ id, url: `http://plex-${id}.test`, token: 't', sessions: { enabled: true, intervalSeconds: 30 } });
    const spec: SourceSpec = { plugin: 'plex', collector: 'sessions', type: 'current_stream_stats', fields: [{ name: 'stream_count', kind: 'number' }] };
    const ctx = context({ plex: [plex(1), plex(2)] }, { pairedPlex: [1] });

    expect(resolveSources({ ...spec, streaming: true }, ctx).map((s) => s.server)).toEqual([2]);
    expect(resolveSources(spec, ctx).map((s) => s.server)).toEqual([1, 2]);
  });

  it('raises the interval to the source minimum', () => {
    const spec: SourceSpec = { ...queue, minIntervalSeconds: 300 };

    expect(resolveSources(spec, context({ sonarr: [sonarr(1, 60)] }))[0].intervalSeconds).toBe(300);
  });

  it('reads day intervals in seconds', () => {
    const spec: SourceSpec = { plugin: 'sonarr', collector: 'library', type: 'Library', fields: [{ name: 'series', kind: 'number' }] };
    const sources = resolveSources(spec, context({ sonarr: [{ id: 1, url: 'http://s.test', apiKey: 'k', library: { enabled: true, intervalDays: 2 } }] }));

    expect(sources[0].intervalSeconds).toBe(172_800);
  });

  it('reads Varken self-metrics while they are enabled', () => {
    const spec: SourceSpec = { plugin: 'varken', type: 'Status', fields: [{ name: 'collectors', kind: 'number' }] };

    expect(resolveSources(spec, context({ sonarr: [sonarr(1, 30)] }))).toEqual([
      { spec, measurement: 'Varken', intervalSeconds: 60, label: 'Varken' },
    ]);
    expect(resolveSources(spec, context({ sonarr: [sonarr(1, 30)] }, { selfMetrics: false }))).toEqual([]);
  });
});
