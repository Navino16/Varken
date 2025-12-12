# Varken Migration Plan: Python → Node.js/TypeScript

## Goals

1. **Migrate to Node.js/TypeScript** - Complete rewrite in TypeScript
2. **Modular architecture** - Plugins for data sources (inputs) and destinations (outputs)
3. **Multi-output support** - Support multiple backends (InfluxDB, VictoriaMetrics, etc.)

---

## Current Architecture

```
varken/
├── src/
│   ├── index.ts                     # Entry point
│   ├── config/
│   │   ├── ConfigLoader.ts          # YAML parsing + env vars override
│   │   ├── ConfigMigrator.ts        # INI/env → YAML migration
│   │   ├── index.ts
│   │   └── schemas/
│   │       └── config.schema.ts     # Zod validation schemas
│   ├── core/
│   │   ├── Logger.ts                # Winston logging with sensitive data filtering
│   │   ├── Orchestrator.ts          # Application lifecycle, graceful shutdown
│   │   └── PluginManager.ts         # Plugin registration, scheduling, data routing
│   ├── plugins/
│   │   ├── inputs/                  # Data source plugins
│   │   │   ├── BaseInputPlugin.ts   # Abstract base with HTTP client, helpers
│   │   │   ├── SonarrPlugin.ts      # ✅ Queue, Calendar
│   │   │   ├── RadarrPlugin.ts      # ✅ Queue, Missing
│   │   │   ├── TautulliPlugin.ts    # ✅ Activity, Libraries, Stats + GeoIP
│   │   │   ├── OverseerrPlugin.ts   # ✅ Request counts, Latest requests
│   │   │   ├── OmbiPlugin.ts        # ✅ Request counts, Issue counts
│   │   │   └── index.ts             # Registry auto-building
│   │   └── outputs/                 # Destination plugins
│   │       ├── BaseOutputPlugin.ts  # Abstract base with Line Protocol
│   │       ├── InfluxDB1Plugin.ts   # ✅ InfluxDB 1.x (legacy API)
│   │       ├── InfluxDB2Plugin.ts   # ✅ InfluxDB 2.x (Flux, tokens)
│   │       └── index.ts             # Registry auto-building
│   ├── types/
│   │   ├── plugin.types.ts          # InputPlugin, OutputPlugin, DataPoint
│   │   ├── common.types.ts          # Shared types (QualityInfo, etc.)
│   │   ├── http.types.ts
│   │   ├── geoip.types.ts
│   │   ├── inputs/                  # Per-plugin type definitions
│   │   │   ├── sonarr.types.ts
│   │   │   ├── radarr.types.ts
│   │   │   ├── readarr.types.ts     # Types ready, plugin not implemented
│   │   │   ├── lidarr.types.ts      # Types ready, plugin not implemented
│   │   │   ├── prowlarr.types.ts    # Types ready, plugin not implemented
│   │   │   ├── bazarr.types.ts      # Types ready, plugin not implemented
│   │   │   ├── tautulli.types.ts
│   │   │   ├── plex.types.ts        # Types ready, plugin not implemented
│   │   │   ├── jellyfin.types.ts    # Types ready, plugin not implemented
│   │   │   ├── emby.types.ts        # Types ready, plugin not implemented
│   │   │   ├── ombi.types.ts
│   │   │   └── overseerr.types.ts
│   │   └── outputs/                 # Per-output type definitions
│   │       ├── influxdb1.types.ts
│   │       ├── influxdb2.types.ts
│   │       ├── victoriametrics.types.ts  # Types ready, plugin not implemented
│   │       ├── questdb.types.ts          # Types ready, plugin not implemented
│   │       └── timescaledb.types.ts      # Types ready, plugin not implemented
│   └── utils/
│       ├── geoip.ts                 # MaxMind GeoIP2 download & lookup
│       ├── http.ts                  # HTTP utilities, error classification
│       ├── hash.ts                  # SHA256, MD5, unique ID generation
│       └── index.ts
├── tests/                           # 379 tests, ~70% coverage
│   ├── config/
│   ├── core/
│   ├── plugins/
│   │   ├── inputs/
│   │   └── outputs/
│   └── utils/
├── config/
│   ├── varken.example.yaml
│   └── varken.test.yaml
├── .github/workflows/
│   ├── ci.yml                       # Lint, Build, Test → Codecov
│   └── build.yml                    # Docker multi-platform build
├── docker-compose.yml
├── Dockerfile
├── vitest.config.ts
├── tsconfig.json
└── package.json
```

---

## Plugin Interfaces

### Input Plugin Interface (Data Source)

```typescript
interface InputPlugin<TConfig = unknown> {
  metadata: PluginMetadata;
  initialize(config: TConfig): Promise<void>;
  collect(): Promise<DataPoint[]>;
  getSchedules(): ScheduleConfig[];
  shutdown(): Promise<void>;
}
```

### Output Plugin Interface (Destination)

```typescript
interface OutputPlugin<TConfig = unknown> {
  metadata: PluginMetadata;
  initialize(config: TConfig): Promise<void>;
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

### Schedule Config

```typescript
interface ScheduleConfig {
  name: string;
  intervalSeconds: number;
  enabled: boolean;
  collect: () => Promise<DataPoint[]>;
}
```

---

## npm Dependencies

### Current Dependencies

```json
{
  "dependencies": {
    "@influxdata/influxdb-client": "^1.35.0",
    "@influxdata/influxdb-client-apis": "^1.35.0",
    "@maxmind/geoip2-node": "^5.0.0",
    "axios": "^1.7.0",
    "influx": "^5.9.0",
    "winston": "^3.17.0",
    "yaml": "^2.6.0",
    "zod": "^3.24.0"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "@typescript-eslint/eslint-plugin": "^8.0.0",
    "@typescript-eslint/parser": "^8.0.0",
    "@vitest/coverage-v8": "^2.1.0",
    "eslint": "^9.0.0",
    "tsx": "^4.19.0",
    "typescript": "^5.7.0",
    "vitest": "^2.1.0"
  }
}
```

### Dependencies by Output

| Output | npm Package | Notes |
|--------|-------------|-------|
| InfluxDB 1.x | `influx` | ✅ Implemented |
| InfluxDB 2.x | `@influxdata/influxdb-client` | ✅ Implemented |
| VictoriaMetrics | `axios` | Line protocol via HTTP |
| QuestDB | `axios` | ILP via HTTP |
| TimescaleDB | `pg` | PostgreSQL driver (à ajouter) |

### Future Dependencies (for planned features)

| Feature | npm Package | Notes |
|---------|-------------|-------|
| Health endpoint | `express` ou `fastify` | HTTP server |
| Prometheus metrics | `prom-client` | Metrics collection |
| TimescaleDB | `pg` | PostgreSQL driver |

---

## Implementation Status

### Phase 1: Foundation ✅
- [x] Initialize Node.js/TypeScript project
- [x] Configure ESLint, tsconfig.json
- [x] Create folder structure
- [x] Implement Winston logging system (with sensitive data filtering)
- [x] Define all TypeScript types (modular: `src/types/inputs/`, `src/types/outputs/`)
- [x] Implement `ConfigLoader` (YAML parsing + env vars override)
- [x] Implement `ConfigMigrator` (INI/env → YAML migration)
- [x] Create Zod validation schemas (`src/config/schemas/config.schema.ts`)
- [x] Create example config template (`config/varken.example.yaml`)

### Phase 2: Plugin Infrastructure ✅
- [x] Define `InputPlugin` and `OutputPlugin` interfaces (`src/types/plugin.types.ts`)
- [x] Implement `BaseInputPlugin` (HTTP client, helpers)
- [x] Implement `BaseOutputPlugin` (Line Protocol conversion)
- [x] Implement `PluginManager` (registration, scheduling)
- [x] Implement `Orchestrator` (coordination, graceful shutdown)

### Phase 3: Output Plugins ✅
- [x] `InfluxDB1Plugin` - InfluxDB v1.x support (legacy API)
- [x] `InfluxDB2Plugin` - InfluxDB v2.x support (Flux, buckets, tokens)

### Phase 4: Input Plugins (Core) ✅
- [x] `SonarrPlugin` - queue, calendar (missing/future)
- [x] `RadarrPlugin` - queue, missing
- [x] `TautulliPlugin` - activity, libraries, stats + GeoIP
- [x] `OverseerrPlugin` - request counts, latest requests
- [x] `OmbiPlugin` - request counts, issue counts

### Phase 5: Utilities ✅
- [x] GeoIP Handler (MaxMind) - auto-download, update, lookup
- [x] HTTP utilities (error classification, retry support)
- [x] Hash utilities (SHA-256, MD5 for legacy compatibility)

### Phase 6: Finalization ✅
- [x] Main entry point (`index.ts`)
- [x] Dockerfile (multi-stage, ~190MB)
- [x] docker-compose.yml (Varken + InfluxDB 2.x + Grafana)
- [x] Unit tests (355 tests passing)
- [x] CI/CD workflows (GitHub Actions)
- [x] Codecov integration
- [x] Documentation (README.md, CLAUDE.md)

---

## Planned Improvements

### Phase 7: Observability & Resilience (High Priority)

#### Health Endpoint ✅
- [x] Create `src/core/HealthServer.ts` - HTTP server (native Node.js http)
  - `GET /health` → Overall status (healthy/degraded/unhealthy)
  - `GET /health/plugins` → Per-plugin status
  - `GET /status` → Running schedules, last collection times
  - Add `HEALTH_PORT` env var (default: 9090)
  - Add `HEALTH_ENABLED` env var (default: true)

#### Prometheus Metrics
- [ ] Create `src/core/Metrics.ts` - Metrics collection
  - `GET /metrics` → Prometheus format
  - Metrics: collections count, errors, durations, data points collected/written
  - Add `prom-client` dependency
  - Effort: ~8h

#### Circuit Breaker & Error Recovery
- [ ] Add circuit breaker pattern to scheduler
  - Track consecutive failures per schedule
  - Exponential backoff after failures
  - Auto-disable failing plugins after N errors (configurable)
  - Mark plugin as degraded, log degradation events
  - Effort: ~6h

#### Config Hot-Reload
- [ ] Watch config file for changes with `fs.watch()`
  - Add `--watch` flag or `CONFIG_WATCH` env var
  - Reload config with Zod validation on change
  - Only restart modified plugins
  - Prevent concurrent reloads
  - Effort: ~8h

### Phase 8: Additional Output Plugins

#### VictoriaMetrics (High Priority)
- [ ] `VictoriaMetricsPlugin` - InfluxDB line protocol compatible
  - Reuses existing Line Protocol code from BaseOutputPlugin
  - Uses `axios` (already installed)
  - Effort: ~4h

#### QuestDB
- [ ] `QuestDBPlugin` - InfluxDB line protocol (ILP) support
  - HTTP or native TCP
  - Uses `axios` (already installed)
  - Effort: ~6h

#### TimescaleDB
- [ ] `TimescaleDBPlugin` - PostgreSQL with hypertables
  - Add `pg` dependency
  - Auto-create tables and hypertables
  - DataPoint → SQL INSERT mapping
  - Effort: ~8h

### Phase 9: Additional Input Plugins

#### Arr Stack
- [ ] `ReadarrPlugin` - queue, missing (eBooks)
  - Similar to RadarrPlugin, API /api/v1
  - Types already defined in `src/types/inputs/readarr.types.ts`
  - Effort: ~4h
- [ ] `LidarrPlugin` - queue, missing (Music)
  - Similar to RadarrPlugin, API /api/v1
  - Types already defined in `src/types/inputs/lidarr.types.ts`
  - Effort: ~4h
- [ ] `ProwlarrPlugin` - indexer stats, search stats
  - API /api/v1
  - Types already defined in `src/types/inputs/prowlarr.types.ts`
  - Effort: ~6h
- [ ] `BazarrPlugin` - wanted subtitles, history
  - Types already defined in `src/types/inputs/bazarr.types.ts`
  - Effort: ~4h

#### Media Servers
- [ ] `PlexPlugin` - sessions, libraries, activity (direct API)
  - Alternative to Tautulli
  - Types already defined in `src/types/inputs/plex.types.ts`
  - Effort: ~8h
- [ ] `JellyfinPlugin` - sessions, libraries, activity
  - Types already defined in `src/types/inputs/jellyfin.types.ts`
  - Effort: ~8h
- [ ] `EmbyPlugin` - sessions, libraries, activity
  - Similar to Jellyfin, API /emby/api
  - Types already defined in `src/types/inputs/emby.types.ts`
  - Effort: ~8h

### Phase 10: Testing & Quality

#### Test Coverage Improvements
- [ ] **Test entry point** - `src/index.ts` has 0% coverage
  - Test config folder initialization
  - Test GeoIP handler conditional initialization
  - Test plugin registry population
  - Test orchestrator startup success/failure
  - Effort: ~2h
- [ ] **Improve ConfigMigrator tests** (63% → 90%)
  - Edge cases: malformed INI, missing sections
  - Effort: ~2h
- [ ] **Improve Logger tests** (75% → 90%)
  - Test various sensitive patterns
  - Effort: ~1h
- [ ] **Improve GeoIP tests** (67% → 85%)
  - Network failures, update logic
  - Effort: ~2h
- [ ] **Improve HTTP utils tests** (69% → 85%)
  - Timeout handling, edge cases
  - Effort: ~1h

#### Integration Tests
- [ ] End-to-end tests with real services
  - docker-compose test environment
  - Test full data flow: collect → write → verify
  - Effort: ~8h

### Phase 11: Developer Experience

#### Dry-Run Mode
- [ ] Add `--dry-run` CLI flag
  - Validate config without writing data
  - Log what would be written
  - Test plugin connectivity
  - Effort: ~2h

#### Better Error Messages
- [ ] Create error helper with troubleshooting guidance
  - "Connection refused" → suggest firewall/port
  - "Invalid API key" → link to docs
  - "Timeout" → suggest retry configuration
  - Effort: ~4h

#### Request Deduplication/Cache
- [ ] Implement request cache with TTL
  - Share data between schedules (e.g., queue data for multiple Sonarr schedules)
  - Reduce load on source services
  - Effort: ~4h

#### Environment Variable Validation
- [ ] Create `src/utils/env.ts` for env var validation
  - Check directory permissions (CONFIG_FOLDER, DATA_FOLDER, LOG_FOLDER)
  - Validate required vars for enabled features
  - Warn on deprecated vars
  - Effort: ~2h

#### Structured Logging (JSON)
- [ ] Update Logger for JSON output in production
  - Add context helpers: `logger.with({ pluginName, pluginId })`
  - Better for ELK Stack integration, alerting
  - Effort: ~4h

### Phase 12: Code Quality

#### BaseInputPlugin Improvements
- [ ] Add `createSchedule()` helper method
  - Reduce duplication across plugins
  - Standardize schedule naming
  - Effort: ~2h
- [ ] Add `safeFetch()` wrapper with standard error handling
  - Reduce try/catch boilerplate
  - Effort: ~2h

#### Test Fixtures
- [ ] Create shared test fixtures in `tests/fixtures/`
  - `createMockHttpClient(responses)`
  - `createMockConfig(overrides)`
  - Reduce duplication in plugin tests
  - Effort: ~2h

#### Graceful Plugin Skipping
- [ ] Make output plugin failures non-fatal at startup
  - Continue with available outputs
  - Alert on startup that some outputs unavailable
  - Effort: ~2h

### Phase 13: Tooling & Maintenance (Low Priority)

#### CLI Tool
- [ ] Create `varken-cli` command
  - `varken config validate`
  - `varken config test-connection --plugin sonarr --id 1`
  - `varken plugins list`
  - `varken status`
  - Effort: ~8h

#### Pre-commit Hooks
- [ ] Add `husky` + `lint-staged`
  - Run lint and format before commit
  - Effort: ~1h

#### CHANGELOG Auto-Generation
- [ ] Use `standard-version` or `conventional-commits`
  - Auto-generate changelog from commit messages
  - Semantic versioning
  - Effort: ~2h

#### GitHub PR Template
- [ ] Create `.github/pull_request_template.md`
  - Checklist for type of change
  - Testing instructions
  - Effort: ~1h

#### Deployment Documentation
- [ ] Add `docs/` directory
  - `deployment/kubernetes.md` - StatefulSet, ConfigMap
  - `deployment/docker-swarm.md` - Stack file
  - `deployment/bare-metal.md` - systemd unit
  - `troubleshooting/common-issues.md`
  - Effort: ~8h

#### Performance Benchmarks
- [ ] Add `benchmarks/` directory
  - Measure collection speed
  - Measure write performance
  - Effort: ~4h

---

## Test Coverage Summary

| File | Coverage | Target |
|------|----------|--------|
| `src/index.ts` | 0% | 80% |
| `src/core/Orchestrator.ts` | 73% | 85% |
| `src/core/PluginManager.ts` | 82% | 90% |
| `src/core/Logger.ts` | 75% | 90% |
| `src/config/ConfigLoader.ts` | 86% | 90% |
| `src/config/ConfigMigrator.ts` | 63% | 85% |
| `src/utils/http.ts` | 69% | 85% |
| `src/utils/geoip.ts` | 67% | 85% |
| `src/utils/hash.ts` | 100% | ✅ |
| `src/plugins/inputs/SonarrPlugin.ts` | 96% | ✅ |
| `src/plugins/inputs/RadarrPlugin.ts` | 99% | ✅ |
| `src/plugins/inputs/TautulliPlugin.ts` | 97% | ✅ |
| `src/plugins/inputs/OmbiPlugin.ts` | 98% | ✅ |
| `src/plugins/inputs/OverseerrPlugin.ts` | 96% | ✅ |
| `src/plugins/outputs/InfluxDB1Plugin.ts` | 86% | 90% |
| `src/plugins/outputs/InfluxDB2Plugin.ts` | 84% | 90% |
| `src/plugins/inputs/BaseInputPlugin.ts` | 89% | 90% |
| `src/plugins/outputs/BaseOutputPlugin.ts` | 100% | ✅ |

---

## Input Plugins - Details

| Plugin | API | Collected Data | Status |
|--------|-----|----------------|--------|
| **Sonarr** | /api/v3 | Queue, Calendar (missing/future) | ✅ |
| **Radarr** | /api/v3 | Queue, Missing | ✅ |
| **Readarr** | /api/v1 | Queue, Missing | 🚧 Types ready |
| **Lidarr** | /api/v1 | Queue, Missing | 🚧 Types ready |
| **Prowlarr** | /api/v1 | Indexer stats, Search history | 🚧 Types ready |
| **Bazarr** | /api | Wanted subtitles, History | 🚧 Types ready |
| **Tautulli** | /api/v2 | Activity, Libraries, Stats + GeoIP | ✅ |
| **Plex** | /api | Sessions, Libraries (direct API) | 🚧 Types ready |
| **Jellyfin** | /api | Sessions, Libraries, Activity | 🚧 Types ready |
| **Emby** | /emby/api | Sessions, Libraries, Activity | 🚧 Types ready |
| **Ombi** | /api/v1 | Request counts, Issue counts | ✅ |
| **Overseerr** | /api/v1 | Request counts, Latest requests | ✅ |

---

## Output Plugins - Details

| Plugin | Protocol | Description | Status |
|--------|----------|-------------|--------|
| **InfluxDB1Plugin** | HTTP API v1 | InfluxDB 1.x - Legacy, InfluxQL | ✅ |
| **InfluxDB2Plugin** | HTTP API v2 | InfluxDB 2.x - Flux, Buckets, Tokens | ✅ |
| **VictoriaMetricsPlugin** | InfluxDB line protocol | High performance, compatible | 🚧 Types ready |
| **QuestDBPlugin** | ILP over TCP/HTTP | Time-series SQL, fast ingestion | 🚧 Types ready |
| **TimescaleDBPlugin** | PostgreSQL | Hypertables, standard SQL | 🚧 Types ready |

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

---

## Priority Summary

### High Priority (Do First)
| Item | Effort | Impact |
|------|--------|--------|
| ~~Health endpoint~~ | ~~✅~~ | ~~Production readiness~~ |
| VictoriaMetrics output | ~4h | Popular alternative DB |
| Readarr input | ~4h | Complete Arr stack |
| Circuit breaker | ~6h | Reliability |
| Test entry point | ~2h | Coverage |

### Medium Priority
| Item | Effort | Impact |
|------|--------|--------|
| Prometheus metrics | ~8h | Observability |
| Config hot-reload | ~8h | Operations |
| Lidarr, Prowlarr, Bazarr inputs | ~14h | More data sources |
| QuestDB, TimescaleDB outputs | ~14h | More DB options |
| Structured logging | ~4h | Debugging |
| Dry-run mode | ~2h | Testing |
| Better error messages | ~4h | UX |
| Improve test coverage | ~8h | Quality |

### Low Priority
| Item | Effort | Impact |
|------|--------|--------|
| Plex, Jellyfin, Emby inputs | ~24h | Alternative to Tautulli |
| CLI tool | ~8h | Admin UX |
| Pre-commit hooks | ~1h | DX |
| CHANGELOG auto-generation | ~2h | Maintenance |
| Deployment docs | ~8h | Documentation |
| Performance benchmarks | ~4h | Optimization |

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

### Environment Variable Override

```bash
# Format: VARKEN_<SECTION>_<KEY> (uppercase, underscore)
VARKEN_OUTPUTS_INFLUXDB2_URL="http://influx:8086"
VARKEN_INPUTS_SONARR_0_APIKEY="secret"
```

### Automatic Migration on Startup

On startup, if `varken.yaml` doesn't exist:
1. Detect if `varken.ini` exists (legacy format)
2. Detect `VRKN_*` environment variables
3. Generate `varken.yaml` by merging: template + INI + ENV

---

## Backward Compatibility

- **InfluxDB measurement names** unchanged
- **Tags and fields** unchanged
- → Existing Grafana dashboards will work without modification
- **Automatic migration**: INI/ENV → YAML on first launch

---

## Possible Future Outputs

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
| qBittorrent | Torrent client stats |
| SABnzbd | Usenet client stats |
| Deluge | Torrent client stats |
| NZBGet | Usenet client stats |
| Transmission | Torrent client stats |
