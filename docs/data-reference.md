# Data reference

Every input plugin writes DataPoints whose measurement is the service name (`Sonarr`, `Tautulli`, ...). Every point carries a `server` tag (the instance `id` from the config) and a `type` tag that distinguishes the kinds of points a plugin writes; both are omitted from the tables below.
Numbers meant for graphing are fields; tags hold labels and identifiers. The `hash` field is a deduplication key (MD5) and is not meant to be graphed.
Media types are written as a `media_type` tag with one shared vocabulary across plugins: `movie`, `show`, `season`, `episode`, `artist`, `album`, `track`, `clip`, `photo`, `live`, else the source's own type lowercased (`unknown` when absent). `live` marks live TV: Tautulli sessions and plays with `live` = 1, Jellyfin/Emby channels, programs and recordings; Plex sessions and plays read directly do not flag live TV, so they keep the item type.
Decimal fields (`score_percent`, `lat`, `lon`, the Servarr `progress`, `used_percent`, `last_duration_seconds`, `percent_of_*`, and the session `transcode_speed`, `transcode_progress`, `stream_framerate`, `community_rating`, `transcode_cpu_percent`, `refresh_progress`, the Plex `progress`, `speed`, `percent` and `*_cpu_percent` / `*_memory_percent`, the Jellyfin/Emby task `progress`, the Tautulli `watched_status`) are always written as floats, even for whole values, so their column type stays stable.
Points are timestamped with the collection time (`createDataPoint` default) unless stated otherwise in a section.
Event points (`type = History`, Plex and Tautulli `Play`, Plex `Bandwidth`, Jellyfin/Emby `Activity`, Tautulli `RecentlyAdded` and its day/month graph buckets) are timestamped with the event time, plus the record id's last three digits as milliseconds: the APIs report whole seconds, and this keeps same-second events with identical tags as separate points. Each event collector keeps a high-water mark in `DATA_FOLDER/event-state/` and only writes events newer than it, so an event is written once even across restarts. Without a mark (first run, deleted or unreadable file) it starts from the plugin start time: earlier events are not backfilled.

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
| `media_type` | tag | string | Media type, shared vocabulary (see top of page) |
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
| `network` | tag | string | `lan` / `wan` as Tautulli reports it, else `unknown` (`location` stays the GeoIP city) |
| `live` | tag | number | `1` for Live TV |
| `audio_decision`, `subtitle_decision`, `container_decision` | tag | string | Stream decisions (`copy` → `Direct stream`, `unknown` when empty) |
| `video_codec` / `stream_video_codec` | tag | string | Source / streamed video codec, upper-cased |
| `video_resolution` / `stream_video_resolution` | tag | string | Source / streamed resolution (`1080p`, `4K`, ...) |
| `video_dynamic_range` / `stream_video_dynamic_range` | tag | string | `SDR`, `HDR`, `Dolby Vision`, ... |
| `year`, `genre`, `library_name`, `section_id`, `user_id`, `device` | tag | mixed | Item and user details |
| `country`, `country_code` | tag | string | GeoIP country (`unknown` for local streams or without GeoIP) |
| `bandwidth`, `stream_bitrate`, `source_bitrate` | field | number | Bandwidth and bitrates (kbps); omitted when Tautulli sends an empty value |
| `duration_seconds`, `view_offset_seconds` | field | number | Item duration and playback position |
| `transcode_speed`, `transcode_progress` | field | float | Transcoder speed and progress (transcode / copy only) |
| `transcode_throttled`, `transcode_hw_full_pipeline` | field | number | Transcoder flags, `0`/`1` |

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

Config: `inputs.tautulli[].stats` (`enabled`, `intervalSeconds`) and `inputs.tautulli[].libraries` (`enabled`, `intervalDays`); both write these points (`stats` also writes the home stats, graphs and recently added items below) · Source: `/api/v2?cmd=get_libraries`. One point per library.

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
| `is_active` | field | number | `1` when the library is active in Tautulli |

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

### type = HomeStat

Config: `inputs.tautulli[].stats` · Source: `get_home_stats` (`time_range=30`, `stats_count=5`). Like every point below written by `stats` (graphs, recently added), it is collected at most every 5 minutes, whatever the `stats` interval; `library_stats` follows the interval. One point per row of each home stats card Tautulli is configured to show, over the last 30 days.

| Key | Kind | Type | Meaning |
|-----|------|------|---------|
| `stat_id` | tag | string | Card: `top_movies`, `popular_movies`, `top_tv`, `popular_tv`, `top_music`, `popular_music`, `top_libraries`, `top_users`, `top_platforms`, `last_watched`, `most_concurrent` |
| `rank` | tag | number | Row position in the card, from `1` |
| `title` | field | string | Item title; user friendly name (`top_users`), platform name (`top_platforms`), library name (`top_libraries`), or `Concurrent Streams` / `Concurrent Transcodes` / ... (`most_concurrent`) |
| `plays` | field | number | Plays |
| `duration_seconds` | field | number | Watch time |
| `users_watched` | field | number | Distinct users (`popular_*` cards) |
| `count` | field | number | Concurrent streams (`most_concurrent`) |
| `last_play_age_seconds` | field | number | Seconds since the last play |

Fields the card does not report are omitted.

### type = PlaysByDayOfWeek / PlaysByHourOfDay / StreamTypeByPlatform / StreamTypeByUser

Config: `inputs.tautulli[].stats` · Source: `get_plays_by_dayofweek`, `get_plays_by_hourofday`, `get_stream_type_by_top_10_platforms`, `get_stream_type_by_top_10_users` (`time_range=30`). A snapshot of the last 30 days: one point per category at each collection.

| Key | Kind | Type | Meaning |
|-----|------|------|---------|
| `day` / `hour` / `platform` / `user` | tag | string | Category: day name (`Monday`, ... in the order Tautulli is set to start the week), hour (`00`-`23`), platform, user friendly name (top 10) |
| `rank` | tag | number | Position of the category in Tautulli's list, from `1`: weekday order, hour, or top-10 rank |
| `tv`, `movies`, `music`, `live_tv` | field | number | Plays per media type (`PlaysByDayOfWeek`, `PlaysByHourOfDay`) |
| `direct_play`, `direct_stream`, `transcode` | field | number | Plays per stream type (`StreamTypeBy*`) |

Tautulli only lists the series of the library types the server has: a server without music or Live TV libraries has no `music` / `live_tv` field.

### type = PlaysByDate / PlaysByStreamType / ConcurrentStreams / PlaysByMonth

Config: `inputs.tautulli[].stats` · Source: `get_plays_by_date`, `get_plays_by_stream_type`, `get_concurrent_streams_by_stream_type` (`time_range=7`), `get_plays_per_month` (`time_range=3`). One point per **completed** day (month), timestamped `00:00 UTC` of Tautulli's local date (the 1st of the month), written once.

| Key | Kind | Type | Meaning |
|-----|------|------|---------|
| `tv`, `movies`, `music`, `live_tv`, `total` | field | number | Plays per media type (`PlaysByDate`, `PlaysByMonth`; `total` on `PlaysByDate` only) |
| `direct_play`, `direct_stream`, `transcode` | field | number | Plays (`PlaysByStreamType`) or maximum concurrent streams (`ConcurrentStreams`) per stream type |
| `max_concurrent_streams` | field | number | Maximum concurrent streams of all types (`ConcurrentStreams`) |

A bucket is written one day after it ends (a day appears the day after next): Tautulli counts a play on the day it starts but records it when it stops, so a play still running at midnight is in its day only once it ends, and Tautulli's days are local (UTC-12 to UTC+14) while bucket bounds are UTC. The high-water mark compares buckets by that same settling time, so the day Varken starts on is always written; a day that ended shortly before startup may be written too. Month names are parsed in English (`Nov 2026`); a category that does not parse is skipped and logged at debug level.

### type = RecentlyAdded

Config: `inputs.tautulli[].stats` · Source: `get_recently_added` (`count=50`). One event point per item added to Plex, timestamped with its `added_at`.

| Key | Kind | Type | Meaning |
|-----|------|------|---------|
| `media_type` | tag | string | Media type, shared vocabulary (see top of page) |
| `section_id` | tag | string | Library section id |
| `library_name` | tag | string | Library name |
| `rating_key` | tag | string | Plex item id |
| `hash` | field | string | MD5 of server id + rating key + added time |
| `title` | field | string | Full title |
| `year` | field | number | Release year; omitted when unknown |

### type = Play

Config: `inputs.tautulli[].history` (`enabled`, `intervalSeconds`, default disabled, 300) · Source: `get_history` (`grouping=0`, `order_column=stopped`, `length=500`). One event point per play, timestamped with the time it stopped: Tautulli records a play when it ends.

| Key | Kind | Type | Meaning |
|-----|------|------|---------|
| `media_type` | tag | string | Media type, shared vocabulary (see top of page) |
| `rating_key` | tag | number | Plex item id |
| `user_id`, `username` | tag | mixed | Plex user |
| `platform`, `player`, `product` | tag | string | Client |
| `transcode_decision` | tag | string | `Direct play`, `Direct stream` (`copy`), `Transcode`, as on `Session` |
| `network` | tag | string | `lan` / `wan`, else `unknown` |
| `live` | tag | number | `1` for Live TV |
| `hash` | field | string | MD5 of server id + history row id |
| `title` | field | string | Full title |
| `play_duration_seconds` | field | number | Time played, pauses excluded |
| `paused_seconds` | field | number | Time paused |
| `percent_complete` | field | number | Position reached, in percent |
| `watched_status` | field | float | `0`, `0.25`, `0.5`, `0.75` or `1` (watched), from Tautulli's watched thresholds |

The client IP address is never written. Tags are `unknown` when absent.

### type = User / Users

Config: `inputs.tautulli[].users` (`enabled`, `intervalSeconds`, default disabled, 3600) · Source: `get_users_table`, `get_user_watch_time_stats` (one call per user, `query_days=1,7,30,0`). One point per user and one summary point.

| Key | Kind | Type | Meaning |
|-----|------|------|---------|
| `user_id`, `username`, `friendly_name` | tag | mixed | User (`User`) |
| `plays`, `duration_seconds` | field | number | All-time plays and watch time (`User`) |
| `last_seen_age_seconds` | field | number | Seconds since the last play; omitted for a user who never played (`User`) |
| `is_active`, `allow_guest`, `keep_history` | field | number | `0`/`1` (`User`) |
| `plays_1d`, `plays_7d`, `plays_30d`, `plays_all` | field | number | Plays over the last 1, 7, 30 days and all time (`User`) |
| `watch_seconds_1d`, `watch_seconds_7d`, `watch_seconds_30d`, `watch_seconds_all` | field | number | Watch time over the same windows (`User`) |
| `users` | field | number | Users (`Users`) |
| `active` | field | number | Users active in Tautulli (`Users`) |
| `seen_24h`, `seen_30d` | field | number | Users who played within 24 hours / 30 days (`Users`) |

Email and IP addresses are never written.

### type = Library / MediaInfo

Config: `inputs.tautulli[].libraryMedia` (`enabled`, `intervalDays`, default disabled, 1 day) · Source: `get_libraries_table`, then per library `get_library_watch_time_stats` (`query_days=1,7,30,0`) and, for `movie`, `show`, `artist` and `photo` libraries, `get_library_media_info` (all rows). Per-user and per-library calls run 4 at a time. One `Library` point per library, one `MediaInfo` point per library, resolution and codec.

| Key | Kind | Type | Meaning |
|-----|------|------|---------|
| `section_id`, `section_name`, `section_type` | tag | mixed | Library (both types) |
| `plays`, `duration_seconds` | field | number | All-time plays and watch time (`Library`) |
| `last_accessed_age_seconds` | field | number | Seconds since the last play; omitted for a library never played (`Library`) |
| `is_active`, `keep_history` | field | number | `0`/`1` (`Library`) |
| `plays_1d` ... `plays_all`, `watch_seconds_1d` ... `watch_seconds_all` | field | number | As on `User` (`Library`) |
| `media_items` | field | number | Items in the media info table: movies, shows, artists or photo albums (`Library`) |
| `file_size` | field | number | Total size in bytes of the items whose size Tautulli knows (`Library`, `MediaInfo`); omitted when it knows none, e.g. show and artist libraries until their sizes are computed in Tautulli's Media Info tab |
| `media_info_age_seconds` | field | number | Age of Tautulli's media info cache (`Library`) |
| `video_resolution`, `video_codec` | tag | string | Group (`MediaInfo`); `unknown` when empty, e.g. for show and artist rows |
| `items` | field | number | Items in the group (`MediaInfo`) |

Tautulli serves media info from a cache: the first call builds it from Plex (on a large library it can outlast `httpTimeoutMs`, Tautulli then finishes it and the next collection reads it), and only Tautulli's UI refreshes it. Varken refreshes the cache of `movie` libraries when it is older than `intervalDays`, and keeps the cached answer if the refresh fails; it never refreshes show and artist libraries, since a refresh drops the sizes Tautulli's UI computed for them, so their media info is as recent as their last refresh in Tautulli (`media_info_age_seconds`). Media fields and `MediaInfo` points are omitted when the library has no item or Tautulli cannot read it (`last_refreshed` null).

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
| `media_type` | tag | string | Media type, shared vocabulary (see top of page) |
| `audio_codec` | tag | string | Upper-cased audio codec of the first media (`unknown` when absent) |
| `player_state` | tag | number | `0` playing, `1` paused, `3` buffering (unknown states map to `0`) |
| `device_type` | tag | string | Same value as `platform` (`unknown` when absent) |
| `secure` | tag | string | `1` if the player connection is secure, else `0` |
| `hash` | field | string | MD5 of session key + rating key + user + full title |
| `progress_percent` | field | number | Rounded `viewOffset / duration` in percent (`0` without duration) |
| `network` | tag | string | `lan` / `wan` (`Session.location`, else `Player.local`; `unknown` otherwise) |
| `relayed` | tag | number | `1` when relayed through Plex (`unknown` when not reported) |
| `audio_decision` | tag | string | Audio decision of the transcoder (`direct play` without a transcode session) |
| `subtitle_decision` | tag | string | Subtitle decision (`unknown` without a transcode session) |
| `video_codec` / `stream_video_codec` | tag | string | Source / streamed video codec, upper-cased (stream = source when not transcoding) |
| `stream_audio_codec` | tag | string | Streamed audio codec (`audio_codec` is the source) |
| `video_resolution` / `stream_video_resolution` | tag | string | Source / streamed resolution (`1080p`, `4K`, ...); the stream one differs only when the video is transcoded, bucketed by its dimensions (`4K`, `1080p`, `720p`, `480p`, `SD`) |
| `device_name`, `device_model`, `platform_version` | tag | string | Player name, model and OS version |
| `user_id` | tag | string | Plex user id |
| `year`, `genre` | tag | number / string | Release year and first genre |
| `bandwidth` | field | number | Session bandwidth (kbps) |
| `source_bitrate` | field | number | Source bitrate (kbps) |
| `duration_seconds`, `view_offset_seconds` | field | number | Item duration and playback position |
| `transcode_speed`, `transcode_progress` | field | float | Transcoder speed and progress (transcoding only) |
| `transcode_throttled`, `transcode_hw_requested`, `transcode_hw_full_pipeline`, `transcode_hw_decoding`, `transcode_hw_encoding` | field | number | Transcoder flags, `0`/`1` (transcoding only) |

### type = current_stream_stats

Config: `inputs.plex[].sessions` · Source: `/status/sessions`.

| Key | Kind | Type | Meaning |
|-----|------|------|---------|
| `stream_count` | field | number | Number of sessions |
| `transcode_streams` | field | number | Sessions whose video or audio decision is `transcode` |
| `direct_play_streams`, `direct_streams` | field | number | Sessions without a transcode session / with one that only copies |
| `lan_streams`, `wan_streams` | field | number | Sessions by `network` |
| `total_bandwidth`, `lan_bandwidth`, `wan_bandwidth` | field | number | Sum of `Session.bandwidth` (kbps), overall and by network |

### type = library_stats

Config: `inputs.plex[].libraries` (`enabled`, `intervalSeconds`) · Source: `/library/sections/all`, then `/library/sections/{sectionId}/all` (size-0 request) for the item count. One point per library.

| Key | Kind | Type | Meaning |
|-----|------|------|---------|
| `section_name` | tag | string | Library title (`unknown` when absent) |
| `section_type` | tag | string | Library type (`unknown` when absent) |
| `name` | tag | string | Duplicate of `section_name` (legacy) |
| `total` | field | number | Item count (`0` if the count request fails) |
| `libraries` | field | string | Library title (legacy) |
| `refreshing` | field | number | `1` while Plex scans the library |
| `scanned_age_seconds` | field | number | Seconds since the last scan (`scannedAt`) |
| `locations` | field | number | Folders of the library |
| `seasons`, `episodes` | field | number | Show libraries only: media query `type=3` / `type=4` |
| `albums`, `tracks` | field | number | Music libraries only: media query `type=9` / `type=10` |
| `added_7d` | field | number | Movies, episodes or tracks added in the last 7 days (`addedAt>>=-7d`) |

The extra counts are size-0 requests like `total`; a count whose request fails is omitted (unlike `total`). Photo and other libraries get no extra count.

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

### type = Activities / Activity

Config: `inputs.plex[].status` (`enabled`, `intervalSeconds`, default disabled, 300) · Source: `/activities`. `Activities` is one point per poll; `Activity` one point per running server activity (scan, intro detection, ...).

| Key | Kind | Type | Meaning |
|-----|------|------|---------|
| `count` | field | number | `Activities`: running activities |
| `activity_type` | tag | string | `Activity`: activity type (`library.update.section`, `media.generate.intros`, ...) |
| `present` | field | number | `Activity`: always `1`, keeps the point when Plex reports no other value |
| `progress` | field | float | `Activity`: progress in percent |
| `cancellable` | field | number | `Activity`: `1` when it can be cancelled |

### type = BackgroundTranscodes / BackgroundTranscode

Config: `status` · Source: `/status/sessions/background` (optimize and sync jobs).

| Key | Kind | Type | Meaning |
|-----|------|------|---------|
| `count` | field | number | `BackgroundTranscodes`: running jobs |
| `rating_key` | tag | string | `BackgroundTranscode`: item being transcoded |
| `present` | field | number | `BackgroundTranscode`: always `1` |
| `progress`, `speed` | field | float | `BackgroundTranscode`: progress in percent, transcode speed |
| `remaining_seconds` | field | number | `BackgroundTranscode`: estimated time left |
| `size` | field | number | `BackgroundTranscode`: output size in bytes |

Plex reports unknown sizes and durations as negative numbers (e.g. `-22`): those are omitted.

### type = ButlerTask

Config: `status` · Source: `/butler`. One point per scheduled maintenance task.

| Key | Kind | Type | Meaning |
|-----|------|------|---------|
| `task` | tag | string | Task name (`BackupDatabase`, `OptimizeDatabase`, ...) |
| `enabled` | field | number | `1` when enabled |
| `randomized` | field | number | `1` when its schedule is randomized |
| `interval_days` | field | number | Days between runs |

### type = Updater

Config: `status` · Source: `/updater/status`.

| Key | Kind | Type | Meaning |
|-----|------|------|---------|
| `state` | tag | string | State of the first listed release (`available`, `downloaded`, ...), `none` without release |
| `version` | tag | string | Version of that release, `none` without release |
| `can_install` | field | number | `1` when Plex can install the update |
| `checked_age_seconds` | field | number | Seconds since the last update check |
| `releases` | field | number | Releases listed |

### type = Resources

Config: `status` · Source: `/statistics/resources?timespan=6`. The most recent sample, timestamped with its time; no point when Plex returns none, or refuses the request (`401`/`403`) without failing the other status points.

| Key | Kind | Type | Meaning |
|-----|------|------|---------|
| `host_cpu_percent`, `host_memory_percent` | field | float | CPU and memory use of the host |
| `process_cpu_percent`, `process_memory_percent` | field | float | CPU and memory use of Plex Media Server |

### type = TranscodeSessions

Config: `status` · Source: `/transcode/sessions` (playback and background transcodes).

| Key | Kind | Type | Meaning |
|-----|------|------|---------|
| `count` | field | number | Transcoder sessions |
| `video_transcodes`, `audio_transcodes` | field | number | Sessions transcoding the video / the audio |
| `hw_decoding`, `hw_encoding` | field | number | Sessions using hardware decoding / encoding |
| `throttled` | field | number | Throttled sessions |

### type = Bandwidth

Config: `status` · Source: `/statistics/bandwidth?timespan=4&at>=<mark>` (hourly bins), with `/accounts` and `/devices` for the names. One event point per account, device and network for each **completed** hour, timestamped with the start of the hour: an hour is written once it has ended, so its point arrives up to one status interval after the hour. A status poll that fails writes no hour, and the next successful poll writes it. When Plex refuses the request (`401`/`403`) no bandwidth point is written and the other status points are kept.

| Key | Kind | Type | Meaning |
|-----|------|------|---------|
| `network` | tag | string | `lan` or `wan` |
| `account_id`, `username` | tag | number, string | Plex account (`unknown` when not in `/accounts`) |
| `device_id`, `device_name`, `platform` | tag | number, string | Device (`unknown` when not in `/devices`) |
| `bytes` | field | number | Bytes sent during the hour |

### type = Play

Config: `inputs.plex[].history` (`enabled`, `intervalSeconds`, default disabled, 300) · Source: `/status/sessions/history/all?viewedAt>=<mark>`, with `/accounts` and `/devices` for the names. One event point per play, timestamped with `viewedAt`.

| Key | Kind | Type | Meaning |
|-----|------|------|---------|
| `media_type` | tag | string | Media type, shared vocabulary (see top of page) |
| `library_section_id` | tag | string | Library of the item |
| `rating_key` | tag | string | Item played |
| `account_id`, `username` | tag | number, string | Plex account (`unknown` when not in `/accounts`) |
| `device_id`, `device_name`, `platform` | tag | number, string | Device (`unknown` when not in `/devices`) |
| `hash` | field | string | MD5 of server id + `historyKey` |
| `title` | field | string | Item title (episode or track title for episodes and tracks) |

### type = Inventory / Device

Config: `inputs.plex[].inventory` (`enabled`, `intervalSeconds`, default disabled, 3600) · Source: `/accounts`, `/devices`. Device client identifiers are never written.

| Key | Kind | Type | Meaning |
|-----|------|------|---------|
| `accounts`, `devices` | field | number | `Inventory`: accounts and devices known to the server |
| `device_id`, `device_name`, `platform` | tag | number, string | `Device`: one point per device |
| `present` | field | number | `Device`: always `1` |
| `created_age_days` | field | number | `Device`: days since the device first connected |

### type = LiveTv / Recording

Config: `inputs.plex[].liveTv` (`enabled`, `intervalSeconds`, default disabled, 300) · Source: `/livetv/sessions`, `/media/subscriptions/scheduled`. `Recording` is one point per recording in progress. A server without DVR or Plex Pass answers `403` to the recordings request: the `LiveTv` point then only carries `sessions`.

| Key | Kind | Type | Meaning |
|-----|------|------|---------|
| `sessions` | field | number | `LiveTv`: live TV sessions |
| `recordings_scheduled`, `recordings_in_progress`, `recordings_failed` | field | number | `LiveTv`: recording operations by status (`scheduled`, `inprogress`, `error`) |
| `grab_id`, `provider` | tag | string | `Recording`: operation id and guide provider |
| `present` | field | number | `Recording`: always `1` |
| `percent` | field | float | `Recording`: progress in percent |

## Jellyfin

The `status`, `history`, `inventory` and `liveTv` collectors are described in [Jellyfin and Emby: status, history, inventory, Live TV](#jellyfin-and-emby-status-history-inventory-live-tv).

### type = Session

Config: `inputs.jellyfin[].sessions` (`enabled`, `intervalSeconds`) · Source: `/Sessions?activeWithinSeconds=960` (only sessions with a now-playing item; the summary also counts idle sessions active in the last 16 minutes).

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
| `media_type` | tag | string | Media type, shared vocabulary (see top of page) |
| `audio_codec` | tag | string | Upper-cased codec of the played audio stream, else first audio stream, else transcoder audio codec (`unknown` when none) |
| `player_state` | tag | number | `1` paused, `0` otherwise (buffering is never produced) |
| `device_type` | tag | string | Device type (`unknown` when absent) |
| `play_method` | tag | string | Play method (`unknown` when absent) |
| `hash` | field | string | MD5 of session id + user name + title |
| `progress_percent` | field | number | Rounded position / runtime in percent (`0` without runtime) |
| `network` | tag | string | `lan` / `wan` from `RemoteEndPoint` (RFC 1918, loopback, link-local and IPv6 unique-local ranges; port and IPv4-mapped forms handled), `unknown` without an address |
| `audio_decision` | tag | string | `direct play` (no transcoding), `direct stream` (audio copied) or `transcode` |
| `transcode_reasons` | tag | string | Sorted, comma-joined transcode reasons (`none` without transcoding) |
| `video_codec` / `stream_video_codec` | tag | string | Source / streamed video codec, upper-cased |
| `stream_audio_codec` | tag | string | Streamed audio codec (`audio_codec` is the source) |
| `stream_video_resolution` | tag | string | Transcoded height, else `quality` |
| `device_name`, `user_id` | tag | string | Device name and user id |
| `year`, `genre`, `content_rating` | tag | number / string | Production year, first genre, official rating |
| `duration_seconds`, `view_offset_seconds` | field | number | Item duration and playback position |
| `stream_bitrate` | field | number | Transcoded bitrate (kbps), transcoding only |
| `stream_framerate`, `transcode_progress` | field | float | Transcoded frame rate and progress, transcoding only |
| `community_rating` | field | float | Community rating |
| `hw_acceleration` | tag | string | Hardware acceleration type (`none` without transcoding, `unknown` when the server does not report it) |
| `paused_seconds` | field | number | Seconds since `LastPausedDate`, only while paused |

### type = current_stream_stats

Config: `inputs.jellyfin[].sessions` · Source: `/Sessions`.

| Key | Kind | Type | Meaning |
|-----|------|------|---------|
| `stream_count` | field | number | Sessions with a now-playing item |
| `transcode_streams` | field | number | Sessions transcoding, i.e. not both video and audio copied (remux does not count) |
| `connected_clients` | field | number | All connected sessions, playing or not |
| `connected_users`, `streaming_users` | field | number | Distinct users connected / playing |
| `direct_play_streams`, `direct_streams` | field | number | Streams without transcoding / remuxed |
| `lan_streams`, `wan_streams` | field | number | Streams by `network` |

### type = library_stats

Config: `inputs.jellyfin[].libraries` (`enabled`, `intervalSeconds`) · Source: `/Library/VirtualFolders`. One point per library.

| Key | Kind | Type | Meaning |
|-----|------|------|---------|
| `section_name` | tag | string | Library name (`unknown` when absent) |
| `section_type` | tag | string | Collection type (`unknown` when absent) |
| `name` | tag | string | Duplicate of `section_name` (legacy) |
| `locations` | field | number | Number of library folders |
| `libraries` | field | string | Library name (legacy) |
| `refresh_status` | tag | string | Library scan state (`Idle`, `Active`, ...) |
| `refresh_progress` | field | float | Scan progress, when a scan is running |

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
| `music_videos`, `programs`, `trailers` | field | number | Additional counters, omitted when absent |

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

Same shape as Jellyfin; the API is called under the `/emby` prefix. The `status`, `history`, `inventory` and `liveTv` collectors are described in [Jellyfin and Emby: status, history, inventory, Live TV](#jellyfin-and-emby-status-history-inventory-live-tv).

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
| `media_type` | tag | string | Media type, shared vocabulary (see top of page) |
| `audio_codec` | tag | string | Upper-cased codec of the played audio stream, else first audio stream, else transcoder audio codec (`unknown` when none) |
| `player_state` | tag | number | `1` paused, `0` otherwise (buffering is never produced) |
| `device_type` | tag | string | Device type (`unknown` when absent) |
| `play_method` | tag | string | Play method (`unknown` when absent) |
| `hash` | field | string | MD5 of session id + user name + title |
| `progress_percent` | field | number | Rounded position / runtime in percent (`0` without runtime) |
| `network` | tag | string | `lan` / `wan` from `RemoteEndPoint` (RFC 1918, loopback, link-local and IPv6 unique-local ranges; port and IPv4-mapped forms handled), `unknown` without an address |
| `audio_decision` | tag | string | `direct play` (no transcoding), `direct stream` (audio copied) or `transcode` |
| `transcode_reasons` | tag | string | Sorted, comma-joined transcode reasons (`none` without transcoding) |
| `video_codec` / `stream_video_codec` | tag | string | Source / streamed video codec, upper-cased |
| `stream_audio_codec` | tag | string | Streamed audio codec (`audio_codec` is the source) |
| `stream_video_resolution` | tag | string | Transcoded height, else `quality` |
| `device_name`, `user_id` | tag | string | Device name and user id |
| `year`, `genre`, `content_rating` | tag | number / string | Production year, first genre, official rating |
| `duration_seconds`, `view_offset_seconds` | field | number | Item duration and playback position |
| `stream_bitrate` | field | number | Transcoded bitrate (kbps), transcoding only |
| `stream_framerate`, `transcode_progress` | field | float | Transcoded frame rate and progress, transcoding only |
| `community_rating` | field | float | Community rating |
| `video_decoder_hw`, `video_encoder_hw` | field | number | `1` when the transcoder decodes / encodes in hardware |
| `transcode_cpu_percent` | field | float | Transcoder CPU usage |

### type = current_stream_stats

Config: `inputs.emby[].sessions` · Source: `/emby/Sessions`. Emby's `/Sessions` has no activity window, so `connected_*` counts every session the server still holds.

| Key | Kind | Type | Meaning |
|-----|------|------|---------|
| `stream_count` | field | number | Sessions with a now-playing item |
| `transcode_streams` | field | number | Sessions transcoding, i.e. not both video and audio copied (remux does not count) |
| `connected_clients` | field | number | All connected sessions, playing or not |
| `connected_users`, `streaming_users` | field | number | Distinct users connected / playing |
| `direct_play_streams`, `direct_streams` | field | number | Streams without transcoding / remuxed |
| `lan_streams`, `wan_streams` | field | number | Streams by `network` |

### type = library_stats

Config: `inputs.emby[].libraries` (`enabled`, `intervalSeconds`) · Source: `/emby/Library/VirtualFolders`. One point per library.

| Key | Kind | Type | Meaning |
|-----|------|------|---------|
| `section_name` | tag | string | Library name (`unknown` when absent) |
| `section_type` | tag | string | Collection type (`unknown` when absent) |
| `name` | tag | string | Duplicate of `section_name` (legacy) |
| `locations` | field | number | Number of library folders |
| `libraries` | field | string | Library name (legacy) |
| `refresh_status` | tag | string | Library scan state (`Idle`, `Active`, ...) |
| `refresh_progress` | field | float | Scan progress, when a scan is running |

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
| `music_videos`, `programs`, `trailers`, `games`, `game_systems` | field | number | Additional counters, omitted when absent |

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

## Jellyfin and Emby: status, history, inventory, Live TV

Both services write the same points; differences are noted per section. Sources are given for Jellyfin; Emby calls them under `/emby` with its own parameter names (`IsHidden`, `MinDate`, `Limit`, `IsInProgress`).

### type = Task / Tasks

Config: `inputs.<service>[].status` (`enabled`, `intervalSeconds`, default disabled, 300) · Source: `/ScheduledTasks?isHidden=false`. `Task` is one point per scheduled task, `Tasks` one point per poll.

| Key | Kind | Type | Meaning |
|-----|------|------|---------|
| `task` | tag | string | Task key (`RefreshLibrary`, ...) |
| `name`, `category` | tag | string | Task display name and category |
| `state` | tag | string | `Idle`, `Running`, `Cancelling` |
| `last_status` | tag | string | Result of the last run (`Completed`, `Failed`, `Cancelled`, `Aborted`), `never` when it never ran |
| `progress` | field | float | Progress in percent, while running |
| `last_execution_age_seconds` | field | number | Seconds since the last run ended |
| `last_duration_seconds` | field | float | Duration of the last run |
| `running`, `failed` | field | number | `Tasks`: tasks running, tasks whose last run failed |

### type = Plugin / Plugins

Config: `status` · Source: `/Plugins`. `Plugin` is one point per installed plugin, `Plugins` one point per poll.

| Key | Kind | Type | Meaning |
|-----|------|------|---------|
| `plugin`, `version` | tag | string | `Plugin`: plugin name and version |
| `status` | tag | string | `Plugin`, Jellyfin only: `Active`, `Restart`, `Malfunctioned`, `NotSupported`, `Disabled`, ... |
| `installed` | field | number | `Plugin`: always `1` |
| `plugins` | field | number | `Plugins`: installed plugins |
| `plugins_active`, `plugins_failing` | field | number | `Plugins`, Jellyfin only: plugins `Active`, plugins `Malfunctioned` or `NotSupported` |

### type = Storage

Config: `status` · Source: `/System/Info/Storage` (Jellyfin 10.11 and later; older servers answer `404` and get no storage point, the other status points are kept). One point per server folder and per library folder. Space is that of the device holding the folder (`StorageHelper.GetFreeSpaceOf`), not of the folder itself; a device Jellyfin cannot read (reported as `-1`) gets no space fields.

| Key | Kind | Type | Meaning |
|-----|------|------|---------|
| `folder` | tag | string | `program_data`, `web`, `image_cache`, `cache`, `log`, `internal_metadata`, `transcoding_temp` or `library` |
| `library` | tag | string | Library name, `none` for server folders |
| `path`, `storage_type` | tag | string | Folder path and file system |
| `free_bytes`, `used_bytes` | field | number | Free and used space of the device |
| `used_percent` | field | float | `used / (used + free)`; omitted when both are 0 |

### type = Activity

Config: `inputs.<service>[].history` (`enabled`, `intervalSeconds`, default disabled, 300) · Source: `/System/ActivityLog/Entries?minDate=<mark>`. One event point per activity log entry (playback, login, failed login, ...). The entry overview is never written (it holds client IP addresses).

| Key | Kind | Type | Meaning |
|-----|------|------|---------|
| `activity_type` | tag | string | Entry type (`VideoPlayback`, `AuthenticationFailed`, ...) |
| `severity` | tag | string | Jellyfin `Information`, `Warning`, `Error`, ... · Emby `Info`, `Warn`, `Error`, ... |
| `user_id` | tag | string | User concerned (`unknown` when absent) |
| `item_id` | tag | string | Item concerned, `none` when absent |
| `hash` | field | string | MD5 of server id + entry id |
| `name` | field | string | Entry text |

### type = User / Users

Config: `inputs.<service>[].inventory` (`enabled`, `intervalSeconds`, default disabled, 3600) · Source: Jellyfin `/Users`, Emby `/Users/Query`.

| Key | Kind | Type | Meaning |
|-----|------|------|---------|
| `user_id`, `username` | tag | string | `User`: one point per user |
| `present` | field | number | `User`: always `1` |
| `is_admin`, `is_disabled`, `is_hidden`, `has_password` | field | number | `User`: `1` yes, `0` no; omitted when not reported |
| `last_activity_age_seconds`, `last_login_age_seconds` | field | number | `User`: seconds since the last activity / login; omitted when never |
| `users`, `admins`, `disabled` | field | number | `Users`: counts |
| `active_24h`, `active_30d` | field | number | `Users`: users active in the last 24 hours / 30 days |

### type = Device / Devices

Config: `inventory` · Source: `/Devices`. Access tokens (Jellyfin) and IP addresses (Emby) are never written.

| Key | Kind | Type | Meaning |
|-----|------|------|---------|
| `device_id` | tag | string | `Device`: device id |
| `device_name` | tag | string | `Device`: custom name, else device name |
| `app_name`, `app_version` | tag | string | `Device`: client application |
| `last_user` | tag | string | `Device`: last user name |
| `present` | field | number | `Device`: always `1` |
| `last_activity_age_seconds` | field | number | `Device`: seconds since its last activity |
| `devices`, `active_24h` | field | number | `Devices`: devices, devices active in the last 24 hours |

### type = LiveTv

Config: `inputs.<service>[].liveTv` (`enabled`, `intervalSeconds`, default disabled, 300) · Source: `/LiveTv/Recordings` (twice, all and in progress, one record each), `/LiveTv/Timers`.

| Key | Kind | Type | Meaning |
|-----|------|------|---------|
| `recordings`, `recordings_in_progress` | field | number | Recordings stored, recordings in progress |
| `timers` | field | number | Recording timers |
| `recordings_scheduled` | field | number | Timers with status `New` |
| `recordings_failed` | field | number | Timers with status `Error` or `ConflictedNotOk` |
| `next_recording_in_seconds` | field | number | Seconds until the next timer starts; omitted when none is planned |

## Ombi

### type = Request_Counts

Config: `inputs.ombi[].requestCounts` (`enabled`, `intervalSeconds`) · Source: `/api/v1/Request/count`.

| Key | Kind | Type | Meaning |
|-----|------|------|---------|
| `pending` | field | number | Pending requests |
| `approved` | field | number | Approved requests |
| `available` | field | number | Available requests |
| `denied` | field | number | Denied requests; omitted when Ombi does not report it |

`pending`, `approved` and `available` default to `0` when absent.

### type = Requests

Config: `inputs.ombi[].requestCounts` (collected on the same schedule as `Request_Counts`) · Source: `/api/v1/Request/tv`, `/api/v1/Request/movie`, `/api/v1/request/music`, `/api/v1/Identity/Users` (user names). One point per movie request, per TV child request (a user's request for some seasons of a show) and per album request. Denial reasons are free text and are not written.

| Key | Kind | Type | Meaning |
|-----|------|------|---------|
| `request_type` | tag | number | `0` TV, `1` movie, `2` music |
| `media_type` | tag | string | `show`, `movie` or `album` (shared vocabulary) |
| `status` | tag | number | `0` denied, `1` approved, `2` completed (approved and available), `3` pending |
| `status_4k` | tag | number/string | Movies only: status of the 4K request, same values as `status`; `none` without 4K request |
| `source` | tag | number | Ombi request source (`RequestSource`: `0`, `1`); `unknown` when absent |
| `title` | tag | string | Request title (`unknown` when absent) |
| `requested_user` | tag | string | Alias/user name resolved from the Ombi user list, then the request alias, then `Unknown` |
| `requested_date` | tag | string | Request date, empty string when absent |
| `hash` | field | string | MD5 of request id (+ child request id for TV) + TVDB/TMDB/album id + title |
| `approve_seconds` | field | number | Seconds from the request to its approval; omitted when not approved |
| `available_seconds` | field | number | Seconds from the request to availability; omitted when not available |
| `played_by_users` | field | number | Movies: users who played it |
| `watched_by_requester` | field | number | Movies: `1` if the requester watched it, else `0` |
| `requester_progress` | field | number | TV: requester's played progress |
| `seasons` | field | number | TV: requested seasons; omitted when Ombi does not list them |
| `episodes` | field | number | TV: requested episodes over those seasons |

### type = Request_Total

Config: `inputs.ombi[].requestCounts` · Source: `/api/v1/Request/tv`, `/api/v1/Request/movie`.

| Key | Kind | Type | Meaning |
|-----|------|------|---------|
| `total` | field | number | TV shows plus movie requests |
| `movies` | field | number | Movie requests |
| `tv_shows` | field | number | TV shows requested |
| `tv_requests` | field | number | TV child requests (one per user request for some seasons) |
| `music` | field | number | Album requests |

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

### type = Totals

Config: `inputs.ombi[].totals` (`enabled`, `intervalSeconds`, default disabled, 300) · Source: `/api/v1/Request/{movie,tv}/total`, `/api/v1/request/music/total`, `/api/v2/Requests/{movie,tv,album}/{status}/1/0/requestedDate/desc` (`total` of the response). One point per media type.

| Key | Kind | Type | Meaning |
|-----|------|------|---------|
| `media_type` | tag | string | `movie`, `show` (child requests for the per-status totals) or `album` |
| `total` | field | number | All requests of the type |
| `available` | field | number | Available requests |
| `processing` | field | number | Approved, not yet available |
| `pending` | field | number | Waiting for approval |
| `denied` | field | number | Denied requests |
| `unavailable` | field | number | Requests not available; `movie` and `show` only |

### type = Stats

Config: `inputs.ombi[].totals` · Source: `/api/v1/Stats` over the last 30 days. Not written when Ombi fails on a window without requests. `completedRequestsMovies` is not written: Ombi counts every movie request of the window there.

| Key | Kind | Type | Meaning |
|-----|------|------|---------|
| `movie_requests_30d` | field | number | Movie requests of the last 30 days |
| `tv_requests_30d` | field | number | TV child requests of the last 30 days |
| `completed_tv_30d` | field | number | Of those, TV requests made available in the window |

### type = User

Config: `inputs.ombi[].users` (`enabled`, `intervalSeconds`, default disabled, 3600) · Source: `/api/v1/Identity/Users`. One point per user; e-mail addresses and passwords are never written.

| Key | Kind | Type | Meaning |
|-----|------|------|---------|
| `user_id` | tag | string | Ombi user id |
| `username` | tag | string | Alias, else user name |
| `user_type` | tag | number | Ombi user type |
| `has_logged_in` | field | number | `1` if the user ever logged in, else `0` |
| `last_login_age_seconds` | field | number | Seconds since the last login; omitted when never |
| `movie_quota_limit`, `movie_quota_remaining` | field | number | Movie request quota and what is left; only for users with a movie limit |
| `episode_quota_limit`, `episode_quota_remaining` | field | number | Same for episodes |
| `music_quota_limit`, `music_quota_remaining` | field | number | Same for albums |

### type = Users

Config: `inputs.ombi[].users` · Source: `/api/v1/Identity/Users`.

| Key | Kind | Type | Meaning |
|-----|------|------|---------|
| `users` | field | number | Users |
| `logged_in_30d` | field | number | Users who logged in within 30 days |

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
| `completed` | field | number | Completed requests; omitted when Seerr does not report it |

Fields other than `completed` default to `0` when absent.

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

Config: `inputs.overseerr[].latestRequests` (`enabled`, `count`, `intervalSeconds`) · Source: `/api/v1/request` (`take=count`, `sort=added`), then `/api/v1/tv/{tvId}` or `/api/v1/movie/{movieId}` once per title (cached; a failed lookup is retried on the next poll). A request without a TMDB id, or whose title cannot be fetched, is written with the title `unknown`.

| Key | Kind | Type | Meaning |
|-----|------|------|---------|
| `request_type` | tag | number | `0` TV, `1` movie |
| `status` | tag | number | Request status: `1` pending approval, `2` approved, `3` declined (pinned spec); Seerr also uses `4` failed, `5` completed |
| `media_status` | tag | number | Media availability: `1` unknown, `2` pending, `3` processing, `4` partially available, `5` available, `6` blocklisted, `7` deleted (`0` when absent) |
| `media_status_4k` | tag | number | 4K media availability, same values as `media_status` (`unknown` when absent) |
| `media_type` | tag | string | `movie` or `show` |
| `is_4k` | tag | number | `1` for a 4K request, else `0` |
| `title` | tag | string | Media title from TV/movie details (`unknown` when it cannot be fetched) |
| `requested_user` | tag | string | Requester display name, never the e-mail Seerr falls back to (user name, Plex user name, else `user_<id>`); `Unknown` when absent |
| `requested_date` | tag | string | Request creation date, empty string when absent |
| `hash` | field | string | MD5 of TMDB id + title |
| `seasons` | field | number | TV: requested seasons |

### type = ServerInfo

Config: `inputs.overseerr[].serverInfo` (`enabled`, `intervalSeconds`, default disabled, 300) · Source: `/api/v1/status?checkUpdateAvailable=true`

| Key | Kind | Type | Meaning |
|-----|------|------|---------|
| `reachable` | field | number | Always `1`: keeps the point when the service reports nothing else |
| `version` | tag | string | Seerr version (`unknown` when absent) |
| `update_available` | field | number | Update available: `1` yes, `0` no; omitted when the service does not report it |
| `commits_behind` | field | number | Commits behind the latest version; omitted when Seerr skips the version check |
| `restart_pending` | field | number | Restart required: `1` yes, `0` no; omitted when the service does not report it |

### type = RequestTotals

Config: `inputs.overseerr[].totals` (`enabled`, `intervalSeconds`, default disabled, 300) · Source: `/api/v1/request?filter=…&take=1` (`pageInfo.results`).

| Key | Kind | Type | Meaning |
|-----|------|------|---------|
| `failed` | field | number | Requests whose sending to Sonarr/Radarr failed |
| `unavailable` | field | number | Requests whose media is not available |
| `deleted` | field | number | Requests whose media was deleted |

### type = MediaTotals

Config: `inputs.overseerr[].totals` · Source: `/api/v1/media?filter=…&take=1` (`pageInfo.results`).

| Key | Kind | Type | Meaning |
|-----|------|------|---------|
| `total` | field | number | All media known to Seerr |
| `available` | field | number | Available |
| `partially_available` | field | number | Partially available |
| `all_available` | field | number | Available or partially available |
| `processing` | field | number | Processing |
| `pending` | field | number | Pending |

### type = Job

Config: `inputs.overseerr[].status` (`enabled`, `intervalSeconds`, default disabled, 300) · Source: `/api/v1/settings/jobs`. One point per scheduled job.

| Key | Kind | Type | Meaning |
|-----|------|------|---------|
| `job_id` | tag | string | Job id |
| `job_type` | tag | string | `process` or `command` |
| `interval` | tag | string | `short`, `long` or `fixed` |
| `name` | field | string | Job name |
| `running` | field | number | `1` while running, else `0` |
| `next_run_seconds` | field | number | Seconds until the next run; omitted when unknown |

### type = Cache

Config: `inputs.overseerr[].status` · Source: `/api/v1/settings/cache`.

| Key | Kind | Type | Meaning |
|-----|------|------|---------|
| `tmdb_image_size`, `tmdb_images` | field | number | TMDB image cache size (bytes) and image count |
| `avatar_image_size`, `avatar_images` | field | number | Avatar image cache size (bytes) and image count |
| `dns_size`, `dns_max_size` | field | number | DNS cache entries and capacity |
| `dns_hits`, `dns_misses`, `dns_failures`, `dns_ipv4_fallbacks` | field | number | DNS cache counters |
| `dns_hit_rate` | field | float | DNS cache hit rate (0-1) |

### type = ApiCache

Config: `inputs.overseerr[].status` · Source: `/api/v1/settings/cache` (`apiCaches`). One point per API cache.

| Key | Kind | Type | Meaning |
|-----|------|------|---------|
| `cache_id` | tag | string | Cache id (`tmdb`, `radarr`, …) |
| `name` | field | string | Cache name |
| `hits`, `misses` | field | number | Cache hits and misses |
| `keys` | field | number | Cached keys |
| `key_size`, `value_size` | field | number | Size of keys and values (bytes) |

### type = Status

Config: `inputs.overseerr[].status` · Source: `/api/v1/settings/about`, `/api/v1/status/appdata`. The appdata path is never written.

| Key | Kind | Type | Meaning |
|-----|------|------|---------|
| `total_requests` | field | number | All requests |
| `total_media_items` | field | number | All media items |
| `appdata` | field | number | `1` if the appdata volume is mounted, else `0` |
| `appdata_permissions` | field | number | `1` if Seerr can write to it, else `0` |

### type = User

Config: `inputs.overseerr[].users` (`enabled`, `intervalSeconds`, default disabled, 3600) · Source: `/api/v1/user?sort=requests` (paged), `/api/v1/user/{userId}/quota`. One point per user; e-mail addresses, tokens and avatars are never written.

| Key | Kind | Type | Meaning |
|-----|------|------|---------|
| `user_id` | tag | number | Seerr user id |
| `display_name` | tag | string | Display name, never the e-mail Seerr falls back to (user name, Plex user name, else `user_<id>`) |
| `user_type` | tag | number | Seerr user type |
| `requests` | field | number | Requests made by the user |
| `movie_quota_limit`, `movie_quota_days` | field | number | Movie quota: requests allowed per number of days; omitted without quota |
| `movie_quota_used`, `movie_quota_remaining` | field | number | Movie requests used and left in the quota window |
| `movie_quota_restricted` | field | number | `1` when the user reached the movie quota, else `0` |
| `tv_quota_*` | field | number | Same for TV (seasons) |

### type = Users

Config: `inputs.overseerr[].users` · Source: `/api/v1/user`.

| Key | Kind | Type | Meaning |
|-----|------|------|---------|
| `users` | field | number | Users |

## Bazarr

### type = Wanted

Config: `inputs.bazarr[].wanted` (`enabled`, `intervalSeconds`) · Source: `/api/movies/wanted`, `/api/episodes/wanted` (`length=1000`). One point per missing subtitle language of each item; the tag set depends on `media_type`.

| Key | Kind | Type | Meaning |
|-----|------|------|---------|
| `media_type` | tag | string | `movie` or `episode` |
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
| `tags` | tag | string | Bazarr tags of the movie/series, sorted and comma-joined; `none` without tag |
| `series_type` | tag | string | `standard`, `anime` or `daily`; `episode` only |
| `hash` | field | string | MD5 of server id + movie/episode id + language code |

### type = WantedTotal

Config: `inputs.bazarr[].wanted` · Source: `total` of `/api/movies/wanted` and `/api/episodes/wanted`. Counts every wanted item, while `Wanted` points stop at the first 1000 items.

| Key | Kind | Type | Meaning |
|-----|------|------|---------|
| `movies` | field | number | Movies with missing subtitles |
| `episodes` | field | number | Episodes with missing subtitles |

### type = History

Config: `inputs.bazarr[].history` (`enabled`, `intervalSeconds`) · Source: `/api/movies/history`, `/api/episodes/history` (pages of 100, newest first). Event points: each history entry is written once, when it is newer than the last one written (the mark is kept in `DATA_FOLDER` across restarts; entries made while Varken was stopped are not backfilled). Pages are read until one reaches the mark, up to 10 pages (1000 entries) per poll; older entries beyond the cap are not written (logged at info). Timestamp: `parsed_timestamp` of the entry (Bazarr local time, `MM/DD/YY HH:MM:SS` or 4-digit year, the C locale layout), read in Varken's time zone, plus milliseconds taken from `hash` so two entries of the same second stay distinct. Run Varken with the same `TZ` as Bazarr: otherwise times are shifted by the difference, and entries written just after an upgrade can fall below the mark. Entries of the hour repeated when daylight saving time ends are below the mark and are not written. An entry whose date cannot be parsed (another locale) is skipped, with a warning logged once. The tag set depends on `media_type`.

| Key | Kind | Type | Meaning |
|-----|------|------|---------|
| `media_type` | tag | string | `movie` or `episode` |
| `radarrId` | tag | number | Radarr movie id; `movie` only |
| `sonarrSeriesId` | tag | number | Sonarr series id; `episode` only |
| `sonarrEpisodeId` | tag | number | Sonarr episode id; `episode` only |
| `name` | tag | string | `Title - Language` for movies, `Series - Episode - Language` for series |
| `title` | tag | string | Movie title; `movie` only |
| `seriesTitle` | tag | string | Series title; `episode` only |
| `episodeNumber` | tag | string | Episode number as sent by Bazarr; `episode` only |
| `language` | tag | string | Language name (`unknown` when absent) |
| `languageCode` | tag | string | 3-letter language code (`unknown` when absent) |
| `provider` | tag | string | Subtitle provider (`unknown` when absent) |
| `action` | tag | number | Bazarr history action code, as sent |
| `forced` | tag | number | `1` for a forced subtitle, else `0` |
| `hi` | tag | number | `1` for a hearing-impaired subtitle, else `0` |
| `hash` | field | string | MD5 of server id + movie/episode id + action + language code + provider + subtitle id + `parsed_timestamp` |
| `score_percent` | field | number | Match score parsed from `"92.5%"`; omitted when missing or unparsable |
| `upgradable` | field | number | `1` if Bazarr may still upgrade the subtitle, else `0` |
| `blacklisted` | field | number | `1` if the subtitle is blacklisted, else `0` |
| `matches`, `dont_matches` | field | number | Release properties the subtitle matched / did not match |

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

### type = Badges

Config: `inputs.bazarr[].status` (`enabled`, `intervalSeconds`, default disabled, 300) · Source: `/api/badges`.

| Key | Kind | Type | Meaning |
|-----|------|------|---------|
| `wanted_episodes`, `wanted_movies` | field | number | Missing subtitles (languages) of episodes and movies |
| `throttled_providers` | field | number | Providers currently throttled |
| `health_issues` | field | number | Health issues |
| `announcements` | field | number | Announcements not dismissed |
| `sonarr_signalr`, `radarr_signalr` | field | number | `1` while the SignalR feed from Sonarr/Radarr is connected, else `0` |

### type = Provider

Config: `inputs.bazarr[].status` · Source: `/api/providers`. One point per enabled provider.

| Key | Kind | Type | Meaning |
|-----|------|------|---------|
| `provider` | tag | string | Provider name |
| `status` | tag | string | `Good`, or the throttling reason (`TooManyRequests`, `AuthenticationError`, …) |
| `throttled` | field | number | `1` while throttled, else `0` |

### type = Task

Config: `inputs.bazarr[].status` · Source: `/api/system/tasks`. One point per scheduled task.

| Key | Kind | Type | Meaning |
|-----|------|------|---------|
| `task_id` | tag | string | Task id |
| `task_name` | tag | string | Task name |
| `interval` | tag | string | Schedule as Bazarr words it (`every 6 hours`, `every day at 4:00`, …) |
| `running` | field | number | `1` while running, else `0` |

### type = Jobs

Config: `inputs.bazarr[].status` · Source: `/api/system/jobs`.

| Key | Kind | Type | Meaning |
|-----|------|------|---------|
| `pending`, `running`, `failed`, `completed` | field | number | Jobs in each queue |

### type = Releases

Config: `inputs.bazarr[].status` · Source: `/api/system/releases`.

| Key | Kind | Type | Meaning |
|-----|------|------|---------|
| `latest` | tag | string | Latest release of Bazarr's branch (`unknown` when Bazarr lists none) |
| `releases` | field | number | Releases Bazarr lists (the last 5 on `master`) |
| `releases_behind` | field | number | Releases published after the running one; omitted when the running build is not in the list |

### type = HistoryStats

Config: `inputs.bazarr[].stats` (`enabled`, `intervalSeconds`, default disabled, 3600) · Source: `/api/history/stats?timeFrame=week`. One point per day at 00:00 UTC of Bazarr's local date, written once the day after it ends (downloads still running at midnight, Bazarr's time zone); days completed before Varken started are not backfilled.

| Key | Kind | Type | Meaning |
|-----|------|------|---------|
| `episodes` | field | number | Subtitles downloaded, upgraded or manually added for episodes that day |
| `movies` | field | number | Same for movies |

### type = Languages

Config: `inputs.bazarr[].stats` · Source: `/api/system/languages`.

| Key | Kind | Type | Meaning |
|-----|------|------|---------|
| `enabled` | field | number | Languages enabled in Bazarr |
| `total` | field | number | Languages Bazarr knows |

### type = Library

Config: `inputs.bazarr[].library` (`enabled`, `intervalDays`, default disabled, 1) · Source: `/api/movies`, `/api/series`. One point per media type.

| Key | Kind | Type | Meaning |
|-----|------|------|---------|
| `media_type` | tag | string | `movie` or `show` |
| `items` | field | number | Movies or series |
| `monitored` | field | number | Monitored ones |
| `missing_subtitles_items` | field | number | `movie`: movies with at least one missing subtitle |
| `missing_subtitles` | field | number | `movie`: missing subtitles (languages) |
| `subtitles` | field | number | `movie`: subtitle files |
| `ended` | field | number | `show`: ended series |
| `episode_files` | field | number | `show`: episode files |
| `episodes_missing_subtitles` | field | number | `show`: episodes with missing subtitles |

## Varken

Varken's own health, written to every enabled output while the collectors run (never in dry-run, which collects once and stops). Config: `global.selfMetrics` (`enabled`, `intervalSeconds`, default enabled, 60). One snapshot per interval, timestamped with the snapshot time. Counts (`runs`, `errors`, `points`, `writes`, `write_errors`) cover the time since the previous snapshot, so they add up over any period; they restart at zero with Varken. The snapshot's own write is not counted. An output that fails cannot receive its own `Output` point; the other outputs do.

### type = Collector

One point per active collector.

| Key | Kind | Type | Meaning |
|-----|------|------|---------|
| `plugin` | tag | string | Input plugin, as its measurement name (`Sonarr`, `Tautulli`, ...) |
| `server` | tag | number | Input instance `id` |
| `collector` | tag | string | Collector key (`queue`, `history`, ...) |
| `runs` | field | number | Runs since the previous snapshot |
| `errors` | field | number | Failed runs since the previous snapshot |
| `points` | field | number | Points collected since the previous snapshot |
| `duration_seconds` | field | float | Duration of the last run, collection and writes included; omitted before the first run |
| `circuit_state` | field | number | Circuit breaker: `0` closed, `1` half-open, `2` open |
| `consecutive_errors` | field | number | Consecutive failed runs |
| `interval_seconds` | field | float | Current interval, backoff included |
| `last_success_age_seconds` | field | number | Seconds since the last successful run; omitted before the first success |

### type = Output

One point per output. No `server` tag.

| Key | Kind | Type | Meaning |
|-----|------|------|---------|
| `output` | tag | string | Output key (`influxdb2`, `questdb`, ...) |
| `writes` | field | number | Successful writes since the previous snapshot |
| `write_errors` | field | number | Failed writes since the previous snapshot |
| `points` | field | number | Points written since the previous snapshot |

### type = Status

One point per snapshot. No `server` tag.

| Key | Kind | Type | Meaning |
|-----|------|------|---------|
| `version` | tag | string | Varken version |
| `uptime_seconds` | field | number | Seconds since Varken started |
| `collectors` | field | number | Active collectors |
| `collectors_open` | field | number | Collectors whose circuit breaker is open |
| `outputs` | field | number | Active outputs |
