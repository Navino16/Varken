import { type Agg, type FieldRef, type Filter, type Query, type ResolvedSource, TABLE_SHAPES } from '../model';
import { resultKind } from './kinds';
import { DATASOURCE_UID, type GrafanaTarget, type TargetContext, type Translator } from './types';

const literal = (value: string): string => `"${value.replace(/[\\"]/g, (c) => `\\${c}`).replaceAll('${', '\\${')}"`;
const column = (key: string): string => `r[${literal(key)}]`;
const list = (values: string[]): string => `[${values.map(literal).join(', ')}]`;
const float = (value: number): string => (Number.isInteger(value) ? `${value}.0` : String(value));
const pipe = (steps: string[]): string => steps.map((step) => `\n  |> ${step}`).join('');

const alias = (field: FieldRef): string => field.as ?? field.name;
const OPS: Record<Filter['op'], string> = { '=': '==', '!=': '!=', '>': '>' };

function tagFilter({ key, op, value }: Filter): string {
  const test = `${column(key)} ${OPS[op]} ${literal(String(value))}`;
  return op === '!=' ? `(not exists ${column(key)} or ${test})` : test;
}

function numberFilter({ key, op, value }: Filter): string {
  return `exists ${column(key)} and float(v: ${column(key)}) ${OPS[op]} ${float(Number(value))}`;
}

function range(query: Query, interval: number): string {
  switch (query.shape) {
    case 'latest':
      return `range(start: -${3 * interval}s)`;
    case 'latestTable':
      return `range(start: -${interval + Math.min(interval, 60)}s)`;
    default:
      return 'range(start: v.timeRangeStart, stop: v.timeRangeStop)';
  }
}

/** The points of the source, as one row per field; number filters on other fields go through a pivot. */
function data(query: Query, source: ResolvedSource): string {
  const { spec } = source;
  const numberFilters = (spec.where ?? []).filter((f) => f.kind === 'number');
  const read = [...new Set([...spec.fields.map((f) => f.name), ...numberFilters.map((f) => f.key)])];
  const clauses = [`r._measurement == ${literal(source.measurement)}`, `${column('type')} == ${literal(spec.type)}`];
  if (source.server !== undefined) {
    clauses.push(`${column('server')} == ${literal(String(source.server))}`);
  }
  clauses.push(...(spec.where ?? []).filter((f) => f.kind === 'tag').map(tagFilter));
  clauses.push(`(${read.map((name) => `r._field == ${literal(name)}`).join(' or ')})`);
  const steps = [range(query, source.intervalSeconds), `filter(fn: (r) => ${clauses.join(' and ')})`];
  if (numberFilters.length > 0) {
    steps.push(
      'pivot(rowKey: ["_time"], columnKey: ["_field"], valueColumn: "_value")',
      `filter(fn: (r) => ${numberFilters.map(numberFilter).join(' and ')})`,
      'experimental.unpivot()'
    );
  }
  return `data = from(bucket: v.defaultBucket)${pipe(steps)}`;
}

/** Flux string expression of a series name: `{source}`, `{field}` and `{tag:<key>}` placeholders. */
function legend(source: ResolvedSource, field: FieldRef): string {
  const template = source.spec.legend ?? (source.spec.fields.length === 1 ? '{source}' : '{source} {field}');
  const parts = template
    .replaceAll('{source}', source.label)
    .replaceAll('{field}', alias(field))
    .split(/(\{tag:[^}]+\})/)
    .filter((part) => part !== '');
  return parts.map((part) => (/^\{tag:/.test(part) ? column(part.slice(5, -1)) : literal(part))).join(' + ');
}

function aggregate(query: Query, field: FieldRef, interval: number): string[] {
  const agg: Agg = field.agg ?? ('agg' in query ? query.agg : 'last');
  switch (query.shape) {
    case 'latest':
      return [`aggregateWindow(every: ${interval}s, fn: ${agg}, createEmpty: false)`];
    case 'timeSeries': {
      const every = query.bucket === '1d' ? '1d' : 'v.windowPeriod';
      const window = `aggregateWindow(every: ${every}, fn: ${agg}, createEmpty: false, timeSrc: "_start")`;
      return query.transform === 'nonNegativeDifference' ? [window, 'difference(nonNegative: true)'] : [window];
    }
    case 'proportion':
      return ['sum()', `map(fn: (r) => ({ r with _value: float(v: r._value) * ${float(interval)}, _time: v.timeRangeStart }))`];
    case 'topN':
      return [`${agg}()`];
    case 'latestTable':
      return ['last()'];
    default:
      return [];
  }
}

function streams(query: Query, source: ResolvedSource, groupBy: string[], name: (field: FieldRef) => string[]): string {
  const { fields } = source.spec;
  const defs = fields.map(
    (field, index) =>
      `f${index} = data${pipe([`filter(fn: (r) => r._field == ${literal(field.name)})`, `group(columns: ${list(groupBy)})`, 'sort(columns: ["_time"])', ...aggregate(query, field, source.intervalSeconds), ...name(field)])}`
  );
  const tables = fields.length === 1 ? 'f0' : `union(tables: [${fields.map((_f, index) => `f${index}`).join(', ')}])`;
  return `${defs.join('\n')}\n${tables}`;
}

function series(query: Query, source: ResolvedSource): string {
  const kinds = new Set(source.spec.fields.map((field) => resultKind(field, query)));
  if (kinds.size > 1) {
    throw new Error('Flux cannot mix string and number series in one target');
  }
  const toFloat = kinds.has('number') ? ['toFloat()'] : [];
  const tags = source.spec.tags ?? [];
  const body = streams(query, source, [...tags, '_field'], (field) => [...toFloat, `map(fn: (r) => ({ r with _field: ${legend(source, field)} }))`]);
  return `${body}${pipe(['group()', 'pivot(rowKey: ["_time"], columnKey: ["_field"], valueColumn: "_value")', 'rename(columns: {_time: "Time"})'])}`;
}

function table(query: Query, source: ResolvedSource): string {
  const { fields } = source.spec;
  const tags = source.spec.tags ?? [];
  const kinds = fields.map((field) => resultKind(field, query));
  const mixed = new Set(kinds).size > 1;
  const events = query.shape === 'eventTable';
  const body = streams(query, source, [...tags, '_field', '_start'], (field) => {
    const value = mixed ? ', _value: string(v: r._value)' : '';
    return [...(!mixed && resultKind(field, query) === 'number' ? ['toFloat()'] : []), `map(fn: (r) => ({ r with _field: ${literal(alias(field))}${value} }))`];
  });
  const rowKey = events ? ['_time', ...tags] : tags.length > 0 ? tags : ['_start'];
  // pivot fails on mixed value types: mixed tables pivot strings and turn number columns back.
  const back = mixed
    ? fields
        .filter((_field, index) => kinds[index] === 'number')
        .map((field) => `map(fn: (r) => ({ r with ${literal(alias(field))}: if exists ${column(alias(field))} then float(v: ${column(alias(field))}) else debug.null(type: "float") }))`)
    : [];
  const columns = [...(events ? ['Time'] : []), ...tags, ...fields.map(alias)];
  const order = events ? ['rename(columns: {_time: "Time"})', 'sort(columns: ["Time"], desc: true)', `limit(n: ${query.limit})`] : [];
  return `${body}${pipe([`group(columns: ${list([...tags, '_start'])})`, `pivot(rowKey: ${list(rowKey)}, columnKey: ["_field"], valueColumn: "_value")`, ...back, 'group()', ...order, `keep(columns: ${list(columns)})`])}`;
}

function buckets(source: ResolvedSource): string {
  const weekday = 'if date.weekDay(t: r._time) == 0 then 7 else date.weekDay(t: r._time)';
  return `data${pipe([
    `filter(fn: (r) => r._field == ${literal(source.spec.fields[0].name)})`,
    'group()',
    `map(fn: (r) => ({ _time: r._time, weekday: ${weekday}, hour: date.hour(t: r._time), _value: 1 }))`,
    'group(columns: ["weekday", "hour"])',
    'count()',
    'group()',
    'rename(columns: {_value: "count"})',
  ])}`;
}

function render(query: Query, source: ResolvedSource, ctx: TargetContext): string {
  const imports: string[] = [];
  if ((source.spec.where ?? []).some((f) => f.kind === 'number')) {
    imports.push('import "experimental"');
  }
  if (TABLE_SHAPES.has(query.shape) && new Set(source.spec.fields.map((field) => resultKind(field, query))).size > 1) {
    imports.push('import "internal/debug"');
  }
  if (query.shape === 'timeBuckets') {
    imports.push('import "date"', 'import "timezone"', `option location = timezone.location(name: ${literal(ctx.timezone)})`);
  }
  const body = query.shape === 'timeBuckets' ? buckets(source) : TABLE_SHAPES.has(query.shape) ? table(query, source) : series(query, source);
  return [...imports, data(query, source), body].join('\n');
}

export const flux: Translator = {
  output: 'influxdb2',
  datasource: { pluginId: 'influxdb', pluginName: 'InfluxDB', label: 'Varken (InfluxDB 2, Flux)' },
  shapes: new Set(['latest', 'timeSeries', 'topN', 'latestTable', 'eventTable', 'proportion', 'timeBuckets']),
  strings: 'all',
  target(query: Query, source: ResolvedSource, refId: string, ctx: TargetContext): GrafanaTarget {
    return { refId, datasource: { type: 'influxdb', uid: DATASOURCE_UID }, query: render(query, source, ctx) };
  },
};
