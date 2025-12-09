import { describe, it, expect, vi, beforeEach, Mock } from 'vitest';
import { TautulliPlugin } from '../../../src/plugins/inputs/TautulliPlugin';
import { TautulliConfig, GeoIPInfo, GeoIPLookupFn } from '../../../src/types/inputs/tautulli.types';
import axios from 'axios';

// Mock the logger
vi.mock('../../../src/core/Logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// Mock axios
vi.mock('axios', () => ({
  default: {
    create: vi.fn(() => ({
      get: vi.fn(),
      defaults: {
        headers: {
          common: {},
        },
      },
    })),
  },
}));

describe('TautulliPlugin', () => {
  let plugin: TautulliPlugin;
  let mockHttpClient: { get: Mock; defaults: { headers: { common: Record<string, string> } } };

  const testConfig: TautulliConfig = {
    id: 1,
    url: 'http://localhost:8181',
    apiKey: 'tautulli-api-key',
    ssl: false,
    verifySsl: false,
    fallbackIp: '8.8.8.8',
    activity: {
      enabled: true,
      intervalSeconds: 30,
    },
    libraries: {
      enabled: true,
      intervalDays: 1,
    },
    stats: {
      enabled: true,
      intervalSeconds: 300,
    },
    geoip: {
      enabled: true,
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    plugin = new TautulliPlugin();

    mockHttpClient = {
      get: vi.fn(),
      defaults: {
        headers: {
          common: {},
        },
      },
    };
    (axios.create as Mock).mockReturnValue(mockHttpClient);
  });

  describe('metadata', () => {
    it('should have correct metadata', () => {
      expect(plugin.metadata.name).toBe('Tautulli');
      expect(plugin.metadata.version).toBe('1.0.0');
      expect(plugin.metadata.description).toBe('Collects activity, libraries, and stats from Tautulli');
    });
  });

  describe('initialize', () => {
    it('should initialize successfully', async () => {
      await expect(plugin.initialize(testConfig)).resolves.toBeUndefined();
    });
  });

  describe('setGeoIPLookup', () => {
    it('should set the GeoIP lookup function', async () => {
      await plugin.initialize(testConfig);
      const mockLookup: GeoIPLookupFn = vi.fn().mockResolvedValue({
        latitude: 40.7128,
        longitude: -74.006,
        city: 'New York',
        region: 'NY',
      });

      plugin.setGeoIPLookup(mockLookup);

      // GeoIP function is set internally, verify it works in collect
      mockHttpClient.get.mockResolvedValueOnce({
        data: {
          response: {
            data: {
              stream_count: '1',
              total_bandwidth: 5000,
              wan_bandwidth: 3000,
              lan_bandwidth: 2000,
              stream_count_transcode: 1,
              stream_count_direct_play: 0,
              stream_count_direct_stream: 0,
              sessions: [
                {
                  session_id: 'abc123',
                  session_key: 'key1',
                  username: 'testuser',
                  ip_address_public: '1.2.3.4',
                  full_title: 'Test Movie',
                  state: 'playing',
                  transcode_decision: 'transcode',
                  video_decision: 'transcode',
                  media_type: 'movie',
                },
              ],
            },
          },
        },
      });

      // Mock libraries (disabled for this test)
      const configNoLibraries = { ...testConfig, libraries: { ...testConfig.libraries, enabled: false }, stats: { ...testConfig.stats, enabled: false } };
      await plugin.initialize(configNoLibraries);
      plugin.setGeoIPLookup(mockLookup);

      await plugin.collect();

      expect(mockLookup).toHaveBeenCalledWith('1.2.3.4');
    });
  });

  describe('getSchedules', () => {
    it('should return schedules for enabled collectors', async () => {
      await plugin.initialize(testConfig);
      const schedules = plugin.getSchedules();

      expect(schedules.length).toBe(3);
      expect(schedules.find((s) => s.name === 'Tautulli_1_activity')).toBeDefined();
      expect(schedules.find((s) => s.name === 'Tautulli_1_stats')).toBeDefined();
      expect(schedules.find((s) => s.name === 'Tautulli_1_libraries')).toBeDefined();
    });

    it('should calculate library interval in seconds from days', async () => {
      await plugin.initialize(testConfig);
      const schedules = plugin.getSchedules();

      const librarySchedule = schedules.find((s) => s.name === 'Tautulli_1_libraries');
      expect(librarySchedule?.intervalSeconds).toBe(86400); // 1 day = 86400 seconds
    });

    it('should only return activity schedule when others are disabled', async () => {
      const configActivityOnly = {
        ...testConfig,
        libraries: { ...testConfig.libraries, enabled: false },
        stats: { ...testConfig.stats, enabled: false },
      };
      await plugin.initialize(configActivityOnly);
      const schedules = plugin.getSchedules();

      expect(schedules.length).toBe(1);
      expect(schedules[0].name).toBe('Tautulli_1_activity');
    });
  });

  describe('collect', () => {
    beforeEach(async () => {
      await plugin.initialize(testConfig);
    });

    it('should collect activity data with sessions', async () => {
      mockHttpClient.get.mockResolvedValueOnce({
        data: {
          response: {
            data: {
              stream_count: '2',
              total_bandwidth: 10000,
              wan_bandwidth: 6000,
              lan_bandwidth: 4000,
              stream_count_transcode: 1,
              stream_count_direct_play: 1,
              stream_count_direct_stream: 0,
              sessions: [
                {
                  session_id: 'session1',
                  session_key: 'key1',
                  username: 'user1',
                  friendly_name: 'User One',
                  ip_address: '192.168.1.100',
                  full_title: 'Breaking Bad - S01E01 - Pilot',
                  product: 'Plex Web',
                  platform: 'windows',
                  product_version: '4.100.1',
                  state: 'playing',
                  transcode_decision: 'transcode',
                  video_decision: 'transcode',
                  media_type: 'episode',
                  audio_codec: 'aac',
                  stream_audio_codec: 'aac',
                  quality_profile: '1080p',
                  progress_percent: '45',
                  stream_video_resolution: '1080',
                  transcode_hw_decoding: 1,
                  transcode_hw_encoding: 1,
                  relayed: 0,
                  secure: '1',
                },
              ],
            },
          },
        },
      });

      // Mock libraries response
      mockHttpClient.get.mockResolvedValueOnce({
        data: {
          response: {
            data: [],
          },
        },
      });

      const points = await plugin.collect();

      // Should have session point + current_stream_stats point
      const sessionPoint = points.find((p) => p.tags.type === 'Session');
      expect(sessionPoint).toBeDefined();
      expect(sessionPoint?.tags.username).toBe('user1');
      expect(sessionPoint?.tags.platform).toBe('Windows');
      expect(sessionPoint?.tags.player_state).toBe(0); // playing = 0

      const statsPoint = points.find((p) => p.tags.type === 'current_stream_stats');
      expect(statsPoint).toBeDefined();
      expect(statsPoint?.fields.stream_count).toBe(2);
      expect(statsPoint?.fields.total_bandwidth).toBe(10000);
    });

    it('should normalize platform names', async () => {
      mockHttpClient.get.mockResolvedValueOnce({
        data: {
          response: {
            data: {
              stream_count: '1',
              total_bandwidth: 5000,
              wan_bandwidth: 3000,
              lan_bandwidth: 2000,
              stream_count_transcode: 0,
              stream_count_direct_play: 1,
              stream_count_direct_stream: 0,
              sessions: [
                {
                  session_id: 'session1',
                  session_key: 'key1',
                  username: 'user1',
                  full_title: 'Test',
                  platform: 'osx',
                  state: 'playing',
                },
              ],
            },
          },
        },
      });

      mockHttpClient.get.mockResolvedValueOnce({
        data: { response: { data: [] } },
      });

      const points = await plugin.collect();
      const sessionPoint = points.find((p) => p.tags.type === 'Session');
      expect(sessionPoint?.tags.platform).toBe('macOS');
    });

    it('should normalize transcode decisions', async () => {
      mockHttpClient.get.mockResolvedValueOnce({
        data: {
          response: {
            data: {
              stream_count: '1',
              total_bandwidth: 5000,
              wan_bandwidth: 0,
              lan_bandwidth: 5000,
              stream_count_transcode: 0,
              stream_count_direct_play: 0,
              stream_count_direct_stream: 1,
              sessions: [
                {
                  session_id: 'session1',
                  session_key: 'key1',
                  username: 'user1',
                  full_title: 'Test',
                  state: 'playing',
                  transcode_decision: 'copy',
                  video_decision: 'copy',
                },
              ],
            },
          },
        },
      });

      mockHttpClient.get.mockResolvedValueOnce({
        data: { response: { data: [] } },
      });

      const points = await plugin.collect();
      const sessionPoint = points.find((p) => p.tags.type === 'Session');
      expect(sessionPoint?.tags.transcode_decision).toBe('Direct stream');
      expect(sessionPoint?.tags.video_decision).toBe('Direct stream');
    });

    it('should map player states correctly', async () => {
      const testStates = [
        { state: 'playing', expected: 0 },
        { state: 'paused', expected: 1 },
        { state: 'buffering', expected: 3 },
        { state: 'unknown', expected: 0 },
      ];

      for (const { state, expected } of testStates) {
        mockHttpClient.get.mockResolvedValueOnce({
          data: {
            response: {
              data: {
                stream_count: '1',
                total_bandwidth: 0,
                wan_bandwidth: 0,
                lan_bandwidth: 0,
                stream_count_transcode: 0,
                stream_count_direct_play: 0,
                stream_count_direct_stream: 0,
                sessions: [
                  {
                    session_id: 'session1',
                    session_key: 'key1',
                    username: 'user1',
                    full_title: 'Test',
                    state,
                  },
                ],
              },
            },
          },
        });

        mockHttpClient.get.mockResolvedValueOnce({
          data: { response: { data: [] } },
        });

        const points = await plugin.collect();
        const sessionPoint = points.find((p) => p.tags.type === 'Session');
        expect(sessionPoint?.tags.player_state).toBe(expected);
      }
    });

    it('should collect library statistics', async () => {
      // Mock activity (empty)
      mockHttpClient.get.mockResolvedValueOnce({
        data: {
          response: {
            data: {
              stream_count: '0',
              total_bandwidth: 0,
              wan_bandwidth: 0,
              lan_bandwidth: 0,
              stream_count_transcode: 0,
              stream_count_direct_play: 0,
              stream_count_direct_stream: 0,
              sessions: [],
            },
          },
        },
      });

      // Mock libraries
      mockHttpClient.get.mockResolvedValueOnce({
        data: {
          response: {
            data: [
              {
                section_id: '1',
                section_name: 'Movies',
                section_type: 'movie',
                count: '500',
              },
              {
                section_id: '2',
                section_name: 'TV Shows',
                section_type: 'show',
                count: '100',
                parent_count: '500',
                child_count: '5000',
              },
              {
                section_id: '3',
                section_name: 'Music',
                section_type: 'artist',
                count: '200',
                parent_count: '1000',
                child_count: '10000',
              },
            ],
          },
        },
      });

      const points = await plugin.collect();

      const libraryPoints = points.filter((p) => p.tags.type === 'library_stats');
      expect(libraryPoints.length).toBe(3);

      const movieLib = libraryPoints.find((p) => p.tags.section_name === 'Movies');
      expect(movieLib?.fields.total).toBe(500);

      const tvLib = libraryPoints.find((p) => p.tags.section_name === 'TV Shows');
      expect(tvLib?.fields.total).toBe(100);
      expect(tvLib?.fields.seasons).toBe(500);
      expect(tvLib?.fields.episodes).toBe(5000);

      const musicLib = libraryPoints.find((p) => p.tags.section_name === 'Music');
      expect(musicLib?.fields.artists).toBe(200);
      expect(musicLib?.fields.albums).toBe(1000);
      expect(musicLib?.fields.tracks).toBe(10000);
    });

    it('should use GeoIP data when available', async () => {
      const mockGeoIP: GeoIPLookupFn = vi.fn().mockResolvedValue({
        latitude: 48.8566,
        longitude: 2.3522,
        city: 'Paris',
        region: 'IDF',
      } as GeoIPInfo);

      plugin.setGeoIPLookup(mockGeoIP);

      mockHttpClient.get.mockResolvedValueOnce({
        data: {
          response: {
            data: {
              stream_count: '1',
              total_bandwidth: 5000,
              wan_bandwidth: 5000,
              lan_bandwidth: 0,
              stream_count_transcode: 0,
              stream_count_direct_play: 1,
              stream_count_direct_stream: 0,
              sessions: [
                {
                  session_id: 'session1',
                  session_key: 'key1',
                  username: 'user1',
                  ip_address_public: '82.64.1.1',
                  full_title: 'Test',
                  state: 'playing',
                },
              ],
            },
          },
        },
      });

      mockHttpClient.get.mockResolvedValueOnce({
        data: { response: { data: [] } },
      });

      const points = await plugin.collect();
      const sessionPoint = points.find((p) => p.tags.type === 'Session');

      expect(sessionPoint?.tags.latitude).toBe(48.8566);
      expect(sessionPoint?.tags.longitude).toBe(2.3522);
      expect(sessionPoint?.tags.location).toBe('Paris');
      expect(sessionPoint?.tags.region_code).toBe('IDF');
    });

    it('should use default coordinates when GeoIP fails', async () => {
      const mockGeoIP: GeoIPLookupFn = vi.fn().mockRejectedValue(new Error('GeoIP error'));
      plugin.setGeoIPLookup(mockGeoIP);

      mockHttpClient.get.mockResolvedValueOnce({
        data: {
          response: {
            data: {
              stream_count: '1',
              total_bandwidth: 5000,
              wan_bandwidth: 5000,
              lan_bandwidth: 0,
              stream_count_transcode: 0,
              stream_count_direct_play: 1,
              stream_count_direct_stream: 0,
              sessions: [
                {
                  session_id: 'session1',
                  session_key: 'key1',
                  username: 'user1',
                  ip_address_public: '1.2.3.4',
                  full_title: 'Test',
                  state: 'playing',
                },
              ],
            },
          },
        },
      });

      mockHttpClient.get.mockResolvedValueOnce({
        data: { response: { data: [] } },
      });

      const points = await plugin.collect();
      const sessionPoint = points.find((p) => p.tags.type === 'Session');

      // Should use Area 51 coordinates as default
      expect(sessionPoint?.tags.latitude).toBe(37.234332396);
      expect(sessionPoint?.tags.longitude).toBe(-115.80666344);
    });

    it('should handle API errors gracefully', async () => {
      mockHttpClient.get.mockRejectedValueOnce(new Error('API Error'));
      mockHttpClient.get.mockRejectedValueOnce(new Error('API Error'));

      const points = await plugin.collect();
      expect(points).toBeDefined();
      expect(points.length).toBe(0);
    });

    it('should handle invalid API responses', async () => {
      mockHttpClient.get.mockResolvedValueOnce({
        data: { response: null },
      });
      mockHttpClient.get.mockResolvedValueOnce({
        data: { response: { data: [] } },
      });

      const points = await plugin.collect();
      expect(points).toBeDefined();
    });
  });

  describe('shutdown', () => {
    it('should shutdown without error', async () => {
      await plugin.initialize(testConfig);
      await expect(plugin.shutdown()).resolves.toBeUndefined();
    });
  });
});
