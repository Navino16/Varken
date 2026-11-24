import { isDeepStrictEqual } from 'node:util';

export interface OverlayPatch {
  op: 'add' | 'replace' | 'remove';
  path: string;
  value?: unknown;
  why: string;
}

/** Replaces a string format's validation for one service (e.g. GUIDs serialized without dashes). */
export interface FormatOverride {
  name: string;
  pattern: string;
  why: string;
}

export interface Overlay {
  patches: OverlayPatch[];
  formats?: FormatOverride[];
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

function valueAt(root: unknown, tokens: string[]): { found: boolean; value?: unknown } {
  let current: unknown = root;
  for (const token of tokens) {
    if (!isContainer(current) || !hasKey(current, token)) {
      return { found: false };
    }
    current = (current as Record<string, unknown>)[token];
  }
  return { found: true, value: current };
}

/** Patches the upstream spec now covers by itself (refresh report): each is checked against upstream plus the patches before it. */
export function findRedundantPatches(spec: unknown, overlay: Overlay): OverlayPatch[] {
  const current = structuredClone(spec);
  const redundant: OverlayPatch[] = [];
  for (const patch of overlay.patches) {
    const tokens = parsePointer(patch.path);
    const target = valueAt(current, tokens);
    const parent = valueAt(current, tokens.slice(0, -1));
    const appended = tokens[tokens.length - 1] === '-' && Array.isArray(parent.value);
    const covered =
      patch.op === 'remove'
        ? !target.found
        : appended
          ? (parent.value as unknown[]).some((item) => isDeepStrictEqual(item, patch.value))
          : target.found && isDeepStrictEqual(target.value, patch.value);
    if (covered) {
      redundant.push(patch);
    } else {
      applyPatch(current, patch);
    }
  }
  return redundant;
}
