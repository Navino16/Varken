import { describe, it, expect } from 'vitest';
import { booleanFlags } from '../../../../src/plugins/inputs/utils/flags';

describe('booleanFlags', () => {
  it('turns booleans into 0/1 fields and omits unknown flags', () => {
    expect(booleanFlags({ update_available: true, restart_pending: false, shutting_down: undefined, maintenance_mode: null })).toEqual({
      update_available: 1,
      restart_pending: 0,
    });
  });
});
