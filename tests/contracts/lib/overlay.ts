export interface OverlayPatch {
  op: 'add' | 'replace' | 'remove';
  path: string;
  value?: unknown;
  why: string;
}

export interface Overlay {
  patches: OverlayPatch[];
}

type Container = Record<string, unknown> | unknown[];

function parsePointer(pointer: string): string[] {
  if (!pointer.startsWith('/')) {
    throw new Error(`Invalid JSON pointer "${pointer}"`);
  }
  return pointer
    .slice(1)
    .split('/')
    .map((token) => token.replace(/~1/g, '/').replace(/~0/g, '~'));
}

function isContainer(value: unknown): value is Container {
  return typeof value === 'object' && value !== null;
}

function hasKey(container: Container, key: string): boolean {
  return Array.isArray(container) ? Number(key) >= 0 && Number(key) < container.length : key in container;
}

function resolveParent(root: unknown, tokens: string[], pointer: string): Container {
  let current: unknown = root;
  for (const token of tokens.slice(0, -1)) {
    if (!isContainer(current) || !hasKey(current, token)) {
      throw new Error(`Overlay pointer not found: ${pointer}`);
    }
    current = (current as Record<string, unknown>)[token];
  }
  if (!isContainer(current)) {
    throw new Error(`Overlay pointer not found: ${pointer}`);
  }
  return current;
}

function applyPatch(root: unknown, patch: OverlayPatch): void {
  if (!patch.why?.trim()) {
    throw new Error(`Overlay patch ${patch.op} ${patch.path} needs a why`);
  }
  const tokens = parsePointer(patch.path);
  const parent = resolveParent(root, tokens, patch.path);
  const key = tokens[tokens.length - 1];

  if (Array.isArray(parent)) {
    if (patch.op === 'add') {
      const index = key === '-' ? parent.length : Number(key);
      parent.splice(index, 0, patch.value);
      return;
    }
    if (!hasKey(parent, key)) {
      throw new Error(`Overlay pointer not found: ${patch.path}`);
    }
    if (patch.op === 'replace') {
      parent[Number(key)] = patch.value;
    } else {
      parent.splice(Number(key), 1);
    }
    return;
  }

  if (patch.op !== 'add' && !hasKey(parent, key)) {
    throw new Error(`Overlay pointer not found: ${patch.path}`);
  }
  if (patch.op === 'remove') {
    delete parent[key];
  } else {
    parent[key] = patch.value;
  }
}

export function applyOverlay<T>(spec: T, overlay: Overlay): T {
  const copy = structuredClone(spec);
  for (const patch of overlay.patches) {
    applyPatch(copy, patch);
  }
  return copy;
}
