import { BaseInputPlugin } from './BaseInputPlugin';
import type { PluginMetadata, DataPoint, ScheduleConfig } from '../../types/plugin.types';
import type {
  TautulliConfig,
  TautulliActivity,
  TautulliSession,
  TautulliLibrary,
  GeoIPInfo,
  TautulliGeoIPResponse,
  TautulliApiResponse,
} from '../../types/inputs/tautulli.types';

/**
 * Tautulli input plugin
 * Collects activity, libraries, and stats from Tautulli API v2
 */
export class TautulliPlugin extends BaseInputPlugin<TautulliConfig> {
  readonly metadata: PluginMetadata = {
    name: 'Tautulli',
    version: '1.0.0',
    description: 'Collects activity, libraries, and stats from Tautulli',
  };

  /**
   * Initialize the plugin and configure the HTTP client
   */
  async initialize(config: TautulliConfig): Promise<void> {
    await super.initialize(config);

    // Log deprecation warnings for old config options
    if (config.geoip?.licenseKey) {
      this.logger.warn(
        'geoip.licenseKey is deprecated and ignored. GeoIP is now handled by Tautulli API.'
      );
    }
    if (config.fallbackIp) {
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
      await this.httpClient.get('/api/v2', {
        params: { apikey: this.config.apiKey, cmd: 'get_server_info' },
        timeout: 5000,
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

    if (this.config.libraries.enabled || this.config.stats.enabled) {
      const libraryPoints = await this.collectLibraries();
      points.push(...libraryPoints);
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
        this.createSchedule('stats', this.config.stats.intervalSeconds, true, this.collectLibraries)
      );
    }

    if (this.config.libraries.enabled) {
      // Libraries are collected less frequently (days instead of seconds)
      const intervalSeconds = this.config.libraries.intervalDays * 24 * 60 * 60;
      schedules.push(
        this.createSchedule('libraries', intervalSeconds, true, this.collectLibraries)
      );
    }

    return schedules;
  }

  /**
   * Collect activity data from Tautulli
   */
  private async collectActivity(): Promise<DataPoint[]> {
    const points: DataPoint[] = [];

    try {
      const response = await this.httpGet<TautulliApiResponse<TautulliActivity>>('/api/v2', {
        apikey: this.config.apiKey,
        cmd: 'get_activity',
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
            stream_count: parseInt(activity.stream_count) || 0,
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
    } catch (error) {
      this.logger.error(`Failed to collect Tautulli activity: ${error}`);
      throw error; // Propagate error for circuit breaker
    }

    return points;
  }

  /**
   * Perform GeoIP lookup using Tautulli API
   */
  private async geoipLookup(ip: string): Promise<GeoIPInfo | null> {
    try {
      const response = await this.httpGet<TautulliApiResponse<TautulliGeoIPResponse>>(
        '/api/v2',
        {
          apikey: this.config.apiKey,
          cmd: 'get_geoip_lookup',
          ip_address: ip,
        }
      );

      if (response?.response?.result !== 'success' || !response?.response?.data) {
        return null;
      }

      const data = response.response.data;
      return {
        city: data.city || '',
        region: data.region || '',
        country: data.country || '',
        latitude: data.latitude || 0,
        longitude: data.longitude || 0,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.debug(`GeoIP lookup failed for ${ip}: ${message}`);
      return null;
    }
  }

  /**
   * Check if an IP address is private/local (RFC 1918, loopback, link-local, etc.)
   */
  private isPrivateIP(ip: string): boolean {
    // IPv4 private ranges
    const privateRanges = [
      /^10\./, // 10.0.0.0/8
      /^172\.(1[6-9]|2[0-9]|3[0-1])\./, // 172.16.0.0/12
      /^192\.168\./, // 192.168.0.0/16
      /^127\./, // Loopback
      /^0\./, // Zero network
      /^169\.254\./, // Link-local
      /^224\./, // Multicast
      /^255\./, // Broadcast
    ];

    // IPv6 private ranges
    const privateIPv6Ranges = [
      /^::1$/, // Loopback
      /^fe80:/i, // Link-local
      /^fc00:/i, // Unique local
      /^fd00:/i, // Unique local
    ];

    for (const range of privateRanges) {
      if (range.test(ip)) {
        return true;
      }
    }

    for (const range of privateIPv6Ranges) {
      if (range.test(ip)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Process a single Tautulli session into a DataPoint
   */
  private async processSession(session: TautulliSession): Promise<DataPoint | null> {
    // Check if this is a local stream
    // Tautulli may return local as string '1' or number 1
    const tautulliSaysLocal = session.local === '1' || session.local === 1;
    const ip = session.ip_address_public || session.ip_address;
    const ipIsPrivate = ip ? this.isPrivateIP(ip) : false;

    // Determine if stream is local: either Tautulli says so, or IP is private
    const isLocal = tautulliSaysLocal || ipIsPrivate;

    // Get GeoIP data if enabled and not a local stream
    let geoData: GeoIPInfo | null = null;
    if (this.config.geoip.enabled && !isLocal && ip) {
      geoData = await this.geoipLookup(ip);
      if (geoData) {
        this.logger.debug(`GeoIP: ${ip} -> ${geoData.city}, ${geoData.region}, ${geoData.country}`);
      }
    } else if (this.config.geoip.enabled && isLocal && ip) {
      this.logger.debug(`Local stream detected: ${ip} (private IP: ${ipIsPrivate}, tautulli local: ${tautulliSaysLocal})`);
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
      latitude = geoData.latitude;
      longitude = geoData.longitude;
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
      quality = quality + 'p';
    }

    // Player state mapping
    let playerState: number;
    const state = (session.state || '').toLowerCase();
    switch (state) {
      case 'playing':
        playerState = 0;
        break;
      case 'paused':
        playerState = 1;
        break;
      case 'buffering':
        playerState = 3;
        break;
      default:
        playerState = 0;
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
    if (['Roku', 'osx', 'windows'].includes(session.platform)) {
      productVersion = productVersion.split('-')[0];
    }

    const hashId = this.hashit(
      `${session.session_id}${session.session_key}${session.username}${session.full_title}`
    );

    // Build tags object with optional latitude/longitude
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
      progress_percent: session.progress_percent || '0',
      region_code: regionCode,
      location,
      full_location: fullLocation,
      player_state: playerState,
      device_type: platformName || 'unknown',
      relay: session.relayed || 0,
      secure: session.secure || '0',
      server: this.config.id,
    };

    // Only add coordinates if they are defined
    if (latitude !== undefined) {
      tags.latitude = latitude;
    }
    if (longitude !== undefined) {
      tags.longitude = longitude;
    }

    return this.createDataPoint('Tautulli', tags, { hash: hashId });
  }

  /**
   * Collect library statistics from Tautulli
   */
  private async collectLibraries(): Promise<DataPoint[]> {
    const points: DataPoint[] = [];

    try {
      const response = await this.httpGet<TautulliApiResponse<TautulliLibrary[]>>('/api/v2', {
        apikey: this.config.apiKey,
        cmd: 'get_libraries',
      });

      if (!response?.response?.data) {
        this.logger.error('Invalid response from Tautulli get_libraries');
        return points;
      }

      const libraries = response.response.data;

      for (const library of libraries) {
        const fields: Record<string, string | number | boolean> = {
          total: parseInt(library.count) || 0,
        };

        // Add section-type specific fields
        if (library.section_type === 'show') {
          fields.seasons = parseInt(library.parent_count || '0') || 0;
          fields.episodes = parseInt(library.child_count || '0') || 0;
        } else if (library.section_type === 'artist') {
          fields.artists = parseInt(library.count) || 0;
          fields.albums = parseInt(library.parent_count || '0') || 0;
          fields.tracks = parseInt(library.child_count || '0') || 0;
        }

        // For backward compatibility, also add 'libraries' field
        if (this.config.libraries.enabled) {
          fields.libraries = library.section_name;
        }

        points.push(
          this.createDataPoint(
            'Tautulli',
            {
              type: 'library_stats',
              server: this.config.id,
              section_name: library.section_name,
              section_type: library.section_type,
              name: library.section_name, // Legacy compatibility
            },
            fields
          )
        );
      }

      this.logger.info(`Collected ${libraries.length} library stats from Tautulli`);
    } catch (error) {
      this.logger.error(`Failed to collect Tautulli libraries: ${error}`);
      throw error; // Propagate error for circuit breaker
    }

    return points;
  }

  /**
   * Convert string to Title Case
   */
  private titleCase(str: string): string {
    if (!str) {return '';}
    return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
  }
}
