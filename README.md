<p align="center">
  <img src="https://raw.githubusercontent.com/Navino16/Varken/master/assets/varken_full_banner.jpg" alt="Varken" width="800">
</p>

<p align="center">
  <strong>Varken</strong> (Dutch for "PIG" — Plex/InfluxDB/Grafana)<br/>
  Aggregate data from the Plex ecosystem into InfluxDB for beautiful Grafana dashboards.<br/>
  Monitor Sonarr, Radarr, Tautulli, Overseerr, and more — all in one place.
</p>

<p align="center">
  <a href="https://github.com/Navino16/Varken/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/Navino16/Varken/ci.yml?label=CI&style=flat-square" alt="CI"></a>
  <a href="https://github.com/Navino16/Varken/actions/workflows/build.yml"><img src="https://img.shields.io/github/actions/workflow/status/Navino16/Varken/build.yml?label=Build&style=flat-square&logo=docker" alt="Build"></a>
  <a href="https://codecov.io/gh/Navino16/Varken"><img src="https://img.shields.io/codecov/c/github/Navino16/Varken?style=flat-square&label=Coverage" alt="Coverage"></a>
</p>

<p align="center">
  <a href="https://github.com/Navino16/Varken/pkgs/container/varken"><img src="https://img.shields.io/badge/ghcr.io-varken-blue?style=flat-square&logo=docker" alt="Docker"></a>
  <a href="https://discord.gg/XgCBF3sMSh"><img src="https://img.shields.io/discord/1483405134003175607?style=flat-square&logo=discord&label=Discord" alt="Discord"></a>
  <a href="https://github.com/Navino16/Varken"><img src="https://img.shields.io/github/stars/Navino16/Varken?style=flat-square" alt="Stars"></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/Navino16/Varken?style=flat-square" alt="License"></a>
</p>

<p align="center">
  <a href="#installation">Installation</a> &bull;
  <a href="#configuration">Configuration</a> &bull;
  <a href="#supported-services">Services</a> &bull;
  <a href="#contributing">Development</a>
</p>

---

Built with TypeScript, Node.js, and a plugin-based architecture with scheduled data collection.

<p align="center">
  <img src="https://i.imgur.com/3hNZTkC.png" alt="Example Dashboard" width="800">
</p>

## Features

### Data Collection

- **Multiple data sources** — Sonarr, Radarr, Readarr, Lidarr, Prowlarr, Bazarr, Tautulli, Plex, Jellyfin, Emby, Ombi, Overseerr
- **Server info** — version of every connected service, plus available updates, pending restarts, uptime and health issues where the service exposes them
- **Session details** — bandwidth, LAN/WAN, direct play / direct stream / transcode decisions, hardware transcoding, source vs streamed format, device and user for Plex, Jellyfin, Emby and Tautulli streams
- **Media server state** — Plex, Jellyfin and Emby scheduled tasks, plugins, activities, resource use and bandwidth, play / activity history, users and devices, Live TV recordings
- **Servarr insights** — download progress and state, health, disk space, root folders, scheduled tasks, wanted / blocklist totals, history events and library statistics for Sonarr, Radarr, Lidarr and Readarr; indexer status, grabs, per-app stats and inventory for Prowlarr
- **Tautulli statistics** — home stats, play graphs by day, hour, month, stream type, platform and user, recently added items, play history, per-user and per-library watch time, library media info (sizes, resolutions, codecs)
- **Multiple outputs** — InfluxDB 1.x, InfluxDB 2.x, VictoriaMetrics, QuestDB, TimescaleDB
- **Multi-instance support** — connect multiple instances of each service
- **GeoIP mapping** — automatic geolocation of streaming sessions via Tautulli API (no external license required)

### Reliability

- **Circuit breaker** — automatic error recovery with exponential backoff and self-healing
- **Health checks** — built-in HTTP endpoints for monitoring and orchestration
- **Prometheus metrics** — `/metrics` endpoint for collection counts, durations, errors, and circuit breaker state
- **Self-metrics** — the same health written to your database (measurement `Varken`), so Grafana shows it without Prometheus
- **Config hot-reload** — edit `varken.yaml` and have Varken pick up changes without a restart (opt-in via `CONFIG_WATCH=true`)
- **Graceful output skipping** — failed output plugins are skipped at startup; Varken continues with the ones that initialized successfully
- **Easy configuration** — simple YAML config with environment variable overrides

### Deployment

- **Docker ready** — multi-platform images for amd64 and arm64
- **Lightweight** — Node.js Alpine-based image
- **Configurable** — environment variables, YAML, or legacy INI migration

## Supported Services

### Input Plugins

| Service       | Data Collected                            | Status     |
|---------------|-------------------------------------------|------------|
| **Sonarr**    | Queue, calendar (missing/future episodes) | ✅          |
| **Radarr**    | Queue, missing movies                     | ✅          |
| **Readarr**   | Queue, missing eBooks                     | ✅          |
| **Lidarr**    | Queue, missing music                      | ✅          |
| **Tautulli**  | Activity, libraries, statistics, GeoIP    | ✅          |
| **Ombi**      | Requests (movie, TV, music, 4K, fulfilment times), issue counts, per-status totals, user quotas | ✅          |
| **Overseerr** | Request counts, latest requests, filtered totals, jobs and caches, user quotas | ✅          |
| **Prowlarr**  | Indexer statistics                        | ✅          |
| **Bazarr**    | Wanted subtitles, history, providers, tasks, daily statistics, library coverage | ✅          |
| **Plex**      | Sessions, libraries, status, plays, inventory, Live TV | ✅          |
| **Jellyfin**  | Sessions, libraries, item counts, status, activity log, inventory, Live TV | ✅          |
| **Emby**      | Sessions, libraries, item counts, status, activity log, inventory, Live TV | ✅          |

### Output Plugins

| Output                         | Status     |
|--------------------------------|------------|
| **InfluxDB 2.x** (recommended) | ✅          |
| **InfluxDB 1.x** (legacy)      | ✅          |
| **VictoriaMetrics**            | ✅          |
| **QuestDB**                    | ✅          |
| **TimescaleDB**                | ✅          |

## Installation

### Docker Compose (Recommended)

```bash
mkdir varken && cd varken
curl -O https://raw.githubusercontent.com/Navino16/Varken/develop/docker-compose.yml
mkdir config
curl -o config/varken.yaml https://raw.githubusercontent.com/Navino16/Varken/develop/config/varken.example.yaml
```

Edit `config/varken.yaml` with your settings, then:

```bash
docker compose up -d
```

- Grafana: http://localhost:3000 (admin/admin)
- InfluxDB: http://localhost:8086

### Docker

```bash
docker run -d \
  --name varken \
  -v /path/to/config:/config \
  -v /path/to/data:/data \
  -v /path/to/logs:/logs \
  -p 9090:9090 \
  -e TZ=Europe/Paris \
  ghcr.io/navino16/varken:latest
```

> For an in-depth Docker guide, see [docs/deployment/docker.md](docs/deployment/docker.md).

### Manual

```bash
git clone https://github.com/Navino16/Varken.git
cd Varken
npm ci && npm run build
node dist/index.js
```

> For a hardened systemd install, see [docs/deployment/bare-metal.md](docs/deployment/bare-metal.md).

### Dry-Run

Validate your configuration and test plugin connectivity without writing any data to outputs:

```bash
# CLI flag
node dist/index.js --dry-run

# Or via environment variable (useful in Docker)
DRY_RUN=true npm start
```

Varken will load the config, check output connectivity, run each enabled schedule once, log what would be written, and exit.

### Config Hot-Reload

Set `CONFIG_WATCH=true` to have Varken watch `varken.yaml` and apply changes without a process restart. On every save:

1. The file is re-parsed and validated with Zod.
2. If valid, all plugins are shut down cleanly and re-initialized from the new config, then schedulers restart.
3. If invalid, the error is logged and the previous configuration stays active.

The watcher debounces rapid editor writes (500ms) and coalesces overlapping reloads, so you won't get a thundering herd from a single save.

## Configuration

### Basic Example

```yaml
outputs:
  influxdb2:
    url: "http://influxdb:8086"
    token: "your-influxdb-token"
    org: "varken"
    bucket: "varken"

inputs:
  sonarr:
    - id: 1
      url: "http://sonarr:8989"
      apiKey: "your-sonarr-api-key"
      queue:
        enabled: true
        intervalSeconds: 30
      calendar:
        enabled: true
        futureDays: 7
        missingDays: 30
        intervalSeconds: 300

  tautulli:
    - id: 1
      url: "http://tautulli:8181"
      apiKey: "your-tautulli-api-key"
      activity:
        enabled: true
        intervalSeconds: 30
```

Every input also accepts a `serverInfo` collector (disabled by default, every 300s), which writes the service version, update availability, pending restart, uptime and health-issue counts where the service exposes them. See [docs/data-reference.md](docs/data-reference.md) for each service.

```yaml
      serverInfo:
        enabled: true
        intervalSeconds: 300
```

Sonarr, Radarr, Lidarr and Readarr also accept these collectors, all disabled by default:

| Key | Default interval | What it writes |
|-----|------------------|----------------|
| `status` | 300s | Health issues, disk space, root folders, queue status, scheduled tasks |
| `totals` | 900s | Wanted missing / cutoff-unmet and blocklist totals |
| `history` | 300s | One point per history event (grab, import, failure, ...) |
| `library` | 1 day (`intervalDays`) | Library statistics (per series / artist / author, Radarr collections) |

Prowlarr accepts `status` (300s: health, indexer status, tasks), `history` (300s: one point per release grab) and `inventory` (3600s: indexers and applications).

Plex, Jellyfin and Emby also accept these collectors, all disabled by default:

| Key | Default interval | What it writes |
|-----|------------------|----------------|
| `status` | 300s | Scheduled / butler tasks, plugins, activities and background transcodes (Plex), CPU and memory use and hourly bandwidth (Plex), storage (Jellyfin) |
| `history` | 300s | One point per play (Plex) or activity log entry (Jellyfin, Emby) |
| `inventory` | 3600s | Users and devices |
| `liveTv` | 300s | Live TV sessions (Plex), recordings and timers |

Tautulli's `stats` collector writes library counts at its interval, and home stats (top items, users, platforms, most concurrent streams), play graphs and recently added items at most every 5 minutes. Tautulli also accepts these collectors, all disabled by default:

| Key | Default interval | What it writes |
|-----|------------------|----------------|
| `history` | 300s | One point per play |
| `users` | 3600s | Users with plays, last seen and watch time (1, 7, 30 days, all time) |
| `libraryMedia` | 1 day (`intervalDays`) | Per-library plays and watch time, media info (file size, items per resolution and codec) |

Overseerr, Ombi and Bazarr also accept these collectors, all disabled by default:

| Plugin | Key | Default interval | What it writes |
|--------|-----|------------------|----------------|
| Overseerr | `status` | 300s | Jobs (running, time to next run), image, DNS and API caches, request and media totals, appdata state |
| Overseerr | `totals` | 300s | Failed, unavailable and deleted requests; media by availability |
| Overseerr | `users` | 3600s | Requests per user and movie/TV quotas |
| Ombi | `totals` | 300s | Movie, TV and music requests per status; requests of the last 30 days |
| Ombi | `users` | 3600s | Last login and request quotas per user |
| Bazarr | `status` | 300s | Badges (wanted, throttled providers, health, announcements, Sonarr/Radarr SignalR), providers, tasks, job queue, releases behind |
| Bazarr | `stats` | 3600s | Subtitles downloaded per day, languages |
| Bazarr | `library` | 1 day (`intervalDays`) | Movie and series subtitle coverage |

### Output Configuration

Varken supports multiple output backends. You can configure one or several simultaneously — each data point is written to every configured output.

```yaml
outputs:
  # InfluxDB 2.x (recommended)
  influxdb2:
    url: "http://influxdb:8086"
    token: "your-token"
    org: "varken"
    bucket: "varken"

  # InfluxDB 1.x (legacy)
  influxdb1:
    url: "http://influxdb:8086"
    username: "root"
    password: "root"
    database: "varken"

  # VictoriaMetrics (InfluxDB line protocol compatible)
  victoriametrics:
    url: "http://victoriametrics:8428"

  # QuestDB (ILP over HTTP on port 9000)
  questdb:
    url: "http://questdb:9000"

  # TimescaleDB (PostgreSQL with hypertables)
  timescaledb:
    host: "timescaledb"
    port: 5432
    database: "varken"
    username: "varken"
    password: "varken"
```

> **TimescaleDB schema:** Varken creates a single `varken_events` hypertable on first run. Columns: `time TIMESTAMPTZ`, `measurement TEXT`, `tags JSONB`, `fields JSONB`. Query in Grafana with `tags->>'server'` / `(fields->>'queue_size')::int`. If the TimescaleDB extension isn't installed, the plugin falls back to a plain PostgreSQL table (logs a warning).

> **VictoriaMetrics label limit:** Tautulli sessions carry 45 tags, over VictoriaMetrics' default of 40 labels per series, and VictoriaMetrics drops such series without an error. Start it with `-maxLabelsPerTimeseries=64`.

#### Grafana datasource per output

The generated dashboards query the database Varken writes to, through one Grafana datasource of this type:

| Output | Grafana datasource | Settings |
|--------|--------------------|----------|
| InfluxDB 1.x | InfluxDB, query language **InfluxQL** | URL, database, user and password |
| InfluxDB 2.x | InfluxDB, query language **Flux** | URL, organization, **default bucket** (the dashboards read it) and token |
| VictoriaMetrics | Prometheus | URL of VictoriaMetrics (`http://victoriametrics:8428`) |
| QuestDB | PostgreSQL | Host `questdb:8812` (PostgreSQL wire protocol), database `qdb`, user `admin`, password `quest` by default, TLS disabled |
| TimescaleDB | PostgreSQL, **TimescaleDB** toggle on | Host, database, user and password of the Varken output |

String fields do not exist in VictoriaMetrics, so its dashboards leave out what only strings carry: the panels listing titles (recently added, latest requests, calendar, most watched), the *arr and Prowlarr health messages, and the plays of Plex, Jellyfin and Emby (their play points hold only strings; Tautulli plays still count). QuestDB creates a table the first time a measurement is written and a column the first time a point carries it: until then, a panel reading it shows an error.

See [`config/varken.example.yaml`](config/varken.example.yaml) for the complete list of supported options.

### Global Settings

Varken provides global configuration options for tuning timeouts and pagination. All settings have sensible defaults and are optional:

```yaml
global:
  httpTimeoutMs: 30000
  healthCheckTimeoutMs: 5000
  collectorTimeoutMs: 60000
  paginationPageSize: 250
  maxPaginationRecords: 10000
  cacheTtlSeconds: 0
  selfMetrics:
    enabled: true
    intervalSeconds: 60
```

| Setting                       | Default | Description                                                      |
|-------------------------------|---------|------------------------------------------------------------------|
| `httpTimeoutMs`               | 30000   | Timeout for HTTP requests to services                            |
| `healthCheckTimeoutMs`        | 5000    | Timeout for health check requests                                |
| `collectorTimeoutMs`          | 60000   | Timeout for collector execution                                  |
| `paginationPageSize`          | 250     | Records per page for paginated APIs                              |
| `maxPaginationRecords`        | 10000   | Maximum records to fetch (safety limit)                          |
| `cacheTtlSeconds`             | 0       | TTL (seconds) for the HTTP GET cache; 0 = dedup only, no caching |
| `selfMetrics.enabled`         | true    | Write Varken's own health (measurement `Varken`) to the outputs  |
| `selfMetrics.intervalSeconds` | 60      | Seconds between two health snapshots (minimum 10)                |

> **Note:** `cacheTtlSeconds > 0` caches **all** GET responses, including real-time endpoints (Tautulli activity, *arr queues). A stored response is reused until the TTL expires, so set this well below your shortest poll interval — otherwise those metrics freeze between refreshes. Leave it at `0` unless you have a specific reason; concurrent-request deduplication is always on regardless.

### Environment Variables

#### Docker Environment Variables

| Variable         | Default   | Description                                         |
|------------------|-----------|-----------------------------------------------------|
| `CONFIG_FOLDER`  | `/config` | Path to configuration files                         |
| `DATA_FOLDER`    | `/data`   | Path to data storage (history collectors keep their position in `event-state/`; deleting it makes them restart from "now") |
| `LOG_FOLDER`     | `/logs`   | Path to log files                                   |
| `LOG_LEVEL`      | `info`    | Log level: `error`, `warn`, `info`, `debug`         |
| `LOG_FORMAT`     | `text`    | Console log format: `text` (human) or `json` (structured) |
| `TZ`             | `UTC`     | Timezone (e.g., `Europe/Paris`, `America/New_York`) |
| `HEALTH_PORT`    | `9090`    | Port for the health check HTTP server               |
| `HEALTH_ENABLED` | `true`    | Enable/disable the health check server              |
| `METRICS_ENABLED`| `true`    | Enable/disable the Prometheus `/metrics` endpoint   |
| `CONFIG_WATCH`   | `false`   | Watch `varken.yaml` and hot-reload on changes       |
| `DRY_RUN`        | `false`   | Run once without writing (equivalent to `--dry-run`) |

#### Configuration Overrides

You can override any configuration value using environment variables:

```bash
# Format: VARKEN_<SECTION>_<KEY>=value
VARKEN_OUTPUTS_INFLUXDB2_URL="http://influxdb:8086"
VARKEN_OUTPUTS_INFLUXDB2_TOKEN="my-secret-token"

# For array items, use numeric index
VARKEN_INPUTS_SONARR_0_APIKEY="secret-api-key"
VARKEN_INPUTS_SONARR_0_URL="http://sonarr:8989"
```

### GeoIP Setup

The Tautulli API handles GeoIP geolocation directly — no external license or database download required.

```yaml
inputs:
  tautulli:
    - id: 1
      url: "http://tautulli:8181"
      apiKey: "your-api-key"
      geoip:
        enabled: true
        localCoordinates:
          latitude: 48.8566
          longitude: 2.3522
```

**How it works:**
- **Remote streams**: Varken calls Tautulli's `get_geoip_lookup` API to get location data
- **Local streams** (LAN): Automatically detected and labeled as "Local Network"
- **localCoordinates** (optional): Custom coordinates to display for local streams on world maps

> **Note**: If upgrading from a previous version with `licenseKey` or `fallbackIp`, these options are now deprecated and will be ignored with a warning.

### Multiple Instances

You can monitor multiple instances of the same service:

```yaml
inputs:
  sonarr:
    - id: 1
      url: "http://sonarr-tv:8989"
      apiKey: "api-key-1"
      queue:
        enabled: true
        intervalSeconds: 30

    - id: 2
      url: "http://sonarr-anime:8989"
      apiKey: "api-key-2"
      queue:
        enabled: true
        intervalSeconds: 30
```

Each instance must have a unique `id`.

### Circuit Breaker

Varken includes a built-in circuit breaker to handle failing services gracefully. When a scheduler encounters repeated errors, the circuit breaker:

1. **Applies backoff** — increases the interval between retries (exponential backoff)
2. **Opens the circuit** — temporarily disables the failing scheduler after too many errors
3. **Attempts recovery** — after a cooldown period, tests if the service has recovered
4. **Closes the circuit** — returns to normal operation after successful recovery

#### Configuration

```yaml
circuitBreaker:
  maxConsecutiveErrors: 10    # Errors before disabling scheduler
  backoffMultiplier: 2        # Interval multiplier per failure (30s → 60s → 120s...)
  maxIntervalSeconds: 600     # Maximum interval cap (10 min)
  cooldownSeconds: 300        # Cooldown before recovery attempt (5 min)
  recoverySuccesses: 3        # Successes needed to fully recover
```

#### State Machine

```
CLOSED (normal) ──[errors]──► OPEN (disabled)
                                    │
                              [cooldown]
                                    │
                                    ▼
                              HALF-OPEN (testing)
                                    │
                    ┌───────────────┼───────────────┐
                    │               │               │
              [success x N]    [failure]      [success]
                    │               │               │
                    ▼               ▼               │
                 CLOSED          OPEN              │
                                    ▲               │
                                    └───────────────┘
```

#### Monitoring

Circuit breaker states are visible in the `/status` endpoint:

```json
{
  "schedulers": [
    {
      "name": "sonarr_1_queue",
      "circuitState": "closed",
      "currentIntervalSeconds": 30,
      "consecutiveErrors": 0,
      "recoverySuccesses": 0,
      "nextRunAt": "2024-01-15T10:30:30.000Z"
    }
  ]
}
```

When a circuit is open:

```json
{
  "schedulers": [
    {
      "name": "sonarr_1_queue",
      "circuitState": "open",
      "currentIntervalSeconds": 120,
      "consecutiveErrors": 10,
      "disabledAt": "2024-01-15T10:30:00.000Z",
      "nextAttemptAt": "2024-01-15T10:35:00.000Z",
      "nextRunAt": "2024-01-15T10:35:00.000Z"
    }
  ]
}
```

## Health Checks

Varken exposes HTTP endpoints for monitoring on port `9090` (configurable via `HEALTH_PORT`):

| Endpoint              | Description                                        |
|-----------------------|----------------------------------------------------|
| `GET /health`         | Overall status: `healthy`, `degraded`, `unhealthy` |
| `GET /health/plugins` | Per-plugin health status (inputs and outputs)      |
| `GET /status`         | Detailed status with scheduler information         |
| `GET /metrics`        | Prometheus scrape endpoint (see below)             |

The Docker image includes a built-in `HEALTHCHECK` instruction using these endpoints.

### HTTP Response Codes

| Status      | HTTP Code |
|-------------|-----------|
| `healthy`   | 200       |
| `degraded`  | 200       |
| `unhealthy` | 503       |

### Status Calculation

| Status      | Condition                                                                                   |
|-------------|---------------------------------------------------------------------------------------------|
| `healthy`   | All outputs healthy + all inputs healthy + all schedulers in `closed` state with < 3 errors |
| `degraded`  | At least one output healthy + at least one scheduler not in `open` state                    |
| `unhealthy` | No outputs configured, all outputs unreachable, or all schedulers in `open` state           |

## Prometheus Metrics

Varken exposes a Prometheus scrape endpoint at `GET /metrics` on the same port as the health server (default `9090`). Disable with `METRICS_ENABLED=false`.

### Exposed Metrics

| Metric                               | Type      | Labels              | Description                                            |
|--------------------------------------|-----------|---------------------|--------------------------------------------------------|
| `varken_collections_total`           | counter   | scheduler, status   | Scheduled collector runs (status: success / failure)   |
| `varken_collection_duration_seconds` | histogram | scheduler           | Collector run duration                                 |
| `varken_data_points_collected_total` | counter   | scheduler           | Data points produced by collectors                     |
| `varken_data_points_written_total`   | counter   | output, status      | Data points written to outputs (status / failure)      |
| `varken_scheduler_errors_total`      | counter   | scheduler           | Total scheduler errors                                 |
| `varken_circuit_breaker_state`       | gauge     | scheduler           | Circuit breaker state (0=closed, 1=half-open, 2=open)  |
| `varken_active_plugins`              | gauge     | kind                | Active plugin count by kind (input / output)           |

Default Node.js process metrics (`process_cpu_*`, `nodejs_heap_*`, event loop lag, GC stats) are also exposed.

### Prometheus Scrape Config

```yaml
scrape_configs:
  - job_name: varken
    static_configs:
      - targets: ['varken:9090']
```

## Grafana Setup

### Adding InfluxDB Data Source

1. Go to **Configuration > Data Sources > Add data source**
2. Select **InfluxDB**
3. Configure:
   - **Query Language**: Flux (for InfluxDB 2.x) or InfluxQL (for 1.x)
   - **URL**: `http://influxdb:8086`
   - **Organization**: `varken` (InfluxDB 2.x only)
   - **Token**: Your InfluxDB token (InfluxDB 2.x only)
   - **Default Bucket**: `varken`

### Importing Dashboard

1. Go to **Dashboards > Import**
2. Upload `assets/grafana-dashboard.json` from this repository
3. Select your InfluxDB data source
4. Click **Import**

Or find community dashboards on [Grafana.com](https://grafana.com/grafana/dashboards/).

### Data Reference

Every measurement, tag and field Varken writes, per input plugin, is listed in [docs/data-reference.md](docs/data-reference.md).

## Data changes after 2.4.0

A few keys were wrong or could not be graphed. They were fixed in a way that breaks dashboards built on them: update those panels after upgrading. Keys whose type changed were renamed, so old queries return no data instead of failing writes.

| Plugin | Before | After |
|--------|--------|-------|
| Plex | field `transcode_streams` counted every session with a transcode session, direct streams included | counts only sessions whose video or audio is transcoded |
| Jellyfin, Emby | tag `audio_codec` = transcoded codec, `unknown` on direct play | source audio codec of the played track |
| Jellyfin, Emby | field `transcode_streams` counted remuxes | counts only sessions whose video or audio is transcoded |
| Tautulli | tags `progress_percent`, `latitude`, `longitude` | numeric fields `progress`, `lat`, `lon` (no coordinates when GeoIP has none) |
| Bazarr | string field `score` (`"92.5%"`) | numeric field `score_percent` (`92.5`) |
| Overseerr | tag `status` = media availability; `requested_user` / `requested_date` from the title's first request | tag `status` = request status, new tag `media_status` = media availability; `requested_user` / `requested_date` from the request itself |
| Tautulli, Jellyfin, Emby | tag `media_type`: Tautulli sessions title-cased (`Movie`), Jellyfin/Emby the media kind (`Video`) | lowercase shared vocabulary (`movie`, `episode`, `track`, ...); Tautulli live TV is `live` |
| Ombi, Overseerr | tag `media_type`: Ombi `tv` / `music`, Overseerr `tv` | `show` / `album`; Ombi `Requests` points gain the `media_type` tag |
| Bazarr | tag `mediaType` (`movie` / `episode` / `series`); `Library` tag `media_type` `series` | tag `media_type`: `movie` / `episode` (`Wanted`, `History`), `movie` / `show` (`Library`) |

The full current schema is in [docs/data-reference.md](docs/data-reference.md).

## Migration from Python Version

If you're upgrading from the legacy Python version of Varken:

1. **Keep your old `varken.ini`** in the config folder
2. **Start Varken** — it will automatically detect and migrate your configuration
3. **Review the generated `varken.yaml`** and make any necessary adjustments
4. **Remove `varken.ini`** once you've verified everything works

Legacy `VRKN_*` environment variables are also automatically migrated.

## Troubleshooting

> Full symptom-based guide: [docs/deployment/troubleshooting.md](docs/deployment/troubleshooting.md).

Error messages are annotated with actionable hints where possible. Look for the `Hint:` section on `ERROR` lines in the logs — connection refused, timeout, wrong API key, wrong API path (404), rate limit, and TLS cert failures all have tailored suggestions.

### Common Issues

**Varken fails at startup with "Environment validation failed":**
- Varken validates all environment variables and directory permissions on startup
- Check `HEALTH_PORT` is a valid TCP port (1-65535)
- Check `HEALTH_ENABLED`, `DRY_RUN` are set to `true` or `false` only
- Check `LOG_LEVEL` is one of `error`, `warn`, `info`, `http`, `verbose`, `debug`, `silly`
- Verify the process can read `CONFIG_FOLDER` and write to `DATA_FOLDER` / `LOG_FOLDER`

**Varken can't connect to services:**
- Verify URLs are accessible from the Varken container
- Check API keys are correct
- Input plugin URLs must include the protocol (`http://` or `https://`), e.g. `url: "https://sonarr.example.com"`
- Ensure `verifySsl: false` if using self-signed certificates

**No data in Grafana:**
- Check Varken logs: `docker logs varken`
- Verify InfluxDB connection settings
- Ensure at least one input is enabled with `enabled: true`

**GeoIP not working:**
- Ensure `geoip.enabled: true` is set in your Tautulli configuration
- Verify Tautulli is accessible and the API key is correct
- Check Varken logs for GeoIP lookup errors

### Viewing Logs

```bash
# Docker
docker logs -f varken

# Manual installation
tail -f logs/combined.log
```

### Log Levels

Set `LOG_LEVEL` environment variable:
- `error` — Errors only
- `warn` — Warnings and errors
- `info` — General information (default)
- `debug` — Detailed debugging information

## Contributing

```bash
git clone https://github.com/Navino16/Varken.git
cd Varken
npm install
npm run dev        # Dev server with auto-reload
npm test -- --run  # Run tests
npm run lint       # Lint code
npm run build      # Build for production
```

### Project Structure

```
src/
├── core/           # Orchestrator, PluginManager, Logger
├── config/         # Configuration loading and validation
├── plugins/
│   ├── inputs/     # Data source plugins (Sonarr, Radarr, etc.)
│   └── outputs/    # Database plugins (InfluxDB, etc.)
├── types/          # TypeScript type definitions
└── utils/          # Utilities (HTTP, hashing)
```

### Adding a New Input Plugin

1. Pin the service's API spec in `tests/contracts/specs/` (entry in `manifest.json`) and generate its response types: `npm run contracts:types <service>`
2. Add the config type in `src/types/inputs/` and its Zod schema in `src/config/schemas/config.schema.ts`
3. Create the plugin in `src/plugins/inputs/`, calling its API through `this.api<paths>()`
4. Register it in `src/plugins/inputs/index.ts`
5. Register each called endpoint with a fixture in `tests/contracts/registry.ts` and write the tests in `tests/plugins/inputs/` with `createContractHttpClient` (see [Contract tests](#contract-tests))

### Integration tests

A separate `npm run test:integration` target runs end-to-end tests against real services. Start the databases first: InfluxDB 1.x (port 8086), InfluxDB 2.x (8087), VictoriaMetrics (8428), QuestDB (9000) and TimescaleDB (5433):

```bash
docker compose -f docker-compose.test.yaml --profile databases up -d --wait
npm run test:integration
```

Tests skip themselves automatically when a service isn't reachable, so the command is safe to run with or without containers up. Unit tests (`npm test`) are hermetic and never touch the integration folder.

### Demo dataset

`npm run demo:seed` fills those databases with 30 days of plausible data, for dashboard work and screenshots. The data comes from the real input plugins running on the contract fixtures under a simulated clock, and is written by the real output plugins, so it has the exact shape production writes. Every input plugin is enabled, and Readarr is unreachable for a few hours the day before the end so health panels have something to show.

| Variable | Default | Effect |
|----------|---------|--------|
| `DEMO_OUTPUTS` | all five | Comma-separated output types to fill (`influxdb1,influxdb2,victoriametrics,questdb,timescaledb`) |
| `DEMO_DAYS` | `30` | Length of the window, ending now |
| `DEMO_STEP_SECONDS` | `600` | Simulated time between two collection rounds |

The command stops before writing anything if one of the selected databases is down. Every seed, and every `npm run test:integration` run, adds points on top of what the databases already hold (the window always ends now, so runs overlap). For a clean demo, reset first with `docker compose -f docker-compose.test.yaml --profile databases down -v`, which deletes the database and Grafana volumes and keeps those of the test media services. On an empty volume InfluxDB 2.x can fail its first setup and restart; if `up --wait` reports it unhealthy, run it again.

### Contract tests

Input plugins migrated to contract tests (Radarr, Bazarr, Sonarr, Lidarr, Readarr, Prowlarr, Ombi, Overseerr, Plex, Jellyfin, Emby and Tautulli) never hand-write API responses in their tests. Each endpoint such a plugin calls is registered in `tests/contracts/registry.ts` with a JSON fixture (`tests/fixtures/api/<service>/`), and `npm test` checks that:

- the path exists in the service's pinned API spec (`tests/contracts/specs/`, see `manifest.json` for sources and versions);
- every fixture, and every variant a test builds from it, validates against the spec's response schema, with unknown properties rejected;
- the response types in `src/types/generated/` match the pinned spec, so plugins can only read fields the API declares;
- the query parameters and per-call headers actually sent (including pagination) are declared by the spec, with the right types.

Migrated plugins call their API through `this.api<paths>()` (or `this.api<paths>('/api')` when the spec's paths are relative to a base path, as Bazarr's are; `'/api/v1'` for Seerr), typed from the same generated `paths`: an unknown endpoint, an unknown or mistyped parameter, a missing path parameter or an undeclared response field fails `tsc`. `npm run typecheck` (run in CI) also checks `tests/types/`, which pins those compile-time guarantees.

Specs the upstream gets wrong or leaves incomplete are corrected with justified patches in `tests/contracts/overlays/<service>.json`, each linking its evidence. Bazarr publishes no static spec: its Swagger 2.0 document is captured from a running instance (served at `/api/swagger.json`), upgraded to OpenAPI 3.0 when loaded, and its response schemas, which the runtime spec omits, live in the overlay with links to the Bazarr models they come from. Readarr is archived upstream: its spec is pinned on its last release and is not refreshed. Ombi's spec is captured the same way from a running instance (`/swagger/v1/swagger.json`). The Overseerr plugin is checked against the spec of Seerr, Overseerr's successor, pinned as published (YAML, `seerr-api.yml`); its paths are relative to `/api/v1`. Plex's spec is extracted from its developer page (OpenAPI 3.1 embedded in `https://developer.plex.tv/pms/`); Plex paginates with request headers, which typed calls send as `{ header: { 'X-Plex-Container-Size': 0 } }`. Query parameters are serialized the OpenAPI default way (`form`, exploded): arrays repeat their key and an object parameter such as Plex's `mediaQuery` spreads its entries, so `{ query: { mediaQuery: { type: 4, 'addedAt>>': '-7d' } } }` is sent as `type=4&addedAt>>=-7d`. Emby's spec is captured from a running server (`/emby/openapi.json`, paths relative to `/emby`). Tautulli publishes no spec: its contract (`tautulli.json`, OpenAPI 3.1) is hand-written from the `@addtoapi` docstrings of `plexpy/webserve.py`, which generate its API reference, and checked against its source, linked from each corrected schema. Every command is its own spec path with a fixed query string (`/api/v2?cmd=get_activity`), so each command gets its own parameter and response types. Overlays can also override how a string format is validated for one service (`formats`), e.g. Jellyfin's GUIDs, serialized without dashes. After changing a spec or an overlay, regenerate the types:

```bash
npm run contracts:types radarr
```

#### Refreshing the pinned specs

`npm run contracts:update` (optionally followed by service names) downloads each spec again from the source recorded in `manifest.json`: the published file at the latest GitHub release (Radarr, Sonarr, Lidarr, Prowlarr, Seerr), the published URL (Jellyfin), the developer page (Plex), or a container of the latest image started for the capture (Bazarr, Ombi, Emby; needs Docker). Specs not downloaded as files are stored as sorted JSON, so an unchanged upstream produces no diff. Tautulli's contract is hand-written: the script refreshes the snapshot of the documented commands (`tautulli.docstrings.json`) and asks for a manual review when it changes. Readarr is archived and skipped. The report also lists overlay patches the upstream spec now covers, and types are regenerated when a contract changes.

The `Contracts refresh` workflow also runs on every pull request to `develop` or `main`, read-only: it refreshes the specs against upstream and, when they changed, checks that the pull request's code still compiles and passes the tests with them; a source that cannot be refreshed fails the check. On its weekly schedule it runs every Monday on `develop`. When something changed, it runs `tsc`, the type tests and the test suite, and opens (or updates) a pull request from `contracts/refresh` labelled `dependencies`, with the report and the verification result in its body, since pull requests opened by GitHub Actions do not trigger CI. A run with failures and nothing to commit fails, so the failure is notified. Specs whose content did not change keep their pinned version, so image rebuilds and releases without API change open nothing. When the report asks for a manual review (Tautulli), push the contract update to the `contracts/refresh` branch: the workflow then only comments on the pull request instead of overwriting it. The required checks do not run on a pull request opened by GitHub Actions: close and reopen it to trigger CI before merging. The schedule only runs once the workflow is on the default branch (`main`).

### Pull Request Guidelines

- Fork the repository and create a feature branch
- Write tests for new functionality
- Ensure all tests pass: `npm test -- --run`
- Ensure code passes linting: `npm run lint`
- Update documentation if needed
- Submit a pull request to the `develop` branch

## Support

- **GitHub Issues**: [Bug reports and feature requests](https://github.com/Navino16/Varken/issues)
- **Discord**: [Join the community](https://discord.gg/XgCBF3sMSh)

## License

[MIT License](LICENSE)
