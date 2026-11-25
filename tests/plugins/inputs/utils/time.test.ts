import { describe, it, expect } from 'vitest';
import { ageSeconds, dotnetTime } from '../../../../src/plugins/inputs/utils/time';

const now = new Date('2026-11-25T10:00:00Z');

describe('dotnetTime', () => {
  it('parses ISO times and treats DateTime.MinValue and garbage as absent', () => {
    expect(dotnetTime('2026-11-25T10:00:00Z')).toBe(now.getTime());
    expect(dotnetTime('0001-01-01T00:00:00Z')).toBeUndefined();
    expect(dotnetTime('garbage')).toBeUndefined();
    expect(dotnetTime(null)).toBeUndefined();
  });
});

describe('ageSeconds', () => {
  it('floors the seconds elapsed since a time', () => {
    expect(ageSeconds(now.getTime() - 90_500, now)).toBe(90);
  });

  it('is undefined without a time', () => {
    expect(ageSeconds(undefined, now)).toBeUndefined();
  });
});
