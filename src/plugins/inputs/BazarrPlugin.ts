import { BaseInputPlugin } from './BaseInputPlugin';
import type { PluginMetadata, DataPoint, ScheduleConfig } from '../../types/plugin.types';
import type { BazarrConfig } from '../../types/inputs/bazarr.types';
import type { components, paths } from '../../types/generated/bazarr';

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

    return schedules;
  }

  /**
   * Collect wanted subtitles from Bazarr (movies + episodes)
   */
  private async collectWanted(): Promise<DataPoint[]> {
    return this.safeFetch('collect Bazarr wanted subtitles', async () => {
      const points: DataPoint[] = [];
      // Collect wanted movies
      const { data: wantedMovies } = await this.bazarr.get('/movies/wanted', { query: { length: 1000 } });

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
                mediaType: 'movie',
                radarrId: movie.radarrId,
                server: this.config.id,
                name,
                title: movie.title,
                language,
                languageCode,
                forced: subtitle.forced ? 1 : 0,
                hi: subtitle.hi ? 1 : 0,
              },
              {
                hash: hashId,
              }
            )
          );
        }
      }

      // Collect wanted episodes
      const { data: wantedEpisodes } = await this.bazarr.get('/episodes/wanted', { query: { length: 1000 } });

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
                mediaType: 'episode',
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
              },
              {
                hash: hashId,
              }
            )
          );
        }
      }

      this.logger.info(`Collected ${points.length} wanted subtitles from Bazarr`);
      return points;
    });
  }

  /**
   * Collect subtitle history from Bazarr (movies + series)
   */
  private async collectHistory(): Promise<DataPoint[]> {
    return this.safeFetch('collect Bazarr history', async () => {
      const points: DataPoint[] = [];
      // Collect movie history
      const { data: movieHistory } = await this.bazarr.get('/movies/history', { query: { length: 100 } });

      for (const item of movieHistory) {
        const { language, languageCode } = this.languageTags(item.language);
        const name = `${item.title} - ${language}`;
        const hashId = this.hashit(
          `${this.config.id}${item.radarrId}${languageCode}${item.action}${item.parsed_timestamp}`
        );

        points.push(
          this.createDataPoint(
            'Bazarr',
            {
              type: 'History',
              mediaType: 'movie',
              radarrId: item.radarrId,
              server: this.config.id,
              name,
              title: item.title,
              language,
              languageCode,
              provider: item.provider ?? 'unknown',
              action: item.action,
            },
            {
              hash: hashId,
              ...this.scoreField(item.score),
            },
            this.parseHistoryTimestamp(item.parsed_timestamp)
          )
        );
      }

      // Collect series history
      const { data: seriesHistory } = await this.bazarr.get('/episodes/history', { query: { length: 100 } });

      for (const item of seriesHistory) {
        const { language, languageCode } = this.languageTags(item.language);
        const name = `${item.seriesTitle} - ${item.episode_number} - ${language}`;
        const hashId = this.hashit(
          `${this.config.id}${item.sonarrEpisodeId}${languageCode}${item.action}${item.parsed_timestamp}`
        );

        points.push(
          this.createDataPoint(
            'Bazarr',
            {
              type: 'History',
              mediaType: 'series',
              sonarrSeriesId: item.sonarrSeriesId,
              sonarrEpisodeId: item.sonarrEpisodeId,
              server: this.config.id,
              name,
              seriesTitle: item.seriesTitle,
              episodeNumber: item.episode_number,
              language,
              languageCode,
              provider: item.provider ?? 'unknown',
              action: item.action,
            },
            {
              hash: hashId,
              ...this.scoreField(item.score),
            },
            this.parseHistoryTimestamp(item.parsed_timestamp)
          )
        );
      }

      this.logger.info(`Collected ${points.length} history items from Bazarr`);
      return points;
    });
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
   * Only the default C locale layout (MM/DD/YY HH:MM:SS) is parsed; anything else falls back to now.
   */
  private parseHistoryTimestamp(parsed: string): Date {
    const match = parsed.match(/^(\d{2})\/(\d{2})\/(\d{2}|\d{4}) (\d{2}):(\d{2}):(\d{2})$/);
    if (!match) {
      return new Date();
    }
    const [, month, day, year, hours, minutes, seconds] = match.map(Number);
    const fullYear = year < 100 ? 2000 + year : year;
    return new Date(fullYear, month - 1, day, hours, minutes, seconds);
  }
}
