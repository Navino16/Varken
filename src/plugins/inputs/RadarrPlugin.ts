import { BaseInputPlugin } from './BaseInputPlugin';
import { PROTOCOL_ID } from './constants';
import type { PluginMetadata, DataPoint, ScheduleConfig } from '../../types/plugin.types';
import type { RadarrConfig } from '../../types/inputs/radarr.types';
import type { paths } from '../../types/generated/radarr';
import { servarrServerInfo } from './utils/servarrServerInfo';
import { queueEnrichment, statusPoints, totalsPoint } from './utils/servarr';

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

  private readonly radarr = this.api<paths>();

  /**
   * Initialize the plugin and configure the HTTP client with API key header
   */
  async initialize(...args: Parameters<BaseInputPlugin<RadarrConfig>['initialize']>): Promise<void> {
    await super.initialize(...args);
    // Add API key header for Radarr
    this.httpClient.defaults.headers.common['X-Api-Key'] = this.config.apiKey;
  }

  /**
   * Health check endpoint for Radarr
   */
  protected getHealthEndpoint(): string {
    return '/api/v3/system/status';
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

    if (this.config.status.enabled) {
      points.push(...(await this.collectStatus()));
    }

    if (this.config.totals.enabled) {
      points.push(...(await this.collectTotals()));
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

    if (this.config.status.enabled) {
      schedules.push(this.createSchedule('status', this.config.status.intervalSeconds, true, this.collectStatus));
    }

    if (this.config.totals.enabled) {
      schedules.push(this.createSchedule('totals', this.config.totals.intervalSeconds, true, this.collectTotals));
    }

    if (this.config.serverInfo.enabled) {
      schedules.push(this.createSchedule('serverInfo', this.config.serverInfo.intervalSeconds, true, this.collectServerInfo));
    }

    return schedules;
  }

  /**
   * Collect queue data from Radarr
   */
  private async collectQueue(): Promise<DataPoint[]> {
    return this.safeFetch('collect Radarr queue', async () => {
      const points: DataPoint[] = [];
      const allRecords = await this.radarr.getAllPages('/api/v3/queue', {
        query: { includeMovie: true, includeUnknownMovieItems: false },
      });

      if (allRecords.length === 0) {
        this.logger.debug('No items in Radarr queue');
        return points;
      }

      const now = new Date();
      for (const queueItem of allRecords) {
        if (!queueItem.movie) {
          this.logger.debug('Skipping queue item with missing movie data');
          continue;
        }

        const movie = queueItem.movie;
        const name = `${movie.title} (${movie.year})`;
        const protocol = (queueItem.protocol ?? 'unknown').toUpperCase();
        const protocolId = protocol === 'USENET' ? PROTOCOL_ID.USENET : PROTOCOL_ID.TORRENT;
        const quality = queueItem.quality?.quality?.name || 'Unknown';

        const hashId = this.hashit(`${this.config.id}${name}${quality}`);

        const enrichment = queueEnrichment(queueItem, now);
        points.push(
          this.createDataPoint(
            'Radarr',
            {
              type: 'Queue',
              tmdbId: movie.tmdbId ?? 0,
              server: this.config.id,
              name,
              quality,
              protocol,
              protocol_id: protocolId,
              titleSlug: movie.titleSlug ?? 'unknown',
              ...enrichment.tags,
            },
            { hash: hashId, ...enrichment.fields },
            undefined,
            enrichment.floatFields
          )
        );
      }

      this.logger.info(`Collected ${points.length} queue items from Radarr`);
      return points;
    });
  }

  /**
   * Collect missing movies from Radarr
   */
  private async collectMissing(): Promise<DataPoint[]> {
    return this.safeFetch('collect Radarr missing movies', async () => {
      const points: DataPoint[] = [];
      const movies = await this.radarr.get('/api/v3/movie');

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

        const hashId = this.hashit(`${this.config.id}${movieName}${movie.tmdbId}`);

        points.push(
          this.createDataPoint(
            'Radarr',
            {
              type: 'Missing',
              Missing_Available: missingAvailable,
              tmdbId: movie.tmdbId ?? 0,
              server: this.config.id,
              name: movieName,
              titleSlug: movie.titleSlug ?? 'unknown',
            },
            {
              hash: hashId,
            }
          )
        );
      }

      this.logger.info(`Collected ${points.length} missing movies from Radarr`);
      return points;
    });
  }

  private async collectServerInfo(): Promise<DataPoint[]> {
    return this.safeFetch('collect Radarr server info', async () => {
      const [status, updates, health] = await Promise.all([
        this.radarr.get('/api/v3/system/status'),
        this.radarr.get('/api/v3/update'),
        this.radarr.get('/api/v3/health'),
      ]);
      const { tags, fields } = servarrServerInfo(status, updates, health, new Date());
      return [this.createServerInfoPoint(tags, fields)];
    });
  }

  private async collectStatus(): Promise<DataPoint[]> {
    return this.safeFetch('collect Radarr status', async () => {
      const [health, disks, roots, queue, tasks] = await Promise.all([
        this.radarr.get('/api/v3/health'),
        this.radarr.get('/api/v3/diskspace'),
        this.radarr.get('/api/v3/rootfolder'),
        this.radarr.get('/api/v3/queue/status'),
        this.radarr.get('/api/v3/system/task'),
      ]);
      return this.createPoints(statusPoints({ health, disks, roots, queue, tasks }, new Date(), (s) => this.hashit(s)));
    });
  }

  private async collectTotals(): Promise<DataPoint[]> {
    return this.safeFetch('collect Radarr totals', async () => {
      const wanted = { page: 1, pageSize: 1, monitored: true };
      const [missing, cutoff, blocklist] = await Promise.all([
        this.radarr.get('/api/v3/wanted/missing', { query: wanted }),
        this.radarr.get('/api/v3/wanted/cutoff', { query: wanted }),
        this.radarr.get('/api/v3/blocklist', { query: { page: 1, pageSize: 1 } }),
      ]);
      return this.createPoints([
        totalsPoint({ missing: missing.totalRecords, cutoff_unmet: cutoff.totalRecords, blocklist: blocklist.totalRecords }),
      ]);
    });
  }
}
