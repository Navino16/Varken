import { describe, it, expect } from 'vitest';
import type { FieldRef, Query, ResolvedSource, SourceSpec } from '../../src/dashboards/model';
import { getTranslator, usableSources, type Translator } from '../../src/dashboards/translators';
import { influxql } from '../../src/dashboards/translators/influxql';

function source(spec: Partial<SourceSpec>, id: number | null = 1, intervalSeconds = 30): ResolvedSource {
  const server = id ?? undefined;
  const full: SourceSpec = { plugin: 'sonarr', collector: 'queue', type: 'Queue', fields: [{ name: 'size', kind: 'number' }], ...spec };
  const measurement = full.plugin === 'varken' ? 'Varken' : 'Sonarr';
  return { spec: full, measurement, server, intervalSeconds, label: server === undefined ? measurement : `${measurement} ${server}` };
}

const render = (query: Query, spec: Partial<SourceSpec>, server?: number | null, interval?: number): Record<string, unknown> =>
  influxql.target(query, source(spec, server, interval), 'A');

describe('influxql', () => {
  it('reads the latest collection of an instance', () => {
    const target = render({ shape: 'latest', agg: 'count' }, {});

    expect(target).toMatchObject({ refId: 'A', rawQuery: true, resultFormat: 'time_series', alias: 'Sonarr 1' });
    expect(target.datasource).toEqual({ type: 'influxdb', uid: '${DS_VARKEN}' });
    expect(target.query).toBe(
      `SELECT last("size") AS "size" FROM (SELECT count("size") AS "size" FROM "Sonarr" WHERE "type" = 'Queue' AND "server" = '1' AND time > now() - 90s GROUP BY time(30s) fill(none))`
    );
  });

  it('keeps the latest collection per tag combination', () => {
    const target = render({ shape: 'latest', agg: 'last' }, { type: 'RootFolder', fields: [{ name: 'free_bytes', kind: 'number' }], tags: ['path'] });

    expect(target.query).toBe(
      `SELECT last("free_bytes") AS "free_bytes" FROM (SELECT last("free_bytes") AS "free_bytes" FROM "Sonarr" WHERE "type" = 'RootFolder' AND "server" = '1' AND time > now() - 90s GROUP BY time(30s), "path" fill(none)) GROUP BY "path"`
    );
  });

  it('aggregates time buckets of the dashboard interval or of a day', () => {
    const fields: FieldRef[] = [{ name: 'lan_bandwidth', kind: 'number', as: 'LAN' }, { name: 'wan_bandwidth', kind: 'number', as: 'WAN' }];

    expect(render({ shape: 'timeSeries', agg: 'mean', bucket: 'auto' }, { type: 'current_stream_stats', fields }).query).toBe(
      `SELECT mean("lan_bandwidth") AS "LAN", mean("wan_bandwidth") AS "WAN" FROM "Sonarr" WHERE "type" = 'current_stream_stats' AND "server" = '1' AND $timeFilter GROUP BY time($__interval) fill(none)`
    );
    expect(render({ shape: 'timeSeries', agg: 'last', bucket: '1d', transform: 'nonNegativeDifference' }, { fields: [{ name: 'total', kind: 'number' }], tags: ['media_type'] }).query).toBe(
      `SELECT non_negative_difference(last("total")) AS "total" FROM "Sonarr" WHERE "type" = 'Queue' AND "server" = '1' AND $timeFilter GROUP BY time(1d), "media_type" fill(none)`
    );
  });

  it('totals the range per tag value as a table', () => {
    const target = render({ shape: 'topN', agg: 'count' }, { fields: [{ name: 'hash', kind: 'string', as: 'plays' }, { name: 'title', kind: 'string', agg: 'last' }], tags: ['rating_key'] });

    expect(target.resultFormat).toBe('table');
    expect(target.query).toBe(`SELECT count("hash") AS "plays", last("title") AS "title" FROM "Sonarr" WHERE "type" = 'Queue' AND "server" = '1' AND $timeFilter GROUP BY "rating_key"`);
  });

  it('lists the latest collection, with a grace for the run duration', () => {
    const target = render({ shape: 'latestTable' }, { fields: [{ name: 'progress', kind: 'number' }], tags: ['name', 'sxe'] }, 1, 60);

    expect(target.resultFormat).toBe('table');
    expect(target.query).toBe(`SELECT last("progress") AS "progress" FROM "Sonarr" WHERE "type" = 'Queue' AND "server" = '1' AND time > now() - 120s GROUP BY "name", "sxe"`);
  });

  it('lists the most recent events', () => {
    const target = render({ shape: 'eventTable', limit: 10 }, { type: 'RecentlyAdded', fields: [{ name: 'title', kind: 'string' }], tags: ['library_name'] });

    expect(target.resultFormat).toBe('table');
    expect(target.query).toBe(`SELECT "title" AS "title", "library_name" FROM "Sonarr" WHERE "type" = 'RecentlyAdded' AND "server" = '1' AND $timeFilter ORDER BY time DESC LIMIT 10`);
  });

  it('sums each field over the range for proportions', () => {
    const target = render({ shape: 'proportion' }, { fields: [{ name: 'direct_play_streams', kind: 'number', as: 'Direct play' }, { name: 'transcode_streams', kind: 'number', as: 'Transcode' }], legend: '{field}' });

    expect(target).toMatchObject({ resultFormat: 'time_series', alias: '$col' });
    expect(target.query).toBe(
      `SELECT sum("direct_play_streams") * 30 AS "Direct play", sum("transcode_streams") * 30 AS "Transcode" FROM "Sonarr" WHERE "type" = 'Queue' AND "server" = '1' AND $timeFilter`
    );
  });

  it('caps the latest table grace at a minute', () => {
    expect(render({ shape: 'latestTable' }, {}, 1, 300).query).toContain('time > now() - 360s');
  });

  it('renders filters on tags and numeric fields', () => {
    const query = render({ shape: 'latest', agg: 'count' }, {
      where: [
        { key: 'tracked_download_status', kind: 'tag', op: '!=', value: 'ok' },
        { key: 'circuit_state', kind: 'number', op: '>', value: 0 },
      ],
    }).query;

    expect(query).toContain(`AND "tracked_download_status" != 'ok' AND "circuit_state" > 0 AND time`);
  });

  it('has no server clause for Varken', () => {
    expect(render({ shape: 'latest', agg: 'last' }, { plugin: 'varken', type: 'Status' }, null, 60).query).toContain(`WHERE "type" = 'Status' AND time > now() - 180s`);
  });

  it('escapes literals and identifiers', () => {
    const query = render({ shape: 'latestTable' }, { where: [{ key: 'na"me\\', kind: 'tag', op: '=', value: `O'Brien \\ "x"` }], tags: ['ta"g'] }).query;

    expect(query).toContain(`"na\\"me\\\\" = 'O\\'Brien \\\\ "x"'`);
    expect(query).toContain(`GROUP BY "ta\\"g"`);
  });

  it('names series from the legend', () => {
    const alias = (legend: string | undefined, fields?: FieldRef[]): unknown => render({ shape: 'latest', agg: 'last' }, { legend, ...(fields ? { fields } : {}) }).alias;

    expect(alias('{source} · {tag:level} · {tag:source}')).toBe('Sonarr 1 · $tag_level · $tag_source');
    expect(alias('{field}')).toBe('$col');
    expect(alias(undefined, [{ name: 'a', kind: 'number' }, { name: 'b', kind: 'number' }])).toBe('Sonarr 1 $col');
  });

  it('cannot express time bucketing', () => {
    expect(influxql.shapes.has('timeBuckets')).toBe(false);
    expect(usableSources(influxql, { shape: 'timeBuckets' }, [source({})])).toEqual([]);
    expect(() => influxql.target({ shape: 'timeBuckets' }, source({}), 'A')).toThrow('InfluxQL cannot bucket by hour of day or weekday');
  });
});

describe('usableSources', () => {
  it('drops sources reading a string field when the output drops strings', () => {
    const numeric = source({});
    const strings = source({ fields: [{ name: 'hash', kind: 'string' }] });
    const noStrings: Translator = { ...influxql, stringFields: false };

    expect(usableSources(noStrings, { shape: 'latest', agg: 'count' }, [numeric, strings])).toEqual([numeric]);
    expect(usableSources(influxql, { shape: 'latest', agg: 'count' }, [numeric, strings])).toEqual([numeric, strings]);
  });
});

describe('getTranslator', () => {
  it('knows InfluxDB 1 only', () => {
    expect(getTranslator('influxdb1')).toBe(influxql);
    expect(() => getTranslator('questdb')).toThrow('No dashboard translator for output questdb');
  });
});
