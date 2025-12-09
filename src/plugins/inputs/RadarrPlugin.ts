import { createHash } from 'crypto';
import { BaseInputPlugin } from './BaseInputPlugin';
import { PluginMetadata, DataPoint, ScheduleConfig } from '../../types/plugin.types';
import {
  RadarrConfig,
  RadarrQueueResponse,
  RadarrQueue,
  RadarrMovie,
} from '../../types/inputs/radarr.types';

/**
 * Generate MD5 hash for deterministic unique IDs (matching legacy behavior)
 */
function hashit(input: string): string {
  return createHash('md5').update(input).digest('hex');
}

/**
 * Radarr input plugin
 * Collects queue and missing movies data from Radarr v3 API
 */
export class RadarrPlugin extends BaseInputPlugin<RadarrConfig> {
  readonly metadata: PluginMetadata = {
    name: 'Radarr',
    version: '1.0.0',
    description: 'Collects queue and missing movies data from Radarr',
  };

  /**
   * Initialize the plugin and configure the HTTP client with API key header
   */
  async initialize(config: RadarrConfig): Promise<void> {
    await super.initialize(config);
    // Add API key header for Radarr
    this.httpClient.defaults.headers.common['X-Api-Key'] = this.config.apiKey;
  }

  /**
   * Collect all enabled data from Radarr
   */
  async collect(): Promise<DataPoint[]> {
    const points: DataPoint[] = [];

    if (this.config.queue.enabled) {
      const queuePoints = await this.collectQueue();
      points.push(...queuePoints);
    }

    if (this.config.missing.enabled) {
      const missingPoints = await this.collectMissing();
      points.push(...missingPoints);
    }

    return points;
  }

  /**
   * Get schedule configurations for all enabled collectors
   */
  getSchedules(): ScheduleConfig[] {
    const schedules: ScheduleConfig[] = [];

    if (this.config.queue.enabled) {
      schedules.push(
        this.createSchedule('queue', this.config.queue.intervalSeconds, true, this.collectQueue)
      );
    }

    if (this.config.missing.enabled) {
      schedules.push(
        this.createSchedule('missing', this.config.missing.intervalSeconds, true, this.collectMissing)
      );
    }

    return schedules;
  }

  /**
   * Collect queue data from Radarr
   */
  private async collectQueue(): Promise<DataPoint[]> {
    const points: DataPoint[] = [];
    const pageSize = 250;
    let page = 1;
    let totalRecords = 0;
    const allRecords: RadarrQueue[] = [];

    try {
      // Fetch all pages of the queue
      do {
        const response = await this.httpGet<RadarrQueueResponse>('/api/v3/queue', {
          pageSize,
          page,
          includeMovie: true,
          includeUnknownMovieItems: false,
        });

        totalRecords = response.totalRecords;
        allRecords.push(...response.records);
        page++;
      } while (allRecords.length < totalRecords);

      if (allRecords.length === 0) {
        this.logger.debug('No items in Radarr queue');
        return points;
      }

      for (const queueItem of allRecords) {
        if (!queueItem.movie) {
          this.logger.debug('Skipping queue item with missing movie data');
          continue;
        }

        const movie = queueItem.movie;
        const name = `${movie.title} (${movie.year})`;
        const protocol = queueItem.protocol.toUpperCase();
        const protocolId = protocol === 'USENET' ? 1 : 0;
        const quality = queueItem.quality?.quality?.name || 'Unknown';

        const hashId = hashit(`${this.config.id}${name}${quality}`);

        points.push(
          this.createDataPoint(
            'Radarr',
            {
              type: 'Queue',
              tmdbId: queueItem.id,
              server: this.config.id,
              name,
              quality,
              protocol,
              protocol_id: protocolId,
              titleSlug: movie.titleSlug,
            },
            {
              hash: hashId,
            }
          )
        );
      }

      this.logger.info(`Collected ${points.length} queue items from Radarr`);
    } catch (error) {
      this.logger.error(`Failed to collect Radarr queue: ${error}`);
    }

    return points;
  }

  /**
   * Collect missing movies from Radarr
   */
  private async collectMissing(): Promise<DataPoint[]> {
    const points: DataPoint[] = [];

    try {
      const movies = await this.httpGet<RadarrMovie[]>('/api/v3/movie');

      if (!movies || movies.length === 0) {
        this.logger.debug('No movies found in Radarr');
        return points;
      }

      for (const movie of movies) {
        // Only include monitored movies without files
        if (!movie.monitored || movie.hasFile) {
          continue;
        }

        // Missing_Available: 0 if available, 1 if not available yet
        const missingAvailable = movie.isAvailable ? 0 : 1;
        const movieName = `${movie.title} (${movie.year})`;

        const hashId = hashit(`${this.config.id}${movieName}${movie.tmdbId}`);

        points.push(
          this.createDataPoint(
            'Radarr',
            {
              type: 'Missing',
              Missing_Available: missingAvailable,
              tmdbId: movie.tmdbId,
              server: this.config.id,
              name: movieName,
              titleSlug: movie.titleSlug,
            },
            {
              hash: hashId,
            }
          )
        );
      }

      this.logger.info(`Collected ${points.length} missing movies from Radarr`);
    } catch (error) {
      this.logger.error(`Failed to collect Radarr missing movies: ${error}`);
    }

    return points;
  }
}
