/**
 * Shared test fixtures.
 *
 * Keep fixtures small and composable. Prefer returning plain objects or
 * functions over building deep mock hierarchies — tests should remain readable.
 */

export { createMockHttpClient, createMockAxios, type MockHttpClient } from './http';
export { createMockVarkenConfig, createMockGlobalConfig } from './config';
export { loggerMock } from './logger';
