import type { OutputKey, Query, ResolvedSource, Shape } from '../model';

export interface GrafanaTarget {
  refId: string;
  datasource: { type: string; uid: string };
  [key: string]: unknown;
}

/** Renders the panel queries of one output's query language. */
export interface Translator {
  output: OutputKey;
  datasource: { pluginId: string; pluginName: string; label: string };
  shapes: ReadonlySet<Shape>;
  /** False when the output drops string fields (VictoriaMetrics). */
  stringFields: boolean;
  target(query: Query, source: ResolvedSource, refId: string): GrafanaTarget;
}

// biome-ignore lint/suspicious/noTemplateCurlyInString: Grafana's import placeholder, not a template
export const DATASOURCE_UID = '${DS_VARKEN}';
