import { BaseInputPlugin } from './BaseInputPlugin';
import type { PluginMetadata, DataPoint, PointSpec, ScheduleConfig } from '../../types/plugin.types';
import type { OmbiConfig } from '../../types/inputs/ombi.types';
import type { components, paths } from '../../types/generated/ombi';
import { booleanFlags } from './utils/flags';
import { pickNumbers } from './utils/numbers';
import { ageSeconds, dotnetTime } from './utils/time';
import type { MediaType } from './utils/mediaType';

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
type RequestType = (typeof REQUEST_TYPE)[keyof typeof REQUEST_TYPE];
const REQUEST_MEDIA_TYPE: Record<RequestType, MediaType> = { [REQUEST_TYPE.TV]: 'show', [REQUEST_TYPE.MOVIE]: 'movie', [REQUEST_TYPE.MUSIC]: 'album' };
const STATS_WINDOW_MS: number = 30 * 24 * 60 * 60 * 1000;

type V2TotalPath = Extract<keyof paths, `/api/v2/Requests/${string}/${string}/{count}/{position}/{sort}/{sortOrder}`>;
type V1TotalPath = '/api/v1/Request/movie/total' | '/api/v1/Request/tv/total' | '/api/v1/request/music/total';

const V2_FIRST_ITEM = { count: 1, position: 0, sort: 'requestedDate', sortOrder: 'desc' };
const TOTALS: { mediaType: MediaType; total: V1TotalPath; statuses: [string, V2TotalPath][] }[] = [
  {
    mediaType: 'movie',
    total: '/api/v1/Request/movie/total',
    statuses: [
      ['available', '/api/v2/Requests/movie/available/{count}/{position}/{sort}/{sortOrder}'],
      ['processing', '/api/v2/Requests/movie/processing/{count}/{position}/{sort}/{sortOrder}'],
      ['pending', '/api/v2/Requests/movie/pending/{count}/{position}/{sort}/{sortOrder}'],
      ['denied', '/api/v2/Requests/movie/denied/{count}/{position}/{sort}/{sortOrder}'],
      ['unavailable', '/api/v2/Requests/movie/unavailable/{count}/{position}/{sort}/{sortOrder}'],
    ],
  },
  {
    mediaType: 'show',
    total: '/api/v1/Request/tv/total',
    statuses: [
      ['available', '/api/v2/Requests/tv/available/{count}/{position}/{sort}/{sortOrder}'],
      ['processing', '/api/v2/Requests/tv/processing/{count}/{position}/{sort}/{sortOrder}'],
      ['pending', '/api/v2/Requests/tv/pending/{count}/{position}/{sort}/{sortOrder}'],
      ['denied', '/api/v2/Requests/tv/denied/{count}/{position}/{sort}/{sortOrder}'],
      ['unavailable', '/api/v2/Requests/tv/unavailable/{count}/{position}/{sort}/{sortOrder}'],
    ],
  },
  {
    mediaType: 'album',
    total: '/api/v1/request/music/total',
    statuses: [
      ['available', '/api/v2/Requests/album/available/{count}/{position}/{sort}/{sortOrder}'],
      ['processing', '/api/v2/Requests/album/processing/{count}/{position}/{sort}/{sortOrder}'],
      ['pending', '/api/v2/Requests/album/pending/{count}/{position}/{sort}/{sortOrder}'],
      ['denied', '/api/v2/Requests/album/denied/{count}/{position}/{sort}/{sortOrder}'],
    ],
  },
];

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

    if (this.config.totals.enabled) {
      points.push(...(await this.collectTotals()));
    }

    if (this.config.users.enabled) {
      points.push(...(await this.collectUsers()));
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

    if (this.config.totals.enabled) {
      schedules.push(this.createSchedule('totals', this.config.totals.intervalSeconds, true, this.collectTotals));
    }

    if (this.config.users.enabled) {
      schedules.push(this.createSchedule('users', this.config.users.intervalSeconds, true, this.collectUsers));
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
    requestType: RequestType,
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
        media_type: REQUEST_MEDIA_TYPE[requestType],
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

  private async collectTotals(): Promise<DataPoint[]> {
    return this.safeFetch('collect Ombi totals', async () => {
      const now = Date.now();
      const [totals, stats] = await Promise.all([
        Promise.all(
          TOTALS.map(async ({ mediaType, total, statuses }) => {
            const [all, ...byStatus] = await Promise.all([
              this.ombi.get(total),
              ...statuses.map(async ([, path]) => (await this.ombi.get(path, { path: V2_FIRST_ITEM }))?.total),
            ]);
            const fields: Record<string, number> = pickNumbers({ all }, { all: 'total' });
            for (const [i, [status]] of statuses.entries()) {
              Object.assign(fields, pickNumbers({ value: byStatus[i] }, { value: status }));
            }
            return { tags: { type: 'Totals', media_type: mediaType }, fields };
          })
        ),
        // Ombi throws (500) when the window holds no request of a type: UserStatsEngine.GetSummary, v4.53.10.
        this.optionalFetch('Ombi 30-day stats', [500], () =>
          this.ombi.get('/api/v1/Stats', { query: { from: new Date(now - STATS_WINDOW_MS).toISOString(), to: new Date(now).toISOString() } })
        ),
      ]);
      const specs: PointSpec[] = [...totals];
      if (stats) {
        specs.push({
          tags: { type: 'Stats' },
          fields: pickNumbers(stats, { totalMovieRequests: 'movie_requests_30d', totalTvRequests: 'tv_requests_30d', completedRequestsTv: 'completed_tv_30d' }),
        });
      }
      return this.createPoints(specs);
    });
  }

  private async collectUsers(): Promise<DataPoint[]> {
    return this.safeFetch('collect Ombi users', async () => {
      const users = await this.ombi.get('/api/v1/Identity/Users');
      const now = new Date();
      const specs: PointSpec[] = users.map((user) => {
        const fields: Record<string, number> = booleanFlags({ has_logged_in: user.hasLoggedIn });
        const age = ageSeconds(dotnetTime(user.lastLoggedIn), now);
        if (age !== undefined) {
          fields.last_login_age_seconds = age;
        }
        for (const [prefix, quota] of [
          ['movie', user.movieRequestQuota],
          ['episode', user.episodeRequestQuota],
          ['music', user.musicRequestQuota],
        ] as const) {
          if (quota?.hasLimit) {
            Object.assign(fields, pickNumbers(quota, { limit: `${prefix}_quota_limit`, remaining: `${prefix}_quota_remaining` }));
          }
        }
        return {
          tags: { type: 'User', user_id: user.id || 'unknown', username: user.alias || user.userName || 'unknown', user_type: user.userType ?? 'unknown' },
          fields,
        };
      });
      const loggedInSince = now.getTime() - STATS_WINDOW_MS;
      specs.push({
        tags: { type: 'Users' },
        fields: { users: users.length, logged_in_30d: users.filter((user) => (dotnetTime(user.lastLoggedIn) ?? 0) >= loggedInSince).length },
      });
      return this.createPoints(specs);
    });
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
