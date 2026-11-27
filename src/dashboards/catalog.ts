import { type Agg, type FieldRef, type Filter, type InputKey, num, type PanelTemplate, str } from './model';

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

export const CATALOG: Record<Plugin, PointSpec[]> = {
  sonarr: servarrPoints('sonarr'),
  radarr: servarrPoints('radarr'),
  readarr: servarrPoints('readarr'),
  lidarr: servarrPoints('lidarr'),
  prowlarr: PROWLARR,
  bazarr: BAZARR,
  tautulli: [],
  plex: [],
  jellyfin: [],
  emby: [],
  ombi: OMBI,
  overseerr: OVERSEERR,
  varken: [],
};
