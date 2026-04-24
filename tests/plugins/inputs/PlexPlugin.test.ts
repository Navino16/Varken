import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { PlexPlugin } from '../../../src/plugins/inputs/PlexPlugin';
import type { PlexConfig } from '../../../src/types/inputs/plex.types';
import axios from 'axios';
import { createMockHttpClient, type MockHttpClient } from '../../fixtures/http';

vi.mock('../../../src/core/Logger', async () => {
  const { loggerMock } = await import('../../fixtures/logger');
  return loggerMock();
});

vi.mock('axios', () => ({
  default: { create: vi.fn() },
}));

describe('PlexPlugin', () => {
  let plugin: PlexPlugin;
  let mockHttpClient: MockHttpClient;

  const testConfig: PlexConfig = {
    id: 1,
    url: 'http://plex.local:32400',
    token: 'test-token',
    verifySsl: false,
    sessions: { enabled: true, intervalSeconds: 30 },
    libraries: { enabled: true, intervalSeconds: 3600 },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    plugin = new PlexPlugin();
    mockHttpClient = createMockHttpClient();
    (axios.create as Mock).mockReturnValue(mockHttpClient);
  });

  describe('metadata', () => {
    it('exposes correct name and version', () => {
      expect(plugin.metadata.name).toBe('Plex');
      expect(plugin.metadata.version).toBe('1.0.0');
    });
  });

  describe('initialize', () => {
    it('sets X-Plex-Token header and switches Accept to JSON', async () => {
      await plugin.initialize(testConfig);
      expect(mockHttpClient.defaults.headers.common['X-Plex-Token']).toBe('test-token');
      expect(mockHttpClient.defaults.headers.common['Accept']).toBe('application/json');
    });
  });

  describe('getSchedules', () => {
    it('returns schedules for every enabled collector', async () => {
      await plugin.initialize(testConfig);
      const schedules = plugin.getSchedules();
      expect(schedules).toHaveLength(2);
      expect(schedules.map((s) => s.name)).toEqual(['Plex_1_sessions', 'Plex_1_libraries']);
    });

    it('omits disabled schedules', async () => {
      await plugin.initialize({ ...testConfig, libraries: { enabled: false, intervalSeconds: 3600 } });
      const schedules = plugin.getSchedules();
      expect(schedules).toHaveLength(1);
      expect(schedules[0].name).toBe('Plex_1_sessions');
    });
  });

  describe('collect sessions', () => {
    beforeEach(async () => {
      await plugin.initialize({ ...testConfig, libraries: { enabled: false, intervalSeconds: 3600 } });
    });

    it('produces a session DataPoint per active stream', async () => {
      mockHttpClient.get.mockResolvedValueOnce({
        data: {
          MediaContainer: {
            size: 1,
            Metadata: [
              {
                sessionKey: 's1',
                ratingKey: 'r1',
                guid: 'g',
                key: 'k',
                type: 'episode',
                title: 'Pilot',
                grandparentTitle: 'Some Show',
                duration: 1000,
                viewOffset: 250,
                addedAt: 0,
                updatedAt: 0,
                Media: [
                  {
                    id: 1,
                    duration: 1000,
                    bitrate: 5000,
                    width: 1920,
                    height: 1080,
                    aspectRatio: 1.78,
                    audioChannels: 2,
                    audioCodec: 'aac',
                    videoCodec: 'h264',
                    videoResolution: '1080',
                    container: 'mkv',
                    videoFrameRate: '24p',
                    videoProfile: 'high',
                    Part: [],
                  },
                ],
                User: { id: 'u1', thumb: '', title: 'alice' },
                Player: {
                  address: '10.0.0.2',
                  device: 'Chrome',
                  machineIdentifier: 'mid',
                  model: '',
                  platform: 'Web',
                  platformVersion: '1.0',
                  product: 'Plex Web',
                  profile: '',
                  state: 'playing',
                  title: 'Web',
                  version: '4.0',
                  local: true,
                  relayed: false,
                  secure: true,
                  userID: 1,
                },
                Session: { id: 's1', bandwidth: 5000, location: 'lan' },
              },
            ],
          },
        },
      });

      const points = await plugin.collect();

      const sessionPoints = points.filter((p) => p.tags.type === 'Session');
      expect(sessionPoints).toHaveLength(1);
      expect(sessionPoints[0].tags.username).toBe('alice');
      expect(sessionPoints[0].tags.title).toBe('Some Show - Pilot');
      expect(sessionPoints[0].tags.quality).toBe('1080');
      expect(sessionPoints[0].fields.progress_percent).toBe(25);
    });

    it('emits a summary stream_count point', async () => {
      mockHttpClient.get.mockResolvedValueOnce({
        data: { MediaContainer: { size: 0, Metadata: [] } },
      });

      const points = await plugin.collect();
      const summary = points.find((p) => p.tags.type === 'current_stream_stats');
      expect(summary).toBeDefined();
      expect(summary?.fields.stream_count).toBe(0);
    });

    it('counts transcode_streams correctly', async () => {
      mockHttpClient.get.mockResolvedValueOnce({
        data: {
          MediaContainer: {
            size: 1,
            Metadata: [
              {
                sessionKey: 's',
                ratingKey: 'r',
                guid: 'g',
                key: 'k',
                type: 'movie',
                title: 'M',
                duration: 1,
                viewOffset: 0,
                addedAt: 0,
                updatedAt: 0,
                Media: [],
                User: { id: '', thumb: '', title: 'u' },
                Player: {
                  address: '',
                  device: '',
                  machineIdentifier: '',
                  model: '',
                  platform: '',
                  platformVersion: '',
                  product: '',
                  profile: '',
                  state: 'playing',
                  title: '',
                  version: '',
                  local: false,
                  relayed: false,
                  secure: false,
                  userID: 0,
                },
                Session: { id: '', bandwidth: 0, location: '' },
                TranscodeSession: {
                  key: 'tk',
                  throttled: false,
                  complete: false,
                  progress: 0,
                  size: 0,
                  speed: 0,
                  duration: 0,
                  remaining: 0,
                  context: '',
                  sourceVideoCodec: '',
                  sourceAudioCodec: '',
                  videoDecision: 'transcode',
                  audioDecision: '',
                  protocol: '',
                  container: '',
                  videoCodec: '',
                  audioCodec: '',
                  audioChannels: 0,
                  transcodeHwRequested: false,
                },
              },
            ],
          },
        },
      });

      const points = await plugin.collect();
      const summary = points.find((p) => p.tags.type === 'current_stream_stats');
      expect(summary?.fields.transcode_streams).toBe(1);
    });
  });

  describe('collect libraries', () => {
    beforeEach(async () => {
      await plugin.initialize({ ...testConfig, sessions: { enabled: false, intervalSeconds: 30 } });
    });

    it('queries /library/sections and fetches item count per library', async () => {
      mockHttpClient.get
        .mockResolvedValueOnce({
          data: {
            MediaContainer: {
              size: 2,
              Directory: [
                {
                  key: '1',
                  type: 'show',
                  title: 'Shows',
                  agent: '',
                  scanner: '',
                  language: '',
                  uuid: '',
                  updatedAt: 0,
                  createdAt: 0,
                  scannedAt: 0,
                  content: true,
                  directory: true,
                  contentChangedAt: 0,
                  hidden: 0,
                  Location: [],
                },
                {
                  key: '2',
                  type: 'movie',
                  title: 'Movies',
                  agent: '',
                  scanner: '',
                  language: '',
                  uuid: '',
                  updatedAt: 0,
                  createdAt: 0,
                  scannedAt: 0,
                  content: true,
                  directory: true,
                  contentChangedAt: 0,
                  hidden: 0,
                  Location: [],
                },
              ],
            },
          },
        })
        .mockResolvedValueOnce({ data: { MediaContainer: { totalSize: 100 } } })
        .mockResolvedValueOnce({ data: { MediaContainer: { totalSize: 200 } } });

      const points = await plugin.collect();

      const libPoints = points.filter((p) => p.tags.type === 'library_stats');
      expect(libPoints).toHaveLength(2);
      expect(libPoints[0].fields.total).toBe(100);
      expect(libPoints[1].fields.total).toBe(200);
    });

    it('returns 0 count when the per-library endpoint fails', async () => {
      mockHttpClient.get
        .mockResolvedValueOnce({
          data: {
            MediaContainer: {
              size: 1,
              Directory: [
                {
                  key: '1',
                  type: 'show',
                  title: 'Shows',
                  agent: '',
                  scanner: '',
                  language: '',
                  uuid: '',
                  updatedAt: 0,
                  createdAt: 0,
                  scannedAt: 0,
                  content: true,
                  directory: true,
                  contentChangedAt: 0,
                  hidden: 0,
                  Location: [],
                },
              ],
            },
          },
        })
        .mockRejectedValueOnce(new Error('boom'));

      const points = await plugin.collect();
      const libPoint = points.find((p) => p.tags.type === 'library_stats');
      expect(libPoint?.fields.total).toBe(0);
    });
  });

  describe('collect() branches', () => {
    it('skips sessions when disabled', async () => {
      await plugin.initialize({ ...testConfig, sessions: { enabled: false, intervalSeconds: 30 } });
      mockHttpClient.get.mockResolvedValueOnce({
        data: { MediaContainer: { size: 0, Directory: [] } },
      });

      const points = await plugin.collect();
      expect(points.every((p) => p.tags.type !== 'Session')).toBe(true);
    });

    it('propagates errors from sessions fetch (safeFetch re-throws)', async () => {
      await plugin.initialize(testConfig);
      mockHttpClient.get.mockRejectedValueOnce(new Error('plex offline'));
      await expect(plugin.collect()).rejects.toThrow('plex offline');
    });
  });
});
