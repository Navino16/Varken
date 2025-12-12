import { BaseInputPlugin } from './BaseInputPlugin';
import type { PluginMetadata, DataPoint, ScheduleConfig } from '../../types/plugin.types';
import type {
  ReadarrConfig,
  ReadarrQueueResponse,
  ReadarrQueue,
  ReadarrBook,
} from '../../types/inputs/readarr.types';

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

  /**
   * Initialize the plugin and configure the HTTP client with API key header
   */
  async initialize(config: ReadarrConfig): Promise<void> {
    await super.initialize(config);
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
   * Collect queue data from Readarr
   */
  private async collectQueue(): Promise<DataPoint[]> {
    const points: DataPoint[] = [];
    const pageSize = 250;
    let page = 1;
    let totalRecords = 0;
    const allRecords: ReadarrQueue[] = [];

    try {
      // Fetch all pages of the queue
      do {
        const response = await this.httpGet<ReadarrQueueResponse>('/api/v1/queue', {
          pageSize,
          page,
          includeBook: true,
          includeAuthor: true,
          includeUnknownBookItems: false,
        });

        totalRecords = response.totalRecords;
        allRecords.push(...response.records);
        page++;
      } while (allRecords.length < totalRecords);

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
        const protocol = queueItem.protocol.toUpperCase();
        const protocolId = protocol === 'USENET' ? 1 : 0;
        const quality = queueItem.quality?.quality?.name || 'Unknown';

        const hashId = this.hashit(`${this.config.id}${name}${quality}`);

        points.push(
          this.createDataPoint(
            'Readarr',
            {
              type: 'Queue',
              bookId: queueItem.bookId,
              server: this.config.id,
              name,
              quality,
              protocol,
              protocol_id: protocolId,
              titleSlug: book.titleSlug,
            },
            {
              hash: hashId,
            }
          )
        );
      }

      this.logger.info(`Collected ${points.length} queue items from Readarr`);
    } catch (error) {
      this.logger.error(`Failed to collect Readarr queue: ${error}`);
    }

    return points;
  }

  /**
   * Collect missing books from Readarr
   */
  private async collectMissing(): Promise<DataPoint[]> {
    const points: DataPoint[] = [];

    try {
      const books = await this.httpGet<ReadarrBook[]>('/api/v1/wanted/missing', {
        pageSize: 1000,
        sortKey: 'releaseDate',
        sortDirection: 'descending',
        monitored: true,
      });

      if (!books || books.length === 0) {
        this.logger.debug('No missing books found in Readarr');
        return points;
      }

      for (const book of books) {
        const authorName = book.author?.authorName || 'Unknown Author';
        const bookName = `${book.title} - ${authorName}`;

        const hashId = this.hashit(`${this.config.id}${bookName}${book.foreignBookId}`);

        points.push(
          this.createDataPoint(
            'Readarr',
            {
              type: 'Missing',
              bookId: book.id,
              foreignBookId: book.foreignBookId,
              server: this.config.id,
              name: bookName,
              titleSlug: book.titleSlug,
            },
            {
              hash: hashId,
            }
          )
        );
      }

      this.logger.info(`Collected ${points.length} missing books from Readarr`);
    } catch (error) {
      this.logger.error(`Failed to collect Readarr missing books: ${error}`);
    }

    return points;
  }
}
