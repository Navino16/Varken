import { BaseInputPlugin } from './BaseInputPlugin';
import { PROTOCOL_ID } from './constants';
import type { PluginMetadata, DataPoint, PointSpec, ScheduleConfig } from '../../types/plugin.types';
import type { LidarrConfig } from '../../types/inputs/lidarr.types';
import type { paths } from '../../types/generated/lidarr';
import { servarrServerInfo } from './utils/servarrServerInfo';
import { queueEnrichment, statusPoints, totalsPoint, historyPoint, releaseAgeDays, sumFields } from './utils/servarr';
import { pickNumbers } from './utils/numbers';
import { booleanFlags } from './utils/flags';

/**
 * Lidarr input plugin
 * Collects queue and missing albums data from Lidarr v1 API
 */
export class LidarrPlugin extends BaseInputPlugin<LidarrConfig> {
  readonly metadata: PluginMetadata = {
    name: 'Lidarr',
    version: '1.0.0',
    description: 'Collects queue and missing albums data from Lidarr',
  };

  private readonly lidarr = this.api<paths>();

  /**
   * Initialize the plugin and configure the HTTP client with API key header
   */
  async initialize(...args: Parameters<BaseInputPlugin<LidarrConfig>['initialize']>): Promise<void> {
    await super.initialize(...args);
    this.httpClient.defaults.headers.common['X-Api-Key'] = this.config.apiKey;
  }

  /**
   * Health check endpoint for Lidarr
   */
  protected getHealthEndpoint(): string {
    return '/api/v1/system/status';
  }

  /**
   * Collect all enabled data from Lidarr
   */
  async collect(): Promise<DataPoint[]> {
    const points: DataPoint[] = [];

    if (this.config.queue.enabled) {
      const queuePoints = await this.collectQueue();
      points.push(...queuePoints);
    }

    if (this.config.missing.enabled) {
      const missingPoints = await this.collectMissing();
      points.push(...missingPoints);
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

    if (this.config.missing.enabled) {
      schedules.push(
        this.createSchedule('missing', this.config.missing.intervalSeconds, true, this.collectMissing)
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
   * Collect queue data from Lidarr
   */
  private async collectQueue(): Promise<DataPoint[]> {
    return this.safeFetch('collect Lidarr queue', async () => {
      const points: DataPoint[] = [];
      const allRecords = await this.lidarr.getAllPages('/api/v1/queue', {
        query: { includeAlbum: true, includeArtist: true, includeUnknownArtistItems: false },
      });

      if (allRecords.length === 0) {
        this.logger.debug('No items in Lidarr queue');
        return points;
      }

      const now = new Date();
      for (const queueItem of allRecords) {
        if (!queueItem.album) {
          this.logger.debug('Skipping queue item with missing album data');
          continue;
        }

        const album = queueItem.album;
        const artistName = queueItem.artist?.artistName || 'Unknown Artist';
        const name = `${album.title} - ${artistName}`;
        const protocol = (queueItem.protocol ?? 'unknown').toUpperCase();
        const protocolId = protocol === 'USENET' ? PROTOCOL_ID.USENET : PROTOCOL_ID.TORRENT;
        const quality = queueItem.quality?.quality?.name || 'Unknown';

        const hashId = this.hashit(`${this.config.id}${name}${quality}`);

        const enrichment = queueEnrichment(queueItem, now);
        points.push(
          this.createDataPoint(
            'Lidarr',
            {
              type: 'Queue',
              albumId: queueItem.albumId ?? 0,
              server: this.config.id,
              name,
              quality,
              protocol,
              protocol_id: protocolId,
              ...enrichment.tags,
            },
            { hash: hashId, ...enrichment.fields },
            undefined,
            enrichment.floatFields
          )
        );
      }

      this.logger.info(`Collected ${points.length} queue items from Lidarr`);
      return points;
    });
  }

  /**
   * Collect missing albums from Lidarr
   */
  private async collectMissing(): Promise<DataPoint[]> {
    return this.safeFetch('collect Lidarr missing albums', async () => {
      const points: DataPoint[] = [];
      const albums = await this.lidarr.getAllPages('/api/v1/wanted/missing', {
        query: { sortKey: 'releaseDate', sortDirection: 'descending', monitored: true, includeArtist: true },
      });

      if (albums.length === 0) {
        this.logger.debug('No missing albums found in Lidarr');
        return points;
      }

      const now = new Date();
      for (const album of albums) {
        const artistName = album.artist?.artistName || 'Unknown Artist';
        const albumName = `${album.title ?? 'unknown'} - ${artistName}`;
        const foreignAlbumId = album.foreignAlbumId ?? 'unknown';

        const hashId = this.hashit(`${this.config.id}${albumName}${foreignAlbumId}`);

        const age = releaseAgeDays(album.releaseDate, now);
        points.push(
          this.createDataPoint(
            'Lidarr',
            {
              type: 'Missing',
              albumId: album.id ?? 0,
              foreignAlbumId,
              server: this.config.id,
              name: albumName,
              album_type: album.albumType || 'unknown',
            },
            {
              hash: hashId,
              ...(age === undefined ? {} : { release_age_days: age }),
              ...pickNumbers(album.statistics, {
                trackFileCount: 'track_file_count',
                trackCount: 'track_count',
                totalTrackCount: 'total_track_count',
                sizeOnDisk: 'size_on_disk',
                percentOfTracks: 'percent_of_tracks',
              }),
            },
            undefined,
            ['percent_of_tracks']
          )
        );
      }

      this.logger.info(`Collected ${points.length} missing albums from Lidarr`);
      return points;
    });
  }

  private async collectServerInfo(): Promise<DataPoint[]> {
    return this.safeFetch('collect Lidarr server info', async () => {
      const [status, updates, health] = await Promise.all([
        this.lidarr.get('/api/v1/system/status'),
        this.lidarr.get('/api/v1/update'),
        this.lidarr.get('/api/v1/health'),
      ]);
      const { tags, fields } = servarrServerInfo(status, updates, health, new Date());
      return [this.createServerInfoPoint(tags, fields)];
    });
  }

  private async collectStatus(): Promise<DataPoint[]> {
    return this.safeFetch('collect Lidarr status', async () => {
      const [health, disks, roots, queue, tasks] = await Promise.all([
        this.lidarr.get('/api/v1/health'),
        this.lidarr.get('/api/v1/diskspace'),
        this.lidarr.get('/api/v1/rootfolder'),
        this.lidarr.get('/api/v1/queue/status'),
        this.lidarr.get('/api/v1/system/task'),
      ]);
      return this.createPoints(statusPoints({ health, disks, roots, queue, tasks }, new Date(), (s) => this.hashit(s)));
    });
  }

  private async collectTotals(): Promise<DataPoint[]> {
    return this.safeFetch('collect Lidarr totals', async () => {
      const wanted = { page: 1, pageSize: 1, monitored: true };
      const [missing, cutoff, blocklist] = await Promise.all([
        this.lidarr.get('/api/v1/wanted/missing', { query: wanted }),
        this.lidarr.get('/api/v1/wanted/cutoff', { query: wanted }),
        this.lidarr.get('/api/v1/blocklist', { query: { page: 1, pageSize: 1 } }),
      ]);
      return this.createPoints([
        totalsPoint({ missing: missing.totalRecords, cutoff_unmet: cutoff.totalRecords, blocklist: blocklist.totalRecords }),
      ]);
    });
  }

  private async collectHistory(): Promise<DataPoint[]> {
    return this.safeFetch('collect Lidarr history', async () => {
      const date = (await this.eventCursor('history')).toISOString();
      const records = await this.lidarr.get('/api/v1/history/since', { query: { date, includeArtist: false, includeAlbum: false, includeTrack: false } });
      const fresh = await this.takeNewEvents('history', records, (r) => Date.parse(r.date ?? ''), (r) => String(r.id));
      return this.createPoints(
        fresh.flatMap((r) => historyPoint(r, { artistId: r.artistId ?? 0, albumId: r.albumId ?? 0 }, this.hashit(`${this.config.id}${r.id}`)) ?? [])
      );
    });
  }

  private async collectLibrary(): Promise<DataPoint[]> {
    return this.safeFetch('collect Lidarr library', async () => {
      const artists = await this.lidarr.get('/api/v1/artist');
      const items: PointSpec[] = artists.map((a) => ({
        tags: { type: 'Artist', artistId: a.id ?? 0, name: a.artistName ?? 'unknown', status: a.status ?? 'unknown', ended: a.ended ? 1 : 0 },
        fields: {
          ...booleanFlags({ monitored: a.monitored }),
          ...pickNumbers(a.statistics, {
            albumCount: 'album_count',
            trackFileCount: 'track_file_count',
            trackCount: 'track_count',
            totalTrackCount: 'total_track_count',
            sizeOnDisk: 'size_on_disk',
            percentOfTracks: 'percent_of_tracks',
          }),
        },
        floatFields: ['percent_of_tracks'],
      }));
      const summary = {
        artists: items.length,
        ...sumFields(items, {
          monitored: 'artists_monitored',
          album_count: 'albums',
          track_count: 'tracks',
          track_file_count: 'track_files',
          total_track_count: 'total_tracks',
          size_on_disk: 'size_on_disk',
        }),
      };
      return this.createPoints([{ tags: { type: 'Library' }, fields: summary }, ...items]);
    });
  }
}
