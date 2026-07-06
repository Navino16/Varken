import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    coverage: {
      provider: 'v8',
      reportsDirectory: '.reports/coverage',
      reporter: ['text', 'json', 'html', 'cobertura'],
      include: ['src/**/*.ts'],
      exclude: ['src/types/**'],
      thresholds: {
        global: { lines: 80, functions: 780, branches: 80, statements: 80 },
      },
    },
    reporters: ['default', 'junit'],
    outputFile: {
      junit: '.reports/junit.xml',
    },
    include: ['tests/**/*.test.ts'],
    exclude: ['tests/integration/**', 'node_modules/**', 'dist/**'],
  },
  resolve: {
    alias: {
      '@': './src',
    },
  },
});
