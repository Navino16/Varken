import type { PanelTemplate } from './model';

/** Grafana-side combination of the per-source targets: translators never merge measurements (plan 04). */
const REDUCE_LAST = { id: 'reduce', options: { mode: 'seriesToRows', reducers: ['lastNotNull'] } };

interface FieldOptions {
  unit?: string;
  noValue?: string;
  thresholds?: { color: string; value: number | null }[];
  mappings?: object[];
}

function defaults({ unit, noValue, thresholds, mappings }: FieldOptions): object {
  return {
    ...(unit ? { unit } : {}),
    ...(noValue ? { noValue } : {}),
    ...(mappings ? { mappings } : {}),
    color: { mode: thresholds ? 'thresholds' : 'palette-classic' },
    thresholds: { mode: 'absolute', steps: thresholds ?? [{ color: 'green', value: null }] },
  };
}

export const valueMapping = (values: Record<string, string>): object => ({
  type: 'value',
  options: Object.fromEntries(Object.entries(values).map(([value, text], index) => [value, { text, index }])),
});

const byName = (name: string, properties: { id: string; value: unknown }[]): object => ({ matcher: { id: 'byName', options: name }, properties });

/** One number: the sum of every source's latest value. */
export function stat(options: FieldOptions = {}): PanelTemplate {
  return {
    type: 'stat',
    options: {
      reduceOptions: { values: false, calcs: ['sum'], fields: '' },
      graphMode: 'none',
      colorMode: 'value',
      textMode: 'value',
      justifyMode: 'center',
    },
    fieldConfig: { defaults: defaults({ noValue: '0', thresholds: [{ color: 'blue', value: null }], ...options }), overrides: [] },
    transformations: [REDUCE_LAST],
  };
}

/** Healthy collectors next to the total. */
export function healthStat(): PanelTemplate {
  return {
    type: 'stat',
    options: { reduceOptions: { values: false, calcs: ['lastNotNull'], fields: '' }, graphMode: 'none', colorMode: 'value', textMode: 'value_and_name' },
    fieldConfig: {
      defaults: defaults({ thresholds: [{ color: 'green', value: null }] }),
      overrides: [],
    },
    transformations: [
      { id: 'joinByField', options: { byField: 'Time', mode: 'outer' } },
      { id: 'calculateField', options: { mode: 'binary', binary: { left: 'collectors', operator: '-', right: 'collectors_open' }, alias: 'Healthy' } },
      { id: 'organize', options: { excludeByName: { Time: true, collectors_open: true }, indexByName: { Healthy: 0, collectors: 1 }, renameByName: { collectors: 'Total' } } },
    ],
  };
}

interface TableOptions {
  rename?: Record<string, string>;
  hide?: string[];
  sortBy?: { field: string; desc?: boolean };
  limit?: number;
  overrides?: object[];
}

function organize(rename: Record<string, string> = {}, hide: string[] = []): object {
  return { id: 'organize', options: { excludeByName: Object.fromEntries(['Time', ...hide].map((name) => [name, true])), renameByName: rename } };
}

function tail({ sortBy, limit }: TableOptions): object[] {
  return [
    ...(sortBy ? [{ id: 'sortBy', options: { sort: [{ field: sortBy.field, desc: sortBy.desc ?? false }] } }] : []),
    ...(limit ? [{ id: 'limit', options: { limitField: limit } }] : []),
  ];
}

/** Rows of every source in one table (table-format targets). */
export function rowsTable(options: TableOptions = {}): PanelTemplate {
  return {
    type: 'table',
    options: { showHeader: true, cellHeight: 'sm' },
    fieldConfig: { defaults: {}, overrides: options.overrides ?? [] },
    transformations: [{ id: 'merge', options: {} }, ...tail(options), organize(options.rename, options.hide)],
  };
}

/** One row per series: its legend and its latest value. */
export function namedTable(rename: Record<string, string>): PanelTemplate {
  return {
    type: 'table',
    options: { showHeader: true, cellHeight: 'sm' },
    fieldConfig: { defaults: {}, overrides: [] },
    transformations: [REDUCE_LAST, { id: 'organize', options: { renameByName: rename } }],
  };
}

/** Totals per label over every source, largest first. */
export function topTable(label: string, value: string, rename: Record<string, string>, hide: string[] = []): PanelTemplate {
  const total = `${value} (sum)`;
  return {
    type: 'table',
    options: { showHeader: true, cellHeight: 'sm' },
    fieldConfig: { defaults: {}, overrides: [] },
    transformations: [
      { id: 'merge', options: {} },
      { id: 'groupBy', options: { fields: { [label]: { operation: 'groupby', aggregations: [] }, [value]: { operation: 'aggregate', aggregations: ['sum'] } } } },
      ...tail({ sortBy: { field: total, desc: true }, limit: 10 }),
      organize({ ...rename, [total]: rename[value] ?? value }, hide),
    ],
  };
}

export function timeseries(options: FieldOptions & { stacked?: boolean; bars?: boolean } = {}): PanelTemplate {
  return {
    type: 'timeseries',
    options: { legend: { displayMode: 'list', placement: 'bottom', showLegend: true }, tooltip: { mode: 'multi', sort: 'desc' } },
    fieldConfig: {
      defaults: {
        ...defaults(options),
        custom: {
          drawStyle: options.bars ? 'bars' : 'line',
          fillOpacity: options.bars ? 80 : 20,
          lineWidth: 1,
          spanNulls: true,
          stacking: { mode: options.stacked ? 'normal' : 'none', group: 'A' },
        },
      },
      overrides: [],
    },
  };
}

export function barGauge(unit: string): PanelTemplate {
  return {
    type: 'bargauge',
    options: { reduceOptions: { values: false, calcs: ['lastNotNull'], fields: '' }, orientation: 'horizontal', displayMode: 'basic', showUnfilled: true },
    fieldConfig: { defaults: defaults({ unit, thresholds: [{ color: 'green', value: null }] }), overrides: [] },
  };
}

export function geomap(): PanelTemplate {
  return {
    type: 'geomap',
    options: {
      view: { id: 'zero', lat: 0, lon: 0, zoom: 1 },
      controls: { showZoom: true, mouseWheelZoom: false },
      basemap: { type: 'default', name: 'Basemap' },
      layers: [
        {
          type: 'markers',
          name: 'Streams',
          location: { mode: 'coords', latitude: 'lat', longitude: 'lon' },
          config: { showLegend: false, style: { size: { fixed: 6 }, color: { fixed: 'green' } } },
        },
      ],
    },
    fieldConfig: { defaults: {}, overrides: [] },
    transformations: [{ id: 'merge', options: {} }],
  };
}

/** Share of each field summed over every source. */
export function pie(): PanelTemplate {
  return {
    type: 'piechart',
    options: { reduceOptions: { values: true, calcs: [], fields: '/Total/' }, pieType: 'donut', legend: { displayMode: 'list', placement: 'right', showLegend: true, values: ['percent'] } },
    fieldConfig: { defaults: { unit: 'none', color: { mode: 'palette-classic' } }, overrides: [] },
    transformations: [
      { id: 'reduce', options: { mode: 'seriesToRows', reducers: ['sum'] } },
      { id: 'groupBy', options: { fields: { Field: { operation: 'groupby', aggregations: [] }, Total: { operation: 'aggregate', aggregations: ['sum'] } } } },
      organize({ 'Total (sum)': 'Total' }),
    ],
  };
}

export function hourBars(): PanelTemplate {
  return {
    type: 'barchart',
    options: { xField: 'hour', stacking: 'normal', orientation: 'vertical', showValue: 'never', legend: { displayMode: 'list', placement: 'bottom', showLegend: true } },
    fieldConfig: { defaults: { color: { mode: 'palette-classic' } }, overrides: [] },
    transformations: [{ id: 'merge', options: {} }, { id: 'sortBy', options: { sort: [{ field: 'hour' }] } }, organize()],
  };
}

export function heatmap(): PanelTemplate {
  return { type: 'heatmap', options: { calculate: false, color: { mode: 'scheme', scheme: 'Blues' } }, fieldConfig: { defaults: {}, overrides: [] } };
}

export const unitOverride = (name: string, unit: string): object => byName(name, [{ id: 'unit', value: unit }]);
export const mappingOverride = (name: string, values: Record<string, string>): object => byName(name, [{ id: 'mappings', value: [valueMapping(values)] }]);
