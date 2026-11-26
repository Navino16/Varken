import { BaseInputPlugin } from './BaseInputPlugin';
import type { PluginMetadata, DataPoint, PointSpec, ScheduleConfig } from '../../types/plugin.types';
import type { OverseerrConfig } from '../../types/inputs/overseerr.types';
import type { components, paths } from '../../types/generated/seerr';
import { booleanFlags } from './utils/flags';
import { isNumber, pickNumbers } from './utils/numbers';
import { mapLimit } from '../../utils/concurrency';

const REQUEST_TYPE = { TV: 0, MOVIE: 1 } as const;
const TITLE_CACHE_SIZE = 1000;
const USER_PAGE_SIZE = 100;
const QUOTA_CONCURRENCY = 4;

type MediaRequest = components['schemas']['MediaRequest'];
type Quota = paths['/user/{userId}/quota']['get']['responses'][200]['content']['application/json'];
type User = components['schemas']['User'];
type RequestFilter = NonNullable<NonNullable<paths['/request']['get']['parameters']['query']>['filter']>;
type MediaFilter = NonNullable<NonNullable<paths['/media']['get']['parameters']['query']>['filter']>;

const REQUEST_TOTALS: Partial<Record<RequestFilter, string>> = { failed: 'failed', unavailable: 'unavailable', deleted: 'deleted' };
const MEDIA_TOTALS: Partial<Record<MediaFilter, string>> = {
  all: 'total',
  available: 'available',
  partial: 'partially_available',
  allavailable: 'all_available',
  processing: 'processing',
  pending: 'pending',
};

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
  private readonly titles = new Map<string, string>();

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

    if (this.config.serverInfo.enabled) {
      points.push(...(await this.collectServerInfo()));
    }

    if (this.config.totals.enabled) {
      points.push(...(await this.collectTotals()));
    }

    if (this.config.status.enabled) {
      points.push(...(await this.collectStatus()));
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

    if (this.config.serverInfo.enabled) {
      schedules.push(this.createSchedule('serverInfo', this.config.serverInfo.intervalSeconds, true, this.collectServerInfo));
    }

    if (this.config.totals.enabled) {
      schedules.push(this.createSchedule('totals', this.config.totals.intervalSeconds, true, this.collectTotals));
    }

    if (this.config.status.enabled) {
      schedules.push(this.createSchedule('status', this.config.status.intervalSeconds, true, this.collectStatus));
    }

    if (this.config.users.enabled) {
      schedules.push(this.createSchedule('users', this.config.users.intervalSeconds, true, this.collectUsers));
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
            ...pickNumbers(counts, { completed: 'completed' }),
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
      const count = this.config.latestRequests.count || 10;
      const response = await this.seerr.get('/request', {
        query: { take: count, filter: 'all', sort: 'added' },
      });

      const requests = response?.results ?? [];
      if (requests.length === 0) {
        this.logger.debug('No requests found in Overseerr');
        return [];
      }

      const points = await Promise.all(requests.map(async (request) => this.requestPoint(request, await this.titleOf(request))));
      this.logger.info(`Collected ${points.length} latest requests from Overseerr`);
      return points;
    });
  }

  private requestPoint(request: MediaRequest, title: string): DataPoint {
    const media = request.media;
    const fields: Record<string, string | number> = { hash: this.hashit(`${media?.tmdbId}${title}`) };
    if (request.type === 'tv' && request.seasons) {
      fields.seasons = request.seasons.length;
    }
    return this.createDataPoint(
      'Overseerr',
      {
        type: 'Requests',
        server: this.config.id,
        request_type: request.type === 'tv' ? REQUEST_TYPE.TV : REQUEST_TYPE.MOVIE,
        status: request.status,
        media_status: media?.status ?? 0,
        title,
        requested_user: request.requestedBy ? this.userName(request.requestedBy) : 'Unknown',
        requested_date: request.createdAt || '',
        is_4k: request.is4k ? 1 : 0,
        media_type: request.type,
        media_status_4k: media?.status4k ?? 'unknown',
      },
      fields
    );
  }

  /** Titles come from TMDB through Seerr: cached by tmdbId, a failed lookup is retried on the next poll. */
  private async titleOf(request: MediaRequest): Promise<string> {
    const tmdbId = request.media?.tmdbId;
    if (!tmdbId) {
      return 'unknown';
    }
    const key = `${request.type}:${tmdbId}`;
    const cached = this.titles.get(key);
    if (cached) {
      return cached;
    }
    try {
      const title =
        request.type === 'tv'
          ? (await this.seerr.get('/tv/{tvId}', { path: { tvId: tmdbId } }))?.name
          : (await this.seerr.get('/movie/{movieId}', { path: { movieId: tmdbId } }))?.title;
      if (!title) {
        this.logger.debug(`Could not fetch media info for tmdbId ${tmdbId}`);
        return 'unknown';
      }
      if (this.titles.size >= TITLE_CACHE_SIZE) {
        this.titles.clear();
      }
      this.titles.set(key, title);
      return title;
    } catch (error) {
      this.logger.debug(`Failed to fetch details for request tmdbId=${tmdbId}: ${error instanceof Error ? error.message : String(error)}`);
      return 'unknown';
    }
  }

  private async collectTotals(): Promise<DataPoint[]> {
    return this.safeFetch('collect Overseerr totals', async () => {
      const requestFilters = Object.entries(REQUEST_TOTALS) as [RequestFilter, string][];
      const mediaFilters = Object.entries(MEDIA_TOTALS) as [MediaFilter, string][];
      const [requests, media] = await Promise.all([
        Promise.all(requestFilters.map(async ([filter]) => (await this.seerr.get('/request', { query: { filter, take: 1 } }))?.pageInfo?.results)),
        Promise.all(mediaFilters.map(async ([filter]) => (await this.seerr.get('/media', { query: { filter, take: 1 } }))?.pageInfo?.results)),
      ]);
      const fieldsOf = (names: [string, string][], values: (number | undefined)[]): Record<string, number> =>
        Object.fromEntries(names.flatMap(([, field], i) => (isNumber(values[i]) ? [[field, values[i]]] : [])));
      return this.createPoints([
        { tags: { type: 'RequestTotals' }, fields: fieldsOf(requestFilters, requests) },
        { tags: { type: 'MediaTotals' }, fields: fieldsOf(mediaFilters, media) },
      ]);
    });
  }

  private async collectStatus(): Promise<DataPoint[]> {
    return this.safeFetch('collect Overseerr status', async () => {
      const [jobs, cache, about, appdata] = await Promise.all([
        this.seerr.get('/settings/jobs'),
        this.seerr.get('/settings/cache'),
        this.seerr.get('/settings/about'),
        this.seerr.get('/status/appdata'),
      ]);
      const now = Date.now();
      const specs: PointSpec[] = (jobs ?? []).map((job) => {
        const fields: Record<string, string | number> = { name: job.name ?? 'unknown', ...booleanFlags({ running: job.running }) };
        const next = Date.parse(job.nextExecutionTime ?? '');
        if (Number.isFinite(next)) {
          fields.next_run_seconds = Math.floor((next - now) / 1000);
        }
        return { tags: { type: 'Job', job_id: job.id ?? 'unknown', job_type: job.type ?? 'unknown', interval: job.interval ?? 'unknown' }, fields };
      });
      const dns = cache?.dnsCache?.stats;
      specs.push(
        {
          tags: { type: 'Cache' },
          fields: {
            ...pickNumbers(cache?.imageCache?.tmdb, { size: 'tmdb_image_size', imageCount: 'tmdb_images' }),
            ...pickNumbers(cache?.imageCache?.avatar, { size: 'avatar_image_size', imageCount: 'avatar_images' }),
            ...pickNumbers(dns, {
              size: 'dns_size',
              maxSize: 'dns_max_size',
              hits: 'dns_hits',
              misses: 'dns_misses',
              failures: 'dns_failures',
              ipv4Fallbacks: 'dns_ipv4_fallbacks',
              hitRate: 'dns_hit_rate',
            }),
          },
          floatFields: ['dns_hit_rate'],
        },
        ...(cache?.apiCaches ?? []).map((apiCache) => ({
          tags: { type: 'ApiCache', cache_id: apiCache.id ?? 'unknown' },
          fields: {
            name: apiCache.name ?? 'unknown',
            ...pickNumbers(apiCache.stats, { hits: 'hits', misses: 'misses', keys: 'keys', ksize: 'key_size', vsize: 'value_size' }),
          },
        })),
        {
          tags: { type: 'Status' },
          fields: {
            ...pickNumbers(about, { totalRequests: 'total_requests', totalMediaItems: 'total_media_items' }),
            ...booleanFlags({ appdata: appdata?.appData, appdata_permissions: appdata?.appDataPermissions }),
          },
        }
      );
      return this.createPoints(specs);
    });
  }

  private async collectUsers(): Promise<DataPoint[]> {
    return this.safeFetch('collect Overseerr users', async () => {
      const users: User[] = [];
      let total = 0;
      for (let skip = 0; ; skip += USER_PAGE_SIZE) {
        const page = await this.seerr.get('/user', { query: { sort: 'requests', take: USER_PAGE_SIZE, skip } });
        const results = page?.results ?? [];
        total = page?.pageInfo?.results ?? users.length + results.length;
        users.push(...results);
        if (results.length < USER_PAGE_SIZE || users.length >= total) {
          break;
        }
      }
      const quotas = await mapLimit(users, QUOTA_CONCURRENCY, (user) => this.seerr.get('/user/{userId}/quota', { path: { userId: user.id } }));
      const specs: PointSpec[] = users.map((user, i) => ({
        tags: { type: 'User', user_id: user.id, display_name: this.userName(user), user_type: user.userType ?? 'unknown' },
        fields: {
          ...pickNumbers(user, { requestCount: 'requests' }),
          ...this.quotaFields('movie', quotas[i]?.movie),
          ...this.quotaFields('tv', quotas[i]?.tv),
        },
      }));
      specs.push({ tags: { type: 'Users' }, fields: { users: total } });
      return this.createPoints(specs);
    });
  }

  /** Seerr falls back to the e-mail address as display name for local users without user name. */
  private userName(user: User): string {
    const name = user.displayName && user.displayName !== user.email ? user.displayName : user.username || user.plexUsername;
    return name || `user_${user.id}`;
  }

  private quotaFields(prefix: string, quota: Quota['movie']): Record<string, number> {
    return {
      ...pickNumbers(quota, { limit: `${prefix}_quota_limit`, days: `${prefix}_quota_days`, used: `${prefix}_quota_used`, remaining: `${prefix}_quota_remaining` }),
      ...booleanFlags({ [`${prefix}_quota_restricted`]: quota?.restricted }),
    };
  }

  private async collectServerInfo(): Promise<DataPoint[]> {
    return this.safeFetch('collect Overseerr server info', async () => {
      const status = await this.seerr.get('/status', { query: { checkUpdateAvailable: true } });
      const fields = booleanFlags({ update_available: status?.updateAvailable, restart_pending: status?.restartRequired });
      if (status?.commitsBehind !== undefined) {
        fields.commits_behind = status.commitsBehind;
      }
      return [this.createServerInfoPoint({ version: status?.version || 'unknown' }, fields)];
    });
  }
}
