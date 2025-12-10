import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    coverage: {
      provider: 'v8',
      reportsDirectory: '.reports/coverage',
      reporter: ['text', 'json', 'html', 'cobertura'],
      exclude: ['node_modules/', 'dist/', '_legacy/', 'tests/', 'src/types/**', '*.config.js', '*.config.ts' ],
    },
    reporters: ['default', 'junit'],
    outputFile: {
      junit: '.reports/junit.xml',
    },
    include: ['tests/**/*.test.ts'],
  },
  resolve: {
    alias: {
      '@': './src',
    },
  },
});
