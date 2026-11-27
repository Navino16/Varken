import { describe, it, expect } from 'vitest';
import { GlobalConfigSchema, InputsConfigSchema } from '../../src/config/schemas/config.schema';
import type { PointSpec } from '../../src/dashboards/catalog';
import { DETAILED, pointPanels } from '../../src/dashboards/detailed';
import { generateDashboard, type GrafanaPanel } from '../../src/dashboards/generator';
import { num, str } from '../../src/dashboards/model';

interface Override {
  matcher: { options: string };
  properties: { id: string; value: unknown }[];
}

const overrides = (fieldConfig: object | undefined): Override[] => (fieldConfig as { overrides: Override[] }).overrides;
const organize = (transformations: object[] = []): { excludeByName: Record<string, boolean>; renameByName: Record<string, string> } =>
  (transformations as { id: string; options: never }[]).filter((t) => t.id === 'organize').map((t) => t.options)[0];

const health: PointSpec = { type: 'Health', title: 'Health checks', collector: 'status', view: 'series', fields: [num('errors'), num('warnings')] };

describe('pointPanels', () => {
  it('draws a gauge as one time series per field', () => {
    const [panel, ...rest] = pointPanels('sonarr', { ...health, units: { errors: 'none', warnings: 'none' } });

    expect(rest).toEqual([]);
    expect(panel.title).toBe('Health checks');
    expect([panel.width, panel.height]).toEqual([12, 8]);
    expect(panel.grafana.type).toBe('timeseries');
    expect(panel.variants).toHaveLength(1);
    expect(panel.variants[0].query).toEqual({ shape: 'timeSeries', agg: 'mean', bucket: 'auto' });
    expect(panel.variants[0].sources).toEqual([{ plugin: 'sonarr', collector: 'status', type: 'Health', fields: health.fields, legend: '{field}' }]);
  });

  it('names gauge series by tag and field', () => {
    const one = pointPanels('plex', { type: 'Bandwidth', title: 'Bandwidth', collector: 'status', view: 'series', agg: 'sum', by: 'network', fields: [num('bytes')], units: { bytes: 'bytes' } })[0];
    const two = pointPanels('sonarr', { ...health, by: 'level' })[0];

    expect(one.variants[0].query).toMatchObject({ agg: 'sum' });
    expect(one.variants[0].sources[0]).toMatchObject({ tags: ['network'], legend: '{tag:network}' });
    expect((one.grafana.fieldConfig as { defaults: { unit?: string } }).defaults.unit).toBe('bytes');
    expect(two.variants[0].sources[0]).toMatchObject({ tags: ['level'], legend: '{tag:level} · {field}' });
  });

  it('gives each gauge field its own unit when they differ', () => {
    const [panel] = pointPanels('sonarr', { ...health, fields: [num('errors'), num('size_on_disk', 'size')], units: { size: 'bytes' } });

    expect(overrides(panel.grafana.fieldConfig)).toEqual([{ matcher: { id: 'byName', options: 'size' }, properties: [{ id: 'unit', value: 'bytes' }] }]);
  });

  it('shows slow counts as named stats', () => {
    const [panel] = pointPanels('sonarr', { type: 'Library', title: 'Library', collector: 'library', view: 'stats', fields: [num('series'), num('size_on_disk')], units: { size_on_disk: 'bytes' } });

    expect(panel.variants[0].query).toEqual({ shape: 'latest', agg: 'last' });
    expect(panel.grafana).toMatchObject({ type: 'stat', options: { textMode: 'value_and_name' } });
    expect([panel.width, panel.height]).toEqual([12, 4]);
    expect(overrides(panel.grafana.fieldConfig)[0].matcher.options).toBe('size_on_disk');
  });

  it('lists labelled points as a table with readable columns and no hash', () => {
    const point: PointSpec = {
      type: 'Queue',
      title: 'Queue',
      collector: 'queue',
      view: 'table',
      tags: ['name', 'tracked_download_status'],
      fields: [str('hash'), num('sizeleft'), str('message')],
      units: { sizeleft: 'bytes' },
      mappings: { tracked_download_status: { ok: 'fine' } },
    };
    const [panel] = pointPanels('sonarr', point);
    const steps = organize(panel.grafana.transformations);

    expect(panel.variants.map((v) => v.query)).toEqual([{ shape: 'latestTable' }, { shape: 'latestTable' }]);
    expect(panel.variants[0].sources[0]).toMatchObject({ tags: ['name', 'tracked_download_status'], fields: point.fields });
    expect(panel.variants[1].sources[0].fields).toEqual([num('sizeleft')]);
    expect(steps.excludeByName).toMatchObject({ hash: true });
    expect(steps.renameByName).toEqual({ name: 'Name', tracked_download_status: 'Tracked download status', sizeleft: 'Sizeleft', message: 'Message' });
    expect(overrides(panel.grafana.fieldConfig).map((o) => [o.matcher.options, o.properties[0].id])).toEqual([
      ['Sizeleft', 'unit'],
      ['Tracked download status', 'mappings'],
    ]);
    expect([panel.width, panel.height]).toEqual([24, 8]);
  });

  it('keeps one variant when no number field is left without strings', () => {
    const [panel] = pointPanels('sonarr', { type: 'HealthIssue', title: 'Issues', collector: 'status', view: 'table', tags: ['level'], fields: [str('message')] });

    expect(panel.variants).toHaveLength(1);
  });

  it('counts events per day and lists the latest ones', () => {
    const point: PointSpec = { type: 'History', title: 'History', collector: 'history', view: 'events', by: 'event_type', tags: ['event_type', 'quality'], fields: [str('hash'), num('size')] };
    const [perDay, latest] = pointPanels('radarr', point);

    expect(perDay.title).toBe('History per day');
    expect(perDay.variants[0].query).toEqual({ shape: 'timeSeries', agg: 'count', bucket: '1d' });
    expect(perDay.variants[0].sources[0]).toMatchObject({ fields: [str('hash')], tags: ['event_type'], legend: '{tag:event_type}' });
    expect(latest.title).toBe('History');
    expect(latest.variants[0].query).toEqual({ shape: 'eventTable', limit: 50 });
    expect(latest.variants[0].sources[0]).toMatchObject({ fields: point.fields, tags: point.tags });
    expect(organize(latest.grafana.transformations).excludeByName).toMatchObject({ hash: true });
    expect(organize(latest.grafana.transformations).renameByName).toMatchObject({ Time: 'Time' });
  });

  it('reads Varken points without collector', () => {
    const [panel] = pointPanels('varken', { type: 'Status', title: 'Varken', view: 'stats', fields: [num('collectors')] });

    expect(panel.variants[0].sources[0]).toEqual({ plugin: 'varken', type: 'Status', fields: [num('collectors')], legend: '{field}' });
  });
});

describe('DETAILED', () => {
  const ombi = InputsConfigSchema.parse({ ombi: [{ id: 3, url: 'http://ombi.test', apiKey: 'k', requestCounts: { enabled: true }, issueCounts: { enabled: false } }] });
  const global = GlobalConfigSchema.parse({ selfMetrics: { enabled: false } });
  const nested = (row: GrafanaPanel): GrafanaPanel[] => row.panels as GrafanaPanel[];

  it('has one collapsed band per plugin, in measurement order', () => {
    expect(DETAILED.bands.slice(0, 4).map((b) => [b.perInstance, b.collapsed])).toEqual([
      ['sonarr', true],
      ['radarr', true],
      ['readarr', true],
      ['lidarr', true],
    ]);
  });

  it('shows a configured instance with the panels of its enabled collectors', () => {
    const dashboard = generateDashboard({ kind: 'detailed', output: 'influxdb1', config: { inputs: ombi, global }, pairedPlex: new Map(), version: '9.9.9' });

    expect(dashboard).toMatchObject({ uid: 'varken-detailed-influxdb1', title: 'Varken Detailed' });
    expect(dashboard.panels.map((p) => p.title)).toEqual(['Ombi 3']);
    expect(nested(dashboard.panels[0]).map((p) => p.title)).toEqual(['Request counts', 'Request totals', 'Requests']);
  });
});
