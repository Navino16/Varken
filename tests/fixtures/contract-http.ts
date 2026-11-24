import { vi } from 'vitest';
import { createMockHttpClient, type MockHttpClient } from './http';
import { findRoute, loadFixture, type ContractRoute } from '../contracts/registry';
import { assertMatchesContract } from '../contracts/lib/validate';
import type { ServiceId } from '../contracts/lib/spec';

type Params = Record<string, unknown> | undefined;
type OverrideBody = unknown | ((params?: Record<string, unknown>) => unknown);

export interface ContractHttpClient extends MockHttpClient {
  override(path: string, body: OverrideBody): void;
  overrideUnchecked(path: string, body: unknown): void;
  fail(path: string, error: unknown): void;
}

/**
 * Mock axios client that only answers routes registered in tests/contracts/registry.ts,
 * serving their contract-checked fixtures. Overrides are validated against the spec when served.
 */
export function createContractHttpClient(service: ServiceId): ContractHttpClient {
  const failures = new Map<string, unknown>();
  const unchecked = new Map<string, unknown>();
  const overrides = new Map<string, OverrideBody>();

  const routeFor = (path: string): ContractRoute => {
    const route = findRoute(service, 'get', path);
    if (!route) {
      throw new Error(`No contract route for GET ${path} (${service})`);
    }
    return route;
  };

  const resolve = (path: string, params: Params): unknown => {
    const route = routeFor(path);
    if (failures.has(route.path)) {
      throw failures.get(route.path);
    }
    if (unchecked.has(route.path)) {
      return structuredClone(unchecked.get(route.path));
    }
    if (overrides.has(route.path)) {
      const override = overrides.get(route.path);
      const body = structuredClone(typeof override === 'function' ? override(params) : override);
      assertMatchesContract(service, 'get', path, body);
      return body;
    }
    return loadFixture(route.fixture);
  };

  const base = createMockHttpClient();
  return {
    ...base,
    get: vi.fn(async (path: string, config?: { params?: Record<string, unknown> }) => ({
      data: resolve(path, config?.params),
    })),
    override: (path, body) => overrides.set(routeFor(path).path, body),
    overrideUnchecked: (path, body) => unchecked.set(routeFor(path).path, body),
    fail: (path, error) => failures.set(routeFor(path).path, error),
  };
}
