import { describe, it, expect } from 'vitest';
import { GlobalConfigSchema, InputsConfigSchema, type InputsConfig } from '../../src/config/schemas/config.schema';
import { generateDashboard, type GrafanaDashboard, type GrafanaPanel } from '../../src/dashboards';
import { demoInputs } from '../demo/config';

const global = GlobalConfigSchema.parse({});

function overview(inputs: InputsConfig, pairedPlex: number[] = [], options: { selfMetrics?: boolean } = {}): GrafanaDashboard {
  const config = { inputs, global: { ...global, selfMetrics: { ...global.selfMetrics, enabled: options.selfMetrics ?? true } } };
  return generateDashboard({ kind: 'overview', output: 'influxdb1', config, pairedPlex: new Set(pairedPlex), version: '9.9.9' });
}

function panel(dashboard: GrafanaDashboard, title: string): GrafanaPanel | undefined {
  return dashboard.panels.find((p) => p.title === title);
}

/** Measurement and server each target of a panel reads. */
function sources(dashboard: GrafanaDashboard, title: string): string[] {
  return (panel(dashboard, title)?.targets ?? []).map((target) => {
    const query = String(target.query);
    const server = /"server" = '(\d+)'/.exec(query)?.[1];
    return `${/FROM "([^"]+)"/.exec(query)?.[1]}${server ? ` ${server}` : ''}`;
  });
}

function withPlex(inputs: InputsConfig, plex: Record<string, unknown>): InputsConfig {
  return { ...inputs, plex: InputsConfigSchema.parse({ plex: [{ id: 1, url: 'http://plex.test', token: 't', ...plex }] }).plex };
}

const minimal = InputsConfigSchema.parse({ sonarr: [{ id: 1, url: 'http://sonarr.test', apiKey: 'k', queue: { enabled: true } }] });

describe('Overview', () => {
  it('matches the full snapshot', async () => {
    await expect(`${JSON.stringify(overview(demoInputs(), [1]), null, 2)}\n`).toMatchFileSnapshot('__snapshots__/overview-influxdb1-full.json');
  });

  it('matches the minimal snapshot', async () => {
    const dashboard = overview(minimal, [], { selfMetrics: false });

    expect(dashboard.panels.map((p) => p.title)).toEqual(['Now', 'Downloads', 'Stuck downloads', 'Download queue']);
    await expect(`${JSON.stringify(dashboard, null, 2)}\n`).toMatchFileSnapshot('__snapshots__/overview-influxdb1-minimal.json');
  });

  it('fills every line of the full dashboard', () => {
    const lines = new Map<number, number>();
    for (const p of overview(demoInputs(), [1]).panels) {
      lines.set(p.gridPos.y, (lines.get(p.gridPos.y) ?? 0) + p.gridPos.w);
    }

    expect([...lines.values()].every((width) => width === 24)).toBe(true);
  });

  it('excludes paired Plex from streaming panels', () => {
    const paired = overview(demoInputs(), [1]);

    for (const title of ['Streams', 'Bandwidth', 'Now playing', 'Streams · 24 h', 'Plays per day', 'Top users', 'Most watched', 'Direct play vs transcode']) {
      expect(sources(paired, title), title).not.toContain('Plex 1');
    }
    expect(sources(paired, 'Media server CPU / RAM · 24 h')).toEqual(['Plex 1']);
    expect(sources(overview(demoInputs(), []), 'Streams')).toEqual(['Tautulli 1', 'Plex 1', 'Jellyfin 1', 'Emby 1']);
  });

  it('keeps Plex resources when its sessions are off', () => {
    const dashboard = overview(withPlex({}, { sessions: { enabled: false }, status: { enabled: true } }));

    expect(panel(dashboard, 'Streams')).toBeUndefined();
    expect(sources(dashboard, 'Media server CPU / RAM · 24 h')).toEqual(['Plex 1']);
  });

  it('falls back to Tautulli hour buckets on InfluxDB 1', () => {
    const hourly = panel(overview(demoInputs()), 'Plays by hour of day (last 30 days)');

    expect(hourly?.type).toBe('barchart');
    expect(String(hourly?.targets?.[0].query)).toContain(`"type" = 'PlaysByHourOfDay'`);

    const inputs = demoInputs();
    for (const tautulli of inputs.tautulli ?? []) {
      tautulli.stats.enabled = false;
    }
    expect(overview(inputs).panels.some((p) => p.title.startsWith('Plays by hour'))).toBe(false);
  });

  it('drops self-metrics panels when self-metrics are off', () => {
    const dashboard = overview(demoInputs(), [], { selfMetrics: false });

    expect(panel(dashboard, 'Healthy collectors')).toBeUndefined();
    expect(sources(dashboard, 'Health alerts')).not.toContain('Varken');
    expect(sources(overview(demoInputs()), 'Health alerts')).toContain('Varken');
  });

  it('prefers Overseerr for latest requests and maps each status vocabulary', () => {
    const inputs = demoInputs();
    const both = panel(overview(inputs), 'Latest requests');
    const ombiOnly = panel(overview({ ...inputs, overseerr: undefined }), 'Latest requests');
    const mappings = (p: GrafanaPanel | undefined): unknown => JSON.stringify(p?.fieldConfig);

    expect(sources(overview(inputs), 'Latest requests')).toEqual(['Overseerr 1']);
    expect(String(ombiOnly?.targets?.[0].query)).toContain('FROM "Ombi"');
    expect(mappings(both)).toContain('declined');
    expect(mappings(ombiOnly)).toContain('denied');
  });

  it('drops the period band without a period source', () => {
    expect(overview(minimal).panels.some((p) => p.type === 'row' && p.title === 'Over the period')).toBe(false);
    expect(overview(demoInputs()).panels.filter((p) => p.type === 'row').map((p) => p.title)).toEqual(['Now', 'Over the period']);
  });
});
