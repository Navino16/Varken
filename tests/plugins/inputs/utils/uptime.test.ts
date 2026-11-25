import { describe, it, expect } from 'vitest';
import { uptimeSeconds } from '../../../../src/plugins/inputs/utils/uptime';

const now = new Date('2026-11-25T10:05:00Z');

describe('uptimeSeconds', () => {
  it('measures uptime from an ISO start time', () => {
    expect(uptimeSeconds('2026-11-25T10:00:00Z', now)).toBe(300);
  });

  it('measures uptime from epoch seconds', () => {
    expect(uptimeSeconds(Date.parse('2026-11-25T10:00:00Z') / 1000, now)).toBe(300);
  });

  it('is undefined for an absent, unparsable or future start time', () => {
    expect(uptimeSeconds(undefined, now)).toBeUndefined();
    expect(uptimeSeconds(null, now)).toBeUndefined();
    expect(uptimeSeconds('garbage', now)).toBeUndefined();
    expect(uptimeSeconds('2026-11-25T11:00:00Z', now)).toBeUndefined();
  });
});
