import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { EmbyPlugin } from '../../../src/plugins/inputs/EmbyPlugin';
import type { EmbyConfig, EmbySession } from '../../../src/types/inputs/emby.types';
import axios from 'axios';
import { createMockHttpClient, type MockHttpClient } from '../../fixtures/http';

vi.mock('../../../src/core/Logger', async () => {
  const { loggerMock } = await import('../../fixtures/logger');
  return loggerMock();
});

vi.mock('axios', () => ({ default: { create: vi.fn() } }));

const baseSession: EmbySession = {
  Id: 'sess1',
  ServerId: 'srv',
  UserId: 'u1',
  UserName: 'bob',
  Client: 'Emby Web',
  DeviceId: 'dev1',
  DeviceName: 'Chrome',
  DeviceType: 'Web',
  RemoteEndPoint: '10.0.0.5',
  ApplicationVersion: '4.8.0',
  IsActive: true,
  SupportsRemoteControl: false,
  SupportsMediaControl: true,
  LastActivityDate: '2026-04-24T00:00:00Z',
  LastPlaybackCheckIn: '2026-04-24T00:00:00Z',
  PlayState: {
    PositionTicks: 2_500_000_000,
    CanSeek: true,
    IsPaused: false,
    IsMuted: false,
    PlayMethod: 'DirectPlay',
    RepeatMode: 'RepeatNone',
  },
  NowPlayingItem: {
    Id: 'item1',
    ServerId: 'srv',
    Name: 'Ep 1',
    Type: 'Episode',
    MediaType: 'Video',
    RunTimeTicks: 10_000_000_000,
    SeriesName: 'Some Show',
    Height: 720,
    Container: 'mkv',
  },
};

describe('EmbyPlugin', () => {
  let plugin: EmbyPlugin;
  let mockHttpClient: MockHttpClient;

  const testConfig: EmbyConfig = {
    id: 1,
    url: 'http://emby.local:8096',
    apiKey: 'test-api-key',
    verifySsl: false,
    sessions: { enabled: true, intervalSeconds: 30 },
    libraries: { enabled: true, intervalSeconds: 3600 },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    plugin = new EmbyPlugin();
    mockHttpClient = createMockHttpClient();
    (axios.create as Mock).mockReturnValue(mockHttpClient);
  });

  describe('metadata', () => {
    it('exposes correct name and version', () => {
      expect(plugin.metadata.name).toBe('Emby');
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
    it('returns enabled schedules', async () => {
      await plugin.initialize(testConfig);
      const schedules = plugin.getSchedules();
      expect(schedules.map((s) => s.name)).toEqual(['Emby_1_sessions', 'Emby_1_libraries']);
    });

    it('omits disabled schedules', async () => {
      await plugin.initialize({ ...testConfig, sessions: { enabled: false, intervalSeconds: 30 } });
      expect(plugin.getSchedules()).toHaveLength(1);
    });
  });

  describe('collect sessions', () => {
    beforeEach(async () => {
      await plugin.initialize({ ...testConfig, libraries: { enabled: false, intervalSeconds: 3600 } });
    });

    it('uses the /emby/Sessions path', async () => {
      mockHttpClient.get.mockResolvedValueOnce({ data: [] });
      await plugin.collect();
      expect(mockHttpClient.get).toHaveBeenCalledWith('/emby/Sessions', expect.anything());
    });

    it('emits a Session DataPoint with progress %', async () => {
      mockHttpClient.get.mockResolvedValueOnce({ data: [baseSession] });
      const points = await plugin.collect();
      const session = points.find((p) => p.tags.type === 'Session');
      expect(session?.tags.username).toBe('bob');
      expect(session?.tags.title).toBe('Some Show - Ep 1');
      expect(session?.tags.quality).toBe('720p');
      expect(session?.fields.progress_percent).toBe(25);
    });

    it('ignores sessions without NowPlayingItem', async () => {
      mockHttpClient.get.mockResolvedValueOnce({
        data: [{ ...baseSession, NowPlayingItem: undefined, Id: 'idle' }, baseSession],
      });
      const points = await plugin.collect();
      expect(points.filter((p) => p.tags.type === 'Session')).toHaveLength(1);
    });

    it('counts transcode_streams in the summary', async () => {
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
          TranscodeReasons: [],
        },
      };
      mockHttpClient.get.mockResolvedValueOnce({ data: [baseSession, transcoding] });
      const points = await plugin.collect();
      const summary = points.find((p) => p.tags.type === 'current_stream_stats');
      expect(summary?.fields.stream_count).toBe(2);
      expect(summary?.fields.transcode_streams).toBe(1);
    });
  });

  describe('collect libraries', () => {
    beforeEach(async () => {
      await plugin.initialize({ ...testConfig, sessions: { enabled: false, intervalSeconds: 30 } });
    });

    it('queries /emby/Library/VirtualFolders and /emby/Items/Counts', async () => {
      mockHttpClient.get
        .mockResolvedValueOnce({
          data: [{ Name: 'Films', CollectionType: 'movies', LibraryOptions: {}, ItemId: 'a', Locations: [] }],
        })
        .mockResolvedValueOnce({
          data: {
            MovieCount: 10,
            SeriesCount: 0,
            EpisodeCount: 0,
            ArtistCount: 0,
            ProgramCount: 0,
            TrailerCount: 0,
            SongCount: 0,
            AlbumCount: 0,
            MusicVideoCount: 0,
            BoxSetCount: 0,
            BookCount: 0,
            ItemCount: 10,
          },
        });

      const points = await plugin.collect();
      expect(mockHttpClient.get).toHaveBeenNthCalledWith(1, '/emby/Library/VirtualFolders', expect.anything());
      expect(mockHttpClient.get).toHaveBeenNthCalledWith(2, '/emby/Items/Counts', expect.anything());

      expect(points.some((p) => p.tags.type === 'library_stats')).toBe(true);
      expect(points.find((p) => p.tags.type === 'item_counts')?.fields.movies).toBe(10);
    });

    it('still emits per-library points when /Items/Counts fails', async () => {
      mockHttpClient.get
        .mockResolvedValueOnce({
          data: [{ Name: 'Films', CollectionType: 'movies', LibraryOptions: {}, ItemId: 'a', Locations: [] }],
        })
        .mockRejectedValueOnce(new Error('counts 500'));

      const points = await plugin.collect();
      expect(points.filter((p) => p.tags.type === 'library_stats')).toHaveLength(1);
      expect(points.find((p) => p.tags.type === 'item_counts')).toBeUndefined();
    });
  });
});
