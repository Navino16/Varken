# Generic HTTP Request Cache Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the existing `RequestCache` into `BaseInputPlugin.httpGet()` so all input plugins get in-flight request deduplication (always on) plus opt-in TTL caching (disabled by default).

**Architecture:** `httpGet()` routes every GET through a per-instance `RequestCache`. With `ttlMs = 0` the cache still deduplicates concurrent identical requests but never serves a stored response (immediate expiry), giving "dedup on, TTL off" for free. A new global config field `cacheTtlSeconds` enables TTL caching.

**Tech Stack:** TypeScript, Zod (config schema), Vitest.

## Global Constraints

- All code, comments, and commits in English.
- TypeScript strict mode: `noImplicitAny`, `strictNullChecks`, `noUnusedLocals`, `noUnusedParameters`, `noImplicitReturns`.
- ESLint: `consistent-type-imports` enforced, `eqeqeq` (always `===`), curly braces required.
- `httpPost()` is never cached.
- No per-input `cacheTtlSeconds` override (global only).
- `cacheTtlSeconds` is **optional** in the `GlobalConfig` type (output `number | undefined`), treated as `0` when absent — to avoid breaking the 9 existing `GlobalConfig` literals across the test suite.

---

### Task 1: Add `cacheTtlSeconds` to the global config schema

**Files:**
- Modify: `src/config/schemas/config.schema.ts:212-223` (GlobalConfigSchema)
- Test: `tests/config/index.test.ts`

**Interfaces:**
- Produces: `GlobalConfig.cacheTtlSeconds?: number` (optional, `>= 0`).

- [ ] **Step 1: Write the failing test**

Add to `tests/config/index.test.ts` (import `GlobalConfigSchema` from `../../src/config/schemas/config.schema` if not already imported):

```typescript
import { GlobalConfigSchema } from '../../src/config/schemas/config.schema';

describe('GlobalConfigSchema cacheTtlSeconds', () => {
  it('accepts a non-negative cacheTtlSeconds', () => {
    const parsed = GlobalConfigSchema.parse({ cacheTtlSeconds: 30 });
    expect(parsed.cacheTtlSeconds).toBe(30);
  });

  it('leaves cacheTtlSeconds undefined when omitted', () => {
    const parsed = GlobalConfigSchema.parse({});
    expect(parsed.cacheTtlSeconds).toBeUndefined();
  });

  it('rejects a negative cacheTtlSeconds', () => {
    expect(() => GlobalConfigSchema.parse({ cacheTtlSeconds: -1 })).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/config/index.test.ts`
Expected: FAIL — `cacheTtlSeconds` is `undefined` on parse of `{ cacheTtlSeconds: 30 }` (field not yet in schema), and the negative case does not throw.

- [ ] **Step 3: Add the field to the schema**

In `src/config/schemas/config.schema.ts`, inside `GlobalConfigSchema` (after `maxPaginationRecords`, before the closing `});` at line 223):

```typescript
  /** TTL for the generic HTTP GET cache in seconds. 0 or omitted = dedup only, no TTL caching. */
  cacheTtlSeconds: z.number().min(0).optional(),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/config/index.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/config/schemas/config.schema.ts tests/config/index.test.ts
git commit -m "feat(config): add optional cacheTtlSeconds global option"
```

---

### Task 2: Wire `RequestCache` into `BaseInputPlugin.httpGet()`

**Files:**
- Modify: `src/plugins/inputs/BaseInputPlugin.ts` (imports, `DEFAULT_GLOBAL_CONFIG`, class fields, `initialize()`, `httpGet()`, new private `cacheKey()`)
- Test: `tests/plugins/inputs/BaseInputPlugin.test.ts` (add `testHttpGet`/`testHttpPost` accessors + new `describe('httpGet caching')` block)

**Interfaces:**
- Consumes: `RequestCache` from `../../utils/RequestCache` (`getOrFetch(key, fetcher)`, constructor `{ ttlMs, maxSize }`); `GlobalConfig.cacheTtlSeconds?` from Task 1.
- Produces: `httpGet()` deduplicates concurrent identical calls and caches for `cacheTtlSeconds` seconds; `httpPost()` unchanged.

- [ ] **Step 1: Add test accessors to the `TestInputPlugin` subclass**

In `tests/plugins/inputs/BaseInputPlugin.test.ts`, add these methods inside `class TestInputPlugin` (after `testSafeFetch`, around line 75):

```typescript
  public testHttpGet<T>(path: string, params?: Record<string, unknown>): Promise<T> {
    return this.httpGet<T>(path, params);
  }

  public testHttpPost<T>(path: string, data?: unknown): Promise<T> {
    return this.httpPost<T>(path, data);
  }
```

- [ ] **Step 2: Write the failing tests**

Add a new `describe` block inside the top-level `describe('BaseInputPlugin', ...)` (e.g. after the `safeFetch` block). Note `data: {}` is required because the response interceptor is bypassed (the tests overwrite `.get`), and each test overwrites `get`/`post` directly:

```typescript
  describe('httpGet caching', () => {
    it('deduplicates concurrent identical GETs into a single request', async () => {
      await plugin.initialize(testConfig);
      let resolveGet: (v: { data: unknown }) => void = () => {};
      const getSpy = vi.fn().mockImplementation(
        () => new Promise((res) => { resolveGet = res; })
      );
      plugin.getHttpClient().get = getSpy;

      const p1 = plugin.testHttpGet('/api/x');
      const p2 = plugin.testHttpGet('/api/x');
      resolveGet({ data: { ok: true } });
      await Promise.all([p1, p2]);

      expect(getSpy).toHaveBeenCalledTimes(1);
    });

    it('serves a cached response within cacheTtlSeconds', async () => {
      const customGlobal = { cacheTtlSeconds: 60 } as unknown as GlobalConfig;
      await plugin.initialize(testConfig, customGlobal);
      const getSpy = vi.fn().mockResolvedValue({ data: { ok: true } });
      plugin.getHttpClient().get = getSpy;

      await plugin.testHttpGet('/api/x');
      await plugin.testHttpGet('/api/x');

      expect(getSpy).toHaveBeenCalledTimes(1);
    });

    it('does not cache across sequential calls when cacheTtlSeconds is 0', async () => {
      await plugin.initialize(testConfig); // default: no cacheTtlSeconds -> 0
      const getSpy = vi.fn().mockResolvedValue({ data: { ok: true } });
      plugin.getHttpClient().get = getSpy;

      await plugin.testHttpGet('/api/x');
      await plugin.testHttpGet('/api/x');

      expect(getSpy).toHaveBeenCalledTimes(2);
    });

    it('uses distinct cache keys for different params', async () => {
      const customGlobal = { cacheTtlSeconds: 60 } as unknown as GlobalConfig;
      await plugin.initialize(testConfig, customGlobal);
      const getSpy = vi.fn().mockResolvedValue({ data: { ok: true } });
      plugin.getHttpClient().get = getSpy;

      await plugin.testHttpGet('/api/x', { page: 1 });
      await plugin.testHttpGet('/api/x', { page: 2 });

      expect(getSpy).toHaveBeenCalledTimes(2);
    });

    it('produces the same cache key regardless of param order', async () => {
      const customGlobal = { cacheTtlSeconds: 60 } as unknown as GlobalConfig;
      await plugin.initialize(testConfig, customGlobal);
      const getSpy = vi.fn().mockResolvedValue({ data: { ok: true } });
      plugin.getHttpClient().get = getSpy;

      await plugin.testHttpGet('/api/x', { a: 1, b: 2 });
      await plugin.testHttpGet('/api/x', { b: 2, a: 1 });

      expect(getSpy).toHaveBeenCalledTimes(1);
    });

    it('does not cache a failed GET', async () => {
      const customGlobal = { cacheTtlSeconds: 60 } as unknown as GlobalConfig;
      await plugin.initialize(testConfig, customGlobal);
      const getSpy = vi.fn()
        .mockRejectedValueOnce(new Error('boom'))
        .mockResolvedValueOnce({ data: { ok: true } });
      plugin.getHttpClient().get = getSpy;

      await expect(plugin.testHttpGet('/api/x')).rejects.toThrow('boom');
      await plugin.testHttpGet('/api/x');

      expect(getSpy).toHaveBeenCalledTimes(2);
    });

    it('never caches httpPost', async () => {
      const customGlobal = { cacheTtlSeconds: 60 } as unknown as GlobalConfig;
      await plugin.initialize(testConfig, customGlobal);
      const postSpy = vi.fn().mockResolvedValue({ data: { ok: true } });
      plugin.getHttpClient().post = postSpy;

      await plugin.testHttpPost('/api/x', { a: 1 });
      await plugin.testHttpPost('/api/x', { a: 1 });

      expect(postSpy).toHaveBeenCalledTimes(2);
    });
  });
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm test -- tests/plugins/inputs/BaseInputPlugin.test.ts`
Expected: FAIL — dedup/cache tests fail because `httpGet` currently calls the client directly (getSpy called 2 times where 1 is expected). The "does not cache when 0" / "distinct params" / "post" tests may already pass; that is fine.

- [ ] **Step 4: Implement the cache in `BaseInputPlugin`**

In `src/plugins/inputs/BaseInputPlugin.ts`:

(a) Add the import near the other imports (top of file, respecting `consistent-type-imports` — `RequestCache` is a class, use a value import):

```typescript
import { RequestCache } from '../../utils/RequestCache';
```

(b) Add a `cacheMaxSize` default to `DEFAULT_GLOBAL_CONFIG`? No — `cacheTtlSeconds` is optional and absent means 0. Leave `DEFAULT_GLOBAL_CONFIG` unchanged.

(c) Add a private field for the max cache size and the cache instance. Add after `protected logger` (around line 57):

```typescript
  private static readonly HTTP_CACHE_MAX_SIZE = 500;
  private httpCache!: RequestCache<unknown>;
```

(d) In `initialize()`, create the cache after `this.httpClient = this.createHttpClient();` (around line 75):

```typescript
    const ttlMs = (this.globalConfig.cacheTtlSeconds ?? 0) * 1000;
    this.httpCache = new RequestCache<unknown>({
      ttlMs,
      maxSize: BaseInputPlugin.HTTP_CACHE_MAX_SIZE,
    });
```

(e) Add a private `cacheKey` helper (e.g. after `httpPost`, before `fetchAllPages`):

```typescript
  /**
   * Build a deterministic cache key from path + params (keys sorted so param
   * order does not matter). Each plugin instance has its own cache, so the
   * baseURL is not part of the key.
   */
  private cacheKey(path: string, params?: Record<string, unknown>): string {
    if (!params || Object.keys(params).length === 0) {
      return path;
    }
    const sorted = Object.keys(params)
      .sort()
      .reduce<Record<string, unknown>>((acc, k) => {
        acc[k] = params[k];
        return acc;
      }, {});
    return `${path}?${JSON.stringify(sorted)}`;
  }
```

(f) Replace the body of `httpGet` (lines 184-194) with a cache-wrapped version:

```typescript
  protected async httpGet<T>(path: string, params?: Record<string, unknown>): Promise<T> {
    const key = this.cacheKey(path, params);
    return this.httpCache.getOrFetch(key, async () => {
      try {
        const response = await this.httpClient.get<T>(path, { params });
        return response.data;
      } catch (error) {
        this.logger.error(
          `HTTP GET ${path} failed: ${formatHelpfulError(error, { service: this.metadata.name, url: path })}`
        );
        throw error;
      }
    }) as Promise<T>;
  }
```

Leave `httpPost` unchanged.

- [ ] **Step 5: Run the full test file to verify it passes**

Run: `npm test -- tests/plugins/inputs/BaseInputPlugin.test.ts`
Expected: PASS (all httpGet caching tests plus the pre-existing tests).

- [ ] **Step 6: Run the whole unit suite + build to check nothing regressed**

Run: `npm test && npm run build && npm run lint`
Expected: all tests pass, `tsc` clean, ESLint clean.

- [ ] **Step 7: Commit**

```bash
git add src/plugins/inputs/BaseInputPlugin.ts tests/plugins/inputs/BaseInputPlugin.test.ts
git commit -m "feat(inputs): deduplicate and optionally cache httpGet requests"
```

---

### Task 3: Documentation and PLAN update

**Files:**
- Modify: `README.md` (global config options section)
- Modify: `PLAN.md:372-376` (Phase 11 Request Deduplication/Cache)

- [ ] **Step 1: Document `cacheTtlSeconds` in README**

Find the section documenting global config options (search `README.md` for `httpTimeoutMs`). Add a row/entry consistent with the existing format, for example:

```markdown
| `cacheTtlSeconds` | `0` | TTL for the generic HTTP GET cache (seconds). `0` = deduplicate concurrent identical requests only, no stored caching. |
```

If the existing docs use prose or a YAML example instead of a table, mirror that style — add `cacheTtlSeconds` alongside `httpTimeoutMs` with the same description.

- [ ] **Step 2: Check off the PLAN item**

In `PLAN.md`, update the Phase 11 "Request Deduplication/Cache" block (lines 372-376). Change the header to `#### Request Deduplication/Cache ✅`, mark the checkbox `- [x]`, and note that the GeoIP cache was already implemented and this task added generic httpGet dedup + opt-in TTL via `cacheTtlSeconds`. Also update the Priority Summary row and any test counters per the project's PLAN conventions.

- [ ] **Step 3: Commit**

```bash
git add README.md PLAN.md
git commit -m "docs: document cacheTtlSeconds and mark request cache complete"
```

---

## Self-Review Notes

- **Spec coverage:** dedup (Task 2 tests), opt-in TTL (Task 1 + Task 2 cache-hit test), TTL-off default (Task 2 zero test), distinct params (Task 2), failed GET not cached (Task 2), httpPost never cached (Task 2), config field (Task 1), docs + PLAN (Task 3). GeoIP is already done (out of scope, noted).
- **Deviation from spec:** spec said "new test file"; the file `tests/plugins/inputs/BaseInputPlugin.test.ts` already exists, so tests are appended there.
- **Deviation from spec:** `cacheTtlSeconds` is `optional` (not `.default(0)`) to avoid breaking 9 existing `GlobalConfig` literals; code treats absent as `0`.
- **Added test beyond spec:** param-order-independent key (cheap correctness guarantee for `cacheKey`).
