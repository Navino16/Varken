import { describe, it, expect } from 'vitest';
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

    await expect(client.get('/api/v3/movie?x=1')).resolves.toEqual({ data: loadFixture('radarr/movie') });
  });

  it('throws on unregistered paths', async () => {
    const client = createContractHttpClient('radarr');

    await expect(client.get('/api/v3/nope')).rejects.toThrow(/No contract route for GET \/api\/v3\/nope \(radarr\)/);
  });

  it('validates overrides at call time', async () => {
    const client = createContractHttpClient('radarr');
    client.override('/api/v3/movie', [{ title: 'X', raw_timestamp: 1 }]);

    await expect(client.get('/api/v3/movie')).rejects.toThrow(/raw_timestamp/);
  });

  it('accepts valid overrides, including function form', async () => {
    const client = createContractHttpClient('radarr');
    client.override('/api/v3/movie', [{ id: 9, title: 'Override' }]);
    client.override('/api/v3/queue', (params) => ({ page: params?.page, pageSize: 1, totalRecords: 2, records: [] }));

    await expect(client.get('/api/v3/movie')).resolves.toEqual({ data: [{ id: 9, title: 'Override' }] });
    await expect(client.get('/api/v3/queue', { params: { page: 2 } })).resolves.toMatchObject({ data: { page: 2 } });
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

  it('records calls for assertions', async () => {
    const client = createContractHttpClient('radarr');
    await client.get('/api/v3/movie', { params: { a: 1 } });

    expect(client.get).toHaveBeenCalledWith('/api/v3/movie', { params: { a: 1 } });
  });
});
