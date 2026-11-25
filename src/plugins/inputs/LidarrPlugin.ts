import { BaseInputPlugin } from './BaseInputPlugin';
import { PROTOCOL_ID } from './constants';
import type { PluginMetadata, DataPoint, ScheduleConfig } from '../../types/plugin.types';
import type { LidarrConfig } from '../../types/inputs/lidarr.types';
import type { paths } from '../../types/generated/lidarr';
import { servarrServerInfo } from './utils/servarrServerInfo';
import { queueEnrichment, statusPoints } from './utils/servarr';

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

  private readonly lidarr = this.api<paths>();

  /**
   * Initialize the plugin and configure the HTTP client with API key header
   */
  async initialize(...args: Parameters<BaseInputPlugin<LidarrConfig>['initialize']>): Promise<void> {
    await super.initialize(...args);
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

    if (this.config.status.enabled) {
      points.push(...(await this.collectStatus()));
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

    if (this.config.status.enabled) {
      schedules.push(this.createSchedule('status', this.config.status.intervalSeconds, true, this.collectStatus));
    }

    if (this.config.serverInfo.enabled) {
      schedules.push(this.createSchedule('serverInfo', this.config.serverInfo.intervalSeconds, true, this.collectServerInfo));
    }

    return schedules;
  }

  /**
   * Collect queue data from Lidarr
   */
  private async collectQueue(): Promise<DataPoint[]> {
    return this.safeFetch('collect Lidarr queue', async () => {
      const points: DataPoint[] = [];
      const allRecords = await this.lidarr.getAllPages('/api/v1/queue', {
        query: { includeAlbum: true, includeArtist: true, includeUnknownArtistItems: false },
      });

      if (allRecords.length === 0) {
        this.logger.debug('No items in Lidarr queue');
        return points;
      }

      const now = new Date();
      for (const queueItem of allRecords) {
        if (!queueItem.album) {
          this.logger.debug('Skipping queue item with missing album data');
          continue;
        }

        const album = queueItem.album;
        const artistName = queueItem.artist?.artistName || 'Unknown Artist';
        const name = `${album.title} - ${artistName}`;
        const protocol = (queueItem.protocol ?? 'unknown').toUpperCase();
        const protocolId = protocol === 'USENET' ? PROTOCOL_ID.USENET : PROTOCOL_ID.TORRENT;
        const quality = queueItem.quality?.quality?.name || 'Unknown';

        const hashId = this.hashit(`${this.config.id}${name}${quality}`);

        const enrichment = queueEnrichment(queueItem, now);
        points.push(
          this.createDataPoint(
            'Lidarr',
            {
              type: 'Queue',
              albumId: queueItem.albumId ?? 0,
              server: this.config.id,
              name,
              quality,
              protocol,
              protocol_id: protocolId,
              ...enrichment.tags,
            },
            { hash: hashId, ...enrichment.fields },
            undefined,
            enrichment.floatFields
          )
        );
      }

      this.logger.info(`Collected ${points.length} queue items from Lidarr`);
      return points;
    });
  }

  /**
   * Collect missing albums from Lidarr
   */
  private async collectMissing(): Promise<DataPoint[]> {
    return this.safeFetch('collect Lidarr missing albums', async () => {
      const points: DataPoint[] = [];
      const albums = await this.lidarr.getAllPages('/api/v1/wanted/missing', {
        query: { sortKey: 'releaseDate', sortDirection: 'descending', monitored: true, includeArtist: true },
      });

      if (albums.length === 0) {
        this.logger.debug('No missing albums found in Lidarr');
        return points;
      }

      for (const album of albums) {
        const artistName = album.artist?.artistName || 'Unknown Artist';
        const albumName = `${album.title ?? 'unknown'} - ${artistName}`;
        const foreignAlbumId = album.foreignAlbumId ?? 'unknown';

        const hashId = this.hashit(`${this.config.id}${albumName}${foreignAlbumId}`);

        points.push(
          this.createDataPoint(
            'Lidarr',
            {
              type: 'Missing',
              albumId: album.id ?? 0,
              foreignAlbumId,
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
      return points;
    });
  }

  private async collectServerInfo(): Promise<DataPoint[]> {
    return this.safeFetch('collect Lidarr server info', async () => {
      const [status, updates, health] = await Promise.all([
        this.lidarr.get('/api/v1/system/status'),
        this.lidarr.get('/api/v1/update'),
        this.lidarr.get('/api/v1/health'),
      ]);
      const { tags, fields } = servarrServerInfo(status, updates, health, new Date());
      return [this.createServerInfoPoint(tags, fields)];
    });
  }

  private async collectStatus(): Promise<DataPoint[]> {
    return this.safeFetch('collect Lidarr status', async () => {
      const [health, disks, roots, queue, tasks] = await Promise.all([
        this.lidarr.get('/api/v1/health'),
        this.lidarr.get('/api/v1/diskspace'),
        this.lidarr.get('/api/v1/rootfolder'),
        this.lidarr.get('/api/v1/queue/status'),
        this.lidarr.get('/api/v1/system/task'),
      ]);
      return this.createPoints(statusPoints({ health, disks, roots, queue, tasks }, new Date(), (s) => this.hashit(s)));
    });
  }
}
