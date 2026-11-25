import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import axios from 'axios';
import { PlexPlugin } from '../../../src/plugins/inputs/PlexPlugin';
import type { PlexConfig } from '../../../src/types/inputs/plex.types';
import type { paths } from '../../../src/types/generated/plex';
import { createContractHttpClient, type ContractHttpClient } from '../../fixtures/contract-http';
import { loadFixture } from '../../contracts/registry';
import type { DataPoint } from '../../../src/types/plugin.types';

vi.mock('../../../src/core/Logger', async () => {
  const { loggerMock } = await import('../../fixtures/logger');
  return loggerMock();
});

vi.mock('axios', () => ({ default: { create: vi.fn() } }));

type Root = paths['/']['get']['responses'][200]['content']['application/json'];
type Sessions = paths['/status/sessions']['get']['responses'][200]['content']['application/json'];
type Session = NonNullable<NonNullable<Sessions['MediaContainer']>['Metadata']>[number];

function sessions(): Session[] {
  return loadFixture<Sessions>('plex/status-sessions').MediaContainer?.Metadata ?? [];
}

function sessionPoints(points: DataPoint[]): DataPoint[] {
  return points.filter((p) => p.tags.type === 'Session');
}

describe('PlexPlugin', () => {
  let plugin: PlexPlugin;
  let client: ContractHttpClient;

  const testConfig: PlexConfig = {
    id: 1,
    url: 'http://plex.local:32400',
    token: 'test-token',
    verifySsl: false,
    sessions: { enabled: true, intervalSeconds: 30 },
    libraries: { enabled: true, intervalSeconds: 3600 },
    serverInfo: { enabled: false, intervalSeconds: 300 },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    plugin = new PlexPlugin();
    client = createContractHttpClient('plex');
    (axios.create as Mock).mockReturnValue(client);
  });

  describe('metadata', () => {
    it('exposes correct name and version', () => {
      expect(plugin.metadata.name).toBe('Plex');
      expect(plugin.metadata.version).toBe('1.0.0');
    });
  });

  describe('health', () => {
    it('should pass the health check against the contract route', async () => {
      await plugin.initialize(testConfig);

      await expect(plugin.healthCheck()).resolves.toBe(true);
      expect(client.get).toHaveBeenCalledWith('/identity', expect.anything());
    });
  });

  describe('initialize', () => {
    it('sets X-Plex-Token header and switches Accept to JSON', async () => {
      await plugin.initialize(testConfig);

      expect(client.defaults.headers.common['X-Plex-Token']).toBe('test-token');
      expect(client.defaults.headers.common.Accept).toBe('application/json');
    });
  });

  describe('getSchedules', () => {
    it('returns schedules for every enabled collector', async () => {
      await plugin.initialize(testConfig);

      expect(plugin.getSchedules().map((s) => [s.name, s.intervalSeconds])).toEqual([
        ['Plex_1_sessions', 30],
        ['Plex_1_libraries', 3600],
      ]);
    });

    it('omits disabled schedules', async () => {
      await plugin.initialize({ ...testConfig, libraries: { enabled: false, intervalSeconds: 3600 } });

      expect(plugin.getSchedules().map((s) => s.name)).toEqual(['Plex_1_sessions']);
    });
  });

  describe('collect sessions', () => {
    beforeEach(async () => {
      await plugin.initialize({ ...testConfig, libraries: { enabled: false, intervalSeconds: 3600 } });
    });

    it('produces a session DataPoint per active stream', async () => {
      const [episode, movie] = sessionPoints(await plugin.collect());

      expect(episode.tags).toMatchObject({
        session_id: '231',
        ip_address: '192.168.1.42',
        username: 'alice',
        title: 'Severance - Good News About Hell',
        product: 'Plex for Apple TV',
        platform: 'tvOS',
        product_version: '8.45',
        quality: '1080',
        video_decision: 'direct play',
        media_type: 'episode',
        audio_codec: 'EAC3',
        player_state: 0,
        device_type: 'tvOS',
        secure: '1',
        server: 1,
      });
      expect(episode.fields.progress_percent).toBe(50);
      expect(movie.tags).toMatchObject({
        title: 'Dune: Part Two',
        quality: '4K',
        video_decision: 'transcode',
        player_state: 1,
        secure: '0',
        audio_codec: 'TRUEHD',
      });
      expect(movie.fields.progress_percent).toBe(25);
    });

    it('summarises bandwidth and stream kinds', async () => {
      const summary = (await plugin.collect()).find((p) => p.tags.type === 'current_stream_stats');

      expect(summary?.fields).toEqual({
        stream_count: 2,
        transcode_streams: 1,
        direct_play_streams: 1,
        direct_streams: 0,
        lan_streams: 1,
        wan_streams: 1,
        total_bandwidth: 16000,
        lan_bandwidth: 12000,
        wan_bandwidth: 4000,
      });
    });

    it('enriches a direct-play session', async () => {
      const [episode] = sessionPoints(await plugin.collect());

      expect(episode.tags).toMatchObject({
        network: 'lan',
        relayed: 0,
        audio_decision: 'direct play',
        subtitle_decision: 'unknown',
        video_codec: 'H264',
        stream_video_codec: 'H264',
        stream_audio_codec: 'EAC3',
        video_resolution: '1080p',
        stream_video_resolution: '1080p',
        device_name: 'Living Room',
        device_model: 'AppleTV14,1',
        platform_version: '18.1',
        user_id: '1',
        year: 2022,
        genre: 'Thriller',
      });
      expect(episode.fields).toEqual({
        hash: expect.any(String),
        progress_percent: 50,
        bandwidth: 12000,
        source_bitrate: 10230,
        duration_seconds: 3420,
        view_offset_seconds: 1710,
      });
    });

    it('enriches a transcoded session', async () => {
      const [, movie] = sessionPoints(await plugin.collect());

      expect(movie.tags).toMatchObject({
        network: 'wan',
        relayed: 0,
        audio_decision: 'transcode',
        subtitle_decision: 'burn',
        video_codec: 'HEVC',
        stream_video_codec: 'H264',
        stream_audio_codec: 'AAC',
        video_resolution: '4K',
        stream_video_resolution: '536p',
        device_name: 'Pixel 9',
        device_model: 'unknown',
        user_id: '2',
        year: 2024,
        genre: 'Science Fiction',
      });
      expect(movie.fields).toEqual({
        hash: expect.any(String),
        progress_percent: 25,
        bandwidth: 4000,
        source_bitrate: 38500,
        duration_seconds: 9960,
        view_offset_seconds: 2490,
        transcode_speed: 2.1,
        transcode_progress: 27.4,
        transcode_throttled: 0,
        transcode_hw_requested: 1,
        transcode_hw_full_pipeline: 0,
        transcode_hw_decoding: 1,
        transcode_hw_encoding: 1,
      });
      expect(movie.floatFields).toEqual(['transcode_speed', 'transcode_progress']);
    });

    it('falls back to Player.local without a Session element', async () => {
      const [episode, movie] = sessions();
      const { Session: _a, ...localEpisode } = episode;
      const { Session: _b, ...remoteMovie } = movie;
      const { local: _c, ...unknownPlayer } = episode.Player ?? {};
      const { Session: _d, ...unknownEpisode } = { ...episode, Player: unknownPlayer };
      client.override('/status/sessions', { MediaContainer: { size: 3, Metadata: [localEpisode, remoteMovie, unknownEpisode] } });

      expect(sessionPoints(await plugin.collect()).map((p) => p.tags.network)).toEqual(['lan', 'wan', 'unknown']);
    });

    function withMovieDecisions(videoDecision: string, audioDecision: string): void {
      const [episode, movie] = sessions();
      client.override('/status/sessions', {
        MediaContainer: {
          size: 2,
          Metadata: [episode, { ...movie, TranscodeSession: { ...movie.TranscodeSession, videoDecision, audioDecision } }],
        },
      });
    }

    async function transcodeStreams(): Promise<unknown> {
      return (await plugin.collect()).find((p) => p.tags.type === 'current_stream_stats')?.fields.transcode_streams;
    }

    it('does not count a direct stream as a transcode', async () => {
      withMovieDecisions('copy', 'copy');

      expect(await transcodeStreams()).toBe(0);
    });

    it('counts an audio-only transcode', async () => {
      withMovieDecisions('copy', 'transcode');

      expect(await transcodeStreams()).toBe(1);
    });

    it('emits a zero summary when nothing is playing', async () => {
      client.override('/status/sessions', { MediaContainer: { size: 0 } });

      const points = await plugin.collect();

      expect(points.map((p) => p.fields)).toEqual([
        {
          stream_count: 0,
          transcode_streams: 0,
          direct_play_streams: 0,
          direct_streams: 0,
          lan_streams: 0,
          wan_streams: 0,
          total_bandwidth: 0,
          lan_bandwidth: 0,
          wan_bandwidth: 0,
        },
      ]);
    });

    it('maps buffering and unknown player states', async () => {
      const [episode, movie] = sessions();
      client.override('/status/sessions', {
        MediaContainer: {
          size: 2,
          Metadata: [
            { ...episode, Player: { ...episode.Player, state: 'buffering' } },
            { ...movie, Player: { ...movie.Player, state: 'stopped' } },
          ],
        },
      });

      expect(sessionPoints(await plugin.collect()).map((p) => p.tags.player_state)).toEqual([3, 0]);
    });

    it('handles sessions without Player, Media or User', async () => {
      const [episode] = sessions();
      const { Player: _p, Media: _m, User: _u, duration: _d, viewOffset: _v, ...bare } = episode;
      client.override('/status/sessions', { MediaContainer: { size: 1, Metadata: [bare] } });

      const [point] = sessionPoints(await plugin.collect());

      expect(point.tags).toMatchObject({
        ip_address: 'unknown',
        username: 'unknown',
        product: 'unknown',
        platform: 'unknown',
        product_version: 'unknown',
        quality: 'unknown',
        audio_codec: 'unknown',
        player_state: 0,
        secure: '0',
      });
      expect(point.fields.progress_percent).toBe(0);
    });

    it('falls back to the container when the resolution is unknown', async () => {
      const [episode] = sessions();
      const media = episode.Media?.map(({ videoResolution: _r, ...m }) => m);
      client.override('/status/sessions', { MediaContainer: { size: 1, Metadata: [{ ...episode, Media: media }] } });

      expect(sessionPoints(await plugin.collect())[0].tags.quality).toBe('MKV');
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
      await plugin.initialize({ ...testConfig, sessions: { enabled: false, intervalSeconds: 30 } });
    });

    it('queries /library/sections/all and fetches item count per library', async () => {
      const points = await plugin.collect();

      expect(points.map((p) => [p.tags.section_name, p.tags.section_type, p.tags.name, p.fields.total, p.fields.libraries])).toEqual([
        ['Movies', 'movie', 'Movies', 1342, 'Movies'],
        ['TV Shows', 'show', 'TV Shows', 1342, 'TV Shows'],
      ]);
      expect(client.get).toHaveBeenCalledWith('/library/sections/all', { params: undefined });
    });

    it('requests item counts with pagination headers', async () => {
      await plugin.collect();

      expect(client.get).toHaveBeenCalledWith('/library/sections/1/all', {
        params: undefined,
        headers: { 'X-Plex-Container-Start': 0, 'X-Plex-Container-Size': 0 },
      });
    });

    it('falls back to size then 0 for the item count', async () => {
      client.override('/library/sections/{sectionId}/all', (_params, path) =>
        path.startsWith('/library/sections/1/') ? { MediaContainer: { size: 7 } } : { MediaContainer: {} }
      );

      expect((await plugin.collect()).map((p) => p.fields.total)).toEqual([7, 0]);
    });

    it('returns 0 count when the per-library endpoint fails', async () => {
      client.fail('/library/sections/{sectionId}/all', new Error('boom'));

      expect((await plugin.collect()).map((p) => p.fields.total)).toEqual([0, 0]);
    });

    it('handles a server without libraries', async () => {
      client.override('/library/sections/all', { MediaContainer: { size: 0 } });

      expect(await plugin.collect()).toEqual([]);
    });
  });

  describe('collect() branches', () => {
    it('skips sessions when disabled', async () => {
      await plugin.initialize({ ...testConfig, sessions: { enabled: false, intervalSeconds: 30 } });

      const points = await plugin.collect();

      expect(points.every((p) => p.tags.type !== 'Session')).toBe(true);
      expect(client.get).not.toHaveBeenCalledWith('/status/sessions', expect.anything());
    });

    it('propagates errors from sessions fetch (safeFetch re-throws)', async () => {
      await plugin.initialize(testConfig);
      client.fail('/status/sessions', new Error('plex offline'));

      await expect(plugin.collect()).rejects.toThrow('plex offline');
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
        measurement: 'Plex',
        tags: { type: 'ServerInfo', server: 1, version: '1.42.2.10156-f737b826c', platform: 'Linux', remote_access: 'mapped' },
        fields: { update_available: 1, active_transcodes: 1 },
      });
    });

    it('reports no update when the updater lists no release', async () => {
      client.override('/updater/status', { MediaContainer: { canInstall: false, checkedAt: 1764050000, status: 0 } });

      const [point] = await plugin.collect();

      expect(point.fields.update_available).toBe(0);
    });

    it('omits active transcodes and remote access the server does not report', async () => {
      const root = loadFixture<Root>('plex/root');
      const { transcoderActiveVideoSessions: _t, myPlexMappingState: _m, ...server } = root.MediaContainer ?? {};
      client.override('/', { MediaContainer: server });

      const [point] = await plugin.collect();

      expect(point.fields).not.toHaveProperty('active_transcodes');
      expect(point.tags.remote_access).toBe('unknown');
    });

    it('schedules serverInfo when enabled', () => {
      expect(plugin.getSchedules().map((s) => s.name)).toEqual(['Plex_1_serverInfo']);
    });
  });
});
