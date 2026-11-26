import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { ConfigLoader } from '../../src/config/ConfigLoader';
import { ConfigurationMissingError } from '../../src/config/errors';

// Mock the logger
vi.mock('../../src/core/Logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

describe('ConfigLoader', () => {
  const testConfigFolder = path.join(__dirname, '../.test-config-loader');

  beforeEach(() => {
    // Create test folder
    if (!fs.existsSync(testConfigFolder)) {
      fs.mkdirSync(testConfigFolder, { recursive: true });
    }
    // Clear environment variables
    Object.keys(process.env)
      .filter((key) => key.startsWith('VARKEN_'))
      .forEach((key) => delete process.env[key]);
  });

  afterEach(() => {
    // Clean up test folder
    if (fs.existsSync(testConfigFolder)) {
      fs.rmSync(testConfigFolder, { recursive: true });
    }
  });

  describe('load', () => {
    it('should load valid YAML configuration', () => {
      const yamlContent = `
outputs:
  influxdb1:
    url: localhost
    port: 8086
    username: root
    password: root
    database: varken
    ssl: false
    verifySsl: false

inputs:
  sonarr:
    - id: 1
      url: http://localhost:8989
      apiKey: test-key
      verifySsl: false
      queue:
        enabled: true
        intervalSeconds: 30
      calendar:
        enabled: false
        futureDays: 7
        missingDays: 30
        intervalSeconds: 300
`;
      fs.writeFileSync(path.join(testConfigFolder, 'varken.yaml'), yamlContent);

      const loader = new ConfigLoader(testConfigFolder);
      const config = loader.load();

      expect(config.outputs.influxdb1).toBeDefined();
      expect(config.outputs.influxdb1?.url).toBe('localhost');
      expect(config.inputs.sonarr).toHaveLength(1);
      expect(config.inputs.sonarr?.[0].apiKey).toBe('test-key');
    });

    it('should apply VARKEN_* env overrides', () => {
      const yamlContent = `
outputs:
  influxdb1:
    url: localhost
    port: 8086
    username: root
    password: root
    database: varken
    ssl: false
    verifySsl: false

inputs:
  sonarr:
    - id: 1
      url: http://localhost:8989
      apiKey: test-key
      verifySsl: false
`;
      fs.writeFileSync(path.join(testConfigFolder, 'varken.yaml'), yamlContent);

      // Set env override
      process.env.VARKEN_OUTPUTS_INFLUXDB1_URL = 'influx.override.local';
      process.env.VARKEN_OUTPUTS_INFLUXDB1_PORT = '9999';

      const loader = new ConfigLoader(testConfigFolder);
      const config = loader.load();

      expect(config.outputs.influxdb1?.url).toBe('influx.override.local');
      expect(config.outputs.influxdb1?.port).toBe(9999);
    });

    it('should enable serverInfo through env overrides', () => {
      const yamlContent = `
outputs:
  influxdb1:
    url: localhost
    port: 8086
    username: root
    password: root
    database: varken
    ssl: false
    verifySsl: false

inputs:
  sonarr:
    - id: 1
      url: http://localhost:8989
      apiKey: test-key
`;
      fs.writeFileSync(path.join(testConfigFolder, 'varken.yaml'), yamlContent);
      process.env.VARKEN_INPUTS_SONARR_0_SERVERINFO_ENABLED = 'true';

      const config = new ConfigLoader(testConfigFolder).load();

      expect(config.inputs.sonarr?.[0].serverInfo.enabled).toBe(true);
    });

    it('maps VARKEN_INPUTS_BAZARR_0_LIBRARY_INTERVALDAYS to library.intervalDays', () => {
      const yamlContent = `
outputs:
  influxdb1:
    url: localhost
    port: 8086
    username: root
    password: root
    database: varken
    ssl: false
    verifySsl: false

inputs:
  bazarr:
    - id: 1
      url: http://localhost:6767
      apiKey: test-key
`;
      fs.writeFileSync(path.join(testConfigFolder, 'varken.yaml'), yamlContent);
      process.env.VARKEN_INPUTS_BAZARR_0_LIBRARY_INTERVALDAYS = '3';

      const config = new ConfigLoader(testConfigFolder).load();

      expect(config.inputs.bazarr?.[0].library).toEqual({ enabled: false, intervalDays: 3 });
    });

    it('maps every camelCase config key for env overrides', () => {
      const schemaSource = fs.readFileSync(path.join(__dirname, '../../src/config/schemas/config.schema.ts'), 'utf8');
      const camelKeys = new Set([...schemaSource.matchAll(/^\s+([a-z]+[A-Z][A-Za-z]*):/gm)].map((m) => m[1]));
      const mappings = (ConfigLoader as unknown as { KEY_MAPPINGS: Record<string, string> }).KEY_MAPPINGS;

      const unmapped = [...camelKeys].filter((key) => mappings[key.toLowerCase()] !== key);

      expect(unmapped).toEqual([]);
    });

    it('should parse boolean env overrides', () => {
      const yamlContent = `
outputs:
  influxdb1:
    url: localhost
    port: 8086
    username: root
    password: root
    database: varken
    ssl: false
    verifySsl: false

inputs:
  sonarr:
    - id: 1
      url: http://localhost:8989
      apiKey: test-key
      verifySsl: false
`;
      fs.writeFileSync(path.join(testConfigFolder, 'varken.yaml'), yamlContent);

      process.env.VARKEN_OUTPUTS_INFLUXDB1_SSL = 'true';

      const loader = new ConfigLoader(testConfigFolder);
      const config = loader.load();

      expect(config.outputs.influxdb1?.ssl).toBe(true);
    });

    describe('global.selfMetrics', () => {
      const minimalYaml = `
outputs:
  influxdb1:
    url: localhost
inputs:
  sonarr:
    - id: 1
      url: http://localhost:8989
      apiKey: test-key
`;

      it('defaults to enabled every 60 seconds without a global section', () => {
        fs.writeFileSync(path.join(testConfigFolder, 'varken.yaml'), minimalYaml);

        expect(new ConfigLoader(testConfigFolder).load().global.selfMetrics).toEqual({ enabled: true, intervalSeconds: 60 });
      });

      it('can be disabled through env overrides', () => {
        fs.writeFileSync(path.join(testConfigFolder, 'varken.yaml'), minimalYaml);
        process.env.VARKEN_GLOBAL_SELFMETRICS_ENABLED = 'false';

        expect(new ConfigLoader(testConfigFolder).load().global.selfMetrics?.enabled).toBe(false);
      });

      it('rejects an interval under 10 seconds', () => {
        fs.writeFileSync(path.join(testConfigFolder, 'varken.yaml'), `global:\n  selfMetrics:\n    intervalSeconds: 5\n${minimalYaml}`);

        expect(() => new ConfigLoader(testConfigFolder).load()).toThrow();
      });
    });

    it('should throw error for invalid YAML', () => {
      const yamlContent = `
outputs:
  influxdb1:
    url: localhost
    port: "not a number"  # This should be fine, YAML allows strings
`;
      fs.writeFileSync(path.join(testConfigFolder, 'varken.yaml'), yamlContent);

      const loader = new ConfigLoader(testConfigFolder);
      expect(() => loader.load()).toThrow('Configuration validation failed');
    });

    it('should throw error when no output configured', () => {
      const yamlContent = `
outputs: {}

inputs:
  sonarr:
    - id: 1
      url: http://localhost:8989
      apiKey: test-key
`;
      fs.writeFileSync(path.join(testConfigFolder, 'varken.yaml'), yamlContent);

      const loader = new ConfigLoader(testConfigFolder);
      expect(() => loader.load()).toThrow('At least one output must be configured');
    });

    it('should throw error when no input configured', () => {
      const yamlContent = `
outputs:
  influxdb1:
    url: localhost
    port: 8086
    username: root
    password: root
    database: varken
    ssl: false
    verifySsl: false

inputs: {}
`;
      fs.writeFileSync(path.join(testConfigFolder, 'varken.yaml'), yamlContent);

      const loader = new ConfigLoader(testConfigFolder);
      expect(() => loader.load()).toThrow('At least one input must be configured');
    });

    it('should throw ConfigurationMissingError when config file missing and no migration needed', () => {
      const loader = new ConfigLoader(testConfigFolder);

      let caughtError: ConfigurationMissingError | null = null;
      try {
        loader.load();
      } catch (error) {
        if (error instanceof ConfigurationMissingError) {
          caughtError = error;
        } else {
          throw error;
        }
      }

      expect(caughtError).not.toBeNull();
      expect(caughtError).toBeInstanceOf(ConfigurationMissingError);
      expect(caughtError!.action).toBe('template_created');

      // Verify template was created
      expect(fs.existsSync(path.join(testConfigFolder, 'varken.yaml'))).toBe(true);
    });

    it('should apply default values from schema', () => {
      const yamlContent = `
outputs:
  influxdb1:
    url: localhost

inputs:
  sonarr:
    - id: 1
      url: http://localhost:8989
      apiKey: test-key
`;
      fs.writeFileSync(path.join(testConfigFolder, 'varken.yaml'), yamlContent);

      const loader = new ConfigLoader(testConfigFolder);
      const config = loader.load();

      // Check defaults are applied
      expect(config.outputs.influxdb1?.port).toBe(8086);
      expect(config.outputs.influxdb1?.username).toBe('root');
      expect(config.outputs.influxdb1?.password).toBe('root');
      expect(config.outputs.influxdb1?.database).toBe('varken');
      expect(config.outputs.influxdb1?.ssl).toBe(false);
    });

    it('should support multiple output types', () => {
      const yamlContent = `
outputs:
  influxdb1:
    url: influx1.local
  influxdb2:
    url: influx2.local
    token: test-token

inputs:
  sonarr:
    - id: 1
      url: http://localhost:8989
      apiKey: test-key
`;
      fs.writeFileSync(path.join(testConfigFolder, 'varken.yaml'), yamlContent);

      const loader = new ConfigLoader(testConfigFolder);
      const config = loader.load();

      expect(config.outputs.influxdb1).toBeDefined();
      expect(config.outputs.influxdb2).toBeDefined();
      expect(config.outputs.influxdb2?.token).toBe('test-token');
    });

    it('should support multiple input types', () => {
      const yamlContent = `
outputs:
  influxdb1:
    url: localhost

inputs:
  sonarr:
    - id: 1
      url: http://localhost:8989
      apiKey: sonarr-key
  radarr:
    - id: 1
      url: http://localhost:7878
      apiKey: radarr-key
`;
      fs.writeFileSync(path.join(testConfigFolder, 'varken.yaml'), yamlContent);

      const loader = new ConfigLoader(testConfigFolder);
      const config = loader.load();

      expect(config.inputs.sonarr).toHaveLength(1);
      expect(config.inputs.radarr).toHaveLength(1);
      expect(config.inputs.sonarr?.[0].apiKey).toBe('sonarr-key');
      expect(config.inputs.radarr?.[0].apiKey).toBe('radarr-key');
    });

    it('should override array items via env vars with index', () => {
      const yamlContent = `
outputs:
  influxdb1:
    url: localhost

inputs:
  sonarr:
    - id: 1
      url: http://localhost:8989
      apiKey: original-key
`;
      fs.writeFileSync(path.join(testConfigFolder, 'varken.yaml'), yamlContent);

      // Override array item using index
      process.env.VARKEN_INPUTS_SONARR_0_APIKEY = 'overridden-key';
      process.env.VARKEN_INPUTS_SONARR_0_URL = 'http://sonarr.override.local:8989';

      const loader = new ConfigLoader(testConfigFolder);
      const config = loader.load();

      expect(config.inputs.sonarr?.[0].apiKey).toBe('overridden-key');
      expect(config.inputs.sonarr?.[0].url).toBe('http://sonarr.override.local:8989');
    });

    it('should prioritize env vars over YAML values', () => {
      const yamlContent = `
outputs:
  influxdb1:
    url: yaml-url
    port: 1111
    username: yaml-user
    password: yaml-pass
    database: yaml-db
    ssl: false
    verifySsl: false

inputs:
  sonarr:
    - id: 1
      url: http://yaml-sonarr:8989
      apiKey: yaml-key
`;
      fs.writeFileSync(path.join(testConfigFolder, 'varken.yaml'), yamlContent);

      // Set env overrides - these should take priority
      process.env.VARKEN_OUTPUTS_INFLUXDB1_URL = 'env-url';
      process.env.VARKEN_OUTPUTS_INFLUXDB1_PORT = '2222';
      process.env.VARKEN_OUTPUTS_INFLUXDB1_USERNAME = 'env-user';

      const loader = new ConfigLoader(testConfigFolder);
      const config = loader.load();

      // Env vars should override YAML
      expect(config.outputs.influxdb1?.url).toBe('env-url');
      expect(config.outputs.influxdb1?.port).toBe(2222);
      expect(config.outputs.influxdb1?.username).toBe('env-user');
      // YAML values should remain for non-overridden fields
      expect(config.outputs.influxdb1?.password).toBe('yaml-pass');
      expect(config.outputs.influxdb1?.database).toBe('yaml-db');
    });

    it('should handle invalid number env vars gracefully', () => {
      const yamlContent = `
outputs:
  influxdb1:
    url: localhost
    port: 8086

inputs:
  sonarr:
    - id: 1
      url: http://localhost:8989
      apiKey: test-key
`;
      fs.writeFileSync(path.join(testConfigFolder, 'varken.yaml'), yamlContent);

      // Set invalid number - should be treated as string and fail validation
      process.env.VARKEN_OUTPUTS_INFLUXDB1_PORT = 'not-a-number';

      const loader = new ConfigLoader(testConfigFolder);
      expect(() => loader.load()).toThrow('Configuration validation failed');
    });

    it('should create nested array structures from env vars', () => {
      const yamlContent = `
outputs:
  influxdb1:
    url: localhost

inputs: {}
`;
      fs.writeFileSync(path.join(testConfigFolder, 'varken.yaml'), yamlContent);

      // Create array item via env var (should create the array and object)
      process.env.VARKEN_INPUTS_SONARR_0_ID = '1';
      process.env.VARKEN_INPUTS_SONARR_0_URL = 'http://sonarr.local:8989';
      process.env.VARKEN_INPUTS_SONARR_0_APIKEY = 'env-api-key';

      const loader = new ConfigLoader(testConfigFolder);
      const config = loader.load();

      expect(config.inputs.sonarr).toBeDefined();
      expect(config.inputs.sonarr?.[0].url).toBe('http://sonarr.local:8989');
      expect(config.inputs.sonarr?.[0].apiKey).toBe('env-api-key');
    });

    it('should handle deeply nested env var paths', () => {
      const yamlContent = `
outputs:
  influxdb1:
    url: localhost

inputs:
  sonarr:
    - id: 1
      url: http://localhost:8989
      apiKey: test-key
      queue:
        enabled: true
        intervalSeconds: 30
`;
      fs.writeFileSync(path.join(testConfigFolder, 'varken.yaml'), yamlContent);

      // Override nested value
      process.env.VARKEN_INPUTS_SONARR_0_QUEUE_INTERVALSECONDS = '60';
      process.env.VARKEN_INPUTS_SONARR_0_QUEUE_ENABLED = 'false';

      const loader = new ConfigLoader(testConfigFolder);
      const config = loader.load();

      expect(config.inputs.sonarr?.[0].queue.intervalSeconds).toBe(60);
      expect(config.inputs.sonarr?.[0].queue.enabled).toBe(false);
    });

    it('should create new nested objects from env vars', () => {
      const yamlContent = `
outputs:
  influxdb1:
    url: localhost

inputs:
  sonarr:
    - id: 1
      url: http://localhost:8989
      apiKey: test-key
`;
      fs.writeFileSync(path.join(testConfigFolder, 'varken.yaml'), yamlContent);

      // Create nested object that doesn't exist in YAML
      process.env.VARKEN_INPUTS_SONARR_0_CALENDAR_ENABLED = 'true';
      process.env.VARKEN_INPUTS_SONARR_0_CALENDAR_FUTUREDAYS = '14';

      const loader = new ConfigLoader(testConfigFolder);
      const config = loader.load();

      expect(config.inputs.sonarr?.[0].calendar).toBeDefined();
      expect(config.inputs.sonarr?.[0].calendar.enabled).toBe(true);
      expect(config.inputs.sonarr?.[0].calendar.futureDays).toBe(14);
    });

    it('should support adding multiple array items via env vars', () => {
      const yamlContent = `
outputs:
  influxdb1:
    url: localhost

inputs:
  sonarr:
    - id: 1
      url: http://sonarr1:8989
      apiKey: key1
`;
      fs.writeFileSync(path.join(testConfigFolder, 'varken.yaml'), yamlContent);

      // Add second array item via env var
      process.env.VARKEN_INPUTS_SONARR_1_ID = '2';
      process.env.VARKEN_INPUTS_SONARR_1_URL = 'http://sonarr2:8989';
      process.env.VARKEN_INPUTS_SONARR_1_APIKEY = 'key2';

      const loader = new ConfigLoader(testConfigFolder);
      const config = loader.load();

      expect(config.inputs.sonarr).toHaveLength(2);
      expect(config.inputs.sonarr?.[1].url).toBe('http://sonarr2:8989');
    });
  });
});
