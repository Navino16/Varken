import { describe, it, expect, vi, beforeEach, Mock } from 'vitest';
import { TautulliPlugin } from '../../../src/plugins/inputs/TautulliPlugin';
import { TautulliConfig } from '../../../src/types/inputs/tautulli.types';
import axios from 'axios';

// Mock the logger
vi.mock('../../../src/core/Logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
  withContext: (logger: unknown) => logger,
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
    verifySsl: false,
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
      interceptors: {
        response: { use: vi.fn() },
        request: { use: vi.fn() },
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

    it('should log deprecation warning for licenseKey', async () => {
      const configWithLicenseKey: TautulliConfig = {
        ...testConfig,
        geoip: {
          enabled: true,
          licenseKey: 'old-maxmind-key',
        },
      };
      await plugin.initialize(configWithLicenseKey);
      // Warning is logged internally, plugin should still work
    });

    it('should log deprecation warning for fallbackIp', async () => {
      const configWithFallbackIp: TautulliConfig = {
        ...testConfig,
        fallbackIp: '8.8.8.8',
      };
      await plugin.initialize(configWithFallbackIp);
      // Warning is logged internally, plugin should still work
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
            result: 'success',
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
                  local: '1', // Local stream
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
            result: 'success',
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

    it('should detect local streams and set Local Network location', async () => {
      mockHttpClient.get.mockResolvedValueOnce({
        data: {
          response: {
            result: 'success',
            data: {
              stream_count: '1',
              total_bandwidth: 5000,
              wan_bandwidth: 0,
              lan_bandwidth: 5000,
              stream_count_transcode: 0,
              stream_count_direct_play: 1,
              stream_count_direct_stream: 0,
              sessions: [
                {
                  session_id: 'session1',
                  session_key: 'key1',
                  username: 'user1',
                  ip_address: '192.168.1.100',
                  full_title: 'Test Movie',
                  state: 'playing',
                  local: '1', // Local stream
                },
              ],
            },
          },
        },
      });

      mockHttpClient.get.mockResolvedValueOnce({
        data: { response: { result: 'success', data: [] } },
      });

      const points = await plugin.collect();
      const sessionPoint = points.find((p) => p.tags.type === 'Session');

      expect(sessionPoint?.tags.location).toBe('Local');
      expect(sessionPoint?.tags.full_location).toBe('Local Network');
      expect(sessionPoint?.tags.region_code).toBe('LAN');
      // No coordinates for local streams without localCoordinates config
      expect(sessionPoint?.tags.latitude).toBeUndefined();
      expect(sessionPoint?.tags.longitude).toBeUndefined();
    });

    it('should use localCoordinates for local streams when configured', async () => {
      const configWithLocalCoords: TautulliConfig = {
        ...testConfig,
        geoip: {
          enabled: true,
          localCoordinates: {
            latitude: 48.8566,
            longitude: 2.3522,
          },
        },
      };

      await plugin.initialize(configWithLocalCoords);

      mockHttpClient.get.mockResolvedValueOnce({
        data: {
          response: {
            result: 'success',
            data: {
              stream_count: '1',
              total_bandwidth: 5000,
              wan_bandwidth: 0,
              lan_bandwidth: 5000,
              stream_count_transcode: 0,
              stream_count_direct_play: 1,
              stream_count_direct_stream: 0,
              sessions: [
                {
                  session_id: 'session1',
                  session_key: 'key1',
                  username: 'user1',
                  ip_address: '192.168.1.100',
                  full_title: 'Test Movie',
                  state: 'playing',
                  local: '1',
                },
              ],
            },
          },
        },
      });

      mockHttpClient.get.mockResolvedValueOnce({
        data: { response: { result: 'success', data: [] } },
      });

      const points = await plugin.collect();
      const sessionPoint = points.find((p) => p.tags.type === 'Session');

      expect(sessionPoint?.tags.location).toBe('Local');
      expect(sessionPoint?.tags.full_location).toBe('Local Network');
      expect(sessionPoint?.tags.latitude).toBe(48.8566);
      expect(sessionPoint?.tags.longitude).toBe(2.3522);
    });

    it('should call Tautulli GeoIP API for remote streams', async () => {
      // First call: get_activity
      mockHttpClient.get.mockResolvedValueOnce({
        data: {
          response: {
            result: 'success',
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
                  full_title: 'Test Movie',
                  state: 'playing',
                  local: '0', // Remote stream
                },
              ],
            },
          },
        },
      });

      // Second call: get_geoip_lookup
      mockHttpClient.get.mockResolvedValueOnce({
        data: {
          response: {
            result: 'success',
            data: {
              city: 'Paris',
              code: 'FR',
              continent: 'Europe',
              country: 'France',
              latitude: 48.8566,
              longitude: 2.3522,
              postal_code: '75001',
              region: 'Île-de-France',
              timezone: 'Europe/Paris',
              accuracy: 100,
            },
          },
        },
      });

      // Third call: get_libraries
      mockHttpClient.get.mockResolvedValueOnce({
        data: { response: { result: 'success', data: [] } },
      });

      const points = await plugin.collect();
      const sessionPoint = points.find((p) => p.tags.type === 'Session');

      expect(sessionPoint?.tags.latitude).toBe(48.8566);
      expect(sessionPoint?.tags.longitude).toBe(2.3522);
      expect(sessionPoint?.tags.location).toBe('Paris');
      expect(sessionPoint?.tags.region_code).toBe('Île-de-France');
      expect(sessionPoint?.tags.full_location).toBe('Île-de-France - Paris');

      // Verify GeoIP API was called
      expect(mockHttpClient.get).toHaveBeenCalledWith('/api/v2', expect.objectContaining({
        params: expect.objectContaining({
          cmd: 'get_geoip_lookup',
          ip_address: '82.64.1.1',
        }),
      }));
    });

    it('should handle GeoIP API failure gracefully', async () => {
      mockHttpClient.get.mockResolvedValueOnce({
        data: {
          response: {
            result: 'success',
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
                  local: '0',
                },
              ],
            },
          },
        },
      });

      // GeoIP lookup fails
      mockHttpClient.get.mockRejectedValueOnce(new Error('GeoIP API error'));

      mockHttpClient.get.mockResolvedValueOnce({
        data: { response: { result: 'success', data: [] } },
      });

      const points = await plugin.collect();
      const sessionPoint = points.find((p) => p.tags.type === 'Session');

      // Should use unknown values when GeoIP fails
      expect(sessionPoint?.tags.location).toBe('unknown');
      expect(sessionPoint?.tags.full_location).toBe('unknown');
      expect(sessionPoint?.tags.latitude).toBeUndefined();
      expect(sessionPoint?.tags.longitude).toBeUndefined();
    });

    it('should handle GeoIP API returning error result', async () => {
      mockHttpClient.get.mockResolvedValueOnce({
        data: {
          response: {
            result: 'success',
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
                  local: '0',
                },
              ],
            },
          },
        },
      });

      // GeoIP returns error result
      mockHttpClient.get.mockResolvedValueOnce({
        data: {
          response: {
            result: 'error',
            message: 'Invalid IP address',
          },
        },
      });

      mockHttpClient.get.mockResolvedValueOnce({
        data: { response: { result: 'success', data: [] } },
      });

      const points = await plugin.collect();
      const sessionPoint = points.find((p) => p.tags.type === 'Session');

      expect(sessionPoint?.tags.location).toBe('unknown');
      expect(sessionPoint?.tags.full_location).toBe('unknown');
    });

    it('should not call GeoIP API for local streams', async () => {
      mockHttpClient.get.mockResolvedValueOnce({
        data: {
          response: {
            result: 'success',
            data: {
              stream_count: '1',
              total_bandwidth: 5000,
              wan_bandwidth: 0,
              lan_bandwidth: 5000,
              stream_count_transcode: 0,
              stream_count_direct_play: 1,
              stream_count_direct_stream: 0,
              sessions: [
                {
                  session_id: 'session1',
                  session_key: 'key1',
                  username: 'user1',
                  ip_address: '192.168.1.100',
                  ip_address_public: '82.64.1.1', // Even with public IP, should skip if local
                  full_title: 'Test',
                  state: 'playing',
                  local: '1', // Local stream
                },
              ],
            },
          },
        },
      });

      mockHttpClient.get.mockResolvedValueOnce({
        data: { response: { result: 'success', data: [] } },
      });

      await plugin.collect();

      // Should only have 2 calls: get_activity and get_libraries
      // No get_geoip_lookup for local streams
      const geoipCalls = mockHttpClient.get.mock.calls.filter(
        (call) => call[1]?.params?.cmd === 'get_geoip_lookup'
      );
      expect(geoipCalls.length).toBe(0);
    });

    it('should not call GeoIP API when geoip is disabled', async () => {
      const configNoGeoip: TautulliConfig = {
        ...testConfig,
        geoip: { enabled: false },
      };
      await plugin.initialize(configNoGeoip);

      mockHttpClient.get.mockResolvedValueOnce({
        data: {
          response: {
            result: 'success',
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
                  local: '0',
                },
              ],
            },
          },
        },
      });

      mockHttpClient.get.mockResolvedValueOnce({
        data: { response: { result: 'success', data: [] } },
      });

      await plugin.collect();

      const geoipCalls = mockHttpClient.get.mock.calls.filter(
        (call) => call[1]?.params?.cmd === 'get_geoip_lookup'
      );
      expect(geoipCalls.length).toBe(0);
    });

    it('should normalize platform names', async () => {
      mockHttpClient.get.mockResolvedValueOnce({
        data: {
          response: {
            result: 'success',
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
                  local: '1',
                },
              ],
            },
          },
        },
      });

      mockHttpClient.get.mockResolvedValueOnce({
        data: { response: { result: 'success', data: [] } },
      });

      const points = await plugin.collect();
      const sessionPoint = points.find((p) => p.tags.type === 'Session');
      expect(sessionPoint?.tags.platform).toBe('macOS');
    });

    it('should set video_decision to Music for audio-only sessions', async () => {
      mockHttpClient.get.mockResolvedValueOnce({
        data: {
          response: {
            result: 'success',
            data: {
              stream_count: '1',
              total_bandwidth: 0,
              wan_bandwidth: 0,
              lan_bandwidth: 0,
              stream_count_transcode: 0,
              stream_count_direct_play: 1,
              stream_count_direct_stream: 0,
              sessions: [
                {
                  session_id: 'session1',
                  session_key: 'key1',
                  username: 'user1',
                  full_title: 'Some Album - Track 1',
                  state: 'playing',
                  local: '1',
                  video_decision: '',
                  media_type: 'track',
                },
              ],
            },
          },
        },
      });

      mockHttpClient.get.mockResolvedValueOnce({
        data: { response: { result: 'success', data: [] } },
      });

      const points = await plugin.collect();
      const sessionPoint = points.find((p) => p.tags.type === 'Session');
      expect(sessionPoint?.tags.video_decision).toBe('Music');
    });

    it('should normalize transcode decisions', async () => {
      mockHttpClient.get.mockResolvedValueOnce({
        data: {
          response: {
            result: 'success',
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
                  local: '1',
                },
              ],
            },
          },
        },
      });

      mockHttpClient.get.mockResolvedValueOnce({
        data: { response: { result: 'success', data: [] } },
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
              result: 'success',
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
                    local: '1',
                  },
                ],
              },
            },
          },
        });

        mockHttpClient.get.mockResolvedValueOnce({
          data: { response: { result: 'success', data: [] } },
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
            result: 'success',
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
            result: 'success',
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

    it('should use cached GeoIP data on subsequent calls for same IP', async () => {
      const remoteActivityResponse = {
        data: {
          response: {
            result: 'success',
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
                  full_title: 'Test Movie',
                  state: 'playing',
                  local: '0',
                },
              ],
            },
          },
        },
      };

      const geoipResponse = {
        data: {
          response: {
            result: 'success',
            data: {
              city: 'Paris',
              country: 'France',
              latitude: 48.8566,
              longitude: 2.3522,
              region: 'Île-de-France',
            },
          },
        },
      };

      const librariesResponse = {
        data: { response: { result: 'success', data: [] } },
      };

      // First collect: activity + geoip + libraries
      mockHttpClient.get.mockResolvedValueOnce(remoteActivityResponse);
      mockHttpClient.get.mockResolvedValueOnce(geoipResponse);
      mockHttpClient.get.mockResolvedValueOnce(librariesResponse);

      const points1 = await plugin.collect();
      const session1 = points1.find((p) => p.tags.type === 'Session');
      expect(session1?.tags.location).toBe('Paris');

      // Second collect: activity + libraries (no geoip call — cached)
      mockHttpClient.get.mockResolvedValueOnce(remoteActivityResponse);
      mockHttpClient.get.mockResolvedValueOnce(librariesResponse);

      const points2 = await plugin.collect();
      const session2 = points2.find((p) => p.tags.type === 'Session');
      expect(session2?.tags.location).toBe('Paris');

      // GeoIP API should have been called only once across both collects
      const geoipCalls = mockHttpClient.get.mock.calls.filter(
        (call) => call[1]?.params?.cmd === 'get_geoip_lookup'
      );
      expect(geoipCalls).toHaveLength(1);
    });

    it('should re-fetch GeoIP data after cache TTL expires', async () => {
      vi.useFakeTimers();

      const remoteActivityResponse = {
        data: {
          response: {
            result: 'success',
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
                  full_title: 'Test Movie',
                  state: 'playing',
                  local: '0',
                },
              ],
            },
          },
        },
      };

      const geoipResponse = {
        data: {
          response: {
            result: 'success',
            data: {
              city: 'Paris',
              country: 'France',
              latitude: 48.8566,
              longitude: 2.3522,
              region: 'Île-de-France',
            },
          },
        },
      };

      const librariesResponse = {
        data: { response: { result: 'success', data: [] } },
      };

      // First collect
      mockHttpClient.get.mockResolvedValueOnce(remoteActivityResponse);
      mockHttpClient.get.mockResolvedValueOnce(geoipResponse);
      mockHttpClient.get.mockResolvedValueOnce(librariesResponse);
      await plugin.collect();

      // Advance time past 24h TTL
      vi.advanceTimersByTime(25 * 60 * 60 * 1000);

      // Second collect — cache expired, should re-fetch
      mockHttpClient.get.mockResolvedValueOnce(remoteActivityResponse);
      mockHttpClient.get.mockResolvedValueOnce(geoipResponse);
      mockHttpClient.get.mockResolvedValueOnce(librariesResponse);
      await plugin.collect();

      // GeoIP API should have been called twice (once per collect)
      const geoipCalls = mockHttpClient.get.mock.calls.filter(
        (call) => call[1]?.params?.cmd === 'get_geoip_lookup'
      );
      expect(geoipCalls).toHaveLength(2);

      vi.useRealTimers();
    });

    describe('quality normalization', () => {
      const qualityCases = [
        {
          desc: 'appends "p" to numeric resolution',
          session: { stream_video_resolution: '1080' },
          expected: '1080p',
        },
        {
          desc: 'uppercases "SD"',
          session: { stream_video_resolution: 'SD' },
          expected: 'SD',
        },
        {
          desc: 'uppercases "sd"',
          session: { stream_video_resolution: 'sd' },
          expected: 'SD',
        },
        {
          desc: 'uppercases "4k"',
          session: { stream_video_resolution: '4k' },
          expected: '4K',
        },
        {
          desc: 'uses stream_video_full_resolution when available',
          session: { stream_video_resolution: '1080', stream_video_full_resolution: '1080p60' },
          expected: '1080p60',
        },
        {
          desc: 'falls back to container when resolution is empty',
          session: { stream_video_resolution: '', container: 'flac' },
          expected: 'FLAC',
        },
      ];

      it.each(qualityCases)(
        'should produce "$expected" when $desc',
        async ({ session, expected }) => {
          mockHttpClient.get.mockResolvedValueOnce({
            data: {
              response: {
                result: 'success',
                data: {
                  stream_count: '1',
                  total_bandwidth: 0,
                  wan_bandwidth: 0,
                  lan_bandwidth: 0,
                  stream_count_transcode: 0,
                  stream_count_direct_play: 1,
                  stream_count_direct_stream: 0,
                  sessions: [
                    {
                      session_id: 'session1',
                      session_key: 'key1',
                      username: 'user1',
                      full_title: 'Test',
                      state: 'playing',
                      local: '1',
                      ...session,
                    },
                  ],
                },
              },
            },
          });

          mockHttpClient.get.mockResolvedValueOnce({
            data: { response: { result: 'success', data: [] } },
          });

          const points = await plugin.collect();
          const sessionPoint = points.find((p) => p.tags.type === 'Session');
          expect(sessionPoint?.tags.quality).toBe(expected);
        }
      );
    });

    describe('private IP detection', () => {
      const privateIPs = [
        ['10.0.0.1', '10.x.x.x (Class A)'],
        ['10.255.255.255', '10.x.x.x boundary'],
        ['172.16.0.1', '172.16.x.x (Class B start)'],
        ['172.31.255.255', '172.31.x.x (Class B end)'],
        ['192.168.0.1', '192.168.x.x (Class C)'],
        ['127.0.0.1', 'loopback'],
        ['0.0.0.0', 'zero network'],
        ['169.254.1.1', 'link-local'],
        ['224.0.0.1', 'multicast'],
        ['255.255.255.255', 'broadcast'],
      ];

      it.each(privateIPs)(
        'should treat %s (%s) as local — no GeoIP call',
        async (ip) => {
          mockHttpClient.get.mockResolvedValueOnce({
            data: {
              response: {
                result: 'success',
                data: {
                  stream_count: '1',
                  total_bandwidth: 0,
                  wan_bandwidth: 0,
                  lan_bandwidth: 0,
                  stream_count_transcode: 0,
                  stream_count_direct_play: 1,
                  stream_count_direct_stream: 0,
                  sessions: [
                    {
                      session_id: 'session1',
                      session_key: 'key1',
                      username: 'user1',
                      ip_address: ip,
                      full_title: 'Test',
                      state: 'playing',
                      local: '0', // Tautulli says remote, but IP is private
                    },
                  ],
                },
              },
            },
          });

          mockHttpClient.get.mockResolvedValueOnce({
            data: { response: { result: 'success', data: [] } },
          });

          const points = await plugin.collect();
          const session = points.find((p) => p.tags.type === 'Session');
          expect(session?.tags.location).toBe('Local');

          const geoipCalls = mockHttpClient.get.mock.calls.filter(
            (call) => call[1]?.params?.cmd === 'get_geoip_lookup'
          );
          expect(geoipCalls).toHaveLength(0);
        }
      );

      const privateIPv6s = [
        ['::1', 'IPv6 loopback'],
        ['fe80::1', 'IPv6 link-local'],
        ['fc00::1', 'IPv6 unique local (fc00)'],
        ['fd00::abcd', 'IPv6 unique local (fd00)'],
      ];

      it.each(privateIPv6s)(
        'should treat %s (%s) as local — no GeoIP call',
        async (ip) => {
          mockHttpClient.get.mockResolvedValueOnce({
            data: {
              response: {
                result: 'success',
                data: {
                  stream_count: '1',
                  total_bandwidth: 0,
                  wan_bandwidth: 0,
                  lan_bandwidth: 0,
                  stream_count_transcode: 0,
                  stream_count_direct_play: 1,
                  stream_count_direct_stream: 0,
                  sessions: [
                    {
                      session_id: 'session1',
                      session_key: 'key1',
                      username: 'user1',
                      ip_address: ip,
                      full_title: 'Test',
                      state: 'playing',
                      local: '0',
                    },
                  ],
                },
              },
            },
          });

          mockHttpClient.get.mockResolvedValueOnce({
            data: { response: { result: 'success', data: [] } },
          });

          const points = await plugin.collect();
          const session = points.find((p) => p.tags.type === 'Session');
          expect(session?.tags.location).toBe('Local');

          const geoipCalls = mockHttpClient.get.mock.calls.filter(
            (call) => call[1]?.params?.cmd === 'get_geoip_lookup'
          );
          expect(geoipCalls).toHaveLength(0);
        }
      );

      it('should treat public IP as remote — triggers GeoIP call', async () => {
        mockHttpClient.get.mockResolvedValueOnce({
          data: {
            response: {
              result: 'success',
              data: {
                stream_count: '1',
                total_bandwidth: 0,
                wan_bandwidth: 0,
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
                    local: '0',
                  },
                ],
              },
            },
          },
        });

        mockHttpClient.get.mockResolvedValueOnce({
          data: {
            response: {
              result: 'success',
              data: { city: 'Paris', country: 'France', latitude: 48.85, longitude: 2.35, region: 'IDF' },
            },
          },
        });

        mockHttpClient.get.mockResolvedValueOnce({
          data: { response: { result: 'success', data: [] } },
        });

        const points = await plugin.collect();
        const session = points.find((p) => p.tags.type === 'Session');
        expect(session?.tags.location).toBe('Paris');

        const geoipCalls = mockHttpClient.get.mock.calls.filter(
          (call) => call[1]?.params?.cmd === 'get_geoip_lookup'
        );
        expect(geoipCalls).toHaveLength(1);
      });
    });

    it('should propagate API errors for circuit breaker', async () => {
      mockHttpClient.get.mockRejectedValueOnce(new Error('API Error'));

      await expect(plugin.collect()).rejects.toThrow('API Error');
    });

    it('should handle invalid API responses', async () => {
      mockHttpClient.get.mockResolvedValueOnce({
        data: { response: null },
      });
      mockHttpClient.get.mockResolvedValueOnce({
        data: { response: { result: 'success', data: [] } },
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
