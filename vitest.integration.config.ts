import { defineConfig } from 'vitest/config';

/**
 * Integration test configuration.
 *
 * Tests here hit real services (InfluxDB, etc.) spun up via `docker-compose.test.yaml`.
 * They are excluded from the default `npm test` run and must be executed with
 * `npm run test:integration` so unit tests stay fast and hermetic.
 *
 * Individual tests detect service availability via probes in `tests/integration/setup.ts`
 * and skip themselves when dependencies aren't reachable — so this config is safe to
 * run even without docker-compose up (tests just skip).
 */
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/integration/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    reporters: ['default', 'junit'],
    outputFile: {
      junit: '.reports/junit-integration.xml',
    },
  },
  resolve: {
    alias: {
      '@': './src',
    },
  },
});
