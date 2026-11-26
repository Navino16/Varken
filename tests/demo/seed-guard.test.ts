import { it, expect, vi } from 'vitest';
import type { OutputPlugin } from '../../src/types/plugin.types';
import { seedDemo } from './seed';

vi.mock('../../src/core/Logger', async () => {
  const { loggerMock } = await import('../fixtures/logger');
  return loggerMock();
});

vi.mock('./timeline', async (importOriginal) => {
  const timeline = await importOriginal<typeof import('./timeline')>();
  return {
    ...timeline,
    eventsIn: (...args: Parameters<typeof timeline.eventsIn>) => timeline.eventsIn(...args).map((event) => ({ ...event, at: event.at + 3_600_000 })),
  };
});

const noop: OutputPlugin = {
  metadata: { name: 'Noop', version: '1.0.0', description: 'Discards points' },
  initialize: async () => undefined,
  write: async () => undefined,
  healthCheck: async () => true,
  shutdown: async () => undefined,
};

it('rejects a point dated after the simulated time, which would push event marks ahead', async () => {
  await expect(seedDemo({ outputs: new Map([['noop', noop]]), end: new Date('2026-12-02T12:00:00Z'), days: 1, stepSeconds: 3600 })).rejects.toThrow(
    /dated after the simulated time/
  );
});
