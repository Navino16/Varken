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
| `HEALTH_PORT` | `9090` | Health check HTTP server port |
| `HEALTH_ENABLED` | `true` | Enable/disable health check server (`true`/`false`) |

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
│   ├── PluginManager.ts         # Plugin registration, scheduling, data routing
│   └── HealthServer.ts          # HTTP health check endpoints
├── config/
│   ├── ConfigLoader.ts          # YAML parsing + env vars override
│   ├── ConfigMigrator.ts        # Legacy INI/env migration to YAML
│   └── schemas/config.schema.ts # Zod validation schemas
├── plugins/
│   ├── inputs/                  # Data source plugins
│   │   ├── BaseInputPlugin.ts   # Abstract base with HTTP client, helpers
│   │   ├── SonarrPlugin.ts      # Queue, Calendar (missing/future)
│   │   ├── RadarrPlugin.ts      # Queue, Missing movies
│   │   ├── ReadarrPlugin.ts     # Queue, Missing books
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
│   ├── health.types.ts          # Health check types (HealthStatus, etc.)
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

### Input Plugins (8)

| Plugin | Config Key | Data Collected |
|--------|------------|----------------|
| `SonarrPlugin` | `sonarr` | Queue, Calendar (missing/future episodes) |
| `RadarrPlugin` | `radarr` | Queue, Missing movies |
| `ReadarrPlugin` | `readarr` | Queue, Missing books |
| `TautulliPlugin` | `tautulli` | Activity, Libraries, Stats + GeoIP |
| `OverseerrPlugin` | `overseerr` | Request counts, Latest requests |
| `LidarrPlugin` | `lidarr` | Queue, Missing albums |
| `BazarrPlugin` | `bazarr` | Wanted subtitles, History |
| `OmbiPlugin` | `ombi` | Request counts, Issue counts |

### Output Plugins (2)

| Plugin | Config Key | Description |
|--------|------------|-------------|
| `InfluxDB1Plugin` | `influxdb1` | Legacy InfluxDB 1.x API |
| `InfluxDB2Plugin` | `influxdb2` | InfluxDB 2.x with Flux, buckets, tokens |

### Not Yet Implemented (types exist)

- **Inputs**: Prowlarr, Plex, Jellyfin, Emby
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

### BaseInputPlugin Helper Methods

The `BaseInputPlugin` class provides these protected methods:

| Method | Description |
|--------|-------------|
| `httpGet<T>(path, params?)` | Make HTTP GET request |
| `httpPost<T>(path, data?)` | Make HTTP POST request |
| `createDataPoint(measurement, tags, fields, timestamp?)` | Create a DataPoint with optional custom timestamp |
| `createSchedule(name, interval, enabled, collector)` | Create a ScheduleConfig |
| `hashit(input)` | Generate MD5 hash for unique IDs (legacy compatibility) |
| `getHealthEndpoint()` | Override to specify health check endpoint |

## Adding a New Input Plugin

### Step 1: Create or Verify Type Definitions

**Important**: Types may already exist in `src/types/inputs/`. Always check first and verify they match the actual API responses before implementing the plugin.

Create or update `src/types/inputs/<plugin>.types.ts`:

```typescript
// Configuration interface
export interface MyPluginConfig {
  id: number;
  url: string;
  apiKey: string;
  verifySsl: boolean;
  // Feature-specific config
  myFeature: {
    enabled: boolean;
    intervalSeconds: number;
  };
}

// API response types
export interface MyPluginApiResponse {
  id: number;
  name: string;
  // ... other fields from the API
}
```

Export in `src/types/inputs/index.ts`.

### Step 2: Add Zod Schema

In `src/config/schemas/config.schema.ts`:

```typescript
export const MyPluginConfigSchema = z.object({
  id: z.number(),
  url: z.string(),
  apiKey: z.string(),
  verifySsl: z.boolean().default(false),
  myFeature: z.object({
    enabled: z.boolean().default(false),
    intervalSeconds: z.number().default(300),
  }).default({}),
});

// Add to InputsConfigSchema
export const InputsConfigSchema = z.object({
  // ... existing plugins
  myplugin: z.array(MyPluginConfigSchema).optional(),
});
```

### Step 3: Create the Plugin

Create `src/plugins/inputs/MyPlugin.ts`:

```typescript
import { BaseInputPlugin } from './BaseInputPlugin';
import type { PluginMetadata, DataPoint, ScheduleConfig } from '../../types/plugin.types';
import type { MyPluginConfig, MyPluginApiResponse } from '../../types/inputs/myplugin.types';

export class MyPlugin extends BaseInputPlugin<MyPluginConfig> {
  readonly metadata: PluginMetadata = {
    name: 'MyPlugin',        // Used as config key (lowercase)
    version: '1.0.0',
    description: 'Collects data from MyService',
  };

  async initialize(config: MyPluginConfig): Promise<void> {
    await super.initialize(config);
    // Add authentication header
    this.httpClient.defaults.headers.common['X-Api-Key'] = this.config.apiKey;
  }

  // Health check endpoint (called by HealthServer)
  protected getHealthEndpoint(): string {
    return '/api/v1/system/status';
  }

  // Main collect method (called if no schedules defined)
  async collect(): Promise<DataPoint[]> {
    const points: DataPoint[] = [];
    if (this.config.myFeature.enabled) {
      points.push(...await this.collectMyFeature());
    }
    return points;
  }

  // Return schedules for PluginManager
  getSchedules(): ScheduleConfig[] {
    const schedules: ScheduleConfig[] = [];
    if (this.config.myFeature.enabled) {
      schedules.push(
        this.createSchedule('myFeature', this.config.myFeature.intervalSeconds, true, this.collectMyFeature)
      );
    }
    return schedules;
  }

  // Feature collector
  private async collectMyFeature(): Promise<DataPoint[]> {
    const points: DataPoint[] = [];
    try {
      const data = await this.httpGet<MyPluginApiResponse[]>('/api/v1/items');

      for (const item of data) {
        const hashId = this.hashit(`${this.config.id}${item.name}`);
        points.push(
          this.createDataPoint(
            'MyPlugin',                    // Measurement prefix
            {                              // Tags (indexed, for filtering)
              type: 'MyFeature',
              server: this.config.id,
              name: item.name,
            },
            {                              // Fields (values)
              hash: hashId,
              value: item.someValue,
            }
          )
        );
      }
      this.logger.info(`Collected ${points.length} items from MyPlugin`);
    } catch (error) {
      this.logger.error(`Failed to collect MyPlugin data: ${error}`);
    }
    return points;
  }
}
```

### Step 4: Register the Plugin

In `src/plugins/inputs/index.ts`:

```typescript
import { MyPlugin } from './MyPlugin';
export { MyPlugin } from './MyPlugin';

const inputPluginClasses: InputPluginFactory[] = [
  // ... existing plugins
  MyPlugin,
];
```

### Step 5: Add Example Config

In `config/varken.example.yaml`:

```yaml
# MyPlugin
# myplugin:
#   - id: 1
#     url: "http://localhost:8080"
#     apiKey: "your-api-key"
#     verifySsl: false
#     myFeature:
#       enabled: true
#       intervalSeconds: 300
```

### Step 6: Write Tests

Create `tests/plugins/inputs/MyPlugin.test.ts` with tests for:
- Metadata correctness
- Initialization with API key
- Schedule generation
- Data collection (mock HTTP responses)
- Error handling
- Edge cases

## Adding a New Output Plugin

### Step 1: Create Type Definitions

Create `src/types/outputs/<plugin>.types.ts`:

```typescript
export interface MyOutputConfig {
  url: string;
  port: number;
  // Authentication
  username?: string;
  password?: string;
  // Options
  ssl: boolean;
  verifySsl: boolean;
}
```

### Step 2: Add Zod Schema

In `src/config/schemas/config.schema.ts`:

```typescript
export const MyOutputConfigSchema = z.object({
  url: z.string(),
  port: z.number().default(8080),
  username: z.string().optional(),
  password: z.string().optional(),
  ssl: z.boolean().default(false),
  verifySsl: z.boolean().default(false),
});

// Add to OutputsConfigSchema
export const OutputsConfigSchema = z.object({
  // ... existing outputs
  myoutput: MyOutputConfigSchema.optional(),
});
```

### Step 3: Create the Plugin

Create `src/plugins/outputs/MyOutputPlugin.ts`:

```typescript
import { BaseOutputPlugin } from './BaseOutputPlugin';
import type { PluginMetadata, DataPoint } from '../../types/plugin.types';
import type { MyOutputConfig } from '../../types/outputs/myoutput.types';

export class MyOutputPlugin extends BaseOutputPlugin<MyOutputConfig> {
  readonly metadata: PluginMetadata = {
    name: 'MyOutput',
    version: '1.0.0',
    description: 'Writes data to MyDatabase',
  };

  private client: MyDatabaseClient | null = null;

  async initialize(config: MyOutputConfig): Promise<void> {
    await super.initialize(config);

    // Initialize database client
    this.client = new MyDatabaseClient({
      host: this.config.url,
      port: this.config.port,
      ssl: this.config.ssl,
    });

    await this.client.connect();
    this.logger.info(`Connected to MyDatabase at ${this.config.url}:${this.config.port}`);
  }

  async write(points: DataPoint[]): Promise<void> {
    if (!this.client || points.length === 0) return;

    try {
      // Convert DataPoints to your database format
      // Option 1: Use Line Protocol (InfluxDB compatible)
      const lines = points.map(p => this.toLineProtocol(p));
      await this.client.write(lines.join('\n'));

      // Option 2: Custom format
      for (const point of points) {
        await this.client.insert({
          measurement: point.measurement,
          tags: point.tags,
          fields: point.fields,
          timestamp: point.timestamp,
        });
      }

      this.logger.debug(`Wrote ${points.length} points to MyDatabase`);
    } catch (error) {
      this.logger.error(`Failed to write to MyDatabase: ${error}`);
      throw error;
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      await this.client?.ping();
      return true;
    } catch {
      return false;
    }
  }

  async shutdown(): Promise<void> {
    await this.client?.close();
    this.client = null;
    this.logger.info('MyOutput plugin shut down');
  }
}
```

### Step 4: Register the Plugin

In `src/plugins/outputs/index.ts`:

```typescript
import { MyOutputPlugin } from './MyOutputPlugin';
export { MyOutputPlugin } from './MyOutputPlugin';

const outputPluginClasses: OutputPluginFactory[] = [
  // ... existing plugins
  MyOutputPlugin,
];
```

### Step 5: Write Tests

Create `tests/plugins/outputs/MyOutputPlugin.test.ts` with tests for:
- Initialization and connection
- Writing data points
- Health check
- Error handling
- Shutdown cleanup

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
- **Current**: 414 tests passing

## Contributing

### Pull Requests

**Always use the PR template** located at `.github/PULL_REQUEST_TEMPLATE.md` when creating pull requests. The template includes:
- Description section
- Type of change checkboxes
- Checklist for testing and quality
- Related issues section

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
