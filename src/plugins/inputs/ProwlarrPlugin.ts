import { BaseInputPlugin } from './BaseInputPlugin';
import type { PluginMetadata, DataPoint, ScheduleConfig } from '../../types/plugin.types';
import type { ProwlarrConfig, ProwlarrIndexerStats } from '../../types/inputs/prowlarr.types';

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

  /**
   * Initialize the plugin and configure the HTTP client with API key header
   */
  async initialize(config: ProwlarrConfig): Promise<void> {
    await super.initialize(config);
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

    return schedules;
  }

  /**
   * Collect indexer statistics from Prowlarr
   */
  private async collectIndexerStats(): Promise<DataPoint[]> {
    const points: DataPoint[] = [];

    try {
      const stats = await this.httpGet<ProwlarrIndexerStats[]>('/api/v1/indexerstats');

      if (!stats || stats.length === 0) {
        this.logger.debug('No indexer stats found in Prowlarr');
        return points;
      }

      for (const indexer of stats) {
        const hashId = this.hashit(`${this.config.id}${indexer.indexerId}${indexer.indexerName}`);

        points.push(
          this.createDataPoint(
            'Prowlarr',
            {
              type: 'IndexerStats',
              indexerId: indexer.indexerId,
              indexerName: indexer.indexerName,
              server: this.config.id,
            },
            {
              hash: hashId,
              averageResponseTime: indexer.averageResponseTime,
              numberOfQueries: indexer.numberOfQueries,
              numberOfGrabs: indexer.numberOfGrabs,
              numberOfRssQueries: indexer.numberOfRssQueries,
              numberOfAuthQueries: indexer.numberOfAuthQueries,
              numberOfFailedQueries: indexer.numberOfFailedQueries,
              numberOfFailedGrabs: indexer.numberOfFailedGrabs,
              numberOfFailedRssQueries: indexer.numberOfFailedRssQueries,
              numberOfFailedAuthQueries: indexer.numberOfFailedAuthQueries,
            }
          )
        );
      }

      this.logger.info(`Collected stats for ${points.length} indexers from Prowlarr`);
    } catch (error) {
      this.logger.error(`Failed to collect Prowlarr indexer stats: ${error}`);
    }

    return points;
  }
}
