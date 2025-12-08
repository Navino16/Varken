# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Varken (Dutch for "PIG" - Plex/InfluxDB/Grafana) is a standalone application that aggregates data from the Plex ecosystem (Sonarr, Radarr, Lidarr, Tautulli, Ombi, Overseerr, Plex, Jellyfin, Emby, etc.) into time-series databases for Grafana visualization.

## Running the Application

```bash
# Development mode
npm run dev

# Build and run
npm run build && npm start

# Via Docker
docker-compose up -d
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
- Automatic migration from legacy `varken.ini` + `VRKN_*` env vars on first run

## Architecture

**Entry Point**: `src/index.ts`

**Core Modules** (`src/core/`):
- `Logger.ts` - Winston-based logging with sensitive data filtering

**Config** (`src/config/`):
- `ConfigLoader.ts` - YAML parsing + env vars override
- `ConfigMigrator.ts` - Legacy INI/env migration to YAML
- `schemas/config.schema.ts` - Zod validation schemas

**Types** (`src/types/`):
- `plugin.types.ts` - Plugin interfaces (InputPlugin, OutputPlugin, DataPoint)
- `inputs/` - Type definitions per input plugin (sonarr, radarr, tautulli, etc.)
- `outputs/` - Type definitions per output plugin (influxdb1, influxdb2, etc.)

**Plugins** (`src/plugins/`) - To be implemented:
- `inputs/` - Data source plugins (Sonarr, Radarr, Tautulli, Plex, Jellyfin, etc.)
- `outputs/` - Destination plugins (InfluxDB 1.x/2.x, VictoriaMetrics, QuestDB, TimescaleDB)

**Data Flow**:
```
YAML Config → ConfigLoader → PluginManager → Scheduler
→ Input Plugins → DataPoint[] → Output Plugins → Database
```

## Key Dependencies

- `axios` - HTTP client
- `yaml` - Config parsing
- `zod` - Schema validation
- `winston` - Logging
- `@influxdata/influxdb-client` / `influx` - InfluxDB clients
- `pg` - PostgreSQL/TimescaleDB client
- `@maxmind/geoip2-node` - IP geolocation

## Coding Conventions

### Logger Instantiation

Always use `createLogger` with the module name for consistent logging:

```typescript
import { createLogger } from '../core/Logger';

const logger = createLogger('ModuleName');

// Usage
logger.info('Message');
logger.debug('Debug info');
```

Output format: `2024-01-15 10:30:00 info [ModuleName] Message`

## Development

```bash
# Install dependencies
npm install

# Run tests
npm test

# Lint
npm run lint

# Build
npm run build
```

## Build & CI

- Docker build via GitHub Actions (`.github/workflows/build.yml`)
- Multi-platform: linux/amd64, linux/arm64
- Published to ghcr.io on push to develop or version tags (v*.*.*)
