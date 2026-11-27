import type { FieldRef, Query } from '../model';

/** Kind of the value a field yields once aggregated: a count is always a number. */
export function resultKind(field: FieldRef, query: Query): 'number' | 'string' {
  const agg = field.agg ?? ('agg' in query ? query.agg : undefined);
  return agg === 'count' ? 'number' : field.kind;
}
