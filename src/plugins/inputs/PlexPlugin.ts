import { BaseInputPlugin } from './BaseInputPlugin';
import type { PluginMetadata, DataPoint, ScheduleConfig } from '../../types/plugin.types';
import type { PlexConfig } from '../../types/inputs/plex.types';
import type { paths } from '../../types/generated/plex';

type Sessions = paths['/status/sessions']['get']['responses'][200]['content']['application/json'];
type PlexSession = NonNullable<NonNullable<Sessions['MediaContainer']>['Metadata']>[number];
type Libraries = paths['/library/sections/all']['get']['responses'][200]['content']['application/json'];
type PlexLibrary = NonNullable<NonNullable<Libraries['MediaContainer']>['Directory']>[number];

const PLAYER_STATE = { PLAYING: 0, PAUSED: 1, BUFFERING: 3 } as const;

/** The spec leaves several metadata attributes untyped (title, type, codecs…). */
function text(value: unknown): string {
  return value === undefined || value === null ? '' : String(value);
}

/**
 * Plex input plugin — direct Plex Media Server API (no Tautulli required).
 *
 * Collects:
 *   - Current streaming sessions (`/status/sessions`)
 *   - Library metadata and item counts (`/library/sections/all` + `/library/sections/{id}/all`)
 *
 * Authentication uses the `X-Plex-Token` header (see Plex docs for how to obtain one).
 * Responses are requested in JSON via the `Accept: application/json` header — Plex
 * defaults to XML.
 */
export class PlexPlugin extends BaseInputPlugin<PlexConfig> {
  readonly metadata: PluginMetadata = {
    name: 'Plex',
    version: '1.0.0',
    description: 'Collects sessions and library stats directly from Plex Media Server',
  };

  private readonly plex = this.api<paths>();

  async initialize(...args: Parameters<BaseInputPlugin<PlexConfig>['initialize']>): Promise<void> {
    await super.initialize(...args);
    this.httpClient.defaults.headers.common['X-Plex-Token'] = this.config.token;
    // Plex defaults to XML; this flips responses to JSON.
    this.httpClient.defaults.headers.common.Accept = 'application/json';
  }

  protected getHealthEndpoint(): string {
    return '/identity';
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
    return this.safeFetch('collect Plex sessions', async () => {
      const points: DataPoint[] = [];
      const response = await this.plex.get('/status/sessions');
      const sessions = response?.MediaContainer?.Metadata ?? [];

      for (const session of sessions) {
        points.push(this.processSession(session));
      }

      // Summary point so Grafana can easily graph "current stream count"
      points.push(
        this.createDataPoint(
          'Plex',
          {
            type: 'current_stream_stats',
            server: this.config.id,
          },
          {
            stream_count: sessions.length,
            transcode_streams: sessions.filter(
              (s) => s.TranscodeSession?.videoDecision === 'transcode' || s.TranscodeSession?.audioDecision === 'transcode'
            ).length,
          }
        )
      );

      this.logger.info(`Collected ${sessions.length} Plex sessions`);
      return points;
    });
  }

  private async collectLibraries(): Promise<DataPoint[]> {
    return this.safeFetch('collect Plex libraries', async () => {
      const points: DataPoint[] = [];
      const response = await this.plex.get('/library/sections/all');
      const libraries = response?.MediaContainer?.Directory ?? [];

      for (const library of libraries) {
        const count = await this.fetchLibraryItemCount(library);
        points.push(
          this.createDataPoint(
            'Plex',
            {
              type: 'library_stats',
              server: this.config.id,
              section_name: library.title ?? 'unknown',
              section_type: library.type ?? 'unknown',
              name: library.title ?? 'unknown',
            },
            {
              total: count,
              libraries: library.title ?? 'unknown',
            }
          )
        );
      }

      this.logger.info(`Collected ${libraries.length} Plex library stats`);
      return points;
    });
  }

  /**
   * Fetch item count for a library via `/library/sections/{key}/all` with the
   * `X-Plex-Container-Size: 0` header: Plex returns `totalSize` without transferring any item.
   */
  private async fetchLibraryItemCount(library: PlexLibrary): Promise<number> {
    try {
      const response = await this.plex.get('/library/sections/{sectionId}/all', {
        path: { sectionId: String(library.key) },
        header: { 'X-Plex-Container-Start': 0, 'X-Plex-Container-Size': 0 },
      });
      return response?.MediaContainer?.totalSize ?? response?.MediaContainer?.size ?? 0;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.debug(`Could not fetch item count for library ${library.title}: ${message}`);
      return 0;
    }
  }

  private processSession(session: PlexSession): DataPoint {
    const player = session.Player;
    const media = session.Media?.[0];
    const transcode = session.TranscodeSession;

    const state = (player?.state || '').toLowerCase();
    let playerState: number;
    switch (state) {
      case 'playing':
        playerState = PLAYER_STATE.PLAYING;
        break;
      case 'paused':
        playerState = PLAYER_STATE.PAUSED;
        break;
      case 'buffering':
        playerState = PLAYER_STATE.BUFFERING;
        break;
      default:
        playerState = PLAYER_STATE.PLAYING;
    }

    const videoDecision = transcode?.videoDecision ?? (transcode ? 'transcode' : 'direct play');
    const quality = (text(media?.videoResolution) || text(media?.container)).toUpperCase();

    const title = text(session.title);
    const fullTitle = session.grandparentTitle ? `${session.grandparentTitle} - ${title}` : title;
    const duration = session.duration ?? 0;

    const hashId = this.hashit(`${session.sessionKey}${session.ratingKey}${session.User?.title ?? ''}${fullTitle}`);

    return this.createDataPoint(
      'Plex',
      {
        type: 'Session',
        session_id: session.sessionKey ?? 'unknown',
        ip_address: player?.address || 'unknown',
        username: session.User?.title || 'unknown',
        title: fullTitle,
        product: player?.product || 'unknown',
        platform: player?.platform || 'unknown',
        product_version: player?.version || 'unknown',
        quality: quality || 'unknown',
        video_decision: videoDecision,
        media_type: text(session.type) || 'unknown',
        audio_codec: text(media?.audioCodec).toUpperCase() || 'unknown',
        player_state: playerState,
        device_type: player?.platform || 'unknown',
        secure: player?.secure ? '1' : '0',
        server: this.config.id,
      },
      {
        hash: hashId,
        progress_percent: duration > 0 ? Math.round(((session.viewOffset ?? 0) / duration) * 100) : 0,
      }
    );
  }
}
