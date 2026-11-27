import { type OutputKey, type Query, type ResolvedSource, TABLE_SHAPES } from '../model';
import { flux } from './flux';
import { influxql } from './influxql';
import { resultKind } from './kinds';
import { metricsql } from './metricsql';
import { questdb, timescaledb } from './sql';
import type { Translator } from './types';

export { resultKind } from './kinds';
export type { GrafanaTarget, TargetContext, Translator } from './types';
export { DATASOURCE_UID } from './types';

const TRANSLATORS: Record<OutputKey, Translator> = { influxdb1: influxql, influxdb2: flux, victoriametrics: metricsql, questdb, timescaledb };

export function getTranslator(output: OutputKey): Translator {
  const translator = TRANSLATORS[output];
  if (!translator) {
    throw new Error(`No dashboard translator for output ${output}`);
  }
  return translator;
}

/** Sources the translator can query for this shape. */
export function usableSources(translator: Translator, query: Query, sources: ResolvedSource[]): ResolvedSource[] {
  if (!translator.shapes.has(query.shape)) {
    return [];
  }
  switch (translator.strings) {
    case 'all':
      return sources;
    case 'none':
      return sources.filter((source) => source.spec.fields.every((field) => field.kind !== 'string'));
    case 'tables':
      return TABLE_SHAPES.has(query.shape) ? sources : sources.filter((source) => source.spec.fields.every((field) => resultKind(field, query) === 'number'));
  }
}
