import { BaseInputPlugin } from './BaseInputPlugin';
import { PROTOCOL_ID } from './constants';
import type { PluginMetadata, DataPoint, PointSpec, ScheduleConfig } from '../../types/plugin.types';
import type { SonarrConfig } from '../../types/inputs/sonarr.types';
import type { paths } from '../../types/generated/sonarr';
import { servarrServerInfo } from './utils/servarrServerInfo';
import { queueEnrichment, statusPoints, totalsPoint, historyPoint, sumFields } from './utils/servarr';
import { pickNumbers } from './utils/numbers';
import { booleanFlags } from './utils/flags';

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

    if (this.config.status.enabled) {
      points.push(...(await this.collectStatus()));
    }

    if (this.config.totals.enabled) {
      points.push(...(await this.collectTotals()));
    }

    if (this.config.history.enabled) {
      points.push(...(await this.collectHistory()));
    }

    if (this.config.library.enabled) {
      points.push(...(await this.collectLibrary()));
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

    if (this.config.status.enabled) {
      schedules.push(this.createSchedule('status', this.config.status.intervalSeconds, true, this.collectStatus));
    }

    if (this.config.totals.enabled) {
      schedules.push(this.createSchedule('totals', this.config.totals.intervalSeconds, true, this.collectTotals));
    }

    if (this.config.history.enabled) {
      schedules.push(this.createSchedule('history', this.config.history.intervalSeconds, true, this.collectHistory));
    }

    if (this.config.library.enabled) {
      schedules.push(this.createSchedule('library', this.config.library.intervalDays * 24 * 60 * 60, true, this.collectLibrary));
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

      const now = new Date();
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

        const enrichment = queueEnrichment(queueItem, now);
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
              ...enrichment.tags,
            },
            { hash: hashId, ...enrichment.fields },
            undefined,
            enrichment.floatFields
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

  private async collectStatus(): Promise<DataPoint[]> {
    return this.safeFetch('collect Sonarr status', async () => {
      const [health, disks, roots, queue, tasks] = await Promise.all([
        this.sonarr.get('/api/v3/health'),
        this.sonarr.get('/api/v3/diskspace'),
        this.sonarr.get('/api/v3/rootfolder'),
        this.sonarr.get('/api/v3/queue/status'),
        this.sonarr.get('/api/v3/system/task'),
      ]);
      return this.createPoints(statusPoints({ health, disks, roots, queue, tasks }, new Date(), (s) => this.hashit(s)));
    });
  }

  private async collectTotals(): Promise<DataPoint[]> {
    return this.safeFetch('collect Sonarr totals', async () => {
      const wanted = { page: 1, pageSize: 1, monitored: true };
      const [missing, cutoff, blocklist] = await Promise.all([
        this.sonarr.get('/api/v3/wanted/missing', { query: wanted }),
        this.sonarr.get('/api/v3/wanted/cutoff', { query: wanted }),
        this.sonarr.get('/api/v3/blocklist', { query: { page: 1, pageSize: 1 } }),
      ]);
      return this.createPoints([
        totalsPoint({ missing: missing.totalRecords, cutoff_unmet: cutoff.totalRecords, blocklist: blocklist.totalRecords }),
      ]);
    });
  }

  private async collectHistory(): Promise<DataPoint[]> {
    return this.safeFetch('collect Sonarr history', async () => {
      const date = (await this.eventCursor('history')).toISOString();
      const records = await this.sonarr.get('/api/v3/history/since', { query: { date, includeSeries: false, includeEpisode: false } });
      const fresh = await this.takeNewEvents('history', records, (r) => Date.parse(r.date ?? ''), (r) => String(r.id));
      return this.createPoints(
        fresh.flatMap((r) => historyPoint(r, { seriesId: r.seriesId ?? 0, episodeId: r.episodeId ?? 0 }, this.hashit(`${this.config.id}${r.id}`)) ?? [])
      );
    });
  }

  private async collectLibrary(): Promise<DataPoint[]> {
    return this.safeFetch('collect Sonarr library', async () => {
      const series = await this.sonarr.get('/api/v3/series');
      const items: PointSpec[] = series.map((s) => ({
        tags: {
          type: 'Series',
          seriesId: s.id ?? 0,
          name: s.title ?? 'unknown',
          status: s.status ?? 'unknown',
          ended: s.ended ? 1 : 0,
          network: s.network || 'unknown',
          series_type: s.seriesType ?? 'unknown',
        },
        fields: {
          ...booleanFlags({ monitored: s.monitored }),
          ...pickNumbers(s.statistics, {
            seasonCount: 'season_count',
            episodeCount: 'episode_count',
            episodeFileCount: 'episode_file_count',
            totalEpisodeCount: 'total_episode_count',
            sizeOnDisk: 'size_on_disk',
            percentOfEpisodes: 'percent_of_episodes',
          }),
        },
        floatFields: ['percent_of_episodes'],
      }));
      const summary = {
        series: items.length,
        series_ended: series.filter((s) => s.ended).length,
        ...sumFields(items, {
          monitored: 'series_monitored',
          episode_count: 'episodes',
          episode_file_count: 'episode_files',
          total_episode_count: 'total_episodes',
          size_on_disk: 'size_on_disk',
        }),
      };
      return this.createPoints([{ tags: { type: 'Library' }, fields: summary }, ...items]);
    });
  }
}
