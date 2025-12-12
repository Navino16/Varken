import { BaseInputPlugin } from './BaseInputPlugin';
import type { PluginMetadata, DataPoint, ScheduleConfig } from '../../types/plugin.types';
import type {
  BazarrConfig,
  BazarrWantedMoviesResponse,
  BazarrWantedEpisodesResponse,
  BazarrMovieHistoryResponse,
  BazarrSeriesHistoryResponse,
} from '../../types/inputs/bazarr.types';

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

  /**
   * Initialize the plugin and configure the HTTP client with API key header
   */
  async initialize(config: BazarrConfig): Promise<void> {
    await super.initialize(config);
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
    const points: DataPoint[] = [];

    try {
      // Collect wanted movies
      const moviesResponse = await this.httpGet<BazarrWantedMoviesResponse>(
        '/api/movies/wanted',
        { length: 1000 }
      );

      const wantedMovies = moviesResponse.data || [];

      for (const movie of wantedMovies) {
        for (const subtitle of movie.missing_subtitles) {
          const name = `${movie.title} - ${subtitle.name}`;
          const hashId = this.hashit(`${this.config.id}${movie.radarrId}${subtitle.code3}`);

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
                language: subtitle.name,
                languageCode: subtitle.code3,
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
      const episodesResponse = await this.httpGet<BazarrWantedEpisodesResponse>(
        '/api/episodes/wanted',
        { length: 1000 }
      );

      const wantedEpisodes = episodesResponse.data || [];

      for (const episode of wantedEpisodes) {
        for (const subtitle of episode.missing_subtitles) {
          const name = `${episode.seriesTitle} - ${episode.episode_number} - ${subtitle.name}`;
          const hashId = this.hashit(
            `${this.config.id}${episode.sonarrEpisodeId}${subtitle.code3}`
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
                language: subtitle.name,
                languageCode: subtitle.code3,
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
    } catch (error) {
      this.logger.error(`Failed to collect Bazarr wanted subtitles: ${error}`);
    }

    return points;
  }

  /**
   * Collect subtitle history from Bazarr (movies + series)
   */
  private async collectHistory(): Promise<DataPoint[]> {
    const points: DataPoint[] = [];

    try {
      // Collect movie history
      const moviesResponse = await this.httpGet<BazarrMovieHistoryResponse>(
        '/api/history/movies',
        { length: 100 }
      );

      const movieHistory = moviesResponse.data || [];

      for (const item of movieHistory) {
        const name = `${item.title} - ${item.language.name}`;
        const hashId = this.hashit(`${this.config.id}${item.id}${item.raw_timestamp}`);

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
              language: item.language.name,
              languageCode: item.language.code3,
              provider: item.provider,
              action: item.action,
            },
            {
              hash: hashId,
              score: item.score || '',
            },
            new Date(item.raw_timestamp * 1000)
          )
        );
      }

      // Collect series history
      const seriesResponse = await this.httpGet<BazarrSeriesHistoryResponse>(
        '/api/history/series',
        { length: 100 }
      );

      const seriesHistory = seriesResponse.data || [];

      for (const item of seriesHistory) {
        const name = `${item.seriesTitle} - ${item.episode_number} - ${item.language.name}`;
        const hashId = this.hashit(`${this.config.id}${item.id}${item.raw_timestamp}`);

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
              language: item.language.name,
              languageCode: item.language.code3,
              provider: item.provider,
              action: item.action,
            },
            {
              hash: hashId,
              score: item.score || '',
            },
            new Date(item.raw_timestamp * 1000)
          )
        );
      }

      this.logger.info(`Collected ${points.length} history items from Bazarr`);
    } catch (error) {
      this.logger.error(`Failed to collect Bazarr history: ${error}`);
    }

    return points;
  }
}
