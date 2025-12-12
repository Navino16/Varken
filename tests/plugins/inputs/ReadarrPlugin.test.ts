import { describe, it, expect, vi, beforeEach, Mock } from 'vitest';
import { ReadarrPlugin } from '../../../src/plugins/inputs/ReadarrPlugin';
import { ReadarrConfig } from '../../../src/types/inputs/readarr.types';
import axios from 'axios';

// Mock the logger
vi.mock('../../../src/core/Logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// Mock axios
vi.mock('axios', () => ({
  default: {
    create: vi.fn(() => ({
      get: vi.fn(),
      defaults: {
        headers: {
          common: {},
        },
      },
    })),
  },
}));

describe('ReadarrPlugin', () => {
  let plugin: ReadarrPlugin;
  let mockHttpClient: { get: Mock; defaults: { headers: { common: Record<string, string> } } };

  const testConfig: ReadarrConfig = {
    id: 1,
    url: 'http://localhost:8787',
    apiKey: 'readarr-api-key',
    verifySsl: false,
    queue: {
      enabled: true,
      intervalSeconds: 30,
    },
    missing: {
      enabled: true,
      intervalSeconds: 300,
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    plugin = new ReadarrPlugin();

    mockHttpClient = {
      get: vi.fn(),
      defaults: {
        headers: {
          common: {},
        },
      },
    };
    (axios.create as Mock).mockReturnValue(mockHttpClient);
  });

  describe('metadata', () => {
    it('should have correct metadata', () => {
      expect(plugin.metadata.name).toBe('Readarr');
      expect(plugin.metadata.version).toBe('1.0.0');
      expect(plugin.metadata.description).toBe('Collects queue and missing books data from Readarr');
    });
  });

  describe('initialize', () => {
    it('should initialize with API key header', async () => {
      await plugin.initialize(testConfig);
      expect(mockHttpClient.defaults.headers.common['X-Api-Key']).toBe('readarr-api-key');
    });
  });

  describe('getSchedules', () => {
    it('should return schedules for enabled collectors', async () => {
      await plugin.initialize(testConfig);
      const schedules = plugin.getSchedules();

      expect(schedules.length).toBe(2);
      expect(schedules[0].name).toBe('Readarr_1_queue');
      expect(schedules[0].intervalSeconds).toBe(30);
      expect(schedules[1].name).toBe('Readarr_1_missing');
      expect(schedules[1].intervalSeconds).toBe(300);
    });

    it('should only return queue schedule when missing is disabled', async () => {
      const configWithoutMissing = {
        ...testConfig,
        missing: { ...testConfig.missing, enabled: false },
      };
      await plugin.initialize(configWithoutMissing);
      const schedules = plugin.getSchedules();

      expect(schedules.length).toBe(1);
      expect(schedules[0].name).toBe('Readarr_1_queue');
    });

    it('should only return missing schedule when queue is disabled', async () => {
      const configWithoutQueue = {
        ...testConfig,
        queue: { ...testConfig.queue, enabled: false },
      };
      await plugin.initialize(configWithoutQueue);
      const schedules = plugin.getSchedules();

      expect(schedules.length).toBe(1);
      expect(schedules[0].name).toBe('Readarr_1_missing');
    });
  });

  describe('collect', () => {
    beforeEach(async () => {
      await plugin.initialize(testConfig);
    });

    it('should collect queue data', async () => {
      mockHttpClient.get.mockResolvedValueOnce({
        data: {
          page: 1,
          pageSize: 250,
          totalRecords: 1,
          records: [
            {
              id: 1,
              bookId: 100,
              protocol: 'usenet',
              quality: { quality: { name: 'EPUB' } },
              book: {
                title: 'The Hobbit',
                titleSlug: 'the-hobbit',
              },
              author: {
                authorName: 'J.R.R. Tolkien',
              },
            },
          ],
        },
      });

      // Mock empty missing books
      mockHttpClient.get.mockResolvedValueOnce({ data: [] });

      const points = await plugin.collect();

      expect(points.length).toBeGreaterThan(0);
      const queuePoint = points.find((p) => p.tags.type === 'Queue');
      expect(queuePoint).toBeDefined();
      expect(queuePoint?.tags.name).toBe('The Hobbit - J.R.R. Tolkien');
      expect(queuePoint?.tags.protocol).toBe('USENET');
      expect(queuePoint?.tags.quality).toBe('EPUB');
      expect(queuePoint?.tags.titleSlug).toBe('the-hobbit');
    });

    it('should set protocol_id correctly for usenet', async () => {
      mockHttpClient.get.mockResolvedValueOnce({
        data: {
          totalRecords: 1,
          records: [
            {
              id: 1,
              bookId: 100,
              protocol: 'usenet',
              quality: { quality: { name: 'EPUB' } },
              book: { title: 'Test Book', titleSlug: 'test-book' },
              author: { authorName: 'Test Author' },
            },
          ],
        },
      });
      mockHttpClient.get.mockResolvedValueOnce({ data: [] });

      const points = await plugin.collect();
      const queuePoint = points.find((p) => p.tags.type === 'Queue');
      expect(queuePoint?.tags.protocol_id).toBe(1);
    });

    it('should set protocol_id correctly for torrent', async () => {
      mockHttpClient.get.mockResolvedValueOnce({
        data: {
          totalRecords: 1,
          records: [
            {
              id: 1,
              bookId: 100,
              protocol: 'torrent',
              quality: { quality: { name: 'MOBI' } },
              book: { title: 'Test Book', titleSlug: 'test-book' },
              author: { authorName: 'Test Author' },
            },
          ],
        },
      });
      mockHttpClient.get.mockResolvedValueOnce({ data: [] });

      const points = await plugin.collect();
      const queuePoint = points.find((p) => p.tags.type === 'Queue');
      expect(queuePoint?.tags.protocol_id).toBe(0);
    });

    it('should handle missing author name', async () => {
      mockHttpClient.get.mockResolvedValueOnce({
        data: {
          totalRecords: 1,
          records: [
            {
              id: 1,
              bookId: 100,
              protocol: 'usenet',
              quality: { quality: { name: 'EPUB' } },
              book: { title: 'Unknown Book', titleSlug: 'unknown-book' },
              author: null,
            },
          ],
        },
      });
      mockHttpClient.get.mockResolvedValueOnce({ data: [] });

      const points = await plugin.collect();
      const queuePoint = points.find((p) => p.tags.type === 'Queue');
      expect(queuePoint?.tags.name).toBe('Unknown Book - Unknown Author');
    });

    it('should collect missing books', async () => {
      // Mock empty queue
      mockHttpClient.get.mockResolvedValueOnce({
        data: { totalRecords: 0, records: [] },
      });

      // Mock missing books
      mockHttpClient.get.mockResolvedValueOnce({
        data: [
          {
            id: 1,
            foreignBookId: 'abc123',
            title: '1984',
            titleSlug: '1984',
            author: {
              authorName: 'George Orwell',
            },
          },
          {
            id: 2,
            foreignBookId: 'def456',
            title: 'Animal Farm',
            titleSlug: 'animal-farm',
            author: {
              authorName: 'George Orwell',
            },
          },
        ],
      });

      const points = await plugin.collect();

      const missingPoints = points.filter((p) => p.tags.type === 'Missing');
      expect(missingPoints.length).toBe(2);

      const book1984 = missingPoints.find((p) => p.tags.name === '1984 - George Orwell');
      expect(book1984).toBeDefined();
      expect(book1984?.tags.foreignBookId).toBe('abc123');

      const animalFarm = missingPoints.find((p) => p.tags.name === 'Animal Farm - George Orwell');
      expect(animalFarm).toBeDefined();
    });

    it('should handle missing author in missing books', async () => {
      mockHttpClient.get.mockResolvedValueOnce({
        data: { totalRecords: 0, records: [] },
      });

      mockHttpClient.get.mockResolvedValueOnce({
        data: [
          {
            id: 1,
            foreignBookId: 'xyz789',
            title: 'Mystery Book',
            titleSlug: 'mystery-book',
            author: null,
          },
        ],
      });

      const points = await plugin.collect();

      const missingPoints = points.filter((p) => p.tags.type === 'Missing');
      expect(missingPoints.length).toBe(1);
      expect(missingPoints[0].tags.name).toBe('Mystery Book - Unknown Author');
    });

    it('should handle empty queue gracefully', async () => {
      mockHttpClient.get.mockResolvedValueOnce({
        data: { totalRecords: 0, records: [] },
      });
      mockHttpClient.get.mockResolvedValueOnce({ data: [] });

      const points = await plugin.collect();
      expect(points).toEqual([]);
    });

    it('should handle API errors gracefully', async () => {
      mockHttpClient.get.mockRejectedValueOnce(new Error('API Error'));
      mockHttpClient.get.mockResolvedValueOnce({ data: [] });

      const points = await plugin.collect();
      expect(points).toBeDefined();
    });

    it('should skip queue items without book data', async () => {
      mockHttpClient.get.mockResolvedValueOnce({
        data: {
          totalRecords: 2,
          records: [
            {
              id: 1,
              bookId: 100,
              protocol: 'usenet',
              quality: { quality: { name: 'EPUB' } },
              book: null, // Missing book data
              author: { authorName: 'Author' },
            },
            {
              id: 2,
              bookId: 101,
              protocol: 'usenet',
              quality: { quality: { name: 'EPUB' } },
              book: { title: 'Valid Book', titleSlug: 'valid-book' },
              author: { authorName: 'Valid Author' },
            },
          ],
        },
      });
      mockHttpClient.get.mockResolvedValueOnce({ data: [] });

      const points = await plugin.collect();

      const queuePoints = points.filter((p) => p.tags.type === 'Queue');
      expect(queuePoints.length).toBe(1);
      expect(queuePoints[0].tags.name).toBe('Valid Book - Valid Author');
    });

    it('should paginate through large queues', async () => {
      // First page
      mockHttpClient.get.mockResolvedValueOnce({
        data: {
          page: 1,
          pageSize: 250,
          totalRecords: 2,
          records: [
            {
              id: 1,
              bookId: 100,
              protocol: 'torrent',
              quality: { quality: { name: 'EPUB' } },
              book: { title: 'Book 1', titleSlug: 'book-1' },
              author: { authorName: 'Author 1' },
            },
          ],
        },
      });

      // Second page
      mockHttpClient.get.mockResolvedValueOnce({
        data: {
          page: 2,
          pageSize: 250,
          totalRecords: 2,
          records: [
            {
              id: 2,
              bookId: 101,
              protocol: 'usenet',
              quality: { quality: { name: 'MOBI' } },
              book: { title: 'Book 2', titleSlug: 'book-2' },
              author: { authorName: 'Author 2' },
            },
          ],
        },
      });

      // Missing books mock
      mockHttpClient.get.mockResolvedValueOnce({ data: [] });

      const points = await plugin.collect();

      const queuePoints = points.filter((p) => p.tags.type === 'Queue');
      expect(queuePoints.length).toBe(2);
    });

    it('should generate deterministic hash IDs', async () => {
      const bookData = {
        id: 1,
        bookId: 100,
        protocol: 'usenet',
        quality: { quality: { name: 'EPUB' } },
        book: { title: 'Test Book', titleSlug: 'test-book' },
        author: { authorName: 'Test Author' },
      };

      mockHttpClient.get.mockResolvedValueOnce({
        data: { totalRecords: 1, records: [bookData] },
      });
      mockHttpClient.get.mockResolvedValueOnce({ data: [] });

      const points1 = await plugin.collect();

      // Collect again with same data
      mockHttpClient.get.mockResolvedValueOnce({
        data: { totalRecords: 1, records: [bookData] },
      });
      mockHttpClient.get.mockResolvedValueOnce({ data: [] });

      const points2 = await plugin.collect();

      expect(points1[0].fields.hash).toBe(points2[0].fields.hash);
    });
  });

  describe('shutdown', () => {
    it('should shutdown without error', async () => {
      await plugin.initialize(testConfig);
      await expect(plugin.shutdown()).resolves.toBeUndefined();
    });
  });
});
