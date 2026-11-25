# Data reference

Every input plugin writes DataPoints whose measurement is the service name (`Sonarr`, `Tautulli`, ...). Every point carries a `server` tag (the instance `id` from the config) and a `type` tag that distinguishes the kinds of points a plugin writes; both are omitted from the tables below.
Numbers meant for graphing are fields; tags hold labels and identifiers. The `hash` field is a deduplication key (MD5) and is not meant to be graphed.
Decimal fields (`score_percent`, `lat`, `lon`, and the Servarr `progress`, `used_percent`, `last_duration_seconds`, `percent_of_*`) are always written as floats, even for whole values, so their column type stays stable.
Points are timestamped with the collection time (`createDataPoint` default) unless stated otherwise in a section.
Event points (`type = History`) are timestamped with the event time, plus the record id's last three digits as milliseconds: the APIs report whole seconds, and this keeps same-second events with identical tags as separate points. Each event collector keeps a high-water mark in `DATA_FOLDER/event-state/` and only writes events newer than it, so an event is written once even across restarts. Without a mark (first run, deleted or unreadable file) it starts from the plugin start time: earlier events are not backfilled.

## Sonarr, Radarr, Lidarr, Readarr: shared points

These four services write the same points for the collectors below; only the API prefix (`/api/v3` for Sonarr and Radarr, `/api/v1` for Lidarr and Readarr) and the history id tags differ. Booleans are `0`/`1` fields, omitted when the service does not report them. A time the service reports as `0001-01-01T00:00:00Z` (never happened) is treated as absent.

### Queue: download state

Added to every `type = Queue` point (see each service below).

| Key | Kind | Type | Meaning |
|-----|------|------|---------|
| `status` | tag | string | Queue item status (`downloading`, `paused`, `completed`, ...) |
| `tracked_download_state` | tag | string | `downloading`, `importPending`, `importing`, `imported`, `failed`, ... |
| `tracked_download_status` | tag | string | `ok`, `warning`, `error` |
| `download_client` | tag | string | Download client name |
| `indexer` | tag | string | Indexer the release came from |
| `size` | field | number | Release size in bytes |
| `sizeleft` | field | number | Bytes left to download |
| `progress` | field | float | Downloaded percentage; omitted when `size` is `0` or `sizeleft` is outside `0..size` |
| `eta_seconds` | field | number | Seconds until the estimated completion (`0` when past); omitted when unknown |

All tags are `unknown` when absent.

### type = Health / HealthIssue

Config: `inputs.<service>[].status` (`enabled`, `intervalSeconds`, default disabled, 300) · Source: `<prefix>/health`. The `status` collector also writes `DiskSpace`, `RootFolder`, `QueueStatus` and `Task`; any of its endpoints failing fails the whole collection.

`Health` (one point): fields `errors`, `warnings`, `notices` (count of health checks by level).

`HealthIssue` (one point per check that is not `ok`):

| Key | Kind | Type | Meaning |
|-----|------|------|---------|
| `source` | tag | string | Health check name (`IndexerStatusCheck`, ...) |
| `level` | tag | string | `notice`, `warning` or `error` |
| `message` | field | string | Check message |
| `hash` | field | string | MD5 of source + message |

### type = DiskSpace

Config: `status` · Source: `<prefix>/diskspace`. One point per disk.

| Key | Kind | Type | Meaning |
|-----|------|------|---------|
| `path` | tag | string | Mount path |
| `label` | tag | string | Disk label (`unknown` when empty) |
| `free_bytes` | field | number | Free space |
| `total_bytes` | field | number | Total space |
| `used_percent` | field | float | Used percentage; omitted when the total is `0` |

### type = RootFolder

Config: `status` · Source: `<prefix>/rootfolder`. One point per root folder. Readarr's Calibre connection settings (host, port, credentials) are never written.

| Key | Kind | Type | Meaning |
|-----|------|------|---------|
| `path` | tag | string | Root folder path |
| `name` | tag | string | Root folder name (Lidarr, Readarr) |
| `accessible` | field | number | `1` when the service can reach the folder |
| `free_bytes` | field | number | Free space; omitted when unknown (inaccessible folder) |
| `total_bytes` | field | number | Total space (Lidarr, Readarr); omitted when unknown |
| `unmapped_folders` | field | number | Folders on disk not matched to a library item (Sonarr, Radarr) |

### type = QueueStatus

Config: `status` · Source: `<prefix>/queue/status`.

| Key | Kind | Type | Meaning |
|-----|------|------|---------|
| `total_count` | field | number | Queue items, including unknown ones |
| `count` | field | number | Queue items matched to a library item |
| `unknown_count` | field | number | Queue items not matched |
| `has_errors`, `has_warnings` | field | number | `1` when a matched item is in error / warning |
| `has_unknown_errors`, `has_unknown_warnings` | field | number | Same for unmatched items |

### type = Task

Config: `status` · Source: `<prefix>/system/task`. One point per scheduled task.

| Key | Kind | Type | Meaning |
|-----|------|------|---------|
| `task` | tag | string | Task id (`RssSync`, `Backup`, ...) |
| `name` | tag | string | Task display name |
| `interval_minutes` | field | number | Task interval |
| `last_execution_age_seconds` | field | number | Seconds since the last run; omitted when it never ran |
| `last_duration_seconds` | field | float | Duration of the last run |
| `next_execution_in_seconds` | field | number | Seconds until the next run (negative when overdue); omitted when unknown |

### type = Totals

Config: `inputs.<service>[].totals` (`enabled`, `intervalSeconds`, default disabled, 900) · Source: `<prefix>/wanted/missing`, `<prefix>/wanted/cutoff` (monitored only), `<prefix>/blocklist`, each asked for a single record.

| Key | Kind | Type | Meaning |
|-----|------|------|---------|
| `missing` | field | number | Wanted items without a file |
| `cutoff_unmet` | field | number | Items below their quality cutoff |
| `blocklist` | field | number | Blocklisted releases |

A total is omitted when the response does not carry `totalRecords`.

### type = History

Config: `inputs.<service>[].history` (`enabled`, `intervalSeconds`, default disabled, 300) · Source: `<prefix>/history/since?date=<mark>`. One point per event (grab, import, failure, deletion, rename, ...), timestamped with the event time.

| Key | Kind | Type | Meaning |
|-----|------|------|---------|
| `event_type` | tag | string | `grabbed`, `downloadFolderImported`, `downloadFailed`, ... (service-specific values) |
| `quality` | tag | string | Release quality |
| `download_client` | tag | string | Download client (`unknown` for events without one) |
| `indexer` | tag | string | Indexer (`unknown` for events without one) |
| id tags | tag | number | Sonarr `seriesId`, `episodeId` · Radarr `movieId` · Lidarr `artistId`, `albumId` · Readarr `authorId`, `bookId` |
| `hash` | field | string | MD5 of server id + history record id |
| `size` | field | number | Release size in bytes, when the event carries it |

## Sonarr

### type = Queue

Config: `inputs.sonarr[].queue` (`enabled`, `intervalSeconds`) · Source: `/api/v3/queue` (paginated). Items without series or episode data are skipped.

| Key | Kind | Type | Meaning |
|-----|------|------|---------|
| `sonarrId` | tag | number | Series id (`0` when absent) |
| `name` | tag | string | Series title (`unknown` when absent) |
| `epname` | tag | string | Episode title (`unknown` when absent) |
| `sxe` | tag | string | Season/episode as `SxxExx` |
| `protocol` | tag | string | Download protocol, upper-cased (`TORRENT`, `USENET`, `UNKNOWN` when absent) |
| `protocol_id` | tag | number | `0` torrent, `1` usenet (anything other than `USENET` maps to `0`) |
| `quality` | tag | string | Quality name (`Unknown` when absent) |
| `hash` | field | string | MD5 of server id + series title + `sxe` |

Download-state tags and fields: see [Queue: download state](#queue-download-state).

### type = Missing

Config: `inputs.sonarr[].calendar` (`enabled`, `missingDays`, `intervalSeconds`) · Source: `/api/v3/calendar` (window: now minus `missingDays` to now). Only monitored episodes without a file that have finished airing (air date + runtime in the past) are written.

| Key | Kind | Type | Meaning |
|-----|------|------|---------|
| `sonarrId` | tag | number | Series id (`0` when absent) |
| `name` | tag | string | Series title (`unknown` when absent) |
| `epname` | tag | string | Episode title (`unknown` when absent) |
| `sxe` | tag | string | Season/episode as `SxxExx` |
| `airsUTC` | tag | string | Air date (UTC), empty string when absent |
| `downloaded` | tag | number | Always `0` for this type (episode has no file) |
| `hash` | field | string | MD5 of server id + series title + `sxe` |

### type = Future

Config: `inputs.sonarr[].calendar` (`enabled`, `futureDays`, `intervalSeconds`) · Source: `/api/v3/calendar` (window: now to now plus `futureDays`). All episodes of the window are written.

| Key | Kind | Type | Meaning |
|-----|------|------|---------|
| `sonarrId` | tag | number | Series id (`0` when absent) |
| `name` | tag | string | Series title (`unknown` when absent) |
| `epname` | tag | string | Episode title (`unknown` when absent) |
| `sxe` | tag | string | Season/episode as `SxxExx` |
| `airsUTC` | tag | string | Air date (UTC), empty string when absent |
| `downloaded` | tag | number | `1` if the episode already has a file, else `0` |
| `hash` | field | string | MD5 of server id + series title + `sxe` |

### type = Library / Series

Config: `inputs.sonarr[].library` (`enabled`, `intervalDays`, default disabled, 1) · Source: `/api/v3/series`.

`Library` (one point): fields `series`, `series_monitored`, `series_ended`, `episodes`, `episode_files`, `total_episodes`, `size_on_disk`.

`Series` (one point per series):

| Key | Kind | Type | Meaning |
|-----|------|------|---------|
| `seriesId` | tag | number | Series id |
| `name` | tag | string | Series title |
| `status` | tag | string | `continuing`, `ended`, `upcoming`, `deleted` |
| `ended` | tag | number | `1` when the series has ended |
| `network` | tag | string | Network (`unknown` when absent) |
| `series_type` | tag | string | `standard`, `daily`, `anime` |
| `monitored` | field | number | `1` when monitored |
| `season_count` | field | number | Seasons |
| `episode_count` | field | number | Monitored aired episodes |
| `episode_file_count` | field | number | Episodes with a file |
| `total_episode_count` | field | number | All episodes |
| `size_on_disk` | field | number | Bytes on disk |
| `percent_of_episodes` | field | float | Downloaded share of `episode_count` |

### type = ServerInfo

Config: `inputs.sonarr[].serverInfo` (`enabled`, `intervalSeconds`, default disabled, 300) · Source: `/api/v3/system/status`, `/api/v3/update`, `/api/v3/health`

| Key | Kind | Type | Meaning |
|-----|------|------|---------|
| `reachable` | field | number | Always `1`: keeps the point when the service reports nothing else |
| `version` | tag | string | Service version (`unknown` when absent) |
| `branch` | tag | string | Update branch (`unknown` when absent) |
| `update_available` | field | number | `1` when a release is installable and not installed, else `0` |
| `health_errors` | field | number | Health checks of type `error` |
| `health_warnings` | field | number | Health checks of type `warning` |
| `health_notices` | field | number | Health checks of type `notice` |
| `uptime_seconds` | field | number | Seconds since `startTime`; omitted when unknown |

## Radarr

### type = Queue

Config: `inputs.radarr[].queue` (`enabled`, `intervalSeconds`) · Source: `/api/v3/queue` (paginated). Items without movie data are skipped.

| Key | Kind | Type | Meaning |
|-----|------|------|---------|
| `tmdbId` | tag | number | TMDB id (`0` when absent) |
| `name` | tag | string | `Title (year)` |
| `quality` | tag | string | Quality name (`Unknown` when absent) |
| `protocol` | tag | string | Download protocol, upper-cased (`UNKNOWN` when absent) |
| `protocol_id` | tag | number | `0` torrent, `1` usenet |
| `titleSlug` | tag | string | Movie slug (`unknown` when absent) |
| `hash` | field | string | MD5 of server id + `name` + `quality` |

Download-state tags and fields: see [Queue: download state](#queue-download-state).

### type = Missing

Config: `inputs.radarr[].missing` (`enabled`, `intervalSeconds`) · Source: `/api/v3/movie`. Only monitored movies without a file are written.

| Key | Kind | Type | Meaning |
|-----|------|------|---------|
| `Missing_Available` | tag | number | `0` if the movie is available (`isAvailable`), `1` if not released/available yet |
| `tmdbId` | tag | number | TMDB id (`0` when absent) |
| `name` | tag | string | `Title (year)` |
| `titleSlug` | tag | string | Movie slug (`unknown` when absent) |
| `hash` | field | string | MD5 of server id + `name` + TMDB id |

### type = Library / Collection

Config: `inputs.radarr[].library` (`enabled`, `intervalDays`, default disabled, 1) · Source: `/api/v3/movie`, `/api/v3/collection`.

`Library` (one point): fields `movies`, `movies_monitored`, `movies_with_file`, `size_on_disk`, `collections`.

`Collection` (one point per collection):

| Key | Kind | Type | Meaning |
|-----|------|------|---------|
| `collectionId` | tag | number | Collection TMDb id |
| `name` | tag | string | Collection title |
| `monitored` | field | number | `1` when monitored |
| `movies` | field | number | Movies in the collection (with `movies_in_library`, omitted when the response has no movie list) |
| `movies_in_library` | field | number | Of which already in Radarr |
| `missing` | field | number | Radarr's missing-movie count for the collection |

### type = ServerInfo

Config: `inputs.radarr[].serverInfo` (`enabled`, `intervalSeconds`, default disabled, 300) · Source: `/api/v3/system/status`, `/api/v3/update`, `/api/v3/health`

| Key | Kind | Type | Meaning |
|-----|------|------|---------|
| `reachable` | field | number | Always `1`: keeps the point when the service reports nothing else |
| `version` | tag | string | Service version (`unknown` when absent) |
| `branch` | tag | string | Update branch (`unknown` when absent) |
| `update_available` | field | number | `1` when a release is installable and not installed, else `0` |
| `health_errors` | field | number | Health checks of type `error` |
| `health_warnings` | field | number | Health checks of type `warning` |
| `health_notices` | field | number | Health checks of type `notice` |
| `uptime_seconds` | field | number | Seconds since `startTime`; omitted when unknown |

## Readarr

### type = Queue

Config: `inputs.readarr[].queue` (`enabled`, `intervalSeconds`) · Source: `/api/v1/queue` (paginated). Items without book data are skipped.

| Key | Kind | Type | Meaning |
|-----|------|------|---------|
| `bookId` | tag | number | Book id (`0` when absent) |
| `name` | tag | string | `Book title - Author` (`Unknown Author` when absent) |
| `quality` | tag | string | Quality name (`Unknown` when absent) |
| `protocol` | tag | string | Download protocol, upper-cased (`UNKNOWN` when absent) |
| `protocol_id` | tag | number | `0` torrent, `1` usenet |
| `titleSlug` | tag | string | Book slug (`unknown` when absent) |
| `hash` | field | string | MD5 of server id + `name` + `quality` |

Download-state tags and fields: see [Queue: download state](#queue-download-state).

### type = Missing

Config: `inputs.readarr[].missing` (`enabled`, `intervalSeconds`) · Source: `/api/v1/wanted/missing` (paginated, monitored only).

| Key | Kind | Type | Meaning |
|-----|------|------|---------|
| `bookId` | tag | number | Book id (`0` when absent) |
| `foreignBookId` | tag | string | Metadata-provider book id (`unknown` when absent) |
| `name` | tag | string | `Book title - Author` (`unknown` title, `Unknown Author` when absent) |
| `titleSlug` | tag | string | Book slug (`unknown` when absent) |
| `hash` | field | string | MD5 of server id + `name` + `foreignBookId` |
| `release_age_days` | field | number | Whole days since the release date; omitted when undated or in the future |
| `book_file_count`, `book_count`, `total_book_count`, `size_on_disk` | field | number | Book statistics, when the service returns them |
| `percent_of_books` | field | float | Downloaded share of the book's editions |

### type = Library / Author

Config: `inputs.readarr[].library` (`enabled`, `intervalDays`, default disabled, 1) · Source: `/api/v1/author`.

`Library` (one point): fields `authors`, `authors_monitored`, `books`, `book_files`, `total_books`, `size_on_disk`.

`Author` (one point per author): tags `authorId`, `name`, `status`, `ended` (`0`/`1`); fields `monitored`, `book_file_count`, `book_count`, `available_book_count`, `total_book_count`, `size_on_disk`, `percent_of_books` (float).

### type = ServerInfo

Config: `inputs.readarr[].serverInfo` (`enabled`, `intervalSeconds`, default disabled, 300) · Source: `/api/v1/system/status`, `/api/v1/update`, `/api/v1/health`

| Key | Kind | Type | Meaning |
|-----|------|------|---------|
| `reachable` | field | number | Always `1`: keeps the point when the service reports nothing else |
| `version` | tag | string | Service version (`unknown` when absent) |
| `branch` | tag | string | Update branch (`unknown` when absent) |
| `update_available` | field | number | `1` when a release is installable and not installed, else `0` |
| `health_errors` | field | number | Health checks of type `error` |
| `health_warnings` | field | number | Health checks of type `warning` |
| `health_notices` | field | number | Health checks of type `notice` |
| `uptime_seconds` | field | number | Seconds since `startTime`; omitted when unknown |

## Lidarr

### type = Queue

Config: `inputs.lidarr[].queue` (`enabled`, `intervalSeconds`) · Source: `/api/v1/queue` (paginated). Items without album data are skipped.

| Key | Kind | Type | Meaning |
|-----|------|------|---------|
| `albumId` | tag | number | Album id (`0` when absent) |
| `name` | tag | string | `Album title - Artist` (`Unknown Artist` when absent) |
| `quality` | tag | string | Quality name (`Unknown` when absent) |
| `protocol` | tag | string | Download protocol, upper-cased (`UNKNOWN` when absent) |
| `protocol_id` | tag | number | `0` torrent, `1` usenet |
| `hash` | field | string | MD5 of server id + `name` + `quality` |

Download-state tags and fields: see [Queue: download state](#queue-download-state).

### type = Missing

Config: `inputs.lidarr[].missing` (`enabled`, `intervalSeconds`) · Source: `/api/v1/wanted/missing` (paginated, monitored only).

| Key | Kind | Type | Meaning |
|-----|------|------|---------|
| `albumId` | tag | number | Album id (`0` when absent) |
| `foreignAlbumId` | tag | string | Metadata-provider album id (`unknown` when absent) |
| `name` | tag | string | `Album title - Artist` (`unknown` title, `Unknown Artist` when absent) |
| `hash` | field | string | MD5 of server id + `name` + `foreignAlbumId` |
| `album_type` | tag | string | `Album`, `EP`, `Single`, ... (`unknown` when absent) |
| `release_age_days` | field | number | Whole days since the release date; omitted when undated or in the future |
| `track_file_count`, `track_count`, `total_track_count`, `size_on_disk` | field | number | Album statistics, when the service returns them |
| `percent_of_tracks` | field | float | Downloaded share of the tracks |

### type = Library / Artist

Config: `inputs.lidarr[].library` (`enabled`, `intervalDays`, default disabled, 1) · Source: `/api/v1/artist`.

`Library` (one point): fields `artists`, `artists_monitored`, `albums`, `tracks`, `track_files`, `total_tracks`, `size_on_disk`.

`Artist` (one point per artist): tags `artistId`, `name`, `status`, `ended` (`0`/`1`); fields `monitored`, `album_count`, `track_file_count`, `track_count`, `total_track_count`, `size_on_disk`, `percent_of_tracks` (float).

### type = ServerInfo

Config: `inputs.lidarr[].serverInfo` (`enabled`, `intervalSeconds`, default disabled, 300) · Source: `/api/v1/system/status`, `/api/v1/update`, `/api/v1/health`

| Key | Kind | Type | Meaning |
|-----|------|------|---------|
| `reachable` | field | number | Always `1`: keeps the point when the service reports nothing else |
| `version` | tag | string | Service version (`unknown` when absent) |
| `branch` | tag | string | Update branch (`unknown` when absent) |
| `update_available` | field | number | `1` when a release is installable and not installed, else `0` |
| `health_errors` | field | number | Health checks of type `error` |
| `health_warnings` | field | number | Health checks of type `warning` |
| `health_notices` | field | number | Health checks of type `notice` |
| `uptime_seconds` | field | number | Seconds since `startTime`; omitted when unknown |

## Prowlarr

### type = IndexerStats

Config: `inputs.prowlarr[].indexerStats` (`enabled`, `intervalSeconds`) · Source: `/api/v1/indexerstats`. One point per indexer.

| Key | Kind | Type | Meaning |
|-----|------|------|---------|
| `indexerId` | tag | number | Indexer id (`0` when absent) |
| `indexerName` | tag | string | Indexer name (`unknown` when absent) |
| `protocol` | tag | string | `usenet` or `torrent`, from `/api/v1/indexer` (`unknown` when the indexer is not listed) |
| `privacy` | tag | string | `public`, `semiPrivate`, `private` (same source) |
| `enabled` | tag | number | `1` when the indexer is enabled (same source) |
| `priority` | tag | number | Indexer priority (same source) |
| `hash` | field | string | MD5 of server id + indexer id + indexer name |
| `averageResponseTime` | field | number | Average response time (`0` when absent) |
| `averageGrabResponseTime` | field | number | Average grab response time; omitted when absent |
| `numberOfQueries` | field | number | Total queries |
| `numberOfGrabs` | field | number | Total grabs |
| `numberOfRssQueries` | field | number | RSS queries |
| `numberOfAuthQueries` | field | number | Auth queries |
| `numberOfFailedQueries` | field | number | Failed queries |
| `numberOfFailedGrabs` | field | number | Failed grabs |
| `numberOfFailedRssQueries` | field | number | Failed RSS queries |
| `numberOfFailedAuthQueries` | field | number | Failed auth queries |

All other numeric fields default to `0` when absent. The protocol/privacy/enabled/priority tags are `unknown` when `/api/v1/indexer` fails, and `IndexerStatsWindow` is skipped when the windowed call fails: neither costs the cumulative stats. The same collector also writes:

- `IndexerStatsWindow`: the same tags and fields over the last 24 hours (`/api/v1/indexerstats?startDate=&endDate=`), plus tag `window` = `24h`.
- `UserAgentStats` (tag `user_agent`) and `HostStats` (tag `host`): fields `numberOfQueries`, `numberOfGrabs` per calling application and per host.

### type = Health / HealthIssue / Task / IndexerStatus

Config: `inputs.prowlarr[].status` (`enabled`, `intervalSeconds`, default disabled, 300) · Source: `/api/v1/health`, `/api/v1/system/task`, `/api/v1/indexerstatus`. `Health`, `HealthIssue` and `Task` are the same as the [shared Servarr points](#type--health--healthissue).

`IndexerStatus` (one point per indexer with recorded failures): tag `indexerId`; fields `disabled` (`1` while disabled), `disabled_for_seconds` (only while disabled), `most_recent_failure_age_seconds`, `initial_failure_age_seconds`. `IndexerStatusSummary` (one point): field `disabled_indexers`.

### type = History

Config: `inputs.prowlarr[].history` (`enabled`, `intervalSeconds`, default disabled, 300) · Source: `/api/v1/history/since?eventType=releaseGrabbed`. One point per release grab, timestamped with the grab time (queries and RSS syncs are already counted by `IndexerStats`).

| Key | Kind | Type | Meaning |
|-----|------|------|---------|
| `indexerId` | tag | number | Indexer id |
| `event_type` | tag | string | `releaseGrabbed` |
| `successful` | tag | number | `1` when the grab succeeded |
| `source` | tag | string | Application that asked for the grab (`Sonarr`, ...) |
| `grab_method` | tag | string | `Proxy` or `Redirect` |
| `hash` | field | string | MD5 of server id + history record id |
| `elapsed_ms` | field | number | Grab duration, when reported |

### type = Inventory / Application

Config: `inputs.prowlarr[].inventory` (`enabled`, `intervalSeconds`, default disabled, 3600) · Source: `/api/v1/indexer`, `/api/v1/applications`. Indexer and application settings (URLs, API keys) are never written.

`Inventory` (one point): fields `indexers`, `indexers_enabled`, `applications`, `applications_syncing` (sync level other than `disabled`).

`Application` (one point per application): tags `application` (name), `implementation`, `sync_level`; field `hash`.

### type = ServerInfo

Config: `inputs.prowlarr[].serverInfo` (`enabled`, `intervalSeconds`, default disabled, 300) · Source: `/api/v1/system/status`, `/api/v1/update`, `/api/v1/health`

| Key | Kind | Type | Meaning |
|-----|------|------|---------|
| `reachable` | field | number | Always `1`: keeps the point when the service reports nothing else |
| `version` | tag | string | Service version (`unknown` when absent) |
| `branch` | tag | string | Update branch (`unknown` when absent) |
| `update_available` | field | number | `1` when a release is installable and not installed, else `0` |
| `health_errors` | field | number | Health checks of type `error` |
| `health_warnings` | field | number | Health checks of type `warning` |
| `health_notices` | field | number | Health checks of type `notice` |
| `uptime_seconds` | field | number | Seconds since `startTime`; omitted when unknown |

## Tautulli

### type = Session

Config: `inputs.tautulli[].activity` (`enabled`, `intervalSeconds`), `inputs.tautulli[].geoip` (`enabled`, `localCoordinates`) · Source: `/api/v2?cmd=get_activity` (plus `/api/v2?cmd=get_geoip_lookup` for remote streams when GeoIP is enabled). One point per active session.

| Key | Kind | Type | Meaning |
|-----|------|------|---------|
| `session_id` | tag | string | Tautulli session id (`unknown` when absent) |
| `ip_address` | tag | string | Client IP (`unknown` when absent) |
| `friendly_name` | tag | string | User friendly name (`unknown` when absent) |
| `username` | tag | string | Username (`unknown` when absent) |
| `title` | tag | string | Full title (`unknown` when absent) |
| `product` | tag | string | Player product (`unknown` when absent) |
| `platform` | tag | string | Platform; `osx` becomes `macOS`, `windows` becomes `Windows` (`unknown` when absent) |
| `product_version` | tag | string | Player version; build suffix after `-` stripped for Roku/osx/windows (`unknown` when absent) |
| `quality` | tag | string | Resolution: `SD`/`4K` upper-cased, full resolution when provided, else `<res>p`; falls back to upper-cased container (`unknown` when empty) |
| `video_decision` | tag | string | Title-cased; `copy` becomes `Direct stream`, empty becomes `Music` |
| `transcode_decision` | tag | string | Title-cased; defaults to `Direct play`, `copy` becomes `Direct stream` |
| `transcode_hw_decoding` | tag | number | Hardware decoding flag (`0` when absent) |
| `transcode_hw_encoding` | tag | number | Hardware encoding flag (`0` when absent) |
| `media_type` | tag | string | Title-cased media type (`unknown` when absent) |
| `audio_codec` | tag | string | Source audio codec, upper-cased (`unknown` when absent) |
| `stream_audio_codec` | tag | string | Streamed audio codec, upper-cased (`unknown` when absent) |
| `quality_profile` | tag | string | Quality profile (`unknown` when absent) |
| `region_code` | tag | string | `LAN` for local streams, GeoIP region, `unknown` otherwise |
| `location` | tag | string | `Local` for local streams, GeoIP city, `unknown` otherwise |
| `full_location` | tag | string | `Local Network`, or `region - city` from GeoIP (either part alone if the other is missing), `unknown` otherwise |
| `player_state` | tag | number | `0` playing, `1` paused, `3` buffering (unknown states map to `0`) |
| `device_type` | tag | string | Same value as `platform` (`unknown` when absent) |
| `relay` | tag | number | Relayed flag (`0` when absent) |
| `secure` | tag | string or number | Secure connection flag as returned by Tautulli, `'0'` when absent |
| `hash` | field | string | MD5 of session id + session key + username + full title |
| `progress` | field | number | Progress percent (`0` when not numeric) |
| `lat` | field | number | Latitude; only written for local streams with `geoip.localCoordinates`, or remote streams whose GeoIP result has both coordinates |
| `lon` | field | number | Longitude; same condition as `lat` |

A stream is local when Tautulli reports `local = 1` or the IP is private/loopback/link-local.

### type = current_stream_stats

Config: `inputs.tautulli[].activity` · Source: `/api/v2?cmd=get_activity`. One summary point per collection.

| Key | Kind | Type | Meaning |
|-----|------|------|---------|
| `stream_count` | field | number | Total streams |
| `total_bandwidth` | field | number | Total bandwidth |
| `wan_bandwidth` | field | number | WAN bandwidth |
| `lan_bandwidth` | field | number | LAN bandwidth |
| `transcode_streams` | field | number | Transcoding streams |
| `direct_play_streams` | field | number | Direct play streams |
| `direct_streams` | field | number | Direct stream streams |

All fields default to `0` when absent.

### type = library_stats

Config: `inputs.tautulli[].stats` (`enabled`, `intervalSeconds`) and `inputs.tautulli[].libraries` (`enabled`, `intervalDays`); both run the same collector · Source: `/api/v2?cmd=get_libraries`. One point per library.

| Key | Kind | Type | Meaning |
|-----|------|------|---------|
| `section_name` | tag | string | Library name (`unknown` when absent) |
| `section_type` | tag | string | Library type, e.g. `movie`, `show`, `artist` (`unknown` when absent) |
| `name` | tag | string | Duplicate of `section_name` (legacy) |
| `total` | field | number | Item count of the library |
| `seasons` | field | number | Seasons; `show` libraries only |
| `episodes` | field | number | Episodes; `show` libraries only |
| `artists` | field | number | Artists (same as `total`); `artist` libraries only |
| `albums` | field | number | Albums; `artist` libraries only |
| `tracks` | field | number | Tracks; `artist` libraries only |
| `libraries` | field | string | Library name (legacy); only written when `libraries.enabled` is true |

### type = ServerInfo

Config: `inputs.tautulli[].serverInfo` (`enabled`, `intervalSeconds`, default disabled, 300) · Source: `get_tautulli_info`, `get_server_info`, `get_pms_update`, `update_check` (`update_check` makes Tautulli query GitHub, so it runs at most every 6 hours and its last answer is reused in between; a failing `update_check`, e.g. HTTP 400 for an unknown version, only omits `update_available`)

| Key | Kind | Type | Meaning |
|-----|------|------|---------|
| `reachable` | field | number | Always `1`: keeps the point when the service reports nothing else |
| `version` | tag | string | Tautulli version (`unknown` when absent) |
| `branch` | tag | string | Tautulli branch (`unknown` when absent) |
| `pms_version` | tag | string | Plex Media Server version (`unknown` when absent) |
| `update_available` | field | number | Tautulli update available: `1` yes, `0` no; omitted when the service does not report it |
| `pms_update_available` | field | number | Plex Media Server update available: `1` yes, `0` no; omitted when the service does not report it |
| `pms_plexpass` | field | number | `1` when the server has Plex Pass |

## Plex

### type = Session

Config: `inputs.plex[].sessions` (`enabled`, `intervalSeconds`) · Source: `/status/sessions`. One point per active session.

| Key | Kind | Type | Meaning |
|-----|------|------|---------|
| `session_id` | tag | string or number | Plex session key (`unknown` when absent) |
| `ip_address` | tag | string | Player address (`unknown` when absent) |
| `username` | tag | string | Plex user title (`unknown` when absent) |
| `title` | tag | string | `Show - Episode` when a grandparent title exists, else the item title |
| `product` | tag | string | Player product (`unknown` when absent) |
| `platform` | tag | string | Player platform (`unknown` when absent) |
| `product_version` | tag | string | Player version (`unknown` when absent) |
| `quality` | tag | string | Upper-cased video resolution, else container (`unknown` when empty) |
| `video_decision` | tag | string | Transcode video decision; `transcode` if a transcode session has no decision, `direct play` without transcode session |
| `media_type` | tag | string | Plex item type (`unknown` when absent) |
| `audio_codec` | tag | string | Upper-cased audio codec of the first media (`unknown` when absent) |
| `player_state` | tag | number | `0` playing, `1` paused, `3` buffering (unknown states map to `0`) |
| `device_type` | tag | string | Same value as `platform` (`unknown` when absent) |
| `secure` | tag | string | `1` if the player connection is secure, else `0` |
| `hash` | field | string | MD5 of session key + rating key + user + full title |
| `progress_percent` | field | number | Rounded `viewOffset / duration` in percent (`0` without duration) |

### type = current_stream_stats

Config: `inputs.plex[].sessions` · Source: `/status/sessions`.

| Key | Kind | Type | Meaning |
|-----|------|------|---------|
| `stream_count` | field | number | Number of sessions |
| `transcode_streams` | field | number | Sessions whose video or audio decision is `transcode` |

### type = library_stats

Config: `inputs.plex[].libraries` (`enabled`, `intervalSeconds`) · Source: `/library/sections/all`, then `/library/sections/{sectionId}/all` (size-0 request) for the item count. One point per library.

| Key | Kind | Type | Meaning |
|-----|------|------|---------|
| `section_name` | tag | string | Library title (`unknown` when absent) |
| `section_type` | tag | string | Library type (`unknown` when absent) |
| `name` | tag | string | Duplicate of `section_name` (legacy) |
| `total` | field | number | Item count (`0` if the count request fails) |
| `libraries` | field | string | Library title (legacy) |

### type = ServerInfo

Config: `inputs.plex[].serverInfo` (`enabled`, `intervalSeconds`, default disabled, 300) · Source: `/`, `/updater/status`

| Key | Kind | Type | Meaning |
|-----|------|------|---------|
| `reachable` | field | number | Always `1`: keeps the point when the service reports nothing else |
| `version` | tag | string | Server version (`unknown` when absent) |
| `platform` | tag | string | Host platform (`unknown` when absent) |
| `remote_access` | tag | string | `myPlexMappingState` (e.g. `mapped`; `unknown` when absent) |
| `update_available` | field | number | `1` when the updater lists a release, else `0` |
| `active_transcodes` | field | number | `transcoderActiveVideoSessions`; omitted when Plex does not report it |

## Jellyfin

### type = Session

Config: `inputs.jellyfin[].sessions` (`enabled`, `intervalSeconds`) · Source: `/Sessions` (only sessions with a now-playing item).

| Key | Kind | Type | Meaning |
|-----|------|------|---------|
| `session_id` | tag | string | Session id (`unknown` when absent) |
| `ip_address` | tag | string | Remote endpoint (`unknown` when absent) |
| `username` | tag | string | User name (`unknown` when absent) |
| `title` | tag | string | `Series - Name` for episodes, else item name (`unknown` when absent) |
| `product` | tag | string | Client name (`unknown` when absent) |
| `platform` | tag | string | Device type (`unknown` when absent) |
| `product_version` | tag | string | Application version (`unknown` when absent) |
| `quality` | tag | string | `<height>p`, else upper-cased container (`unknown` when empty) |
| `video_decision` | tag | string | `direct play` without transcoding info, `direct stream` if the video is copied, else `transcode` |
| `media_type` | tag | string | Media type, else item type (`unknown` when absent) |
| `audio_codec` | tag | string | Upper-cased codec of the played audio stream, else first audio stream, else transcoder audio codec (`unknown` when none) |
| `player_state` | tag | number | `1` paused, `0` otherwise (buffering is never produced) |
| `device_type` | tag | string | Device type (`unknown` when absent) |
| `play_method` | tag | string | Play method (`unknown` when absent) |
| `hash` | field | string | MD5 of session id + user name + title |
| `progress_percent` | field | number | Rounded position / runtime in percent (`0` without runtime) |

### type = current_stream_stats

Config: `inputs.jellyfin[].sessions` · Source: `/Sessions`.

| Key | Kind | Type | Meaning |
|-----|------|------|---------|
| `stream_count` | field | number | Sessions with a now-playing item |
| `transcode_streams` | field | number | Sessions transcoding, i.e. not both video and audio copied (remux does not count) |

### type = library_stats

Config: `inputs.jellyfin[].libraries` (`enabled`, `intervalSeconds`) · Source: `/Library/VirtualFolders`. One point per library.

| Key | Kind | Type | Meaning |
|-----|------|------|---------|
| `section_name` | tag | string | Library name (`unknown` when absent) |
| `section_type` | tag | string | Collection type (`unknown` when absent) |
| `name` | tag | string | Duplicate of `section_name` (legacy) |
| `locations` | field | number | Number of library folders |
| `libraries` | field | string | Library name (legacy) |

### type = item_counts

Config: `inputs.jellyfin[].libraries` · Source: `/Items/Counts`. Not written if the request fails.

| Key | Kind | Type | Meaning |
|-----|------|------|---------|
| `movies` | field | number | Movie count |
| `series` | field | number | Series count |
| `episodes` | field | number | Episode count |
| `artists` | field | number | Artist count |
| `albums` | field | number | Album count |
| `songs` | field | number | Song count |
| `books` | field | number | Book count |
| `box_sets` | field | number | Box set count |
| `total` | field | number | Total item count |

All fields default to `0` when absent.

### type = ServerInfo

Config: `inputs.jellyfin[].serverInfo` (`enabled`, `intervalSeconds`, default disabled, 300) · Source: `/System/Info` (its deprecated `HasUpdateAvailable` is always `false`, so no `update_available` is written)

| Key | Kind | Type | Meaning |
|-----|------|------|---------|
| `reachable` | field | number | Always `1`: keeps the point when the service reports nothing else |
| `version` | tag | string | Server version (`unknown` when absent) |
| `restart_pending` | field | number | Restart pending: `1` yes, `0` no; omitted when the service does not report it |
| `shutting_down` | field | number | Server shutting down: `1` yes, `0` no; omitted when the service does not report it |

## Emby

Same shape as Jellyfin; the API is called under the `/emby` prefix.

### type = Session

Config: `inputs.emby[].sessions` (`enabled`, `intervalSeconds`) · Source: `/emby/Sessions` (only sessions with a now-playing item).

| Key | Kind | Type | Meaning |
|-----|------|------|---------|
| `session_id` | tag | string | Session id (`unknown` when absent) |
| `ip_address` | tag | string | Remote endpoint (`unknown` when absent) |
| `username` | tag | string | User name (`unknown` when absent) |
| `title` | tag | string | `Series - Name` for episodes, else item name (`unknown` when absent) |
| `product` | tag | string | Client name (`unknown` when absent) |
| `platform` | tag | string | Device type (`unknown` when absent) |
| `product_version` | tag | string | Application version (`unknown` when absent) |
| `quality` | tag | string | `<height>p`, else upper-cased container (`unknown` when empty) |
| `video_decision` | tag | string | `direct play` without transcoding info, `direct stream` if the video is copied, else `transcode` |
| `media_type` | tag | string | Media type, else item type (`unknown` when absent) |
| `audio_codec` | tag | string | Upper-cased codec of the played audio stream, else first audio stream, else transcoder audio codec (`unknown` when none) |
| `player_state` | tag | number | `1` paused, `0` otherwise (buffering is never produced) |
| `device_type` | tag | string | Device type (`unknown` when absent) |
| `play_method` | tag | string | Play method (`unknown` when absent) |
| `hash` | field | string | MD5 of session id + user name + title |
| `progress_percent` | field | number | Rounded position / runtime in percent (`0` without runtime) |

### type = current_stream_stats

Config: `inputs.emby[].sessions` · Source: `/emby/Sessions`.

| Key | Kind | Type | Meaning |
|-----|------|------|---------|
| `stream_count` | field | number | Sessions with a now-playing item |
| `transcode_streams` | field | number | Sessions transcoding, i.e. not both video and audio copied (remux does not count) |

### type = library_stats

Config: `inputs.emby[].libraries` (`enabled`, `intervalSeconds`) · Source: `/emby/Library/VirtualFolders`. One point per library.

| Key | Kind | Type | Meaning |
|-----|------|------|---------|
| `section_name` | tag | string | Library name (`unknown` when absent) |
| `section_type` | tag | string | Collection type (`unknown` when absent) |
| `name` | tag | string | Duplicate of `section_name` (legacy) |
| `locations` | field | number | Number of library folders |
| `libraries` | field | string | Library name (legacy) |

### type = item_counts

Config: `inputs.emby[].libraries` · Source: `/emby/Items/Counts`. Not written if the request fails.

| Key | Kind | Type | Meaning |
|-----|------|------|---------|
| `movies` | field | number | Movie count |
| `series` | field | number | Series count |
| `episodes` | field | number | Episode count |
| `artists` | field | number | Artist count |
| `albums` | field | number | Album count |
| `songs` | field | number | Song count |
| `books` | field | number | Book count |
| `box_sets` | field | number | Box set count |
| `total` | field | number | Total item count |

All fields default to `0` when absent.

### type = ServerInfo

Config: `inputs.emby[].serverInfo` (`enabled`, `intervalSeconds`, default disabled, 300) · Source: `/emby/System/Info`

| Key | Kind | Type | Meaning |
|-----|------|------|---------|
| `reachable` | field | number | Always `1`: keeps the point when the service reports nothing else |
| `version` | tag | string | Server version (`unknown` when absent) |
| `update_available` | field | number | Update available: `1` yes, `0` no; omitted when the service does not report it |
| `restart_pending` | field | number | Restart pending: `1` yes, `0` no; omitted when the service does not report it |
| `shutting_down` | field | number | Server shutting down: `1` yes, `0` no; omitted when the service does not report it |
| `maintenance_mode` | field | number | Maintenance mode: `1` yes, `0` no; omitted when the service does not report it |

## Ombi

### type = Request_Counts

Config: `inputs.ombi[].requestCounts` (`enabled`, `intervalSeconds`) · Source: `/api/v1/Request/count`.

| Key | Kind | Type | Meaning |
|-----|------|------|---------|
| `pending` | field | number | Pending requests |
| `approved` | field | number | Approved requests |
| `available` | field | number | Available requests |

All fields default to `0` when absent.

### type = Requests

Config: `inputs.ombi[].requestCounts` (collected on the same schedule as `Request_Counts`) · Source: `/api/v1/Request/tv`, `/api/v1/Request/movie`, `/api/v1/Identity/Users` (user names). One point per request; TV requests use their first child request and are skipped if they have none.

| Key | Kind | Type | Meaning |
|-----|------|------|---------|
| `request_type` | tag | number | `0` TV, `1` movie |
| `status` | tag | number | `0` denied, `1` approved, `2` completed (approved and available), `3` pending |
| `title` | tag | string | Request title (`unknown` when absent) |
| `requested_user` | tag | string | Alias/user name resolved from the Ombi user list, then the request alias, then `Unknown` |
| `requested_date` | tag | string | Request date, empty string when absent |
| `hash` | field | string | MD5 of request id + TVDB/TMDB id + title |

### type = Request_Total

Config: `inputs.ombi[].requestCounts` · Source: `/api/v1/Request/tv`, `/api/v1/Request/movie`.

| Key | Kind | Type | Meaning |
|-----|------|------|---------|
| `total` | field | number | TV plus movie requests |
| `movies` | field | number | Movie requests |
| `tv_shows` | field | number | TV requests |

### type = Issues_Counts

Config: `inputs.ombi[].issueCounts` (`enabled`, `intervalSeconds`) · Source: `/api/v1/Issues/count`.

| Key | Kind | Type | Meaning |
|-----|------|------|---------|
| `pending` | field | number | Pending issues |
| `in_progress` | field | number | In-progress issues |
| `resolved` | field | number | Resolved issues |

All fields default to `0` when absent.

### type = ServerInfo

Config: `inputs.ombi[].serverInfo` (`enabled`, `intervalSeconds`, default disabled, 300) · Source: `/api/v1/Settings/about`, `/api/v1/Update`

| Key | Kind | Type | Meaning |
|-----|------|------|---------|
| `reachable` | field | number | Always `1`: keeps the point when the service reports nothing else |
| `version` | tag | string | Ombi version (`unknown` when absent) |
| `branch` | tag | string | Ombi branch (`unknown` when absent) |
| `update_available` | field | number | Update available: `1` yes, `0` no; omitted when the service does not report it |

## Overseerr

### type = Request_Counts

Config: `inputs.overseerr[].requestCounts` (`enabled`, `intervalSeconds`) · Source: `/api/v1/request/count`.

| Key | Kind | Type | Meaning |
|-----|------|------|---------|
| `pending` | field | number | Pending requests |
| `approved` | field | number | Approved requests |
| `processing` | field | number | Processing requests |
| `available` | field | number | Available requests |
| `total` | field | number | All requests |
| `movies` | field | number | Movie requests |
| `tv` | field | number | TV requests |
| `declined` | field | number | Declined requests |

All fields default to `0` when absent.

### type = Issues_Counts

Config: `inputs.overseerr[].requestCounts` (collected on the same schedule as `Request_Counts`) · Source: `/api/v1/issue/count`.

| Key | Kind | Type | Meaning |
|-----|------|------|---------|
| `total` | field | number | All issues |
| `video` | field | number | Video issues |
| `audio` | field | number | Audio issues |
| `subtitles` | field | number | Subtitle issues |
| `others` | field | number | Other issues |
| `open` | field | number | Open issues |
| `closed` | field | number | Closed issues |

All fields default to `0` when absent.

### type = Requests

Config: `inputs.overseerr[].latestRequests` (`enabled`, `count`, `intervalSeconds`) · Source: `/api/v1/request` (`take=count`, `sort=added`), then `/api/v1/tv/{tvId}` or `/api/v1/movie/{movieId}` for the title. Requests without a TMDB id or whose title cannot be fetched are skipped.

| Key | Kind | Type | Meaning |
|-----|------|------|---------|
| `request_type` | tag | number | `0` TV, `1` movie |
| `status` | tag | number | Request status: `1` pending approval, `2` approved, `3` declined (pinned spec); Seerr also uses `4` failed, `5` completed |
| `media_status` | tag | number | Media availability: `1` unknown, `2` pending, `3` processing, `4` partially available, `5` available, `6` deleted (`0` when absent) |
| `title` | tag | string | Media title from TV/movie details |
| `requested_user` | tag | string | Requester display name (`Unknown` when absent) |
| `requested_date` | tag | string | Request creation date, empty string when absent |
| `hash` | field | string | MD5 of media details id + title |

### type = ServerInfo

Config: `inputs.overseerr[].serverInfo` (`enabled`, `intervalSeconds`, default disabled, 300) · Source: `/api/v1/status?checkUpdateAvailable=true`

| Key | Kind | Type | Meaning |
|-----|------|------|---------|
| `reachable` | field | number | Always `1`: keeps the point when the service reports nothing else |
| `version` | tag | string | Seerr version (`unknown` when absent) |
| `update_available` | field | number | Update available: `1` yes, `0` no; omitted when the service does not report it |
| `commits_behind` | field | number | Commits behind the latest version; omitted when Seerr skips the version check |
| `restart_pending` | field | number | Restart required: `1` yes, `0` no; omitted when the service does not report it |

## Bazarr

### type = Wanted

Config: `inputs.bazarr[].wanted` (`enabled`, `intervalSeconds`) · Source: `/api/movies/wanted`, `/api/episodes/wanted` (`length=1000`). One point per missing subtitle language of each item; the tag set depends on `mediaType`.

| Key | Kind | Type | Meaning |
|-----|------|------|---------|
| `mediaType` | tag | string | `movie` or `episode` |
| `radarrId` | tag | number | Radarr movie id; `movie` only |
| `sonarrSeriesId` | tag | number | Sonarr series id; `episode` only |
| `sonarrEpisodeId` | tag | number | Sonarr episode id; `episode` only |
| `name` | tag | string | `Title - Language` for movies, `Series - Episode - Language` for episodes |
| `title` | tag | string | Movie title; `movie` only |
| `seriesTitle` | tag | string | Series title; `episode` only |
| `episodeNumber` | tag | string | Episode number as sent by Bazarr; `episode` only |
| `language` | tag | string | Language name (`unknown` when absent) |
| `languageCode` | tag | string | 3-letter language code (`unknown` when absent) |
| `forced` | tag | number | `1` if the missing subtitle is forced, else `0` |
| `hi` | tag | number | `1` if the missing subtitle is hearing-impaired, else `0` |
| `hash` | field | string | MD5 of server id + movie/episode id + language code |

### type = History

Config: `inputs.bazarr[].history` (`enabled`, `intervalSeconds`) · Source: `/api/movies/history`, `/api/episodes/history` (`length=100`). Timestamp: `parsed_timestamp` of the history item (Bazarr local time, `MM/DD/YY HH:MM:SS` or 4-digit year); collection time if it cannot be parsed. The tag set depends on `mediaType`.

| Key | Kind | Type | Meaning |
|-----|------|------|---------|
| `mediaType` | tag | string | `movie` or `series` |
| `radarrId` | tag | number | Radarr movie id; `movie` only |
| `sonarrSeriesId` | tag | number | Sonarr series id; `series` only |
| `sonarrEpisodeId` | tag | number | Sonarr episode id; `series` only |
| `name` | tag | string | `Title - Language` for movies, `Series - Episode - Language` for series |
| `title` | tag | string | Movie title; `movie` only |
| `seriesTitle` | tag | string | Series title; `series` only |
| `episodeNumber` | tag | string | Episode number as sent by Bazarr; `series` only |
| `language` | tag | string | Language name (`unknown` when absent) |
| `languageCode` | tag | string | 3-letter language code (`unknown` when absent) |
| `provider` | tag | string | Subtitle provider (`unknown` when absent) |
| `action` | tag | number | Bazarr history action code, as sent |
| `hash` | field | string | MD5 of server id + movie/episode id + language code + action + `parsed_timestamp` |
| `score_percent` | field | number | Match score parsed from `"92.5%"`; omitted when missing or unparsable |

### type = ServerInfo

Config: `inputs.bazarr[].serverInfo` (`enabled`, `intervalSeconds`, default disabled, 300) · Source: `/api/system/status`, `/api/system/health`

| Key | Kind | Type | Meaning |
|-----|------|------|---------|
| `reachable` | field | number | Always `1`: keeps the point when the service reports nothing else |
| `version` | tag | string | Bazarr version (`unknown` when absent) |
| `sonarr_version` | tag | string | Version of the connected Sonarr (`unknown` when absent) |
| `radarr_version` | tag | string | Version of the connected Radarr (`unknown` when absent) |
| `uptime_seconds` | field | number | Seconds since `start_time`; omitted when unknown |
| `health_issues` | field | number | Number of health issues |
