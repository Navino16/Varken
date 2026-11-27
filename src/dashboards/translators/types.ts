import type { OutputKey, Query, ResolvedSource, Shape } from '../model';

export interface TargetContext {
  timezone: string;
}

export interface GrafanaTarget {
  refId: string;
  datasource: { type: string; uid: string };
  [key: string]: unknown;
}

/**
 * Renders the panel queries of one output's query language. Panel transformations rely on the frames a target
 * returns: time series named by the source legend, table columns named by field aliases and tag keys.
 */
export interface Translator {
  output: OutputKey;
  datasource: { pluginId: string; pluginName: string; label: string };
  shapes: ReadonlySet<Shape>;
  /** Where string results can be returned: `tables` keeps them to table shapes (SQL), `none` drops string fields (VictoriaMetrics). */
  strings: 'all' | 'tables' | 'none';
  /** `error`: a query naming a column no point ever carried fails (QuestDB), so optional fields are not read. */
  absentColumns?: 'error';
  /** Put before the panel's own transformations when the query has a table shape. */
  tableTransformations?: object[];
  target(query: Query, source: ResolvedSource, refId: string, ctx: TargetContext): GrafanaTarget;
}

// biome-ignore lint/suspicious/noTemplateCurlyInString: Grafana's import placeholder, not a template
export const DATASOURCE_UID = '${DS_VARKEN}';
