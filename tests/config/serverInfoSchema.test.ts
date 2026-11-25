import { describe, it, expect } from 'vitest';
import {
  BazarrConfigSchema,
  EmbyConfigSchema,
  JellyfinConfigSchema,
  LidarrConfigSchema,
  OmbiConfigSchema,
  OverseerrConfigSchema,
  PlexConfigSchema,
  ProwlarrConfigSchema,
  RadarrConfigSchema,
  ReadarrConfigSchema,
  SonarrConfigSchema,
  TautulliConfigSchema,
} from '../../src/config/schemas/config.schema';

const base = { id: 1, url: 'http://service.local', apiKey: 'key', token: 'token' };

const schemas = {
  sonarr: SonarrConfigSchema,
  radarr: RadarrConfigSchema,
  readarr: ReadarrConfigSchema,
  lidarr: LidarrConfigSchema,
  prowlarr: ProwlarrConfigSchema,
  bazarr: BazarrConfigSchema,
  tautulli: TautulliConfigSchema,
  plex: PlexConfigSchema,
  jellyfin: JellyfinConfigSchema,
  emby: EmbyConfigSchema,
  ombi: OmbiConfigSchema,
  overseerr: OverseerrConfigSchema,
};

describe('serverInfo schedule key', () => {
  it.each(Object.entries(schemas))('defaults %s serverInfo to disabled every 300s', (_name, schema) => {
    expect(schema.parse(base).serverInfo).toEqual({ enabled: false, intervalSeconds: 300 });
  });
});
