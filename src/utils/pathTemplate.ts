/** Replaces `{name}` segments of an OpenAPI path template with URL-encoded values. */
export function expandPathTemplate(template: string, values: Record<string, unknown> = {}): string {
  return template.replace(/\{([^}]+)\}/g, (_match, name: string) => {
    const value = values[name];
    if (value === undefined || value === null || value === '') {
      throw new Error(`Missing path parameter "${name}" for ${template}`);
    }
    return encodeURIComponent(String(value));
  });
}
