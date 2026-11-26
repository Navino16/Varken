import { describe, it, expect, vi } from 'vitest';
import { seedDemo } from '../demo/seed';
import { createOutputs, reachableOutputs } from './setup';
import { listMeasurements } from './readers';

vi.mock('../../src/core/Logger', async () => {
  const { loggerMock } = await import('../fixtures/logger');
  return loggerMock();
});

const reachable = await reachableOutputs();

describe.skipIf(reachable.length === 0)('demo dataset', () => {
  it('seeds every reachable output with every demo measurement', async () => {
    const outputs = await createOutputs(reachable);
    try {
      const summary = await seedDemo({ outputs, days: 1, stepSeconds: 3600 });

      for (const type of reachable) {
        const expected = type === 'victoriametrics' ? summary.numericMeasurements : summary.measurements;
        await vi.waitFor(async () => expect(await listMeasurements(type)).toEqual(expect.arrayContaining(expected)), {
          timeout: 30_000,
          interval: 1000,
        });
      }
    } finally {
      await Promise.all([...outputs.values()].map((output) => output.shutdown()));
    }
  }, 300_000);
});
