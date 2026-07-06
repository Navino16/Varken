# Deployment Documentation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `docs/deployment/` directory (Docker, bare-metal/systemd, troubleshooting) plus a real systemd unit file, and slim the README's deployment sections into quickstarts that link to the new docs.

**Architecture:** Documentation only — no application code. In-depth deployment material lives in `docs/deployment/`; the README keeps concise quickstarts linking out (single source per topic). A copy-ready unit file lives at `deploy/systemd/varken.service`.

**Tech Stack:** Markdown. Facts sourced from `Dockerfile`, `docker-compose.yml`, and README.

## Global Constraints

- Documentation only. No changes to `src/`, tests, or `package.json`.
- All content in English.
- Out of scope: Kubernetes, Docker Swarm docs; rewriting the config reference (link to README `## Configuration` instead of restating).
- Verbatim project facts to use everywhere:
  - Image: `ghcr.io/navino16/varken` (tags `latest`, `develop`).
  - Runtime: Node 24; container runs as user `node`.
  - Container volumes: `/config`, `/data`, `/logs`. Health port: `9090`.
  - Env defaults: `CONFIG_FOLDER=/config`, `LOG_LEVEL=info`, `HEALTH_PORT=9090`.
  - Health endpoints: `/health`, `/health/plugins`, `/status`, `/metrics`.
  - Bare-metal layout: app `/opt/varken`, config `/etc/varken/varken.yaml`, data `/var/lib/varken`, logs `/var/log/varken`.
- Commit messages: single line, no body, no Co-Authored-By.
- Every relative link a doc adds MUST resolve to a file that exists (verify with `ls`).

---

### Task 1: Real systemd unit file

**Files:**
- Create: `deploy/systemd/varken.service`

**Interfaces:**
- Produces: `deploy/systemd/varken.service` — referenced by `bare-metal.md` (Task 3). Its `WorkingDirectory`, `ExecStart`, `Environment`, and `ReadWritePaths` values are the canonical ones bare-metal.md must match.

- [ ] **Step 1: Create the unit file**

Create `deploy/systemd/varken.service` with exactly this content:

```ini
[Unit]
Description=Varken - Plex ecosystem data aggregator
Documentation=https://github.com/Navino16/Varken
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=varken
Group=varken
WorkingDirectory=/opt/varken
ExecStart=/usr/bin/node /opt/varken/dist/index.js
Restart=on-failure
RestartSec=10

# Configuration and paths
Environment=CONFIG_FOLDER=/etc/varken
Environment=DATA_FOLDER=/var/lib/varken
Environment=LOG_FOLDER=/var/log/varken
Environment=LOG_FORMAT=json
Environment=LOG_LEVEL=info

# Hardening
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
ProtectKernelTunables=true
ProtectControlGroups=true
RestrictSUIDSGID=true
ReadWritePaths=/var/lib/varken /var/log/varken

[Install]
WantedBy=multi-user.target
```

- [ ] **Step 2: Verify the file is syntactically sane**

Run: `grep -E '^(User|WorkingDirectory|ExecStart|ReadWritePaths)=' deploy/systemd/varken.service`
Expected: prints the four lines (confirms the canonical values bare-metal.md will reference).

- [ ] **Step 3: Commit**

```bash
git add deploy/systemd/varken.service
git commit -m "docs: add systemd unit file for bare-metal deployment"
```

---

### Task 2: `docs/deployment/docker.md`

**Files:**
- Create: `docs/deployment/docker.md`

**Interfaces:**
- Consumes: nothing. Links to README anchors `#configuration` and `#environment-variables` (relative: `../../README.md#...`).
- Produces: `docs/deployment/docker.md` — linked from README (Task 5).

- [ ] **Step 1: Write the document**

Create `docs/deployment/docker.md`. Use these exact sections (H1 title `# Docker Deployment`), and include the listed facts/commands verbatim:

1. **Intro** — one paragraph: Varken ships as `ghcr.io/navino16/varken`; `:latest` = stable, `:develop` = bleeding edge.
2. **`docker run`** — fenced `bash` block:
   ```bash
   docker run -d --name varken \
     -v /path/to/config:/config \
     -v /path/to/data:/data \
     -v /path/to/logs:/logs \
     -p 9090:9090 \
     ghcr.io/navino16/varken:latest
   ```
   Note the three volumes (`/config`, `/data`, `/logs`) and port `9090`.
3. **Docker Compose** — explain the repo's `docker-compose.yml` bundles Varken + InfluxDB 2 + Grafana; show `docker compose up -d`; state the config file goes in the mounted `/config` as `varken.yaml`. Link to `../../README.md#configuration` for config file format.
4. **Environment variables** — list the deployment-relevant ones with defaults: `CONFIG_FOLDER=/config`, `LOG_LEVEL=info`, `LOG_FORMAT` (`text`|`json`), `HEALTH_PORT=9090`, `DRY_RUN`, `CONFIG_WATCH`. Then: "See [Environment Variables](../../README.md#environment-variables) for the full list including `VARKEN_*` overrides."
5. **Health check** — the image has a built-in healthcheck (`wget http://localhost:9090/health`); show `docker inspect --format '{{.State.Health.Status}}' varken`.
6. **Resource limits** — compose snippet under the varken service:
   ```yaml
   deploy:
     resources:
       limits:
         memory: 256M
   ```
7. **Updating** — fenced block: `docker compose pull && docker compose up -d`.

- [ ] **Step 2: Verify links and facts**

Run: `ls docs/deployment/docker.md && grep -c 'ghcr.io/navino16/varken' docs/deployment/docker.md`
Expected: file exists, image name present at least once.

Manually confirm: the README has anchors `## Configuration` and `### Environment Variables` (they do — do not invent anchors that don't exist). GitHub slugs: `#configuration`, `#environment-variables`.

- [ ] **Step 3: Commit**

```bash
git add docs/deployment/docker.md
git commit -m "docs: add Docker deployment guide"
```

---

### Task 3: `docs/deployment/bare-metal.md`

**Files:**
- Create: `docs/deployment/bare-metal.md`

**Interfaces:**
- Consumes: `deploy/systemd/varken.service` (Task 1) — its values must match. README config anchor via `../../README.md#configuration`.
- Produces: `docs/deployment/bare-metal.md` — linked from README (Task 5).

- [ ] **Step 1: Write the document**

Create `docs/deployment/bare-metal.md`. H1 `# Bare-Metal (systemd) Deployment`. Sections with these exact commands:

1. **Prerequisites** — Node 24+ and git. `node --version` should be >= 24.
2. **Dedicated user** —
   ```bash
   sudo useradd --system --no-create-home --shell /usr/sbin/nologin varken
   ```
3. **Install** —
   ```bash
   sudo git clone https://github.com/Navino16/Varken.git /opt/varken
   cd /opt/varken
   sudo npm ci
   sudo npm run build
   ```
4. **Directories** —
   ```bash
   sudo mkdir -p /etc/varken /var/lib/varken /var/log/varken
   sudo chown -R varken:varken /var/lib/varken /var/log/varken
   ```
   Place `varken.yaml` in `/etc/varken/` (link to `../../README.md#configuration` for the format).
5. **systemd unit** — copy the provided unit:
   ```bash
   sudo cp /opt/varken/deploy/systemd/varken.service /etc/systemd/system/varken.service
   sudo systemctl daemon-reload
   ```
   State that the unit sets `CONFIG_FOLDER=/etc/varken`, `DATA_FOLDER=/var/lib/varken`, `LOG_FOLDER=/var/log/varken`, `LOG_FORMAT=json`, and hardening (`NoNewPrivileges`, `ProtectSystem=strict`, `ReadWritePaths=/var/lib/varken /var/log/varken`). These MUST match `deploy/systemd/varken.service` exactly.
6. **Enable & start** —
   ```bash
   sudo systemctl enable --now varken
   sudo systemctl status varken
   ```
7. **Logs** — `journalctl -u varken -f`; note `LOG_FORMAT=json` gives structured records.
8. **Updating** —
   ```bash
   cd /opt/varken
   sudo git pull
   sudo npm ci && sudo npm run build
   sudo systemctl restart varken
   ```

- [ ] **Step 2: Verify unit values match**

Run: `grep -E 'ReadWritePaths|CONFIG_FOLDER=/etc/varken|WorkingDirectory' deploy/systemd/varken.service`
Confirm the paths quoted in bare-metal.md (section 5) match this output exactly.

Run: `ls docs/deployment/bare-metal.md`
Expected: file exists.

- [ ] **Step 3: Commit**

```bash
git add docs/deployment/bare-metal.md
git commit -m "docs: add bare-metal systemd deployment guide"
```

---

### Task 4: `docs/deployment/troubleshooting.md`

**Files:**
- Create: `docs/deployment/troubleshooting.md`

**Interfaces:**
- Consumes: nothing (self-contained). May link to README `## Circuit Breaker`, `## Health Checks` anchors.
- Produces: `docs/deployment/troubleshooting.md` — linked from README (Task 5).

- [ ] **Step 1: Write the document**

Create `docs/deployment/troubleshooting.md`. H1 `# Troubleshooting`. Symptom-first sections:

1. **A plugin collects nothing** — check `GET /health/plugins`; look for circuit-breaker state in `GET /status`; causes: auth (`401`/`403` → wrong `apiKey`), wrong API path/version (`404`), SSL (`verifySsl: false` for self-signed). Reference the helpful error hints Varken logs.
2. **An output is unreachable** — Varken skips failed outputs at startup and logs "Started with N/M output(s)"; check the output URL/credentials and `GET /health`.
3. **Circuit breaker is OPEN** — explain CLOSED → OPEN (after `maxConsecutiveErrors`) → HALF-OPEN (after `cooldownSeconds`) → CLOSED (after `recoverySuccesses`), with exponential backoff capped at `maxIntervalSeconds`. Read current state from `GET /status` or the `varken_circuit_breaker_state` metric. Link to `../../README.md#circuit-breaker`.
4. **Reading logs** — Docker: `docker logs -f varken`; systemd: `journalctl -u varken -f`; set `LOG_LEVEL=debug` for detail, `LOG_FORMAT=json` for structured output.
5. **Health & observability endpoints** — table of `/health`, `/health/plugins`, `/status`, `/metrics` with one-line descriptions. Link to `../../README.md#health-checks`.

- [ ] **Step 2: Verify**

Run: `ls docs/deployment/troubleshooting.md && grep -E '/health/plugins|/status|/metrics' docs/deployment/troubleshooting.md`
Expected: file exists and references the endpoints.

- [ ] **Step 3: Commit**

```bash
git add docs/deployment/troubleshooting.md
git commit -m "docs: add consolidated troubleshooting guide"
```

---

### Task 5: Slim README + link to docs + update PLAN

**Files:**
- Modify: `README.md` (`### Manual`, `### Docker Compose` / `### Docker`, `## Troubleshooting` sections)
- Modify: `PLAN.md` (Phase 13 Deployment Documentation)

**Interfaces:**
- Consumes: the four files from Tasks 1-4 (links must point to files that now exist).

- [ ] **Step 1: Add links from README deployment sections**

In `README.md`:
- At the end of the `### Docker Compose` / `### Docker` install content, add: `> For an in-depth Docker guide, see [docs/deployment/docker.md](docs/deployment/docker.md).`
- Replace the body of `### Manual` with a 3-line quickstart (`git clone`, `npm ci && npm run build`, `node dist/index.js`) and: `> For a hardened systemd install, see [docs/deployment/bare-metal.md](docs/deployment/bare-metal.md).`
- At the top of `## Troubleshooting`, add: `> Full symptom-based guide: [docs/deployment/troubleshooting.md](docs/deployment/troubleshooting.md).` Keep the existing short "Common Issues" list; do NOT delete the Health Checks / Prometheus / Grafana / Configuration sections.

- [ ] **Step 2: Verify links resolve**

Run: `for f in docs/deployment/docker.md docs/deployment/bare-metal.md docs/deployment/troubleshooting.md; do ls "$f"; done`
Expected: all three exist (no error).

Run: `grep -c 'docs/deployment/' README.md`
Expected: at least 3 (one link per new doc).

- [ ] **Step 3: Update PLAN.md**

In `PLAN.md`, Phase 13 "Deployment Documentation" block (around lines 440-446): change the header to `#### Deployment Documentation ✅`, mark `- [x]`, and revise the sub-bullets to reflect what shipped (`docs/deployment/docker.md`, `bare-metal.md`, `troubleshooting.md`, `deploy/systemd/varken.service`) and that Kubernetes/Swarm were descoped for the homelab audience. Update the Priority Summary "Deployment docs" row (Low Priority table, ~line 569) to `~~✅~~` consistent with the other completed rows.

- [ ] **Step 4: Commit**

```bash
git add README.md PLAN.md
git commit -m "docs: link README to deployment guides and mark PLAN item complete"
```

---

## Self-Review Notes

- **Spec coverage:** systemd unit (Task 1), docker.md (Task 2), bare-metal.md (Task 3), troubleshooting.md (Task 4), README slimming + PLAN (Task 5). All spec sections mapped.
- **No tests:** documentation only; verification steps are `ls`/`grep` link-and-fact checks, as the spec's Validation section specifies.
- **Consistency:** the systemd unit's paths/env (Task 1) are the single source; Task 3 must match them, and Task 2 verifies this via `grep`.
- **Link targets:** every README anchor referenced (`#configuration`, `#environment-variables`, `#circuit-breaker`, `#health-checks`) corresponds to an existing README section header; no invented anchors.
