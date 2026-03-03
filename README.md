<p align="center">
<img width="800" src="https://raw.githubusercontent.com/navino16/Varken/master/assets/varken_full_banner.jpg" alt="Logo Banner">
</p>

<p align="center">
<a href="https://github.com/navino16/Varken/actions/workflows/ci.yml"><img src="https://github.com/navino16/Varken/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
<a href="https://github.com/navino16/Varken/actions/workflows/build.yml"><img src="https://github.com/navino16/Varken/actions/workflows/build.yml/badge.svg" alt="Build Docker Image"></a>
<a href="https://codecov.io/gh/navino16/Varken"><img src="https://codecov.io/gh/navino16/Varken/branch/develop/graph/badge.svg" alt="codecov"></a>
</p>

**Varken** (Dutch for "PIG" - Plex/InfluxDB/Grafana) is a standalone application that aggregates data from the Plex ecosystem into time-series databases for beautiful Grafana dashboards.

<p align="center">
<img width="800" src="https://i.imgur.com/3hNZTkC.png" alt="Example Dashboard">
</p>

## Features

- **Multiple data sources** - Sonarr, Radarr, Tautulli, Ombi, Overseerr (more coming soon)
- **Multiple outputs** - InfluxDB 1.x and InfluxDB 2.x
- **GeoIP mapping** - Automatic geolocation of streaming sessions via Tautulli API (no external license required)
- **Multi-instance support** - Connect multiple instances of each service
- **Health checks** - Built-in HTTP health endpoints for monitoring and orchestration
- **Circuit breaker** - Automatic error recovery with backoff and self-healing
- **Docker ready** - Multi-platform images for amd64 and arm64
- **Easy configuration** - Simple YAML configuration with environment variable overrides

## Table of Contents

- [Requirements](#requirements)
- [Installation](#installation)
  - [Docker Compose (Recommended)](#docker-compose-recommended)
  - [Docker](#docker)
  - [Manual Installation](#manual-installation)
- [Configuration](#configuration)
  - [Basic Configuration](#basic-configuration)
  - [Global Settings](#global-settings)
  - [Environment Variables](#environment-variables)
  - [GeoIP Setup](#geoip-setup)
  - [Multiple Instances](#multiple-instances)
  - [Circuit Breaker](#circuit-breaker)
- [Health Checks](#health-checks)
- [Supported Services](#supported-services)
- [Grafana Setup](#grafana-setup)
- [Migration from Python Version](#migration-from-python-version)
- [Troubleshooting](#troubleshooting)
- [Contributing](#contributing)
- [Support](#support)
- [License](#license)

## Requirements

- [Docker](https://www.docker.com/) (recommended) or [Node.js 18+](https://nodejs.org/)
- [InfluxDB 1.8.x or 2.x](https://www.influxdata.com/)
- [Grafana](https://grafana.com/)

## Installation

### Docker Compose (Recommended)

The easiest way to get started is with Docker Compose, which sets up Varken, InfluxDB, and Grafana together.

1. **Create a directory and download the compose file:**

```bash
mkdir varken && cd varken
curl -O https://raw.githubusercontent.com/navino16/Varken/develop/docker-compose.yml
```

2. **Create the configuration:**

```bash
mkdir config
curl -o config/varken.yaml https://raw.githubusercontent.com/navino16/Varken/develop/config/varken.example.yaml
```

3. **Edit the configuration:**

```bash
nano config/varken.yaml
```

4. **Start the stack:**

```bash
docker compose up -d
```

5. **Access services:**
   - Grafana: http://localhost:3000 (admin/admin)
   - InfluxDB: http://localhost:8086

### Docker

If you already have InfluxDB and Grafana running:

```bash
docker run -d \
  --name varken \
  -v /path/to/config:/config \
  -v /path/to/data:/data \
  -e TZ=Europe/Paris \
  ghcr.io/navino16/varken:latest
```

### Manual Installation

For development or if you prefer running without Docker:

```bash
# Clone the repository
git clone https://github.com/navino16/Varken.git
cd Varken

# Install dependencies
npm install

# Build
npm run build

# Copy and edit configuration
cp config/varken.example.yaml config/varken.yaml
nano config/varken.yaml

# Run
npm start
```

## Configuration

### Basic Configuration

Varken uses a YAML configuration file. Here's a minimal example:

```yaml
# config/varken.yaml

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

  radarr:
    - id: 1
      url: "http://radarr:7878"
      apiKey: "your-radarr-api-key"
      queue:
        enabled: true
        intervalSeconds: 30
      missing:
        enabled: true
        intervalSeconds: 300

  tautulli:
    - id: 1
      url: "http://tautulli:8181"
      apiKey: "your-tautulli-api-key"
      activity:
        enabled: true
        intervalSeconds: 30
      libraries:
        enabled: true
        intervalDays: 1
```

### Global Settings

Varken provides global configuration options for tuning timeouts and pagination. All settings have sensible defaults and are optional:

```yaml
global:
  # Timeout for HTTP requests to services (default: 30000ms = 30s)
  httpTimeoutMs: 30000

  # Timeout for health check requests (default: 5000ms = 5s)
  healthCheckTimeoutMs: 5000

  # Timeout for collector execution (default: 60000ms = 60s)
  # If a collector takes longer than this, it will be terminated
  collectorTimeoutMs: 60000

  # Number of records per page when fetching paginated API endpoints (default: 250)
  paginationPageSize: 250

  # Maximum records to fetch from paginated endpoints (default: 10000)
  # This is a safety limit to prevent memory issues on very large datasets
  maxPaginationRecords: 10000
```

| Setting | Default | Description |
|---------|---------|-------------|
| `httpTimeoutMs` | 30000 | Timeout for HTTP requests to services |
| `healthCheckTimeoutMs` | 5000 | Timeout for health check requests |
| `collectorTimeoutMs` | 60000 | Timeout for collector execution |
| `paginationPageSize` | 250 | Records per page for paginated APIs |
| `maxPaginationRecords` | 10000 | Maximum records to fetch (safety limit) |

### Environment Variables

#### Docker Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `CONFIG_FOLDER` | `/config` | Path to configuration files |
| `DATA_FOLDER` | `/data` | Path to data storage |
| `LOG_FOLDER` | `/logs` | Path to log files |
| `LOG_LEVEL` | `info` | Log level: `error`, `warn`, `info`, `debug` |
| `TZ` | `UTC` | Timezone (e.g., `Europe/Paris`, `America/New_York`) |
| `HEALTH_PORT` | `9090` | Port for the health check HTTP server |
| `HEALTH_ENABLED` | `true` | Enable/disable the health check server |

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

GeoIP geolocation is now handled directly by the Tautulli API - no external license or database download required!

To enable geolocation of streaming sessions on a world map:

```yaml
inputs:
  tautulli:
    - id: 1
      url: "http://tautulli:8181"
      apiKey: "your-api-key"
      geoip:
        enabled: true
        # Optional: set coordinates for local/LAN streams
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

1. **Applies backoff** - Increases the interval between retries (exponential backoff)
2. **Opens the circuit** - Temporarily disables the failing scheduler after too many errors
3. **Attempts recovery** - After a cooldown period, tests if the service has recovered
4. **Closes the circuit** - Returns to normal operation after successful recovery

#### Configuration

The circuit breaker is optional and has sensible defaults:

```yaml
circuitBreaker:
  # Errors before disabling scheduler (default: 10)
  maxConsecutiveErrors: 10

  # Interval multiplier per failure (default: 2)
  # Example: 30s → 60s → 120s → 240s...
  backoffMultiplier: 2

  # Maximum interval cap in seconds (default: 600 = 10 min)
  maxIntervalSeconds: 600

  # Cooldown before recovery attempt in seconds (default: 300 = 5 min)
  cooldownSeconds: 300

  # Successes needed to fully recover (default: 3)
  recoverySuccesses: 3
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

- `GET /health` - Overall status: `healthy`, `degraded`, or `unhealthy`
- `GET /health/plugins` - Per-plugin health status (inputs and outputs)
- `GET /status` - Detailed status with scheduler information

The Docker image includes a built-in `HEALTHCHECK` instruction using these endpoints.

### HTTP Response Codes

| Status | HTTP Code |
|--------|-----------|
| `healthy` | 200 |
| `degraded` | 200 |
| `unhealthy` | 503 |

### Status Calculation

| Status | Condition |
|--------|-----------|
| `healthy` | All outputs healthy + all inputs healthy + all schedulers in `closed` state with < 3 errors |
| `degraded` | At least one output healthy + at least one scheduler not in `open` state |
| `unhealthy` | No outputs configured, all outputs unreachable, or all schedulers in `open` state |

## Supported Services

### Input Plugins (Data Sources)

| Service | Data Collected | API | Status |
|---------|---------------|-----|--------|
| **Sonarr** | Queue, Calendar (missing/future episodes) | v3 | ✅ Implemented |
| **Radarr** | Queue, Missing movies | v3 | ✅ Implemented |
| **Tautulli** | Activity, Libraries, Statistics, GeoIP | v2 | ✅ Implemented |
| **Ombi** | Request counts, Issue counts, Requests | v1 | ✅ Implemented |
| **Overseerr** | Request counts, Latest requests | v1 | ✅ Implemented |
| **Readarr** | Queue, Missing (eBooks) | v1 | ✅ Implemented |
| **Lidarr** | Queue, Missing (Music) | v1 | ✅ Implemented |
| **Prowlarr** | Indexer stats | v1 | ✅ Implemented |
| **Bazarr** | Wanted subtitles, History | - | ✅ Implemented |
| **Plex** | Sessions, Libraries (Direct API) | - | 🚧 Planned |
| **Jellyfin** | Sessions, Libraries, Activity | - | 🚧 Planned |
| **Emby** | Sessions, Libraries, Activity | - | 🚧 Planned |

### Output Plugins (Databases)

| Output | Description | Status |
|--------|-------------|--------|
| **InfluxDB 2.x** | Recommended - Flux queries, tokens, buckets | ✅ Implemented |
| **InfluxDB 1.x** | Legacy support - InfluxQL queries | ✅ Implemented |
| **VictoriaMetrics** | InfluxDB line protocol compatible | 🚧 Planned |
| **QuestDB** | High-performance time-series | 🚧 Planned |
| **TimescaleDB** | PostgreSQL extension | 🚧 Planned |

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

## Migration from Python Version

If you're upgrading from the legacy Python version of Varken:

1. **Keep your old `varken.ini`** in the config folder

2. **Start Varken** - it will automatically detect and migrate your configuration

3. **Review the generated `varken.yaml`** and make any necessary adjustments

4. **Remove `varken.ini`** once you've verified everything works

Legacy `VRKN_*` environment variables are also automatically migrated.

## Troubleshooting

### Common Issues

**Varken can't connect to services:**
- Verify URLs are accessible from the Varken container
- Check API keys are correct
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
- `error` - Errors only
- `warn` - Warnings and errors
- `info` - General information (default)
- `debug` - Detailed debugging information

## Contributing

Contributions are welcome! Here's how to get started:

### Development Setup

```bash
# Clone the repository
git clone https://github.com/navino16/Varken.git
cd Varken

# Install dependencies
npm install

# Run in development mode (auto-reload)
npm run dev

# Run tests
npm test -- --run

# Run tests with coverage
npm run test:coverage -- --run

# Lint code
npm run lint

# Fix lint issues
npm run lint:fix

# Build for production
npm run build
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

1. Create type definitions in `src/types/inputs/`
2. Add Zod schema in `src/config/schemas/config.schema.ts`
3. Create plugin in `src/plugins/inputs/`
4. Register in `src/plugins/inputs/index.ts`
5. Add tests in `tests/plugins/inputs/`

### Pull Request Guidelines

- Fork the repository and create a feature branch
- Write tests for new functionality
- Ensure all tests pass: `npm test -- --run`
- Ensure code passes linting: `npm run lint`
- Update documentation if needed
- Submit a pull request to the `develop` branch

## Support

- **GitHub Issues**: [Bug reports and feature requests](https://github.com/navino16/Varken/issues)

## License

MIT License - See [LICENSE](LICENSE) for details.

---

<p align="center">
Made with <3 by the Varken community
</p>
