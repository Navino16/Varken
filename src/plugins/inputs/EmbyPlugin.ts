import { BaseInputPlugin } from './BaseInputPlugin';
import type { PluginMetadata, DataPoint, ScheduleConfig } from '../../types/plugin.types';
import type {
  EmbyConfig,
  EmbySession,
  EmbyLibrary,
  EmbyItemCounts,
} from '../../types/inputs/emby.types';

const PLAYER_STATE = { PLAYING: 0, PAUSED: 1, BUFFERING: 3 } as const;

/**
 * Emby input plugin.
 *
 * Shares the shape of Jellyfin (Jellyfin is an Emby fork) but hits the
 * `/emby/*` path prefix which is what stock Emby servers expose. The plugin
 * structure mirrors `JellyfinPlugin`:
 *   - `GET /emby/Sessions` → active streams
 *   - `GET /emby/Library/VirtualFolders` → library metadata
 *   - `GET /emby/Items/Counts` → global content counts
 */
export class EmbyPlugin extends BaseInputPlugin<EmbyConfig> {
  readonly metadata: PluginMetadata = {
    name: 'Emby',
    version: '1.0.0',
    description: 'Collects sessions and library stats from Emby',
  };

  async initialize(
    ...args: Parameters<BaseInputPlugin<EmbyConfig>['initialize']>
  ): Promise<void> {
    await super.initialize(...args);
    this.httpClient.defaults.headers.common['X-Emby-Token'] = this.config.apiKey;
  }

  protected getHealthEndpoint(): string {
    return '/emby/System/Info';
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
    return this.safeFetch('collect Emby sessions', async () => {
      const points: DataPoint[] = [];
      const sessions = await this.httpGet<EmbySession[]>('/emby/Sessions');
      const active = (sessions ?? []).filter((s) => s.NowPlayingItem !== undefined);

      for (const session of active) {
        points.push(this.processSession(session));
      }

      points.push(
        this.createDataPoint(
          'Emby',
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

      this.logger.info(`Collected ${active.length} Emby sessions`);
      return points;
    });
  }

  private async collectLibraries(): Promise<DataPoint[]> {
    return this.safeFetch('collect Emby libraries', async () => {
      const points: DataPoint[] = [];

      const [libraries, counts] = await Promise.all([
        this.httpGet<EmbyLibrary[]>('/emby/Library/VirtualFolders'),
        this.fetchItemCounts(),
      ]);

      for (const library of libraries ?? []) {
        points.push(
          this.createDataPoint(
            'Emby',
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
            'Emby',
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

      this.logger.info(`Collected ${(libraries ?? []).length} Emby libraries`);
      return points;
    });
  }

  private async fetchItemCounts(): Promise<EmbyItemCounts | null> {
    try {
      return await this.httpGet<EmbyItemCounts>('/emby/Items/Counts');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.debug(`Could not fetch Emby item counts: ${message}`);
      return null;
    }
  }

  private processSession(session: EmbySession): DataPoint {
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
      'Emby',
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
