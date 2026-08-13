# Docker Deployment

Varken ships as a container image published to `ghcr.io/navino16/varken`. The `:latest` tag tracks stable releases, while `:develop` tracks the bleeding edge build from the `develop` branch.

## `docker run`

```bash
docker run -d --name varken \
  -v /path/to/config:/config \
  -v /path/to/data:/data \
  -v /path/to/logs:/logs \
  -p 9090:9090 \
  ghcr.io/navino16/varken:latest
```

The container exposes three volumes:

- `/config` — holds `varken.yaml`
- `/data` — persistent application data
- `/logs` — rotating log files

Port `9090` serves the health and metrics HTTP endpoints.

## Docker Compose

The repository's `docker-compose.yml` bundles Varken together with InfluxDB 2 and Grafana, giving you a complete stack (data collection, storage, and dashboards) in one command:

```bash
docker compose up -d
```

Your configuration file goes in the mounted `/config` volume as `varken.yaml`. See [Configuration](../../README.md#configuration) for the full file format.

## Environment variables

The following environment variables are relevant to deployment, along with their defaults:

| Variable | Default | Description |
|----------|---------|-------------|
| `CONFIG_FOLDER` | `/config` | Directory where `varken.yaml` is read from |
| `LOG_LEVEL` | `info` | Logging verbosity |
| `LOG_FORMAT` | `text` | Console log format: `text` or `json` |
| `HEALTH_PORT` | `9090` | Port for the health/metrics HTTP server |
| `DRY_RUN` | `false` | Run without writing to output plugins; runs the schedule once and then exits |
| `CONFIG_WATCH` | `false` | Watch `varken.yaml` for changes and reload |

See [Environment Variables](../../README.md#environment-variables) for the full list including `VARKEN_*` overrides.

**Warning:** When using `DRY_RUN=true`, the container runs the schedule once and then exits. In Docker Compose with `restart: unless-stopped`, this will cause a restart loop. Use `DRY_RUN=true` only for one-off validation runs with `docker run --rm`, not as a long-running service.

## Health check

The image includes a built-in Docker healthcheck that polls `wget -q -O /dev/null http://localhost:9090/health`. You can inspect the current health status with:

```bash
docker inspect --format '{{.State.Health.Status}}' varken
```

## Resource limits

To cap the container's memory usage, add a `mem_limit` to the `varken` service in your compose file:

```yaml
mem_limit: 256m
```

> `mem_limit` is honored by a plain `docker compose up -d` (outside Swarm). The Compose Specification's `deploy.resources.limits` block is only applied with `docker compose --compatibility up` (or under Swarm) and is otherwise silently ignored — so prefer `mem_limit` here.

## Updating

Pull the latest image and recreate the containers:

```bash
docker compose pull && docker compose up -d
```
