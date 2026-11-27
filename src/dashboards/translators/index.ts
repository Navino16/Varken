import type { OutputKey, Query, ResolvedSource } from '../model';
import { influxql } from './influxql';
import type { Translator } from './types';

export type { GrafanaTarget, Translator } from './types';
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
  return translator.stringFields ? sources : sources.filter((source) => source.spec.fields.every((field) => field.kind !== 'string'));
}
