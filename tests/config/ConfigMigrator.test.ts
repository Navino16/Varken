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
  });
});
