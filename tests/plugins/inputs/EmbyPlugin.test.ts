import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
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

type SystemInfo = components['schemas']['SystemInfo'];
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
    serverInfo: { enabled: false, intervalSeconds: 300 },
    status: { enabled: false, intervalSeconds: 300 },
    history: { enabled: false, intervalSeconds: 300 },
    inventory: { enabled: false, intervalSeconds: 3600 },
    liveTv: { enabled: false, intervalSeconds: 300 },
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

      expect(summary?.fields).toMatchObject({ stream_count: 2, transcode_streams: 1 });
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

    it('reports the source audio codec on direct play', async () => {
      const [, bob] = sessions();
      client.override('/emby/Sessions', [
        {
          ...bob,
          NowPlayingItem: {
            ...bob.NowPlayingItem,
            MediaStreams: [
              { Type: 'Video', Index: 0, Codec: 'hevc' },
              { Type: 'Audio', Index: 1, Codec: 'truehd' },
            ],
          },
          PlayState: { ...bob.PlayState, AudioStreamIndex: 1 },
        },
      ]);

      const [point] = sessionPoints(await plugin.collect());

      expect(point.tags.audio_codec).toBe('TRUEHD');
    });

    it('reports the source audio codec while transcoding', async () => {
      const [alice] = sessions();
      client.override('/emby/Sessions', [
        { ...alice, NowPlayingItem: { ...alice.NowPlayingItem, MediaStreams: [{ Type: 'Audio', Index: 1, Codec: 'eac3' }] } },
      ]);

      const [point] = sessionPoints(await plugin.collect());

      expect(point.tags.audio_codec).toBe('EAC3');
    });

    it('does not count a remux as a transcode', async () => {
      const [alice, bob] = sessions();
      client.override('/emby/Sessions', [
        { ...alice, TranscodingInfo: { ...alice.TranscodingInfo, IsVideoDirect: true, IsAudioDirect: true } },
        bob,
      ]);

      const summary = (await plugin.collect()).find((p) => p.tags.type === 'current_stream_stats');

      expect(summary?.fields).toMatchObject({ stream_count: 2, transcode_streams: 0 });
    });

    it('emits only an empty summary when the sessions payload is null', async () => {
      client.overrideUnchecked('/emby/Sessions', null);

      const points = await plugin.collect();

      expect(points).toHaveLength(1);
      expect(points[0].fields).toMatchObject({ stream_count: 0, transcode_streams: 0, connected_clients: 0 });
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
      expect(points.find((p) => p.tags.type === 'item_counts')?.fields).toMatchObject({
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
  describe('session details', () => {
    beforeEach(async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2026-11-24T20:41:12Z'));
      await plugin.initialize(sessionsOnly);
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('enriches sessions', async () => {
      const [episode, movie] = sessionPoints(await plugin.collect());

      expect(episode.tags).toMatchObject({
        network: 'lan',
        audio_decision: 'transcode',
        transcode_reasons: 'AudioCodecNotSupported,VideoCodecNotSupported',
        stream_video_codec: 'H264',
        stream_audio_codec: 'AAC',
        stream_video_resolution: '1080p',
        device_name: 'Living Room TV',
        user_id: 'e1f2a3b4c5d64e7f8a9b0c1d2e3f4a5b',
        year: 2022,
        genre: 'Thriller',
        content_rating: 'TV-MA',
      });
      expect(episode.fields).toMatchObject({
        duration_seconds: 3420,
        view_offset_seconds: 1710,
        stream_bitrate: 8000,
        stream_framerate: 23.976,
        transcode_progress: 12.5,
        community_rating: 8.7,
      });
      expect(episode.floatFields).toEqual(expect.arrayContaining(['stream_framerate', 'transcode_progress', 'community_rating']));
      expect(movie.tags).toMatchObject({
        network: 'wan',
        audio_decision: 'direct play',
        transcode_reasons: 'none',
        video_codec: 'HEVC',
        stream_video_codec: 'HEVC',
        stream_audio_codec: 'TRUEHD',
        genre: 'Science Fiction',
      });
      expect(movie.fields).not.toHaveProperty('stream_bitrate');
    });

    it('summarises connected clients and stream kinds', async () => {
      const summary = (await plugin.collect()).find((p) => p.tags.type === 'current_stream_stats');

      expect(summary?.fields).toEqual({
        stream_count: 2,
        transcode_streams: 1,
        connected_clients: 4,
        connected_users: 3,
        streaming_users: 2,
        direct_play_streams: 1,
        direct_streams: 0,
        lan_streams: 1,
        wan_streams: 1,
      });
    });

    it('adds Emby-only transcoding details', async () => {
      const [episode, movie] = sessionPoints(await plugin.collect());

      expect(episode.fields).toMatchObject({ video_decoder_hw: 1, video_encoder_hw: 0, transcode_cpu_percent: 37.5 });
      expect(episode.floatFields).toContain('transcode_cpu_percent');
      expect(movie.fields).not.toHaveProperty('transcode_cpu_percent');
      expect(movie.fields).not.toHaveProperty('video_decoder_hw');
      expect(movie.fields).not.toHaveProperty('video_encoder_hw');
    });

  });

  describe('library details', () => {
    beforeEach(async () => {
      await plugin.initialize(librariesOnly);
    });

    it('counts music videos, programs, trailers and games', async () => {
      const counts = (await plugin.collect()).find((p) => p.tags.type === 'item_counts');

      expect(counts?.fields).toEqual({ movies: 812, series: 96, episodes: 4370, artists: 214, albums: 487, songs: 6021, books: 15, box_sets: 38, total: 12093, music_videos: 12, programs: 3, trailers: 40, games: 5, game_systems: 1 });
    });

    it('reports library refresh state', async () => {
      const [movies, shows] = (await plugin.collect()).filter((p) => p.tags.type === 'library_stats');

      expect(movies.tags.refresh_status).toBe('Idle');
      expect(movies.fields).not.toHaveProperty('refresh_progress');
      expect(shows.tags.refresh_status).toBe('Active');
      expect(shows.fields.refresh_progress).toBe(42.5);
      expect(shows.floatFields).toEqual(['refresh_progress']);
    });
  });

  describe('server info', () => {
    beforeEach(async () => {
      await plugin.initialize({
        ...testConfig,
        sessions: { enabled: false, intervalSeconds: 30 },
        libraries: { enabled: false, intervalSeconds: 3600 },
        serverInfo: { enabled: true, intervalSeconds: 300 },
      });
    });

    it('collects server info', async () => {
      const points = await plugin.collect();

      expect(points).toHaveLength(1);
      expect(points[0]).toMatchObject({
        measurement: 'Emby',
        tags: { type: 'ServerInfo', server: 1, version: '4.10.2.0' },
        fields: { update_available: 0, restart_pending: 0, shutting_down: 0, maintenance_mode: 0, },
      });
    });

    it('omits flags the server does not report', async () => {
      const { HasUpdateAvailable: _update, ...info } = loadFixture<SystemInfo>('emby/system-info');
      client.override('/emby/System/Info', info);

      const [point] = await plugin.collect();

      expect(point.fields).not.toHaveProperty('update_available');
    });

    it('schedules serverInfo when enabled', () => {
      expect(plugin.getSchedules().map((s) => s.name)).toEqual(['Emby_1_serverInfo']);
    });
  });
});
