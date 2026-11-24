export function stripQuery(calledPath: string): string {
  const index = calledPath.indexOf('?');
  return index === -1 ? calledPath : calledPath.slice(0, index);
}

export function matchPathTemplate(template: string, path: string): boolean {
  const templateSegments = template.split('/');
  const pathSegments = path.split('/');
  if (templateSegments.length !== pathSegments.length) {
    return false;
  }
  return templateSegments.every((segment, i) =>
    /^\{[^}]+\}$/.test(segment) ? pathSegments[i].length > 0 : segment === pathSegments[i]
  );
}
