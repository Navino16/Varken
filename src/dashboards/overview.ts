import { type BandSpec, type DashboardSpec, type FieldRef, num, type PanelSpec, type PanelTemplate, type Query, type SourceSpec, str, type Variant } from './model';
import {
  barGauge,
  geomap,
  healthStat,
  hourBars,
  mappingOverride,
  namedTable,
  pie,
  rowsTable,
  stat,
  timeseries,
  topTable,
  unitOverride,
  weekdayHourMatrix,
} from './panels';

const SERVARR = ['sonarr', 'radarr', 'lidarr', 'readarr'] as const;

function servarr(collector: string, spec: Omit<SourceSpec, 'plugin' | 'collector'>): SourceSpec[] {
  return SERVARR.map((plugin) => ({ plugin, collector, ...spec }));
}

/** Every media server's `current_stream_stats`; paired Plex instances are counted by Tautulli. */
function mediaServers(fields: FieldRef[], legend?: string): SourceSpec[] {
  const common = { type: 'current_stream_stats', fields, ...(legend ? { legend } : {}) };
  return [
    { plugin: 'tautulli', collector: 'activity', ...common },
    { plugin: 'plex', collector: 'sessions', streaming: 'activity', ...common },
    { plugin: 'jellyfin', collector: 'sessions', ...common },
    { plugin: 'emby', collector: 'sessions', ...common },
  ];
}

function panel(key: string, title: string, size: [number, number], query: Query, sources: SourceSpec[], grafana: PanelTemplate): PanelSpec {
  return { key, title, width: size[0], height: size[1], variants: [{ query, sources }], grafana };
}

function variants(key: string, title: string, size: [number, number], list: Variant[], grafana: PanelTemplate): PanelSpec {
  return { key, title, width: size[0], height: size[1], variants: list, grafana };
}

const LATEST_LAST: Query = { shape: 'latest', agg: 'last' };
const LATEST_COUNT: Query = { shape: 'latest', agg: 'count' };
const SERIES_MEAN: Query = { shape: 'timeSeries', agg: 'mean', bucket: 'auto' };
const DAILY_COUNT: Query = { shape: 'timeSeries', agg: 'count', bucket: '1d' };
const STAT: [number, number] = [3, 4];

const queue = (where?: SourceSpec['where']): SourceSpec[] => servarr('queue', { type: 'Queue', fields: [num('size')], ...(where ? { where } : {}) });

const plays: SourceSpec[] = [
  { plugin: 'tautulli', collector: 'history', type: 'Play', fields: [num('play_duration_seconds')], tags: ['media_type'], legend: '{tag:media_type} · {source}' },
  { plugin: 'plex', collector: 'history', streaming: 'history', type: 'Play', fields: [str('hash')], tags: ['media_type'], legend: '{tag:media_type} · {source}' },
  ...(['jellyfin', 'emby'] as const).map(
    (plugin): SourceSpec => ({
      plugin,
      collector: 'history',
      type: 'Activity',
      where: [{ key: 'activity_type', kind: 'tag', op: '=', value: 'VideoPlayback' }],
      fields: [str('hash')],
    })
  ),
];

const SESSION_TAGS = ['username', 'title', 'video_decision', 'quality'];
const REQUEST_TAGS = ['title', 'requested_user', 'requested_date', 'status'];
const requestsTable = (statuses: Record<string, string>): PanelTemplate =>
  rowsTable({
    hide: ['hash'],
    sortBy: { field: 'requested_date', desc: true },
    limit: 10,
    rename: { title: 'Title', requested_user: 'User', requested_date: 'Requested', status: 'Status' },
    overrides: [mappingOverride('Status', statuses)],
  });

/** Every health problem as one named series; `message` is the HealthIssue detail. */
function healthAlerts(message: FieldRef): SourceSpec[] {
  return [
    ...[...SERVARR, 'prowlarr' as const].map(
      (plugin): SourceSpec => ({
        plugin,
        collector: 'status',
        type: 'HealthIssue',
        fields: [message],
        tags: ['level', 'source'],
        legend: '{source} · {tag:level} · {tag:source}',
      })
    ),
    {
      plugin: 'bazarr',
      collector: 'status',
      type: 'Provider',
      where: [{ key: 'throttled', kind: 'number', op: '=', value: 1 }],
      fields: [num('throttled')],
      tags: ['provider', 'status'],
      legend: '{source} · {tag:provider} · {tag:status}',
    },
    {
      plugin: 'varken',
      type: 'Collector',
      where: [{ key: 'circuit_state', kind: 'number', op: '>', value: 0 }],
      fields: [num('consecutive_errors')],
      tags: ['plugin', 'server', 'collector'],
      legend: 'Varken · {tag:plugin} {tag:server} · {tag:collector} circuit',
    },
  ];
}

const NOW: BandSpec = {
  key: 'now',
  title: 'Now',
  fixedWindow: '24h',
  panels: [
    panel('streams', 'Streams', STAT, LATEST_LAST, mediaServers([num('stream_count')]), stat()),
    panel('transcodes', 'Transcodes', STAT, LATEST_LAST, mediaServers([num('transcode_streams')]), stat()),
    panel(
      'bandwidth',
      'Bandwidth',
      STAT,
      LATEST_LAST,
      mediaServers([num('total_bandwidth')]).filter((s) => s.plugin === 'tautulli' || s.plugin === 'plex'),
      stat({ unit: 'Kbits' })
    ),
    panel('downloads', 'Downloads', STAT, LATEST_COUNT, queue(), stat()),
    panel(
      'stuck',
      'Stuck downloads',
      STAT,
      LATEST_COUNT,
      queue([
        { key: 'tracked_download_status', kind: 'tag', op: '!=', value: 'ok' },
        { key: 'tracked_download_status', kind: 'tag', op: '!=', value: 'unknown' },
      ]),
      stat({ thresholds: [{ color: 'green', value: null }, { color: 'red', value: 1 }] })
    ),
    panel(
      'pending-requests',
      'Pending requests',
      STAT,
      LATEST_LAST,
      (['overseerr', 'ombi'] as const).map((plugin) => ({ plugin, collector: 'requestCounts', type: 'Request_Counts', fields: [num('pending')] })),
      stat()
    ),
    panel(
      'missing-subtitles',
      'Missing subtitles',
      STAT,
      LATEST_LAST,
      [{ plugin: 'bazarr', collector: 'wanted', type: 'WantedTotal', fields: [num('movies'), num('episodes')] }],
      stat()
    ),
    panel(
      'healthy',
      'Healthy collectors',
      STAT,
      LATEST_LAST,
      [{ plugin: 'varken', type: 'Status', fields: [num('collectors'), num('collectors_open')], legend: '{field}' }],
      healthStat()
    ),
    panel(
      'now-playing',
      'Now playing',
      [16, 8],
      { shape: 'latestTable' },
      [
        { plugin: 'tautulli', collector: 'activity', type: 'Session', fields: [num('progress')], tags: SESSION_TAGS },
        ...(['plex', 'jellyfin', 'emby'] as const).map(
          (plugin): SourceSpec => ({
            plugin,
            collector: 'sessions',
            ...(plugin === 'plex' ? { streaming: 'activity' as const } : {}),
            type: 'Session',
            fields: [num('progress_percent', 'progress')],
            tags: SESSION_TAGS,
          })
        ),
      ],
      rowsTable({
        rename: { username: 'User', title: 'Title', video_decision: 'Decision', quality: 'Quality', progress: 'Progress' },
        overrides: [unitOverride('Progress', 'percent')],
      })
    ),
    panel(
      'geoip',
      'Where from',
      [8, 8],
      { shape: 'latestTable' },
      [{ plugin: 'tautulli', collector: 'activity', requires: ['geoip.enabled'], type: 'Session', fields: [num('lat'), num('lon')], tags: ['full_location', 'username'] }],
      geomap()
    ),
    panel('streams-24h', 'Streams · 24 h', [8, 7], SERIES_MEAN, mediaServers([num('stream_count')]), timeseries({ stacked: true })),
    panel(
      'bandwidth-24h',
      'LAN / WAN bandwidth · 24 h',
      [8, 7],
      SERIES_MEAN,
      mediaServers([num('lan_bandwidth', 'LAN'), num('wan_bandwidth', 'WAN')]).filter((s) => s.plugin === 'tautulli' || s.plugin === 'plex'),
      timeseries({ unit: 'Kbits' })
    ),
    panel(
      'media-server',
      'Media server CPU / RAM · 24 h',
      [8, 7],
      SERIES_MEAN,
      [{ plugin: 'plex', collector: 'status', type: 'Resources', fields: [num('process_cpu_percent', 'CPU'), num('process_memory_percent', 'RAM')] }],
      timeseries({ unit: 'percent' })
    ),
    panel(
      'download-queue',
      'Download queue',
      [8, 8],
      { shape: 'latestTable' },
      SERVARR.map((plugin) => ({
        plugin,
        collector: 'queue',
        type: 'Queue',
        fields: [num('progress'), num('sizeleft')],
        tags: plugin === 'sonarr' ? ['name', 'sxe', 'tracked_download_status'] : ['name', 'tracked_download_status'],
      })),
      rowsTable({
        rename: { name: 'Title', sxe: 'Episode', tracked_download_status: 'Status', progress: 'Progress', sizeleft: 'Left' },
        overrides: [unitOverride('Progress', 'percent'), unitOverride('Left', 'bytes')],
      })
    ),
    panel(
      'calendar',
      'This week',
      [8, 8],
      { shape: 'latestTable' },
      (['Future', 'Missing'] as const).map((type) => ({
        plugin: 'sonarr',
        collector: 'calendar',
        type,
        fields: [str('hash')],
        tags: ['name', 'sxe', 'airsUTC', 'downloaded'],
      })),
      rowsTable({
        hide: ['hash'],
        sortBy: { field: 'airsUTC' },
        rename: { airsUTC: 'Airs', name: 'Series', sxe: 'Episode', downloaded: 'Downloaded' },
        overrides: [mappingOverride('Downloaded', { '0': 'no', '1': 'yes' })],
      })
    ),
    variants(
      'latest-requests',
      'Latest requests',
      [8, 8],
      [
        {
          query: { shape: 'latestTable' },
          sources: [{ plugin: 'overseerr', collector: 'latestRequests', type: 'Requests', fields: [str('hash')], tags: REQUEST_TAGS }],
          grafana: requestsTable({ '1': 'pending', '2': 'approved', '3': 'declined', '4': 'failed', '5': 'completed' }),
        },
        {
          query: { shape: 'latestTable' },
          sources: [{ plugin: 'ombi', collector: 'requestCounts', type: 'Requests', fields: [str('hash')], tags: REQUEST_TAGS }],
          grafana: requestsTable({ '0': 'denied', '1': 'approved', '2': 'completed', '3': 'pending' }),
        },
      ],
      { type: 'table' }
    ),
    panel(
      'free-space',
      'Free space',
      [8, 7],
      LATEST_LAST,
      servarr('status', { type: 'RootFolder', fields: [num('free_bytes')], tags: ['path'], legend: '{source} {tag:path}' }),
      barGauge('bytes')
    ),
    variants(
      'health-alerts',
      'Health alerts',
      [16, 7],
      [
        { query: LATEST_LAST, sources: healthAlerts(str('message')), complete: true },
        // SQL cannot return strings as series: the alert is still listed, its detail is a count.
        { query: LATEST_LAST, sources: healthAlerts({ ...str('message'), agg: 'count' }) },
      ],
      namedTable({ Field: 'Alert', 'Last *': 'Detail' })
    ),
  ],
};

const PERIOD: BandSpec = {
  key: 'period',
  title: 'Over the period',
  panels: [
    panel('plays-per-day', 'Plays per day', [16, 8], DAILY_COUNT, plays, timeseries({ stacked: true, bars: true })),
    panel(
      'top-users',
      'Top users',
      [8, 8],
      { shape: 'topN', agg: 'count' },
      [
        { plugin: 'tautulli', collector: 'history', type: 'Play', fields: [num('play_duration_seconds', 'plays')], tags: ['username'] },
        { plugin: 'plex', collector: 'history', streaming: 'history', type: 'Play', fields: [str('hash', 'plays')], tags: ['username'] },
      ],
      topTable(['username'], 'plays', { username: 'User', plays: 'Plays' })
    ),
    variants(
      'plays-by-hour',
      'Plays by hour and weekday',
      [8, 8],
      [
        { query: { shape: 'timeBuckets' }, sources: plays, size: [24, 10] },
        {
          query: { shape: 'latestTable' },
          size: [8, 8],
          sources: [
            {
              plugin: 'tautulli',
              collector: 'stats',
              throttleSeconds: 300,
              type: 'PlaysByHourOfDay',
              fields: [num('tv'), num('movies'), num('music'), num('live_tv')],
              tags: ['hour'],
            },
          ],
          grafana: { ...hourBars(), title: 'Plays by hour of day (last 30 days)' },
        },
      ],
      weekdayHourMatrix()
    ),
    panel(
      'most-watched',
      'Most watched',
      [8, 8],
      { shape: 'topN', agg: 'count' },
      (['tautulli', 'plex'] as const).map(
        (plugin): SourceSpec => ({
          plugin,
          collector: 'history',
          ...(plugin === 'plex' ? { streaming: 'history' as const } : {}),
          type: 'Play',
          fields: [str('hash', 'plays'), { ...str('title'), agg: 'last' }],
          tags: ['rating_key'],
        })
      ),
      // Plex titles episodes by their own name: grouping by item too keeps same-named episodes of different shows apart.
      topTable(['rating_key', 'title'], 'plays', { title: 'Title', plays: 'Plays' }, ['rating_key'])
    ),
    panel(
      'direct-vs-transcode',
      'Direct play vs transcode',
      [8, 8],
      { shape: 'proportion' },
      mediaServers([num('direct_play_streams', 'Direct play'), num('direct_streams', 'Direct stream'), num('transcode_streams', 'Transcode')], '{field}'),
      pie()
    ),
    panel(
      'recently-added',
      'Recently added',
      [8, 8],
      { shape: 'eventTable', limit: 10 },
      [{ plugin: 'tautulli', collector: 'stats', throttleSeconds: 300, type: 'RecentlyAdded', fields: [str('title')], tags: ['library_name', 'media_type'] }],
      rowsTable({ sortBy: { field: 'Time', desc: true }, limit: 10, rename: { Time: 'Added', title: 'Title', library_name: 'Library', media_type: 'Type' } })
    ),
    panel(
      'requests-per-day',
      'Requests per day',
      [8, 8],
      { shape: 'timeSeries', agg: 'last', bucket: '1d', transform: 'nonNegativeDifference' },
      [
        { plugin: 'overseerr', collector: 'requestCounts', type: 'Request_Counts', fields: [num('total')] },
        { plugin: 'ombi', collector: 'requestCounts', type: 'Request_Total', fields: [num('total')] },
      ],
      timeseries({ bars: true, stacked: true })
    ),
    variants(
      'subtitles-per-day',
      'Subtitles downloaded per day',
      [8, 8],
      [
        {
          query: { shape: 'timeSeries', agg: 'sum', bucket: '1d' },
          sources: [{ plugin: 'bazarr', collector: 'stats', type: 'HistoryStats', fields: [num('movies', 'Movies'), num('episodes', 'Episodes')], legend: '{field}' }],
        },
        {
          query: DAILY_COUNT,
          sources: [{ plugin: 'bazarr', collector: 'history', type: 'History', fields: [num('upgradable')], tags: ['media_type'], legend: '{tag:media_type}' }],
        },
      ],
      timeseries({ bars: true, stacked: true })
    ),
  ],
};

export const OVERVIEW: DashboardSpec = { kind: 'overview', title: 'Varken Overview', bands: [NOW, PERIOD] };
