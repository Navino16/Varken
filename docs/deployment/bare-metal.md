# Bare-Metal (systemd) Deployment

This guide covers running Varken directly on a Linux host under `systemd`, without Docker.

## Prerequisites

- Node.js 24 or later
- `git`

Verify your Node.js version:

```bash
node --version
```

The output should be `v24.0.0` or higher.

## Dedicated user

Run Varken as an unprivileged, non-interactive system user:

```bash
sudo useradd --system --no-create-home --shell /usr/sbin/nologin varken
```

## Install

Clone the repository into `/opt/varken` and build it:

```bash
sudo git clone https://github.com/Navino16/Varken.git /opt/varken
cd /opt/varken
sudo npm ci
sudo npm run build
```

## Directories

Create the configuration, data, and log directories, and give the `varken` user ownership of the writable ones:

```bash
sudo mkdir -p /etc/varken /var/lib/varken /var/log/varken
sudo chown -R varken:varken /var/lib/varken /var/log/varken
```

Place your `varken.yaml` in `/etc/varken/`. See [Configuration](../../README.md#configuration) for the full file format.

## systemd unit

Copy the unit file shipped in the repository and reload systemd:

```bash
sudo cp /opt/varken/deploy/systemd/varken.service /etc/systemd/system/varken.service
sudo systemctl daemon-reload
```

The provided unit runs Varken as the `varken` user from `/opt/varken` and sets:

- `CONFIG_FOLDER=/etc/varken`
- `DATA_FOLDER=/var/lib/varken`
- `LOG_FOLDER=/var/log/varken`
- `LOG_FORMAT=json`
- `LOG_LEVEL=info`

It also applies systemd hardening: `NoNewPrivileges=true`, `ProtectSystem=strict`, and `ReadWritePaths=/var/lib/varken /var/log/varken` (the only two paths the service can write to, since `ProtectSystem=strict` makes the rest of the filesystem read-only).

## Enable & start

```bash
sudo systemctl enable --now varken
sudo systemctl status varken
```

## Logs

Since the unit sets `LOG_FORMAT=json`, view structured log records with:

```bash
journalctl -u varken -f
```

## Updating

```bash
cd /opt/varken
sudo git pull
sudo npm ci && sudo npm run build
sudo systemctl restart varken
```
