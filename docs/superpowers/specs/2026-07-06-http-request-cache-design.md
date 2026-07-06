# Generic HTTP Request Cache in `httpGet()` — Design

**Date:** 2026-07-06
**Status:** Approved
**PLAN.md item:** Phase 11 → Request Deduplication/Cache

## Context

`src/utils/RequestCache.ts` already exists (TTL + in-flight deduplication, 13 unit
tests) and is already wired into `TautulliPlugin` for GeoIP lookups (per-IP key,
long TTL). This design covers the remaining work: wiring a generic cache into
`BaseInputPlugin.httpGet()` so every input plugin benefits from request
deduplication, with opt-in TTL caching.

Investigation findings that shape the design:

- The natural injection point is `BaseInputPlugin.httpGet()` — all input plugins
  route GET requests through it.
- Each schedule generally targets a distinct endpoint, so cross-schedule *data
  sharing* is marginal. The concrete wins are (a) in-flight deduplication of
  concurrent identical requests (e.g. a health check and a collector racing), and
  (b) opt-in short-TTL caching for tight polling intervals.
- The GeoIP cache is already implemented and is out of scope here.

## Goals

- Deduplicate concurrent identical GET requests within a plugin instance — always
  on, zero staleness risk.
- Provide opt-in TTL caching, disabled by default, configured globally.

## Non-goals

- Per-input `cacheTtlSeconds` override (YAGNI: would touch ~12 separate input
  schemas for marginal value; deduplication is always on regardless). Revisit only
  if a real need emerges.
- Caching `httpPost()` (not idempotent).
- Sharing a cache across plugin instances.

## Design

### 1. `RequestCache` with `ttlMs = 0` yields exactly "dedup on, TTL off"

With `ttlMs = 0`, `set()` stores `expiresAt = now`, so `peek()` evicts immediately
(`expiresAt <= Date.now()`) → no TTL caching. But `getOrFetch()` consults the
`inflight` map before launching a fetch, so concurrent identical calls still share
one promise → in-flight deduplication remains active. No new logic needed in
`RequestCache`.

### 2. Wiring in `BaseInputPlugin`

- Add `private httpCache: RequestCache<unknown>`, created in `initialize()` with
  `ttlMs = this.globalConfig.cacheTtlSeconds * 1000` (default 0) and a default
  `maxSize` (500).
- `httpGet<T>(path, params)` wraps the actual request in
  `this.httpCache.getOrFetch(key, fetcher)`.
- **Cache key:** `` `${path}?${stableStringify(params)}` `` where
  `stableStringify` serializes with sorted keys for determinism. Each instance has
  its own cache, so the `baseURL` is not part of the key.
- `httpPost()` is left unchanged (not cached).
- The existing try/catch + `formatHelpfulError` error handling stays inside the
  fetcher so failures are not cached (the fetcher throws before `set()` runs).

### 3. Config

- Add `cacheTtlSeconds: z.number().min(0).default(0)` to `GlobalConfigSchema`
  (`src/config/schemas/config.schema.ts`).
- Add it to the schema's default transform (~line 279) and to
  `DEFAULT_GLOBAL_CONFIG` in `BaseInputPlugin.ts`.

### 4. GeoIP interaction

No effect. `geoipCache` (per-IP, long TTL) sits in front of `httpGet`; the inner
GET simply gains transient deduplication.

## Testing

`RequestCache` is already covered (13 tests). Add tests on `BaseInputPlugin.httpGet`
(via a minimal concrete test subclass):

- Two concurrent identical GETs → underlying HTTP client called once (dedup).
- With `cacheTtlSeconds > 0`: a second sequential call serves from cache (client
  called once); after TTL expiry it fetches again.
- With `cacheTtlSeconds = 0`: a second sequential call re-fetches (client called
  twice) — TTL off, dedup only.
- Different `params` → distinct keys → separate fetches.
- A failing GET is not cached (next call retries).
- `httpPost` is never cached.

## Files touched

- `src/plugins/inputs/BaseInputPlugin.ts` — cache instance + `httpGet` wrapping +
  `stableStringify` helper + `DEFAULT_GLOBAL_CONFIG`.
- `src/config/schemas/config.schema.ts` — `cacheTtlSeconds` field + default
  transform.
- `tests/plugins/inputs/BaseInputPlugin.test.ts` (new) — httpGet cache tests.
- `README.md` — document `cacheTtlSeconds` global option.
- `PLAN.md` — check off Phase 11 Request Deduplication/Cache.
