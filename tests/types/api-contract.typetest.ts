// Compile-time contract checks: every @ts-expect-error below must stay an error (npm run typecheck).
import type { ApiClient } from '../../src/types/api-contract';
import type { paths as RadarrPaths } from '../../src/types/generated/radarr';

interface ToyPaths {
  '/items/{id}': {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    get: {
      parameters: { query: { lang: string; limit?: number }; header?: never; path: { id: number }; cookie?: never };
      requestBody?: never;
      responses: { 200: { headers: Record<string, unknown>; content: { 'application/json': { id: number; title: string } } } };
    };
    post?: never;
  };
  '/write-only': {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    get?: never;
    post: { parameters: { query?: never; header?: never; path?: never; cookie?: never }; responses: { 200: { headers: Record<string, unknown>; content?: never } } };
  };
}

declare const radarr: ApiClient<RadarrPaths>;
declare const toy: ApiClient<ToyPaths>;

export async function contractChecks(): Promise<void> {
  const queue = await radarr.get('/api/v3/queue', { query: { includeMovie: true, page: 1 } });
  const firstTitle: string | null | undefined = queue.records?.[0]?.movie?.title;
  const movies = await radarr.get('/api/v3/movie');
  const tmdbIds: (number | undefined)[] = movies.map((m) => m.tmdbId);
  const records = await radarr.getAllPages('/api/v3/queue', { query: { includeMovie: true } });
  const recordIds: (number | undefined)[] = records.map((r) => r.id);
  const item = await toy.get('/items/{id}', { path: { id: 42 }, query: { lang: 'en' } });
  const itemTitle: string = item.title;

  // @ts-expect-error unknown endpoint
  await radarr.get('/api/v3/nope');
  // @ts-expect-error endpoint without GET
  await toy.get('/write-only');
  // @ts-expect-error unknown query parameter
  await radarr.get('/api/v3/queue', { query: { includeMovies: true } });
  // @ts-expect-error wrong query parameter type
  await radarr.get('/api/v3/queue', { query: { page: 'one' } });
  // @ts-expect-error endpoint without parameters
  await radarr.get('/api/v3/system/status', { query: { verbose: true } });
  // @ts-expect-error missing path parameters
  await toy.get('/items/{id}', { query: { lang: 'en' } });
  // @ts-expect-error missing required query parameter
  await toy.get('/items/{id}', { path: { id: 1 } });
  // @ts-expect-error missing options entirely when parameters are required
  await toy.get('/items/{id}');
  // @ts-expect-error response field not declared by the spec
  void item.raw_timestamp;
  // @ts-expect-error paginated helper on a non-paginated endpoint
  await radarr.getAllPages('/api/v3/movie');

  void [firstTitle, tmdbIds, recordIds, itemTitle];
}
