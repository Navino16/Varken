import { BaseInputPlugin } from './BaseInputPlugin';
import { normalizeMediaType } from './utils/mediaType';
import { isPrivateIp } from './utils/network';
import { resolutionLabel } from './utils/mediaStreams';
import { RequestCache } from '../../utils/RequestCache';
import { mapLimit } from '../../utils/concurrency';
import type { PluginMetadata, DataPoint, PointSpec, ScheduleConfig } from '../../types/plugin.types';
import type { TautulliConfig, GeoIPInfo } from '../../types/inputs/tautulli.types';
import type { components, paths } from '../../types/generated/tautulli';
import type { GetPath } from '../../types/api-contract';
import { booleanFlags } from './utils/flags';
import { numberOf } from './utils/numbers';
import { eventTimestamp } from './utils/events';
import { completedBuckets, graphSnapshotPoints, homeStatPoints, mediaInfoPoints, watchTimeFields } from './utils/tautulliStats';
import { ageSeconds } from './utils/time';

type TautulliSession = components['schemas']['Session'];
type RecentlyAddedItem = components['schemas']['RecentlyAddedItem'];
type Graph = components['schemas']['Graph'];
type HistoryRow = components['schemas']['HistoryRow'];
type UserTableRow = components['schemas']['UserTableRow'];
type LibraryTableRow = components['schemas']['LibraryTableRow'];
type MediaInfoTable = components['schemas']['MediaInfoTable'];

const SERVER_INFO_PATH: GetPath<paths> = '/api/v2?cmd=get_server_info';

/**
 * Tautulli input plugin
 * Collects activity, libraries, and stats from Tautulli API v2
 */

const WATCH_TIME_DAYS = '1,7,30,0';
const DAY_SECONDS = 24 * 60 * 60;
const MEDIA_INFO_SECTION_TYPES = new Set(['movie', 'show', 'artist', 'photo']);

const PLAYER_STATE = { PLAYING: 0, PAUSED: 1, BUFFERING: 3 } as const;

export class TautulliPlugin extends BaseInputPlugin<TautulliConfig> {
  private static readonly GEOIP_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
  private static readonly GEOIP_CACHE_MAX_SIZE = 1000;
  /** update_check makes Tautulli query GitHub uncached (up to 3 unauthenticated calls); Tautulli itself checks every few hours. */
  private static readonly UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
  private lastUpdateCheck?: { at: number; update: boolean | undefined };
  /** Home stats and graphs are Tautulli's heaviest queries and barely move between polls. */
  private static readonly STATS_INTERVAL_MS = 5 * 60 * 1000;
  private lastStatsAt?: number;
  /** Per-user and per-library calls each run several SQL queries in Tautulli. */
  private static readonly FAN_OUT = 4;

  private geoipCache = new RequestCache<GeoIPInfo | null>({
    ttlMs: TautulliPlugin.GEOIP_CACHE_TTL_MS,
    maxSize: TautulliPlugin.GEOIP_CACHE_MAX_SIZE,
  });

  readonly metadata: PluginMetadata = {
    name: 'Tautulli',
    version: '1.0.0',
    description: 'Collects activity, libraries, and stats from Tautulli',
  };

  /**
   * Initialize the plugin and configure the HTTP client
   */
  async initialize(...args: Parameters<BaseInputPlugin<TautulliConfig>['initialize']>): Promise<void> {
    await super.initialize(...args);

    // Log deprecation warnings for old config options
    if (this.config.geoip?.licenseKey) {
      this.logger.warn(
        'geoip.licenseKey is deprecated and ignored. GeoIP is now handled by Tautulli API.'
      );
    }
    if (this.config.fallbackIp) {
      this.logger.warn(
        'fallbackIp is deprecated and ignored. Use geoip.localCoordinates for LAN streams.'
      );
    }
  }

  /**
   * Health check for Tautulli - uses API key as query param
   */
  async healthCheck(): Promise<boolean> {
    try {
      await this.httpClient.get(SERVER_INFO_PATH, {
        params: { apikey: this.config.apiKey },
        timeout: this.globalConfig.healthCheckTimeoutMs,
      });
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.debug(`Health check failed for ${this.metadata.name} (id: ${this.config.id}): ${message}`);
      return false;
    }
  }

  /** Machine identifier of the Plex server this Tautulli watches. */
  async pmsIdentifier(): Promise<string> {
    const server = await this.api<paths>().get('/api/v2?cmd=get_server_info', { query: { apikey: this.config.apiKey } });
    const identifier = server.response.data.pms_identifier;
    if (!identifier) {
      throw new Error('Tautulli reports no Plex server identifier');
    }
    return identifier;
  }

  /**
   * Collect all enabled data from Tautulli
   */
  async collect(): Promise<DataPoint[]> {
    const points: DataPoint[] = [];

    if (this.config.activity.enabled) {
      const activityPoints = await this.collectActivity();
      points.push(...activityPoints);
    }

    if (this.config.stats.enabled) {
      points.push(...(await this.collectStats()));
    } else if (this.config.libraries.enabled) {
      points.push(...(await this.collectLibraries()));
    }

    if (this.config.serverInfo.enabled) {
      points.push(...(await this.collectServerInfo()));
    }

    if (this.config.history.enabled) {
      points.push(...(await this.collectHistory()));
    }

    if (this.config.users.enabled) {
      points.push(...(await this.collectUsers()));
    }

    if (this.config.libraryMedia.enabled) {
      points.push(...(await this.collectLibraryMedia()));
    }

    return points;
  }

  /**
   * Get schedule configurations for all enabled collectors
   */
  getSchedules(): ScheduleConfig[] {
    const schedules: ScheduleConfig[] = [];

    if (this.config.activity.enabled) {
      schedules.push(
        this.createSchedule(
          'activity',
          this.config.activity.intervalSeconds,
          true,
          this.collectActivity
        )
      );
    }

    if (this.config.stats.enabled) {
      schedules.push(
        this.createSchedule('stats', this.config.stats.intervalSeconds, true, this.collectStats)
      );
    }

    if (this.config.libraries.enabled) {
      // Libraries are collected less frequently (days instead of seconds)
      const intervalSeconds = this.config.libraries.intervalDays * 24 * 60 * 60;
      schedules.push(
        this.createSchedule('libraries', intervalSeconds, true, this.collectLibraries)
      );
    }

    if (this.config.serverInfo.enabled) {
      schedules.push(this.createSchedule('serverInfo', this.config.serverInfo.intervalSeconds, true, this.collectServerInfo));
    }

    if (this.config.history.enabled) {
      schedules.push(this.createSchedule('history', this.config.history.intervalSeconds, true, this.collectHistory));
    }

    if (this.config.users.enabled) {
      schedules.push(this.createSchedule('users', this.config.users.intervalSeconds, true, this.collectUsers));
    }

    if (this.config.libraryMedia.enabled) {
      schedules.push(this.createSchedule('libraryMedia', this.config.libraryMedia.intervalDays * DAY_SECONDS, true, this.collectLibraryMedia));
    }

    return schedules;
  }

  /**
   * Collect activity data from Tautulli
   */
  private async collectActivity(): Promise<DataPoint[]> {
    return this.safeFetch('collect Tautulli activity', async () => {
      const points: DataPoint[] = [];
      const response = await this.api<paths>().get('/api/v2?cmd=get_activity', {
        query: { apikey: this.config.apiKey },
      });

      if (!response?.response?.data) {
        this.logger.error('Invalid response from Tautulli get_activity');
        return points;
      }

      const activity = response.response.data;
      const sessions = activity.sessions || [];

      // Process each session
      for (const session of sessions) {
        const sessionPoint = await this.processSession(session);
        if (sessionPoint) {
          points.push(sessionPoint);
        }
      }

      // Add current stream stats summary
      points.push(
        this.createDataPoint(
          'Tautulli',
          {
            type: 'current_stream_stats',
            server: this.config.id,
          },
          {
            stream_count: parseInt(activity.stream_count ?? '0', 10) || 0,
            total_bandwidth: activity.total_bandwidth || 0,
            wan_bandwidth: activity.wan_bandwidth || 0,
            lan_bandwidth: activity.lan_bandwidth || 0,
            transcode_streams: activity.stream_count_transcode || 0,
            direct_play_streams: activity.stream_count_direct_play || 0,
            direct_streams: activity.stream_count_direct_stream || 0,
          }
        )
      );

      this.logger.info(`Collected ${sessions.length} sessions from Tautulli`);
      return points;
    });
  }

  /**
   * Mask the last octet of an IP address for privacy in logs
   */
  private maskIp(ip: string): string {
    return ip.replace(/\.\d+$/, '.xxx');
  }

  /**
   * Perform GeoIP lookup using Tautulli API
   */
  private async geoipLookup(ip: string): Promise<GeoIPInfo | null> {
    return this.geoipCache.getOrFetch(ip, async () => {
      try {
        const response = await this.api<paths>().get('/api/v2?cmd=get_geoip_lookup', {
          query: { apikey: this.config.apiKey, ip_address: ip },
        });

        if (response?.response?.result !== 'success' || !response?.response?.data) {
          return null;
        }

        const data = response.response.data;
        return {
          city: data.city || '',
          region: data.region || '',
          country: data.country || '',
          code: data.code || '',
          latitude: data.latitude ?? null,
          longitude: data.longitude ?? null,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        this.logger.debug(`GeoIP lookup failed for ${this.maskIp(ip)}: ${message}`);
        return null;
      }
    });
  }

  /**
   * Process a single Tautulli session into a DataPoint
   */
  private async processSession(session: TautulliSession): Promise<DataPoint | null> {
    const tautulliSaysLocal = session.local === 1;
    const ip = session.ip_address_public || session.ip_address;
    const ipIsPrivate = ip ? isPrivateIp(ip) : false;

    // Determine if stream is local: either Tautulli says so, or IP is private
    const isLocal = tautulliSaysLocal || ipIsPrivate;

    // Get GeoIP data if enabled and not a local stream
    let geoData: GeoIPInfo | null = null;
    if (this.config.geoip.enabled && !isLocal && ip) {
      geoData = await this.geoipLookup(ip);
      if (geoData) {
        this.logger.debug(`GeoIP: ${this.maskIp(ip)} -> ${geoData.city}, ${geoData.region}, ${geoData.country}`);
      }
    } else if (this.config.geoip.enabled && isLocal && ip) {
      this.logger.debug(`Local stream detected: ${this.maskIp(ip)} (private IP: ${ipIsPrivate}, tautulli local: ${tautulliSaysLocal})`);
    }

    // Determine location values
    let latitude: number | undefined;
    let longitude: number | undefined;
    let location = 'unknown';
    let regionCode = 'unknown';
    let fullLocation = 'unknown';

    if (isLocal) {
      // Local stream
      location = 'Local';
      fullLocation = 'Local Network';
      regionCode = 'LAN';
      if (this.config.geoip.localCoordinates) {
        latitude = this.config.geoip.localCoordinates.latitude;
        longitude = this.config.geoip.localCoordinates.longitude;
      }
    } else if (geoData) {
      // Remote stream with GeoIP data
      latitude = geoData.latitude ?? undefined;
      longitude = geoData.longitude ?? undefined;
      location = geoData.city || 'unknown';
      regionCode = geoData.region || 'unknown';
      const regionPart = geoData.region || '';
      const cityPart = geoData.city || '';
      fullLocation = regionPart && cityPart ? `${regionPart} - ${cityPart}` : regionPart || cityPart || 'unknown';
    }

    // Transcode decision normalization
    let transcodeDecision = session.transcode_decision || 'direct play';
    if (transcodeDecision === 'copy') {
      transcodeDecision = 'direct stream';
    }

    // Video decision normalization
    let videoDecision = session.video_decision || '';
    if (videoDecision === 'copy') {
      videoDecision = 'direct stream';
    } else if (videoDecision === '') {
      videoDecision = 'Music';
    }

    // Quality determination
    let quality = session.stream_video_resolution || '';
    if (!quality) {
      quality = (session.container || '').toUpperCase();
    } else if (quality === 'SD' || quality === 'sd' || quality === '4k') {
      quality = quality.toUpperCase();
    } else if (session.stream_video_full_resolution) {
      quality = session.stream_video_full_resolution;
    } else {
      quality = `${quality}p`;
    }

    // Player state mapping
    let playerState: number;
    const state = (session.state || '').toLowerCase();
    switch (state) {
      case 'playing':
        playerState = PLAYER_STATE.PLAYING;
        break;
      case 'paused':
        playerState = PLAYER_STATE.PAUSED;
        break;
      case 'buffering':
        playerState = PLAYER_STATE.BUFFERING;
        break;
      default:
        playerState = PLAYER_STATE.PLAYING;
    }

    // Platform normalization
    let platformName = session.platform || '';
    if (platformName === 'osx') {
      platformName = 'macOS';
    } else if (platformName === 'windows') {
      platformName = 'Windows';
    }

    // Product version cleanup (remove build suffixes for some platforms)
    let productVersion = session.product_version || '';
    if (['Roku', 'osx', 'windows'].includes(session.platform ?? '')) {
      productVersion = productVersion.split('-')[0];
    }

    const hashId = this.hashit(
      `${session.session_id}${session.session_key}${session.username}${session.full_title}`
    );

    const tags: Record<string, string | number> = {
      type: 'Session',
      session_id: session.session_id || 'unknown',
      ip_address: session.ip_address || 'unknown',
      friendly_name: session.friendly_name || 'unknown',
      username: session.username || 'unknown',
      title: session.full_title || 'unknown',
      product: session.product || 'unknown',
      platform: platformName || 'unknown',
      product_version: productVersion || 'unknown',
      quality: quality || 'unknown',
      video_decision: this.titleCase(videoDecision) || 'unknown',
      transcode_decision: this.titleCase(transcodeDecision) || 'unknown',
      transcode_hw_decoding: session.transcode_hw_decoding || 0,
      transcode_hw_encoding: session.transcode_hw_encoding || 0,
      media_type: Number(session.live) === 1 ? 'live' : normalizeMediaType(session.media_type),
      audio_codec: (session.audio_codec || '').toUpperCase() || 'unknown',
      stream_audio_codec: (session.stream_audio_codec || '').toUpperCase() || 'unknown',
      quality_profile: session.quality_profile || 'unknown',
      region_code: regionCode,
      location,
      full_location: fullLocation,
      player_state: playerState,
      device_type: platformName || 'unknown',
      relay: session.relayed || 0,
      secure: session.secure || '0',
      server: this.config.id,
    };

    const progress = Number(session.progress_percent);
    const fields: Record<string, string | number> = { hash: hashId, progress: Number.isFinite(progress) ? progress : 0 };
    if (latitude !== undefined && longitude !== undefined) {
      fields.lat = latitude;
      fields.lon = longitude;
    }
    const details = this.sessionDetails(session, geoData);
    Object.assign(tags, details.tags);
    Object.assign(fields, details.fields);

    return this.createDataPoint('Tautulli', tags, fields, undefined, ['lat', 'lon', 'transcode_speed', 'transcode_progress']);
  }

  private sessionDetails(
    session: TautulliSession,
    geoData: GeoIPInfo | null
  ): { tags: Record<string, string | number>; fields: Record<string, number> } {
    const decision = (value: string | undefined): string =>
      this.titleCase(value === 'copy' ? 'direct stream' : value || '') || 'unknown';
    const year = numberOf(session.year);
    const tags: Record<string, string | number> = {
      network: session.location === 'lan' || session.location === 'wan' ? session.location : 'unknown',
      live: session.live ?? 'unknown',
      audio_decision: decision(session.stream_audio_decision),
      subtitle_decision: decision(session.stream_subtitle_decision),
      container_decision: decision(session.stream_container_decision),
      video_codec: (session.video_codec || '').toUpperCase() || 'unknown',
      stream_video_codec: (session.stream_video_codec || '').toUpperCase() || 'unknown',
      video_resolution: resolutionLabel(session.video_resolution),
      stream_video_resolution: resolutionLabel(session.stream_video_resolution),
      video_dynamic_range: session.video_dynamic_range || 'unknown',
      stream_video_dynamic_range: session.stream_video_dynamic_range || 'unknown',
      year: year ?? 'unknown',
      genre: session.genres?.[0] || 'unknown',
      library_name: session.library_name || 'unknown',
      section_id: session.section_id || 'unknown',
      user_id: session.user_id ?? 'unknown',
      device: session.device || 'unknown',
      country: geoData?.country || 'unknown',
      country_code: geoData?.code || 'unknown',
    };

    const fields: Record<string, number> = {};
    const put = (key: string, value: number | undefined): void => {
      if (value !== undefined) {
        fields[key] = value;
      }
    };
    put('bandwidth', numberOf(session.bandwidth));
    put('stream_bitrate', numberOf(session.stream_bitrate));
    put('source_bitrate', numberOf(session.bitrate));
    const duration = numberOf(session.duration);
    put('duration_seconds', duration === undefined ? undefined : Math.floor(duration / 1000));
    const viewOffset = numberOf(session.view_offset);
    put('view_offset_seconds', viewOffset === undefined ? undefined : Math.floor(viewOffset / 1000));
    if (session.transcode_decision === 'transcode' || session.transcode_decision === 'copy') {
      put('transcode_speed', numberOf(session.transcode_speed));
      put('transcode_progress', numberOf(session.transcode_progress));
      put('transcode_throttled', numberOf(session.transcode_throttled) === undefined ? undefined : Number(Boolean(session.transcode_throttled)));
      put(
        'transcode_hw_full_pipeline',
        numberOf(session.transcode_hw_full_pipeline) === undefined ? undefined : Number(Boolean(session.transcode_hw_full_pipeline))
      );
    }
    return { tags, fields };
  }

  /**
   * Collect library statistics from Tautulli
   */
  private async collectLibraries(): Promise<DataPoint[]> {
    return this.safeFetch('collect Tautulli libraries', async () => {
      const points: DataPoint[] = [];
      const response = await this.api<paths>().get('/api/v2?cmd=get_libraries', {
        query: { apikey: this.config.apiKey },
      });

      if (!response?.response?.data) {
        this.logger.error('Invalid response from Tautulli get_libraries');
        return points;
      }

      const libraries = response.response.data;

      for (const library of libraries) {
        const total = parseInt(library.count ?? '0', 10) || 0;
        const sectionName = library.section_name ?? 'unknown';
        const sectionType = library.section_type ?? 'unknown';
        const fields: Record<string, string | number | boolean> = { total };
        if (typeof library.is_active === 'number') {
          fields.is_active = library.is_active ? 1 : 0;
        }

        // Add section-type specific fields
        if (sectionType === 'show') {
          fields.seasons = parseInt(library.parent_count || '0', 10) || 0;
          fields.episodes = parseInt(library.child_count || '0', 10) || 0;
        } else if (sectionType === 'artist') {
          fields.artists = total;
          fields.albums = parseInt(library.parent_count || '0', 10) || 0;
          fields.tracks = parseInt(library.child_count || '0', 10) || 0;
        }

        // For backward compatibility, also add 'libraries' field
        if (this.config.libraries.enabled) {
          fields.libraries = sectionName;
        }

        points.push(
          this.createDataPoint(
            'Tautulli',
            {
              type: 'library_stats',
              server: this.config.id,
              section_name: sectionName,
              section_type: sectionType,
              name: sectionName, // Legacy compatibility
            },
            fields
          )
        );
      }

      this.logger.info(`Collected ${libraries.length} library stats from Tautulli`);
      return points;
    });
  }

  /** Library stats, home stats, graphs and recently added items. */
  private async collectStats(): Promise<DataPoint[]> {
    const libraries = await this.collectLibraries();
    if (this.lastStatsAt !== undefined && Date.now() - this.lastStatsAt < TautulliPlugin.STATS_INTERVAL_MS) {
      return libraries;
    }
    const points = await this.safeFetch('collect Tautulli stats', async () => {
      const tautulli = this.api<paths>();
      const query = { apikey: this.config.apiKey };
      const window = { ...query, time_range: 30 };
      const days = { ...query, time_range: 7 };
      const [home, dayOfWeek, hourOfDay, platforms, users, byDate, byStreamType, concurrent, byMonth, recent] = await Promise.all([
        tautulli.get('/api/v2?cmd=get_home_stats', { query: { ...window, stats_count: 5 } }),
        tautulli.get('/api/v2?cmd=get_plays_by_dayofweek', { query: window }),
        tautulli.get('/api/v2?cmd=get_plays_by_hourofday', { query: window }),
        tautulli.get('/api/v2?cmd=get_stream_type_by_top_10_platforms', { query: window }),
        tautulli.get('/api/v2?cmd=get_stream_type_by_top_10_users', { query: window }),
        tautulli.get('/api/v2?cmd=get_plays_by_date', { query: days }),
        tautulli.get('/api/v2?cmd=get_plays_by_stream_type', { query: days }),
        tautulli.get('/api/v2?cmd=get_concurrent_streams_by_stream_type', { query: days }),
        tautulli.get('/api/v2?cmd=get_plays_per_month', { query: { ...query, time_range: 3 } }),
        tautulli.get('/api/v2?cmd=get_recently_added', { query: { ...query, count: '50' } }),
      ]);
      const specs: PointSpec[] = [
        ...homeStatPoints(home.response.data, new Date()),
        ...graphSnapshotPoints('PlaysByDayOfWeek', 'day', dayOfWeek.response.data),
        ...graphSnapshotPoints('PlaysByHourOfDay', 'hour', hourOfDay.response.data),
        ...graphSnapshotPoints('StreamTypeByPlatform', 'platform', platforms.response.data),
        ...graphSnapshotPoints('StreamTypeByUser', 'user', users.response.data),
      ];
      const graphs: [string, string, Graph, 'day' | 'month'][] = [
        ['plays_by_date', 'PlaysByDate', byDate.response.data, 'day'],
        ['plays_by_stream_type', 'PlaysByStreamType', byStreamType.response.data, 'day'],
        ['concurrent_streams', 'ConcurrentStreams', concurrent.response.data, 'day'],
        ['plays_by_month', 'PlaysByMonth', byMonth.response.data, 'month'],
      ];
      for (const [collector, type, graph, unit] of graphs) {
        specs.push(...(await this.bucketPoints(collector, type, graph, unit)));
      }
      specs.push(...(await this.recentlyAddedPoints(recent.response.data.recently_added ?? [])));
      return this.createPoints(specs);
    });
    this.lastStatsAt = Date.now();
    return [...libraries, ...points];
  }

  private async bucketPoints(collector: string, type: string, graph: Graph, unit: 'day' | 'month'): Promise<PointSpec[]> {
    const { buckets, skipped } = completedBuckets(graph, unit);
    if (skipped.length > 0) {
      this.logger.debug(`Skipped Tautulli ${type} categories that do not parse: ${skipped.join(', ')}`);
    }
    const fresh = await this.takeSettledBuckets(collector, buckets);
    return fresh.map((bucket) => ({ tags: { type }, fields: bucket.fields, timestamp: new Date(bucket.start) }));
  }

  private async recentlyAddedPoints(items: readonly RecentlyAddedItem[]): Promise<PointSpec[]> {
    const addedAt = (item: RecentlyAddedItem): number => (numberOf(item.added_at) ?? Number.NaN) * 1000;
    const fresh = await this.takeNewEvents('recently_added', items, addedAt, (item) => String(item.rating_key));
    return fresh.map((item) => {
      const fields: Record<string, string | number> = {
        hash: this.hashit(`${this.config.id}${item.rating_key}${item.added_at}`),
        title: item.full_title || item.title || 'unknown',
      };
      const year = numberOf(item.year);
      if (year !== undefined) {
        fields.year = year;
      }
      return {
        tags: {
          type: 'RecentlyAdded',
          media_type: normalizeMediaType(item.media_type),
          section_id: item.section_id || 'unknown',
          library_name: item.library_name || 'unknown',
          rating_key: item.rating_key || 'unknown',
        },
        fields,
        timestamp: eventTimestamp(addedAt(item), numberOf(item.rating_key)),
      };
    });
  }

  /** One point per play, once Tautulli has recorded its end. */
  private async collectHistory(): Promise<DataPoint[]> {
    return this.safeFetch('collect Tautulli history', async () => {
      const response = await this.api<paths>().get('/api/v2?cmd=get_history', {
        query: { apikey: this.config.apiKey, grouping: 0, include_activity: 0, order_column: 'stopped', order_dir: 'desc', length: 500 },
      });
      const stoppedAt = (row: HistoryRow): number => (typeof row.stopped === 'number' && row.stopped > 0 ? row.stopped * 1000 : Number.NaN);
      const plays = await this.takeNewEvents('history', response.response.data.data ?? [], stoppedAt, (row) => String(row.row_id));
      return this.createPoints(plays.map((row) => this.playPoint(row, stoppedAt(row))));
    });
  }

  private playPoint(row: HistoryRow, stoppedAt: number): PointSpec {
    const fields: Record<string, string | number> = {
      hash: this.hashit(`${this.config.id}${row.row_id}`),
      title: row.full_title || row.title || 'unknown',
    };
    const put = (key: string, value: number | null | undefined): void => {
      if (typeof value === 'number' && Number.isFinite(value)) {
        fields[key] = value;
      }
    };
    put('play_duration_seconds', row.play_duration);
    put('paused_seconds', row.paused_counter);
    put('percent_complete', row.percent_complete);
    put('watched_status', row.watched_status);
    return {
      tags: {
        type: 'Play',
        media_type: Number(row.live) === 1 ? 'live' : normalizeMediaType(row.media_type),
        rating_key: row.rating_key ?? 'unknown',
        user_id: row.user_id ?? 'unknown',
        username: row.user || 'unknown',
        platform: row.platform || 'unknown',
        player: row.player || 'unknown',
        product: row.product || 'unknown',
        transcode_decision: this.titleCase(row.transcode_decision === 'copy' ? 'direct stream' : row.transcode_decision || '') || 'unknown',
        network: row.location === 'lan' || row.location === 'wan' ? row.location : 'unknown',
        live: row.live ?? 'unknown',
      },
      fields,
      timestamp: eventTimestamp(stoppedAt, row.row_id),
      floatFields: ['watched_status'],
    };
  }

  /** Users table with per-user watch time over 1, 7 and 30 days and all time. */
  private async collectUsers(): Promise<DataPoint[]> {
    return this.safeFetch('collect Tautulli users', async () => {
      const tautulli = this.api<paths>();
      const table = await tautulli.get('/api/v2?cmd=get_users_table', { query: { apikey: this.config.apiKey, length: 10000 } });
      const users = table.response.data.data ?? [];
      const watchTimes = await mapLimit(users, TautulliPlugin.FAN_OUT, (user) =>
        tautulli.get('/api/v2?cmd=get_user_watch_time_stats', {
          query: { apikey: this.config.apiKey, user_id: String(user.user_id), query_days: WATCH_TIME_DAYS },
        })
      );
      const now = new Date();
      const lastSeen = users.map((user) => ageSeconds(typeof user.last_seen === 'number' ? user.last_seen * 1000 : undefined, now));
      const seenWithin = (seconds: number): number => lastSeen.filter((age) => age !== undefined && age <= seconds).length;
      const specs: PointSpec[] = users.map((user, index) => ({
        tags: { type: 'User', user_id: user.user_id ?? 'unknown', username: user.username || 'unknown', friendly_name: user.friendly_name || 'unknown' },
        fields: { ...this.userFields(user, lastSeen[index]), ...watchTimeFields(watchTimes[index].response.data) },
      }));
      specs.push({
        tags: { type: 'Users' },
        fields: { users: users.length, active: users.filter((user) => user.is_active === 1).length, seen_24h: seenWithin(DAY_SECONDS), seen_30d: seenWithin(30 * DAY_SECONDS) },
      });
      return this.createPoints(specs);
    });
  }

  private userFields(user: UserTableRow, lastSeenAge: number | undefined): Record<string, number> {
    const fields: Record<string, number> = {};
    const values: Record<string, number | null | undefined> = {
      plays: user.plays,
      duration_seconds: user.duration,
      last_seen_age_seconds: lastSeenAge,
      is_active: user.is_active,
      allow_guest: user.allow_guest,
      keep_history: user.keep_history,
    };
    for (const [key, value] of Object.entries(values)) {
      if (typeof value === 'number') {
        fields[key] = value;
      }
    }
    return fields;
  }

  /** Per-library watch time and media info (file sizes, resolutions, codecs). */
  private async collectLibraryMedia(): Promise<DataPoint[]> {
    return this.safeFetch('collect Tautulli library media', async () => {
      const tautulli = this.api<paths>();
      const query = { apikey: this.config.apiKey };
      const table = await tautulli.get('/api/v2?cmd=get_libraries_table', { query: { ...query, length: 10000 } });
      const sections = table.response.data.data ?? [];
      const now = new Date();
      const details = await mapLimit(sections, TautulliPlugin.FAN_OUT, async (section) => {
        const sectionId = String(section.section_id);
        const [watchTime, media] = await Promise.all([
          tautulli.get('/api/v2?cmd=get_library_watch_time_stats', { query: { ...query, section_id: sectionId, query_days: WATCH_TIME_DAYS } }),
          MEDIA_INFO_SECTION_TYPES.has(section.section_type ?? '') ? this.mediaInfo(sectionId, section.section_type === 'movie', now) : undefined,
        ]);
        return { watchTime: watchTime.response.data, media };
      });
      const specs: PointSpec[] = [];
      for (const [index, section] of sections.entries()) {
        const { watchTime, media } = details[index];
        const tags = { section_id: section.section_id ?? 'unknown', section_name: section.section_name || 'unknown', section_type: section.section_type || 'unknown' };
        specs.push({ tags: { type: 'Library', ...tags }, fields: { ...this.libraryFields(section, now), ...watchTimeFields(watchTime), ...this.mediaTotals(media, now) } });
        if (media?.last_refreshed !== null && media?.last_refreshed !== undefined) {
          specs.push(...mediaInfoPoints(tags, media.data ?? []));
        }
      }
      return this.createPoints(specs);
    });
  }

  /**
   * Tautulli serves media info from a cache only its UI refreshes. A refresh rebuilds rows from Plex, which drops the
   * show and artist sizes the UI computed, so only movie sections are refreshed; a failed refresh keeps the cached answer.
   */
  private async mediaInfo(sectionId: string, refreshable: boolean, now: Date): Promise<MediaInfoTable> {
    const tautulli = this.api<paths>();
    const query = { apikey: this.config.apiKey, section_id: sectionId, length: 100000 };
    const cached = (await tautulli.get('/api/v2?cmd=get_library_media_info', { query })).response.data;
    const age = ageSeconds(typeof cached.last_refreshed === 'number' ? cached.last_refreshed * 1000 : undefined, now);
    if (!refreshable || age === undefined || age < this.config.libraryMedia.intervalDays * DAY_SECONDS) {
      return cached;
    }
    try {
      return (await tautulli.get('/api/v2?cmd=get_library_media_info', { query: { ...query, refresh: 'true' } })).response.data;
    } catch (error) {
      this.logger.debug(`Tautulli media info refresh of section ${sectionId} failed, using the cache: ${error instanceof Error ? error.message : String(error)}`);
      return cached;
    }
  }

  private libraryFields(section: LibraryTableRow, now: Date): Record<string, number> {
    const fields: Record<string, number> = {};
    const values: Record<string, number | null | undefined> = {
      plays: section.plays,
      duration_seconds: section.duration,
      last_accessed_age_seconds: ageSeconds(typeof section.last_accessed === 'number' ? section.last_accessed * 1000 : undefined, now),
      is_active: section.is_active,
      keep_history: section.keep_history,
    };
    for (const [key, value] of Object.entries(values)) {
      if (typeof value === 'number') {
        fields[key] = value;
      }
    }
    return fields;
  }

  /** `last_refreshed` is null when the library has no item or Tautulli cannot read it. */
  private mediaTotals(media: MediaInfoTable | undefined, now: Date): Record<string, number> {
    if (media?.last_refreshed === null || media?.last_refreshed === undefined) {
      return {};
    }
    const fields: Record<string, number> = {};
    const age = ageSeconds(media.last_refreshed * 1000, now);
    if (age !== undefined) {
      fields.media_info_age_seconds = age;
    }
    if (media.recordsTotal !== undefined) {
      fields.media_items = media.recordsTotal;
    }
    const sizes = (media.data ?? []).map((row) => numberOf(row.file_size)).filter((size) => size !== undefined);
    if (sizes.length > 0) {
      fields.file_size = sizes.reduce((sum, size) => sum + size, 0);
    }
    return fields;
  }

  /**
   * Convert string to Title Case
   */
  private titleCase(str: string): string {
    if (!str) {return '';}
    return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
  }

  private async collectServerInfo(): Promise<DataPoint[]> {
    return this.safeFetch('collect Tautulli server info', async () => {
      const tautulli = this.api<paths>();
      const query = { apikey: this.config.apiKey };
      const [info, server, pmsUpdate, update] = await Promise.all([
        tautulli.get('/api/v2?cmd=get_tautulli_info', { query }),
        tautulli.get('/api/v2?cmd=get_server_info', { query }),
        tautulli.get('/api/v2?cmd=get_pms_update', { query }),
        this.checkTautulliUpdate(),
      ]);
      const tautulliInfo = info.response.data;
      const pms = server.response.data;
      const fields: Record<string, number> = booleanFlags({
        update_available: update,
        pms_update_available: pmsUpdate.response.data.update_available,
      });
      if (pms.pms_plexpass !== undefined) {
        fields.pms_plexpass = pms.pms_plexpass;
      }
      return [
        this.createServerInfoPoint(
          {
            version: tautulliInfo.tautulli_version || 'unknown',
            branch: tautulliInfo.tautulli_branch || 'unknown',
            pms_version: pms.pms_version || 'unknown',
          },
          fields
        ),
      ];
    });
  }

  /** Tautulli answers HTTP 400 when it cannot tell its own version: the flag is then unknown, not a failure. */
  private async checkTautulliUpdate(): Promise<boolean | undefined> {
    const now = Date.now();
    if (this.lastUpdateCheck && now - this.lastUpdateCheck.at < TautulliPlugin.UPDATE_CHECK_INTERVAL_MS) {
      return this.lastUpdateCheck.update;
    }
    let update: boolean | undefined;
    try {
      const response = await this.api<paths>().get('/api/v2?cmd=update_check', { query: { apikey: this.config.apiKey } });
      update = response.response.data.update;
    } catch (error) {
      this.logger.debug(`Tautulli update check failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    this.lastUpdateCheck = { at: now, update };
    return update;
  }
}
