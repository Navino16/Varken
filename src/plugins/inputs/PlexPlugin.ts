import { BaseInputPlugin } from './BaseInputPlugin';
import type { PluginMetadata, DataPoint, ScheduleConfig } from '../../types/plugin.types';
import type { PlexConfig } from '../../types/inputs/plex.types';
import type { paths } from '../../types/generated/plex';
import { booleanFlags } from './utils/flags';
import { isNumber } from './utils/numbers';
import { resolutionBucket, resolutionLabel } from './utils/mediaStreams';
import { ageSeconds } from './utils/time';
import {
  activityPoints,
  backgroundTranscodePoints,
  butlerPoints,
  resourcesPoint,
  transcodeSessionsPoint,
  updaterPoint,
} from './utils/plexStatus';

type Sessions = paths['/status/sessions']['get']['responses'][200]['content']['application/json'];
type PlexSession = NonNullable<NonNullable<Sessions['MediaContainer']>['Metadata']>[number];
type Libraries = paths['/library/sections/all']['get']['responses'][200]['content']['application/json'];
type PlexLibrary = NonNullable<NonNullable<Libraries['MediaContainer']>['Directory']>[number];

type MediaQuery = NonNullable<paths['/library/sections/{sectionId}/all']['get']['parameters']['query']>['mediaQuery'];

const PLAYER_STATE = { PLAYING: 0, PAUSED: 1, BUFFERING: 3 } as const;

const RECENT = { 'addedAt>>': '-7d' } as const;

/** Extra counts per section type: Plex media types 1 movie, 3 season, 4 episode, 9 album, 10 track. */
const SECTION_COUNTS: Record<string, Record<string, MediaQuery>> = {
  movie: { added_7d: { type: 1, ...RECENT } },
  show: { seasons: { type: 3 }, episodes: { type: 4 }, added_7d: { type: 4, ...RECENT } },
  artist: { albums: { type: 9 }, tracks: { type: 10 }, added_7d: { type: 10, ...RECENT } },
};

/** The spec leaves several metadata attributes untyped (title, type, codecs…). */
function text(value: unknown): string {
  return value === undefined || value === null ? '' : String(value);
}

function networkOf(session: PlexSession): 'lan' | 'wan' | 'unknown' {
  const location = session.Session?.location;
  if (location === 'lan' || location === 'wan') {
    return location;
  }
  const local = session.Player?.local;
  if (typeof local === 'boolean') {
    return local ? 'lan' : 'wan';
  }
  return 'unknown';
}

function streamKind(session: PlexSession): 'direct play' | 'direct stream' | 'transcode' {
  const transcode = session.TranscodeSession;
  if (!transcode) {
    return 'direct play';
  }
  return transcode.videoDecision === 'transcode' || transcode.audioDecision === 'transcode' ? 'transcode' : 'direct stream';
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

    if (this.config.serverInfo.enabled) {
      points.push(...(await this.collectServerInfo()));
    }

    if (this.config.status.enabled) {
      points.push(...(await this.collectStatus()));
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

      const kinds = sessions.map(streamKind);
      const networks = sessions.map(networkOf);
      const bandwidthOn = (network?: string): number =>
        sessions.reduce((total, s, i) => {
          const bandwidth = s.Session?.bandwidth;
          return total + (isNumber(bandwidth) && (!network || networks[i] === network) ? bandwidth : 0);
        }, 0);
      points.push(
        this.createDataPoint(
          'Plex',
          {
            type: 'current_stream_stats',
            server: this.config.id,
          },
          {
            stream_count: sessions.length,
            transcode_streams: kinds.filter((k) => k === 'transcode').length,
            direct_play_streams: kinds.filter((k) => k === 'direct play').length,
            direct_streams: kinds.filter((k) => k === 'direct stream').length,
            lan_streams: networks.filter((n) => n === 'lan').length,
            wan_streams: networks.filter((n) => n === 'wan').length,
            total_bandwidth: bandwidthOn(),
            lan_bandwidth: bandwidthOn('lan'),
            wan_bandwidth: bandwidthOn('wan'),
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
        const [count, extra] = await Promise.all([this.fetchLibraryItemCount(library), this.libraryEnrichment(library)]);
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
              ...extra,
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

  private async libraryEnrichment(library: PlexLibrary): Promise<Record<string, number>> {
    const fields: Record<string, number> = booleanFlags({ refreshing: library.refreshing });
    const scanned = ageSeconds(isNumber(library.scannedAt) ? library.scannedAt * 1000 : undefined, new Date());
    if (scanned !== undefined) {
      fields.scanned_age_seconds = scanned;
    }
    if (Array.isArray(library.Location)) {
      fields.locations = library.Location.length;
    }
    const queries = Object.entries(SECTION_COUNTS[library.type ?? ''] ?? {});
    const counts = await Promise.all(queries.map(([, mediaQuery]) => this.countItems(library, mediaQuery)));
    queries.forEach(([field], i) => {
      const count = counts[i];
      if (count !== undefined) {
        fields[field] = count;
      }
    });
    return fields;
  }

  /** Size of a media query on a section, without transferring any item; undefined when the request fails. */
  private async countItems(library: PlexLibrary, mediaQuery: MediaQuery): Promise<number | undefined> {
    try {
      const response = await this.plex.get('/library/sections/{sectionId}/all', {
        path: { sectionId: String(library.key) },
        query: { mediaQuery },
        header: { 'X-Plex-Container-Start': 0, 'X-Plex-Container-Size': 0 },
      });
      return response?.MediaContainer?.totalSize ?? response?.MediaContainer?.size;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.debug(`Could not count ${JSON.stringify(mediaQuery)} in library ${library.title}: ${message}`);
      return undefined;
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

    const enrichment = this.sessionEnrichment(session);

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
        ...enrichment.tags,
      },
      {
        hash: hashId,
        progress_percent: duration > 0 ? Math.round(((session.viewOffset ?? 0) / duration) * 100) : 0,
        ...enrichment.fields,
      },
      undefined,
      enrichment.floatFields
    );
  }

  private sessionEnrichment(session: PlexSession): {
    tags: Record<string, string | number>;
    fields: Record<string, number>;
    floatFields: string[];
  } {
    const media = session.Media?.[0];
    const player = session.Player;
    const transcode = session.TranscodeSession;
    const videoCodec = text(media?.videoCodec).toUpperCase() || 'unknown';
    const audioCodec = text(media?.audioCodec).toUpperCase() || 'unknown';
    const resolution = resolutionLabel(text(media?.videoResolution));

    const fields: Record<string, number> = {};
    if (isNumber(session.Session?.bandwidth)) {
      fields.bandwidth = session.Session.bandwidth;
    }
    if (isNumber(media?.bitrate)) {
      fields.source_bitrate = media.bitrate;
    }
    if (isNumber(session.duration)) {
      fields.duration_seconds = Math.floor(session.duration / 1000);
    }
    if (isNumber(session.viewOffset)) {
      fields.view_offset_seconds = Math.floor(session.viewOffset / 1000);
    }
    if (transcode) {
      Object.assign(fields, {
        ...(isNumber(transcode.speed) ? { transcode_speed: transcode.speed } : {}),
        ...(isNumber(transcode.progress) ? { transcode_progress: transcode.progress } : {}),
        ...booleanFlags({
          transcode_throttled: transcode.throttled,
          transcode_hw_requested: transcode.transcodeHwRequested,
          transcode_hw_full_pipeline: transcode.transcodeHwFullPipeline,
        }),
        transcode_hw_decoding: transcode.transcodeHwDecoding ? 1 : 0,
        transcode_hw_encoding: transcode.transcodeHwEncoding ? 1 : 0,
      });
    }

    return {
      tags: {
        network: networkOf(session),
        relayed: typeof player?.relayed === 'boolean' ? Number(player.relayed) : 'unknown',
        audio_decision: transcode?.audioDecision || 'direct play',
        subtitle_decision: transcode?.subtitleDecision || 'unknown',
        video_codec: videoCodec,
        stream_video_codec: transcode?.videoCodec ? transcode.videoCodec.toUpperCase() : videoCodec,
        stream_audio_codec: transcode?.audioCodec ? transcode.audioCodec.toUpperCase() : audioCodec,
        video_resolution: resolution,
        stream_video_resolution: transcode?.videoDecision === 'transcode' ? resolutionBucket(transcode.width, transcode.height) : resolution,
        device_name: text(player?.title) || 'unknown',
        device_model: text(player?.model) || 'unknown',
        platform_version: text(player?.platformVersion) || 'unknown',
        user_id: text(session.User?.id) || 'unknown',
        year: session.year ?? 'unknown',
        genre: text(session.Genre?.[0]?.tag) || 'unknown',
      },
      fields,
      floatFields: ['transcode_speed', 'transcode_progress'],
    };
  }

  private async collectServerInfo(): Promise<DataPoint[]> {
    return this.safeFetch('collect Plex server info', async () => {
      const [root, updater] = await Promise.all([this.plex.get('/'), this.plex.get('/updater/status')]);
      const server = root?.MediaContainer;
      const fields: Record<string, number> = {
        update_available: (updater?.MediaContainer?.Release?.length ?? 0) > 0 ? 1 : 0,
      };
      if (typeof server?.transcoderActiveVideoSessions === 'number') {
        fields.active_transcodes = server.transcoderActiveVideoSessions;
      }
      return [
        this.createServerInfoPoint(
          {
            version: server?.version || 'unknown',
            platform: server?.platform || 'unknown',
            remote_access: typeof server?.myPlexMappingState === 'string' ? server.myPlexMappingState : 'unknown',
          },
          fields
        ),
      ];
    });
  }

  private async collectStatus(): Promise<DataPoint[]> {
    return this.safeFetch('collect Plex status', async () => {
      const [activities, background, butler, updater, resources, transcodes] = await Promise.all([
        this.plex.get('/activities'),
        this.plex.get('/status/sessions/background'),
        this.plex.get('/butler'),
        this.plex.get('/updater/status'),
        this.plex.get('/statistics/resources', { query: { timespan: 6 } }),
        this.plex.get('/transcode/sessions'),
      ]);
      const now = new Date();
      const resourceUsage = resourcesPoint(resources?.MediaContainer);
      return this.createPoints([
        ...activityPoints(activities?.MediaContainer),
        ...backgroundTranscodePoints(background?.MediaContainer),
        ...butlerPoints(butler),
        updaterPoint(updater?.MediaContainer, now),
        ...(resourceUsage ? [resourceUsage] : []),
        transcodeSessionsPoint(transcodes?.MediaContainer),
      ]);
    });
  }
}
