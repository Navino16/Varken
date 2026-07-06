# Troubleshooting

This guide is organized by symptom. Find the section that matches what you're seeing, then work through the checks in order.

## A plugin collects nothing

Start with the health endpoints:

1. `GET /health/plugins` — shows per-plugin health status (inputs and outputs). Find the affected plugin and check its reported status.
2. `GET /status` — shows detailed scheduler information, including the circuit-breaker state for each scheduler. If the scheduler for this plugin is `open`, see [Circuit breaker is OPEN](#circuit-breaker-is-open) below.

Common causes, by HTTP status code:

| Symptom | Likely cause | Fix |
|---------|-------------|-----|
| `401` / `403` | Wrong `apiKey` (or token/credentials) | Double-check the API key in `varken.yaml` and that it has the required permissions on the target service |
| `404` | Wrong API path or API version | Confirm the service URL and that the plugin targets the correct API version (e.g. Sonarr v3 vs. an older instance) |
| TLS/SSL errors (self-signed certificate) | Certificate not trusted by Varken | Set `verifySsl: false` on the plugin config if you trust the endpoint (development/self-signed only — do not use this in production) |

Varken logs helpful, actionable error hints for exactly these cases (auth failures, wrong API paths, connection refused, timeouts, TLS errors) — check the plugin's log output first; the hint usually tells you exactly what to fix. See [Reading logs](#reading-logs) below for how to view them.

## An output is unreachable

If an output plugin (InfluxDB, VictoriaMetrics, QuestDB, TimescaleDB, etc.) fails to initialize, Varken does not crash — it skips the failed output at startup and continues with the remaining ones. Look for a warning like:

```
Started with N/M output(s) — some failed to initialize but Varken will continue with the available ones
```

If you see this message:

1. Check the output plugin's URL and credentials in `varken.yaml`.
2. Check `GET /health` for the overall status — if all outputs are unreachable, overall status will be `unhealthy`.
3. Check the logs for the specific connection error for that output (see [Reading logs](#reading-logs)).

## Circuit breaker is OPEN

Varken's circuit breaker disables a scheduler after repeated failures rather than retrying indefinitely. The state machine is:

```
CLOSED (normal) → OPEN (after maxConsecutiveErrors) → HALF-OPEN (after cooldownSeconds) → CLOSED (after recoverySuccesses)
```

- **CLOSED → OPEN**: triggered after `maxConsecutiveErrors` consecutive failures on a scheduler.
- **OPEN → HALF-OPEN**: after waiting `cooldownSeconds`, Varken tests the scheduler again.
- **HALF-OPEN → CLOSED**: after `recoverySuccesses` consecutive successful runs, the scheduler returns to normal operation.
- While in `CLOSED` but still erroring, retry intervals grow with **exponential backoff**, capped at `maxIntervalSeconds`.

To check the current state of a scheduler's circuit breaker:

- `GET /status` — shows the current state (`closed`, `open`, `half-open`) per scheduler.
- The `varken_circuit_breaker_state` Prometheus metric, scraped from `GET /metrics`.

For the full configuration reference and state diagram, see [README: Circuit Breaker](../../README.md#circuit-breaker).

## Reading logs

Logs are the fastest way to find the underlying error behind a failing plugin or output.

- **Docker**: `docker logs -f varken`
- **systemd** (bare-metal): `journalctl -u varken -f`

For more detail, increase verbosity and/or switch to structured output:

- `LOG_LEVEL=debug` — includes verbose per-request detail.
- `LOG_FORMAT=json` — structured JSON output, useful for grepping or shipping to a log aggregator (file output is always JSON regardless of this setting).

## Health & observability endpoints

Varken exposes HTTP endpoints on port `9090` (configurable via `HEALTH_PORT`) for monitoring:

| Endpoint | Description |
|----------|-------------|
| `GET /health` | Overall status: `healthy`, `degraded`, or `unhealthy` |
| `GET /health/plugins` | Per-plugin health status (inputs and outputs) |
| `GET /status` | Detailed status, including scheduler and circuit-breaker state |
| `GET /metrics` | Prometheus scrape endpoint |

For the full status calculation rules and HTTP response codes, see [README: Health Checks](../../README.md#health-checks).
