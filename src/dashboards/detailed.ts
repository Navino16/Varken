import { CATALOG, type PointSpec } from './catalog';
import type { DashboardSpec, FieldRef, InputKey, PanelSpec, PanelTemplate, SourceSpec, Variant } from './model';
import { fieldStats, mappingOverride, rowsTable, timeseries, unitOverride } from './panels';
import { MEASUREMENTS } from './sources';

type Plugin = InputKey | 'varken';

const HIDDEN = new Set(['hash', 'reachable', 'present', 'installed']);
const EVENT_LIMIT = 50;

/** Column titles the generic rule (`snake_case` / `camelCase` → sentence) words badly. */
const LABELS: Record<string, string> = {
  sxe: 'Episode',
  epname: 'Episode title',
  airsUTC: 'Airs (UTC)',
  hi: 'Hearing impaired',
  Missing_Available: 'Not released',
};

export function columnLabel(key: string): string {
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replaceAll('_', ' ')
    .toLowerCase();
  return LABELS[key] ?? `${words.charAt(0).toUpperCase()}${words.slice(1)}`;
}

const alias = (field: FieldRef): string => field.as ?? field.name;

function source(plugin: Plugin, point: PointSpec, extra: Partial<SourceSpec>): SourceSpec {
  return {
    plugin,
    ...(point.collector ? { collector: point.collector } : {}),
    ...(point.throttleSeconds ? { throttleSeconds: point.throttleSeconds } : {}),
    type: point.type,
    ...(point.where ? { where: point.where } : {}),
    fields: point.fields,
    ...extra,
  };
}

/** Unit overrides of the fields `units` names, matched on `name(alias)`. */
function unitOverrides(point: PointSpec, name: (key: string) => string): object[] {
  return point.fields.flatMap((field) => {
    const unit = point.units?.[alias(field)];
    return unit ? [unitOverride(name(alias(field)), unit)] : [];
  });
}

function withOverrides(template: PanelTemplate, extra: object[]): PanelTemplate {
  const fieldConfig = template.fieldConfig as { defaults: object; overrides: object[] };
  return { ...template, fieldConfig: { ...fieldConfig, overrides: [...fieldConfig.overrides, ...extra] } };
}

function seriesPanel(plugin: Plugin, point: PointSpec, key: string): PanelSpec {
  const tags = point.tags ?? (point.by ? [point.by] : undefined);
  const legend = point.legend ?? (point.by ? (point.fields.length === 1 ? `{tag:${point.by}}` : `{tag:${point.by}} · {field}`) : '{field}');
  const units = point.fields.map((field) => point.units?.[alias(field)]);
  const shared = units.every((unit) => unit === units[0]) ? units[0] : undefined;
  // Series named after a tag cannot be matched by field name: such panels keep one unit for every field.
  const template = shared ? timeseries({ unit: shared }) : withOverrides(timeseries(), unitOverrides(point, (name) => name));
  return {
    key,
    title: point.title,
    width: point.size?.[0] ?? 12,
    height: point.size?.[1] ?? 8,
    variants: [{ query: { shape: 'timeSeries', agg: point.agg ?? 'mean', bucket: 'auto' }, sources: [source(plugin, point, { ...(tags ? { tags } : {}), legend })] }],
    grafana: { ...(point.grafana ?? template), ...(point.timeFrom ? { timeFrom: point.timeFrom } : {}) },
  };
}

function statsPanel(plugin: Plugin, point: PointSpec, key: string): PanelSpec {
  return {
    key,
    title: point.title,
    width: point.size?.[0] ?? 12,
    height: point.size?.[1] ?? 4,
    variants: [{ query: { shape: 'latest', agg: 'last' }, sources: [source(plugin, point, { legend: point.legend ?? '{field}' })] }],
    grafana: point.grafana ?? withOverrides(fieldStats(), unitOverrides(point, (name) => name)),
  };
}

function tableTemplate(point: PointSpec, options: { time?: boolean; sortBy?: { field: string; desc?: boolean }; limit?: number } = {}): PanelTemplate {
  const columns = [...(options.time ? ['Time'] : []), ...(point.tags ?? []), ...point.fields.map(alias).filter((name) => !HIDDEN.has(name))];
  const mappings = Object.entries(point.mappings ?? {}).map(([column, values]) => mappingOverride(columnLabel(column), values));
  return rowsTable({
    rename: Object.fromEntries(columns.map((column) => [column, columnLabel(column)])),
    hide: point.fields.map(alias).filter((name) => HIDDEN.has(name)),
    ...(options.sortBy ? { sortBy: options.sortBy } : {}),
    ...(options.limit ? { limit: options.limit } : {}),
    overrides: [...unitOverrides(point, columnLabel), ...mappings],
  });
}

function tablePanel(plugin: Plugin, point: PointSpec, key: string): PanelSpec {
  const tags = point.tags ? { tags: point.tags } : {};
  const variants: Variant[] = [{ query: { shape: 'latestTable' }, sources: [source(plugin, point, tags)] }];
  const numbers = point.fields.filter((field) => field.kind === 'number');
  // VictoriaMetrics drops string fields: it still gets the numbers of the point.
  if (numbers.length > 0 && numbers.length < point.fields.length) {
    variants.push({ query: { shape: 'latestTable' }, sources: [source(plugin, point, { ...tags, fields: numbers })], grafana: point.grafana ?? tableTemplate({ ...point, fields: numbers }) });
  }
  return { key, title: point.title, width: point.size?.[0] ?? 24, height: point.size?.[1] ?? 8, variants, grafana: point.grafana ?? tableTemplate(point) };
}

function eventPanels(plugin: Plugin, point: PointSpec, key: string): PanelSpec[] {
  const by = point.by ?? 'type';
  return [
    {
      key: `${key}-per-day`,
      title: `${point.title} per day`,
      width: 12,
      height: 8,
      variants: [{ query: { shape: 'timeSeries', agg: 'count', bucket: '1d' }, sources: [source(plugin, point, { fields: point.fields.slice(0, 1), tags: [by], legend: `{tag:${by}}` })] }],
      grafana: timeseries({ bars: true, stacked: true }),
    },
    {
      key,
      title: point.title,
      width: 12,
      height: 8,
      variants: [{ query: { shape: 'eventTable', limit: EVENT_LIMIT }, sources: [source(plugin, point, point.tags ? { tags: point.tags } : {})] }],
      grafana: tableTemplate(point, { time: true, sortBy: { field: 'Time', desc: true }, limit: EVENT_LIMIT }),
    },
  ];
}

/** Panels of one point type, by the rule of its view (plan 06 « Views per point type »). */
export function pointPanels(plugin: Plugin, point: PointSpec): PanelSpec[] {
  const key = `${plugin}-${point.type}-${point.title}`;
  switch (point.view) {
    case 'series':
      return [seriesPanel(plugin, point, key)];
    case 'stats':
      return [statsPanel(plugin, point, key)];
    case 'table':
      return [tablePanel(plugin, point, key)];
    case 'events':
      return eventPanels(plugin, point, key);
  }
}

export const DETAILED: DashboardSpec = {
  kind: 'detailed',
  title: 'Varken Detailed',
  bands: (Object.keys(MEASUREMENTS) as Plugin[]).map((plugin) => ({
    key: plugin,
    title: MEASUREMENTS[plugin],
    ...(plugin === 'varken' ? {} : { perInstance: plugin }),
    collapsed: true,
    panels: CATALOG[plugin].flatMap((point) => pointPanels(plugin, point)),
  })),
};
