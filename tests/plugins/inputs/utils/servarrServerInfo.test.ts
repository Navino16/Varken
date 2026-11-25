import { describe, it, expect } from 'vitest';
import { servarrServerInfo } from '../../../../src/plugins/inputs/utils/servarrServerInfo';

const now = new Date('2026-11-24T10:00:00Z');
const status = { version: '4.0.20.3014', branch: 'main', startTime: '2026-11-24T08:00:00Z' };

describe('servarrServerInfo', () => {
  it('tags version and branch and measures uptime', () => {
    const { tags, fields } = servarrServerInfo(status, [], [], now);

    expect(tags).toEqual({ version: '4.0.20.3014', branch: 'main' });
    expect(fields.uptime_seconds).toBe(7200);
  });

  it('counts health issues by type', () => {
    const health = [{ type: 'error' as const }, { type: 'warning' as const }, { type: 'warning' as const }, { type: 'ok' as const }];

    const { fields } = servarrServerInfo(status, [], health, now);

    expect(fields).toMatchObject({ health_errors: 1, health_warnings: 2, health_notices: 0 });
  });

  it('flags an installable release that is not installed', () => {
    const updates = [{ installed: false, installable: true }, { installed: true, installable: false }];

    expect(servarrServerInfo(status, updates, [], now).fields.update_available).toBe(1);
  });

  it('reports no update when only installed or older releases are listed', () => {
    const updates = [{ installed: true, installable: false }, { installed: false, installable: false }];

    expect(servarrServerInfo(status, updates, [], now).fields.update_available).toBe(0);
  });

  it('falls back to unknown labels and omits uptime without a start time', () => {
    const { tags, fields } = servarrServerInfo({ version: null }, [], [], now);

    expect(tags).toEqual({ version: 'unknown', branch: 'unknown' });
    expect(fields).not.toHaveProperty('uptime_seconds');
  });
});
