import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { ConfigMigrator } from '../../src/config/ConfigMigrator';

// Mock the logger
vi.mock('../../src/core/Logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

describe('ConfigMigrator', () => {
  const testConfigFolder = path.join(__dirname, '../.test-config');

  beforeEach(() => {
    // Create test folder
    if (!fs.existsSync(testConfigFolder)) {
      fs.mkdirSync(testConfigFolder, { recursive: true });
    }
    // Clear environment variables
    Object.keys(process.env)
      .filter((key) => key.startsWith('VRKN_'))
      .forEach((key) => delete process.env[key]);
  });

  afterEach(() => {
    // Clean up test folder
    if (fs.existsSync(testConfigFolder)) {
      fs.rmSync(testConfigFolder, { recursive: true });
    }
  });

  describe('needsMigration', () => {
    it('should return false when no INI file and no VRKN_* env vars', () => {
      const migrator = new ConfigMigrator(testConfigFolder);
      expect(migrator.needsMigration()).toBe(false);
    });

    it('should return true when varken.ini exists', () => {
      fs.writeFileSync(path.join(testConfigFolder, 'varken.ini'), '[global]\n');
      const migrator = new ConfigMigrator(testConfigFolder);
      expect(migrator.needsMigration()).toBe(true);
    });

    it('should return true when VRKN_* env vars exist', () => {
      process.env.VRKN_INFLUXDB_URL = 'localhost';
      const migrator = new ConfigMigrator(testConfigFolder);
      expect(migrator.needsMigration()).toBe(true);
    });
  });

  describe('migrate', () => {
    it('should generate varken.yaml from minimal INI', () => {
      const iniContent = `[global]
sonarr_server_ids = false
radarr_server_ids = false
lidarr_server_ids = false
tautulli_server_ids = false
ombi_server_ids = false
overseerr_server_ids = false

[influxdb]
url = localhost
port = 8086
ssl = false
verify_ssl = false
username = root
password = root
`;
      fs.writeFileSync(path.join(testConfigFolder, 'varken.ini'), iniContent);

      const migrator = new ConfigMigrator(testConfigFolder);
      const yamlPath = migrator.migrate();

      expect(fs.existsSync(yamlPath)).toBe(true);

      const yamlContent = fs.readFileSync(yamlPath, 'utf-8');
      expect(yamlContent).toContain('outputs:');
      expect(yamlContent).toContain('influxdb1:');
      expect(yamlContent).toContain('url: localhost');
    });

    it('should migrate sonarr configuration', () => {
      const iniContent = `[global]
sonarr_server_ids = 1
radarr_server_ids = false
lidarr_server_ids = false
tautulli_server_ids = false
ombi_server_ids = false
overseerr_server_ids = false

[influxdb]
url = localhost
port = 8086
ssl = false
verify_ssl = false
username = root
password = root

[sonarr-1]
url = sonarr.local:8989
apikey = test-api-key
ssl = false
verify_ssl = false
queue = true
queue_run_seconds = 30
missing_days = 7
missing_days_run_seconds = 300
future_days = 1
future_days_run_seconds = 300
`;
      fs.writeFileSync(path.join(testConfigFolder, 'varken.ini'), iniContent);

      const migrator = new ConfigMigrator(testConfigFolder);
      const yamlPath = migrator.migrate();

      const yamlContent = fs.readFileSync(yamlPath, 'utf-8');
      expect(yamlContent).toContain('sonarr:');
      expect(yamlContent).toContain('id: 1');
      expect(yamlContent).toContain('url: http://sonarr.local:8989');
      expect(yamlContent).toContain('apiKey: test-api-key');
    });

    it('should migrate multiple sonarr servers', () => {
      const iniContent = `[global]
sonarr_server_ids = 1,2
radarr_server_ids = false
lidarr_server_ids = false
tautulli_server_ids = false
ombi_server_ids = false
overseerr_server_ids = false

[influxdb]
url = localhost
port = 8086
ssl = false
verify_ssl = false
username = root
password = root

[sonarr-1]
url = sonarr1.local:8989
apikey = api-key-1
ssl = false
verify_ssl = false
queue = true
queue_run_seconds = 30

[sonarr-2]
url = sonarr2.local:8989
apikey = api-key-2
ssl = true
verify_ssl = true
queue = false
queue_run_seconds = 60
`;
      fs.writeFileSync(path.join(testConfigFolder, 'varken.ini'), iniContent);

      const migrator = new ConfigMigrator(testConfigFolder);
      const yamlPath = migrator.migrate();

      const yamlContent = fs.readFileSync(yamlPath, 'utf-8');
      expect(yamlContent).toContain('id: 1');
      expect(yamlContent).toContain('id: 2');
      expect(yamlContent).toContain('url: http://sonarr1.local:8989');
      expect(yamlContent).toContain('url: https://sonarr2.local:8989');
    });

    it('should migrate tautulli with geoip', () => {
      const iniContent = `[global]
sonarr_server_ids = false
radarr_server_ids = false
lidarr_server_ids = false
tautulli_server_ids = 1
ombi_server_ids = false
overseerr_server_ids = false
maxmind_license_key = test-license-key

[influxdb]
url = localhost
port = 8086
ssl = false
verify_ssl = false
username = root
password = root

[tautulli-1]
url = tautulli.local:8181
apikey = tautulli-api-key
ssl = false
verify_ssl = false
fallback_ip = 1.1.1.1
get_activity = true
get_activity_run_seconds = 30
get_libraries = true
get_libraries_run_days = 7
get_stats = true
get_stats_run_seconds = 3600
`;
      fs.writeFileSync(path.join(testConfigFolder, 'varken.ini'), iniContent);

      const migrator = new ConfigMigrator(testConfigFolder);
      const yamlPath = migrator.migrate();

      const yamlContent = fs.readFileSync(yamlPath, 'utf-8');
      expect(yamlContent).toContain('tautulli:');
      expect(yamlContent).toContain('fallbackIp: 1.1.1.1');
      expect(yamlContent).toContain('geoip:');
      expect(yamlContent).toContain('licenseKey: test-license-key');
    });

    it('should apply VRKN_* env overrides', () => {
      const iniContent = `[global]
sonarr_server_ids = false
radarr_server_ids = false
lidarr_server_ids = false
tautulli_server_ids = false
ombi_server_ids = false
overseerr_server_ids = false

[influxdb]
url = localhost
port = 8086
ssl = false
verify_ssl = false
username = root
password = root
`;
      fs.writeFileSync(path.join(testConfigFolder, 'varken.ini'), iniContent);

      // Set env override
      process.env.VRKN_INFLUXDB_URL = 'influx.override.local';
      process.env.VRKN_INFLUXDB_PORT = '9999';

      const migrator = new ConfigMigrator(testConfigFolder);
      const yamlPath = migrator.migrate();

      const yamlContent = fs.readFileSync(yamlPath, 'utf-8');
      expect(yamlContent).toContain('url: influx.override.local');
      expect(yamlContent).toContain('port: 9999');
    });

    it('should add migration header comment', () => {
      const iniContent = `[global]
sonarr_server_ids = false
radarr_server_ids = false
lidarr_server_ids = false
tautulli_server_ids = false
ombi_server_ids = false
overseerr_server_ids = false

[influxdb]
url = localhost
port = 8086
ssl = false
verify_ssl = false
username = root
password = root
`;
      fs.writeFileSync(path.join(testConfigFolder, 'varken.ini'), iniContent);

      const migrator = new ConfigMigrator(testConfigFolder);
      const yamlPath = migrator.migrate();

      const yamlContent = fs.readFileSync(yamlPath, 'utf-8');
      expect(yamlContent).toContain('# Varken Configuration');
      expect(yamlContent).toContain('# Migrated from legacy INI format');
    });

    it('should migrate radarr configuration', () => {
      const iniContent = `[global]
sonarr_server_ids = false
radarr_server_ids = 1
lidarr_server_ids = false
tautulli_server_ids = false
ombi_server_ids = false
overseerr_server_ids = false

[influxdb]
url = localhost
port = 8086
ssl = false
verify_ssl = false
username = root
password = root

[radarr-1]
url = radarr.local:7878
apikey = radarr-api-key
ssl = true
verify_ssl = true
queue = true
queue_run_seconds = 60
get_missing = true
get_missing_run_seconds = 600
`;
      fs.writeFileSync(path.join(testConfigFolder, 'varken.ini'), iniContent);

      const migrator = new ConfigMigrator(testConfigFolder);
      const yamlPath = migrator.migrate();

      const yamlContent = fs.readFileSync(yamlPath, 'utf-8');
      expect(yamlContent).toContain('radarr:');
      expect(yamlContent).toContain('id: 1');
      expect(yamlContent).toContain('url: https://radarr.local:7878');
      expect(yamlContent).toContain('apiKey: radarr-api-key');
      expect(yamlContent).toContain('verifySsl: true');
      expect(yamlContent).toContain('queue:');
      expect(yamlContent).toContain('missing:');
    });

    it('should migrate lidarr configuration', () => {
      const iniContent = `[global]
sonarr_server_ids = false
radarr_server_ids = false
lidarr_server_ids = 1
tautulli_server_ids = false
ombi_server_ids = false
overseerr_server_ids = false

[influxdb]
url = localhost
port = 8086
ssl = false
verify_ssl = false
username = root
password = root

[lidarr-1]
url = lidarr.local:8686
apikey = lidarr-api-key
ssl = false
verify_ssl = false
queue = true
queue_run_seconds = 45
missing_days = 30
missing_days_run_seconds = 600
future_days = 7
`;
      fs.writeFileSync(path.join(testConfigFolder, 'varken.ini'), iniContent);

      const migrator = new ConfigMigrator(testConfigFolder);
      const yamlPath = migrator.migrate();

      const yamlContent = fs.readFileSync(yamlPath, 'utf-8');
      expect(yamlContent).toContain('lidarr:');
      expect(yamlContent).toContain('id: 1');
      expect(yamlContent).toContain('url: http://lidarr.local:8686');
      expect(yamlContent).toContain('apiKey: lidarr-api-key');
      expect(yamlContent).toContain('queue:');
      expect(yamlContent).toContain('missing:');
    });

    it('should migrate ombi configuration', () => {
      const iniContent = `[global]
sonarr_server_ids = false
radarr_server_ids = false
lidarr_server_ids = false
tautulli_server_ids = false
ombi_server_ids = 1
overseerr_server_ids = false

[influxdb]
url = localhost
port = 8086
ssl = false
verify_ssl = false
username = root
password = root

[ombi-1]
url = ombi.local:5000
apikey = ombi-api-key
ssl = false
verify_ssl = false
get_request_type_counts = true
request_type_run_seconds = 300
get_request_total_counts = true
get_issue_status_counts = true
issue_status_run_seconds = 600
`;
      fs.writeFileSync(path.join(testConfigFolder, 'varken.ini'), iniContent);

      const migrator = new ConfigMigrator(testConfigFolder);
      const yamlPath = migrator.migrate();

      const yamlContent = fs.readFileSync(yamlPath, 'utf-8');
      expect(yamlContent).toContain('ombi:');
      expect(yamlContent).toContain('id: 1');
      expect(yamlContent).toContain('url: http://ombi.local:5000');
      expect(yamlContent).toContain('apiKey: ombi-api-key');
      expect(yamlContent).toContain('requestCounts:');
      expect(yamlContent).toContain('issueCounts:');
    });

    it('should migrate overseerr configuration', () => {
      const iniContent = `[global]
sonarr_server_ids = false
radarr_server_ids = false
lidarr_server_ids = false
tautulli_server_ids = false
ombi_server_ids = false
overseerr_server_ids = 1

[influxdb]
url = localhost
port = 8086
ssl = false
verify_ssl = false
username = root
password = root

[overseerr-1]
url = overseerr.local:5055
apikey = overseerr-api-key
ssl = true
verify_ssl = false
get_request_total_counts = true
request_total_run_seconds = 300
get_latest_requests = true
num_latest_requests_to_fetch = 20
num_latest_requests_seconds = 600
`;
      fs.writeFileSync(path.join(testConfigFolder, 'varken.ini'), iniContent);

      const migrator = new ConfigMigrator(testConfigFolder);
      const yamlPath = migrator.migrate();

      const yamlContent = fs.readFileSync(yamlPath, 'utf-8');
      expect(yamlContent).toContain('overseerr:');
      expect(yamlContent).toContain('id: 1');
      expect(yamlContent).toContain('url: https://overseerr.local:5055');
      expect(yamlContent).toContain('apiKey: overseerr-api-key');
      expect(yamlContent).toContain('requestCounts:');
      expect(yamlContent).toContain('latestRequests:');
      expect(yamlContent).toContain('count: 20');
    });

    it('should detect and migrate InfluxDB 2.x configuration', () => {
      const iniContent = `[global]
sonarr_server_ids = false
radarr_server_ids = false
lidarr_server_ids = false
tautulli_server_ids = false
ombi_server_ids = false
overseerr_server_ids = false

[influxdb]
url = influxdb2.local
port = 8086
ssl = true
verify_ssl = true
username = -
password = my-influx2-token
org = myorg
`;
      fs.writeFileSync(path.join(testConfigFolder, 'varken.ini'), iniContent);

      const migrator = new ConfigMigrator(testConfigFolder);
      const yamlPath = migrator.migrate();

      const yamlContent = fs.readFileSync(yamlPath, 'utf-8');
      expect(yamlContent).toContain('influxdb2:');
      expect(yamlContent).toContain('url: influxdb2.local');
      expect(yamlContent).toContain('token: my-influx2-token');
      expect(yamlContent).toContain('org: myorg');
      expect(yamlContent).toContain('bucket: varken');
      expect(yamlContent).not.toContain('influxdb1:');
    });

    it('should handle missing section referenced in global', () => {
      const iniContent = `[global]
sonarr_server_ids = 1,2
radarr_server_ids = false
lidarr_server_ids = false
tautulli_server_ids = false
ombi_server_ids = false
overseerr_server_ids = false

[influxdb]
url = localhost
port = 8086
ssl = false
verify_ssl = false
username = root
password = root

[sonarr-1]
url = sonarr.local:8989
apikey = test-key
ssl = false
verify_ssl = false
queue = true
queue_run_seconds = 30
`;
      // Note: sonarr-2 is referenced but not defined
      fs.writeFileSync(path.join(testConfigFolder, 'varken.ini'), iniContent);

      const migrator = new ConfigMigrator(testConfigFolder);
      const yamlPath = migrator.migrate();

      const yamlContent = fs.readFileSync(yamlPath, 'utf-8');
      expect(yamlContent).toContain('sonarr:');
      expect(yamlContent).toContain('id: 1');
      // sonarr-2 should be filtered out (null returned)
      expect(yamlContent).not.toContain('id: 2');
    });

    it('should handle INI file with comments and empty lines', () => {
      const iniContent = `# This is a comment
; This is also a comment

[global]
# Server configuration
sonarr_server_ids = 1
radarr_server_ids = false
lidarr_server_ids = false
tautulli_server_ids = false
ombi_server_ids = false
overseerr_server_ids = false

[influxdb]
url = localhost
port = 8086
ssl = false
verify_ssl = false
username = root
password = root

[sonarr-1]
; Sonarr instance config
url = sonarr.local:8989
apikey = test-key
ssl = false
verify_ssl = false
queue = true
queue_run_seconds = 30
`;
      fs.writeFileSync(path.join(testConfigFolder, 'varken.ini'), iniContent);

      const migrator = new ConfigMigrator(testConfigFolder);
      const yamlPath = migrator.migrate();

      const yamlContent = fs.readFileSync(yamlPath, 'utf-8');
      expect(yamlContent).toContain('sonarr:');
      expect(yamlContent).toContain('url: http://sonarr.local:8989');
    });

    it('should migrate from env vars only without INI file', () => {
      // Set env vars for a minimal configuration
      process.env.VRKN_GLOBAL_SONARR_SERVER_IDS = 'false';
      process.env.VRKN_GLOBAL_RADARR_SERVER_IDS = 'false';
      process.env.VRKN_GLOBAL_LIDARR_SERVER_IDS = 'false';
      process.env.VRKN_GLOBAL_TAUTULLI_SERVER_IDS = 'false';
      process.env.VRKN_GLOBAL_OMBI_SERVER_IDS = 'false';
      process.env.VRKN_GLOBAL_OVERSEERR_SERVER_IDS = 'false';
      process.env.VRKN_INFLUXDB_URL = 'env-influx.local';
      process.env.VRKN_INFLUXDB_PORT = '8086';
      process.env.VRKN_INFLUXDB_USERNAME = 'envuser';
      process.env.VRKN_INFLUXDB_PASSWORD = 'envpass';

      const migrator = new ConfigMigrator(testConfigFolder);
      const yamlPath = migrator.migrate();

      const yamlContent = fs.readFileSync(yamlPath, 'utf-8');
      expect(yamlContent).toContain('url: env-influx.local');
      expect(yamlContent).toContain('username: envuser');
    });

    it('should handle VRKN_* env vars with server IDs', () => {
      const iniContent = `[global]
sonarr_server_ids = 1
radarr_server_ids = false
lidarr_server_ids = false
tautulli_server_ids = false
ombi_server_ids = false
overseerr_server_ids = false

[influxdb]
url = localhost
port = 8086
ssl = false
verify_ssl = false
username = root
password = root

[sonarr-1]
url = sonarr.local:8989
apikey = ini-key
ssl = false
verify_ssl = false
queue = true
queue_run_seconds = 30
`;
      fs.writeFileSync(path.join(testConfigFolder, 'varken.ini'), iniContent);

      // Override sonarr-1 apikey via env var
      process.env.VRKN_SONARR_1_APIKEY = 'env-override-key';

      const migrator = new ConfigMigrator(testConfigFolder);
      const yamlPath = migrator.migrate();

      const yamlContent = fs.readFileSync(yamlPath, 'utf-8');
      expect(yamlContent).toContain('apiKey: env-override-key');
    });

    it('should use default values when INI values are missing', () => {
      const iniContent = `[global]
sonarr_server_ids = 1
radarr_server_ids = false
lidarr_server_ids = false
tautulli_server_ids = false
ombi_server_ids = false
overseerr_server_ids = false

[influxdb]
url = localhost

[sonarr-1]
url = sonarr.local:8989
`;
      // Missing many fields - should use defaults
      fs.writeFileSync(path.join(testConfigFolder, 'varken.ini'), iniContent);

      const migrator = new ConfigMigrator(testConfigFolder);
      const yamlPath = migrator.migrate();

      const yamlContent = fs.readFileSync(yamlPath, 'utf-8');
      // Should have default port for influxdb
      expect(yamlContent).toContain('port: 8086');
      // Should have default username/password
      expect(yamlContent).toContain('username: root');
      expect(yamlContent).toContain('password: root');
      // Sonarr should have empty apiKey (YAML library uses "" for empty strings)
      expect(yamlContent).toContain('apiKey: ""');
    });
  });
});
