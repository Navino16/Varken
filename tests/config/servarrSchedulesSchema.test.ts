import { describe, it, expect } from 'vitest';
import {
  LidarrConfigSchema,
  ProwlarrConfigSchema,
  RadarrConfigSchema,
  ReadarrConfigSchema,
  SonarrConfigSchema,
} from '../../src/config/schemas/config.schema';

const base = { id: 1, url: 'http://service.local', apiKey: 'key' };

describe('Servarr schedule keys', () => {
  it.each(Object.entries({ sonarr: SonarrConfigSchema, radarr: RadarrConfigSchema, lidarr: LidarrConfigSchema, readarr: ReadarrConfigSchema }))(
    'defaults %s status/totals/history/library to disabled',
    (_name, schema) => {
      const config = schema.parse(base);

      expect(config.status).toEqual({ enabled: false, intervalSeconds: 300 });
      expect(config.totals).toEqual({ enabled: false, intervalSeconds: 900 });
      expect(config.history).toEqual({ enabled: false, intervalSeconds: 300 });
      expect(config.library).toEqual({ enabled: false, intervalDays: 1 });
    }
  );

  it('defaults prowlarr status/history/inventory to disabled', () => {
    const config = ProwlarrConfigSchema.parse(base);

    expect(config.status).toEqual({ enabled: false, intervalSeconds: 300 });
    expect(config.history).toEqual({ enabled: false, intervalSeconds: 300 });
    expect(config.inventory).toEqual({ enabled: false, intervalSeconds: 3600 });
  });
});
