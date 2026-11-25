import { BaseInputPlugin } from './BaseInputPlugin';
import { isPrivateIp } from './utils/network';
import { resolutionLabel } from './utils/mediaStreams';
import { RequestCache } from '../../utils/RequestCache';
import type { PluginMetadata, DataPoint, PointSpec, ScheduleConfig } from '../../types/plugin.types';
import type { TautulliConfig, GeoIPInfo } from '../../types/inputs/tautulli.types';
import type { components, paths } from '../../types/generated/tautulli';
import type { GetPath } from '../../types/api-contract';
import { booleanFlags } from './utils/flags';
import { numberOf } from './utils/numbers';
import { eventTimestamp } from './utils/events';
import { completedBuckets, graphSnapshotPoints, homeStatPoints, type GraphBucket } from './utils/tautulliStats';

type TautulliSession = components['schemas']['Session'];
type RecentlyAddedItem = components['schemas']['RecentlyAddedItem'];

const SERVER_INFO_PATH: GetPath<paths> = '/api/v2?cmd=get_server_info';

/**
 * Tautulli input plugin
 * Collects activity, libraries, and stats from Tautulli API v2
 */

const PLAYER_STATE = { PLAYING: 0, PAUSED: 1, BUFFERING: 3 } as const;

export class TautulliPlugin extends BaseInputPlugin<TautulliConfig> {
  private static readonly GEOIP_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
  private static readonly GEOIP_CACHE_MAX_SIZE = 1000;
  /** update_check makes Tautulli query GitHub uncached (up to 3 unauthenticated calls); Tautulli itself checks every few hours. */
  private static readonly UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
  private lastUpdateCheck?: { at: number; update: boolean | undefined };

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
      media_type: this.titleCase(session.media_type || '') || 'unknown',
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
      const buckets: [string, string, GraphBucket[]][] = [
        ['plays_by_date', 'PlaysByDate', completedBuckets(byDate.response.data, 'day')],
        ['plays_by_stream_type', 'PlaysByStreamType', completedBuckets(byStreamType.response.data, 'day')],
        ['concurrent_streams', 'ConcurrentStreams', completedBuckets(concurrent.response.data, 'day')],
        ['plays_by_month', 'PlaysByMonth', completedBuckets(byMonth.response.data, 'month')],
      ];
      for (const [collector, type, list] of buckets) {
        const fresh = await this.takeNewEvents(collector, list, (b) => b.end, (b) => b.category);
        specs.push(...fresh.map((b) => ({ tags: { type }, fields: b.fields, timestamp: new Date(b.start) })));
      }
      specs.push(...(await this.recentlyAddedPoints(recent.response.data.recently_added ?? [])));
      return this.createPoints(specs);
    });
    return [...libraries, ...points];
  }

  private async recentlyAddedPoints(items: readonly RecentlyAddedItem[]): Promise<PointSpec[]> {
    const addedAt = (item: RecentlyAddedItem): number => (numberOf(item.added_at) ?? Number.NaN) * 1000;
    const fresh = await this.takeNewEvents('recently_added', items, addedAt, (item) => String(item.rating_key));
    return fresh.map((item) => {
      const fields: Record<string, string | number> = {
        hash: this.hashit(`${this.config.id}${item.rating_key}`),
        title: item.full_title || item.title || 'unknown',
      };
      const year = numberOf(item.year);
      if (year !== undefined) {
        fields.year = year;
      }
      return {
        tags: {
          type: 'RecentlyAdded',
          media_type: item.media_type || 'unknown',
          section_id: item.section_id || 'unknown',
          library_name: item.library_name || 'unknown',
          rating_key: item.rating_key || 'unknown',
        },
        fields,
        timestamp: eventTimestamp(addedAt(item), numberOf(item.rating_key)),
      };
    });
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
