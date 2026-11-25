import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import axios from 'axios';
import { EmbyPlugin } from '../../../src/plugins/inputs/EmbyPlugin';
import type { EmbyConfig } from '../../../src/types/inputs/emby.types';
import type { components } from '../../../src/types/generated/emby';
import { createContractHttpClient, type ContractHttpClient } from '../../fixtures/contract-http';
import { loadFixture } from '../../contracts/registry';
import type { DataPoint } from '../../../src/types/plugin.types';

vi.mock('../../../src/core/Logger', async () => {
  const { loggerMock } = await import('../../fixtures/logger');
  return loggerMock();
});

vi.mock('axios', () => ({ default: { create: vi.fn() } }));

type Session = components['schemas']['Session.SessionInfo'];

function sessions(): Session[] {
  return loadFixture<Session[]>('emby/sessions');
}

function sessionPoints(points: DataPoint[]): DataPoint[] {
  return points.filter((p) => p.tags.type === 'Session');
}

describe('EmbyPlugin', () => {
  let plugin: EmbyPlugin;
  let client: ContractHttpClient;

  const testConfig: EmbyConfig = {
    id: 1,
    url: 'http://emby.local:8096',
    apiKey: 'test-api-key',
    verifySsl: false,
    sessions: { enabled: true, intervalSeconds: 30 },
    libraries: { enabled: true, intervalSeconds: 3600 },
  };
  const sessionsOnly: EmbyConfig = { ...testConfig, libraries: { enabled: false, intervalSeconds: 3600 } };
  const librariesOnly: EmbyConfig = { ...testConfig, sessions: { enabled: false, intervalSeconds: 30 } };

  beforeEach(() => {
    vi.clearAllMocks();
    plugin = new EmbyPlugin();
    client = createContractHttpClient('emby');
    (axios.create as Mock).mockReturnValue(client);
  });

  describe('metadata', () => {
    it('exposes correct name and version', () => {
      expect(plugin.metadata.name).toBe('Emby');
      expect(plugin.metadata.version).toBe('1.0.0');
    });
  });

  describe('health', () => {
    it('should pass the health check against the contract route', async () => {
      await plugin.initialize(testConfig);

      await expect(plugin.healthCheck()).resolves.toBe(true);
      expect(client.get).toHaveBeenCalledWith('/emby/System/Info', expect.anything());
    });
  });

  describe('initialize', () => {
    it('sets X-Emby-Token header', async () => {
      await plugin.initialize(testConfig);

      expect(client.defaults.headers.common['X-Emby-Token']).toBe('test-api-key');
    });
  });

  describe('getSchedules', () => {
    it('returns enabled schedules only', async () => {
      await plugin.initialize(testConfig);

      expect(plugin.getSchedules().map((s) => s.name)).toEqual(['Emby_1_sessions', 'Emby_1_libraries']);
    });

    it('omits disabled schedules', async () => {
      await plugin.initialize(librariesOnly);

      expect(plugin.getSchedules().map((s) => s.name)).toEqual(['Emby_1_libraries']);
    });
  });

  describe('collect sessions', () => {
    beforeEach(async () => {
      await plugin.initialize(sessionsOnly);
    });

    it('emits one Session DataPoint per active stream with progress and quality', async () => {
      const [episode, movie] = sessionPoints(await plugin.collect());

      expect(episode.tags).toMatchObject({
        session_id: '6c1d2e3f4a5b46c7d8e9f0a1b2c3d4e5',
        ip_address: '192.168.1.42',
        username: 'alice',
        title: 'Severance - Good News About Hell',
        product: 'Emby for Android TV',
        platform: 'Tv',
        product_version: '2.1.07',
        quality: '1080p',
        video_decision: 'transcode',
        media_type: 'Video',
        audio_codec: 'AAC',
        player_state: 0,
        device_type: 'Tv',
        play_method: 'Transcode',
        server: 1,
      });
      expect(episode.fields.progress_percent).toBe(50);
      expect(movie.tags).toMatchObject({ title: 'Dune: Part Two', quality: '1608p', video_decision: 'direct play' });
      expect(movie.fields.progress_percent).toBe(25);
    });

    it('uses the /emby/Sessions path', async () => {
      await plugin.collect();

      expect(client.get).toHaveBeenCalledWith('/emby/Sessions', { params: undefined });
    });

    it('ignores sessions without NowPlayingItem', async () => {
      const usernames = sessionPoints(await plugin.collect()).map((p) => p.tags.username);

      expect(usernames).toEqual(['alice', 'bob']);
    });

    it('emits a summary point with stream_count and transcode_streams', async () => {
      const summary = (await plugin.collect()).find((p) => p.tags.type === 'current_stream_stats');

      expect(summary?.fields).toEqual({ stream_count: 2, transcode_streams: 1 });
    });

    it('marks paused sessions correctly', async () => {
      const [episode, movie] = sessionPoints(await plugin.collect());

      expect([episode.tags.player_state, movie.tags.player_state]).toEqual([0, 1]);
    });

    it('defaults missing session metadata to unknown', async () => {
      const [, , idle] = sessions();
      client.override('/emby/Sessions', [{ Id: idle.Id, NowPlayingItem: { Id: '31877' } }]);

      const [point] = sessionPoints(await plugin.collect());

      expect(point.tags).toMatchObject({
        ip_address: 'unknown',
        username: 'unknown',
        title: 'unknown',
        product: 'unknown',
        platform: 'unknown',
        product_version: 'unknown',
        quality: 'unknown',
        video_decision: 'direct play',
        media_type: 'unknown',
        audio_codec: 'unknown',
        device_type: 'unknown',
        play_method: 'unknown',
      });
      expect(point.fields.progress_percent).toBe(0);
    });

    it('falls back to container quality, item name and item type for movies', async () => {
      const [, bob] = sessions();
      const { Height: _h, MediaType: _m, ...item } = bob.NowPlayingItem ?? {};
      client.override('/emby/Sessions', [{ ...bob, NowPlayingItem: item }]);

      const [point] = sessionPoints(await plugin.collect());

      expect(point.tags).toMatchObject({ title: 'Dune: Part Two', quality: 'MKV', media_type: 'Movie' });
    });

    it('reports direct stream and transcode decisions with the audio codec', async () => {
      const [alice] = sessions();
      client.override('/emby/Sessions', [{ ...alice, TranscodingInfo: { ...alice.TranscodingInfo, IsVideoDirect: true } }, alice]);

      const points = sessionPoints(await plugin.collect());

      expect(points.map((p) => p.tags.video_decision)).toEqual(['direct stream', 'transcode']);
      expect(points[0].tags.audio_codec).toBe('AAC');
    });

    it('emits only an empty summary when the sessions payload is null', async () => {
      client.overrideUnchecked('/emby/Sessions', null);

      const points = await plugin.collect();

      expect(points.map((p) => p.fields)).toEqual([{ stream_count: 0, transcode_streams: 0 }]);
    });

    it('generates deterministic hash ids', async () => {
      const hashes = async (): Promise<unknown[]> => sessionPoints(await plugin.collect()).map((p) => p.fields.hash);

      const first = await hashes();

      expect(new Set(first).size).toBe(2);
      expect(await hashes()).toEqual(first);
    });
  });

  describe('collect libraries', () => {
    beforeEach(async () => {
      await plugin.initialize(librariesOnly);
    });

    it('emits a DataPoint per library plus a global item_counts summary', async () => {
      const points = await plugin.collect();
      const libraries = points.filter((p) => p.tags.type === 'library_stats');

      expect(libraries.map((p) => [p.tags.section_name, p.tags.section_type, p.fields.locations, p.fields.libraries])).toEqual([
        ['Movies', 'movies', 1, 'Movies'],
        ['Shows', 'tvshows', 2, 'Shows'],
      ]);
      expect(points.find((p) => p.tags.type === 'item_counts')?.fields).toEqual({
        movies: 812,
        series: 96,
        episodes: 4370,
        artists: 214,
        albums: 487,
        songs: 6021,
        books: 15,
        box_sets: 38,
        total: 12093,
      });
    });

    it('queries /emby/Library/VirtualFolders and /emby/Items/Counts', async () => {
      await plugin.collect();

      expect(client.get).toHaveBeenCalledWith('/emby/Library/VirtualFolders', { params: undefined });
      expect(client.get).toHaveBeenCalledWith('/emby/Items/Counts', { params: undefined });
    });

    it('falls back gracefully when /Items/Counts fails', async () => {
      client.fail('/emby/Items/Counts', new Error('counts endpoint 500'));

      const points = await plugin.collect();

      expect(points.filter((p) => p.tags.type === 'library_stats')).toHaveLength(2);
      expect(points.find((p) => p.tags.type === 'item_counts')).toBeUndefined();
    });

    it('defaults missing collection type, locations and counters', async () => {
      client.override('/emby/Library/VirtualFolders', [{ Name: 'Mixed', ItemId: '9' }]);
      client.override('/emby/Items/Counts', { MovieCount: 3 });

      const points = await plugin.collect();

      expect(points[0].tags.section_type).toBe('unknown');
      expect(points[0].fields.locations).toBe(0);
      expect(points[1].fields).toMatchObject({ movies: 3, series: 0, total: 0 });
    });

    it('emits no library points when the libraries payload is null', async () => {
      client.overrideUnchecked('/emby/Library/VirtualFolders', null);
      client.fail('/emby/Items/Counts', new Error('no counts'));

      expect(await plugin.collect()).toEqual([]);
    });
  });

  describe('collect() branches', () => {
    it('propagates sessions errors via safeFetch', async () => {
      await plugin.initialize(testConfig);
      client.fail('/emby/Sessions', new Error('emby offline'));

      await expect(plugin.collect()).rejects.toThrow('emby offline');
    });
  });
});
