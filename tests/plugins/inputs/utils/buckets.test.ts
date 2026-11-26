import { describe, it, expect } from 'vitest';
import { bucketRange } from '../../../../src/plugins/inputs/utils/buckets';

describe('bucketRange', () => {
  it('parses day and month categories', () => {
    expect(bucketRange('2026-11-25', 'day')).toEqual({ start: Date.UTC(2026, 10, 25), end: Date.UTC(2026, 10, 26) });
    expect(bucketRange('Dec 2026', 'month')).toEqual({ start: Date.UTC(2026, 11, 1), end: Date.UTC(2027, 0, 1) });
  });

  it('rejects categories that do not parse', () => {
    expect(bucketRange('2026-02-30', 'day')).toBeUndefined();
    expect(bucketRange('25/11/2026', 'day')).toBeUndefined();
    expect(bucketRange('Okt. 2026', 'month')).toBeUndefined();
  });
});
