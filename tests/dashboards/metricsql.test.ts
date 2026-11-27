import { describe, it, expect } from 'vitest';
import type { FieldRef, Query, ResolvedSource, SourceSpec } from '../../src/dashboards/model';
import { getTranslator, usableSources } from '../../src/dashboards/translators';
import { metricsql } from '../../src/dashboards/translators/metricsql';

function source(spec: Partial<SourceSpec>, id: number | null = 1, intervalSeconds = 30): ResolvedSource {
  const server = id ?? undefined;
  const full: SourceSpec = { plugin: 'sonarr', collector: 'queue', type: 'Queue', fields: [{ name: 'size', kind: 'number' }], ...spec };
  const measurement = full.plugin === 'varken' ? 'Varken' : 'Sonarr';
  return { spec: full, measurement, server, intervalSeconds, label: server === undefined ? measurement : `${measurement} ${server}` };
}

const render = (query: Query, spec: Partial<SourceSpec>, server?: number | null, interval?: number): Record<string, unknown> =>
  metricsql.target(query, source(spec, server, interval), 'A', { timezone: 'UTC' });

const num = (name: string, as?: string): FieldRef => ({ name, kind: 'number', ...(as ? { as } : {}) });

describe('metricsql', () => {
  it('reads the latest collection of an instance as an instant series', () => {
    const target = render({ shape: 'latest', agg: 'count' }, {});

    expect(target).toEqual({
      refId: 'A',
      datasource: { type: 'prometheus', uid: '${DS_VARKEN}' },
      expr: 'label_set(last_over_time((sum(count_over_time(Sonarr_size{type="Queue", server="1"}[30s])))[90s:30s]), "__name__", "size")',
      legendFormat: 'Sonarr 1',
      instant: true,
      range: false,
      format: 'time_series',
    });
  });

  it('groups by tags and names series from the legend', () => {
    const target = render({ shape: 'latest', agg: 'last' }, { type: 'RootFolder', fields: [num('free_bytes')], tags: ['path'], legend: '{source} {tag:path}' });
    const fields = render({ shape: 'latest', agg: 'last' }, { fields: [num('collectors'), num('collectors_open')], legend: '{field}' });

    expect(target.expr).toBe('label_set(last_over_time((max by (path) (last_over_time(Sonarr_free_bytes{type="RootFolder", server="1"}[30s])))[90s:30s]), "__name__", "free_bytes")');
    expect(target.legendFormat).toBe('Sonarr 1 {{path}}');
    expect(fields.expr).toMatch(/^union\(label_set\(.*"__name__", "collectors"\), label_set\(.*"__name__", "collectors_open"\)\)$/);
    expect(fields.legendFormat).toBe('{{__name__}}');
    expect(render({ shape: 'latest', agg: 'last' }, { fields: [num('a'), num('b')] }).legendFormat).toBe('Sonarr 1 {{__name__}}');
  });

  it('aggregates time buckets of the dashboard interval or of a day', () => {
    const auto = render({ shape: 'timeSeries', agg: 'mean', bucket: 'auto' }, { fields: [num('lan_bandwidth', 'LAN')] });
    const daily = render({ shape: 'timeSeries', agg: 'count', bucket: '1d' }, { fields: [num('play_duration_seconds')], tags: ['media_type'] });

    expect(auto).toMatchObject({ instant: false, range: true, expr: 'label_set(avg(avg_over_time(Sonarr_lan_bandwidth{type="Queue", server="1"}[$__interval])), "__name__", "LAN")' });
    expect(auto.interval).toBeUndefined();
    expect(daily).toMatchObject({ interval: '1d', expr: 'label_set(sum by (media_type) (count_over_time(Sonarr_play_duration_seconds{type="Queue", server="1"}[1d])), "__name__", "play_duration_seconds")' });
  });

  it('turns daily totals into their non-negative difference', () => {
    const target = render({ shape: 'timeSeries', agg: 'last', bucket: '1d', transform: 'nonNegativeDifference' }, { fields: [num('total')] });

    expect(target.expr).toBe(
      'label_set(clamp_min(max(last_over_time(Sonarr_total{type="Queue", server="1"}[1d])) - max(last_over_time(Sonarr_total{type="Queue", server="1"}[1d] offset 1d)), 0), "__name__", "total")'
    );
  });

  it('totals the range per tag value, rows kept apart per source', () => {
    const target = render({ shape: 'topN', agg: 'count' }, { fields: [num('play_duration_seconds', 'plays')], tags: ['username'] });

    expect(target).toMatchObject({ instant: true, format: 'time_series' });
    expect(target.expr).toBe('label_set(sum by (username) (count_over_time(Sonarr_play_duration_seconds{type="Queue", server="1"}[$__range])), "__name__", "plays", "varken_source", "Sonarr 1")');
    expect(target.legendFormat).toBeUndefined();
  });

  it('lists the latest point per tag combination, with a grace for the run duration', () => {
    const target = render({ shape: 'latestTable' }, { fields: [num('progress'), num('sizeleft')], tags: ['name', 'sxe'] }, 1, 60);

    expect(target.expr).toBe(
      'union(label_set(max by (name, sxe) (last_over_time(Sonarr_progress{type="Queue", server="1"}[120s])), "__name__", "progress", "varken_source", "Sonarr 1"), label_set(max by (name, sxe) (last_over_time(Sonarr_sizeleft{type="Queue", server="1"}[120s])), "__name__", "sizeleft", "varken_source", "Sonarr 1"))'
    );
    expect(String(render({ shape: 'latestTable' }, {}, 1, 300).expr)).toContain('[360s]');
  });

  it('sums each field over the range times the interval for proportions', () => {
    const target = render({ shape: 'proportion' }, { fields: [num('direct_play_streams', 'Direct play')], legend: '{field}' });

    expect(target.expr).toBe('label_set(sum(sum_over_time(Sonarr_direct_play_streams{type="Queue", server="1"}[$__range])) * 30, "__name__", "Direct play")');
    expect(target).toMatchObject({ instant: true, legendFormat: '{{__name__}}' });
  });

  it('filters on another field of the same point', () => {
    const target = render({ shape: 'latest', agg: 'last' }, {
      plugin: 'varken',
      type: 'Collector',
      fields: [num('consecutive_errors')],
      tags: ['plugin'],
      where: [{ key: 'circuit_state', kind: 'number', op: '>', value: 0 }],
    }, null);

    expect(target.expr).toBe(
      'label_set(last_over_time((max by (plugin) ((last_over_time(Varken_consecutive_errors{type="Collector"}[30s])) and (last_over_time(Varken_circuit_state{type="Collector"}[30s]) > 0)))[90s:30s]), "__name__", "consecutive_errors")'
    );
    expect(String(render({ shape: 'latestTable' }, { where: [{ key: 'throttled', kind: 'number', op: '=', value: 1 }] }).expr)).toContain('Sonarr_throttled{type="Queue", server="1"}[60s]) == 1)');
  });

  it('renders tag filters as label matchers', () => {
    const expr = String(
      render({ shape: 'latest', agg: 'count' }, {
        where: [
          { key: 'tracked_download_status', kind: 'tag', op: '!=', value: 'ok' },
          { key: 'activity_type', kind: 'tag', op: '=', value: 'VideoPlayback' },
        ],
      }).expr
    );

    expect(expr).toContain('Sonarr_size{type="Queue", server="1", tracked_download_status!="ok", activity_type="VideoPlayback"}');
  });

  it('escapes strings', () => {
    const target = render({ shape: 'latest', agg: 'last' }, { where: [{ key: 'name', kind: 'tag', op: '=', value: 'O"Brien \\ x' }], legend: '{source} "q"' });

    expect(target.expr).toContain('name="O\\"Brien \\\\ x"');
  });

  it('is the VictoriaMetrics translator, without strings, events or time buckets', () => {
    expect(getTranslator('victoriametrics')).toBe(metricsql);
    expect(metricsql.strings).toBe('none');
    expect(usableSources(metricsql, { shape: 'latest', agg: 'count' }, [source({ fields: [{ name: 'hash', kind: 'string' }] })])).toEqual([]);
    expect([...metricsql.shapes].sort()).toEqual(['latest', 'latestTable', 'proportion', 'timeSeries', 'topN']);
    expect(metricsql.tableTransformations).toEqual([
      { id: 'joinByLabels', options: { value: '__name__' } },
      { id: 'organize', options: { excludeByName: { varken_source: true } } },
    ]);
    expect(() => render({ shape: 'eventTable', limit: 10 }, {})).toThrow('MetricsQL cannot list events');
    expect(() => render({ shape: 'timeBuckets' }, {})).toThrow('MetricsQL cannot bucket by hour of day or weekday');
  });
});
