import { describe, it, expect } from 'vitest';
import { applyOverlay, findRedundantPatches, type OverlayPatch } from './overlay';

const patch = (p: Omit<OverlayPatch, 'why'> & { why?: string }): OverlayPatch => ({ why: 'test', ...p });

describe('applyOverlay', () => {
  it('adds a property at a JSON pointer', () => {
    const result = applyOverlay({ a: { b: 1 } }, { patches: [patch({ op: 'add', path: '/a/c', value: 2 })] });
    expect(result).toEqual({ a: { b: 1, c: 2 } });
  });

  it('replaces and removes values', () => {
    const replaced = applyOverlay({ a: { b: 1 } }, { patches: [patch({ op: 'replace', path: '/a/b', value: 3 })] });
    expect(replaced).toEqual({ a: { b: 3 } });

    const removed = applyOverlay({ a: { b: 1 } }, { patches: [patch({ op: 'remove', path: '/a/b' })] });
    expect(removed).toEqual({ a: {} });
  });

  it('appends to arrays with -', () => {
    const result = applyOverlay({ list: [1] }, { patches: [patch({ op: 'add', path: '/list/-', value: 2 })] });
    expect(result).toEqual({ list: [1, 2] });
  });

  it('unescapes ~1 and ~0 in pointers', () => {
    const spec = { paths: { '/api/v3/queue': {} as Record<string, unknown> }, 'a~b': {} };
    const result = applyOverlay(spec, {
      patches: [
        patch({ op: 'add', path: '/paths/~1api~1v3~1queue/x', value: 1 }),
        patch({ op: 'add', path: '/a~0b/y', value: 2 }),
      ],
    });
    expect(result.paths['/api/v3/queue']).toEqual({ x: 1 });
    expect(result['a~b']).toEqual({ y: 2 });
  });

  it('does not mutate the input', () => {
    const spec = { a: { b: 1 } };
    const snapshot = structuredClone(spec);
    applyOverlay(spec, { patches: [patch({ op: 'replace', path: '/a/b', value: 9 })] });
    expect(spec).toEqual(snapshot);
  });

  it('rejects a patch without a why', () => {
    expect(() => applyOverlay({ a: 1 }, { patches: [patch({ op: 'replace', path: '/a', value: 2, why: '  ' })] })).toThrow(
      /why/
    );
  });

  it('rejects replace or remove on a missing pointer', () => {
    expect(() => applyOverlay({ a: {} }, { patches: [patch({ op: 'replace', path: '/a/b', value: 1 })] })).toThrow(
      /not found/
    );
    expect(() => applyOverlay({ a: {} }, { patches: [patch({ op: 'remove', path: '/a/b' })] })).toThrow(/not found/);
  });

  it('rejects add under a missing parent', () => {
    expect(() => applyOverlay({ a: {} }, { patches: [patch({ op: 'add', path: '/x/y', value: 1 })] })).toThrow(
      /not found/
    );
  });
});

describe('findRedundantPatches', () => {
  const spec = { a: { b: 1 }, list: [{ name: 'x' }] };

  it('reports adds and replaces whose value is already upstream', () => {
    const add = patch({ op: 'add', path: '/a/b', value: 1 });
    const replace = patch({ op: 'replace', path: '/a/b', value: 1 });
    const append = patch({ op: 'add', path: '/list/-', value: { name: 'x' } });

    expect(findRedundantPatches(spec, { patches: [add, replace, append] })).toEqual([add, replace, append]);
  });

  it('reports removes whose target is already gone', () => {
    const remove = patch({ op: 'remove', path: '/a/c' });

    expect(findRedundantPatches(spec, { patches: [remove] })).toEqual([remove]);
  });

  it('does not report patches that still change the spec', () => {
    const patches = [
      patch({ op: 'add', path: '/a/c', value: 2 }),
      patch({ op: 'replace', path: '/a/b', value: 3 }),
      patch({ op: 'remove', path: '/a/b' }),
      patch({ op: 'add', path: '/list/-', value: { name: 'y' } }),
    ];

    expect(findRedundantPatches(spec, { patches })).toEqual([]);
  });
});
