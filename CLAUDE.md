# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Varken (Dutch for "PIG" - Plex/InfluxDB/Grafana) is a standalone application that aggregates data from the Plex ecosystem (Sonarr, Radarr, Lidarr, Tautulli, Ombi, Overseerr, Plex, Jellyfin, Emby, etc.) into time-series databases for Grafana visualization.

## Running the Application

```bash
# Standard execution
npm start

# Development mode
npm run dev

# Debug mode
npm run dev -- --debug

# Via Docker
docker-compose up -d
```

## Configuration

- Config file: `config/varken.yaml` (generated from template on first run)
- Environment variables can override config (e.g., `VARKEN_OUTPUTS_INFLUXDB2_URL`)
- Automatic migration from legacy `varken.ini` + `VRKN_*` env vars on first run

## Architecture

**Entry Point**: `src/index.ts` - orchestrates plugin management and scheduling

**Core Modules** (`src/core/`):
- `Orchestrator.ts` - Main coordinator, graceful shutdown
- `PluginManager.ts` - Plugin registration and scheduling
- `Logger.ts` - Winston-based logging with sensitive data filtering

**Config** (`src/config/`):
- `ConfigLoader.ts` - YAML parsing + env vars override
- `ConfigMigrator.ts` - Legacy INI/env migration to YAML
- `schemas/` - Zod validation schemas

**Plugins** (`src/plugins/`):
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

## Build & CI

- Docker build via GitHub Actions (`.github/workflows/build.yml`)
- Multi-platform: linux/amd64, linux/arm64
- Published to ghcr.io on push to develop or version tags (v*.*.*)

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