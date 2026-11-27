import { type FieldRef, type OutputKey, type Query, type ResolvedSource, TABLE_SHAPES } from '../model';
import { influxql } from './influxql';
import type { Translator } from './types';

export type { GrafanaTarget, TargetContext, Translator } from './types';
export { DATASOURCE_UID } from './types';

const TRANSLATORS: Partial<Record<OutputKey, Translator>> = { influxdb1: influxql };

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

/** Kind of the value a field yields once aggregated: a count is always a number. */
export function resultKind(field: FieldRef, query: Query): 'number' | 'string' {
  const agg = field.agg ?? ('agg' in query ? query.agg : undefined);
  return agg === 'count' ? 'number' : field.kind;
}
