import { BaseInputPlugin } from './BaseInputPlugin';
import { PROTOCOL_ID } from './constants';
import type { PluginMetadata, DataPoint, ScheduleConfig } from '../../types/plugin.types';
import type { SonarrConfig } from '../../types/inputs/sonarr.types';
import type { paths } from '../../types/generated/sonarr';
import { servarrServerInfo } from './utils/servarrServerInfo';

/**
 * Sonarr input plugin
 * Collects queue and calendar (missing/future) data from Sonarr v3 API
 */
export class SonarrPlugin extends BaseInputPlugin<SonarrConfig> {
  readonly metadata: PluginMetadata = {
    name: 'Sonarr',
    version: '1.0.0',
    description: 'Collects queue and calendar data from Sonarr',
  };

  private readonly sonarr = this.api<paths>();

  /**
   * Initialize the plugin and configure the HTTP client with API key header
   */
  async initialize(...args: Parameters<BaseInputPlugin<SonarrConfig>['initialize']>): Promise<void> {
    await super.initialize(...args);
    // Add API key header for Sonarr
    this.httpClient.defaults.headers.common['X-Api-Key'] = this.config.apiKey;
  }

  /**
   * Health check endpoint for Sonarr
   */
  protected getHealthEndpoint(): string {
    return '/api/v3/system/status';
  }

  /**
   * Collect all enabled data from Sonarr
   */
  async collect(): Promise<DataPoint[]> {
    const points: DataPoint[] = [];

    if (this.config.queue.enabled) {
      const queuePoints = await this.collectQueue();
      points.push(...queuePoints);
    }

    if (this.config.calendar.enabled) {
      const missingPoints = await this.collectCalendar('Missing');
      const futurePoints = await this.collectCalendar('Future');
      points.push(...missingPoints, ...futurePoints);
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

    if (this.config.calendar.enabled) {
      schedules.push(
        this.createSchedule(
          'calendar_missing',
          this.config.calendar.intervalSeconds,
          true,
          () => this.collectCalendar('Missing')
        )
      );
      schedules.push(
        this.createSchedule(
          'calendar_future',
          this.config.calendar.intervalSeconds,
          true,
          () => this.collectCalendar('Future')
        )
      );
    }

    if (this.config.serverInfo.enabled) {
      schedules.push(this.createSchedule('serverInfo', this.config.serverInfo.intervalSeconds, true, this.collectServerInfo));
    }

    return schedules;
  }

  /**
   * Collect queue data from Sonarr
   */
  private async collectQueue(): Promise<DataPoint[]> {
    return this.safeFetch('collect Sonarr queue', async () => {
      const points: DataPoint[] = [];
      const allRecords = await this.sonarr.getAllPages('/api/v3/queue', {
        query: { includeSeries: true, includeEpisode: true, includeUnknownSeriesItems: false },
      });

      if (allRecords.length === 0) {
        this.logger.debug('No items in Sonarr queue');
        return points;
      }

      for (const queueItem of allRecords) {
        if (!queueItem.series || !queueItem.episode) {
          this.logger.debug('Skipping queue item with missing series or episode data');
          continue;
        }

        const seriesTitle = queueItem.series.title ?? 'unknown';
        const episodeTitle = queueItem.episode.title ?? 'unknown';
        const sxe = this.formatSXE(queueItem.episode.seasonNumber, queueItem.episode.episodeNumber);
        const protocol = (queueItem.protocol ?? 'unknown').toUpperCase();
        const protocolId = protocol === 'USENET' ? PROTOCOL_ID.USENET : PROTOCOL_ID.TORRENT;
        const quality = queueItem.quality?.quality?.name || 'Unknown';

        const hashId = this.hashit(`${this.config.id}${seriesTitle}${sxe}`);

        points.push(
          this.createDataPoint(
            'Sonarr',
            {
              type: 'Queue',
              sonarrId: queueItem.seriesId ?? 0,
              server: this.config.id,
              name: seriesTitle,
              epname: episodeTitle,
              sxe,
              protocol,
              protocol_id: protocolId,
              quality,
            },
            {
              hash: hashId,
            }
          )
        );
      }

      this.logger.info(`Collected ${points.length} queue items from Sonarr`);
      return points;
    });
  }

  /**
   * Collect calendar data (missing or future episodes)
   */
  private async collectCalendar(queryType: 'Missing' | 'Future'): Promise<DataPoint[]> {
    return this.safeFetch(`collect Sonarr calendar (${queryType})`, async () => {
      const points: DataPoint[] = [];
      const today = new Date();
      const todayStr = today.toISOString();

      let startDate: string;
      let endDate: string;

      if (queryType === 'Missing') {
        const pastDate = new Date(today);
        pastDate.setDate(pastDate.getDate() - this.config.calendar.missingDays);
        startDate = pastDate.toISOString();
        endDate = todayStr;
      } else {
        const futureDate = new Date(today);
        futureDate.setDate(futureDate.getDate() + this.config.calendar.futureDays);
        startDate = todayStr;
        endDate = futureDate.toISOString();
      }

      const episodes = await this.sonarr.get('/api/v3/calendar', {
        query: { start: startDate, end: endDate, includeSeries: true },
      });

      if (episodes.length === 0) {
        this.logger.debug(`No ${queryType.toLowerCase()} episodes found in Sonarr calendar`);
        return points;
      }

      for (const episode of episodes) {
        if (!episode.series) {
          continue;
        }

        const downloaded = episode.hasFile ? 1 : 0;

        // For Missing query, only include monitored episodes without files
        if (queryType === 'Missing') {
          if (!episode.monitored || downloaded || this.isStillAiring(episode.airDateUtc, episode.runtime)) {
            continue;
          }
        }

        const seriesTitle = episode.series.title ?? 'unknown';
        const sxe = this.formatSXE(episode.seasonNumber, episode.episodeNumber);
        const hashId = this.hashit(`${this.config.id}${seriesTitle}${sxe}`);

        points.push(
          this.createDataPoint(
            'Sonarr',
            {
              type: queryType,
              sonarrId: episode.seriesId ?? 0,
              server: this.config.id,
              name: seriesTitle,
              epname: episode.title ?? 'unknown',
              sxe,
              airsUTC: episode.airDateUtc || '',
              downloaded,
            },
            {
              hash: hashId,
            }
          )
        );
      }

      this.logger.info(`Collected ${points.length} ${queryType.toLowerCase()} episodes from Sonarr`);
      return points;
    });
  }

  /** Like Sonarr's Wanted view, an episode only counts as missing once it has finished airing. */
  private isStillAiring(airDateUtc?: string | null, runtimeMinutes = 0): boolean {
    return Date.parse(airDateUtc ?? '') + runtimeMinutes * 60_000 > Date.now();
  }

  /**
   * Format season and episode numbers as SxxExx
   */
  private formatSXE(season = 0, episode = 0): string {
    return `S${season.toString().padStart(2, '0')}E${episode.toString().padStart(2, '0')}`;
  }

  private async collectServerInfo(): Promise<DataPoint[]> {
    return this.safeFetch('collect Sonarr server info', async () => {
      const [status, updates, health] = await Promise.all([
        this.sonarr.get('/api/v3/system/status'),
        this.sonarr.get('/api/v3/update'),
        this.sonarr.get('/api/v3/health'),
      ]);
      const { tags, fields } = servarrServerInfo(status, updates, health, new Date());
      return [this.createServerInfoPoint(tags, fields)];
    });
  }
}
