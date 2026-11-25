import { BaseInputPlugin } from './BaseInputPlugin';
import type { PluginMetadata, DataPoint, ScheduleConfig } from '../../types/plugin.types';
import type { OmbiConfig } from '../../types/inputs/ombi.types';
import type { components, paths } from '../../types/generated/ombi';
import { booleanFlags } from './utils/flags';

type OmbiMovieRequest = components['schemas']['Ombi.Store.Entities.Requests.MovieRequests'];
type OmbiTVRequest = components['schemas']['Ombi.Store.Entities.Requests.TvRequests'];

const REQUEST_STATUS = { DENIED: 0, APPROVED: 1, COMPLETED: 2, PENDING: 3 } as const;
const REQUEST_TYPE = { TV: 0, MOVIE: 1 } as const;

function getRequestStatus(approved = false, available = false, denied: boolean | null = false): number {
  if (denied) {
    return REQUEST_STATUS.DENIED;
  }
  if (approved && available) {
    return REQUEST_STATUS.COMPLETED;
  }
  if (approved) {
    return REQUEST_STATUS.APPROVED;
  }
  return REQUEST_STATUS.PENDING;
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

  private readonly ombi = this.api<paths>();

  /**
   * Initialize the plugin and configure the HTTP client with API key header
   */
  async initialize(...args: Parameters<BaseInputPlugin<OmbiConfig>['initialize']>): Promise<void> {
    await super.initialize(...args);
    // Add API key header for Ombi (different from Overseerr)
    this.httpClient.defaults.headers.common.ApiKey = this.config.apiKey;
  }

  /**
   * Health check endpoint for Ombi
   */
  protected getHealthEndpoint(): string {
    return '/api/v1/Status';
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

    if (this.config.serverInfo.enabled) {
      schedules.push(this.createSchedule('serverInfo', this.config.serverInfo.intervalSeconds, true, this.collectServerInfo));
    }

    return schedules;
  }

  /**
   * Collect request counts from Ombi
   */
  private async collectRequestCounts(): Promise<DataPoint[]> {
    return this.safeFetch('collect Ombi request counts', async () => {
      const points: DataPoint[] = [];
      const counts = await this.ombi.get('/api/v1/Request/count');

      points.push(
        this.createDataPoint(
          'Ombi',
          {
            type: 'Request_Counts',
            server: this.config.id,
          },
          {
            pending: counts.pending ?? 0,
            approved: counts.approved ?? 0,
            available: counts.available ?? 0,
          }
        )
      );

      this.logger.info('Collected request counts from Ombi');
      return points;
    });
  }

  /**
   * Collect issue counts from Ombi
   */
  private async collectIssueCounts(): Promise<DataPoint[]> {
    return this.safeFetch('collect Ombi issue counts', async () => {
      const points: DataPoint[] = [];
      const issues = await this.ombi.get('/api/v1/Issues/count');

      points.push(
        this.createDataPoint(
          'Ombi',
          {
            type: 'Issues_Counts',
            server: this.config.id,
          },
          {
            pending: issues.pending ?? 0,
            in_progress: issues.inProgress ?? 0,
            resolved: issues.resolved ?? 0,
          }
        )
      );

      this.logger.info('Collected issue counts from Ombi');
      return points;
    });
  }

  /**
   * Fetch users and build a map of userId -> displayName
   */
  private async fetchUserMap(): Promise<Map<string, string>> {
    try {
      const users = await this.ombi.get('/api/v1/Identity/Users');
      const entries = users.flatMap((u): [string, string][] => {
        const name = u.alias || u.userName;
        return u.id && name ? [[u.id, name]] : [];
      });
      return new Map(entries);
    } catch (error) {
      this.logger.warn(`Failed to fetch Ombi users, falling back to alias: ${error instanceof Error ? error.message : String(error)}`);
      return new Map();
    }
  }

  /**
   * Collect all requests (TV and movie) from Ombi
   */
  private async collectAllRequests(): Promise<DataPoint[]> {
    return this.safeFetch('collect Ombi requests', async () => {
      const points: DataPoint[] = [];
      // Fetch users and requests in parallel
      const [userMap, tvRequests, movieRequests] = await Promise.all([
        this.fetchUserMap(),
        this.ombi.get('/api/v1/Request/tv'),
        this.ombi.get('/api/v1/Request/movie'),
      ]);

      for (const request of tvRequests) {
        const tvPoint = this.processTVRequest(request, userMap);
        if (tvPoint) {
          points.push(tvPoint);
        }
      }

      for (const request of movieRequests) {
        const moviePoint = this.processMovieRequest(request, userMap);
        if (moviePoint) {
          points.push(moviePoint);
        }
      }

      points.push(
        this.createDataPoint(
          'Ombi',
          {
            type: 'Request_Total',
            server: this.config.id,
          },
          {
            total: tvRequests.length + movieRequests.length,
            movies: movieRequests.length,
            tv_shows: tvRequests.length,
          }
        )
      );

      this.logger.info(
        `Collected ${tvRequests.length} TV and ${movieRequests.length} movie requests from Ombi`
      );
      return points;
    });
  }

  /**
   * Resolve the requested user's display name
   * Priority: userMap lookup > requestedByAlias > 'Unknown'
   */
  private resolveUserName(
    userId: string | null | undefined,
    alias: string | null | undefined,
    userMap: Map<string, string>
  ): string {
    if (userId) {
      return userMap.get(userId) ?? alias ?? 'Unknown';
    }
    return alias || 'Unknown';
  }

  /**
   * Process a TV request into a DataPoint
   */
  private processTVRequest(request: OmbiTVRequest, userMap: Map<string, string>): DataPoint | null {
    if (!request.childRequests?.length) {
      return null;
    }

    // Get the first child request for user/date info (matching legacy behavior)
    const childRequest = request.childRequests[0];

    const status = getRequestStatus(childRequest.approved, childRequest.available, childRequest.denied);

    const hashId = this.hashit(`${request.id}${request.tvDbId}${request.title}`);
    const requestedUser = this.resolveUserName(
      childRequest.requestedUserId,
      childRequest.requestedByAlias,
      userMap
    );
    const requestedDate = childRequest.requestedDate || '';

    return this.createDataPoint(
      'Ombi',
      {
        type: 'Requests',
        server: this.config.id,
        request_type: REQUEST_TYPE.TV,
        status,
        title: request.title || 'unknown',
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
  private processMovieRequest(
    request: OmbiMovieRequest,
    userMap: Map<string, string>
  ): DataPoint | null {
    const status = getRequestStatus(request.approved, request.available, request.denied);

    const hashId = this.hashit(`${request.id}${request.theMovieDbId}${request.title}`);
    const requestedUser = this.resolveUserName(
      request.requestedUserId,
      request.requestedByAlias,
      userMap
    );
    const requestedDate = request.requestedDate || '';

    return this.createDataPoint(
      'Ombi',
      {
        type: 'Requests',
        server: this.config.id,
        request_type: REQUEST_TYPE.MOVIE,
        status,
        title: request.title || 'unknown',
        requested_user: requestedUser,
        requested_date: requestedDate,
      },
      {
        hash: hashId,
      }
    );
  }

  private async collectServerInfo(): Promise<DataPoint[]> {
    return this.safeFetch('collect Ombi server info', async () => {
      const [about, update] = await Promise.all([this.ombi.get('/api/v1/Settings/about'), this.ombi.get('/api/v1/Update')]);
      return [
        this.createServerInfoPoint(
          { version: about?.version || 'unknown', branch: about?.branch || 'unknown' },
          booleanFlags({ update_available: update?.updateAvailable })
        ),
      ];
    });
  }
}
