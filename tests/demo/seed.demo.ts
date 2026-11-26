import { it, vi } from 'vitest';
import { OUTPUT_TYPES, createOutputs, type OutputType } from '../integration/setup';
import { seedDemo } from './seed';

vi.mock('../../src/core/Logger', async () => {
  const { loggerMock } = await import('../fixtures/logger');
  return loggerMock();
});

function selectedOutputs(): OutputType[] {
  const raw = process.env.DEMO_OUTPUTS?.trim();
  if (!raw) {
    return [...OUTPUT_TYPES];
  }
  const types = raw.split(',').map((type) => type.trim());
  const unknown = types.filter((type) => !OUTPUT_TYPES.includes(type as OutputType));
  if (unknown.length > 0) {
    throw new Error(`Unknown DEMO_OUTPUTS: ${unknown.join(', ')} (expected ${OUTPUT_TYPES.join(', ')})`);
  }
  return types as OutputType[];
}

function positiveNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  const value = raw === undefined || raw === '' ? fallback : Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a positive number, got "${raw}"`);
  }
  return value;
}

it('seeds the demo dataset', async () => {
  const days = positiveNumber('DEMO_DAYS', 30);
  const stepSeconds = positiveNumber('DEMO_STEP_SECONDS', 600);
  const outputs = await createOutputs(selectedOutputs());
  let lastTenth = -1;
  try {
    const summary = await seedDemo({
      outputs,
      days,
      stepSeconds,
      onStep: (step, steps) => {
        const tenth = Math.floor((step / steps) * 10);
        if (tenth !== lastTenth) {
          lastTenth = tenth;
          console.log(`[demo] ${tenth * 10}% (${step}/${steps} steps)`);
        }
      },
    });
    console.log(
      `[demo] ${summary.points} points from ${summary.start.toISOString()} to ${summary.end.toISOString()} ` +
        `written to ${[...outputs.keys()].join(', ')} (${summary.measurements.length} measurements)`
    );
  } finally {
    await Promise.all([...outputs.values()].map((output) => output.shutdown()));
  }
});
