import { describe, it, expect } from 'vitest';
import type { FieldRef, Query, ResolvedSource, SourceSpec } from '../../src/dashboards/model';
import { getTranslator, usableSources, type Translator } from '../../src/dashboards/translators';
import { questdb, timescaledb } from '../../src/dashboards/translators/sql';

function source(spec: Partial<SourceSpec>, id: number | null = 1, intervalSeconds = 30): ResolvedSource {
  const server = id ?? undefined;
  const full: SourceSpec = { plugin: 'sonarr', collector: 'queue', type: 'Queue', fields: [{ name: 'size', kind: 'number' }], ...spec };
  const measurement = full.plugin === 'varken' ? 'Varken' : 'Sonarr';
  return { spec: full, measurement, server, intervalSeconds, label: server === undefined ? measurement : `${measurement} ${server}` };
}

const target = (translator: Translator, query: Query, spec: Partial<SourceSpec>, server?: number | null, interval?: number, timezone = 'UTC'): Record<string, unknown> =>
  translator.target(query, source(spec, server, interval), 'A', { timezone });
const sql = (translator: Translator, query: Query, spec: Partial<SourceSpec>, server?: number | null, interval?: number, timezone?: string): string =>
  String(target(translator, query, spec, server, interval, timezone).rawSql);

const num = (name: string, as?: string): FieldRef => ({ name, kind: 'number', ...(as ? { as } : {}) });
const str = (name: string, as?: string): FieldRef => ({ name, kind: 'string', ...(as ? { as } : {}) });

describe('timescaledb', () => {
  const t = timescaledb;

  it('reads the latest collection as long rows named by the legend', () => {
    expect(target(t, { shape: 'latest', agg: 'count' }, {})).toEqual({
      refId: 'A',
      datasource: { type: 'grafana-postgresql-datasource', uid: '${DS_VARKEN}' },
      rawSql:
        "SELECT time_bucket('30s', time) AS time, 'Sonarr 1' AS metric, count((fields->>'size')::double precision) AS value FROM varken_events WHERE measurement = 'Sonarr' AND tags->>'type' = 'Queue' AND tags->>'server' = '1' AND time > now() - interval '90 seconds' GROUP BY 1 ORDER BY time",
      format: 'time_series',
      rawQuery: true,
      editorMode: 'code',
    });
  });

  it('builds legends from tags and unions several fields', () => {
    const tagged = sql(t, { shape: 'latest', agg: 'last' }, { type: 'RootFolder', fields: [num('free_bytes')], tags: ['path'], legend: '{source} {tag:path}' });
    const two = sql(t, { shape: 'timeSeries', agg: 'mean', bucket: 'auto' }, { fields: [num('lan_bandwidth', 'LAN'), num('wan_bandwidth', 'WAN')] });

    expect(tagged).toContain("'Sonarr 1 ' || (tags->>'path') AS metric, last((fields->>'free_bytes')::double precision, time) AS value");
    expect(tagged).toContain("GROUP BY 1, tags->>'path' ORDER BY time");
    expect(two).toMatch(/^SELECT \* FROM \(SELECT time_bucket\('\$__interval', time\) AS time, 'Sonarr 1 LAN' AS metric, avg\(.*\$__timeFilter\(time\) GROUP BY 1 UNION ALL SELECT .*'Sonarr 1 WAN' AS metric.* GROUP BY 1\) AS u ORDER BY time$/);
  });

  it('buckets by day and keeps non-negative day-to-day differences', () => {
    const daily = sql(t, { shape: 'timeSeries', agg: 'last', bucket: '1d', transform: 'nonNegativeDifference' }, { fields: [num('total')] });

    expect(daily).toContain("time_bucket('1d', time) AS time");
    expect(daily).toMatch(/^SELECT time, metric, value FROM \(SELECT time, metric, value - lag\(value\) OVER \(PARTITION BY metric ORDER BY time\) AS value FROM \(SELECT .*\) AS a\) AS d WHERE value >= 0 ORDER BY time$/);
  });

  it('sums each field over the range times the interval for proportions, without a row when the range is empty', () => {
    expect(sql(t, { shape: 'proportion' }, { fields: [num('direct_play_streams', 'Direct play')], legend: '{field}' })).toBe(
      "SELECT * FROM (SELECT min(time) AS time, 'Direct play' AS metric, sum((fields->>'direct_play_streams')::double precision) * 30 AS value FROM varken_events WHERE measurement = 'Sonarr' AND tags->>'type' = 'Queue' AND tags->>'server' = '1' AND $__timeFilter(time)) AS p WHERE time IS NOT NULL ORDER BY time"
    );
  });

  it('renders tables with columns named by tag keys and field aliases', () => {
    const top = target(t, { shape: 'topN', agg: 'count' }, { fields: [str('hash', 'plays'), { ...str('title'), agg: 'last' }], tags: ['rating_key'] });

    expect(top.format).toBe('table');
    expect(top.rawSql).toBe(
      "SELECT tags->>'rating_key' AS \"rating_key\", count(fields->>'hash') AS \"plays\", last(fields->>'title', time) AS \"title\" FROM varken_events WHERE measurement = 'Sonarr' AND tags->>'type' = 'Queue' AND tags->>'server' = '1' AND $__timeFilter(time) GROUP BY tags->>'rating_key'"
    );
    expect(sql(t, { shape: 'latestTable' }, { fields: [num('progress')], tags: ['name'] }, 1, 60)).toBe(
      "SELECT tags->>'name' AS \"name\", last((fields->>'progress')::double precision, time) AS \"progress\" FROM varken_events WHERE measurement = 'Sonarr' AND tags->>'type' = 'Queue' AND tags->>'server' = '1' AND time > now() - interval '120 seconds' GROUP BY tags->>'name'"
    );
    expect(sql(t, { shape: 'latestTable' }, { tags: ['name'] }, 1, 300)).toContain("interval '360 seconds'");
    expect(sql(t, { shape: 'eventTable', limit: 10 }, { type: 'RecentlyAdded', fields: [str('title')], tags: ['library_name'] })).toBe(
      "SELECT time AS \"Time\", fields->>'title' AS \"title\", tags->>'library_name' AS \"library_name\" FROM varken_events WHERE measurement = 'Sonarr' AND tags->>'type' = 'RecentlyAdded' AND tags->>'server' = '1' AND $__timeFilter(time) ORDER BY time DESC LIMIT 10"
    );
  });

  it('counts points per weekday and hour in the dashboard time zone', () => {
    expect(sql(t, { shape: 'timeBuckets' }, { type: 'Play', fields: [num('play_duration_seconds')] }, 1, 30, 'Europe/Paris')).toBe(
      "SELECT extract(isodow from time AT TIME ZONE 'Europe/Paris')::int AS weekday, extract(hour from time AT TIME ZONE 'Europe/Paris')::int AS hour, count((fields->>'play_duration_seconds')::double precision) AS count FROM varken_events WHERE measurement = 'Sonarr' AND tags->>'type' = 'Play' AND tags->>'server' = '1' AND $__timeFilter(time) GROUP BY 1, 2"
    );
  });

  it('renders filters, keeping points without the tag on inequality', () => {
    const query = sql(t, { shape: 'latest', agg: 'last' }, {
      plugin: 'varken',
      type: 'Collector',
      fields: [num('consecutive_errors')],
      where: [
        { key: 'circuit_state', kind: 'number', op: '>', value: 0 },
        { key: 'status', kind: 'tag', op: '!=', value: 'ok' },
      ],
    }, null);

    expect(query).toContain("WHERE measurement = 'Varken' AND tags->>'type' = 'Collector' AND (fields->>'circuit_state')::double precision > 0 AND tags->>'status' IS DISTINCT FROM 'ok' AND time");
  });

  it('escapes literals and identifiers', () => {
    const query = sql(t, { shape: 'latestTable' }, { fields: [num('size', 'si"ze')], where: [{ key: "na'me", kind: 'tag', op: '=', value: "O'Brien" }], tags: ['t'] });

    expect(query).toContain("tags->>'na''me' = 'O''Brien'");
    expect(query).toContain('AS "si""ze"');
  });
});

describe('questdb', () => {
  const q = questdb;

  it('reads the latest collection from the measurement table', () => {
    expect(sql(q, { shape: 'latest', agg: 'count' }, {})).toBe(
      "SELECT timestamp_floor('30s', timestamp) AS time, 'Sonarr 1' AS metric, count(\"size\") AS value FROM \"Sonarr\" WHERE \"type\" = 'Queue' AND \"server\" = '1' AND timestamp > dateadd('s', -90, now()) GROUP BY 1 ORDER BY time"
    );
  });

  it('builds legends with concat and buckets with timestamp_floor', () => {
    const tagged = sql(q, { shape: 'timeSeries', agg: 'last', bucket: 'auto' }, { fields: [num('free_bytes')], tags: ['path'], legend: '{source} {tag:path}' });

    expect(tagged).toContain("timestamp_floor('$__interval', timestamp) AS time, concat('Sonarr 1 ', \"path\") AS metric, last(\"free_bytes\") AS value");
    expect(tagged).toContain('$__timeFilter(timestamp) GROUP BY 1, "path" ORDER BY time');
  });

  it('renders tables and events', () => {
    expect(sql(q, { shape: 'latestTable' }, { fields: [num('progress')], tags: ['name'] }, 1, 60)).toBe(
      "SELECT \"name\" AS \"name\", last(\"progress\") AS \"progress\" FROM \"Sonarr\" WHERE \"type\" = 'Queue' AND \"server\" = '1' AND timestamp > dateadd('s', -120, now()) GROUP BY \"name\""
    );
    expect(sql(q, { shape: 'eventTable', limit: 5 }, { fields: [str('title')] })).toContain('SELECT timestamp AS "Time", "title" AS "title" FROM');
    expect(sql(q, { shape: 'eventTable', limit: 5 }, { fields: [str('title')] })).toContain('ORDER BY timestamp DESC LIMIT 5');
  });

  it('counts points per weekday and hour in the dashboard time zone', () => {
    expect(sql(q, { shape: 'timeBuckets' }, { fields: [num('play_duration_seconds')] }, 1, 30, 'Europe/Paris')).toBe(
      "SELECT day_of_week(to_timezone(timestamp, 'Europe/Paris')) AS weekday, hour(to_timezone(timestamp, 'Europe/Paris')) AS hour, count(\"play_duration_seconds\") AS count FROM \"Sonarr\" WHERE \"type\" = 'Queue' AND \"server\" = '1' AND $__timeFilter(timestamp) GROUP BY 1, 2"
    );
  });

  it('keeps points without the tag on inequality', () => {
    expect(sql(q, { shape: 'latest', agg: 'count' }, { where: [{ key: 'status', kind: 'tag', op: '!=', value: 'ok' }, { key: 'throttled', kind: 'number', op: '=', value: 1 }] })).toContain(
      `AND ("status" != 'ok' OR "status" IS NULL) AND "throttled" = 1 AND`
    );
  });

  it('escapes identifiers', () => {
    expect(sql(q, { shape: 'latestTable' }, { tags: ['ta"g'] })).toContain('"ta""g" AS "ta""g"');
  });
});

describe('SQL translators', () => {
  it.each([timescaledb, questdb])('$output keeps string results to tables', (translator) => {
    const strings = source({ fields: [str('message')] });
    const counted = source({ fields: [{ ...str('message'), agg: 'count' }] });

    expect(translator.strings).toBe('tables');
    expect(usableSources(translator, { shape: 'latest', agg: 'last' }, [strings, counted])).toEqual([counted]);
    expect(usableSources(translator, { shape: 'latestTable' }, [strings])).toEqual([strings]);
    expect([...translator.shapes].sort()).toEqual(['eventTable', 'latest', 'latestTable', 'proportion', 'timeBuckets', 'timeSeries', 'topN']);
    expect(getTranslator(translator.output)).toBe(translator);
    expect(translator.datasource).toMatchObject({ pluginId: 'grafana-postgresql-datasource', pluginName: 'PostgreSQL' });
  });
});
