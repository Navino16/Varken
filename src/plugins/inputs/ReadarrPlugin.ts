import { BaseInputPlugin } from './BaseInputPlugin';
import { PROTOCOL_ID } from './constants';
import type { PluginMetadata, DataPoint, ScheduleConfig } from '../../types/plugin.types';
import type { ReadarrConfig } from '../../types/inputs/readarr.types';
import type { paths } from '../../types/generated/readarr';
import { servarrServerInfo } from './utils/servarrServerInfo';

/**
 * Readarr input plugin
 * Collects queue and missing books data from Readarr v1 API
 */
export class ReadarrPlugin extends BaseInputPlugin<ReadarrConfig> {
  readonly metadata: PluginMetadata = {
    name: 'Readarr',
    version: '1.0.0',
    description: 'Collects queue and missing books data from Readarr',
  };

  private readonly readarr = this.api<paths>();

  /**
   * Initialize the plugin and configure the HTTP client with API key header
   */
  async initialize(...args: Parameters<BaseInputPlugin<ReadarrConfig>['initialize']>): Promise<void> {
    await super.initialize(...args);
    // Add API key header for Readarr
    this.httpClient.defaults.headers.common['X-Api-Key'] = this.config.apiKey;
  }

  /**
   * Health check endpoint for Readarr
   */
  protected getHealthEndpoint(): string {
    return '/api/v1/system/status';
  }

  /**
   * Collect all enabled data from Readarr
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

    if (this.config.serverInfo.enabled) {
      schedules.push(this.createSchedule('serverInfo', this.config.serverInfo.intervalSeconds, true, this.collectServerInfo));
    }

    return schedules;
  }

  /**
   * Collect queue data from Readarr
   */
  private async collectQueue(): Promise<DataPoint[]> {
    return this.safeFetch('collect Readarr queue', async () => {
      const points: DataPoint[] = [];
      const allRecords = await this.readarr.getAllPages('/api/v1/queue', {
        query: { includeBook: true, includeAuthor: true, includeUnknownAuthorItems: false },
      });

      if (allRecords.length === 0) {
        this.logger.debug('No items in Readarr queue');
        return points;
      }

      for (const queueItem of allRecords) {
        if (!queueItem.book) {
          this.logger.debug('Skipping queue item with missing book data');
          continue;
        }

        const book = queueItem.book;
        const authorName = queueItem.author?.authorName || 'Unknown Author';
        const name = `${book.title} - ${authorName}`;
        const protocol = (queueItem.protocol ?? 'unknown').toUpperCase();
        const protocolId = protocol === 'USENET' ? PROTOCOL_ID.USENET : PROTOCOL_ID.TORRENT;
        const quality = queueItem.quality?.quality?.name || 'Unknown';

        const hashId = this.hashit(`${this.config.id}${name}${quality}`);

        points.push(
          this.createDataPoint(
            'Readarr',
            {
              type: 'Queue',
              bookId: queueItem.bookId ?? 0,
              server: this.config.id,
              name,
              quality,
              protocol,
              protocol_id: protocolId,
              titleSlug: book.titleSlug ?? 'unknown',
            },
            {
              hash: hashId,
            }
          )
        );
      }

      this.logger.info(`Collected ${points.length} queue items from Readarr`);
      return points;
    });
  }

  /**
   * Collect missing books from Readarr
   */
  private async collectMissing(): Promise<DataPoint[]> {
    return this.safeFetch('collect Readarr missing books', async () => {
      const points: DataPoint[] = [];
      const books = await this.readarr.getAllPages('/api/v1/wanted/missing', {
        query: { sortKey: 'releaseDate', sortDirection: 'descending', monitored: true, includeAuthor: true },
      });

      if (books.length === 0) {
        this.logger.debug('No missing books found in Readarr');
        return points;
      }

      for (const book of books) {
        const authorName = book.author?.authorName || 'Unknown Author';
        const bookName = `${book.title ?? 'unknown'} - ${authorName}`;
        const foreignBookId = book.foreignBookId ?? 'unknown';

        const hashId = this.hashit(`${this.config.id}${bookName}${foreignBookId}`);

        points.push(
          this.createDataPoint(
            'Readarr',
            {
              type: 'Missing',
              bookId: book.id ?? 0,
              foreignBookId,
              server: this.config.id,
              name: bookName,
              titleSlug: book.titleSlug ?? 'unknown',
            },
            {
              hash: hashId,
            }
          )
        );
      }

      this.logger.info(`Collected ${points.length} missing books from Readarr`);
      return points;
    });
  }

  private async collectServerInfo(): Promise<DataPoint[]> {
    return this.safeFetch('collect Readarr server info', async () => {
      const [status, updates, health] = await Promise.all([
        this.readarr.get('/api/v1/system/status'),
        this.readarr.get('/api/v1/update'),
        this.readarr.get('/api/v1/health'),
      ]);
      const { tags, fields } = servarrServerInfo(status ?? {}, updates ?? [], health ?? [], new Date());
      return [this.createServerInfoPoint(tags, fields)];
    });
  }
}
