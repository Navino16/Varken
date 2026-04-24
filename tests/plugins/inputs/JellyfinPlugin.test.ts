import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { JellyfinPlugin } from '../../../src/plugins/inputs/JellyfinPlugin';
import type { JellyfinConfig, JellyfinSession } from '../../../src/types/inputs/jellyfin.types';
import axios from 'axios';
import { createMockHttpClient, type MockHttpClient } from '../../fixtures/http';

vi.mock('../../../src/core/Logger', async () => {
  const { loggerMock } = await import('../../fixtures/logger');
  return loggerMock();
});

vi.mock('axios', () => ({ default: { create: vi.fn() } }));

const baseSession: JellyfinSession = {
  Id: 'sess1',
  ServerId: 'srv',
  UserId: 'u1',
  UserName: 'alice',
  Client: 'Jellyfin Web',
  DeviceId: 'dev1',
  DeviceName: 'Firefox',
  DeviceType: 'Web',
  RemoteEndPoint: '10.0.0.1',
  ApplicationVersion: '10.9.0',
  IsActive: true,
  SupportsRemoteControl: false,
  SupportsMediaControl: true,
  LastActivityDate: '2026-04-24T00:00:00Z',
  LastPlaybackCheckIn: '2026-04-24T00:00:00Z',
  PlayState: {
    PositionTicks: 2_500_000_000, // 250s
    CanSeek: true,
    IsPaused: false,
    IsMuted: false,
    PlayMethod: 'DirectPlay',
    RepeatMode: 'RepeatNone',
  },
  NowPlayingItem: {
    Id: 'item1',
    ServerId: 'srv',
    Name: 'Pilot',
    Type: 'Episode',
    MediaType: 'Video',
    RunTimeTicks: 10_000_000_000, // 1000s
    SeriesName: 'Some Show',
    Height: 1080,
    Container: 'mkv',
  },
};

describe('JellyfinPlugin', () => {
  let plugin: JellyfinPlugin;
  let mockHttpClient: MockHttpClient;

  const testConfig: JellyfinConfig = {
    id: 1,
    url: 'http://jellyfin.local:8096',
    apiKey: 'test-api-key',
    verifySsl: false,
    sessions: { enabled: true, intervalSeconds: 30 },
    libraries: { enabled: true, intervalSeconds: 3600 },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    plugin = new JellyfinPlugin();
    mockHttpClient = createMockHttpClient();
    (axios.create as Mock).mockReturnValue(mockHttpClient);
  });

  describe('metadata', () => {
    it('exposes correct name and version', () => {
      expect(plugin.metadata.name).toBe('Jellyfin');
      expect(plugin.metadata.version).toBe('1.0.0');
    });
  });

  describe('initialize', () => {
    it('sets X-Emby-Token header', async () => {
      await plugin.initialize(testConfig);
      expect(mockHttpClient.defaults.headers.common['X-Emby-Token']).toBe('test-api-key');
    });
  });

  describe('getSchedules', () => {
    it('returns enabled schedules only', async () => {
      await plugin.initialize(testConfig);
      const schedules = plugin.getSchedules();
      expect(schedules.map((s) => s.name)).toEqual(['Jellyfin_1_sessions', 'Jellyfin_1_libraries']);
    });

    it('omits disabled schedules', async () => {
      await plugin.initialize({ ...testConfig, sessions: { enabled: false, intervalSeconds: 30 } });
      const schedules = plugin.getSchedules();
      expect(schedules).toHaveLength(1);
      expect(schedules[0].name).toBe('Jellyfin_1_libraries');
    });
  });

  describe('collect sessions', () => {
    beforeEach(async () => {
      await plugin.initialize({ ...testConfig, libraries: { enabled: false, intervalSeconds: 3600 } });
    });

    it('emits one Session DataPoint per active stream with progress and quality', async () => {
      mockHttpClient.get.mockResolvedValueOnce({ data: [baseSession] });

      const points = await plugin.collect();
      const session = points.find((p) => p.tags.type === 'Session');

      expect(session).toBeDefined();
      expect(session?.tags.username).toBe('alice');
      expect(session?.tags.title).toBe('Some Show - Pilot');
      expect(session?.tags.quality).toBe('1080p');
      expect(session?.fields.progress_percent).toBe(25);
    });

    it('ignores sessions without NowPlayingItem', async () => {
      const idleSession = { ...baseSession, NowPlayingItem: undefined, Id: 'idle' };
      mockHttpClient.get.mockResolvedValueOnce({ data: [idleSession, baseSession] });

      const points = await plugin.collect();
      const sessionPoints = points.filter((p) => p.tags.type === 'Session');
      expect(sessionPoints).toHaveLength(1);
    });

    it('emits a summary point with stream_count and transcode_streams', async () => {
      const transcoding = {
        ...baseSession,
        Id: 'sess2',
        TranscodingInfo: {
          AudioCodec: 'aac',
          VideoCodec: 'h264',
          Container: 'ts',
          IsVideoDirect: false,
          IsAudioDirect: true,
          Bitrate: 5000000,
          Width: 1280,
          Height: 720,
          AudioChannels: 2,
          TranscodeReasons: ['VideoCodecNotSupported'],
        },
      };
      mockHttpClient.get.mockResolvedValueOnce({ data: [baseSession, transcoding] });

      const points = await plugin.collect();
      const summary = points.find((p) => p.tags.type === 'current_stream_stats');
      expect(summary?.fields.stream_count).toBe(2);
      expect(summary?.fields.transcode_streams).toBe(1);
    });

    it('marks paused sessions correctly', async () => {
      const paused = {
        ...baseSession,
        PlayState: { ...baseSession.PlayState!, IsPaused: true },
      };
      mockHttpClient.get.mockResolvedValueOnce({ data: [paused] });

      const points = await plugin.collect();
      const session = points.find((p) => p.tags.type === 'Session');
      expect(session?.tags.player_state).toBe(1);
    });
  });

  describe('collect libraries', () => {
    beforeEach(async () => {
      await plugin.initialize({ ...testConfig, sessions: { enabled: false, intervalSeconds: 30 } });
    });

    it('emits a DataPoint per library plus a global item_counts summary', async () => {
      mockHttpClient.get
        .mockResolvedValueOnce({
          data: [
            { Name: 'Movies', CollectionType: 'movies', LibraryOptions: {}, ItemId: 'a', Locations: ['/m'] },
            { Name: 'TV Shows', CollectionType: 'tvshows', LibraryOptions: {}, ItemId: 'b', Locations: ['/tv'] },
          ],
        })
        .mockResolvedValueOnce({
          data: {
            MovieCount: 500,
            SeriesCount: 50,
            EpisodeCount: 1000,
            ArtistCount: 0,
            ProgramCount: 0,
            TrailerCount: 0,
            SongCount: 0,
            AlbumCount: 0,
            MusicVideoCount: 0,
            BoxSetCount: 5,
            BookCount: 0,
            ItemCount: 1555,
          },
        });

      const points = await plugin.collect();
      const libPoints = points.filter((p) => p.tags.type === 'library_stats');
      const summary = points.find((p) => p.tags.type === 'item_counts');

      expect(libPoints).toHaveLength(2);
      expect(libPoints[0].tags.section_name).toBe('Movies');
      expect(summary?.fields.movies).toBe(500);
      expect(summary?.fields.total).toBe(1555);
    });

    it('falls back gracefully when /Items/Counts fails', async () => {
      mockHttpClient.get
        .mockResolvedValueOnce({
          data: [{ Name: 'Movies', CollectionType: 'movies', LibraryOptions: {}, ItemId: 'a', Locations: [] }],
        })
        .mockRejectedValueOnce(new Error('counts endpoint 500'));

      const points = await plugin.collect();
      const libPoints = points.filter((p) => p.tags.type === 'library_stats');
      const summary = points.find((p) => p.tags.type === 'item_counts');

      expect(libPoints).toHaveLength(1);
      expect(summary).toBeUndefined();
    });
  });

  describe('collect() branches', () => {
    it('propagates sessions errors via safeFetch', async () => {
      await plugin.initialize(testConfig);
      mockHttpClient.get.mockRejectedValueOnce(new Error('jellyfin offline'));
      await expect(plugin.collect()).rejects.toThrow('jellyfin offline');
    });
  });
});
