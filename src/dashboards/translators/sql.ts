import { type Agg, type FieldRef, type Filter, type Query, type ResolvedSource, TABLE_SHAPES } from '../model';
import { DATASOURCE_UID, type GrafanaTarget, type TargetContext, type Translator } from './types';

const literal = (value: string): string => `'${value.replaceAll("'", "''")}'`;
const identifier = (name: string): string => `"${name.replaceAll('"', '""')}"`;
const alias = (field: FieldRef): string => field.as ?? field.name;

interface SqlDialect {
  output: 'questdb' | 'timescaledb';
  label: string;
  /** `FROM … WHERE` and the measurement and point type clauses. */
  from(source: ResolvedSource): string;
  time: string;
  tag(key: string): string;
  field(field: FieldRef): string;
  /** Rows of the last `seconds` seconds. */
  window(seconds: number): string;
  /** Start of the time bucket of `every` (`30s`, `1d`, `$__interval`). */
  bucket(every: string): string;
  last(expr: string): string;
  notEqual(left: string, right: string): string;
  concat(parts: string[]): string;
  weekday(timezone: string): string;
  hour(timezone: string): string;
}

const timescale: SqlDialect = {
  output: 'timescaledb',
  label: 'Varken (TimescaleDB)',
  from(source: ResolvedSource): string {
    return `FROM varken_events WHERE measurement = ${literal(source.measurement)} AND tags->>'type' = ${literal(source.spec.type)}`;
  },
  time: 'time',
  tag(key: string): string {
    return `tags->>${literal(key)}`;
  },
  field(field: FieldRef): string {
    return field.kind === 'number' ? `(fields->>${literal(field.name)})::double precision` : `fields->>${literal(field.name)}`;
  },
  window(seconds: number): string {
    return `time > now() - interval '${seconds} seconds'`;
  },
  bucket(every: string): string {
    return `time_bucket(${literal(every)}, time)`;
  },
  last(expr: string): string {
    return `last(${expr}, time)`;
  },
  notEqual(left: string, right: string): string {
    return `${left} IS DISTINCT FROM ${right}`;
  },
  // `||` binds as tightly as `->>`: tag lookups need their parentheses.
  concat(parts: string[]): string {
    return parts.map((part) => (part.startsWith("'") ? part : `(${part})`)).join(' || ');
  },
  weekday(timezone: string): string {
    return `extract(isodow from time AT TIME ZONE ${literal(timezone)})::int`;
  },
  hour(timezone: string): string {
    return `extract(hour from time AT TIME ZONE ${literal(timezone)})::int`;
  },
};

const quest: SqlDialect = {
  output: 'questdb',
  label: 'Varken (QuestDB)',
  from(source: ResolvedSource): string {
    return `FROM ${identifier(source.measurement)} WHERE "type" = ${literal(source.spec.type)}`;
  },
  time: 'timestamp',
  tag: identifier,
  field(field: FieldRef): string {
    return identifier(field.name);
  },
  window(seconds: number): string {
    return `timestamp > dateadd('s', -${seconds}, now())`;
  },
  bucket(every: string): string {
    return `timestamp_floor(${literal(every)}, timestamp)`;
  },
  last(expr: string): string {
    return `last(${expr})`;
  },
  notEqual(left: string, right: string): string {
    return `(${left} != ${right} OR ${left} IS NULL)`;
  },
  concat(parts: string[]): string {
    return `concat(${parts.join(', ')})`;
  },
  weekday(timezone: string): string {
    return `day_of_week(to_timezone(timestamp, ${literal(timezone)}))`;
  },
  hour(timezone: string): string {
    return `hour(to_timezone(timestamp, ${literal(timezone)}))`;
  },
};

const AGGREGATES: Record<Exclude<Agg, 'last'>, string> = { sum: 'sum', count: 'count', mean: 'avg', max: 'max' };

function aggregate(dialect: SqlDialect, agg: Agg, field: FieldRef): string {
  return agg === 'last' ? dialect.last(dialect.field(field)) : `${AGGREGATES[agg]}(${dialect.field(field)})`;
}

function filter(dialect: SqlDialect, { key, kind, op, value }: Filter): string {
  const left = kind === 'tag' ? dialect.tag(key) : dialect.field({ name: key, kind: 'number' });
  const right = kind === 'tag' ? literal(String(value)) : String(Number(value));
  return op === '!=' ? dialect.notEqual(left, right) : `${left} ${op} ${right}`;
}

function where(dialect: SqlDialect, source: ResolvedSource, time: string): string {
  const clauses = [dialect.from(source)];
  if (source.server !== undefined) {
    clauses.push(`${dialect.tag('server')} = ${literal(String(source.server))}`);
  }
  clauses.push(...(source.spec.where ?? []).map((f) => filter(dialect, f)), time);
  return clauses.join(' AND ');
}

const timeFilter = (dialect: SqlDialect): string => `$__timeFilter(${dialect.time})`;

function legend(dialect: SqlDialect, source: ResolvedSource, field: FieldRef): string {
  const template = source.spec.legend ?? (source.spec.fields.length === 1 ? '{source}' : '{source} {field}');
  const parts = template
    .replaceAll('{source}', source.label)
    .replaceAll('{field}', alias(field))
    .split(/(\{tag:[^}]+\})/)
    .filter((part) => part !== '')
    .map((part) => (/^\{tag:/.test(part) ? dialect.tag(part.slice(5, -1)) : literal(part)));
  return parts.length === 1 ? parts[0] : dialect.concat(parts);
}

/** Long rows (`time`, `metric`, `value`) that Grafana turns into one series per metric. */
function series(dialect: SqlDialect, query: Query, source: ResolvedSource): string {
  const interval = source.intervalSeconds;
  const tags = (source.spec.tags ?? []).map(dialect.tag);
  const selects = source.spec.fields.map((field) => {
    const agg: Agg = field.agg ?? ('agg' in query ? query.agg : 'last');
    const metric = legend(dialect, source, field);
    if (query.shape === 'proportion') {
      const group = tags.length > 0 ? ` GROUP BY ${tags.join(', ')}` : '';
      return `SELECT min(${dialect.time}) AS time, ${metric} AS metric, sum(${dialect.field(field)}) * ${interval} AS value ${where(dialect, source, timeFilter(dialect))}${group}`;
    }
    const latest = query.shape === 'latest';
    const every = latest ? `${interval}s` : query.shape === 'timeSeries' && query.bucket === '1d' ? '1d' : '$__interval';
    const time = latest ? dialect.window(3 * interval) : timeFilter(dialect);
    return `SELECT ${dialect.bucket(every)} AS time, ${metric} AS metric, ${aggregate(dialect, agg, field)} AS value ${where(dialect, source, time)} GROUP BY ${['1', ...tags].join(', ')}`;
  });
  const rows = selects.length === 1 ? `${selects[0]} ORDER BY time` : `SELECT * FROM (${selects.join(' UNION ALL ')}) AS u ORDER BY time`;
  if (query.shape === 'timeSeries' && query.transform === 'nonNegativeDifference') {
    const inner = rows.replace(/ ORDER BY time$/, '');
    return `SELECT time, metric, value FROM (SELECT time, metric, value - lag(value) OVER (PARTITION BY metric ORDER BY time) AS value FROM (${inner}) AS a) AS d WHERE value >= 0 ORDER BY time`;
  }
  return rows;
}

function table(dialect: SqlDialect, query: Query, source: ResolvedSource, ctx: TargetContext): string {
  const { fields } = source.spec;
  const tags = source.spec.tags ?? [];
  const tagColumns = tags.map((tag) => `${dialect.tag(tag)} AS ${identifier(tag)}`);
  const groupBy = tags.length > 0 ? ` GROUP BY ${tags.map(dialect.tag).join(', ')}` : '';
  switch (query.shape) {
    case 'topN':
    case 'latestTable': {
      const interval = source.intervalSeconds;
      const time = query.shape === 'topN' ? timeFilter(dialect) : dialect.window(interval + Math.min(interval, 60));
      const values = fields.map((field) => `${aggregate(dialect, query.shape === 'topN' ? (field.agg ?? query.agg) : 'last', field)} AS ${identifier(alias(field))}`);
      return `SELECT ${[...tagColumns, ...values].join(', ')} ${where(dialect, source, time)}${groupBy}`;
    }
    case 'eventTable': {
      const columns = [`${dialect.time} AS "Time"`, ...fields.map((field) => `${dialect.field(field)} AS ${identifier(alias(field))}`), ...tagColumns];
      return `SELECT ${columns.join(', ')} ${where(dialect, source, timeFilter(dialect))} ORDER BY ${dialect.time} DESC LIMIT ${query.limit}`;
    }
    default:
      return `SELECT ${dialect.weekday(ctx.timezone)} AS weekday, ${dialect.hour(ctx.timezone)} AS hour, count(${dialect.field(fields[0])}) AS count ${where(dialect, source, timeFilter(dialect))} GROUP BY 1, 2`;
  }
}

function sqlTranslator(dialect: SqlDialect): Translator {
  return {
    output: dialect.output,
    datasource: { pluginId: 'grafana-postgresql-datasource', pluginName: 'PostgreSQL', label: dialect.label },
    shapes: new Set(['latest', 'timeSeries', 'topN', 'latestTable', 'eventTable', 'proportion', 'timeBuckets']),
    strings: 'tables',
    target(query: Query, source: ResolvedSource, refId: string, ctx: TargetContext): GrafanaTarget {
      const isTable = TABLE_SHAPES.has(query.shape);
      return {
        refId,
        datasource: { type: 'grafana-postgresql-datasource', uid: DATASOURCE_UID },
        rawSql: isTable ? table(dialect, query, source, ctx) : series(dialect, query, source),
        format: isTable ? 'table' : 'time_series',
        rawQuery: true,
        editorMode: 'code',
      };
    },
  };
}

export const timescaledb = sqlTranslator(timescale);
export const questdb = sqlTranslator(quest);
