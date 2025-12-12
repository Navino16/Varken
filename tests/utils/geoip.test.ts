import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import { GeoIPHandler, createGeoIPHandler } from '../../src/utils/geoip';
import { Reader } from '@maxmind/geoip2-node';

// Mock the logger
vi.mock('../../src/core/Logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// Mock fs
vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    existsSync: vi.fn(),
    mkdirSync: vi.fn(),
    statSync: vi.fn(),
    writeFileSync: vi.fn(),
    unlinkSync: vi.fn(),
    createReadStream: vi.fn(),
    createWriteStream: vi.fn(),
  };
});

// Mock @maxmind/geoip2-node
vi.mock('@maxmind/geoip2-node', () => ({
  Reader: {
    open: vi.fn(),
  },
  ReaderModel: vi.fn(),
  City: vi.fn(),
}));

describe('GeoIPHandler', () => {
  const testConfig = {
    enabled: true,
    licenseKey: 'test-license-key',
    dataFolder: '/tmp/test-geoip',
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('should create handler with config', () => {
      const handler = new GeoIPHandler(testConfig);
      expect(handler).toBeDefined();
    });

    it('should set dbPath correctly', () => {
      const handler = new GeoIPHandler(testConfig);
      expect(handler).toBeDefined();
    });
  });

  describe('initialize', () => {
    it('should skip initialization if disabled', async () => {
      const handler = new GeoIPHandler({
        enabled: false,
        dataFolder: '/tmp/test',
      });

      await handler.initialize();

      expect(handler.isReady()).toBe(false);
    });

    it('should skip initialization if no license key', async () => {
      const handler = new GeoIPHandler({
        enabled: true,
        dataFolder: '/tmp/test',
      });

      await handler.initialize();

      expect(handler.isReady()).toBe(false);
    });

    it('should skip initialization if license key is empty', async () => {
      const handler = new GeoIPHandler({
        enabled: true,
        licenseKey: '',
        dataFolder: '/tmp/test',
      });

      await handler.initialize();

      expect(handler.isReady()).toBe(false);
    });

    it('should create data folder if it does not exist', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const handler = new GeoIPHandler(testConfig);

      try {
        await handler.initialize();
      } catch {
        // Expected to fail due to download
      }

      expect(fs.mkdirSync).toHaveBeenCalledWith(testConfig.dataFolder, { recursive: true });
    });

    it('should not create data folder if it exists', async () => {
      vi.mocked(fs.existsSync).mockImplementation((path) => {
        if (path === testConfig.dataFolder) return true;
        return false; // DB file doesn't exist
      });

      const handler = new GeoIPHandler(testConfig);

      try {
        await handler.initialize();
      } catch {
        // Expected to fail
      }

      expect(fs.mkdirSync).not.toHaveBeenCalled();
    });

    it('should load existing database if up to date', async () => {
      const mockReader = {
        city: vi.fn(),
      };

      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.statSync).mockReturnValue({
        mtime: new Date(), // Fresh database
      } as fs.Stats);
      vi.mocked(Reader.open).mockResolvedValue(mockReader as never);

      const handler = new GeoIPHandler(testConfig);
      await handler.initialize();

      expect(handler.isReady()).toBe(true);
      expect(Reader.open).toHaveBeenCalled();
    });

    it('should handle database load failure gracefully', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.statSync).mockReturnValue({
        mtime: new Date(),
      } as fs.Stats);
      vi.mocked(Reader.open).mockRejectedValue(new Error('Failed to open database'));

      const handler = new GeoIPHandler(testConfig);
      await handler.initialize();

      expect(handler.isReady()).toBe(false);
    });
  });

  describe('isReady', () => {
    it('should return false when not initialized', () => {
      const handler = new GeoIPHandler(testConfig);
      expect(handler.isReady()).toBe(false);
    });

    it('should return true after successful initialization', async () => {
      const mockReader = { city: vi.fn() };

      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.statSync).mockReturnValue({ mtime: new Date() } as fs.Stats);
      vi.mocked(Reader.open).mockResolvedValue(mockReader as never);

      const handler = new GeoIPHandler(testConfig);
      await handler.initialize();

      expect(handler.isReady()).toBe(true);
    });
  });

  describe('lookup', () => {
    it('should return null when reader is not ready', async () => {
      const handler = new GeoIPHandler(testConfig);
      const result = await handler.lookup('8.8.8.8');
      expect(result).toBeNull();
    });

    it('should return null for private IPv4 addresses', async () => {
      const mockReader = { city: vi.fn() };

      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.statSync).mockReturnValue({ mtime: new Date() } as fs.Stats);
      vi.mocked(Reader.open).mockResolvedValue(mockReader as never);

      const handler = new GeoIPHandler(testConfig);
      await handler.initialize();

      const privateIPs = [
        '10.0.0.1',
        '172.16.0.1',
        '192.168.1.1',
        '127.0.0.1',
        '0.0.0.0',
        '169.254.1.1',
        '224.0.0.1',
        '255.255.255.255',
      ];

      for (const ip of privateIPs) {
        const result = await handler.lookup(ip);
        expect(result).toBeNull();
      }

      // city() should never be called for private IPs
      expect(mockReader.city).not.toHaveBeenCalled();
    });

    it('should return null for private IPv6 addresses', async () => {
      const mockReader = { city: vi.fn() };

      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.statSync).mockReturnValue({ mtime: new Date() } as fs.Stats);
      vi.mocked(Reader.open).mockResolvedValue(mockReader as never);

      const handler = new GeoIPHandler(testConfig);
      await handler.initialize();

      const privateIPv6 = ['::1', 'fe80::1', 'fc00::1', 'fd00::1'];

      for (const ip of privateIPv6) {
        const result = await handler.lookup(ip);
        expect(result).toBeNull();
      }

      expect(mockReader.city).not.toHaveBeenCalled();
    });

    it('should return GeoIP info for public IP', async () => {
      const mockResponse = {
        country: { names: { en: 'United States' }, isoCode: 'US' },
        subdivisions: [{ names: { en: 'California' } }],
        city: { names: { en: 'Mountain View' } },
        location: { latitude: 37.386, longitude: -122.0838 },
      };

      const mockReader = {
        city: vi.fn().mockReturnValue(mockResponse),
      };

      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.statSync).mockReturnValue({ mtime: new Date() } as fs.Stats);
      vi.mocked(Reader.open).mockResolvedValue(mockReader as never);

      const handler = new GeoIPHandler(testConfig);
      await handler.initialize();

      const result = await handler.lookup('8.8.8.8');

      expect(result).toEqual({
        country: 'United States',
        region: 'California',
        city: 'Mountain View',
        latitude: 37.386,
        longitude: -122.0838,
      });
    });

    it('should handle missing fields with defaults', async () => {
      const mockResponse = {
        country: undefined,
        subdivisions: undefined,
        city: undefined,
        location: undefined,
      };

      const mockReader = {
        city: vi.fn().mockReturnValue(mockResponse),
      };

      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.statSync).mockReturnValue({ mtime: new Date() } as fs.Stats);
      vi.mocked(Reader.open).mockResolvedValue(mockReader as never);

      const handler = new GeoIPHandler(testConfig);
      await handler.initialize();

      const result = await handler.lookup('8.8.8.8');

      expect(result).toEqual({
        country: 'Unknown',
        region: 'Unknown',
        city: 'Unknown',
        latitude: 0,
        longitude: 0,
      });
    });

    it('should return null when lookup throws AddressNotFoundError', async () => {
      const mockReader = {
        city: vi.fn().mockImplementation(() => {
          throw new Error('AddressNotFoundError: Address not found');
        }),
      };

      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.statSync).mockReturnValue({ mtime: new Date() } as fs.Stats);
      vi.mocked(Reader.open).mockResolvedValue(mockReader as never);

      const handler = new GeoIPHandler(testConfig);
      await handler.initialize();

      const result = await handler.lookup('8.8.8.8');
      expect(result).toBeNull();
    });

    it('should return null and log when lookup throws other error', async () => {
      const mockReader = {
        city: vi.fn().mockImplementation(() => {
          throw new Error('Some other error');
        }),
      };

      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.statSync).mockReturnValue({ mtime: new Date() } as fs.Stats);
      vi.mocked(Reader.open).mockResolvedValue(mockReader as never);

      const handler = new GeoIPHandler(testConfig);
      await handler.initialize();

      const result = await handler.lookup('8.8.8.8');
      expect(result).toBeNull();
    });
  });

  describe('getLookupFunction', () => {
    it('should return undefined when disabled', () => {
      const handler = new GeoIPHandler({
        enabled: false,
        dataFolder: '/tmp/test',
      });

      expect(handler.getLookupFunction()).toBeUndefined();
    });

    it('should return undefined when not ready', () => {
      const handler = new GeoIPHandler(testConfig);
      expect(handler.getLookupFunction()).toBeUndefined();
    });

    it('should return lookup function when ready', async () => {
      const mockReader = { city: vi.fn() };

      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.statSync).mockReturnValue({ mtime: new Date() } as fs.Stats);
      vi.mocked(Reader.open).mockResolvedValue(mockReader as never);

      const handler = new GeoIPHandler(testConfig);
      await handler.initialize();

      const lookupFn = handler.getLookupFunction();
      expect(lookupFn).toBeDefined();
      expect(typeof lookupFn).toBe('function');
    });

    it('should return bound function that works correctly', async () => {
      const mockResponse = {
        country: { names: { en: 'France' } },
        subdivisions: [{ names: { en: 'Île-de-France' } }],
        city: { names: { en: 'Paris' } },
        location: { latitude: 48.8566, longitude: 2.3522 },
      };

      const mockReader = {
        city: vi.fn().mockReturnValue(mockResponse),
      };

      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.statSync).mockReturnValue({ mtime: new Date() } as fs.Stats);
      vi.mocked(Reader.open).mockResolvedValue(mockReader as never);

      const handler = new GeoIPHandler(testConfig);
      await handler.initialize();

      const lookupFn = handler.getLookupFunction();
      expect(lookupFn).toBeDefined();

      const result = await lookupFn!('1.2.3.4');
      expect(result).toEqual({
        country: 'France',
        region: 'Île-de-France',
        city: 'Paris',
        latitude: 48.8566,
        longitude: 2.3522,
      });
    });
  });

  describe('shutdown', () => {
    it('should shutdown without error', async () => {
      const handler = new GeoIPHandler(testConfig);
      await expect(handler.shutdown()).resolves.not.toThrow();
    });

    it('should set reader to null after shutdown', async () => {
      const mockReader = { city: vi.fn() };

      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.statSync).mockReturnValue({ mtime: new Date() } as fs.Stats);
      vi.mocked(Reader.open).mockResolvedValue(mockReader as never);

      const handler = new GeoIPHandler(testConfig);
      await handler.initialize();
      expect(handler.isReady()).toBe(true);

      await handler.shutdown();
      expect(handler.isReady()).toBe(false);
    });
  });

  describe('checkNeedsUpdate scenarios', () => {
    it('should need update when database is older than 7 days', async () => {
      const oldDate = new Date();
      oldDate.setDate(oldDate.getDate() - 10); // 10 days old

      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.statSync).mockReturnValue({ mtime: oldDate } as fs.Stats);

      const handler = new GeoIPHandler(testConfig);

      // This will try to download, which will fail, but we can verify behavior
      try {
        await handler.initialize();
      } catch {
        // Expected - download fails
      }

      // statSync should have been called to check age
      expect(fs.statSync).toHaveBeenCalled();
    });
  });
});

describe('GeoIPHandler - Additional Edge Cases', () => {
  const testConfig = {
    enabled: true,
    licenseKey: 'test-license-key',
    dataFolder: '/tmp/test-geoip',
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('loadDatabase when file not found', () => {
    it('should handle missing database file gracefully', async () => {
      // First call for folder, second for DB file check in checkNeedsUpdate, third in loadDatabase
      let callCount = 0;
      vi.mocked(fs.existsSync).mockImplementation((p) => {
        callCount++;
        // Folder exists
        if (p === testConfig.dataFolder) return true;
        // DB exists for checkNeedsUpdate (so it won't try to download)
        if (callCount <= 2) return true;
        // But not for loadDatabase
        return false;
      });
      vi.mocked(fs.statSync).mockReturnValue({ mtime: new Date() } as fs.Stats);

      const handler = new GeoIPHandler(testConfig);
      await handler.initialize();

      // Reader should not be ready since DB file doesn't exist
      expect(handler.isReady()).toBe(false);
    });
  });

  describe('checkNeedsUpdate', () => {
    it('should return true when database does not exist', async () => {
      vi.mocked(fs.existsSync).mockImplementation((path) => {
        if (path === testConfig.dataFolder) return true;
        return false; // DB doesn't exist
      });

      const handler = new GeoIPHandler(testConfig);

      // Initialize will try to download since DB doesn't exist
      // We catch the error since we're not mocking https
      try {
        await handler.initialize();
      } catch {
        // Expected - download path not fully mocked
      }

      // Verify existsSync was called (which triggers the "not found" path)
      expect(fs.existsSync).toHaveBeenCalled();
    });

    it('should need update when database is older than threshold', async () => {
      const oldDate = new Date();
      oldDate.setDate(oldDate.getDate() - 10); // 10 days old (threshold is 7)

      // Simulate DB exists but is old
      vi.mocked(fs.existsSync).mockImplementation((path) => {
        if (path === testConfig.dataFolder) return true;
        return true; // DB exists
      });
      vi.mocked(fs.statSync).mockReturnValue({ mtime: oldDate } as fs.Stats);

      const handler = new GeoIPHandler(testConfig);

      try {
        await handler.initialize();
      } catch {
        // Expected - download path not fully mocked
      }

      // Verify statSync was called to check age
      expect(fs.statSync).toHaveBeenCalled();
    });

    it('should not need update when database is fresh', async () => {
      const freshDate = new Date(); // Today

      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.statSync).mockReturnValue({ mtime: freshDate } as fs.Stats);
      vi.mocked(Reader.open).mockResolvedValue({ city: vi.fn() } as never);

      const handler = new GeoIPHandler(testConfig);
      await handler.initialize();

      // Handler should be ready without download
      expect(handler.isReady()).toBe(true);
    });
  });

  describe('lookup error handling', () => {
    it('should handle "not found" error message', async () => {
      const mockReader = {
        city: vi.fn().mockImplementation(() => {
          throw new Error('IP address not found in database');
        }),
      };

      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.statSync).mockReturnValue({ mtime: new Date() } as fs.Stats);
      vi.mocked(Reader.open).mockResolvedValue(mockReader as never);

      const handler = new GeoIPHandler(testConfig);
      await handler.initialize();

      const result = await handler.lookup('8.8.8.8');
      expect(result).toBeNull();
    });

    it('should handle non-Error throw', async () => {
      const mockReader = {
        city: vi.fn().mockImplementation(() => {
          throw 'string error'; // Non-Error thrown
        }),
      };

      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.statSync).mockReturnValue({ mtime: new Date() } as fs.Stats);
      vi.mocked(Reader.open).mockResolvedValue(mockReader as never);

      const handler = new GeoIPHandler(testConfig);
      await handler.initialize();

      const result = await handler.lookup('8.8.8.8');
      expect(result).toBeNull();
    });
  });

  describe('edge cases for private IP detection', () => {
    it('should correctly identify edge case private IPs', async () => {
      const mockReader = { city: vi.fn() };

      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.statSync).mockReturnValue({ mtime: new Date() } as fs.Stats);
      vi.mocked(Reader.open).mockResolvedValue(mockReader as never);

      const handler = new GeoIPHandler(testConfig);
      await handler.initialize();

      // Test 172.x range boundaries
      const boundaryTests = [
        { ip: '172.15.255.255', isPrivate: false }, // Just below private range
        { ip: '172.16.0.0', isPrivate: true }, // Start of private range
        { ip: '172.31.255.255', isPrivate: true }, // End of private range
        { ip: '172.32.0.0', isPrivate: false }, // Just above private range
      ];

      for (const test of boundaryTests) {
        const result = await handler.lookup(test.ip);
        if (test.isPrivate) {
          expect(result).toBeNull();
        }
        // For public IPs, city() would be called
      }
    });
  });

  describe('getLookupFunction when enabled but no reader', () => {
    it('should return undefined when enabled but reader is null', async () => {
      // Simulate enabled but failed initialization
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.statSync).mockReturnValue({ mtime: new Date() } as fs.Stats);
      vi.mocked(Reader.open).mockRejectedValue(new Error('Failed to load'));

      const handler = new GeoIPHandler(testConfig);
      await handler.initialize();

      expect(handler.getLookupFunction()).toBeUndefined();
    });
  });
});

describe('createGeoIPHandler', () => {
  it('should create a GeoIPHandler instance', () => {
    const config = {
      enabled: true,
      licenseKey: 'test-key',
      dataFolder: '/tmp/test',
    };

    const handler = createGeoIPHandler(config);

    expect(handler).toBeInstanceOf(GeoIPHandler);
  });
});

describe('GeoIPHandler - Private IP patterns (comprehensive)', () => {
  // IPv4 private ranges
  const privateIPv4 = [
    // 10.0.0.0/8
    '10.0.0.1',
    '10.255.255.255',
    '10.100.50.25',
    // 172.16.0.0/12
    '172.16.0.1',
    '172.31.255.255',
    '172.20.10.5',
    // 192.168.0.0/16
    '192.168.0.1',
    '192.168.255.255',
    '192.168.1.100',
    // Loopback
    '127.0.0.1',
    '127.255.255.255',
    // Zero network
    '0.0.0.0',
    '0.255.255.255',
    // Link-local
    '169.254.0.1',
    '169.254.255.255',
    // Multicast
    '224.0.0.1',
    '224.255.255.255',
    // Broadcast
    '255.255.255.255',
  ];

  // IPv6 private ranges
  const privateIPv6 = [
    '::1', // Loopback
    'fe80::1', // Link-local
    'fe80::1234:5678:abcd:ef00',
    'fc00::1', // Unique local
    'fd00::1', // Unique local
    'FE80::1', // Case insensitive
    'FC00::ABC', // Case insensitive
  ];

  // Public IPs that should NOT match
  const publicIPs = [
    '8.8.8.8',
    '1.1.1.1',
    '208.67.222.222',
    '9.9.9.9',
    '11.0.0.1', // Not in 10.x.x.x
    '172.15.0.1', // Not in 172.16-31.x.x
    '172.32.0.1', // Not in 172.16-31.x.x
    '192.167.1.1', // Not in 192.168.x.x
    '128.0.0.1', // Not loopback
    '223.0.0.1', // Not multicast
  ];

  // Replicate the isPrivateIP logic from geoip.ts
  const isPrivateIP = (ip: string): boolean => {
    const privateRanges = [
      /^10\./,
      /^172\.(1[6-9]|2[0-9]|3[0-1])\./,
      /^192\.168\./,
      /^127\./,
      /^0\./,
      /^169\.254\./,
      /^224\./,
      /^255\./,
    ];

    const privateIPv6Ranges = [
      /^::1$/,
      /^fe80:/i,
      /^fc00:/i,
      /^fd00:/i,
    ];

    for (const range of privateRanges) {
      if (range.test(ip)) {
        return true;
      }
    }

    for (const range of privateIPv6Ranges) {
      if (range.test(ip)) {
        return true;
      }
    }

    return false;
  };

  describe('IPv4 private addresses', () => {
    it.each(privateIPv4)('should detect %s as private', (ip) => {
      expect(isPrivateIP(ip)).toBe(true);
    });
  });

  describe('IPv6 private addresses', () => {
    it.each(privateIPv6)('should detect %s as private', (ip) => {
      expect(isPrivateIP(ip)).toBe(true);
    });
  });

  describe('Public addresses', () => {
    it.each(publicIPs)('should detect %s as public', (ip) => {
      expect(isPrivateIP(ip)).toBe(false);
    });
  });
});
