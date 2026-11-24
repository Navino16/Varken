import { describe, it, expect } from 'vitest';
import { contractRoutes, loadFixture } from './registry';
import { loadContract } from './lib/spec';
import { findOperation, validateResponse } from './lib/validate';

function findEmptyArrays(value: unknown, at = ''): string[] {
  if (Array.isArray(value)) {
    return value.length === 0 ? [at || '/'] : value.flatMap((item, i) => findEmptyArrays(item, `${at}/${i}`));
  }
  if (typeof value === 'object' && value !== null) {
    return Object.entries(value).flatMap(([key, child]) => findEmptyArrays(child, `${at}/${key}`));
  }
  return [];
}

describe('contract registry', () => {
  it('has no duplicate routes', () => {
    const keys = contractRoutes.map((r) => `${r.service} ${r.method} ${r.path}`);

    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe.each(contractRoutes)('$service GET $path', (route) => {
  it('is declared by the spec', () => {
    expect(findOperation(loadContract(route.service), route.method, route.path)).toBeDefined();
  });

  it(`fixture ${route.fixture} matches the spec`, () => {
    expect(validateResponse(route.service, route.method, route.path, loadFixture(route.fixture))).toEqual([]);
  });

  it(`fixture ${route.fixture} has no empty arrays`, () => {
    expect(findEmptyArrays(loadFixture(route.fixture))).toEqual([]);
  });
});
