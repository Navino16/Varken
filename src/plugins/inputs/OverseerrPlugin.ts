import { createHash } from 'crypto';
import { BaseInputPlugin } from './BaseInputPlugin';
import type { PluginMetadata, DataPoint, ScheduleConfig } from '../../types/plugin.types';
import type {
  OverseerrConfig,
  OverseerrRequestCounts,
  OverseerrIssuesCounts,
  OverseerrRequestsResponse,
  OverseerrMediaDetails,
} from '../../types/inputs/overseerr.types';

/**
 * Generate MD5 hash for deterministic unique IDs (matching legacy behavior)
 */
function hashit(input: string): string {
  return createHash('md5').update(input).digest('hex');
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

  /**
   * Initialize the plugin and configure the HTTP client with API key header
   */
  async initialize(config: OverseerrConfig): Promise<void> {
    await super.initialize(config);
    // Add API key header for Overseerr
    this.httpClient.defaults.headers.common['X-Api-Key'] = this.config.apiKey;
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
    const points: DataPoint[] = [];

    try {
      const counts = await this.httpGet<OverseerrRequestCounts>('/api/v1/request/count');

      points.push(
        this.createDataPoint(
          'Overseerr',
          {
            type: 'Request_Counts',
            server: this.config.id,
          },
          {
            pending: counts.pending,
            approved: counts.approved,
            processing: counts.processing,
            available: counts.available,
            total: counts.total,
            movies: counts.movie,
            tv: counts.tv,
            declined: counts.declined,
          }
        )
      );

      this.logger.info('Collected request counts from Overseerr');
    } catch (error) {
      this.logger.error(`Failed to collect Overseerr request counts: ${error}`);
    }

    return points;
  }

  /**
   * Collect issue counts from Overseerr
   */
  private async collectIssueCounts(): Promise<DataPoint[]> {
    const points: DataPoint[] = [];

    try {
      const issues = await this.httpGet<OverseerrIssuesCounts>('/api/v1/issue/count');

      points.push(
        this.createDataPoint(
          'Overseerr',
          {
            type: 'Issues_Counts',
            server: this.config.id,
          },
          {
            total: issues.total,
            video: issues.video,
            audio: issues.audio,
            subtitles: issues.subtitles,
            others: issues.others,
            open: issues.open,
            closed: issues.closed,
          }
        )
      );

      this.logger.info('Collected issue counts from Overseerr');
    } catch (error) {
      this.logger.error(`Failed to collect Overseerr issue counts: ${error}`);
    }

    return points;
  }

  /**
   * Collect latest requests from Overseerr
   */
  private async collectLatestRequests(): Promise<DataPoint[]> {
    const points: DataPoint[] = [];

    try {
      const count = this.config.latestRequests.count || 10;
      const response = await this.httpGet<OverseerrRequestsResponse>(
        `/api/v1/request?take=${count}&filter=all&sort=added`
      );

      if (!response?.results || response.results.length === 0) {
        this.logger.debug('No requests found in Overseerr');
        return points;
      }

      for (const request of response.results) {
        if (!request.media?.tmdbId) {
          continue;
        }

        try {
          let mediaInfo: OverseerrMediaDetails | null = null;
          let title = '';
          let requestType: number;

          if (request.type === 'tv') {
            // Request type: TV Show = 0
            requestType = 0;
            mediaInfo = await this.httpGet<OverseerrMediaDetails>(
              `/api/v1/tv/${request.media.tmdbId}`
            );
            title = mediaInfo?.name || '';
          } else {
            // Request type: Movie = 1
            requestType = 1;
            mediaInfo = await this.httpGet<OverseerrMediaDetails>(
              `/api/v1/movie/${request.media.tmdbId}`
            );
            title = mediaInfo?.title || '';
          }

          if (!mediaInfo || !title) {
            this.logger.debug(`Could not fetch media info for tmdbId ${request.media.tmdbId}`);
            continue;
          }

          const hashId = hashit(`${mediaInfo.id}${title}`);
          const requestedBy =
            mediaInfo.mediaInfo?.requests?.[0]?.requestedBy?.displayName || 'Unknown';
          const requestedDate = mediaInfo.mediaInfo?.requests?.[0]?.createdAt || '';

          points.push(
            this.createDataPoint(
              'Overseerr',
              {
                type: 'Requests',
                server: this.config.id,
                request_type: requestType,
                status: mediaInfo.mediaInfo?.status || 0,
                title,
                requested_user: requestedBy,
                requested_date: requestedDate,
              },
              {
                hash: hashId,
              }
            )
          );
        } catch (error) {
          this.logger.debug(`Failed to fetch details for request: ${error}`);
        }
      }

      this.logger.info(`Collected ${points.length} latest requests from Overseerr`);
    } catch (error) {
      this.logger.error(`Failed to collect Overseerr latest requests: ${error}`);
    }

    return points;
  }
}
