import { createHash } from 'crypto';
import { BaseInputPlugin } from './BaseInputPlugin';
import type { PluginMetadata, DataPoint, ScheduleConfig } from '../../types/plugin.types';
import type {
  TautulliConfig,
  TautulliActivity,
  TautulliSession,
  TautulliLibrary,
  GeoIPInfo,
  GeoIPLookupFn,
  TautulliApiResponse,
} from '../../types/inputs/tautulli.types';

// Re-export for external use
export type { GeoIPLookupFn } from '../../types/inputs/tautulli.types';

/**
 * Generate MD5 hash for deterministic unique IDs (matching legacy behavior)
 */
function hashit(input: string): string {
  return createHash('md5').update(input).digest('hex');
}

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

  private geoipLookup?: GeoIPLookupFn;

  /**
   * Initialize the plugin and configure the HTTP client
   */
  async initialize(config: TautulliConfig): Promise<void> {
    await super.initialize(config);
  }

  /**
   * Set the GeoIP lookup function (injected by PluginManager)
   */
  setGeoIPLookup(lookupFn: GeoIPLookupFn): void {
    this.geoipLookup = lookupFn;
    this.logger.info('GeoIP lookup function enabled');
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
    }

    return points;
  }

  /**
   * Process a single Tautulli session into a DataPoint
   */
  private async processSession(session: TautulliSession): Promise<DataPoint | null> {
    // Get GeoIP data if enabled
    let geoData: GeoIPInfo | null = null;
    if (this.config.geoip.enabled && this.geoipLookup) {
      const ip = session.ip_address_public || session.ip_address;
      if (ip) {
        try {
          geoData = await this.geoipLookup(ip);
          if (geoData) {
            this.logger.debug(`GeoIP: ${ip} -> ${geoData.city}, ${geoData.region}, ${geoData.country}`);
          }
        } catch {
          this.logger.debug(`GeoIP lookup failed for ${ip}, trying fallback...`);
          if (this.config.fallbackIp) {
            try {
              geoData = await this.geoipLookup(this.config.fallbackIp);
              if (geoData) {
                this.logger.debug(`GeoIP fallback: ${this.config.fallbackIp} -> ${geoData.city}, ${geoData.region}, ${geoData.country}`);
              }
            } catch {
              this.logger.debug('Fallback IP lookup also failed');
            }
          }
        }
      }
    }

    // Default geo values (Area 51 coordinates as in legacy)
    let latitude = 37.234332396;
    let longitude = -115.80666344;
    let location = '👽';
    let regionCode = '';
    let fullLocation = '';

    if (geoData) {
      latitude = geoData.latitude || latitude;
      longitude = geoData.longitude || longitude;
      location = geoData.city || location;
      regionCode = geoData.region || '';
      fullLocation = `${geoData.region || ''} - ${geoData.city || ''}`;
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

    const hashId = hashit(
      `${session.session_id}${session.session_key}${session.username}${session.full_title}`
    );

    return this.createDataPoint(
      'Tautulli',
      {
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
        region_code: regionCode || 'unknown',
        location,
        full_location: fullLocation || 'unknown',
        latitude,
        longitude,
        player_state: playerState,
        device_type: platformName || 'unknown',
        relay: session.relayed || 0,
        secure: session.secure || '0',
        server: this.config.id,
      },
      {
        hash: hashId,
      }
    );
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
