import { describe, it, expect } from 'vitest';
import { EmbyConfigSchema, JellyfinConfigSchema, PlexConfigSchema, TautulliConfigSchema } from '../../src/config/schemas/config.schema';

describe('Media server schedule keys', () => {
  it.each([
    ['plex', PlexConfigSchema, { id: 1, url: 'http://plex.local', token: 'token' }],
    ['jellyfin', JellyfinConfigSchema, { id: 1, url: 'http://jellyfin.local', apiKey: 'key' }],
    ['emby', EmbyConfigSchema, { id: 1, url: 'http://emby.local', apiKey: 'key' }],
  ] as const)('defaults %s status/history/inventory/liveTv to disabled', (_name, schema, base) => {
    const config = schema.parse(base);

    expect(config.status).toEqual({ enabled: false, intervalSeconds: 300 });
    expect(config.history).toEqual({ enabled: false, intervalSeconds: 300 });
    expect(config.inventory).toEqual({ enabled: false, intervalSeconds: 3600 });
    expect(config.liveTv).toEqual({ enabled: false, intervalSeconds: 300 });
  });
});

describe('Tautulli schedule keys', () => {
  it('defaults history, users and libraryMedia to disabled', () => {
    const config = TautulliConfigSchema.parse({ id: 1, url: 'http://tautulli.local', apiKey: 'key' });

    expect(config.history).toEqual({ enabled: false, intervalSeconds: 300 });
    expect(config.users).toEqual({ enabled: false, intervalSeconds: 3600 });
    expect(config.libraryMedia).toEqual({ enabled: false, intervalDays: 1 });
    expect(config.stats).toEqual({ enabled: false, intervalSeconds: 30 });
  });
});
