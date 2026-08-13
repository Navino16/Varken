import { vi, type Mock } from 'vitest';

export interface MockHttpClient {
  get: Mock;
  post: Mock;
  defaults: { headers: { common: Record<string, string> } };
  interceptors: {
    request: { use: Mock };
    response: { use: Mock };
  };
}

/**
 * Shape of a minimal axios-like HTTP client used across plugin tests.
 * Each call returns a fresh object so mocks don't leak between tests.
 */
export function createMockHttpClient(): MockHttpClient {
  return {
    get: vi.fn(),
    post: vi.fn(),
    defaults: { headers: { common: {} } },
    interceptors: {
      request: { use: vi.fn() },
      response: { use: vi.fn() },
    },
  };
}

/**
 * Mock factory for `vi.mock('axios', …)`. Returns a getter so Vitest can read
 * it lazily when the module is imported under test.
 */
export function createMockAxios(client: MockHttpClient = createMockHttpClient()): {
  default: { create: Mock };
} {
  return {
    default: {
      create: vi.fn(() => client),
    },
  };
}
