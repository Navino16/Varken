import { describe, it, expect } from 'vitest';
import { mapLimit } from '../../src/utils/concurrency';

describe('mapLimit', () => {
  it('keeps the input order', async () => {
    const delays = [30, 10, 20, 0];
    const result = await mapLimit(delays, 2, async (ms, index) => {
      await new Promise((resolve) => setTimeout(resolve, ms));
      return index;
    });

    expect(result).toEqual([0, 1, 2, 3]);
  });

  it('never runs more than the limit at once', async () => {
    let running = 0;
    let peak = 0;
    await mapLimit([1, 2, 3, 4, 5, 6, 7], 3, async () => {
      running += 1;
      peak = Math.max(peak, running);
      await new Promise((resolve) => setTimeout(resolve, 1));
      running -= 1;
    });

    expect(peak).toBe(3);
  });

  it('rejects with the first failure', async () => {
    await expect(
      mapLimit([1, 2, 3], 2, async (n) => {
        if (n === 2) {
          throw new Error('boom');
        }
        return n;
      })
    ).rejects.toThrow('boom');
  });
});
