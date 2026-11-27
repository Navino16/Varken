import { type Agg, type FieldRef, type Filter, type Query, type ResolvedSource, TABLE_SHAPES } from '../model';
import { DATASOURCE_UID, type GrafanaTarget, type TargetContext, type Translator } from './types';

const literal = (value: string): string => `"${value.replace(/[\\"]/g, (c) => `\\${c}`)}"`;
const alias = (field: FieldRef): string => field.as ?? field.name;

const OVER_TIME: Record<Agg, string> = { last: 'last_over_time', sum: 'sum_over_time', count: 'count_over_time', mean: 'avg_over_time', max: 'max_over_time' };
/** Combines the per-series values of one window across series: counts and sums add up. */
const ACROSS: Record<Agg, string> = { last: 'max', sum: 'sum', count: 'sum', mean: 'avg', max: 'max' };
const OPS: Record<Filter['op'], string> = { '=': '==', '!=': '!=', '>': '>' };

function selector(source: ResolvedSource, name: string): string {
  const matchers = [`type=${literal(source.spec.type)}`];
  if (source.server !== undefined) {
    matchers.push(`server=${literal(String(source.server))}`);
  }
  for (const { key, kind, op, value } of source.spec.where ?? []) {
    if (kind === 'tag') {
      matchers.push(`${key}${op === '=' ? '=' : '!='}${literal(String(value))}`);
    }
  }
  return `${source.measurement}_${name}{${matchers.join(', ')}}`;
}

/** Per-series value of `field` over `window`, kept only where the point's number filters hold. */
function perSeries(source: ResolvedSource, field: FieldRef, agg: Agg, window: string, offset?: string): string {
  const range = (name: string): string => `${selector(source, name)}[${window}]${offset ? ` offset ${offset}` : ''}`;
  const filters = (source.spec.where ?? []).filter((f) => f.kind === 'number');
  return filters.reduce((expr, { key, op, value }) => `(${expr}) and (last_over_time(${range(key)}) ${OPS[op]} ${Number(value)})`, `${OVER_TIME[agg]}(${range(field.name)})`);
}

function combined(agg: Agg, tags: string[], expr: string): string {
  return tags.length > 0 ? `${ACROSS[agg]} by (${tags.join(', ')}) (${expr})` : `${ACROSS[agg]}(${expr})`;
}

function fieldExpr(query: Query, source: ResolvedSource, field: FieldRef): string {
  const agg: Agg = field.agg ?? ('agg' in query ? query.agg : 'last');
  const tags = source.spec.tags ?? [];
  const interval = source.intervalSeconds;
  switch (query.shape) {
    case 'latest':
      return `last_over_time((${combined(agg, tags, perSeries(source, field, agg, `${interval}s`))})[${3 * interval}s:${interval}s])`;
    case 'timeSeries': {
      const window = query.bucket === '1d' ? '1d' : '$__interval';
      const current = combined(agg, tags, perSeries(source, field, agg, window));
      if (query.transform !== 'nonNegativeDifference') {
        return current;
      }
      const previous = combined(agg, tags, perSeries(source, field, agg, window, window));
      return `clamp_min(${current} - ${previous}, 0)`;
    }
    case 'topN':
      return combined(agg, tags, perSeries(source, field, agg, '$__range'));
    case 'latestTable':
      return combined('last', tags, perSeries(source, field, 'last', `${interval + Math.min(interval, 60)}s`));
    case 'proportion':
      return `sum(${perSeries(source, field, 'sum', '$__range')}) * ${interval}`;
    case 'eventTable':
      throw new Error('MetricsQL cannot list events');
    case 'timeBuckets':
      throw new Error('MetricsQL cannot bucket by hour of day or weekday');
  }
}

function legend(source: ResolvedSource): string {
  const template = source.spec.legend ?? (source.spec.fields.length === 1 ? '{source}' : '{source} {field}');
  return template
    .replaceAll('{source}', source.label)
    .replaceAll('{field}', '{{__name__}}')
    .replace(/\{tag:([^}]+)\}/g, (_match, tag: string) => `{{${tag}}}`);
}

export const metricsql: Translator = {
  output: 'victoriametrics',
  datasource: { pluginId: 'prometheus', pluginName: 'Prometheus', label: 'Varken (VictoriaMetrics)' },
  shapes: new Set(['latest', 'timeSeries', 'topN', 'latestTable', 'proportion']),
  strings: 'none',
  // Tags arrive as labels: one row per label set, one column per field (named by `__name__`).
  tableTransformations: [
    { id: 'joinByLabels', options: { value: '__name__' } },
    { id: 'organize', options: { excludeByName: { varken_source: true } } },
  ],
  target(query: Query, source: ResolvedSource, refId: string, _ctx: TargetContext): GrafanaTarget {
    const table = TABLE_SHAPES.has(query.shape);
    const names = (field: FieldRef): string => [literal('__name__'), literal(alias(field)), ...(table ? [literal('varken_source'), literal(source.label)] : [])].join(', ');
    const parts = source.spec.fields.map((field) => `label_set(${fieldExpr(query, source, field)}, ${names(field)})`);
    const ranged = query.shape === 'timeSeries';
    return {
      refId,
      datasource: { type: 'prometheus', uid: DATASOURCE_UID },
      expr: parts.length === 1 ? parts[0] : `union(${parts.join(', ')})`,
      ...(table ? {} : { legendFormat: legend(source) }),
      instant: !ranged,
      range: ranged,
      format: 'time_series',
      ...(query.shape === 'timeSeries' && query.bucket === '1d' ? { interval: '1d' } : {}),
    };
  },
};
