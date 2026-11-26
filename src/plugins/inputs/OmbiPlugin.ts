import { BaseInputPlugin } from './BaseInputPlugin';
import type { PluginMetadata, DataPoint, ScheduleConfig } from '../../types/plugin.types';
import type { OmbiConfig } from '../../types/inputs/ombi.types';
import type { components, paths } from '../../types/generated/ombi';
import { booleanFlags } from './utils/flags';
import { pickNumbers } from './utils/numbers';
import { dotnetTime } from './utils/time';

type OmbiMovieRequest = components['schemas']['Ombi.Store.Entities.Requests.MovieRequests'];
type OmbiTVRequest = components['schemas']['Ombi.Store.Entities.Requests.TvRequests'];
type OmbiChildRequest = components['schemas']['Ombi.Store.Entities.Requests.ChildRequests'];
type OmbiAlbumRequest = components['schemas']['Ombi.Store.Entities.Requests.AlbumRequest'];
type RequestBase = Pick<
  OmbiChildRequest,
  'approved' | 'available' | 'denied' | 'requestedDate' | 'markedAsApproved' | 'markedAsAvailable' | 'requestedUserId' | 'requestedByAlias' | 'source'
>;

const REQUEST_STATUS = { DENIED: 0, APPROVED: 1, COMPLETED: 2, PENDING: 3 } as const;
const REQUEST_TYPE = { TV: 0, MOVIE: 1, MUSIC: 2 } as const;

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
            ...pickNumbers(counts, { denied: 'denied' }),
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
   * Collect all requests (TV, movie and music) from Ombi
   */
  private async collectAllRequests(): Promise<DataPoint[]> {
    return this.safeFetch('collect Ombi requests', async () => {
      const [userMap, tvRequests, movieRequests, albumRequests] = await Promise.all([
        this.fetchUserMap(),
        this.ombi.get('/api/v1/Request/tv'),
        this.ombi.get('/api/v1/Request/movie'),
        this.ombi.get('/api/v1/request/music'),
      ]);

      const tvPoints = tvRequests.flatMap((request) => (request.childRequests ?? []).map((child) => this.tvPoint(request, child, userMap)));
      const points = [
        ...tvPoints,
        ...movieRequests.map((request) => this.moviePoint(request, userMap)),
        ...albumRequests.map((request) => this.albumPoint(request, userMap)),
      ];

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
            tv_requests: tvPoints.length,
            music: albumRequests.length,
          }
        )
      );

      this.logger.info(
        `Collected ${tvRequests.length} TV, ${movieRequests.length} movie and ${albumRequests.length} music requests from Ombi`
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

  /** One point per child request: each is a user's request for some seasons of the show. */
  private tvPoint(request: OmbiTVRequest, child: OmbiChildRequest, userMap: Map<string, string>): DataPoint {
    const fields: Record<string, number> = pickNumbers(child, { requestedUserPlayedProgress: 'requester_progress' });
    if (child.seasonRequests) {
      fields.seasons = child.seasonRequests.length;
      fields.episodes = child.seasonRequests.reduce((sum, season) => sum + (season.episodes?.length ?? 0), 0);
    }
    return this.requestPoint(REQUEST_TYPE.TV, request.title, child, userMap, this.hashit(`${request.id}${child.id}${request.tvDbId}${request.title}`), {}, fields);
  }

  private moviePoint(request: OmbiMovieRequest, userMap: Map<string, string>): DataPoint {
    const status4k = request.has4KRequest ? getRequestStatus(request.approved4K, request.available4K, request.denied4K) : 'none';
    return this.requestPoint(
      REQUEST_TYPE.MOVIE,
      request.title,
      request,
      userMap,
      this.hashit(`${request.id}${request.theMovieDbId}${request.title}`),
      { status_4k: status4k },
      {
        ...pickNumbers(request, { playedByUsersCount: 'played_by_users' }),
        ...booleanFlags({ watched_by_requester: request.watchedByRequestedUser }),
      }
    );
  }

  private albumPoint(request: OmbiAlbumRequest, userMap: Map<string, string>): DataPoint {
    return this.requestPoint(REQUEST_TYPE.MUSIC, request.title, request, userMap, this.hashit(`${request.id}${request.foreignAlbumId}${request.title}`), {}, {});
  }

  private requestPoint(
    requestType: number,
    title: string | null | undefined,
    request: RequestBase,
    userMap: Map<string, string>,
    hash: string,
    tags: Record<string, string | number>,
    fields: Record<string, number>
  ): DataPoint {
    return this.createDataPoint(
      'Ombi',
      {
        type: 'Requests',
        server: this.config.id,
        request_type: requestType,
        status: getRequestStatus(request.approved, request.available, request.denied),
        title: title || 'unknown',
        requested_user: this.resolveUserName(request.requestedUserId, request.requestedByAlias, userMap),
        requested_date: request.requestedDate || '',
        source: request.source ?? 'unknown',
        ...tags,
      },
      { hash, ...this.timingFields(request), ...fields }
    );
  }

  /** Seconds from the request to its approval and availability; Ombi stores DateTime.MinValue for "never". */
  private timingFields(request: RequestBase): Record<string, number> {
    const requested = dotnetTime(request.requestedDate);
    const since = (time: number | undefined): number | undefined =>
      requested === undefined || time === undefined || time < requested ? undefined : Math.floor((time - requested) / 1000);
    const fields: Record<string, number> = {};
    const approve = request.approved ? since(dotnetTime(request.markedAsApproved)) : undefined;
    const available = request.available ? since(dotnetTime(request.markedAsAvailable)) : undefined;
    if (approve !== undefined) {
      fields.approve_seconds = approve;
    }
    if (available !== undefined) {
      fields.available_seconds = available;
    }
    return fields;
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
