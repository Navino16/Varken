import { BaseInputPlugin } from './BaseInputPlugin';
import type { PluginMetadata, DataPoint, ScheduleConfig } from '../../types/plugin.types';
import type { OverseerrConfig } from '../../types/inputs/overseerr.types';
import type { components, paths } from '../../types/generated/seerr';

const REQUEST_TYPE = { TV: 0, MOVIE: 1 } as const;

interface MediaDetails {
  requestType: number;
  id?: number;
  title: string;
}

/**
 * Overseerr input plugin
 * Collects request counts, issue counts, and latest requests from Overseerr API v1
 */
export class OverseerrPlugin extends BaseInputPlugin<OverseerrConfig> {
  readonly metadata: PluginMetadata = {
    name: 'Overseerr',
    version: '1.0.0',
    description: 'Collects request counts and latest requests from Overseerr',
  };

  private readonly seerr = this.api<paths>('/api/v1');

  /**
   * Initialize the plugin and configure the HTTP client with API key header
   */
  async initialize(...args: Parameters<BaseInputPlugin<OverseerrConfig>['initialize']>): Promise<void> {
    await super.initialize(...args);
    // Add API key header for Overseerr
    this.httpClient.defaults.headers.common['X-Api-Key'] = this.config.apiKey;
  }

  /**
   * Health check endpoint for Overseerr
   */
  protected getHealthEndpoint(): string {
    return '/api/v1/status';
  }

  /**
   * Collect all enabled data from Overseerr
   */
  async collect(): Promise<DataPoint[]> {
    const points: DataPoint[] = [];

    if (this.config.requestCounts.enabled) {
      const requestCountsPoints = await this.collectRequestCounts();
      const issueCountsPoints = await this.collectIssueCounts();
      points.push(...requestCountsPoints, ...issueCountsPoints);
    }

    if (this.config.latestRequests.enabled) {
      const latestRequestsPoints = await this.collectLatestRequests();
      points.push(...latestRequestsPoints);
    }

    return points;
  }

  /**
   * Get schedule configurations for all enabled collectors
   */
  getSchedules(): ScheduleConfig[] {
    const schedules: ScheduleConfig[] = [];

    if (this.config.requestCounts.enabled) {
      schedules.push(
        this.createSchedule(
          'request_counts',
          this.config.requestCounts.intervalSeconds,
          true,
          async () => {
            const requestCounts = await this.collectRequestCounts();
            const issueCounts = await this.collectIssueCounts();
            return [...requestCounts, ...issueCounts];
          }
        )
      );
    }

    if (this.config.latestRequests.enabled) {
      schedules.push(
        this.createSchedule(
          'latest_requests',
          this.config.latestRequests.intervalSeconds,
          true,
          this.collectLatestRequests
        )
      );
    }

    return schedules;
  }

  /**
   * Collect request counts from Overseerr
   */
  private async collectRequestCounts(): Promise<DataPoint[]> {
    return this.safeFetch('collect Overseerr request counts', async () => {
      const points: DataPoint[] = [];
      const counts = await this.seerr.get('/request/count');

      points.push(
        this.createDataPoint(
          'Overseerr',
          {
            type: 'Request_Counts',
            server: this.config.id,
          },
          {
            pending: counts.pending ?? 0,
            approved: counts.approved ?? 0,
            processing: counts.processing ?? 0,
            available: counts.available ?? 0,
            total: counts.total ?? 0,
            movies: counts.movie ?? 0,
            tv: counts.tv ?? 0,
            declined: counts.declined ?? 0,
          }
        )
      );

      this.logger.info('Collected request counts from Overseerr');
      return points;
    });
  }

  /**
   * Collect issue counts from Overseerr
   */
  private async collectIssueCounts(): Promise<DataPoint[]> {
    return this.safeFetch('collect Overseerr issue counts', async () => {
      const points: DataPoint[] = [];
      const issues = await this.seerr.get('/issue/count');

      points.push(
        this.createDataPoint(
          'Overseerr',
          {
            type: 'Issues_Counts',
            server: this.config.id,
          },
          {
            total: issues.total ?? 0,
            video: issues.video ?? 0,
            audio: issues.audio ?? 0,
            subtitles: issues.subtitles ?? 0,
            others: issues.others ?? 0,
            open: issues.open ?? 0,
            closed: issues.closed ?? 0,
          }
        )
      );

      this.logger.info('Collected issue counts from Overseerr');
      return points;
    });
  }

  /**
   * Collect latest requests from Overseerr
   */
  private async collectLatestRequests(): Promise<DataPoint[]> {
    return this.safeFetch('collect Overseerr latest requests', async () => {
      const points: DataPoint[] = [];
      const count = this.config.latestRequests.count || 10;
      const response = await this.seerr.get('/request', {
        query: { take: count, filter: 'all', sort: 'added' },
      });

      if (!response?.results || response.results.length === 0) {
        this.logger.debug('No requests found in Overseerr');
        return points;
      }

      const results = await Promise.all(
        response.results.map(async (request) => {
          const tmdbId = request.media?.tmdbId;
          if (!tmdbId) {
            return null;
          }
          try {
            const details = await this.fetchMediaDetails(request.type, tmdbId);
            if (!details.title) {
              this.logger.debug(`Could not fetch media info for tmdbId ${tmdbId}`);
              return null;
            }

            return this.createDataPoint(
              'Overseerr',
              {
                type: 'Requests',
                server: this.config.id,
                request_type: details.requestType,
                status: request.status,
                media_status: request.media?.status ?? 0,
                title: details.title,
                requested_user: request.requestedBy?.displayName || 'Unknown',
                requested_date: request.createdAt || '',
              },
              {
                hash: this.hashit(`${details.id}${details.title}`),
              }
            );
          } catch (error) {
            this.logger.debug(`Failed to fetch details for request tmdbId=${tmdbId}: ${error instanceof Error ? error.message : String(error)}`);
            return null;
          }
        })
      );

      points.push(...results.filter((p): p is DataPoint => p !== null));

      this.logger.info(`Collected ${points.length} latest requests from Overseerr`);
      return points;
    });
  }

  private async fetchMediaDetails(type: components['schemas']['MediaRequest']['type'], tmdbId: number): Promise<MediaDetails> {
    if (type === 'tv') {
      const tv = await this.seerr.get('/tv/{tvId}', { path: { tvId: tmdbId } });
      return { requestType: REQUEST_TYPE.TV, id: tv?.id, title: tv?.name ?? '' };
    }
    const movie = await this.seerr.get('/movie/{movieId}', { path: { movieId: tmdbId } });
    return { requestType: REQUEST_TYPE.MOVIE, id: movie?.id, title: movie?.title ?? '' };
  }
}
