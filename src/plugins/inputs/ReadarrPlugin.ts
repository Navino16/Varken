import { BaseInputPlugin } from './BaseInputPlugin';
import { PROTOCOL_ID } from './constants';
import type { PluginMetadata, DataPoint, ScheduleConfig } from '../../types/plugin.types';
import type { ReadarrConfig } from '../../types/inputs/readarr.types';
import type { paths } from '../../types/generated/readarr';
import { servarrServerInfo } from './utils/servarrServerInfo';
import { queueEnrichment, statusPoints, totalsPoint, historyPoint } from './utils/servarr';

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

    if (this.config.status.enabled) {
      points.push(...(await this.collectStatus()));
    }

    if (this.config.totals.enabled) {
      points.push(...(await this.collectTotals()));
    }

    if (this.config.history.enabled) {
      points.push(...(await this.collectHistory()));
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

    if (this.config.totals.enabled) {
      schedules.push(this.createSchedule('totals', this.config.totals.intervalSeconds, true, this.collectTotals));
    }

    if (this.config.history.enabled) {
      schedules.push(this.createSchedule('history', this.config.history.intervalSeconds, true, this.collectHistory));
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

      const now = new Date();
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

        const enrichment = queueEnrichment(queueItem, now);
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
              ...enrichment.tags,
            },
            { hash: hashId, ...enrichment.fields },
            undefined,
            enrichment.floatFields
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
      const { tags, fields } = servarrServerInfo(status, updates, health, new Date());
      return [this.createServerInfoPoint(tags, fields)];
    });
  }

  private async collectStatus(): Promise<DataPoint[]> {
    return this.safeFetch('collect Readarr status', async () => {
      const [health, disks, roots, queue, tasks] = await Promise.all([
        this.readarr.get('/api/v1/health'),
        this.readarr.get('/api/v1/diskspace'),
        this.readarr.get('/api/v1/rootfolder'),
        this.readarr.get('/api/v1/queue/status'),
        this.readarr.get('/api/v1/system/task'),
      ]);
      return this.createPoints(statusPoints({ health, disks, roots, queue, tasks }, new Date(), (s) => this.hashit(s)));
    });
  }

  private async collectTotals(): Promise<DataPoint[]> {
    return this.safeFetch('collect Readarr totals', async () => {
      const wanted = { page: 1, pageSize: 1, monitored: true };
      const [missing, cutoff, blocklist] = await Promise.all([
        this.readarr.get('/api/v1/wanted/missing', { query: wanted }),
        this.readarr.get('/api/v1/wanted/cutoff', { query: wanted }),
        this.readarr.get('/api/v1/blocklist', { query: { page: 1, pageSize: 1 } }),
      ]);
      return this.createPoints([
        totalsPoint({ missing: missing.totalRecords, cutoff_unmet: cutoff.totalRecords, blocklist: blocklist.totalRecords }),
      ]);
    });
  }

  private async collectHistory(): Promise<DataPoint[]> {
    return this.safeFetch('collect Readarr history', async () => {
      const date = (await this.eventCursor('history')).toISOString();
      const records = await this.readarr.get('/api/v1/history/since', { query: { date, includeAuthor: false, includeBook: false } });
      const fresh = await this.takeNewEvents('history', records, (r) => Date.parse(r.date ?? ''), (r) => String(r.id));
      return this.createPoints(
        fresh.flatMap((r) => historyPoint(r, { authorId: r.authorId ?? 0, bookId: r.bookId ?? 0 }, this.hashit(`${this.config.id}${r.id}`)) ?? [])
      );
    });
  }
}
