import { BaseInputPlugin } from './BaseInputPlugin';
import type { PluginMetadata, DataPoint, ScheduleConfig } from '../../types/plugin.types';
import type { OverseerrConfig } from '../../types/inputs/overseerr.types';
import type { components, paths } from '../../types/generated/seerr';
import { booleanFlags } from './utils/flags';
import { isNumber, pickNumbers } from './utils/numbers';

const REQUEST_TYPE = { TV: 0, MOVIE: 1 } as const;
const TITLE_CACHE_SIZE = 1000;

type MediaRequest = components['schemas']['MediaRequest'];
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
  deleted: 'deleted',
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
    if (request.seasons) {
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
        requested_user: request.requestedBy?.displayName || 'Unknown',
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
