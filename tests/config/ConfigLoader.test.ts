import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { ConfigLoader } from '../../src/config/ConfigLoader';

// Mock the logger
vi.mock('../../src/core/Logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// Mock process.exit to prevent test from exiting
const mockExit = vi.spyOn(process, 'exit').mockImplementation((code) => {
  throw new Error(`process.exit(${code})`);
});

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
    // Reset mock
    mockExit.mockClear();
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

    it('should call process.exit when config file missing and no migration needed', () => {
      const loader = new ConfigLoader(testConfigFolder);

      expect(() => loader.load()).toThrow('process.exit(0)');
      expect(mockExit).toHaveBeenCalledWith(0);

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
  });
});
