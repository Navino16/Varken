import type { InputsConfig, OutputsConfig } from '../config/schemas/config.schema';

export type OutputKey = keyof OutputsConfig;
export type InputKey = keyof InputsConfig;
export type Agg = 'last' | 'sum' | 'count' | 'mean' | 'max';

/** A value read from a point; `agg` overrides the query's aggregation for this field. */
export interface FieldRef {
  name: string;
  kind: 'number' | 'string';
  as?: string;
  agg?: Agg;
  /** Written only by some server setups (a library type, a quota): the column may never exist. */
  optional?: boolean;
}

export const num = (name: string, as?: string): FieldRef => ({ name, kind: 'number', ...(as ? { as } : {}) });
export const str = (name: string, as?: string): FieldRef => ({ name, kind: 'string', ...(as ? { as } : {}) });

export interface Filter {
  key: string;
  kind: 'tag' | 'number';
  op: '=' | '!=' | '>';
  value: string | number;
}

/** Points one panel reads from one input plugin; resolved into one source per configured instance. */
export interface SourceSpec {
  plugin: InputKey | 'varken';
  /** Config key of the collector writing these points; none for `varken`. */
  collector?: string;
  /** Extra boolean config paths of the instance that must be true (`geoip.enabled`). */
  requires?: string[];
  /** Plex data Tautulli also collects with this collector: skipped for a Plex instance a Tautulli watches with it enabled (spec §Source priority). */
  streaming?: 'activity' | 'history';
  /** The collector writes these points at most this often, on its own run boundaries (Tautulli `stats`). */
  throttleSeconds?: number;
  type: string;
  where?: Filter[];
  fields: FieldRef[];
  /** Tags grouped by (latest, timeSeries, topN, latestTable) or selected as columns (eventTable). */
  tags?: string[];
  /** Series name: `{source}`, `{field}` and `{tag:<key>}` placeholders. */
  legend?: string;
}

export type Query =
  | { shape: 'latest'; agg: Agg }
  | { shape: 'timeSeries'; agg: Agg; bucket: 'auto' | '1d'; transform?: 'nonNegativeDifference' }
  | { shape: 'topN'; agg: Agg }
  | { shape: 'latestTable' }
  | { shape: 'eventTable'; limit: number }
  | { shape: 'proportion' }
  | { shape: 'timeBuckets' };

export type Shape = Query['shape'];

/** Shapes rendered as tables: columns named by field aliases and tag keys. */
export const TABLE_SHAPES: ReadonlySet<Shape> = new Set(['topN', 'latestTable', 'eventTable', 'timeBuckets']);

export interface PanelTemplate {
  type: string;
  title?: string;
  options?: object;
  fieldConfig?: object;
  transformations?: object[];
  /** Relative window replacing the dashboard range for this panel (Grafana `timeFrom`). */
  timeFrom?: string;
}

export interface Variant {
  query: Query;
  sources: SourceSpec[];
  grafana?: Partial<PanelTemplate>;
  /** Rendered only when the output can read every resolved source. */
  complete?: boolean;
  /** Overrides the panel's width and height. */
  size?: [number, number];
}

export interface PanelSpec {
  key: string;
  title: string;
  width: number;
  height: number;
  /** Tried in order: the first one with a usable source is rendered. */
  variants: Variant[];
  grafana: PanelTemplate;
}

export interface BandSpec {
  key: string;
  title: string;
  /** Panels ignore the time picker and show this window. */
  fixedWindow?: '24h';
  /** Repeated for each configured instance of the plugin, its sources restricted to that instance. */
  perInstance?: InputKey;
  /** Panels nested in the row, queried only once it is opened. */
  collapsed?: boolean;
  panels: PanelSpec[];
}

export interface DashboardSpec {
  kind: 'overview' | 'detailed';
  title: string;
  bands: BandSpec[];
}

/** Plex instance id → ids of the Tautulli instances watching it. */
export type PlexPairing = ReadonlyMap<number, readonly number[]>;

export interface ResolvedSource {
  spec: SourceSpec;
  measurement: string;
  server?: number;
  intervalSeconds: number;
  label: string;
}
