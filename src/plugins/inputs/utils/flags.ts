/** Boolean flags as 0/1 fields; a flag the service did not report is omitted rather than written as 0. */
export function booleanFlags(flags: Record<string, boolean | null | undefined>): Record<string, number> {
  const fields: Record<string, number> = {};
  for (const [key, value] of Object.entries(flags)) {
    if (typeof value === 'boolean') {
      fields[key] = value ? 1 : 0;
    }
  }
  return fields;
}
