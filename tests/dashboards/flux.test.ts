import { describe, it, expect } from 'vitest';
import type { FieldRef, Query, ResolvedSource, SourceSpec } from '../../src/dashboards/model';
import { getTranslator } from '../../src/dashboards/translators';
import { flux } from '../../src/dashboards/translators/flux';

function source(spec: Partial<SourceSpec>, id: number | null = 1, intervalSeconds = 30): ResolvedSource {
  const server = id ?? undefined;
  const full: SourceSpec = { plugin: 'sonarr', collector: 'queue', type: 'Queue', fields: [{ name: 'size', kind: 'number' }], ...spec };
  const measurement = full.plugin === 'varken' ? 'Varken' : 'Sonarr';
  return { spec: full, measurement, server, intervalSeconds, label: server === undefined ? measurement : `${measurement} ${server}` };
}

const render = (query: Query, spec: Partial<SourceSpec>, server?: number | null, interval?: number, timezone = 'UTC'): string =>
  String(flux.target(query, source(spec, server, interval), 'A', { timezone }).query);

const num = (name: string, as?: string): FieldRef => ({ name, kind: 'number', ...(as ? { as } : {}) });
const str = (name: string, as?: string): FieldRef => ({ name, kind: 'string', ...(as ? { as } : {}) });

describe('flux', () => {
  it('reads the latest collection of an instance as a series named by the source', () => {
    const target = flux.target({ shape: 'latest', agg: 'count' }, source({}), 'A', { timezone: 'UTC' });

    expect(target).toMatchObject({ refId: 'A', datasource: { type: 'influxdb', uid: '${DS_VARKEN}' } });
    expect(target.query).toBe(
      [
        'data = from(bucket: v.defaultBucket)',
        '  |> range(start: -90s)',
        '  |> filter(fn: (r) => r._measurement == "Sonarr" and r["type"] == "Queue" and r["server"] == "1" and (r._field == "size"))',
        'f0 = data',
        '  |> filter(fn: (r) => r._field == "size")',
        '  |> group(columns: ["_field"])',
        '  |> sort(columns: ["_time"])',
        '  |> aggregateWindow(every: 30s, fn: count, createEmpty: false)',
        '  |> toFloat()',
        '  |> map(fn: (r) => ({ r with _field: "Sonarr 1" }))',
        'f0',
        '  |> group()',
        '  |> pivot(rowKey: ["_time"], columnKey: ["_field"], valueColumn: "_value")',
        '  |> rename(columns: {_time: "Time"})',
      ].join('\n')
    );
  });

  it('names each series from the legend, its tags and its fields', () => {
    const query = render({ shape: 'latest', agg: 'last' }, { type: 'RootFolder', fields: [num('free_bytes')], tags: ['path'], legend: '{source} {tag:path}' });
    const two = render({ shape: 'latest', agg: 'last' }, { fields: [num('collectors'), num('collectors_open')], legend: '{field}' });
    const unnamed = render({ shape: 'latest', agg: 'last' }, { fields: [num('lan_bandwidth', 'LAN'), num('wan_bandwidth', 'WAN')] });

    expect(query).toContain('|> group(columns: ["path", "_field"])');
    expect(query).toContain('|> map(fn: (r) => ({ r with _field: "Sonarr 1 " + r["path"] }))');
    expect(two).toContain('union(tables: [f0, f1])');
    expect(two).toContain('_field: "collectors_open"');
    expect(unnamed).toContain('_field: "Sonarr 1 WAN"');
  });

  it('aggregates time buckets of the dashboard interval or of a day', () => {
    const auto = render({ shape: 'timeSeries', agg: 'mean', bucket: 'auto' }, {});
    const daily = render({ shape: 'timeSeries', agg: 'last', bucket: '1d', transform: 'nonNegativeDifference' }, { fields: [num('total')] });

    expect(auto).toContain('|> range(start: v.timeRangeStart, stop: v.timeRangeStop)');
    expect(auto).toContain('|> aggregateWindow(every: v.windowPeriod, fn: mean, createEmpty: false, timeSrc: "_start")');
    expect(daily).toContain('|> aggregateWindow(every: 1d, fn: last, createEmpty: false, timeSrc: "_start")\n  |> difference(nonNegative: true)');
  });

  it('sums each field over the range times the interval for proportions', () => {
    const query = render({ shape: 'proportion' }, { fields: [num('direct_play_streams', 'Direct play')], legend: '{field}' });

    expect(query).toContain('|> sum()\n  |> map(fn: (r) => ({ r with _value: float(v: r._value) * 30.0, _time: v.timeRangeStart }))');
    expect(query).toContain('_field: "Direct play"');
  });

  it('totals the range per tag value as a table, keeping string and number columns apart', () => {
    const query = render({ shape: 'topN', agg: 'count' }, { fields: [str('hash', 'plays'), { ...str('title'), agg: 'last' }], tags: ['rating_key'] });

    expect(query).toContain('|> group(columns: ["rating_key", "_field", "_start"])\n  |> sort(columns: ["_time"])\n  |> count()');
    expect(query).toContain('|> last()');
    expect(query).toContain('|> map(fn: (r) => ({ r with _field: "plays", _value: string(v: r._value) }))');
    expect(query).toContain('|> group(columns: ["rating_key", "_start"])\n  |> pivot(rowKey: ["rating_key"], columnKey: ["_field"], valueColumn: "_value")');
    expect(query.startsWith('import "internal/debug"\n')).toBe(true);
    expect(query).toContain('|> map(fn: (r) => ({ r with "plays": if exists r["plays"] then float(v: r["plays"]) else debug.null(type: "float") }))');
    expect(query).not.toContain('"title": if exists');
    expect(query).toMatch(/\|> group\(\)\n {2}\|> keep\(columns: \["rating_key", "plays", "title"\]\)$/);
  });

  it('pivots number-only tables without a string round trip', () => {
    const query = render({ shape: 'latestTable' }, { fields: [num('progress'), num('sizeleft')], tags: ['name', 'sxe'] }, 1, 60);

    expect(query).toContain('|> range(start: -120s)');
    expect(query).toContain('|> last()\n  |> toFloat()');
    expect(query).not.toContain('string(v:');
    expect(query).not.toContain('internal/debug');
    expect(query).toMatch(/keep\(columns: \["name", "sxe", "progress", "sizeleft"\]\)$/);
  });

  it('caps the latest table grace at a minute', () => {
    expect(render({ shape: 'latestTable' }, { tags: ['name'] }, 1, 300)).toContain('|> range(start: -360s)');
  });

  it('lists the most recent events with their time', () => {
    const query = render({ shape: 'eventTable', limit: 10 }, { type: 'RecentlyAdded', fields: [str('title')], tags: ['library_name'] });

    expect(query).toContain('|> pivot(rowKey: ["_time", "library_name"], columnKey: ["_field"], valueColumn: "_value")');
    expect(query).toContain('|> rename(columns: {_time: "Time"})\n  |> sort(columns: ["Time"], desc: true)\n  |> limit(n: 10)\n  |> keep(columns: ["Time", "library_name", "title"])');
  });

  it('keeps tables without tags on one row', () => {
    expect(render({ shape: 'latestTable' }, {})).toContain('|> pivot(rowKey: ["_start"], columnKey: ["_field"], valueColumn: "_value")');
  });

  it('counts points per weekday and hour in the dashboard time zone', () => {
    const query = render({ shape: 'timeBuckets' }, { type: 'Play', fields: [num('play_duration_seconds'), num('other')] }, 1, 30, 'Europe/Paris');

    expect(query.startsWith('import "date"\nimport "timezone"\noption location = timezone.location(name: "Europe/Paris")\n')).toBe(true);
    expect(query).toContain('|> filter(fn: (r) => r._field == "play_duration_seconds")\n  |> group()');
    expect(query).toContain('weekday: if date.weekDay(t: r._time) == 0 then 7 else date.weekDay(t: r._time), hour: date.hour(t: r._time)');
    expect(query).toContain('|> group(columns: ["weekday", "hour"])\n  |> count()\n  |> group()\n  |> rename(columns: {_value: "count"})');
    expect(query).not.toContain('"other")\n');
  });

  it('filters on another field through a pivot', () => {
    const query = render({ shape: 'latest', agg: 'last' }, {
      plugin: 'varken',
      type: 'Collector',
      fields: [num('consecutive_errors')],
      where: [{ key: 'circuit_state', kind: 'number', op: '>', value: 0 }],
    }, null);

    expect(query.startsWith('import "experimental"\n')).toBe(true);
    expect(query).toContain('(r._field == "consecutive_errors" or r._field == "circuit_state")');
    expect(query).toContain(
      '  |> pivot(rowKey: ["_time"], columnKey: ["_field"], valueColumn: "_value")\n  |> filter(fn: (r) => exists r["circuit_state"] and float(v: r["circuit_state"]) > 0.0)\n  |> experimental.unpivot()'
    );
    expect(query).not.toContain('r["server"]');
  });

  it('renders tag filters, keeping points without the tag on inequality', () => {
    const query = render({ shape: 'latest', agg: 'count' }, {
      where: [
        { key: 'tracked_download_status', kind: 'tag', op: '!=', value: 'ok' },
        { key: 'activity_type', kind: 'tag', op: '=', value: 'VideoPlayback' },
        { key: 'throttled', kind: 'number', op: '=', value: 1.5 },
      ],
    });

    expect(query).toContain('(not exists r["tracked_download_status"] or r["tracked_download_status"] != "ok") and r["activity_type"] == "VideoPlayback"');
    expect(query).toContain('float(v: r["throttled"]) == 1.5)');
  });

  it('escapes strings', () => {
    const query = render({ shape: 'latestTable' }, { where: [{ key: 'na"me', kind: 'tag', op: '=', value: 'O"Brien \\ ${x}' }], tags: ['t'] });

    expect(query).toContain('r["na\\"me"] == "O\\"Brien \\\\ \\${x}"');
  });

  it('keeps string series as strings and refuses to mix kinds in one series', () => {
    expect(render({ shape: 'latest', agg: 'last' }, { fields: [str('message')] })).not.toContain('toFloat');
    expect(() => render({ shape: 'latest', agg: 'last' }, { fields: [str('message'), num('size')] })).toThrow('Flux cannot mix string and number series in one target');
  });

  it('is the InfluxDB 2 translator', () => {
    expect(getTranslator('influxdb2')).toBe(flux);
    expect(flux.strings).toBe('all');
    expect([...flux.shapes].sort()).toEqual(['eventTable', 'latest', 'latestTable', 'proportion', 'timeBuckets', 'timeSeries', 'topN']);
  });
});
