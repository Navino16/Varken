import { BaseInputPlugin } from './BaseInputPlugin';
import type { PluginMetadata, DataPoint, PointSpec, ScheduleConfig } from '../../types/plugin.types';
import type { BazarrConfig } from '../../types/inputs/bazarr.types';
import type { components, paths } from '../../types/generated/bazarr';
import { uptimeSeconds } from './utils/uptime';
import { booleanFlags } from './utils/flags';
import { pickNumbers } from './utils/numbers';
import { eventTimestamp } from './utils/events';
import { bucketRange, type Bucket } from './utils/buckets';

const SCORE_FLOAT_FIELDS = ['score_percent'];
const HISTORY_PAGE_SIZE = 100;
const HISTORY_MAX_PAGES = 10;
const DAY_SECONDS = 24 * 60 * 60;
const JOB_STATUSES = ['pending', 'running', 'failed', 'completed'];

type MovieHistoryItem = components['schemas']['MovieHistoryItem'];
type EpisodeHistoryItem = components['schemas']['EpisodeHistoryItem'];

interface HistoryEvent<T> {
  item: T;
  time: number;
  id: string;
}

/**
 * Bazarr input plugin
 * Collects wanted subtitles and history data from Bazarr API
 */
export class BazarrPlugin extends BaseInputPlugin<BazarrConfig> {
  readonly metadata: PluginMetadata = {
    name: 'Bazarr',
    version: '1.0.0',
    description: 'Collects wanted subtitles and history data from Bazarr',
  };

  private readonly bazarr = this.api<paths>('/api');
  private warnedUnparsableHistory = false;

  /**
   * Initialize the plugin and configure the HTTP client with API key header
   */
  async initialize(...args: Parameters<BaseInputPlugin<BazarrConfig>['initialize']>): Promise<void> {
    await super.initialize(...args);
    this.httpClient.defaults.headers.common['X-API-KEY'] = this.config.apiKey;
  }

  /**
   * Health check endpoint for Bazarr
   */
  protected getHealthEndpoint(): string {
    return '/api/system/health';
  }

  /**
   * Collect all enabled data from Bazarr
   */
  async collect(): Promise<DataPoint[]> {
    const points: DataPoint[] = [];

    if (this.config.wanted.enabled) {
      const wantedPoints = await this.collectWanted();
      points.push(...wantedPoints);
    }

    if (this.config.history.enabled) {
      const historyPoints = await this.collectHistory();
      points.push(...historyPoints);
    }

    if (this.config.serverInfo.enabled) {
      points.push(...(await this.collectServerInfo()));
    }

    if (this.config.status.enabled) {
      points.push(...(await this.collectStatus()));
    }

    if (this.config.stats.enabled) {
      points.push(...(await this.collectStats()));
    }

    if (this.config.library.enabled) {
      points.push(...(await this.collectLibrary()));
    }

    return points;
  }

  /**
   * Get schedule configurations for all enabled collectors
   */
  getSchedules(): ScheduleConfig[] {
    const schedules: ScheduleConfig[] = [];

    if (this.config.wanted.enabled) {
      schedules.push(
        this.createSchedule('wanted', this.config.wanted.intervalSeconds, true, this.collectWanted)
      );
    }

    if (this.config.history.enabled) {
      schedules.push(
        this.createSchedule('history', this.config.history.intervalSeconds, true, this.collectHistory)
      );
    }

    if (this.config.serverInfo.enabled) {
      schedules.push(this.createSchedule('serverInfo', this.config.serverInfo.intervalSeconds, true, this.collectServerInfo));
    }

    if (this.config.status.enabled) {
      schedules.push(this.createSchedule('status', this.config.status.intervalSeconds, true, this.collectStatus));
    }

    if (this.config.stats.enabled) {
      schedules.push(this.createSchedule('stats', this.config.stats.intervalSeconds, true, this.collectStats));
    }

    if (this.config.library.enabled) {
      schedules.push(this.createSchedule('library', this.config.library.intervalDays * DAY_SECONDS, true, this.collectLibrary));
    }

    return schedules;
  }

  /**
   * Collect wanted subtitles from Bazarr (movies + episodes)
   */
  private async collectWanted(): Promise<DataPoint[]> {
    return this.safeFetch('collect Bazarr wanted subtitles', async () => {
      const points: DataPoint[] = [];
      // Collect wanted movies
      const { data: wantedMovies, total: movieTotal } = await this.bazarr.get('/movies/wanted', { query: { length: 1000 } });

      for (const movie of wantedMovies) {
        for (const subtitle of movie.missing_subtitles) {
          const { language, languageCode } = this.languageTags(subtitle);
          const name = `${movie.title} - ${language}`;
          const hashId = this.hashit(`${this.config.id}${movie.radarrId}${languageCode}`);

          points.push(
            this.createDataPoint(
              'Bazarr',
              {
                type: 'Wanted',
                media_type: 'movie',
                radarrId: movie.radarrId,
                server: this.config.id,
                name,
                title: movie.title,
                language,
                languageCode,
                forced: subtitle.forced ? 1 : 0,
                hi: subtitle.hi ? 1 : 0,
                tags: this.tagList(movie.tags),
              },
              {
                hash: hashId,
              }
            )
          );
        }
      }

      // Collect wanted episodes
      const { data: wantedEpisodes, total: episodeTotal } = await this.bazarr.get('/episodes/wanted', { query: { length: 1000 } });

      for (const episode of wantedEpisodes) {
        for (const subtitle of episode.missing_subtitles) {
          const { language, languageCode } = this.languageTags(subtitle);
          const name = `${episode.seriesTitle} - ${episode.episode_number} - ${language}`;
          const hashId = this.hashit(
            `${this.config.id}${episode.sonarrEpisodeId}${languageCode}`
          );

          points.push(
            this.createDataPoint(
              'Bazarr',
              {
                type: 'Wanted',
                media_type: 'episode',
                sonarrSeriesId: episode.sonarrSeriesId,
                sonarrEpisodeId: episode.sonarrEpisodeId,
                server: this.config.id,
                name,
                seriesTitle: episode.seriesTitle,
                episodeNumber: episode.episode_number,
                language,
                languageCode,
                forced: subtitle.forced ? 1 : 0,
                hi: subtitle.hi ? 1 : 0,
                tags: this.tagList(episode.tags),
                series_type: episode.seriesType ?? 'unknown',
              },
              {
                hash: hashId,
              }
            )
          );
        }
      }

      points.push(...this.createPoints([{ tags: { type: 'WantedTotal' }, fields: pickNumbers({ movies: movieTotal, episodes: episodeTotal }, { movies: 'movies', episodes: 'episodes' }) }]));
      this.logger.info(`Collected ${points.length} wanted subtitles from Bazarr`);
      return points;
    });
  }

  /**
   * Subtitle history from Bazarr (movies + series) as events: only those newer than each collector's mark.
   * Both lists are read before either mark moves, so a failed request consumes nothing.
   */
  private async collectHistory(): Promise<DataPoint[]> {
    return this.safeFetch('collect Bazarr history', async () => {
      const [movieCursor, episodeCursor] = await Promise.all([this.eventCursor('movie_history'), this.eventCursor('episode_history')]);
      const [movies, episodes] = await Promise.all([
        this.historySince(
          'movie',
          movieCursor,
          async (start) => (await this.bazarr.get('/movies/history', { query: { start, length: HISTORY_PAGE_SIZE } })).data,
          (item: MovieHistoryItem) => item.radarrId
        ),
        this.historySince(
          'episode',
          episodeCursor,
          async (start) => (await this.bazarr.get('/episodes/history', { query: { start, length: HISTORY_PAGE_SIZE } })).data,
          (item: EpisodeHistoryItem) => item.sonarrEpisodeId
        ),
      ]);
      const freshMovies = await this.takeNewEvents('movie_history', movies, (e) => e.time, (e) => e.id);
      const freshEpisodes = await this.takeNewEvents('episode_history', episodes, (e) => e.time, (e) => e.id);

      const points = [
        ...freshMovies.map(({ item, time, id }) => {
          const { language } = this.languageTags(item.language);
          return this.historyPoint(item, time, id, {
            media_type: 'movie',
            radarrId: item.radarrId,
            name: `${item.title} - ${language}`,
            title: item.title,
          });
        }),
        ...freshEpisodes.map(({ item, time, id }) => {
          const { language } = this.languageTags(item.language);
          return this.historyPoint(item, time, id, {
            media_type: 'episode',
            sonarrSeriesId: item.sonarrSeriesId,
            sonarrEpisodeId: item.sonarrEpisodeId,
            name: `${item.seriesTitle} - ${item.episode_number} - ${language}`,
            seriesTitle: item.seriesTitle,
            episodeNumber: item.episode_number,
          });
        }),
      ];
      this.logger.info(`Collected ${points.length} history items from Bazarr`);
      return points;
    });
  }

  /**
   * History is newest first: pages are read until one reaches the cursor, is short, has no date we can parse,
   * or the page cap. An event a new entry pushed onto the next page is read once.
   */
  private async historySince<T extends MovieHistoryItem | EpisodeHistoryItem>(
    kind: string,
    cursor: Date,
    page: (start: number) => Promise<T[]>,
    itemId: (item: T) => number
  ): Promise<HistoryEvent<T>[]> {
    const events = new Map<string, HistoryEvent<T>>();
    let unparsable = 0;
    for (let index = 0; index < HISTORY_MAX_PAGES; index++) {
      const items = await page(index * HISTORY_PAGE_SIZE);
      let reachedCursor = false;
      let parsed = 0;
      for (const item of items) {
        const time = this.parseHistoryTimestamp(item.parsed_timestamp);
        if (time === undefined) {
          unparsable += 1;
          continue;
        }
        parsed += 1;
        reachedCursor ||= time < cursor.getTime();
        const id = [itemId(item), item.action, item.language.code3, item.provider, item.subs_id, item.parsed_timestamp].join('|');
        events.set(id, { item, time, id });
      }
      if (reachedCursor || parsed === 0 || items.length < HISTORY_PAGE_SIZE) {
        break;
      }
      if (index === HISTORY_MAX_PAGES - 1) {
        this.logger.info(
          `Read the last ${HISTORY_MAX_PAGES * HISTORY_PAGE_SIZE} Bazarr ${kind} history events: older ones since the previous poll are not written`
        );
      }
    }
    if (unparsable > 0) {
      this.logUnparsableHistory(kind, unparsable);
    }
    return [...events.values()];
  }

  private logUnparsableHistory(kind: string, count: number): void {
    if (!this.warnedUnparsableHistory) {
      this.warnedUnparsableHistory = true;
      this.logger.warn('Bazarr history dates are not in the MM/DD/YY HH:MM:SS date format (C locale): those events are not written');
    }
    this.logger.debug(`Skipped ${count} Bazarr ${kind} history events with an unparsable date`);
  }

  private historyPoint(
    item: MovieHistoryItem | EpisodeHistoryItem,
    time: number,
    id: string,
    tags: Record<string, string | number>
  ): DataPoint {
    const { language, languageCode } = this.languageTags(item.language);
    const hash = this.hashit(`${this.config.id}${id}`);
    return this.createDataPoint(
      'Bazarr',
      {
        type: 'History',
        server: this.config.id,
        ...tags,
        language,
        languageCode,
        provider: item.provider ?? 'unknown',
        action: item.action,
        forced: item.language.forced ? 1 : 0,
        hi: item.language.hi ? 1 : 0,
      },
      {
        hash,
        ...this.scoreField(item.score),
        ...booleanFlags({ upgradable: item.upgradable, blacklisted: item.blacklisted }),
        matches: item.matches.length,
        dont_matches: item.dont_matches.length,
      },
      eventTimestamp(time, Number.parseInt(hash.slice(0, 8), 16)),
      SCORE_FLOAT_FIELDS
    );
  }

  private tagList(tags: readonly string[] | null | undefined): string {
    return tags?.length ? [...tags].sort().join(',') : 'none';
  }

  /** Bazarr marshals a missing language as an object whose fields are all null. */
  private languageTags(language: components['schemas']['SubtitleLanguage']): { language: string; languageCode: string } {
    return { language: language.name ?? 'unknown', languageCode: language.code3 ?? 'unknown' };
  }

  /** Bazarr sends scores as `"92.5%"`; unparsable or null scores are omitted. */
  private scoreField(score: string | null | undefined): { score_percent?: number } {
    const value = Number.parseFloat((score ?? '').replace('%', ''));
    return Number.isFinite(value) ? { score_percent: value } : {};
  }

  /**
   * Bazarr formats history dates with strftime('%x %X') in its own local time.
   * Only the default C locale layout (MM/DD/YY HH:MM:SS) is parsed; anything else is undefined.
   */
  private parseHistoryTimestamp(parsed: string | null | undefined): number | undefined {
    const match = (parsed ?? '').match(/^(\d{2})\/(\d{2})\/(\d{2}|\d{4}) (\d{2}):(\d{2}):(\d{2})$/);
    if (!match) {
      return undefined;
    }
    const [, month, day, year, hours, minutes, seconds] = match.map(Number);
    const fullYear = year < 100 ? 2000 + year : year;
    return new Date(fullYear, month - 1, day, hours, minutes, seconds).getTime();
  }

  private async collectStatus(): Promise<DataPoint[]> {
    return this.safeFetch('collect Bazarr status', async () => {
      const [badges, providers, tasks, jobs, releases] = await Promise.all([
        this.bazarr.get('/badges'),
        this.bazarr.get('/providers'),
        this.bazarr.get('/system/tasks'),
        this.bazarr.get('/system/jobs'),
        this.bazarr.get('/system/releases'),
      ]);
      const current = releases.data.findIndex((release) => release.current);
      const specs: PointSpec[] = [
        {
          tags: { type: 'Badges' },
          fields: {
            ...pickNumbers(badges, {
              episodes: 'wanted_episodes',
              movies: 'wanted_movies',
              providers: 'throttled_providers',
              status: 'health_issues',
              announcements: 'announcements',
            }),
            // "LIVE" or "" (live badge hidden) when connected, "DOWN" otherwise: api/badges/badges.py.
            sonarr_signalr: badges.sonarr_signalr === 'DOWN' ? 0 : 1,
            radarr_signalr: badges.radarr_signalr === 'DOWN' ? 0 : 1,
          },
        },
        ...providers.data.map((provider) => ({
          tags: { type: 'Provider', provider: provider.name, status: provider.status },
          fields: { throttled: provider.status === 'Good' ? 0 : 1 },
        })),
        ...tasks.data.map((task) => ({
          tags: { type: 'Task', task_id: task.job_id, task_name: task.name, interval: task.interval || 'unknown' },
          fields: { running: task.job_running ? 1 : 0 },
        })),
        {
          tags: { type: 'Jobs' },
          fields: Object.fromEntries(JOB_STATUSES.map((status) => [status, jobs.data.filter((job) => job.status === status).length])),
        },
        {
          tags: { type: 'Releases', latest: releases.data[0]?.name ?? 'unknown' },
          fields: { releases: releases.data.length, ...(current >= 0 ? { releases_behind: current } : {}) },
        },
      ];
      return this.createPoints(specs);
    });
  }

  private async collectStats(): Promise<DataPoint[]> {
    return this.safeFetch('collect Bazarr stats', async () => {
      const [stats, languages] = await Promise.all([this.bazarr.get('/history/stats', { query: { timeFrame: 'week' } }), this.bazarr.get('/system/languages')]);
      const days = new Map<string, Bucket>();
      for (const [field, counts] of [
        ['episodes', stats.series],
        ['movies', stats.movies],
      ] as const) {
        for (const { date, count } of counts) {
          const range = bucketRange(date, 'day');
          if (range) {
            const bucket = days.get(date) ?? { category: date, ...range, fields: {} };
            bucket.fields[field] = (bucket.fields[field] ?? 0) + count;
            days.set(date, bucket);
          }
        }
      }
      const fresh = await this.takeSettledBuckets('history_stats', [...days.values()]);
      return this.createPoints([
        ...fresh.map((bucket) => ({ tags: { type: 'HistoryStats' }, fields: bucket.fields, timestamp: new Date(bucket.start) })),
        { tags: { type: 'Languages' }, fields: { enabled: languages.filter((language) => language.enabled).length, total: languages.length } },
      ]);
    });
  }

  private async collectLibrary(): Promise<DataPoint[]> {
    return this.safeFetch('collect Bazarr library', async () => {
      const [{ data: movies }, { data: series }] = await Promise.all([this.bazarr.get('/movies'), this.bazarr.get('/series')]);
      const sum = <T>(items: readonly T[], value: (item: T) => number): number => items.reduce((total, item) => total + value(item), 0);
      return this.createPoints([
        {
          tags: { type: 'Library', media_type: 'movie' },
          fields: {
            items: movies.length,
            monitored: movies.filter((movie) => movie.monitored).length,
            missing_subtitles_items: movies.filter((movie) => movie.missing_subtitles.length > 0).length,
            missing_subtitles: sum(movies, (movie) => movie.missing_subtitles.length),
            subtitles: sum(movies, (movie) => movie.subtitles.length),
          },
        },
        {
          tags: { type: 'Library', media_type: 'show' },
          fields: {
            items: series.length,
            monitored: series.filter((show) => show.monitored).length,
            ended: series.filter((show) => show.ended).length,
            episode_files: sum(series, (show) => show.episodeFileCount),
            episodes_missing_subtitles: sum(series, (show) => show.episodeMissingCount),
          },
        },
      ]);
    });
  }

  private async collectServerInfo(): Promise<DataPoint[]> {
    return this.safeFetch('collect Bazarr server info', async () => {
      const [status, health] = await Promise.all([this.bazarr.get('/system/status'), this.bazarr.get('/system/health')]);
      const info = status.data;
      const fields: Record<string, number> = { health_issues: health.data.length };
      const uptime = uptimeSeconds(info.start_time, new Date());
      if (uptime !== undefined) {
        fields.uptime_seconds = uptime;
      }
      return [
        this.createServerInfoPoint(
          {
            version: info.bazarr_version || 'unknown',
            sonarr_version: info.sonarr_version || 'unknown',
            radarr_version: info.radarr_version || 'unknown',
          },
          fields
        ),
      ];
    });
  }
}
