import { createHash } from 'crypto';
import { BaseInputPlugin } from './BaseInputPlugin';
import { PluginMetadata, DataPoint, ScheduleConfig } from '../../types/plugin.types';
import {
  OmbiConfig,
  OmbiRequestCounts,
  OmbiIssuesCounts,
  OmbiMovieRequest,
  OmbiTVRequest,
} from '../../types/inputs/ombi.types';

/**
 * Generate MD5 hash for deterministic unique IDs (matching legacy behavior)
 */
function hashit(input: string): string {
  return createHash('md5').update(input).digest('hex');
}

/**
 * Request status codes (matching legacy behavior)
 * 0 = Denied
 * 1 = Approved
 * 2 = Completed (Approved + Available)
 * 3 = Pending
 */
function getRequestStatus(approved: boolean, available: boolean, denied: boolean): number {
  if (denied) return 0;
  if (approved && available) return 2;
  if (approved) return 1;
  return 3;
}

/**
 * Ombi input plugin
 * Collects request counts, issue counts, and all requests from Ombi API v1
 */
export class OmbiPlugin extends BaseInputPlugin<OmbiConfig> {
  readonly metadata: PluginMetadata = {
    name: 'Ombi',
    version: '1.0.0',
    description: 'Collects request counts and requests from Ombi',
  };

  /**
   * Initialize the plugin and configure the HTTP client with API key header
   */
  async initialize(config: OmbiConfig): Promise<void> {
    await super.initialize(config);
    // Add API key header for Ombi (different from Overseerr)
    this.httpClient.defaults.headers.common['ApiKey'] = this.config.apiKey;
  }

  /**
   * Collect all enabled data from Ombi
   */
  async collect(): Promise<DataPoint[]> {
    const points: DataPoint[] = [];

    if (this.config.requestCounts.enabled) {
      const requestCountsPoints = await this.collectRequestCounts();
      const allRequestsPoints = await this.collectAllRequests();
      points.push(...requestCountsPoints, ...allRequestsPoints);
    }

    if (this.config.issueCounts.enabled) {
      const issueCountsPoints = await this.collectIssueCounts();
      points.push(...issueCountsPoints);
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
            const allRequests = await this.collectAllRequests();
            return [...requestCounts, ...allRequests];
          }
        )
      );
    }

    if (this.config.issueCounts.enabled) {
      schedules.push(
        this.createSchedule(
          'issue_counts',
          this.config.issueCounts.intervalSeconds,
          true,
          this.collectIssueCounts
        )
      );
    }

    return schedules;
  }

  /**
   * Collect request counts from Ombi
   */
  private async collectRequestCounts(): Promise<DataPoint[]> {
    const points: DataPoint[] = [];

    try {
      const counts = await this.httpGet<OmbiRequestCounts>('/api/v1/Request/count');

      points.push(
        this.createDataPoint(
          'Ombi',
          {
            type: 'Request_Counts',
            server: this.config.id,
          },
          {
            pending: counts.pending,
            approved: counts.approved,
            available: counts.available,
          }
        )
      );

      this.logger.info('Collected request counts from Ombi');
    } catch (error) {
      this.logger.error(`Failed to collect Ombi request counts: ${error}`);
    }

    return points;
  }

  /**
   * Collect issue counts from Ombi
   */
  private async collectIssueCounts(): Promise<DataPoint[]> {
    const points: DataPoint[] = [];

    try {
      const issues = await this.httpGet<OmbiIssuesCounts>('/api/v1/Issues/count');

      points.push(
        this.createDataPoint(
          'Ombi',
          {
            type: 'Issues_Counts',
            server: this.config.id,
          },
          {
            pending: issues.pending,
            in_progress: issues.inProgress,
            resolved: issues.resolved,
          }
        )
      );

      this.logger.info('Collected issue counts from Ombi');
    } catch (error) {
      this.logger.error(`Failed to collect Ombi issue counts: ${error}`);
    }

    return points;
  }

  /**
   * Collect all requests (TV and movie) from Ombi
   */
  private async collectAllRequests(): Promise<DataPoint[]> {
    const points: DataPoint[] = [];

    try {
      // Fetch TV and movie requests in parallel
      const [tvRequests, movieRequests] = await Promise.all([
        this.httpGet<OmbiTVRequest[]>('/api/v1/Request/tv'),
        this.httpGet<OmbiMovieRequest[]>('/api/v1/Request/movie'),
      ]);

      // Process TV requests
      for (const request of tvRequests || []) {
        const tvPoint = this.processTVRequest(request);
        if (tvPoint) {
          points.push(tvPoint);
        }
      }

      // Process movie requests
      for (const request of movieRequests || []) {
        const moviePoint = this.processMovieRequest(request);
        if (moviePoint) {
          points.push(moviePoint);
        }
      }

      // Add request total summary
      points.push(
        this.createDataPoint(
          'Ombi',
          {
            type: 'Request_Total',
            server: this.config.id,
          },
          {
            total: (tvRequests?.length || 0) + (movieRequests?.length || 0),
            movies: movieRequests?.length || 0,
            tv_shows: tvRequests?.length || 0,
          }
        )
      );

      this.logger.info(
        `Collected ${tvRequests?.length || 0} TV and ${movieRequests?.length || 0} movie requests from Ombi`
      );
    } catch (error) {
      this.logger.error(`Failed to collect Ombi requests: ${error}`);
    }

    return points;
  }

  /**
   * Process a TV request into a DataPoint
   */
  private processTVRequest(request: OmbiTVRequest): DataPoint | null {
    if (!request.childRequests || request.childRequests.length === 0) {
      return null;
    }

    // Get the first child request for user/date info (matching legacy behavior)
    const childRequest = request.childRequests[0];

    const status = getRequestStatus(
      childRequest.approved,
      childRequest.available,
      childRequest.denied || false
    );

    const hashId = hashit(`${request.id}${request.tvDbId}${request.title}`);
    const requestedUser = childRequest.requestedByAlias || 'Unknown';
    const requestedDate = childRequest.requestedDate || '';

    return this.createDataPoint(
      'Ombi',
      {
        type: 'Requests',
        server: this.config.id,
        request_type: 0, // TV Show = 0
        status,
        title: request.title,
        requested_user: requestedUser,
        requested_date: requestedDate,
      },
      {
        hash: hashId,
      }
    );
  }

  /**
   * Process a movie request into a DataPoint
   */
  private processMovieRequest(request: OmbiMovieRequest): DataPoint | null {
    const status = getRequestStatus(request.approved, request.available, request.denied || false);

    const hashId = hashit(`${request.id}${request.theMovieDbId}${request.title}`);
    const requestedUser = request.requestedByAlias || 'Unknown';
    const requestedDate = request.requestedDate || '';

    return this.createDataPoint(
      'Ombi',
      {
        type: 'Requests',
        server: this.config.id,
        request_type: 1, // Movie = 1
        status,
        title: request.title,
        requested_user: requestedUser,
        requested_date: requestedDate,
      },
      {
        hash: hashId,
      }
    );
  }
}
