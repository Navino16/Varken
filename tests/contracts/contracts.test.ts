import { describe, it, expect } from 'vitest';
import { contractRoutes, loadFixture } from './registry';
import fs from 'node:fs';
import path from 'node:path';
import { loadContract, loadManifest } from './lib/spec';
import { canonicalJson } from '../../scripts/contracts/refresh/sources';
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

describe('pinned spec files', () => {
  const canonical = Object.entries(loadManifest()).filter(
    ([, entry]) => entry.refresh !== false && ['url', 'redoc-page', 'runtime'].includes(entry.refresh.kind)
  );

  const files = [
    ...canonical.map(([, entry]) => entry.file),
    'manifest.json',
    ...Object.values(loadManifest()).flatMap((entry) => (entry.refresh && entry.refresh.kind === 'docstrings' ? [entry.refresh.snapshot] : [])),
  ];

  it.each(files)('%s is written canonically so a refresh without upstream change is a no-op', (file) => {
    const content = fs.readFileSync(path.join(__dirname, 'specs', file), 'utf8');

    expect(content === canonicalJson(JSON.parse(content))).toBe(true);
  });
});
