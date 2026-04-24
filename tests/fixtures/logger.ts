import { vi } from 'vitest';

/**
 * Ready-made factory for `vi.mock('<path>/core/Logger', loggerMock)`.
 *
 * Returns a fresh set of spy functions each time so mock assertions don't
 * leak between test files. `withContext` is a pass-through — it returns the
 * same logger so tagged loggers behave identically to the base one in tests.
 */
export const loggerMock = (): {
  createLogger: () => Record<'info' | 'debug' | 'warn' | 'error', ReturnType<typeof vi.fn>>;
  withContext: (logger: unknown) => unknown;
} => ({
  createLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
  withContext: (logger: unknown) => logger,
});
