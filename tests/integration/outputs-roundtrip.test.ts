import { describe, it, expect, vi } from 'vitest';
import { OUTPUT_TYPES, createOutputs, reachableOutputs } from './setup';
import { listMeasurements } from './readers';

const reachable = await reachableOutputs();

describe.each(OUTPUT_TYPES)('%s — round-trip', (type) => {
  it.skipIf(!reachable.includes(type))('lists a measurement written through the output plugin', async () => {
    const outputs = await createOutputs([type]);
    const plugin = outputs.get(type);
    const measurement = `ItRoundtrip${Date.now()}`;
    try {
      await plugin?.write([{ measurement, tags: { suite: 'roundtrip' }, fields: { value: 1 }, timestamp: new Date() }]);
      await vi.waitFor(async () => expect(await listMeasurements(type)).toContain(measurement), { timeout: 15_000, interval: 500 });
    } finally {
      await plugin?.shutdown();
    }
  });
});
