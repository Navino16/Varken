import { describe, it, expect } from 'vitest';
import { BazarrConfigSchema, OmbiConfigSchema, OverseerrConfigSchema } from '../../src/config/schemas/config.schema';

const base = { id: 1, url: 'http://service.local', apiKey: 'key' };

describe('Request and subtitle schedule keys', () => {
  it('defaults Overseerr status, totals and users to disabled', () => {
    const config = OverseerrConfigSchema.parse(base);

    expect(config.status).toEqual({ enabled: false, intervalSeconds: 300 });
    expect(config.totals).toEqual({ enabled: false, intervalSeconds: 300 });
    expect(config.users).toEqual({ enabled: false, intervalSeconds: 3600 });
  });

  it('defaults Ombi totals and users to disabled', () => {
    const config = OmbiConfigSchema.parse(base);

    expect(config.totals).toEqual({ enabled: false, intervalSeconds: 300 });
    expect(config.users).toEqual({ enabled: false, intervalSeconds: 3600 });
  });

  it('defaults Bazarr status, stats and library to disabled', () => {
    const config = BazarrConfigSchema.parse(base);

    expect(config.status).toEqual({ enabled: false, intervalSeconds: 300 });
    expect(config.stats).toEqual({ enabled: false, intervalSeconds: 3600 });
    expect(config.library).toEqual({ enabled: false, intervalDays: 1 });
  });
});
