# Varken Migration Plan: Python → Node.js/TypeScript

## Goals

1. **Migrate to Node.js/TypeScript** - Complete rewrite in TypeScript
2. **Modular architecture** - Plugins for data sources (inputs) and destinations (outputs)
3. **Multi-output support** - Support multiple backends (InfluxDB, VictoriaMetrics, etc.)

---

## Proposed Architecture

```
varken-ts/
├── src/
│   ├── index.ts                    # Entry point
│   ├── config/
│   │   ├── ConfigLoader.ts         # YAML parsing + env vars override
│   │   ├── ConfigMigrator.ts       # INI/env → YAML migration
│   │   └── schemas/                # Zod validation schemas
│   ├── core/
│   │   ├── Orchestrator.ts         # Main coordinator
│   │   ├── PluginManager.ts        # Plugin management
│   │   └── Logger.ts               # Winston logging
│   ├── plugins/
│   │   ├── inputs/                 # Data source plugins
│   │   │   ├── BaseInputPlugin.ts
│   │   │   ├── SonarrPlugin.ts
│   │   │   ├── RadarrPlugin.ts
│   │   │   ├── ReadarrPlugin.ts
│   │   │   ├── TautulliPlugin.ts
│   │   │   ├── LidarrPlugin.ts
│   │   │   ├── OmbiPlugin.ts
│   │   │   ├── OverseerrPlugin.ts
│   │   │   ├── BazarrPlugin.ts
│   │   │   ├── JellyfinPlugin.ts
│   │   │   ├── EmbyPlugin.ts
│   │   │   ├── PlexPlugin.ts
│   │   │   └── ProwlarrPlugin.ts
│   │   └── outputs/                # Destination plugins
│   │       ├── BaseOutputPlugin.ts
│   │       ├── InfluxDB1Plugin.ts
│   │       ├── InfluxDB2Plugin.ts
│   │       ├── VictoriaMetricsPlugin.ts
│   │       ├── QuestDBPlugin.ts
│   │       └── TimescaleDBPlugin.ts
│   ├── types/
│   │   ├── plugin.types.ts         # Plugin interfaces
│   │   ├── config.types.ts         # Configuration types
│   │   └── [service].types.ts      # Per-service types
│   └── utils/
│       ├── http.ts                 # Axios HTTP client
│       ├── hash.ts                 # SHA-256 for deterministic IDs
│       └── geoip.ts                # GeoIP handler
├── config/
│   └── varken.example.yaml
├── package.json
├── tsconfig.json
└── vitest.config.ts
```

---

## Plugin Interfaces

### Input Plugin Interface (Data Source)

```typescript
interface InputPlugin {
  metadata: PluginMetadata;
  initialize(config: unknown): Promise<void>;
  collect(): Promise<DataPoint[]>;
  getSchedules(): ScheduleConfig[];
  shutdown(): Promise<void>;
}
```

### Output Plugin Interface (Destination)

```typescript
interface OutputPlugin {
  metadata: PluginMetadata;
  initialize(config: unknown): Promise<void>;
  write(points: DataPoint[]): Promise<void>;
  healthCheck(): Promise<boolean>;
  shutdown(): Promise<void>;
}
```

### Universal DataPoint Format

```typescript
interface DataPoint {
  measurement: string;
  tags: Record<string, string | number>;
  fields: Record<string, string | number | boolean>;
  timestamp: Date;
}
```

---

## npm Dependencies

```json
{
  "dependencies": {
    "axios": "^1.7.0",
    "yaml": "^2.6.0",
    "ini": "^5.0.0",
    "influx": "^5.9.0",
    "@influxdata/influxdb-client": "^1.35.0",
    "pg": "^8.13.0",
    "@maxmind/geoip2-node": "^5.0.0",
    "winston": "^3.17.0",
    "zod": "^3.24.0"
  },
  "devDependencies": {
    "typescript": "^5.7.0",
    "@types/node": "^22.0.0",
    "@types/ini": "^4.1.0",
    "@types/pg": "^8.11.0",
    "tsx": "^4.19.0",
    "vitest": "^2.1.0",
    "eslint": "^9.0.0",
    "@typescript-eslint/eslint-plugin": "^8.0.0",
    "@typescript-eslint/parser": "^8.0.0"
  }
}
```

### Dependencies by Output

| Output | npm Package | Notes |
|--------|-------------|-------|
| InfluxDB 1.x | `influx` | Legacy client |
| InfluxDB 2.x | `@influxdata/influxdb-client` | Official v2 client |
| VictoriaMetrics | `axios` | InfluxDB line protocol compatible via HTTP |
| QuestDB | `axios` | ILP via HTTP or native TCP |
| TimescaleDB | `pg` | Standard PostgreSQL driver |

---

## Implementation Phases

### Phase 1: Foundation
- [ ] Initialize Node.js/TypeScript project
- [ ] Configure ESLint, tsconfig.json
- [ ] Create folder structure
- [ ] Define all TypeScript types (from `structures.py`)
- [ ] Implement `ConfigLoader` (YAML parsing + env vars override)
- [ ] Implement `ConfigMigrator` (INI/env → YAML migration)
- [ ] Implement Winston logging system

### Phase 2: Plugin Infrastructure
- [ ] Define `InputPlugin` and `OutputPlugin` interfaces
- [ ] Implement `BaseInputPlugin` (HTTP client, helpers)
- [ ] Implement `BaseOutputPlugin`
- [ ] Implement `PluginManager` (registration, scheduling)
- [ ] Implement `Orchestrator` (coordination, graceful shutdown)

### Phase 3: Output Plugins (Destinations)

#### InfluxDB
- [ ] `InfluxDB1Plugin` - InfluxDB v1.x support (legacy API)
- [ ] `InfluxDB2Plugin` - InfluxDB v2.x support (Flux, buckets, tokens)

#### VictoriaMetrics
- [ ] `VictoriaMetricsPlugin` - InfluxDB line protocol compatible
- [ ] Remote write API support

#### QuestDB
- [ ] `QuestDBPlugin` - InfluxDB line protocol (ILP) support
- [ ] PostgreSQL wire protocol support (optional)

#### TimescaleDB
- [ ] `TimescaleDBPlugin` - PostgreSQL with hypertables
- [ ] Auto-create tables and hypertables
- [ ] DataPoint → SQL INSERT mapping

### Phase 4: Input Plugins (Data Sources)

#### Arr Stack (Sonarr/Radarr-like APIs)
- [ ] `SonarrPlugin` - queue, calendar (missing/future)
- [ ] `RadarrPlugin` - queue, missing
- [ ] `ReadarrPlugin` - queue, missing (eBooks)
- [ ] `LidarrPlugin` - queue, missing
- [ ] `ProwlarrPlugin` - indexer stats, search stats
- [ ] `BazarrPlugin` - wanted subtitles, history

#### Media Servers
- [ ] `TautulliPlugin` - activity, libraries, stats + GeoIP
- [ ] `PlexPlugin` - sessions, libraries, activity (direct API)
- [ ] `JellyfinPlugin` - sessions, libraries, activity
- [ ] `EmbyPlugin` - sessions, libraries, activity

#### Request Management
- [ ] `OmbiPlugin` - requests
- [ ] `OverseerrPlugin` - requests


### Phase 5: Utilities
- [ ] GeoIP Handler (MaxMind)
- [ ] HTTP utilities (retry, error handling)
- [ ] SHA-256 hash (deterministic unique ID generation)

### Phase 6: Finalization
- [ ] Main entry point (`index.ts`)
- [ ] Dockerfile
- [ ] docker-compose.yml
- [ ] Unit and integration tests
- [ ] Documentation

---

## Input Plugins - Details

| Plugin | API | Collected Data |
|--------|-----|----------------|
| **Sonarr** | /api/v3 | Queue, Calendar (missing/future), System status |
| **Radarr** | /api/v3 | Queue, Missing, System status |
| **Readarr** | /api/v1 | Queue, Missing, System status |
| **Lidarr** | /api/v1 | Queue, Missing, System status |
| **Prowlarr** | /api/v1 | Indexer stats, Search history |
| **Bazarr** | /api | Wanted subtitles, History, System health |
| **Tautulli** | /api/v2 | Activity, Libraries, Stats, Watch history + GeoIP |
| **Plex** | /api | Sessions, Libraries, Activity (direct API) |
| **Jellyfin** | /api | Sessions, Libraries, Activity, System info |
| **Emby** | /emby/api | Sessions, Libraries, Activity, System info |
| **Ombi** | /api/v1 | Movie/TV requests, Issue counts |
| **Overseerr** | /api/v1 | Requests, Media stats |

---

## Configuration

### YAML Format

```yaml
# varken.yaml
outputs:
  influxdb2:
    url: "http://localhost:8086"
    token: "my-token"
    org: "varken"
    bucket: "varken"

inputs:
  sonarr:
    - id: 1
      url: "http://localhost:8989"
      apiKey: "xxx"
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
      url: "http://localhost:8181"
      apiKey: "xxx"
      geoip:
        enabled: true
        licenseKey: "xxx"
```

### Automatic Migration on Startup

On startup, if `varken.yaml` doesn't exist:
1. Detect if `varken.ini` exists (legacy format)
2. Detect `VRKN_*` environment variables
3. Generate `varken.yaml` by merging: template + INI + ENV
4. Display migration message

```
[INFO] varken.yaml not found
[INFO] Found legacy varken.ini - migrating...
[INFO] Found VRKN_* environment variables - merging...
[INFO] Generated varken.yaml - please review and restart
```

### Environment Variable Override

```bash
# Format: VARKEN_<SECTION>_<KEY> (uppercase, underscore)
VARKEN_OUTPUTS_INFLUXDB2_URL="http://influx:8086"
VARKEN_INPUTS_SONARR_0_APIKEY="secret"
```

---

## Backward Compatibility

- **InfluxDB measurement names** unchanged
- **Tags and fields** unchanged
- → Existing Grafana dashboards will work without modification
- **Automatic migration**: INI/ENV → YAML on first launch

---

## Output Plugins - Details

| Plugin | Protocol | Description |
|--------|----------|-------------|
| **InfluxDB1Plugin** | HTTP API v1 | InfluxDB 1.x - Legacy, InfluxQL |
| **InfluxDB2Plugin** | HTTP API v2 | InfluxDB 2.x - Flux, Buckets, Tokens |
| **VictoriaMetricsPlugin** | InfluxDB line protocol | InfluxDB compatible, high performance |
| **QuestDBPlugin** | ILP over TCP/HTTP | Time-series SQL, very fast ingestion |
| **TimescaleDBPlugin** | PostgreSQL | Hypertables, standard SQL, extensions |

### Protocol Compatibility

```
DataPoint (internal format)
    │
    ├──→ InfluxDB Line Protocol ──→ InfluxDB 1.x
    │                            ──→ InfluxDB 2.x
    │                            ──→ VictoriaMetrics
    │                            ──→ QuestDB (ILP)
    │
    └──→ SQL INSERT ──→ TimescaleDB (PostgreSQL)
```

### Possible Future Outputs

| Output | Description |
|--------|-------------|
| Prometheus | `/metrics` scrape endpoint |
| MQTT | Home automation integration |
| Webhook | HTTP notifications |
| Loki | Centralized logs |
| ClickHouse | OLAP analytics |

---

## Possible Future Inputs

| Input | Description |
|-------|-------------|
| qBittorrent | Torrent client |
| SABnzbd | Usenet client |
| Deluge | Torrent client |
| NZBGet | Usenet client |
| Transmission | Torrent client |
