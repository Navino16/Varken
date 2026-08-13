import { BaseInputPlugin } from './BaseInputPlugin';
import type { PluginMetadata, DataPoint, ScheduleConfig } from '../../types/plugin.types';
import type {
  JellyfinConfig,
  JellyfinSession,
  JellyfinLibrary,
  JellyfinItemCounts,
} from '../../types/inputs/jellyfin.types';

const PLAYER_STATE = { PLAYING: 0, PAUSED: 1, BUFFERING: 3 } as const;

/**
 * Jellyfin input plugin.
 *
 * Collects:
 *   - Active streaming sessions (`GET /Sessions` filtered to those with `NowPlayingItem`)
 *   - Library metadata (`GET /Library/VirtualFolders`) plus a global item count
 *     summary (`GET /Items/Counts`)
 *
 * Auth uses the `X-Emby-Token` header (legacy name, still the most widely
 * supported across Jellyfin / Emby forks). Responses are JSON by default.
 */
export class JellyfinPlugin extends BaseInputPlugin<JellyfinConfig> {
  readonly metadata: PluginMetadata = {
    name: 'Jellyfin',
    version: '1.0.0',
    description: 'Collects sessions and library stats from Jellyfin',
  };

  async initialize(
    ...args: Parameters<BaseInputPlugin<JellyfinConfig>['initialize']>
  ): Promise<void> {
    await super.initialize(...args);
    this.httpClient.defaults.headers.common['X-Emby-Token'] = this.config.apiKey;
  }

  protected getHealthEndpoint(): string {
    return '/System/Info';
  }

  async collect(): Promise<DataPoint[]> {
    const points: DataPoint[] = [];

    if (this.config.sessions.enabled) {
      points.push(...(await this.collectSessions()));
    }

    if (this.config.libraries.enabled) {
      points.push(...(await this.collectLibraries()));
    }

    return points;
  }

  getSchedules(): ScheduleConfig[] {
    const schedules: ScheduleConfig[] = [];

    if (this.config.sessions.enabled) {
      schedules.push(
        this.createSchedule('sessions', this.config.sessions.intervalSeconds, true, this.collectSessions)
      );
    }

    if (this.config.libraries.enabled) {
      schedules.push(
        this.createSchedule('libraries', this.config.libraries.intervalSeconds, true, this.collectLibraries)
      );
    }

    return schedules;
  }

  private async collectSessions(): Promise<DataPoint[]> {
    return this.safeFetch('collect Jellyfin sessions', async () => {
      const points: DataPoint[] = [];
      const sessions = await this.httpGet<JellyfinSession[]>('/Sessions');
      const active = (sessions ?? []).filter((s) => s.NowPlayingItem !== undefined);

      for (const session of active) {
        points.push(this.processSession(session));
      }

      points.push(
        this.createDataPoint(
          'Jellyfin',
          {
            type: 'current_stream_stats',
            server: this.config.id,
          },
          {
            stream_count: active.length,
            transcode_streams: active.filter((s) => s.TranscodingInfo !== undefined).length,
          }
        )
      );

      this.logger.info(`Collected ${active.length} Jellyfin sessions`);
      return points;
    });
  }

  private async collectLibraries(): Promise<DataPoint[]> {
    return this.safeFetch('collect Jellyfin libraries', async () => {
      const points: DataPoint[] = [];

      const [libraries, counts] = await Promise.all([
        this.httpGet<JellyfinLibrary[]>('/Library/VirtualFolders'),
        this.fetchItemCounts(),
      ]);

      for (const library of libraries ?? []) {
        points.push(
          this.createDataPoint(
            'Jellyfin',
            {
              type: 'library_stats',
              server: this.config.id,
              section_name: library.Name,
              section_type: library.CollectionType || 'unknown',
              name: library.Name,
            },
            {
              locations: library.Locations?.length ?? 0,
              libraries: library.Name,
            }
          )
        );
      }

      if (counts) {
        points.push(
          this.createDataPoint(
            'Jellyfin',
            {
              type: 'item_counts',
              server: this.config.id,
            },
            {
              movies: counts.MovieCount,
              series: counts.SeriesCount,
              episodes: counts.EpisodeCount,
              artists: counts.ArtistCount,
              albums: counts.AlbumCount,
              songs: counts.SongCount,
              books: counts.BookCount,
              box_sets: counts.BoxSetCount,
              total: counts.ItemCount,
            }
          )
        );
      }

      this.logger.info(`Collected ${(libraries ?? []).length} Jellyfin libraries`);
      return points;
    });
  }

  /**
   * Fetch global item counts. Failure is non-fatal — logs debug and returns null
   * so the libraries collector still emits per-library points.
   */
  private async fetchItemCounts(): Promise<JellyfinItemCounts | null> {
    try {
      return await this.httpGet<JellyfinItemCounts>('/Items/Counts');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.debug(`Could not fetch Jellyfin item counts: ${message}`);
      return null;
    }
  }

  private processSession(session: JellyfinSession): DataPoint {
    const item = session.NowPlayingItem;
    const playState = session.PlayState;
    const transcode = session.TranscodingInfo;

    const playerState = playState?.IsPaused ? PLAYER_STATE.PAUSED : PLAYER_STATE.PLAYING;
    const videoDecision = transcode ? (transcode.IsVideoDirect ? 'direct stream' : 'transcode') : 'direct play';

    const quality = item?.Height ? `${item.Height}p` : (item?.Container ?? '').toUpperCase() || 'unknown';
    const fullTitle = item?.SeriesName ? `${item.SeriesName} - ${item?.Name}` : item?.Name || 'unknown';

    const runtimeMs = item?.RunTimeTicks ? item.RunTimeTicks / 10000 : 0;
    const positionMs = playState?.PositionTicks ? playState.PositionTicks / 10000 : 0;
    const progressPercent = runtimeMs > 0 ? Math.round((positionMs / runtimeMs) * 100) : 0;

    const hashId = this.hashit(`${session.Id}${session.UserName}${fullTitle}`);

    return this.createDataPoint(
      'Jellyfin',
      {
        type: 'Session',
        session_id: session.Id,
        ip_address: session.RemoteEndPoint || 'unknown',
        username: session.UserName || 'unknown',
        title: fullTitle,
        product: session.Client || 'unknown',
        platform: session.DeviceType || 'unknown',
        product_version: session.ApplicationVersion || 'unknown',
        quality,
        video_decision: videoDecision,
        media_type: item?.MediaType || item?.Type || 'unknown',
        audio_codec: (transcode?.AudioCodec || '').toUpperCase() || 'unknown',
        player_state: playerState,
        device_type: session.DeviceType || 'unknown',
        play_method: playState?.PlayMethod || 'unknown',
        server: this.config.id,
      },
      {
        hash: hashId,
        progress_percent: progressPercent,
      }
    );
  }
}
