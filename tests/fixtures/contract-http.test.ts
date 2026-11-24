import { describe, it, expect, beforeEach } from 'vitest';
import { createContractHttpClient } from './contract-http';
import { loadFixture } from '../contracts/registry';

type Movie = { title: string };

describe('createContractHttpClient', () => {
  it('serves the registered fixture', async () => {
    const client = createContractHttpClient('radarr');

    await expect(client.get('/api/v3/movie')).resolves.toEqual({ data: loadFixture('radarr/movie') });
  });

  it('returns a fresh copy each call', async () => {
    const client = createContractHttpClient('radarr');

    const first = (await client.get('/api/v3/movie')) as { data: Movie[] };
    first.data[0].title = 'mutated';
    const second = (await client.get('/api/v3/movie')) as { data: Movie[] };

    expect(second.data[0].title).toBe('Heat');
  });

  it('matches paths that carry a query string', async () => {
    const client = createContractHttpClient('radarr');

    await expect(client.get('/api/v3/movie?tmdbId=949')).resolves.toEqual({ data: loadFixture('radarr/movie') });
  });

  it('throws on unregistered paths', async () => {
    const client = createContractHttpClient('radarr');

    await expect(client.get('/api/v3/nope')).rejects.toThrow(/No contract route for GET \/api\/v3\/nope \(radarr\)/);
    expect(client.takeViolations()).toHaveLength(1);
  });

  it('validates static overrides when they are registered', () => {
    const client = createContractHttpClient('radarr');

    expect(() => client.override('/api/v3/movie', [{ title: 'X', raw_timestamp: 1 }])).toThrow(/raw_timestamp/);
  });

  it('validates function overrides at call time', async () => {
    const client = createContractHttpClient('radarr');
    client.override('/api/v3/movie', () => [{ title: 'X', raw_timestamp: 1 }]);

    await expect(client.get('/api/v3/movie')).rejects.toThrow(/raw_timestamp/);
    expect(client.takeViolations().join()).toContain('raw_timestamp');
  });

  it('takeViolations returns and clears recorded violations', async () => {
    const client = createContractHttpClient('radarr');
    await client.get('/api/v3/nope').catch(() => undefined);

    expect(client.takeViolations()).toHaveLength(1);
    expect(client.takeViolations()).toEqual([]);
  });

  it.fails('fails the test when a plugin swallows an unregistered call', async () => {
    const client = createContractHttpClient('radarr');
    await client.get('/api/v3/nope').catch(() => undefined);
  });

  it.fails('fails the test when a plugin swallows a contract violation', async () => {
    const client = createContractHttpClient('radarr');
    client.override('/api/v3/movie', () => [{ raw_timestamp: 1 }]);
    await client.get('/api/v3/movie').catch(() => undefined);
  });

  it('accepts valid overrides, including function form', async () => {
    const client = createContractHttpClient('radarr');
    client.override('/api/v3/movie', [{ id: 9, title: 'Override' }]);
    client.override('/api/v3/queue', (params) => ({ page: params?.page, pageSize: 1, totalRecords: 2, records: [] }));

    await expect(client.get('/api/v3/movie')).resolves.toEqual({ data: [{ id: 9, title: 'Override' }] });
    await expect(client.get('/api/v3/queue', { params: { page: 2 } })).resolves.toMatchObject({ data: { page: 2 } });
  });

  it('passes the called path to function overrides', async () => {
    const client = createContractHttpClient('seerr');
    client.override('/api/v1/movie/{movieId}', (_params, path) => ({ id: Number(path.split('/').pop()), title: path }));

    await expect(client.get('/api/v1/movie/329865')).resolves.toEqual({
      data: { id: 329865, title: '/api/v1/movie/329865' },
    });
  });

  it('rejects undeclared request headers at call time', async () => {
    const client = createContractHttpClient('radarr');

    await expect(client.get('/api/v3/movie', { headers: { 'X-Nope': '1' } })).rejects.toThrow(/unknown header parameter "X-Nope"/);
    client.takeViolations();
  });

  it('overrideUnchecked bypasses validation', async () => {
    const client = createContractHttpClient('radarr');
    client.overrideUnchecked('/api/v3/movie', null);

    await expect(client.get('/api/v3/movie')).resolves.toEqual({ data: null });
  });

  it('fail rejects with the given error', async () => {
    const client = createContractHttpClient('radarr');
    const error = new Error('boom');
    client.fail('/api/v3/movie', error);

    await expect(client.get('/api/v3/movie')).rejects.toBe(error);
  });

  it('refuses to override an unregistered path', () => {
    const client = createContractHttpClient('radarr');

    expect(() => client.override('/api/v3/nope', [])).toThrow(/No contract route/);
    expect(() => client.overrideUnchecked('/api/v3/nope', [])).toThrow(/No contract route/);
    expect(() => client.fail('/api/v3/nope', new Error('x'))).toThrow(/No contract route/);
  });

  it('rejects unknown query parameters at call time', async () => {
    const client = createContractHttpClient('radarr');

    await expect(client.get('/api/v3/movie', { params: { bogus: 1 } })).rejects.toThrow(/unknown query parameter "bogus"/);
    expect(client.takeViolations()).toHaveLength(1);
  });

  it('accepts declared query parameters', async () => {
    const client = createContractHttpClient('radarr');

    await expect(
      client.get('/api/v3/queue', { params: { page: 1, pageSize: 10, includeMovie: true } })
    ).resolves.toMatchObject({ data: { page: 1 } });
  });

  it('records calls for assertions', async () => {
    const client = createContractHttpClient('radarr');
    await client.get('/api/v3/movie', { params: { tmdbId: 1 } });

    expect(client.get).toHaveBeenCalledWith('/api/v3/movie', { params: { tmdbId: 1 } });
  });
});

describe('createContractHttpClient created in beforeEach', () => {
  let client: ReturnType<typeof createContractHttpClient>;

  beforeEach(() => {
    client = createContractHttpClient('radarr');
  });

  it.fails('still fails the test when a plugin swallows a violation', async () => {
    await client.get('/api/v3/nope').catch(() => undefined);
  });
});
