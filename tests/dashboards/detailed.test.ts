import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { GlobalConfigSchema, InputsConfigSchema, type InputsConfig } from '../../src/config/schemas/config.schema';
import { CATALOG, type PointSpec } from '../../src/dashboards/catalog';
import { columnLabel, DETAILED, pointPanels } from '../../src/dashboards/detailed';
import { generateDashboard, type GrafanaDashboard, type GrafanaPanel } from '../../src/dashboards/generator';
import { num, type OutputKey, str } from '../../src/dashboards/model';
import { MEASUREMENTS } from '../../src/dashboards/sources';
import { demoInputs } from '../demo/config';

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

    expect(overrides(panel.grafana.fieldConfig)).toEqual([{ matcher: { id: 'byName', options: 'Size' }, properties: [{ id: 'unit', value: 'bytes' }] }]);
  });

  it('gives a gauge its own time window when its points are sparser than the dashboard range', () => {
    const [panel] = pointPanels('tautulli', { type: 'PlaysByMonth', title: 'Plays per month', collector: 'stats', view: 'series', fields: [num('tv')], timeFrom: '1y' });
    const dashboard = full('influxdb1');
    const rendered = rows(dashboard)
      .flatMap(([, panels]) => panels)
      .find((p) => p.title === 'Plays per month (last 12 months)');

    expect(panel.grafana.timeFrom).toBe('1y');
    expect(rendered?.timeFrom).toBe('1y');
  });

  it('names gauge series by their readable field label', () => {
    const [panel] = pointPanels('sonarr', { ...health, fields: [num('total_count')] });
    const [tagged] = pointPanels('sonarr', { ...health, by: 'level' });

    expect(panel.grafana.transformations).toEqual([{ id: 'renameByRegex', options: { regex: '^total_count$', renamePattern: 'Total count' } }]);
    expect(tagged.grafana.transformations).toBeUndefined();
  });

  it('sums sparse counts per day as bars', () => {
    const [panel] = pointPanels('plex', { type: 'Bandwidth', title: 'Bandwidth', collector: 'status', view: 'series', agg: 'sum', bucket: '1d', by: 'network', fields: [num('bytes')] });
    const [bars] = pointPanels('tautulli', { type: 'PlaysByMonth', title: 'Plays', collector: 'stats', view: 'series', bars: true, fields: [num('tv')] });

    expect(panel.variants[0].query).toEqual({ shape: 'timeSeries', agg: 'sum', bucket: '1d' });
    expect((panel.grafana.fieldConfig as { defaults: { custom: { drawStyle: string } } }).defaults.custom.drawStyle).toBe('bars');
    expect((bars.grafana.fieldConfig as { defaults: { custom: { drawStyle: string } } }).defaults.custom.drawStyle).toBe('bars');
  });

  it('reads points another collector also writes through a later variant', () => {
    const [panel] = pointPanels('tautulli', { type: 'library_stats', title: 'Libraries', collector: 'stats', alsoCollector: 'libraries', view: 'table', fields: [num('total'), str('libraries')] });

    expect(panel.variants.map((v) => [v.sources[0].collector, v.sources[0].fields.length])).toEqual([
      ['stats', 2],
      ['stats', 1],
      ['libraries', 2],
      ['libraries', 1],
    ]);
  });

  it('shows slow counts as named stats', () => {
    const [panel] = pointPanels('sonarr', { type: 'Library', title: 'Library', collector: 'library', view: 'stats', fields: [num('series'), num('size_on_disk')], units: { size_on_disk: 'bytes' } });

    expect(panel.variants[0].query).toEqual({ shape: 'latest', agg: 'last' });
    expect(panel.grafana).toMatchObject({ type: 'stat', options: { textMode: 'value_and_name' } });
    expect([panel.width, panel.height]).toEqual([12, 4]);
    expect(overrides(panel.grafana.fieldConfig)[0].matcher.options).toBe('Size on disk');
    expect(panel.grafana.transformations).toEqual([{ id: 'renameByRegex', options: { regex: '^size_on_disk$', renamePattern: 'Size on disk' } }, { id: 'renameByRegex', options: { regex: '^series$', renamePattern: 'Series' } }].reverse());
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
    expect(Object.keys(organize(panel.variants[1].grafana?.transformations).renameByName)).toEqual(['name', 'tracked_download_status', 'sizeleft']);
    expect(steps.excludeByName).toMatchObject({ hash: true });
    expect(steps.renameByName).toEqual({ name: 'Name', tracked_download_status: 'Tracked download status', sizeleft: 'Sizeleft', message: 'Message' });
    expect(overrides(panel.grafana.fieldConfig).map((o) => [o.matcher.options, o.properties[0].id])).toEqual([
      ['Sizeleft', 'unit'],
      ['Tracked download status', 'mappings'],
    ]);
    expect([panel.width, panel.height]).toEqual([24, 8]);
  });

  it('sorts a table by a hidden column', () => {
    const [panel] = pointPanels('tautulli', { type: 'PlaysByDayOfWeek', title: 'Weekdays', collector: 'stats', view: 'table', tags: ['day', 'rank'], sortBy: 'rank', hide: ['rank'], fields: [num('tv')] });
    const steps = panel.grafana.transformations as { id: string; options: { sort?: { field: string }[] } }[];

    expect(steps.find((t) => t.id === 'sortBy')?.options.sort).toEqual([{ field: 'rank', desc: false }]);
    expect(organize(steps).excludeByName).toMatchObject({ rank: true });
    expect(Object.keys(organize(steps).renameByName)).toEqual(['day', 'tv']);
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

type Plugin = keyof typeof MEASUREMENTS;

/** Types named only in the prose of `docs/data-reference.md`, not in a `### type =` heading. */
const PROSE_TYPES: Partial<Record<Plugin, string[]>> = { prowlarr: ['IndexerStatsWindow', 'UserAgentStats', 'HostStats', 'IndexerStatusSummary'] };
/** Documented for a shared section but never written by that plugin. */
const NOT_WRITTEN: Partial<Record<Plugin, Record<string, string>>> = { emby: { Storage: '/System/Info/Storage is a Jellyfin 10.11 endpoint' } };

/** Point types per plugin, from the `## <Service>` sections of the data reference. */
function documentedTypes(): Map<Plugin, Set<string>> {
  const types = new Map<Plugin, Set<string>>();
  let plugins: Plugin[] = [];
  for (const line of readFileSync('docs/data-reference.md', 'utf8').split('\n')) {
    if (line.startsWith('## ')) {
      plugins = (Object.entries(MEASUREMENTS) as [Plugin, string][]).filter(([, name]) => new RegExp(`\\b${name}\\b`).test(line)).map(([key]) => key);
    }
    const heading = /^### type = (.+)$/.exec(line);
    for (const plugin of heading ? plugins : []) {
      heading?.[1].split(' / ').forEach((type) => types.set(plugin, new Set([...(types.get(plugin) ?? []), type.trim()])));
    }
  }
  for (const [plugin, extra] of Object.entries(PROSE_TYPES) as [Plugin, string[]][]) {
    extra.forEach((type) => types.get(plugin)?.add(type));
  }
  for (const [plugin, skipped] of Object.entries(NOT_WRITTEN) as [Plugin, Record<string, string>][]) {
    Object.keys(skipped).forEach((type) => types.get(plugin)?.delete(type));
  }
  return types;
}

const OUTPUTS: OutputKey[] = ['influxdb1', 'influxdb2', 'victoriametrics', 'questdb', 'timescaledb'];
const full = (output: OutputKey, inputs: InputsConfig = demoInputs()): GrafanaDashboard =>
  generateDashboard({ kind: 'detailed', output, config: { inputs, global: GlobalConfigSchema.parse({}) }, pairedPlex: new Map([[1, [1]]]), version: '9.9.9' });
const rows = (dashboard: GrafanaDashboard): [GrafanaPanel, GrafanaPanel[]][] => dashboard.panels.map((row) => [row, row.panels as GrafanaPanel[]]);

describe('columnLabel', () => {
  it('leaves the unit suffix to the unit', () => {
    expect(['duration_seconds', 'last_seen_age_seconds', 'next_execution_in_seconds', 'free_bytes', 'used_percent', 'seconds', 'percent_of_books'].map(columnLabel)).toEqual([
      'Duration',
      'Last seen',
      'Next execution in',
      'Free',
      'Used',
      'Seconds',
      'Percent of books',
    ]);
  });
});

describe('catalogue', () => {
  it('gives a unit to every field whose label drops its unit suffix', () => {
    for (const [plugin, points] of Object.entries(CATALOG)) {
      for (const point of points) {
        for (const field of point.fields) {
          const name = field.as ?? field.name;
          if (columnLabel(name).toLowerCase() !== name.replaceAll('_', ' ').toLowerCase()) {
            expect(point.units?.[name], `${plugin} ${point.type} ${name}`).toBeDefined();
          }
        }
      }
    }
  });

  it('covers every documented point type of every plugin, and only those', () => {
    const documented = documentedTypes();

    for (const plugin of Object.keys(MEASUREMENTS) as Plugin[]) {
      const catalogued = new Set(CATALOG[plugin].map((point) => point.type));
      expect([...catalogued].sort(), plugin).toEqual([...(documented.get(plugin) ?? [])].sort());
    }
  });
});

describe('Detailed', () => {
  it('matches the full snapshot', async () => {
    await expect(`${JSON.stringify(full('influxdb1'), null, 2)}\n`).toMatchFileSnapshot('__snapshots__/detailed-influxdb1-full.json');
  });

  it.each(OUTPUTS.slice(1))('matches the panel list on %s', async (output) => {
    const lines = rows(full(output)).flatMap(([row, panels]) => panels.map((p) => `${row.title} | ${p.title} | ${p.type} | ${p.targets?.length}`));

    await expect(`${lines.join('\n')}\n`).toMatchFileSnapshot(`__snapshots__/detailed-${output}-panels.txt`);
  });

  it.each(OUTPUTS)('never shows the hash field on %s', (output) => {
    for (const [row, panels] of rows(full(output))) {
      for (const p of panels.filter((panel) => JSON.stringify(panel.targets).includes('hash'))) {
        const shown = p.type === 'table' ? !organize(p.transformations as object[]).excludeByName.hash : p.type !== 'timeseries';
        expect(shown, `${row.title} / ${p.title}`).toBe(false);
      }
    }
  });

  it('gives a second instance only the panels of its own collectors', () => {
    const inputs = demoInputs();
    inputs.sonarr?.push(InputsConfigSchema.parse({ sonarr: [{ id: 2, url: 'http://sonarr-2.test', apiKey: 'k', queue: { enabled: true } }] }).sonarr?.[0] as never);
    const second = rows(full('influxdb1', inputs)).find(([row]) => row.title === 'Sonarr 2');

    expect(second?.[1].map((p) => p.title)).toEqual(['Download queue']);
  });

  it('reads Tautulli libraries from either collector writing them', () => {
    const inputs = InputsConfigSchema.parse({ tautulli: [{ id: 1, url: 'http://t.test', apiKey: 'k', activity: { enabled: false }, stats: { enabled: false }, libraries: { enabled: true } }] });
    const panels = rows(full('influxdb1', inputs))[0]?.[1];

    expect(panels?.map((p) => p.title)).toEqual(['Libraries']);
  });

  it('leaves out of QuestDB the panels of points a healthy or idle server never writes', () => {
    const titles = rows(full('questdb')).flatMap(([row, panels]) => panels.map((p) => `${row.title}/${p.title}`));

    for (const title of ['Sonarr 1/Health issues', 'Prowlarr 1/Indexer failures', 'Plex 1/Running activities', 'Plex 1/Running background transcodes', 'Plex 1/Recordings', 'Jellyfin 1/Storage']) {
      expect(titles, title).not.toContain(title);
    }
    expect(titles).toContain('Sonarr 1/Health checks');
  });

  it('ends with the Varken row', () => {
    expect(full('influxdb1').panels.map((p) => p.title).at(-1)).toBe('Varken');
  });
});
