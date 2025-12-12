import { BaseInputPlugin } from './BaseInputPlugin';
import type { PluginMetadata, DataPoint, ScheduleConfig } from '../../types/plugin.types';
import type {
  LidarrConfig,
  LidarrQueueResponse,
  LidarrQueue,
  LidarrAlbum,
} from '../../types/inputs/lidarr.types';

/**
 * Lidarr input plugin
 * Collects queue and missing albums data from Lidarr v1 API
 */
export class LidarrPlugin extends BaseInputPlugin<LidarrConfig> {
  readonly metadata: PluginMetadata = {
    name: 'Lidarr',
    version: '1.0.0',
    description: 'Collects queue and missing albums data from Lidarr',
  };

  /**
   * Initialize the plugin and configure the HTTP client with API key header
   */
  async initialize(config: LidarrConfig): Promise<void> {
    await super.initialize(config);
    this.httpClient.defaults.headers.common['X-Api-Key'] = this.config.apiKey;
  }

  /**
   * Health check endpoint for Lidarr
   */
  protected getHealthEndpoint(): string {
    return '/api/v1/system/status';
  }

  /**
   * Collect all enabled data from Lidarr
   */
  async collect(): Promise<DataPoint[]> {
    const points: DataPoint[] = [];

    if (this.config.queue.enabled) {
      const queuePoints = await this.collectQueue();
      points.push(...queuePoints);
    }

    if (this.config.missing.enabled) {
      const missingPoints = await this.collectMissing();
      points.push(...missingPoints);
    }

    return points;
  }

  /**
   * Get schedule configurations for all enabled collectors
   */
  getSchedules(): ScheduleConfig[] {
    const schedules: ScheduleConfig[] = [];

    if (this.config.queue.enabled) {
      schedules.push(
        this.createSchedule('queue', this.config.queue.intervalSeconds, true, this.collectQueue)
      );
    }

    if (this.config.missing.enabled) {
      schedules.push(
        this.createSchedule('missing', this.config.missing.intervalSeconds, true, this.collectMissing)
      );
    }

    return schedules;
  }

  /**
   * Collect queue data from Lidarr
   */
  private async collectQueue(): Promise<DataPoint[]> {
    const points: DataPoint[] = [];
    const pageSize = 250;
    let page = 1;
    let totalRecords = 0;
    const allRecords: LidarrQueue[] = [];

    try {
      do {
        const response = await this.httpGet<LidarrQueueResponse>('/api/v1/queue', {
          pageSize,
          page,
          includeAlbum: true,
          includeArtist: true,
          includeUnknownArtistItems: false,
        });

        totalRecords = response.totalRecords;
        allRecords.push(...response.records);
        page++;
      } while (allRecords.length < totalRecords);

      if (allRecords.length === 0) {
        this.logger.debug('No items in Lidarr queue');
        return points;
      }

      for (const queueItem of allRecords) {
        if (!queueItem.album) {
          this.logger.debug('Skipping queue item with missing album data');
          continue;
        }

        const album = queueItem.album;
        const artistName = queueItem.artist?.artistName || 'Unknown Artist';
        const name = `${album.title} - ${artistName}`;
        const protocol = queueItem.protocol.toUpperCase();
        const protocolId = protocol === 'USENET' ? 1 : 0;
        const quality = queueItem.quality?.quality?.name || 'Unknown';

        const hashId = this.hashit(`${this.config.id}${name}${quality}`);

        points.push(
          this.createDataPoint(
            'Lidarr',
            {
              type: 'Queue',
              albumId: queueItem.albumId,
              server: this.config.id,
              name,
              quality,
              protocol,
              protocol_id: protocolId,
            },
            {
              hash: hashId,
            }
          )
        );
      }

      this.logger.info(`Collected ${points.length} queue items from Lidarr`);
    } catch (error) {
      this.logger.error(`Failed to collect Lidarr queue: ${error}`);
    }

    return points;
  }

  /**
   * Collect missing albums from Lidarr
   */
  private async collectMissing(): Promise<DataPoint[]> {
    const points: DataPoint[] = [];

    try {
      const response = await this.httpGet<{ records: LidarrAlbum[] }>('/api/v1/wanted/missing', {
        pageSize: 1000,
        sortKey: 'releaseDate',
        sortDirection: 'descending',
        monitored: true,
      });

      const albums = response.records || [];

      if (albums.length === 0) {
        this.logger.debug('No missing albums found in Lidarr');
        return points;
      }

      for (const album of albums) {
        const artistName = album.artist?.artistName || 'Unknown Artist';
        const albumName = `${album.title} - ${artistName}`;

        const hashId = this.hashit(`${this.config.id}${albumName}${album.foreignAlbumId}`);

        points.push(
          this.createDataPoint(
            'Lidarr',
            {
              type: 'Missing',
              albumId: album.id,
              foreignAlbumId: album.foreignAlbumId,
              server: this.config.id,
              name: albumName,
            },
            {
              hash: hashId,
            }
          )
        );
      }

      this.logger.info(`Collected ${points.length} missing albums from Lidarr`);
    } catch (error) {
      this.logger.error(`Failed to collect Lidarr missing albums: ${error}`);
    }

    return points;
  }
}
