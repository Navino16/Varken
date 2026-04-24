/**
 * In-memory cache with TTL and in-flight request deduplication.
 *
 * Two behaviors on top of a plain `Map`:
 * 1. **TTL** — entries expire after `ttlMs` and are evicted lazily on access.
 * 2. **Deduplication** — concurrent calls to `getOrFetch()` with the same key
 *    share a single in-flight promise, so the underlying fetcher runs once
 *    even under racey access patterns (e.g. a health check and a scheduler
 *    asking for the same resource).
 *
 * `maxSize` caps memory via simple FIFO eviction (insertion order of the Map).
 * Entries are evicted when the cache is full and a new key is inserted.
 */
export interface RequestCacheOptions {
  ttlMs: number;
  maxSize?: number;
}

interface CacheEntry<V> {
  value: V;
  expiresAt: number;
}

export class RequestCache<V = unknown> {
  private readonly ttlMs: number;
  private readonly maxSize: number;
  private readonly store = new Map<string, CacheEntry<V>>();
  private readonly inflight = new Map<string, Promise<V>>();

  constructor(options: RequestCacheOptions) {
    this.ttlMs = options.ttlMs;
    this.maxSize = options.maxSize ?? Infinity;
  }

  /**
   * Look up a fresh value for `key`, running `fetcher` only if there is no
   * usable cached entry and no in-flight request. Multiple concurrent callers
   * with the same key share the same promise.
   */
  async getOrFetch(key: string, fetcher: () => Promise<V>): Promise<V> {
    const fresh = this.peek(key);
    if (fresh !== undefined) {
      return fresh;
    }

    const existing = this.inflight.get(key);
    if (existing) {
      return existing;
    }

    const pending = (async (): Promise<V> => {
      try {
        const value = await fetcher();
        this.set(key, value);
        return value;
      } finally {
        this.inflight.delete(key);
      }
    })();

    this.inflight.set(key, pending);
    return pending;
  }

  /**
   * Return the cached value if present and not expired; undefined otherwise.
   * Expired entries are evicted as a side effect.
   */
  peek(key: string): V | undefined {
    const entry = this.store.get(key);
    if (!entry) {
      return undefined;
    }
    if (entry.expiresAt <= Date.now()) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value;
  }

  /**
   * Overwrite the cached value for `key` (refreshes TTL).
   */
  set(key: string, value: V): void {
    if (this.store.size >= this.maxSize && !this.store.has(key)) {
      const oldest = this.store.keys().next().value;
      if (oldest !== undefined) {
        this.store.delete(oldest);
      }
    }
    this.store.set(key, { value, expiresAt: Date.now() + this.ttlMs });
  }

  delete(key: string): void {
    this.store.delete(key);
    this.inflight.delete(key);
  }

  clear(): void {
    this.store.clear();
    this.inflight.clear();
  }

  get size(): number {
    return this.store.size;
  }
}
