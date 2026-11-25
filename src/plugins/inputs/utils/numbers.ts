export const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

/** `{ sourceKey: fieldName }` → fields for the finite numbers of `source`. */
export function pickNumbers<T extends object>(
  source: T | null | undefined,
  keys: Partial<Record<keyof T & string, string>>
): Record<string, number> {
  const fields: Record<string, number> = {};
  const values = (source ?? {}) as Record<string, unknown>;
  for (const [key, field] of Object.entries(keys) as [string, string][]) {
    const value = values[key];
    if (isNumber(value)) {
      fields[field] = value;
    }
  }
  return fields;
}
