import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RequestCache } from '../../src/utils/RequestCache';

describe('RequestCache', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('getOrFetch', () => {
    it('calls the fetcher on a cache miss and caches the result', async () => {
      const cache = new RequestCache<number>({ ttlMs: 1000 });
      const fetcher = vi.fn().mockResolvedValue(42);

      await expect(cache.getOrFetch('a', fetcher)).resolves.toBe(42);
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(cache.size).toBe(1);
    });

    it('returns the cached value on a subsequent call without re-running the fetcher', async () => {
      const cache = new RequestCache<number>({ ttlMs: 1000 });
      const fetcher = vi.fn().mockResolvedValue(1);

      await cache.getOrFetch('a', fetcher);
      await cache.getOrFetch('a', fetcher);

      expect(fetcher).toHaveBeenCalledTimes(1);
    });

    it('refetches after the TTL expires', async () => {
      const cache = new RequestCache<number>({ ttlMs: 100 });
      const fetcher = vi.fn().mockResolvedValue(1);

      await cache.getOrFetch('a', fetcher);
      await vi.advanceTimersByTimeAsync(150);
      await cache.getOrFetch('a', fetcher);

      expect(fetcher).toHaveBeenCalledTimes(2);
    });

    it('caches null values (not just truthy ones)', async () => {
      const cache = new RequestCache<string | null>({ ttlMs: 1000 });
      const fetcher = vi.fn().mockResolvedValue(null);

      await cache.getOrFetch('a', fetcher);
      await cache.getOrFetch('a', fetcher);

      expect(fetcher).toHaveBeenCalledTimes(1);
    });
  });

  describe('deduplication', () => {
    it('only runs the fetcher once for concurrent calls with the same key', async () => {
      const cache = new RequestCache<number>({ ttlMs: 1000 });
      let resolve: (value: number) => void = () => {};
      const fetcher = vi.fn(
        () =>
          new Promise<number>((r) => {
            resolve = r;
          })
      );

      const p1 = cache.getOrFetch('a', fetcher);
      const p2 = cache.getOrFetch('a', fetcher);
      const p3 = cache.getOrFetch('a', fetcher);

      expect(fetcher).toHaveBeenCalledTimes(1);

      resolve(7);
      await expect(Promise.all([p1, p2, p3])).resolves.toEqual([7, 7, 7]);
    });

    it('runs fetchers in parallel for different keys', async () => {
      const cache = new RequestCache<number>({ ttlMs: 1000 });
      const fetcher = vi.fn(async (key: string) => (key === 'a' ? 1 : 2));

      const [a, b] = await Promise.all([
        cache.getOrFetch('a', () => fetcher('a')),
        cache.getOrFetch('b', () => fetcher('b')),
      ]);

      expect(a).toBe(1);
      expect(b).toBe(2);
      expect(fetcher).toHaveBeenCalledTimes(2);
    });

    it('releases the in-flight slot when the fetcher throws', async () => {
      const cache = new RequestCache<number>({ ttlMs: 1000 });
      const fetcher = vi
        .fn()
        .mockRejectedValueOnce(new Error('boom'))
        .mockResolvedValue(9);

      await expect(cache.getOrFetch('a', fetcher)).rejects.toThrow('boom');
      // Second call must be able to retry (in-flight slot cleared)
      await expect(cache.getOrFetch('a', fetcher)).resolves.toBe(9);
      expect(fetcher).toHaveBeenCalledTimes(2);
    });
  });

  describe('maxSize eviction', () => {
    it('evicts the oldest entry when the cache is full', async () => {
      const cache = new RequestCache<number>({ ttlMs: 10_000, maxSize: 2 });

      await cache.getOrFetch('a', async () => 1);
      await cache.getOrFetch('b', async () => 2);
      await cache.getOrFetch('c', async () => 3);

      expect(cache.size).toBe(2);
      expect(cache.peek('a')).toBeUndefined();
      expect(cache.peek('b')).toBe(2);
      expect(cache.peek('c')).toBe(3);
    });

    it('does not evict when overwriting an existing key', async () => {
      const cache = new RequestCache<number>({ ttlMs: 10_000, maxSize: 2 });
      await cache.getOrFetch('a', async () => 1);
      await cache.getOrFetch('b', async () => 2);

      cache.set('a', 99);

      expect(cache.size).toBe(2);
      expect(cache.peek('a')).toBe(99);
      expect(cache.peek('b')).toBe(2);
    });
  });

  describe('peek / delete / clear', () => {
    it('peek returns undefined for missing keys', () => {
      const cache = new RequestCache<number>({ ttlMs: 1000 });
      expect(cache.peek('missing')).toBeUndefined();
    });

    it('peek evicts and returns undefined for expired entries', async () => {
      const cache = new RequestCache<number>({ ttlMs: 100 });
      cache.set('a', 1);
      await vi.advanceTimersByTimeAsync(150);

      expect(cache.peek('a')).toBeUndefined();
      expect(cache.size).toBe(0);
    });

    it('delete removes an entry', () => {
      const cache = new RequestCache<number>({ ttlMs: 1000 });
      cache.set('a', 1);
      cache.delete('a');
      expect(cache.peek('a')).toBeUndefined();
    });

    it('clear empties the cache', () => {
      const cache = new RequestCache<number>({ ttlMs: 1000 });
      cache.set('a', 1);
      cache.set('b', 2);
      cache.clear();
      expect(cache.size).toBe(0);
    });
  });
});
