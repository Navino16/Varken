import { BaseInputPlugin } from './BaseInputPlugin';
import type { PluginMetadata, DataPoint, PointSpec, ScheduleConfig } from '../../types/plugin.types';
import type { ProwlarrConfig } from '../../types/inputs/prowlarr.types';
import type { components, paths } from '../../types/generated/prowlarr';
import { servarrServerInfo } from './utils/servarrServerInfo';
import { healthPoints, pickNumbers, servarrTime, taskPoints } from './utils/servarr';
import { eventTimestamp } from './utils/events';

type IndexerStatistics = components['schemas']['IndexerStatistics'];
type IndexerResource = components['schemas']['IndexerResource'];

const DAY_MS = 86_400_000;

/**
 * Prowlarr input plugin
 * Collects indexer statistics from Prowlarr v1 API
 */
export class ProwlarrPlugin extends BaseInputPlugin<ProwlarrConfig> {
  readonly metadata: PluginMetadata = {
    name: 'Prowlarr',
    version: '1.0.0',
    description: 'Collects indexer statistics from Prowlarr',
  };

  private readonly prowlarr = this.api<paths>();

  /**
   * Initialize the plugin and configure the HTTP client with API key header
   */
  async initialize(...args: Parameters<BaseInputPlugin<ProwlarrConfig>['initialize']>): Promise<void> {
    await super.initialize(...args);
    this.httpClient.defaults.headers.common['X-Api-Key'] = this.config.apiKey;
  }

  /**
   * Health check endpoint for Prowlarr
   */
  protected getHealthEndpoint(): string {
    return '/api/v1/system/status';
  }

  /**
   * Collect all enabled data from Prowlarr
   */
  async collect(): Promise<DataPoint[]> {
    const points: DataPoint[] = [];

    if (this.config.indexerStats.enabled) {
      const statsPoints = await this.collectIndexerStats();
      points.push(...statsPoints);
    }

    if (this.config.status.enabled) {
      points.push(...(await this.collectStatus()));
    }

    if (this.config.history.enabled) {
      points.push(...(await this.collectHistory()));
    }

    if (this.config.inventory.enabled) {
      points.push(...(await this.collectInventory()));
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

    if (this.config.indexerStats.enabled) {
      schedules.push(
        this.createSchedule(
          'indexerStats',
          this.config.indexerStats.intervalSeconds,
          true,
          this.collectIndexerStats
        )
      );
    }

    if (this.config.status.enabled) {
      schedules.push(this.createSchedule('status', this.config.status.intervalSeconds, true, this.collectStatus));
    }

    if (this.config.history.enabled) {
      schedules.push(this.createSchedule('history', this.config.history.intervalSeconds, true, this.collectHistory));
    }

    if (this.config.inventory.enabled) {
      schedules.push(this.createSchedule('inventory', this.config.inventory.intervalSeconds, true, this.collectInventory));
    }

    if (this.config.serverInfo.enabled) {
      schedules.push(this.createSchedule('serverInfo', this.config.serverInfo.intervalSeconds, true, this.collectServerInfo));
    }

    return schedules;
  }

  /**
   * Collect indexer statistics from Prowlarr: cumulative, last 24h, per user agent and per host.
   */
  private async collectIndexerStats(): Promise<DataPoint[]> {
    return this.safeFetch('collect Prowlarr indexer stats', async () => {
      const now = new Date();
      const window = { startDate: new Date(now.getTime() - DAY_MS).toISOString(), endDate: now.toISOString() };
      // Window and indexer settings are extras: their failure must not cost the cumulative stats.
      const [cumulative, windowed, indexersResult] = await Promise.all([
        this.prowlarr.get('/api/v1/indexerstats'),
        this.settled('windowed indexer stats', this.prowlarr.get('/api/v1/indexerstats', { query: window })),
        this.settled('indexer settings', this.prowlarr.get('/api/v1/indexer')),
      ]);
      const settings = new Map((indexersResult ?? []).map((indexer) => [indexer.id, indexer]));
      const statsPoints = (stats: readonly IndexerStatistics[] | null | undefined, extraTags: Record<string, string>): DataPoint[] =>
        (stats ?? []).map((stat) => this.indexerStatsPoint(stat, settings.get(stat.indexerId), extraTags));

      const points = [
        ...statsPoints(cumulative?.indexers, { type: 'IndexerStats' }),
        ...statsPoints(windowed?.indexers, { type: 'IndexerStatsWindow', window: '24h' }),
        ...this.createPoints([
          ...(cumulative?.userAgents ?? []).map((ua) => ({
            tags: { type: 'UserAgentStats', user_agent: ua.userAgent || 'unknown' },
            fields: pickNumbers(ua, { numberOfQueries: 'numberOfQueries', numberOfGrabs: 'numberOfGrabs' }),
          })),
          ...(cumulative?.hosts ?? []).map((host) => ({
            tags: { type: 'HostStats', host: host.host || 'unknown' },
            fields: pickNumbers(host, { numberOfQueries: 'numberOfQueries', numberOfGrabs: 'numberOfGrabs' }),
          })),
        ]),
      ];

      if (points.length === 0) {
        this.logger.debug('No indexer stats found in Prowlarr');
      } else {
        this.logger.info(`Collected stats for ${cumulative?.indexers?.length ?? 0} indexers from Prowlarr`);
      }
      return points;
    });
  }

  private async settled<T>(what: string, request: Promise<T>): Promise<T | undefined> {
    try {
      return await request;
    } catch (error) {
      this.logger.warn(`Skipping Prowlarr ${what}: ${error instanceof Error ? error.message : String(error)}`);
      return undefined;
    }
  }

  private indexerStatsPoint(stat: IndexerStatistics, indexer: IndexerResource | undefined, extraTags: Record<string, string>): DataPoint {
    return this.createDataPoint(
      'Prowlarr',
      {
        ...extraTags,
        indexerId: stat.indexerId ?? 0,
        indexerName: stat.indexerName ?? 'unknown',
        server: this.config.id,
        protocol: indexer?.protocol ?? 'unknown',
        privacy: indexer?.privacy ?? 'unknown',
        enabled: indexer ? (indexer.enable ? 1 : 0) : 'unknown',
        priority: indexer?.priority ?? 'unknown',
      },
      {
        hash: this.hashit(`${this.config.id}${stat.indexerId}${stat.indexerName}`),
        averageResponseTime: stat.averageResponseTime ?? 0,
        ...pickNumbers(stat, { averageGrabResponseTime: 'averageGrabResponseTime' }),
        numberOfQueries: stat.numberOfQueries ?? 0,
        numberOfGrabs: stat.numberOfGrabs ?? 0,
        numberOfRssQueries: stat.numberOfRssQueries ?? 0,
        numberOfAuthQueries: stat.numberOfAuthQueries ?? 0,
        numberOfFailedQueries: stat.numberOfFailedQueries ?? 0,
        numberOfFailedGrabs: stat.numberOfFailedGrabs ?? 0,
        numberOfFailedRssQueries: stat.numberOfFailedRssQueries ?? 0,
        numberOfFailedAuthQueries: stat.numberOfFailedAuthQueries ?? 0,
      }
    );
  }

  private async collectStatus(): Promise<DataPoint[]> {
    return this.safeFetch('collect Prowlarr status', async () => {
      const [health, statuses, tasks] = await Promise.all([
        this.prowlarr.get('/api/v1/health'),
        this.prowlarr.get('/api/v1/indexerstatus'),
        this.prowlarr.get('/api/v1/system/task'),
      ]);
      const now = new Date();
      const ageOf = (time: string | null | undefined): number | undefined => {
        const at = servarrTime(time);
        return at === undefined ? undefined : Math.floor((now.getTime() - at) / 1000);
      };
      const indexerStatus: PointSpec[] = statuses.map((status) => {
        const disabledTill = servarrTime(status.disabledTill);
        const disabled = disabledTill !== undefined && disabledTill > now.getTime();
        return {
          tags: { type: 'IndexerStatus', indexerId: status.indexerId ?? 0 },
          fields: {
            disabled: disabled ? 1 : 0,
            ...(disabled ? { disabled_for_seconds: Math.ceil((disabledTill - now.getTime()) / 1000) } : {}),
            ...pickNumbers(
              { recent: ageOf(status.mostRecentFailure), initial: ageOf(status.initialFailure) },
              { recent: 'most_recent_failure_age_seconds', initial: 'initial_failure_age_seconds' }
            ),
          },
        };
      });
      return this.createPoints([
        ...healthPoints(health, (s) => this.hashit(s)),
        ...indexerStatus,
        { tags: { type: 'IndexerStatusSummary' }, fields: { disabled_indexers: indexerStatus.filter((p) => p.fields.disabled === 1).length } },
        ...taskPoints(tasks, now),
      ]);
    });
  }

  /** Grabs only: queries and RSS syncs are already counted by the indexer stats and would flood the store. */
  private async collectHistory(): Promise<DataPoint[]> {
    return this.safeFetch('collect Prowlarr history', async () => {
      const date = (await this.eventCursor('history')).toISOString();
      const records = await this.prowlarr.get('/api/v1/history/since', { query: { date, eventType: 'releaseGrabbed' } });
      const fresh = await this.takeNewEvents('history', records, (r) => Date.parse(r.date ?? ''), (r) => String(r.id));
      return this.createPoints(
        fresh.map((r) => {
          const data = r.data ?? {};
          const elapsed = data.elapsedTime ? Number(data.elapsedTime) : Number.NaN;
          return {
            tags: {
              type: 'History',
              indexerId: r.indexerId ?? 0,
              event_type: r.eventType ?? 'unknown',
              successful: r.successful ? 1 : 0,
              source: data.source || 'unknown',
              grab_method: data.grabMethod || 'unknown',
            },
            fields: { hash: this.hashit(`${this.config.id}${r.id}`), ...(Number.isFinite(elapsed) ? { elapsed_ms: elapsed } : {}) },
            timestamp: eventTimestamp(Date.parse(r.date ?? ''), r.id),
          };
        })
      );
    });
  }

  private async collectInventory(): Promise<DataPoint[]> {
    return this.safeFetch('collect Prowlarr inventory', async () => {
      const [indexers, applications] = await Promise.all([this.prowlarr.get('/api/v1/indexer'), this.prowlarr.get('/api/v1/applications')]);
      return this.createPoints([
        {
          tags: { type: 'Inventory' },
          fields: {
            indexers: indexers.length,
            indexers_enabled: indexers.filter((i) => i.enable).length,
            applications: applications.length,
            applications_syncing: applications.filter((a) => a.syncLevel !== 'disabled').length,
          },
        },
        ...applications.map((a) => ({
          tags: {
            type: 'Application',
            application: a.name || 'unknown',
            implementation: a.implementation || 'unknown',
            sync_level: a.syncLevel ?? 'unknown',
          },
          fields: { hash: this.hashit(`${this.config.id}${a.id}`) },
        })),
      ]);
    });
  }

  private async collectServerInfo(): Promise<DataPoint[]> {
    return this.safeFetch('collect Prowlarr server info', async () => {
      const [status, updates, health] = await Promise.all([
        this.prowlarr.get('/api/v1/system/status'),
        this.prowlarr.get('/api/v1/update'),
        this.prowlarr.get('/api/v1/health'),
      ]);
      const { tags, fields } = servarrServerInfo(status, updates, health, new Date());
      return [this.createServerInfoPoint(tags, fields)];
    });
  }
}
