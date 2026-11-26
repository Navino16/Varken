import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import axios from 'axios';
import { TautulliPlugin } from '../../../src/plugins/inputs/TautulliPlugin';
import type { TautulliConfig } from '../../../src/types/inputs/tautulli.types';
import type { components } from '../../../src/types/generated/tautulli';
import { createContractHttpClient, type ContractHttpClient } from '../../fixtures/contract-http';
import { loadFixture } from '../../contracts/registry';
import type { DataPoint } from '../../../src/types/plugin.types';

vi.mock('../../../src/core/Logger', async () => {
  const { loggerMock } = await import('../../fixtures/logger');
  return loggerMock();
});

vi.mock('axios', () => ({ default: { create: vi.fn() } }));

type Schemas = components['schemas'];
type Session = Schemas['Session'];

const ACTIVITY = '/api/v2?cmd=get_activity';
const LIBRARIES = '/api/v2?cmd=get_libraries';
const GEOIP = '/api/v2?cmd=get_geoip_lookup';
const SERVER_INFO = '/api/v2?cmd=get_server_info';

function activity(): Schemas['ActivityResponse'] {
  return loadFixture<Schemas['ActivityResponse']>('tautulli/get-activity');
}

/** Fixture sessions: a local episode in direct play (macOS) and a remote movie transcoding (Android). */
function sessions(): { local: Session; remote: Session } {
  const [local, remote] = activity().response.data.sessions ?? [];
  return { local, remote };
}

function geoip(): Schemas['GeoIpResponse'] {
  return loadFixture<Schemas['GeoIpResponse']>('tautulli/get-geoip-lookup');
}

function libraries(): Schemas['LibrariesResponse'] {
  return loadFixture<Schemas['LibrariesResponse']>('tautulli/get-libraries');
}

function sessionPoints(points: DataPoint[]): DataPoint[] {
  return points.filter((p) => p.tags.type === 'Session');
}

describe('TautulliPlugin', () => {
  let plugin: TautulliPlugin;
  let client: ContractHttpClient;

  const testConfig: TautulliConfig = {
    id: 1,
    url: 'http://localhost:8181',
    apiKey: 'tautulli-api-key',
    verifySsl: false,
    activity: { enabled: true, intervalSeconds: 30 },
    libraries: { enabled: true, intervalDays: 1 },
    stats: { enabled: true, intervalSeconds: 300 },
    geoip: { enabled: true },
    serverInfo: { enabled: false, intervalSeconds: 300 },
    history: { enabled: false, intervalSeconds: 300 },
    users: { enabled: false, intervalSeconds: 3600 },
    libraryMedia: { enabled: false, intervalDays: 1 },
  };

  const withSessions = (...list: Session[]): void => {
    const body = activity();
    body.response.data.sessions = list;
    client.override(ACTIVITY, body);
  };

  const geoipCalls = (): unknown[][] => client.get.mock.calls.filter((call) => call[0] === GEOIP);

  const onlySession = async (session: Session): Promise<DataPoint | undefined> => {
    withSessions(session);
    return sessionPoints(await plugin.collect())[0];
  };

  beforeEach(() => {
    vi.clearAllMocks();
    plugin = new TautulliPlugin();
    client = createContractHttpClient('tautulli');
    (axios.create as Mock).mockReturnValue(client);
  });

  describe('contract', () => {
    it('rejects an error envelope on a 200 response', () => {
      expect(() =>
        client.override(GEOIP, { response: { result: 'error', message: 'Failed to lookup GeoIP info', data: {} } })
      ).toThrow(/result/);
    });

    it('rejects a session without a field Tautulli always sends', () => {
      const { state: _state, ...session } = sessions().remote;

      expect(() => withSessions(session as Session)).toThrow(/state/);
    });
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
      await expect(
        plugin.initialize({ ...testConfig, geoip: { enabled: true, licenseKey: 'old-maxmind-key' } })
      ).resolves.toBeUndefined();
    });

    it('should log deprecation warning for fallbackIp', async () => {
      await expect(plugin.initialize({ ...testConfig, fallbackIp: '8.8.8.8' })).resolves.toBeUndefined();
    });
  });

  describe('health', () => {
    it('calls get_server_info with the API key and the health timeout', async () => {
      await plugin.initialize(testConfig);

      await expect(plugin.healthCheck()).resolves.toBe(true);
      expect(client.get).toHaveBeenCalledWith(SERVER_INFO, {
        params: { apikey: 'tautulli-api-key' },
        timeout: 5000,
      });
    });

    it('reports an unreachable server as unhealthy', async () => {
      await plugin.initialize(testConfig);
      client.fail(SERVER_INFO, new Error('connect ECONNREFUSED'));

      await expect(plugin.healthCheck()).resolves.toBe(false);
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
      const librarySchedule = plugin.getSchedules().find((s) => s.name === 'Tautulli_1_libraries');

      expect(librarySchedule?.intervalSeconds).toBe(86400);
    });

    it('should only return activity schedule when others are disabled', async () => {
      await plugin.initialize({
        ...testConfig,
        libraries: { ...testConfig.libraries, enabled: false },
        stats: { ...testConfig.stats, enabled: false },
      });
      const schedules = plugin.getSchedules();

      expect(schedules.length).toBe(1);
      expect(schedules[0].name).toBe('Tautulli_1_activity');
    });
  });

  describe('collect', () => {
    beforeEach(async () => {
      await plugin.initialize(testConfig);
    });

    it('requests each command through its discriminated path', async () => {
      await plugin.collect();

      expect(client.get).toHaveBeenCalledWith(ACTIVITY, { params: { apikey: 'tautulli-api-key' } });
      expect(client.get).toHaveBeenCalledWith(GEOIP, { params: { apikey: 'tautulli-api-key', ip_address: '203.0.113.42' } });
      expect(client.get).toHaveBeenCalledWith(LIBRARIES, { params: { apikey: 'tautulli-api-key' } });
    });

    it('should collect activity data with sessions', async () => {
      const points = await plugin.collect();

      const remote = sessionPoints(points).find((p) => p.tags.session_id === 'k2m8ytq0rlvxw3hj5n7c1z9a');
      expect(sessionPoints(points)).toHaveLength(2);
      expect(remote?.tags).toMatchObject({
        username: 'arrakis.fan',
        friendly_name: 'Paul',
        title: 'Dune: Part Two',
        platform: 'Android',
        player_state: 0,
        transcode_decision: 'Transcode',
        transcode_hw_decoding: 1,
        media_type: 'movie',
        audio_codec: 'TRUEHD',
        stream_audio_codec: 'AAC',
        quality: '1080p',
        quality_profile: '8 Mbps 1080p',
        secure: 1,
      });
      expect(remote?.tags.progress_percent).toBeUndefined();
      expect(remote?.fields.progress).toBe(37);

      const statsPoint = points.find((p) => p.tags.type === 'current_stream_stats');
      expect(statsPoint?.fields).toEqual({
        stream_count: 2,
        total_bandwidth: 34438,
        wan_bandwidth: 9120,
        lan_bandwidth: 25318,
        transcode_streams: 1,
        direct_play_streams: 1,
        direct_streams: 0,
      });
    });

    it('emits only zeroed stream stats when get_activity returns an empty object', async () => {
      client.override(ACTIVITY, { response: { result: 'success', message: null, data: {} } });

      const points = await plugin.collect();

      expect(sessionPoints(points)).toHaveLength(0);
      expect(points.find((p) => p.tags.type === 'current_stream_stats')?.fields).toEqual({
        stream_count: 0,
        total_bandwidth: 0,
        wan_bandwidth: 0,
        lan_bandwidth: 0,
        transcode_streams: 0,
        direct_play_streams: 0,
        direct_streams: 0,
      });
    });

    it('writes progress 0 for a non-numeric progress_percent', async () => {
      const point = await onlySession({ ...sessions().remote, progress_percent: '' });

      expect(point?.fields.progress).toBe(0);
    });

    it('keeps the secure fallback for sessions without a secure attribute', async () => {
      const point = await onlySession(sessions().local);

      expect(point?.tags.secure).toBe('0');
    });

    it('should detect local streams and set Local Network location', async () => {
      const point = await onlySession(sessions().local);

      expect(point?.tags.location).toBe('Local');
      expect(point?.tags.full_location).toBe('Local Network');
      expect(point?.tags.region_code).toBe('LAN');
      expect(point?.fields.lat).toBeUndefined();
      expect(point?.fields.lon).toBeUndefined();
    });

    it('should use localCoordinates for local streams when configured', async () => {
      await plugin.initialize({
        ...testConfig,
        geoip: { enabled: true, localCoordinates: { latitude: 48.8566, longitude: 2.3522 } },
      });

      const point = await onlySession(sessions().local);

      expect(point?.tags.location).toBe('Local');
      expect(point?.tags.full_location).toBe('Local Network');
      expect(point?.fields.lat).toBe(48.8566);
      expect(point?.fields.lon).toBe(2.3522);
    });

    it('should call Tautulli GeoIP API for remote streams', async () => {
      const point = await onlySession(sessions().remote);

      expect(point?.fields.lat).toBe(45.7485);
      expect(point?.fields.lon).toBe(4.8467);
      expect(point?.tags.latitude).toBeUndefined();
      expect(point?.tags.longitude).toBeUndefined();
      expect(point?.tags.location).toBe('Lyon');
      expect(point?.tags.region_code).toBe('Auvergne-Rhône-Alpes');
      expect(point?.tags.full_location).toBe('Auvergne-Rhône-Alpes - Lyon');
      expect(geoipCalls()).toHaveLength(1);
    });

    it('declares the coordinates as float fields', async () => {
      const point = await onlySession(sessions().remote);

      expect(point?.floatFields).toEqual(expect.arrayContaining(['lat', 'lon']));
    });

    it('drops a lone coordinate', async () => {
      const body = geoip();
      body.response.data = { ...body.response.data, longitude: null };
      client.override(GEOIP, body);

      const point = await onlySession(sessions().remote);

      expect(point?.fields).not.toHaveProperty('lat');
      expect(point?.fields).not.toHaveProperty('lon');
    });

    it('keeps a genuine zero coordinate', async () => {
      const body = geoip();
      body.response.data = { ...body.response.data, latitude: 0, longitude: 0 };
      client.override(GEOIP, body);

      const point = await onlySession(sessions().remote);

      expect(point?.fields).toMatchObject({ lat: 0, lon: 0 });
    });

    it('should handle GeoIP API failure gracefully', async () => {
      client.fail(GEOIP, new Error('Request failed with status code 400'));

      const point = await onlySession(sessions().remote);

      expect(point?.tags.location).toBe('unknown');
      expect(point?.tags.full_location).toBe('unknown');
      expect(point?.fields.lat).toBeUndefined();
      expect(point?.fields.lon).toBeUndefined();
    });

    it('should handle GeoIP API returning error result', async () => {
      // Upstream sends error results with HTTP 400; this pins the plugin's defensive result check.
      client.overrideUnchecked(GEOIP, { response: { result: 'error', message: 'Failed to lookup GeoIP info', data: {} } });

      const point = await onlySession(sessions().remote);

      expect(point?.tags.location).toBe('unknown');
      expect(point?.tags.full_location).toBe('unknown');
    });

    it('falls back to unknown location for GeoIP data with null fields', async () => {
      const body = geoip();
      body.response.data = { ...body.response.data, city: null, region: null, latitude: null, longitude: null };
      client.override(GEOIP, body);

      const point = await onlySession(sessions().remote);

      expect(point?.tags).toMatchObject({
        location: 'unknown',
        region_code: 'unknown',
        full_location: 'unknown',
      });
      expect(point?.fields.lat).toBeUndefined();
      expect(point?.fields.lon).toBeUndefined();
    });

    it('should not call GeoIP API for local streams', async () => {
      const { local } = sessions();
      expect(local.ip_address_public).toBe('198.51.100.7');

      await onlySession(local);

      expect(geoipCalls()).toHaveLength(0);
    });

    it('should not call GeoIP API when geoip is disabled', async () => {
      await plugin.initialize({ ...testConfig, geoip: { enabled: false } });

      await onlySession(sessions().remote);

      expect(geoipCalls()).toHaveLength(0);
    });

    it.each([
      ['osx', 'macOS'],
      ['windows', 'Windows'],
      ['Android', 'Android'],
    ])('should normalize platform %s to %s', async (platform, expected) => {
      const point = await onlySession({ ...sessions().local, platform });

      expect(point?.tags.platform).toBe(expected);
    });

    it('should strip build suffixes from product versions on osx', async () => {
      const point = await onlySession(sessions().local);

      expect(point?.tags.product_version).toBe('1.108.1.4874');
    });

    it('should write live TV sessions with the live media type', async () => {
      const point = await onlySession({ ...sessions().local, live: 1 });

      expect(point?.tags.media_type).toBe('live');
    });

    it('should write unknown when the session has no media type', async () => {
      const point = await onlySession({ ...sessions().local, media_type: '' });

      expect(point?.tags.media_type).toBe('unknown');
    });

    it('should set video_decision to Music for audio-only sessions', async () => {
      const point = await onlySession({ ...sessions().local, video_decision: '', media_type: 'track' });

      expect(point?.tags.video_decision).toBe('Music');
    });

    it('should normalize transcode decisions', async () => {
      const point = await onlySession({ ...sessions().local, transcode_decision: 'copy', video_decision: 'copy' });

      expect(point?.tags.transcode_decision).toBe('Direct stream');
      expect(point?.tags.video_decision).toBe('Direct stream');
    });

    it.each([
      ['playing', 0],
      ['paused', 1],
      ['buffering', 3],
      ['unknown', 0],
    ])('should map player state %s to %i', async (state, expected) => {
      const point = await onlySession({ ...sessions().local, state });

      expect(point?.tags.player_state).toBe(expected);
    });

    it('should collect library statistics', async () => {
      const points = await plugin.collect();
      const libraryPoints = points.filter((p) => p.tags.type === 'library_stats');

      expect(libraryPoints.length).toBe(3);
      expect(libraryPoints.find((p) => p.tags.section_name === 'Movies')?.fields).toEqual({ total: 1342, is_active: 1, libraries: 'Movies' });
      expect(libraryPoints.find((p) => p.tags.section_name === 'TV Shows')?.fields).toEqual({
        total: 214,
        is_active: 1,
        seasons: 687,
        episodes: 9815,
        libraries: 'TV Shows',
      });
      expect(libraryPoints.find((p) => p.tags.section_name === 'Music')?.fields).toEqual({
        total: 388,
        is_active: 1,
        artists: 388,
        albums: 1702,
        tracks: 21034,
        libraries: 'Music',
      });
    });

    it('zeroes seasons and episodes for a show without parent and child counts', async () => {
      const body = libraries();
      const { parent_count: _parent, child_count: _child, ...show } = body.response.data[1];
      body.response.data = [show];
      client.override(LIBRARIES, body);

      const points = await plugin.collect();

      expect(points.find((p) => p.tags.type === 'library_stats')?.fields).toEqual({
        total: 214,
        is_active: 1,
        seasons: 0,
        episodes: 0,
        libraries: 'TV Shows',
      });
    });

    it('should use cached GeoIP data on subsequent calls for same IP', async () => {
      withSessions(sessions().remote);

      const first = sessionPoints(await plugin.collect())[0];
      const second = sessionPoints(await plugin.collect())[0];

      expect(first?.tags.location).toBe('Lyon');
      expect(second?.tags.location).toBe('Lyon');
      expect(geoipCalls()).toHaveLength(1);
    });

    it('should re-fetch GeoIP data after cache TTL expires', async () => {
      vi.useFakeTimers();
      try {
        withSessions(sessions().remote);

        await plugin.collect();
        vi.advanceTimersByTime(25 * 60 * 60 * 1000);
        await plugin.collect();

        expect(geoipCalls()).toHaveLength(2);
      } finally {
        vi.useRealTimers();
      }
    });

    describe('quality normalization', () => {
      it.each([
        { desc: 'appends "p" to numeric resolution', session: { stream_video_resolution: '1080' }, expected: '1080p' },
        { desc: 'uppercases "SD"', session: { stream_video_resolution: 'SD' }, expected: 'SD' },
        { desc: 'uppercases "sd"', session: { stream_video_resolution: 'sd' }, expected: 'SD' },
        { desc: 'uppercases "4k"', session: { stream_video_resolution: '4k' }, expected: '4K' },
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
      ])('should produce "$expected" when $desc', async ({ session, expected }) => {
        const point = await onlySession({ ...sessions().local, stream_video_full_resolution: '', ...session });

        expect(point?.tags.quality).toBe(expected);
      });
    });

    describe('private IP detection', () => {
      const remoteFrom = (ip: string): Session => ({ ...sessions().remote, ip_address: ip, ip_address_public: '' });

      it.each([
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
        ['::1', 'IPv6 loopback'],
        ['fe80::1', 'IPv6 link-local'],
        ['fc00::1', 'IPv6 unique local (fc00)'],
        ['fd00::abcd', 'IPv6 unique local (fd00)'],
      ])('should treat %s (%s) as local — no GeoIP call', async (ip) => {
        const point = await onlySession(remoteFrom(ip));

        expect(point?.tags.location).toBe('Local');
        expect(geoipCalls()).toHaveLength(0);
      });

      it('should treat public IP as remote — triggers GeoIP call', async () => {
        const point = await onlySession(remoteFrom('82.64.1.1'));

        expect(point?.tags.location).toBe('Lyon');
        expect(geoipCalls()).toHaveLength(1);
        expect(client.get).toHaveBeenCalledWith(GEOIP, { params: { apikey: 'tautulli-api-key', ip_address: '82.64.1.1' } });
      });
    });

    it('should propagate API errors for circuit breaker', async () => {
      client.fail(ACTIVITY, new Error('API Error'));

      await expect(plugin.collect()).rejects.toThrow('API Error');
    });

    it('should handle invalid API responses', async () => {
      client.overrideUnchecked(ACTIVITY, { response: null });
      client.overrideUnchecked(LIBRARIES, { response: null });

      const points = await plugin.collect();

      expect(points.filter((p) => ['Session', 'current_stream_stats', 'library_stats'].includes(String(p.tags.type)))).toEqual([]);
    });
  });

  describe('session details', () => {
    beforeEach(async () => {
      await plugin.initialize(testConfig);
    });

    it('enriches sessions', async () => {
      const { local, remote } = sessions();

      const localPoint = await onlySession(local);
      expect(localPoint?.tags).toMatchObject({
        network: 'lan',
        live: 0,
        audio_decision: 'Direct play',
        subtitle_decision: 'unknown',
        container_decision: 'Direct play',
        video_codec: 'H264',
        stream_video_codec: 'H264',
        video_resolution: '1080p',
        stream_video_resolution: '1080p',
        video_dynamic_range: 'SDR',
        stream_video_dynamic_range: 'SDR',
        year: 2025,
        genre: 'Drama',
        library_name: 'TV Shows',
        section_id: '2',
        user_id: 284113,
        device: 'OSX',
        country: 'unknown',
        country_code: 'unknown',
      });
      expect(localPoint?.fields).toEqual({
        hash: expect.any(String),
        progress: expect.any(Number),
        bandwidth: 25318,
        stream_bitrate: 10617,
        source_bitrate: 10617,
        duration_seconds: 2998,
        view_offset_seconds: 1259,
      });

      const remotePoint = await onlySession(remote);
      expect(remotePoint?.tags).toMatchObject({
        network: 'wan',
        audio_decision: 'Transcode',
        container_decision: 'Transcode',
        video_codec: 'HEVC',
        stream_video_codec: 'H264',
        video_resolution: '4K',
        stream_video_resolution: '1080p',
        video_dynamic_range: 'HDR',
        stream_video_dynamic_range: 'SDR',
        genre: 'Science Fiction',
        country: 'France',
        country_code: 'FR',
      });
      expect(remotePoint?.fields).toMatchObject({
        bandwidth: 9120,
        stream_bitrate: 8000,
        source_bitrate: 45000,
        duration_seconds: 9960,
        view_offset_seconds: 3685,
        transcode_speed: 2.4,
        transcode_progress: 61,
        transcode_throttled: 0,
        transcode_hw_full_pipeline: 0,
      });
      expect(remotePoint?.floatFields).toEqual(expect.arrayContaining(['transcode_speed', 'transcode_progress']));
    });

    it('omits numeric fields Tautulli leaves empty', async () => {
      const point = await onlySession({ ...sessions().remote, bandwidth: '', stream_bitrate: 'n/a', transcode_speed: '', duration: '' });

      expect(point?.fields).not.toHaveProperty('bandwidth');
      expect(point?.fields).not.toHaveProperty('stream_bitrate');
      expect(point?.fields).not.toHaveProperty('transcode_speed');
      expect(point?.fields).not.toHaveProperty('duration_seconds');
      expect(point?.fields.source_bitrate).toBe(45000);
    });

    it('reports whether a library is active', async () => {
      const libraries = (await plugin.collect()).filter((p) => p.tags.type === 'library_stats');

      expect(libraries.map((p) => p.fields.is_active)).toEqual([1, 1, 1]);
    });
  });

  describe('shutdown', () => {
    it('should shutdown without error', async () => {
      await plugin.initialize(testConfig);
      await expect(plugin.shutdown()).resolves.toBeUndefined();
    });
  });
  describe('server info', () => {
    const UPDATE_CHECK = '/api/v2?cmd=update_check';

    beforeEach(async () => {
      await plugin.initialize({
        ...testConfig,
        activity: { ...testConfig.activity, enabled: false },
        libraries: { ...testConfig.libraries, enabled: false },
        stats: { ...testConfig.stats, enabled: false },
        serverInfo: { enabled: true, intervalSeconds: 300 },
      });
    });

    it('collects server info', async () => {
      const points = await plugin.collect();

      expect(points).toHaveLength(1);
      expect(points[0]).toMatchObject({
        measurement: 'Tautulli',
        tags: { type: 'ServerInfo', server: 1, version: 'v2.19.1', branch: 'master', pms_version: '1.42.2.10156-f737b826c' },
        fields: { update_available: 1, pms_update_available: 0, pms_plexpass: 1 },
      });
    });

    it('omits update_available when Tautulli cannot tell', async () => {
      // Tautulli answers an unknown version with result error and HTTP 400.
      client.fail(UPDATE_CHECK, new Error('Request failed with status code 400'));

      const [point] = await plugin.collect();

      expect(point.fields).not.toHaveProperty('update_available');
      expect(point.fields.pms_plexpass).toBe(1);
    });

    it('checks for Tautulli updates at most every 6 hours', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2026-11-25T10:00:00Z'));
      const updateChecks = (): number => client.get.mock.calls.filter((call) => call[0] === UPDATE_CHECK).length;

      await plugin.collect();
      vi.setSystemTime(new Date('2026-11-25T15:59:00Z'));
      const [cached] = await plugin.collect();
      expect(updateChecks()).toBe(1);
      expect(cached.fields.update_available).toBe(1);

      vi.setSystemTime(new Date('2026-11-25T16:00:00Z'));
      await plugin.collect();
      expect(updateChecks()).toBe(2);
      vi.useRealTimers();
    });

    it('schedules serverInfo when enabled', () => {
      expect(plugin.getSchedules().map((s) => s.name)).toEqual(['Tautulli_1_serverInfo']);
    });
  });
});
