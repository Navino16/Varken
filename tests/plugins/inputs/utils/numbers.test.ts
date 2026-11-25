import { describe, it, expect } from 'vitest';
import { isNumber, pickNumbers } from '../../../../src/plugins/inputs/utils/numbers';

describe('pickNumbers', () => {
  it('renames finite numbers and skips the rest', () => {
    expect(pickNumbers({ a: 1, b: Number.NaN, c: '3', d: 2.5, e: undefined }, { a: 'x', b: 'y', c: 'z', d: 'w', e: 'v' })).toEqual({ x: 1, w: 2.5 });
    expect(pickNumbers<{ a: number }>(null, { a: 'x' })).toEqual({});
  });
});

describe('isNumber', () => {
  it('accepts finite numbers only', () => {
    expect([1, 0, -2.5, Number.NaN, Number.POSITIVE_INFINITY, '1', null].map(isNumber)).toEqual([true, true, true, false, false, false, false]);
  });
});
