# Deployment Documentation — Design

**Date:** 2026-07-06
**Status:** Approved
**PLAN.md item:** Phase 13 → Deployment Documentation

## Context

Varken's README already documents Docker Compose / Docker / manual installation,
configuration, environment variables, health checks, Prometheus, Grafana, and a
Troubleshooting section. The PLAN calls for a `docs/deployment/` directory. Rather
than duplicate the README, this work moves in-depth deployment material into
`docs/deployment/` and leaves the README with concise quickstarts that link out
(single source per topic).

Scope was narrowed during brainstorming to Varken's realistic (homelab) audience:
**bare-metal (systemd)**, **Docker / Docker Compose**, and a **consolidated
troubleshooting** guide. **Kubernetes and Docker Swarm are out of scope.**

Confirmed environment facts (for accuracy in the docs):
- Image: `ghcr.io/navino16/varken` (tags `latest`, `develop`).
- Runtime: Node 24 (Alpine in the container), runs as user `node`.
- Container volumes: `/config`, `/data`, `/logs`. Health port: `9090`.
- Env defaults: `CONFIG_FOLDER=/config`, `LOG_LEVEL=info`, `HEALTH_PORT=9090`.

## Goals

- A `docs/deployment/` directory covering Docker, bare-metal/systemd, and
  troubleshooting in depth.
- A real, copy-ready systemd unit file under `deploy/systemd/`.
- A slimmer README whose deployment sections are quickstarts that link into
  `docs/deployment/`.

## Non-goals

- Kubernetes and Docker Swarm docs.
- Any application code change.
- Rewriting configuration reference (README `## Configuration` stays authoritative;
  deployment docs link to it rather than restating it).

## Design

### Structure

```
docs/deployment/
  docker.md            # Docker + Docker Compose, in depth
  bare-metal.md        # systemd install, hardening, journald
  troubleshooting.md   # symptom-based diagnostics
deploy/systemd/
  varken.service       # real unit file, referenced by bare-metal.md
```

### 1. `docs/deployment/docker.md`

- Pulling the image (`ghcr.io/navino16/varken:latest` vs `:develop`).
- `docker run` example with the three volume mounts (`/config`, `/data`, `/logs`)
  and `-p 9090:9090`.
- Docker Compose: walkthrough of the repo's `docker-compose.yml` (Varken +
  InfluxDB + Grafana), what each service and volume is for.
- Docker environment variables (`CONFIG_FOLDER`, `LOG_LEVEL`, `LOG_FORMAT`,
  `HEALTH_PORT`, `DRY_RUN`, `CONFIG_WATCH`) — link to the README env-var reference
  for the full list rather than duplicating it.
- Health check (`wget http://localhost:9090/health`), already wired in the image.
- Resource limits (compose `deploy.resources` / `--memory`).
- Updating: `docker compose pull && docker compose up -d`.

### 2. `docs/deployment/bare-metal.md`

- Prerequisites: Node 24, git.
- Dedicated system user `varken` (no login shell).
- Install layout: app in `/opt/varken`, config in `/etc/varken/varken.yaml`,
  data in `/var/lib/varken`, logs in `/var/log/varken` (or journald).
- Build steps: `npm ci && npm run build`, run `node dist/index.js`.
- systemd unit with hardening: `User=varken`, `NoNewPrivileges=true`,
  `ProtectSystem=strict`, `ProtectHome=true`, `PrivateTmp=true`,
  `ReadWritePaths=/var/lib/varken /var/log/varken`, `Restart=on-failure`,
  `Environment=CONFIG_FOLDER=/etc/varken LOG_FORMAT=json`.
- Enable/start: `systemctl enable --now varken`.
- Logs via journald (`journalctl -u varken -f`); `LOG_FORMAT=json` for structured.
- Updating: `git pull && npm ci && npm run build && systemctl restart varken`.
- Points at `deploy/systemd/varken.service` as the canonical unit.

### 3. `docs/deployment/troubleshooting.md`

Consolidates and extends the README Troubleshooting section, symptom-first:

- "A plugin collects nothing" → check `/health/plugins`, circuit-breaker state via
  `/status`, auth (401/403), API path/version (404), SSL (`verifySsl`).
- "Output is unreachable" → connectivity, health checks, degraded-output startup.
- "Circuit breaker is OPEN" → what CLOSED/OPEN/HALF-OPEN mean, cooldown/backoff,
  how to read it from `/status` and Prometheus.
- Reading logs: Docker (`docker logs`) vs journald (`journalctl`), log levels,
  `LOG_FORMAT`.
- Health/observability endpoints reference: `/health`, `/health/plugins`,
  `/status`, `/metrics`.

### 4. `deploy/systemd/varken.service`

A real unit file matching the hardening in bare-metal.md, ready to copy to
`/etc/systemd/system/varken.service`.

### 5. README changes

- `### Manual` installation: reduce to a short quickstart, link to
  `docs/deployment/bare-metal.md`.
- `### Docker Compose` / `### Docker`: keep the quickstart, add a link to
  `docs/deployment/docker.md` for depth.
- `## Troubleshooting`: keep a short "Common Issues" teaser, link to
  `docs/deployment/troubleshooting.md`.
- Do not remove the Configuration, Health Checks, Prometheus, or Grafana sections
  (out of scope; deployment docs link to them).

## Testing / Validation

Documentation only — no unit tests. Validation is a review pass confirming:

- All internal links resolve (README → docs, docs → docs, docs → README anchors).
- Paths, commands, image names, port, and volume names match the actual project
  (`Dockerfile`, `docker-compose.yml`, env defaults).
- The systemd unit is syntactically valid and its `ReadWritePaths`/`Environment`
  match bare-metal.md.

## Files touched

- Create: `docs/deployment/docker.md`, `docs/deployment/bare-metal.md`,
  `docs/deployment/troubleshooting.md`, `deploy/systemd/varken.service`.
- Modify: `README.md` (slim Manual / Docker / Troubleshooting sections + links).
- Modify: `PLAN.md` (check off Phase 13 Deployment Documentation, note k8s/swarm
  descoped).
