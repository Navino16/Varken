import { BaseInputPlugin } from './BaseInputPlugin';
import { itemMediaType } from './utils/mediaType';
import type { PluginMetadata, DataPoint, ScheduleConfig } from '../../types/plugin.types';
import type { EmbyConfig } from '../../types/inputs/emby.types';
import type { components, paths } from '../../types/generated/emby';
import { isTranscoding, sourceAudioCodec } from './utils/mediaStreams';
import { qualityOf, sessionEnrichment, streamSummary } from './utils/embySessions';
import { pickNumbers } from './utils/numbers';
import { booleanFlags } from './utils/flags';
import { activityPoint, devicePoints, liveTvPoint, pluginPoints, taskPoints, userPoints } from './utils/embyEndpoints';

type EmbySession = components['schemas']['Session.SessionInfo'];
type EmbyItemCounts = components['schemas']['ItemCounts'];

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
 *   - optional status, activity log, inventory and Live TV collectors (see docs/data-reference.md)
 */
export class EmbyPlugin extends BaseInputPlugin<EmbyConfig> {
  readonly metadata: PluginMetadata = {
    name: 'Emby',
    version: '1.0.0',
    description: 'Collects sessions and library stats from Emby',
  };

  private readonly emby = this.api<paths>('/emby');

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

    if (this.config.serverInfo.enabled) {
      points.push(...(await this.collectServerInfo()));
    }

    if (this.config.status.enabled) {
      points.push(...(await this.collectStatus()));
    }

    if (this.config.history.enabled) {
      points.push(...(await this.collectHistory()));
    }

    if (this.config.inventory.enabled) {
      points.push(...(await this.collectInventory()));
    }

    if (this.config.liveTv.enabled) {
      points.push(...(await this.collectLiveTv()));
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

    if (this.config.serverInfo.enabled) {
      schedules.push(this.createSchedule('serverInfo', this.config.serverInfo.intervalSeconds, true, this.collectServerInfo));
    }

    if (this.config.status.enabled) {
      schedules.push(this.createSchedule('status', this.config.status.intervalSeconds, true, this.collectStatus));
    }

    if (this.config.history.enabled) {
      schedules.push(this.createSchedule('history', this.config.history.intervalSeconds, true, this.collectHistory));
    }

    if (this.config.inventory.enabled) {
      schedules.push(this.createSchedule('inventory', this.config.inventory.intervalSeconds, true, this.collectInventory));
    }

    if (this.config.liveTv.enabled) {
      schedules.push(this.createSchedule('liveTv', this.config.liveTv.intervalSeconds, true, this.collectLiveTv));
    }

    return schedules;
  }

  private async collectSessions(): Promise<DataPoint[]> {
    return this.safeFetch('collect Emby sessions', async () => {
      const points: DataPoint[] = [];
      const sessions = await this.emby.get('/Sessions');
      const active = (sessions ?? []).filter((s) => s.NowPlayingItem);

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
            transcode_streams: active.filter((s) => isTranscoding(s.TranscodingInfo)).length,
            ...streamSummary(sessions ?? []),
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
        this.emby.get('/Library/VirtualFolders'),
        this.fetchItemCounts(),
      ]);

      for (const library of libraries ?? []) {
        points.push(
          this.createDataPoint(
            'Emby',
            {
              type: 'library_stats',
              server: this.config.id,
              section_name: library.Name ?? 'unknown',
              section_type: library.CollectionType || 'unknown',
              name: library.Name ?? 'unknown',
              refresh_status: library.RefreshStatus || 'unknown',
            },
            {
              locations: library.Locations?.length ?? 0,
              libraries: library.Name ?? 'unknown',
              ...pickNumbers(library, { RefreshProgress: 'refresh_progress' }),
            },
            undefined,
            ['refresh_progress']
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
              movies: counts.MovieCount ?? 0,
              series: counts.SeriesCount ?? 0,
              episodes: counts.EpisodeCount ?? 0,
              artists: counts.ArtistCount ?? 0,
              albums: counts.AlbumCount ?? 0,
              songs: counts.SongCount ?? 0,
              books: counts.BookCount ?? 0,
              box_sets: counts.BoxSetCount ?? 0,
              total: counts.ItemCount ?? 0,
              ...pickNumbers(counts, {
                MusicVideoCount: 'music_videos',
                ProgramCount: 'programs',
                TrailerCount: 'trailers',
                GameCount: 'games',
                GameSystemCount: 'game_systems',
              }),
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
      return await this.emby.get('/Items/Counts');
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

    const quality = qualityOf(item);
    const fullTitle = item?.SeriesName ? `${item.SeriesName} - ${item?.Name}` : item?.Name || 'unknown';

    const runtimeMs = item?.RunTimeTicks ? item.RunTimeTicks / 10000 : 0;
    const positionMs = playState?.PositionTicks ? playState.PositionTicks / 10000 : 0;
    const progressPercent = runtimeMs > 0 ? Math.round((positionMs / runtimeMs) * 100) : 0;

    const hashId = this.hashit(`${session.Id}${session.UserName}${fullTitle}`);
    const enrichment = sessionEnrichment(session);
    Object.assign(
      enrichment.fields,
      booleanFlags({ video_decoder_hw: transcode?.VideoDecoderIsHardware, video_encoder_hw: transcode?.VideoEncoderIsHardware }),
      pickNumbers(transcode, { CurrentCpuUsage: 'transcode_cpu_percent' })
    );

    return this.createDataPoint(
      'Emby',
      {
        type: 'Session',
        session_id: session.Id ?? 'unknown',
        ip_address: session.RemoteEndPoint || 'unknown',
        username: session.UserName || 'unknown',
        title: fullTitle,
        product: session.Client || 'unknown',
        platform: session.DeviceType || 'unknown',
        product_version: session.ApplicationVersion || 'unknown',
        quality,
        video_decision: videoDecision,
        media_type: itemMediaType(item),
        audio_codec: sourceAudioCodec(item?.MediaStreams, playState?.AudioStreamIndex, transcode),
        player_state: playerState,
        device_type: session.DeviceType || 'unknown',
        play_method: playState?.PlayMethod || 'unknown',
        server: this.config.id,
        ...enrichment.tags,
      },
      {
        hash: hashId,
        progress_percent: progressPercent,
        ...enrichment.fields,
      },
      undefined,
      [...enrichment.floatFields, 'transcode_cpu_percent']
    );
  }

  private async collectServerInfo(): Promise<DataPoint[]> {
    return this.safeFetch('collect Emby server info', async () => {
      const info = await this.emby.get('/System/Info');
      return [
        this.createServerInfoPoint(
          { version: info?.Version || 'unknown' },
          booleanFlags({
            update_available: info?.HasUpdateAvailable,
            restart_pending: info?.HasPendingRestart,
            shutting_down: info?.IsShuttingDown,
            maintenance_mode: info?.IsInMaintenanceMode,
          })
        ),
      ];
    });
  }

  private async collectStatus(): Promise<DataPoint[]> {
    return this.safeFetch('collect Emby status', async () => {
      const [tasks, plugins] = await Promise.all([
        this.emby.get('/ScheduledTasks', { query: { IsHidden: false } }),
        this.emby.get('/Plugins'),
      ]);
      return this.createPoints([...taskPoints(tasks, new Date()), ...pluginPoints(plugins)]);
    });
  }

  private async collectHistory(): Promise<DataPoint[]> {
    return this.safeFetch('collect Emby activity log', async () => {
      const MinDate = (await this.eventCursor('history')).toISOString();
      const log = await this.emby.get('/System/ActivityLog/Entries', { query: { MinDate } });
      const entries = await this.takeNewEvents('history', log.Items ?? [], (e) => Date.parse(e.Date ?? ''), (e) => String(e.Id));
      return this.createPoints(entries.flatMap((e) => activityPoint(e, this.hashit(`${this.config.id}${e.Id}`)) ?? []));
    });
  }

  private async collectInventory(): Promise<DataPoint[]> {
    return this.safeFetch('collect Emby inventory', async () => {
      const [users, devices] = await Promise.all([this.emby.get('/Users/Query'), this.emby.get('/Devices')]);
      const now = new Date();
      return this.createPoints([...userPoints(users.Items ?? [], now), ...devicePoints(devices.Items ?? [], now)]);
    });
  }

  private async collectLiveTv(): Promise<DataPoint[]> {
    return this.safeFetch('collect Emby live TV', async () => {
      const [recordings, inProgress, timers] = await Promise.all([
        this.emby.get('/LiveTv/Recordings', { query: { Limit: 1 } }),
        this.emby.get('/LiveTv/Recordings', { query: { IsInProgress: true, Limit: 1 } }),
        this.emby.get('/LiveTv/Timers'),
      ]);
      return this.createPoints([
        liveTvPoint(
          { recordings: recordings.TotalRecordCount, recordingsInProgress: inProgress.TotalRecordCount, timers: timers.Items ?? [] },
          new Date()
        ),
      ]);
    });
  }
}
