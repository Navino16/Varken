# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Varken (Dutch for "PIG" - Plex/InfluxDB/Grafana) is a standalone application that aggregates data from the Plex ecosystem into time-series databases for Grafana visualization.

## Running the Application

```bash
# Development mode
npm run dev

# Build and run
npm run build && npm start

# Via Docker
docker compose up -d
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `CONFIG_FOLDER` | `./config` | YAML configuration files |
| `DATA_FOLDER` | `./data` | GeoIP database storage |
| `LOG_FOLDER` | `./logs` | Log files |
| `LOG_LEVEL` | `info` | Winston log level (`error`, `warn`, `info`, `http`, `verbose`, `debug`, `silly`) |

## Configuration

- Config file: `{CONFIG_FOLDER}/varken.yaml` (generated from template on first run)
- Template: `config/varken.example.yaml`
- Environment variables can override config values: `VARKEN_OUTPUTS_INFLUXDB2_URL`
- Array values via index: `VARKEN_INPUTS_SONARR_0_APIKEY`
- Automatic migration from legacy `varken.ini` + `VRKN_*` env vars on first run

## Architecture

```
src/
├── index.ts                     # Entry point
├── core/
│   ├── Logger.ts                # Winston logging with sensitive data filtering
│   ├── Orchestrator.ts          # Application lifecycle, graceful shutdown
│   └── PluginManager.ts         # Plugin registration, scheduling, data routing
├── config/
│   ├── ConfigLoader.ts          # YAML parsing + env vars override
│   ├── ConfigMigrator.ts        # Legacy INI/env migration to YAML
│   └── schemas/config.schema.ts # Zod validation schemas
├── plugins/
│   ├── inputs/                  # Data source plugins
│   │   ├── BaseInputPlugin.ts   # Abstract base with HTTP client, helpers
│   │   ├── SonarrPlugin.ts      # Queue, Calendar (missing/future)
│   │   ├── RadarrPlugin.ts      # Queue, Missing movies
│   │   ├── TautulliPlugin.ts    # Activity, Libraries, Stats + GeoIP
│   │   ├── OverseerrPlugin.ts   # Request counts, Latest requests
│   │   ├── OmbiPlugin.ts        # Request counts, Issue counts
│   │   └── index.ts             # Registry auto-building
│   └── outputs/                 # Destination plugins
│       ├── BaseOutputPlugin.ts  # Abstract base with Line Protocol
│       ├── InfluxDB1Plugin.ts   # InfluxDB 1.x (legacy API)
│       ├── InfluxDB2Plugin.ts   # InfluxDB 2.x (Flux, tokens)
│       └── index.ts             # Registry auto-building
├── types/
│   ├── plugin.types.ts          # InputPlugin, OutputPlugin, DataPoint
│   ├── common.types.ts          # Shared types (QualityInfo, etc.)
│   ├── inputs/                  # Per-plugin type definitions
│   └── outputs/                 # Per-output type definitions
└── utils/
    ├── geoip.ts                 # MaxMind GeoIP2 download & lookup
    ├── http.ts                  # HTTP utilities, error classification
    └── hash.ts                  # SHA256, MD5, unique ID generation
```

**Data Flow**:
```
YAML Config → ConfigLoader → Orchestrator → PluginManager
→ Scheduler triggers → InputPlugin.collect() → DataPoint[]
→ OutputPlugin.write() → All configured outputs
```

## Implemented Plugins

### Input Plugins (5)

| Plugin | Config Key | Data Collected |
|--------|------------|----------------|
| `SonarrPlugin` | `sonarr` | Queue, Calendar (missing/future episodes) |
| `RadarrPlugin` | `radarr` | Queue, Missing movies |
| `TautulliPlugin` | `tautulli` | Activity, Libraries, Stats + GeoIP |
| `OverseerrPlugin` | `overseerr` | Request counts, Latest requests |
| `OmbiPlugin` | `ombi` | Request counts, Issue counts |

### Output Plugins (2)

| Plugin | Config Key | Description |
|--------|------------|-------------|
| `InfluxDB1Plugin` | `influxdb1` | Legacy InfluxDB 1.x API |
| `InfluxDB2Plugin` | `influxdb2` | InfluxDB 2.x with Flux, buckets, tokens |

### Not Yet Implemented (types exist)

- **Inputs**: Readarr, Lidarr, Prowlarr, Bazarr, Plex, Jellyfin, Emby
- **Outputs**: VictoriaMetrics, QuestDB, TimescaleDB

## Key Dependencies

| Package | Purpose |
|---------|---------|
| `axios` | HTTP client |
| `yaml` | Config parsing |
| `zod` | Schema validation |
| `winston` | Logging |
| `@influxdata/influxdb-client` | InfluxDB 2.x client |
| `influx` | InfluxDB 1.x client |
| `@maxmind/geoip2-node` | IP geolocation |

## Coding Conventions

### Logger Instantiation

Always use `createLogger` with the module name:

```typescript
import { createLogger } from '../core/Logger';

const logger = createLogger('ModuleName');

logger.info('Message');
logger.debug('Debug info');
```

Output: `2024-01-15 10:30:00 info [ModuleName] Message`

### Plugin Registration

Plugins are auto-discovered via registry. Add to `inputPluginClasses` array in `src/plugins/inputs/index.ts`:

```typescript
const inputPluginClasses = [
  SonarrPlugin,
  RadarrPlugin,
  // ... add new plugin here
];
```

Config key = `metadata.name.toLowerCase()`

### DataPoint Format

```typescript
interface DataPoint {
  measurement: string;           // e.g., "sonarr_queue"
  tags: Record<string, string | number>;  // e.g., { server_id: 1 }
  fields: Record<string, string | number | boolean>;
  timestamp: Date;
}
```

### Schedule System

Each input plugin returns schedules from `getSchedules()`:

```typescript
getSchedules(): ScheduleConfig[] {
  return [
    {
      name: `${this.metadata.name}_${this.serverId}_queue`,
      intervalSeconds: this.config.queue.intervalSeconds,
      enabled: this.config.queue.enabled,
      collect: () => this.collectQueue(),
    },
  ];
}
```

## Development

```bash
# Install dependencies
npm install

# Run tests (use --run to exit after completion)
npm test -- --run

# Run tests with coverage
npm run test:coverage -- --run

# Lint
npm run lint

# Lint with auto-fix
npm run lint:fix

# Build
npm run build

# Clean (remove dist, .reports, node_modules, logs, data)
npm run clean
```

**Important**: Always run tests with `--run` flag to prevent vitest from entering watch mode.

## Test Structure

```
tests/
├── config/           # ConfigLoader, ConfigMigrator, schema tests
├── core/             # Logger, PluginManager, Orchestrator tests
├── plugins/
│   ├── inputs/       # Each input plugin has dedicated test file
│   └── outputs/      # Each output plugin has dedicated test file
└── utils/            # geoip, http, hash utility tests
```

- **Framework**: Vitest 2.1.0
- **Coverage**: v8 provider, reports to `.reports/coverage/`
- **JUnit**: `.reports/junit.xml` (for CI)
- **Current**: 355 tests passing

## Build & CI

### GitHub Actions

**`.github/workflows/ci.yml`** - Runs on all branches:
- Lint (ESLint)
- Build (TypeScript compilation)
- Test (Vitest with coverage → Codecov)

**`.github/workflows/build.yml`** - Runs on `develop` and `v*.*.*` tags:
- Lint → Test → Docker build (sequential)
- Multi-platform: linux/amd64, linux/arm64
- Published to `ghcr.io/navino16/varken`

### Docker

```bash
# Build locally
docker build -t varken:test .

# Check image size (~190MB)
docker images varken:test
```

- Multi-stage build (builder + production)
- Base: Node 22 Alpine
- User: `node` (non-root, uid/gid 1000)
- Volumes: `/config`, `/data`, `/logs`
