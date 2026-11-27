import type { Agg, FieldRef, Filter, Query, ResolvedSource } from '../model';
import { DATASOURCE_UID, type GrafanaTarget, type Translator } from './types';

const identifier = (name: string): string => `"${name.replace(/[\\"]/g, (c) => `\\${c}`)}"`;
const literal = (value: string): string => `'${value.replace(/[\\']/g, (c) => `\\${c}`)}'`;

const alias = (field: FieldRef): string => identifier(field.as ?? field.name);
const aggregate = (field: FieldRef, agg: Agg): string => `${field.agg ?? agg}(${identifier(field.name)})`;

function filter({ key, kind, op, value }: Filter): string {
  return `${identifier(key)} ${op} ${kind === 'tag' ? literal(String(value)) : Number(value)}`;
}

function where(source: ResolvedSource): string {
  const clauses = [`"type" = ${literal(source.spec.type)}`];
  if (source.server !== undefined) {
    clauses.push(`"server" = ${literal(String(source.server))}`);
  }
  clauses.push(...(source.spec.where ?? []).map(filter));
  return clauses.join(' AND ');
}

const groupTags = (source: ResolvedSource): string[] => (source.spec.tags ?? []).map(identifier);

function legend(source: ResolvedSource): string {
  const template = source.spec.legend ?? (source.spec.fields.length === 1 ? '{source}' : '{source} {field}');
  return template
    .replaceAll('{source}', source.label)
    .replaceAll('{field}', '$col')
    .replace(/\{tag:([^}]+)\}/g, (_match, tag: string) => `$tag_${tag}`);
}

function select(query: Query, source: ResolvedSource): { text: string; table: boolean } {
  const { fields } = source.spec;
  const from = `FROM ${identifier(source.measurement)} WHERE ${where(source)}`;
  const tags = groupTags(source);
  const byTags = tags.length > 0 ? ` GROUP BY ${tags.join(', ')}` : '';
  const interval = source.intervalSeconds;
  switch (query.shape) {
    case 'latest': {
      const inner = fields.map((f) => `${aggregate(f, query.agg)} AS ${alias(f)}`).join(', ');
      const outer = fields.map((f) => `last(${alias(f)}) AS ${alias(f)}`).join(', ');
      const buckets = [`time(${interval}s)`, ...tags].join(', ');
      return {
        text: `SELECT ${outer} FROM (SELECT ${inner} ${from} AND time > now() - ${3 * interval}s GROUP BY ${buckets} fill(none))${byTags}`,
        table: false,
      };
    }
    case 'timeSeries': {
      const wrap = (expr: string): string => (query.transform === 'nonNegativeDifference' ? `non_negative_difference(${expr})` : expr);
      const columns = fields.map((f) => `${wrap(aggregate(f, query.agg))} AS ${alias(f)}`).join(', ');
      const buckets = [`time(${query.bucket === '1d' ? '1d' : '$__interval'})`, ...tags].join(', ');
      return { text: `SELECT ${columns} ${from} AND $timeFilter GROUP BY ${buckets} fill(none)`, table: false };
    }
    case 'topN':
      return { text: `SELECT ${fields.map((f) => `${aggregate(f, query.agg)} AS ${alias(f)}`).join(', ')} ${from} AND $timeFilter${byTags}`, table: true };
    case 'latestTable': {
      // Runs are an interval plus their duration apart: the grace keeps the table from blanking between two runs,
      // at the cost of a row shown twice for one run when a grouped tag changes.
      const window = interval + Math.min(interval, 60);
      return { text: `SELECT ${fields.map((f) => `last(${identifier(f.name)}) AS ${alias(f)}`).join(', ')} ${from} AND time > now() - ${window}s${byTags}`, table: true };
    }
    case 'eventTable': {
      const columns = [...fields.map((f) => `${identifier(f.name)} AS ${alias(f)}`), ...tags].join(', ');
      return { text: `SELECT ${columns} ${from} AND $timeFilter ORDER BY time DESC LIMIT ${query.limit}`, table: true };
    }
    case 'proportion':
      // Snapshot counts times the interval: stream-seconds, so sources collecting at different rates weigh the same.
      return { text: `SELECT ${fields.map((f) => `sum(${identifier(f.name)}) * ${interval} AS ${alias(f)}`).join(', ')} ${from} AND $timeFilter`, table: false };
    case 'timeBuckets':
      throw new Error('InfluxQL cannot bucket by hour of day or weekday');
  }
}

export const influxql: Translator = {
  output: 'influxdb1',
  datasource: { pluginId: 'influxdb', pluginName: 'InfluxDB', label: 'Varken (InfluxDB 1)' },
  shapes: new Set(['latest', 'timeSeries', 'topN', 'latestTable', 'eventTable', 'proportion']),
  stringFields: true,
  target(query: Query, source: ResolvedSource, refId: string): GrafanaTarget {
    const { text, table } = select(query, source);
    return {
      refId,
      datasource: { type: 'influxdb', uid: DATASOURCE_UID },
      rawQuery: true,
      resultFormat: table ? 'table' : 'time_series',
      ...(table ? {} : { alias: legend(source) }),
      query: text,
    };
  },
};
