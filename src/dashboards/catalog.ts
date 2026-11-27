import { type Agg, type FieldRef, type Filter, type InputKey, num, type PanelTemplate, str } from './model';
import { categoryBars } from './panels';

/** One point type of `docs/data-reference.md` and how the Detailed dashboard shows it. */
export interface PointSpec {
  type: string;
  title: string;
  /** Config key of the collector writing the points; none for Varken self-metrics. */
  collector?: string;
  view: 'series' | 'stats' | 'table' | 'events';
  fields: FieldRef[];
  /** Table and event columns, in order. */
  tags?: string[];
  /** Tag naming the series of a gauge, or splitting the daily event count. */
  by?: string;
  /** Field alias → Grafana unit. */
  units?: Record<string, string>;
  /** Column → value → text. */
  mappings?: Record<string, Record<string, string>>;
  where?: Filter[];
  throttleSeconds?: number;
  size?: [number, number];
  /** Gauge aggregation per bucket; `mean` by default. */
  agg?: Agg;
  legend?: string;
  grafana?: PanelTemplate;
}

type Plugin = InputKey | 'varken';
type Servarr = 'sonarr' | 'radarr' | 'readarr' | 'lidarr';

const nums = (...names: string[]): FieldRef[] => names.map((name) => num(name));
const seconds = (...names: string[]): Record<string, string> => Object.fromEntries(names.map((name) => [name, 's']));
const HASH = str('hash');
const SERVER_INFO_SIZE: [number, number] = [12, 5];

function serverInfo(collector: string, tags: string[], fields: string[], units: Record<string, string> = {}): PointSpec {
  return { type: 'ServerInfo', title: 'Server', collector, view: 'table', tags, fields: [num('reachable'), ...nums(...fields)], units, size: SERVER_INFO_SIZE };
}

const healthPoints = (): PointSpec[] => [
  { type: 'Health', title: 'Health checks', collector: 'status', view: 'series', fields: nums('errors', 'warnings', 'notices') },
  { type: 'HealthIssue', title: 'Health issues', collector: 'status', view: 'table', tags: ['level', 'source'], fields: [str('message')], size: [24, 6] },
  {
    type: 'Task',
    title: 'Scheduled tasks',
    collector: 'status',
    view: 'table',
    tags: ['name'],
    fields: nums('interval_minutes', 'last_execution_age_seconds', 'last_duration_seconds', 'next_execution_in_seconds'),
    units: { interval_minutes: 'm', ...seconds('last_execution_age_seconds', 'last_duration_seconds', 'next_execution_in_seconds') },
  },
];

const SERVARR_SERVER_INFO = serverInfo('serverInfo', ['version', 'branch'], ['update_available', 'uptime_seconds', 'health_errors', 'health_warnings', 'health_notices'], seconds('uptime_seconds'));

const QUEUE_TAGS = ['quality', 'protocol', 'download_client', 'indexer', 'status', 'tracked_download_state', 'tracked_download_status'];

interface ServarrShape {
  queueTags: string[];
  missing: PointSpec[];
  rootFolder: string[];
  rootFolderTags: string[];
  library: string[];
  item: { type: string; title: string; tags: string[]; fields: string[]; percent: string };
}

const SERVARR: Record<Servarr, ServarrShape> = {
  sonarr: {
    queueTags: ['name', 'sxe'],
    missing: [
      { type: 'Missing', title: 'Missing episodes', collector: 'calendar', view: 'table', tags: ['name', 'sxe', 'epname', 'airsUTC'], fields: [HASH] },
      { type: 'Future', title: 'Upcoming episodes', collector: 'calendar', view: 'table', tags: ['airsUTC', 'name', 'sxe', 'epname', 'downloaded'], fields: [HASH], mappings: { downloaded: { '0': 'no', '1': 'yes' } } },
    ],
    rootFolder: ['accessible', 'free_bytes', 'unmapped_folders'],
    rootFolderTags: ['path'],
    library: ['series', 'series_monitored', 'series_ended', 'episodes', 'episode_files', 'total_episodes', 'size_on_disk'],
    item: {
      type: 'Series',
      title: 'Series',
      tags: ['name', 'status', 'network', 'series_type'],
      fields: ['monitored', 'season_count', 'episode_count', 'episode_file_count', 'total_episode_count', 'size_on_disk', 'percent_of_episodes'],
      percent: 'percent_of_episodes',
    },
  },
  radarr: {
    queueTags: ['name'],
    missing: [{ type: 'Missing', title: 'Missing movies', collector: 'missing', view: 'table', tags: ['name', 'Missing_Available'], fields: [HASH], mappings: { Missing_Available: { '0': 'no', '1': 'yes' } } }],
    rootFolder: ['accessible', 'free_bytes', 'unmapped_folders'],
    rootFolderTags: ['path'],
    library: ['movies', 'movies_monitored', 'movies_with_file', 'size_on_disk', 'collections'],
    item: { type: 'Collection', title: 'Collections', tags: ['name'], fields: ['monitored', 'movies', 'movies_in_library', 'missing'], percent: '' },
  },
  readarr: {
    queueTags: ['name'],
    missing: [
      {
        type: 'Missing',
        title: 'Missing books',
        collector: 'missing',
        view: 'table',
        tags: ['name'],
        fields: [HASH, ...nums('release_age_days', 'book_file_count', 'book_count', 'total_book_count', 'size_on_disk', 'percent_of_books')],
        units: { size_on_disk: 'bytes', percent_of_books: 'percent' },
      },
    ],
    rootFolder: ['accessible', 'free_bytes', 'total_bytes'],
    rootFolderTags: ['path', 'name'],
    library: ['authors', 'authors_monitored', 'books', 'book_files', 'total_books', 'size_on_disk'],
    item: {
      type: 'Author',
      title: 'Authors',
      tags: ['name', 'status'],
      fields: ['monitored', 'book_file_count', 'book_count', 'available_book_count', 'total_book_count', 'size_on_disk', 'percent_of_books'],
      percent: 'percent_of_books',
    },
  },
  lidarr: {
    queueTags: ['name'],
    missing: [
      {
        type: 'Missing',
        title: 'Missing albums',
        collector: 'missing',
        view: 'table',
        tags: ['name', 'album_type'],
        fields: [HASH, ...nums('release_age_days', 'track_file_count', 'track_count', 'total_track_count', 'size_on_disk', 'percent_of_tracks')],
        units: { size_on_disk: 'bytes', percent_of_tracks: 'percent' },
      },
    ],
    rootFolder: ['accessible', 'free_bytes', 'total_bytes'],
    rootFolderTags: ['path', 'name'],
    library: ['artists', 'artists_monitored', 'albums', 'tracks', 'track_files', 'total_tracks', 'size_on_disk'],
    item: {
      type: 'Artist',
      title: 'Artists',
      tags: ['name', 'status'],
      fields: ['monitored', 'album_count', 'track_file_count', 'track_count', 'total_track_count', 'size_on_disk', 'percent_of_tracks'],
      percent: 'percent_of_tracks',
    },
  },
};

function servarrPoints(plugin: Servarr): PointSpec[] {
  const shape = SERVARR[plugin];
  const [health, issues, tasks] = healthPoints();
  return [
    {
      type: 'Queue',
      title: 'Download queue',
      collector: 'queue',
      view: 'table',
      tags: [...shape.queueTags, ...QUEUE_TAGS],
      fields: [num('progress'), num('size'), num('sizeleft', 'left'), num('eta_seconds', 'eta')],
      units: { progress: 'percent', size: 'bytes', left: 'bytes', eta: 's' },
    },
    { type: 'QueueStatus', title: 'Queue', collector: 'status', view: 'series', fields: nums('total_count', 'count', 'unknown_count') },
    { type: 'Totals', title: 'Wanted totals', collector: 'totals', view: 'series', fields: nums('missing', 'cutoff_unmet', 'blocklist') },
    ...shape.missing,
    {
      type: 'History',
      title: 'History',
      collector: 'history',
      view: 'events',
      by: 'event_type',
      tags: ['event_type', 'quality', 'download_client', 'indexer'],
      fields: [HASH, num('size')],
      units: { size: 'bytes' },
    },
    health,
    {
      type: 'DiskSpace',
      title: 'Disks',
      collector: 'status',
      view: 'table',
      tags: ['path', 'label'],
      fields: nums('free_bytes', 'total_bytes', 'used_percent'),
      units: { free_bytes: 'bytes', total_bytes: 'bytes', used_percent: 'percent' },
    },
    issues,
    tasks,
    {
      type: 'RootFolder',
      title: 'Root folders',
      collector: 'status',
      view: 'table',
      tags: shape.rootFolderTags,
      fields: nums(...shape.rootFolder),
      units: { free_bytes: 'bytes', total_bytes: 'bytes' },
      size: [12, 6],
    },
    SERVARR_SERVER_INFO,
    { type: 'Library', title: 'Library', collector: 'library', view: 'stats', fields: nums(...shape.library), units: { size_on_disk: 'bytes' } },
    {
      type: shape.item.type,
      title: shape.item.title,
      collector: 'library',
      view: 'table',
      tags: shape.item.tags,
      fields: nums(...shape.item.fields),
      units: { size_on_disk: 'bytes', ...(shape.item.percent ? { [shape.item.percent]: 'percent' } : {}) },
    },
  ];
}

const INDEXER_TAGS = ['indexerName', 'protocol', 'privacy', 'enabled', 'priority'];
const INDEXER_FIELDS: FieldRef[] = [
  num('numberOfQueries', 'queries'),
  num('numberOfGrabs', 'grabs'),
  num('numberOfRssQueries', 'rss_queries'),
  num('numberOfAuthQueries', 'auth_queries'),
  num('numberOfFailedQueries', 'failed_queries'),
  num('numberOfFailedGrabs', 'failed_grabs'),
  num('numberOfFailedRssQueries', 'failed_rss_queries'),
  num('numberOfFailedAuthQueries', 'failed_auth_queries'),
  num('averageResponseTime', 'response_time'),
  num('averageGrabResponseTime', 'grab_response_time'),
];
const INDEXER_UNITS = { response_time: 'ms', grab_response_time: 'ms' };
const callers = (type: string, tag: string, title: string): PointSpec => ({
  type,
  title,
  collector: 'indexerStats',
  view: 'table',
  tags: [tag],
  fields: [num('numberOfQueries', 'queries'), num('numberOfGrabs', 'grabs')],
  size: [12, 6],
});

const PROWLARR: PointSpec[] = [
  { type: 'IndexerStats', title: 'Indexers', collector: 'indexerStats', view: 'table', tags: INDEXER_TAGS, fields: INDEXER_FIELDS, units: INDEXER_UNITS },
  { type: 'IndexerStatsWindow', title: 'Indexers · 24 h', collector: 'indexerStats', view: 'table', tags: INDEXER_TAGS, fields: INDEXER_FIELDS, units: INDEXER_UNITS },
  callers('UserAgentStats', 'user_agent', 'Applications'),
  callers('HostStats', 'host', 'Hosts'),
  {
    type: 'History',
    title: 'Grabs',
    collector: 'history',
    view: 'events',
    by: 'source',
    tags: ['source', 'indexerId', 'successful', 'grab_method'],
    fields: [HASH, num('elapsed_ms', 'elapsed')],
    units: { elapsed: 'ms' },
  },
  ...healthPoints().slice(0, 1),
  {
    type: 'IndexerStatus',
    title: 'Indexer failures',
    collector: 'status',
    view: 'table',
    tags: ['indexerId'],
    fields: nums('disabled', 'disabled_for_seconds', 'most_recent_failure_age_seconds', 'initial_failure_age_seconds'),
    units: seconds('disabled_for_seconds', 'most_recent_failure_age_seconds', 'initial_failure_age_seconds'),
    size: [12, 6],
  },
  ...healthPoints().slice(1),
  { type: 'IndexerStatusSummary', title: 'Disabled indexers', collector: 'status', view: 'series', fields: nums('disabled_indexers'), size: [12, 6] },
  { type: 'Application', title: 'Synced applications', collector: 'inventory', view: 'table', tags: ['application', 'implementation', 'sync_level'], fields: [HASH], size: [12, 6] },
  { type: 'Inventory', title: 'Inventory', collector: 'inventory', view: 'stats', fields: nums('indexers', 'indexers_enabled', 'applications', 'applications_syncing') },
  SERVARR_SERVER_INFO,
];

const BAZARR: PointSpec[] = [
  { type: 'WantedTotal', title: 'Missing subtitles', collector: 'wanted', view: 'series', fields: nums('movies', 'episodes') },
  { type: 'Badges', title: 'Badges', collector: 'status', view: 'series', fields: nums('wanted_episodes', 'wanted_movies', 'throttled_providers', 'health_issues', 'announcements', 'sonarr_signalr', 'radarr_signalr') },
  {
    type: 'Wanted',
    title: 'Wanted subtitles',
    collector: 'wanted',
    view: 'table',
    tags: ['media_type', 'name', 'language', 'forced', 'hi', 'tags'],
    fields: [HASH],
    mappings: { forced: { '0': 'no', '1': 'yes' }, hi: { '0': 'no', '1': 'yes' } },
  },
  {
    type: 'History',
    title: 'Subtitle history',
    collector: 'history',
    view: 'events',
    by: 'provider',
    tags: ['media_type', 'name', 'language', 'provider'],
    fields: [HASH, num('score_percent', 'score'), ...nums('upgradable', 'matches', 'dont_matches')],
    units: { score: 'percent' },
  },
  { type: 'HistoryStats', title: 'Subtitles downloaded per day', collector: 'stats', view: 'series', fields: nums('movies', 'episodes') },
  { type: 'Jobs', title: 'Jobs', collector: 'status', view: 'series', fields: nums('pending', 'running', 'failed', 'completed') },
  { type: 'Provider', title: 'Providers', collector: 'status', view: 'table', tags: ['provider', 'status'], fields: nums('throttled'), size: [12, 6] },
  { type: 'Task', title: 'Scheduled tasks', collector: 'status', view: 'table', tags: ['task_name', 'interval'], fields: nums('running'), size: [12, 6] },
  {
    type: 'Library',
    title: 'Library',
    collector: 'library',
    view: 'table',
    tags: ['media_type'],
    fields: nums('items', 'monitored', 'missing_subtitles_items', 'missing_subtitles', 'subtitles', 'ended', 'episode_files', 'episodes_missing_subtitles'),
    size: [24, 5],
  },
  { type: 'Languages', title: 'Languages', collector: 'stats', view: 'stats', fields: nums('enabled', 'total') },
  { type: 'Releases', title: 'Releases', collector: 'status', view: 'table', tags: ['latest'], fields: nums('releases', 'releases_behind'), size: SERVER_INFO_SIZE },
  serverInfo('serverInfo', ['version', 'sonarr_version', 'radarr_version'], ['uptime_seconds', 'health_issues'], seconds('uptime_seconds')),
];

const REQUEST_COLUMNS = ['requested_date', 'title', 'media_type', 'requested_user', 'status'];
const quotas = (...kinds: string[]): string[] => kinds.flatMap((kind) => [`${kind}_quota_limit`, `${kind}_quota_remaining`]);

const OMBI: PointSpec[] = [
  { type: 'Request_Counts', title: 'Request counts', collector: 'requestCounts', view: 'series', fields: nums('pending', 'approved', 'available', 'denied') },
  { type: 'Request_Total', title: 'Request totals', collector: 'requestCounts', view: 'series', fields: nums('total', 'movies', 'tv_shows', 'tv_requests', 'music') },
  {
    type: 'Requests',
    title: 'Requests',
    collector: 'requestCounts',
    view: 'table',
    tags: REQUEST_COLUMNS,
    fields: [HASH, num('approve_seconds', 'approval_time'), num('available_seconds', 'availability_time')],
    units: { approval_time: 's', availability_time: 's' },
    mappings: { status: { '0': 'denied', '1': 'approved', '2': 'completed', '3': 'pending' } },
  },
  { type: 'Issues_Counts', title: 'Issues', collector: 'issueCounts', view: 'series', fields: nums('pending', 'in_progress', 'resolved') },
  { type: 'Stats', title: 'Last 30 days', collector: 'totals', view: 'series', fields: nums('movie_requests_30d', 'tv_requests_30d', 'completed_tv_30d'), size: [12, 6] },
  { type: 'Totals', title: 'Requests by status', collector: 'totals', view: 'table', tags: ['media_type'], fields: nums('total', 'available', 'processing', 'pending', 'denied', 'unavailable'), size: [12, 6] },
  { type: 'Users', title: 'Users', collector: 'users', view: 'series', fields: nums('users', 'logged_in_30d') },
  {
    type: 'User',
    title: 'User quotas',
    collector: 'users',
    view: 'table',
    tags: ['username', 'user_type'],
    fields: nums('has_logged_in', 'last_login_age_seconds', ...quotas('movie', 'episode', 'music')),
    units: seconds('last_login_age_seconds'),
  },

  serverInfo('serverInfo', ['version', 'branch'], ['update_available']),
];

const OVERSEERR: PointSpec[] = [
  { type: 'Request_Counts', title: 'Requests by status', collector: 'requestCounts', view: 'series', fields: nums('pending', 'approved', 'processing', 'available', 'declined', 'completed') },
  { type: 'Request_Counts', title: 'Requests by type', collector: 'requestCounts', view: 'series', fields: nums('total', 'movies', 'tv') },
  { type: 'Issues_Counts', title: 'Issues', collector: 'requestCounts', view: 'series', fields: nums('open', 'closed', 'video', 'audio', 'subtitles', 'others') },
  { type: 'RequestTotals', title: 'Request problems', collector: 'totals', view: 'series', fields: nums('failed', 'unavailable', 'deleted') },
  {
    type: 'Requests',
    title: 'Latest requests',
    collector: 'latestRequests',
    view: 'table',
    tags: [...REQUEST_COLUMNS, 'is_4k'],
    fields: [HASH, num('seasons')],
    mappings: { status: { '1': 'pending', '2': 'approved', '3': 'declined', '4': 'failed', '5': 'completed' }, is_4k: { '0': 'no', '1': 'yes' } },
  },
  { type: 'MediaTotals', title: 'Media', collector: 'totals', view: 'series', fields: nums('total', 'available', 'partially_available', 'all_available', 'processing', 'pending') },
  { type: 'Cache', title: 'DNS cache', collector: 'status', view: 'series', fields: nums('dns_hits', 'dns_misses', 'dns_failures', 'dns_ipv4_fallbacks') },
  {
    type: 'Job',
    title: 'Jobs',
    collector: 'status',
    view: 'table',
    tags: ['job_id', 'job_type', 'interval'],
    fields: [str('name'), num('running'), num('next_run_seconds', 'next_run')],
    units: { next_run: 's' },
    size: [12, 8],
  },
  {
    type: 'ApiCache',
    title: 'API caches',
    collector: 'status',
    view: 'table',
    tags: ['cache_id'],
    fields: [str('name'), ...nums('hits', 'misses', 'keys', 'key_size', 'value_size')],
    units: { key_size: 'bytes', value_size: 'bytes' },
    size: [12, 8],
  },
  {
    type: 'Cache',
    title: 'Caches',
    collector: 'status',
    view: 'stats',
    fields: nums('tmdb_images', 'tmdb_image_size', 'avatar_images', 'avatar_image_size', 'dns_size', 'dns_max_size', 'dns_hit_rate'),
    units: { tmdb_image_size: 'bytes', avatar_image_size: 'bytes', dns_hit_rate: 'percentunit' },
  },
  { type: 'Status', title: 'Status', collector: 'status', view: 'stats', fields: nums('total_requests', 'total_media_items', 'appdata', 'appdata_permissions') },
  { type: 'Users', title: 'Users', collector: 'users', view: 'series', fields: nums('users') },





  serverInfo('serverInfo', ['version'], ['update_available', 'commits_behind', 'restart_pending']),
  {
    type: 'User',
    title: 'User quotas',
    collector: 'users',
    view: 'table',
    tags: ['display_name', 'user_type'],
    fields: nums('requests', ...['movie', 'tv'].flatMap((kind) => ['limit', 'days', 'used', 'remaining', 'restricted'].map((part) => `${kind}_quota_${part}`))),
  },];

const PLAYS = ['tv', 'movies', 'music', 'live_tv'];
const STREAM_TYPES = ['direct_play', 'direct_stream', 'transcode'];
const KBITS = (...names: string[]): Record<string, string> => Object.fromEntries(names.map((name) => [name, 'Kbits']));
const SESSION_TAGS = ['username', 'title', 'media_type', 'platform', 'product', 'quality'];
const STATS_THROTTLE = 300;

function streams(collector: string, extra: string[]): PointSpec[] {
  return [
    { type: 'current_stream_stats', title: 'Streams', collector, view: 'series', fields: nums('stream_count', 'transcode_streams', 'direct_play_streams', 'direct_streams', ...extra) },
    { type: 'current_stream_stats', title: 'Bandwidth', collector, view: 'series', fields: nums('total_bandwidth', 'lan_bandwidth', 'wan_bandwidth'), units: KBITS('total_bandwidth', 'lan_bandwidth', 'wan_bandwidth') },
  ];
}

const TAUTULLI: PointSpec[] = [
  ...streams('activity', []),
  {
    type: 'Session',
    title: 'Now playing',
    collector: 'activity',
    view: 'table',
    tags: [...SESSION_TAGS, 'transcode_decision', 'video_decision', 'full_location'],
    fields: [num('progress'), num('bandwidth')],
    units: { progress: 'percent', bandwidth: 'Kbits' },
  },
  {
    type: 'Play',
    title: 'Plays',
    collector: 'history',
    view: 'events',
    by: 'media_type',
    tags: ['username', 'media_type', 'platform', 'transcode_decision'],
    fields: [num('play_duration_seconds', 'played'), str('title'), num('paused_seconds', 'paused'), num('percent_complete', 'reached')],
    units: { played: 's', paused: 's', reached: 'percent' },
  },
  {
    type: 'RecentlyAdded',
    title: 'Recently added',
    collector: 'stats',
    throttleSeconds: STATS_THROTTLE,
    view: 'events',
    by: 'media_type',
    tags: ['library_name', 'media_type'],
    fields: [str('title'), num('year')],
  },
  { type: 'PlaysByDate', title: 'Plays per day (Tautulli graphs)', collector: 'stats', view: 'series', fields: nums(...PLAYS, 'total') },
  { type: 'PlaysByMonth', title: 'Plays per month', collector: 'stats', view: 'series', fields: nums(...PLAYS) },
  { type: 'PlaysByStreamType', title: 'Plays by stream type', collector: 'stats', view: 'series', fields: nums(...STREAM_TYPES) },
  { type: 'ConcurrentStreams', title: 'Concurrent streams', collector: 'stats', view: 'series', fields: nums(...STREAM_TYPES, 'max_concurrent_streams') },
  {
    type: 'PlaysByHourOfDay',
    title: 'Plays by hour of day (30 days)',
    collector: 'stats',
    throttleSeconds: STATS_THROTTLE,
    view: 'table',
    tags: ['hour'],
    fields: nums(...PLAYS),
    size: [12, 8],
    grafana: categoryBars('hour'),
  },
  { type: 'PlaysByDayOfWeek', title: 'Plays by weekday (30 days)', collector: 'stats', throttleSeconds: STATS_THROTTLE, view: 'table', tags: ['day'], fields: nums(...PLAYS), size: [12, 8] },
  { type: 'StreamTypeByPlatform', title: 'Stream types by platform (30 days)', collector: 'stats', throttleSeconds: STATS_THROTTLE, view: 'table', tags: ['platform'], fields: nums(...STREAM_TYPES), size: [12, 8] },
  { type: 'StreamTypeByUser', title: 'Stream types by user (30 days)', collector: 'stats', throttleSeconds: STATS_THROTTLE, view: 'table', tags: ['user'], fields: nums(...STREAM_TYPES), size: [12, 8] },
  {
    type: 'HomeStat',
    title: 'Home stats (30 days)',
    collector: 'stats',
    throttleSeconds: STATS_THROTTLE,
    view: 'table',
    tags: ['stat_id', 'rank'],
    fields: [str('title'), ...nums('plays', 'duration_seconds', 'users_watched', 'count', 'last_play_age_seconds')],
    units: seconds('duration_seconds', 'last_play_age_seconds'),
  },
  {
    type: 'library_stats',
    title: 'Libraries',
    collector: 'stats',
    view: 'table',
    tags: ['section_name', 'section_type'],
    fields: nums('total', 'seasons', 'episodes', 'artists', 'albums', 'tracks', 'is_active'),
    size: [12, 8],
  },
  {
    type: 'MediaInfo',
    title: 'Media info',
    collector: 'libraryMedia',
    view: 'table',
    tags: ['section_name', 'video_resolution', 'video_codec'],
    fields: nums('items', 'file_size'),
    units: { file_size: 'bytes' },
    size: [12, 8],
  },
  { type: 'Users', title: 'User counts', collector: 'users', view: 'stats', fields: nums('users', 'active', 'seen_24h', 'seen_30d') },
  {
    type: 'User',
    title: 'Users',
    collector: 'users',
    view: 'table',
    tags: ['username', 'friendly_name'],
    fields: nums('plays', 'duration_seconds', 'last_seen_age_seconds', 'plays_1d', 'plays_7d', 'plays_30d', 'watch_seconds_30d', 'is_active'),
    units: seconds('duration_seconds', 'last_seen_age_seconds', 'watch_seconds_30d'),
  },
  {
    type: 'Library',
    title: 'Library usage',
    collector: 'libraryMedia',
    view: 'table',
    tags: ['section_name', 'section_type'],
    fields: nums('plays', 'duration_seconds', 'last_accessed_age_seconds', 'plays_30d', 'watch_seconds_30d', 'media_items', 'file_size', 'media_info_age_seconds'),
    units: { ...seconds('duration_seconds', 'last_accessed_age_seconds', 'watch_seconds_30d', 'media_info_age_seconds'), file_size: 'bytes' },
  },
  serverInfo('serverInfo', ['version', 'branch', 'pms_version'], ['update_available', 'pms_update_available', 'pms_plexpass']),
];

const PLEX: PointSpec[] = [
  ...streams('sessions', ['lan_streams', 'wan_streams']),
  {
    type: 'Session',
    title: 'Now playing',
    collector: 'sessions',
    view: 'table',
    tags: [...SESSION_TAGS, 'video_decision', 'network'],
    fields: [num('progress_percent', 'progress'), num('bandwidth')],
    units: { progress: 'percent', bandwidth: 'Kbits' },
  },
  { type: 'Play', title: 'Plays', collector: 'history', view: 'events', by: 'media_type', tags: ['username', 'media_type', 'device_name', 'platform'], fields: [HASH, str('title')] },
  {
    type: 'Resources',
    title: 'CPU / RAM',
    collector: 'status',
    view: 'series',
    fields: nums('host_cpu_percent', 'host_memory_percent', 'process_cpu_percent', 'process_memory_percent'),
    units: { host_cpu_percent: 'percent', host_memory_percent: 'percent', process_cpu_percent: 'percent', process_memory_percent: 'percent' },
  },
  { type: 'Bandwidth', title: 'Bandwidth per network', collector: 'status', view: 'series', agg: 'sum', by: 'network', fields: nums('bytes'), units: { bytes: 'bytes' } },
  { type: 'TranscodeSessions', title: 'Transcoder', collector: 'status', view: 'series', fields: nums('count', 'video_transcodes', 'audio_transcodes', 'hw_decoding', 'hw_encoding', 'throttled') },
  { type: 'ButlerTask', title: 'Butler tasks', collector: 'status', view: 'table', tags: ['task'], fields: nums('enabled', 'randomized', 'interval_days'), size: [12, 8] },
  { type: 'Activities', title: 'Server activities', collector: 'status', view: 'series', fields: nums('count'), size: [12, 6] },
  { type: 'Activity', title: 'Running activities', collector: 'status', view: 'table', tags: ['activity_type'], fields: [num('present'), num('progress'), num('cancellable')], units: { progress: 'percent' }, size: [12, 6] },
  { type: 'BackgroundTranscodes', title: 'Background transcodes', collector: 'status', view: 'series', fields: nums('count'), size: [12, 6] },
  {
    type: 'BackgroundTranscode',
    title: 'Running background transcodes',
    collector: 'status',
    view: 'table',
    tags: ['rating_key'],
    fields: nums('present', 'progress', 'speed', 'remaining_seconds', 'size'),
    units: { progress: 'percent', remaining_seconds: 's', size: 'bytes' },
    size: [12, 6],
  },
  { type: 'Updater', title: 'Updates', collector: 'status', view: 'table', tags: ['state', 'version'], fields: nums('can_install', 'checked_age_seconds', 'releases'), units: seconds('checked_age_seconds'), size: [12, 8] },
  serverInfo('serverInfo', ['version', 'platform', 'remote_access'], ['update_available', 'active_transcodes']),
  {
    type: 'library_stats',
    title: 'Libraries',
    collector: 'libraries',
    view: 'table',
    tags: ['section_name', 'section_type'],
    fields: nums('total', 'seasons', 'episodes', 'albums', 'tracks', 'added_7d', 'locations', 'refreshing', 'scanned_age_seconds'),
    units: seconds('scanned_age_seconds'),
  },
  { type: 'LiveTv', title: 'Live TV', collector: 'liveTv', view: 'series', fields: nums('sessions', 'recordings_scheduled', 'recordings_in_progress', 'recordings_failed') },
  { type: 'Recording', title: 'Recordings', collector: 'liveTv', view: 'table', tags: ['grab_id', 'provider'], fields: [num('present'), num('percent')], units: { percent: 'percent' }, size: [12, 8] },
  { type: 'Inventory', title: 'Inventory', collector: 'inventory', view: 'stats', fields: nums('accounts', 'devices') },
  { type: 'Device', title: 'Devices', collector: 'inventory', view: 'table', tags: ['device_name', 'platform'], fields: nums('present', 'created_age_days') },
];

function mediaServerPoints(plugin: 'jellyfin' | 'emby'): PointSpec[] {
  const jellyfin = plugin === 'jellyfin';
  return [
    { type: 'current_stream_stats', title: 'Streams', collector: 'sessions', view: 'series', fields: nums('stream_count', 'transcode_streams', 'direct_play_streams', 'direct_streams', 'lan_streams', 'wan_streams') },
    { type: 'current_stream_stats', title: 'Clients', collector: 'sessions', view: 'series', fields: nums('connected_clients', 'connected_users', 'streaming_users') },
    {
      type: 'Session',
      title: 'Now playing',
      collector: 'sessions',
      view: 'table',
      tags: [...SESSION_TAGS, 'video_decision', 'play_method', 'network', ...(jellyfin ? ['hw_acceleration', 'transcode_reasons'] : [])],
      fields: [num('progress_percent', 'progress'), num('stream_bitrate'), ...(jellyfin ? [] : [num('transcode_cpu_percent', 'transcoder_cpu')])],
      units: { progress: 'percent', stream_bitrate: 'Kbits', transcoder_cpu: 'percent' },
    },
    { type: 'Activity', title: 'Activity', collector: 'history', view: 'events', by: 'activity_type', tags: ['activity_type', 'severity', 'user_id'], fields: [HASH, str('name')] },
    { type: 'Tasks', title: 'Tasks', collector: 'status', view: 'series', fields: nums('running', 'failed') },
    { type: 'Plugins', title: 'Plugins', collector: 'status', view: 'series', fields: nums('plugins', ...(jellyfin ? ['plugins_active', 'plugins_failing'] : [])) },
    {
      type: 'Task',
      title: 'Scheduled tasks',
      collector: 'status',
      view: 'table',
      tags: ['name', 'category', 'state', 'last_status'],
      fields: nums('progress', 'last_execution_age_seconds', 'last_duration_seconds'),
      units: { progress: 'percent', ...seconds('last_execution_age_seconds', 'last_duration_seconds') },
    },
    { type: 'Plugin', title: 'Installed plugins', collector: 'status', view: 'table', tags: ['plugin', 'version', ...(jellyfin ? ['status'] : [])], fields: nums('installed'), size: [12, 8] },
    ...(jellyfin
      ? [
          {
            type: 'Storage',
            title: 'Storage',
            collector: 'status',
            view: 'table',
            tags: ['folder', 'library', 'path', 'storage_type'],
            fields: nums('free_bytes', 'used_bytes', 'used_percent'),
            units: { free_bytes: 'bytes', used_bytes: 'bytes', used_percent: 'percent' },
            size: [12, 8],
          } satisfies PointSpec,
        ]
      : []),
    {
      type: 'library_stats',
      title: 'Libraries',
      collector: 'libraries',
      view: 'table',
      tags: ['section_name', 'section_type', 'refresh_status'],
      fields: nums('locations', 'refresh_progress'),
      units: { refresh_progress: 'percent' },
      size: [12, 8],
    },
    {
      type: 'LiveTv',
      title: 'Live TV',
      collector: 'liveTv',
      view: 'series',
      fields: nums('recordings', 'recordings_in_progress', 'timers', 'recordings_scheduled', 'recordings_failed', 'next_recording_in_seconds'),
      units: { next_recording_in_seconds: 's' },
    },
    serverInfo('serverInfo', ['version'], [...(jellyfin ? [] : ['update_available']), 'restart_pending', 'shutting_down', ...(jellyfin ? [] : ['maintenance_mode'])]),
    { type: 'item_counts', title: 'Items', collector: 'libraries', view: 'stats', fields: nums('movies', 'series', 'episodes', 'artists', 'albums', 'songs', 'books', 'box_sets', 'total') },
    { type: 'Users', title: 'User counts', collector: 'inventory', view: 'stats', fields: nums('users', 'admins', 'disabled', 'active_24h', 'active_30d') },
    { type: 'Devices', title: 'Device counts', collector: 'inventory', view: 'stats', fields: nums('devices', 'active_24h') },
    {
      type: 'User',
      title: 'Users',
      collector: 'inventory',
      view: 'table',
      tags: ['username'],
      fields: nums('present', 'is_admin', 'is_disabled', 'is_hidden', 'has_password', 'last_activity_age_seconds', 'last_login_age_seconds'),
      units: seconds('last_activity_age_seconds', 'last_login_age_seconds'),
      size: [12, 8],
    },
    {
      type: 'Device',
      title: 'Devices',
      collector: 'inventory',
      view: 'table',
      tags: ['device_name', 'app_name', 'app_version', 'last_user'],
      fields: nums('present', 'last_activity_age_seconds'),
      units: seconds('last_activity_age_seconds'),
      size: [12, 8],
    },
  ];
}

const COLLECTOR_TAGS = ['plugin', 'server', 'collector'];

const VARKEN: PointSpec[] = [
  { type: 'Status', title: 'Varken', view: 'stats', fields: nums('uptime_seconds', 'collectors', 'collectors_open', 'outputs'), units: seconds('uptime_seconds') },
  {
    type: 'Collector',
    title: 'Collectors',
    view: 'table',
    tags: COLLECTOR_TAGS,
    fields: nums('runs', 'errors', 'points', 'duration_seconds', 'circuit_state', 'consecutive_errors', 'interval_seconds', 'last_success_age_seconds'),
    units: seconds('duration_seconds', 'interval_seconds', 'last_success_age_seconds'),
    mappings: { circuit_state: { '0': 'closed', '1': 'half-open', '2': 'open' } },
  },
  { type: 'Collector', title: 'Collector runs and errors', view: 'series', agg: 'sum', by: 'plugin', fields: nums('runs', 'errors') },
  {
    type: 'Collector',
    title: 'Collection duration',
    view: 'series',
    tags: COLLECTOR_TAGS,
    legend: '{tag:plugin} {tag:server} · {tag:collector}',
    fields: nums('duration_seconds'),
    units: seconds('duration_seconds'),
  },
  { type: 'Output', title: 'Output writes', view: 'series', agg: 'sum', by: 'output', fields: nums('writes', 'write_errors', 'points') },
];

export const CATALOG: Record<Plugin, PointSpec[]> = {
  sonarr: servarrPoints('sonarr'),
  radarr: servarrPoints('radarr'),
  readarr: servarrPoints('readarr'),
  lidarr: servarrPoints('lidarr'),
  prowlarr: PROWLARR,
  bazarr: BAZARR,
  tautulli: TAUTULLI,
  plex: PLEX,
  jellyfin: mediaServerPoints('jellyfin'),
  emby: mediaServerPoints('emby'),
  ombi: OMBI,
  overseerr: OVERSEERR,
  varken: VARKEN,
};
