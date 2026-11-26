import { defineConfig } from 'vitest/config';

/** `npm run demo:seed`: fills the databases of `docker-compose.test.yaml` with the demo dataset (tests/demo/seed.ts). */
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/demo/seed.demo.ts'],
    testTimeout: 0,
    silent: false,
    hookTimeout: 60_000,
  },
  resolve: {
    alias: {
      '@': './src',
    },
  },
});
