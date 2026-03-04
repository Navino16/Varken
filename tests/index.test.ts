import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { main, VERSION, DEFAULT_HEALTH_PORT, MainDependencies } from '../src/index';

describe('index.ts (Entry Point)', () => {
  const originalEnv = { ...process.env };

  // Mock dependencies
  let mockLogger: {
    info: ReturnType<typeof vi.fn>;
    debug: ReturnType<typeof vi.fn>;
    warn: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
  };
  let mockConfigLoaderInstance: { load: ReturnType<typeof vi.fn> };
  let mockOrchestratorInstance: {
    registerPlugins: ReturnType<typeof vi.fn>;
    start: ReturnType<typeof vi.fn>;
  };
  let MockConfigLoader: new (folder: string) => typeof mockConfigLoaderInstance;
  let MockOrchestrator: new (...args: unknown[]) => typeof mockOrchestratorInstance;
  let mockDeps: MainDependencies;

  const validConfig = {
    outputs: {
      influxdb1: {
        url: 'localhost',
        port: 8086,
        username: 'root',
        password: 'root',
        database: 'varken',
        ssl: false,
        verifySsl: false,
      },
    },
    inputs: {
      sonarr: [
        {
          id: 1,
          url: 'http://localhost',
          apiKey: 'key',
          verifySsl: false,
          queue: { enabled: true, intervalSeconds: 30 },
          calendar: { enabled: false, intervalSeconds: 300, futureDays: 7, missingDays: 30 },
        },
      ],
    },
  };

  beforeEach(() => {
    process.env = { ...originalEnv };
    // Remove env vars to test defaults
    delete process.env.CONFIG_FOLDER;
    delete process.env.DATA_FOLDER;
    delete process.env.HEALTH_PORT;
    delete process.env.HEALTH_ENABLED;
    process.env.NODE_ENV = 'test';

    // Create fresh mocks
    mockLogger = {
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };

    mockConfigLoaderInstance = { load: vi.fn().mockReturnValue(validConfig) };
    mockOrchestratorInstance = {
      registerPlugins: vi.fn(),
      start: vi.fn().mockResolvedValue(undefined),
    };

    // Create mock classes
    MockConfigLoader = class {
      load = mockConfigLoaderInstance.load;
    } as unknown as typeof MockConfigLoader;

    MockOrchestrator = class {
      registerPlugins = mockOrchestratorInstance.registerPlugins;
      start = mockOrchestratorInstance.start;
    } as unknown as typeof MockOrchestrator;

    const mockInputRegistry = new Map([['sonarr', class {}]]);
    const mockOutputRegistry = new Map([['influxdb1', class {}]]);

    mockDeps = {
      createLogger: () => mockLogger as unknown as ReturnType<MainDependencies['createLogger']>,
      ConfigLoader: MockConfigLoader as unknown as MainDependencies['ConfigLoader'],
      Orchestrator: MockOrchestrator as unknown as MainDependencies['Orchestrator'],
      getInputPluginRegistry: () => mockInputRegistry as unknown as ReturnType<MainDependencies['getInputPluginRegistry']>,
      getOutputPluginRegistry: () => mockOutputRegistry as unknown as ReturnType<MainDependencies['getOutputPluginRegistry']>,
    };
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.clearAllMocks();
  });

  describe('Constants', () => {
    it('should export VERSION', () => {
      expect(VERSION).toMatch(/^\d+\.\d+\.\d+/);
    });

    it('should export DEFAULT_HEALTH_PORT', () => {
      expect(DEFAULT_HEALTH_PORT).toBe(9090);
    });
  });

  describe('Environment variables', () => {
    it('should use default CONFIG_FOLDER when not set', async () => {
      await main(mockDeps);

      expect(mockLogger.info).toHaveBeenCalledWith('Config folder: ./config');
    });

    it('should use custom CONFIG_FOLDER when set', async () => {
      process.env.CONFIG_FOLDER = '/custom/config';

      await main(mockDeps);

      expect(mockLogger.info).toHaveBeenCalledWith('Config folder: /custom/config');
    });

    it('should use default DATA_FOLDER when not set', async () => {
      await main(mockDeps);

      expect(mockLogger.info).toHaveBeenCalledWith('Data folder: ./data');
    });

    it('should use custom DATA_FOLDER when set', async () => {
      process.env.DATA_FOLDER = '/custom/data';

      await main(mockDeps);

      expect(mockLogger.info).toHaveBeenCalledWith('Data folder: /custom/data');
    });

    it('should use default HEALTH_PORT when not set', async () => {
      await main(mockDeps);

      expect(mockLogger.info).toHaveBeenCalledWith('Health endpoint: http://0.0.0.0:9090/health');
    });

    it('should use custom HEALTH_PORT when set', async () => {
      process.env.HEALTH_PORT = '8080';

      await main(mockDeps);

      expect(mockLogger.info).toHaveBeenCalledWith('Health endpoint: http://0.0.0.0:8080/health');
    });

    it('should disable health endpoint when HEALTH_ENABLED is false', async () => {
      process.env.HEALTH_ENABLED = 'false';

      await main(mockDeps);

      // Health endpoint log should NOT be present
      const healthCalls = mockLogger.info.mock.calls.filter(
        (call: unknown[]) => typeof call[0] === 'string' && call[0].includes('Health endpoint')
      );
      expect(healthCalls).toHaveLength(0);
    });

    it('should enable health endpoint by default', async () => {
      await main(mockDeps);

      expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('Health endpoint'));
    });

    it('should enable health endpoint when HEALTH_ENABLED is true', async () => {
      process.env.HEALTH_ENABLED = 'true';

      await main(mockDeps);

      expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('Health endpoint'));
    });
  });

  describe('Startup sequence', () => {
    it('should log version on startup', async () => {
      await main(mockDeps);

      expect(mockLogger.info).toHaveBeenCalledWith(`Varken v${VERSION} starting...`);
    });

    it('should load configuration', async () => {
      await main(mockDeps);

      expect(mockConfigLoaderInstance.load).toHaveBeenCalled();
      expect(mockLogger.debug).toHaveBeenCalledWith('Configuration loaded');
    });

    it('should discover and log input plugins', async () => {
      await main(mockDeps);

      expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('Discovered 1 input plugins'));
    });

    it('should discover and log output plugins', async () => {
      await main(mockDeps);

      expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('Discovered 1 output plugins'));
    });

    it('should log plugin names', async () => {
      await main(mockDeps);

      expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('sonarr'));
      expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('influxdb1'));
    });

    it('should register plugins with orchestrator', async () => {
      const mockInputRegistry = new Map([['sonarr', class {}]]);
      const mockOutputRegistry = new Map([['influxdb1', class {}]]);
      mockDeps.getInputPluginRegistry = () => mockInputRegistry as unknown as ReturnType<MainDependencies['getInputPluginRegistry']>;
      mockDeps.getOutputPluginRegistry = () => mockOutputRegistry as unknown as ReturnType<MainDependencies['getOutputPluginRegistry']>;

      await main(mockDeps);

      expect(mockOrchestratorInstance.registerPlugins).toHaveBeenCalledWith({
        inputPlugins: mockInputRegistry,
        outputPlugins: mockOutputRegistry,
      });
    });

    it('should start orchestrator', async () => {
      await main(mockDeps);

      expect(mockOrchestratorInstance.start).toHaveBeenCalled();
    });

    it('should log running message after successful start', async () => {
      await main(mockDeps);

      expect(mockLogger.info).toHaveBeenCalledWith('Varken is running. Press Ctrl+C to stop.');
    });
  });

  describe('Error handling', () => {
    it('should throw on config load failure', async () => {
      mockConfigLoaderInstance.load.mockImplementation(() => {
        throw new Error('Config load failed');
      });

      await expect(main(mockDeps)).rejects.toThrow('Config load failed');
    });

    it('should throw on orchestrator start failure', async () => {
      mockOrchestratorInstance.start.mockRejectedValue(new Error('Failed to start orchestrator'));

      await expect(main(mockDeps)).rejects.toThrow('Failed to start orchestrator');
    });

    it('should throw on ConfigLoader constructor failure', async () => {
      mockDeps.ConfigLoader = class {
        constructor() {
          throw new Error('Invalid config folder');
        }
      } as unknown as MainDependencies['ConfigLoader'];

      await expect(main(mockDeps)).rejects.toThrow('Invalid config folder');
    });

    it('should throw on Orchestrator constructor failure', async () => {
      mockDeps.Orchestrator = class {
        constructor() {
          throw new Error('Invalid orchestrator config');
        }
      } as unknown as MainDependencies['Orchestrator'];

      await expect(main(mockDeps)).rejects.toThrow('Invalid orchestrator config');
    });
  });

  describe('Multiple plugin discovery', () => {
    it('should handle multiple input plugins', async () => {
      const mockInputRegistry = new Map([
        ['sonarr', class {}],
        ['radarr', class {}],
        ['tautulli', class {}],
      ]);
      mockDeps.getInputPluginRegistry = () => mockInputRegistry as unknown as ReturnType<MainDependencies['getInputPluginRegistry']>;

      await main(mockDeps);

      expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('Discovered 3 input plugins'));
      expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('sonarr'));
      expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('radarr'));
      expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('tautulli'));
    });

    it('should handle multiple output plugins', async () => {
      const mockOutputRegistry = new Map([
        ['influxdb1', class {}],
        ['influxdb2', class {}],
      ]);
      mockDeps.getOutputPluginRegistry = () => mockOutputRegistry as unknown as ReturnType<MainDependencies['getOutputPluginRegistry']>;

      await main(mockDeps);

      expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('Discovered 2 output plugins'));
    });

    it('should handle empty plugin registries', async () => {
      mockDeps.getInputPluginRegistry = () => new Map() as unknown as ReturnType<MainDependencies['getInputPluginRegistry']>;
      mockDeps.getOutputPluginRegistry = () => new Map() as unknown as ReturnType<MainDependencies['getOutputPluginRegistry']>;

      await main(mockDeps);

      expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('Discovered 0 input plugins'));
      expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('Discovered 0 output plugins'));
    });
  });
});
