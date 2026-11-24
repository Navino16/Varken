import { describe, it, expect } from 'vitest';
import { expandPathTemplate } from '../../src/utils/pathTemplate';

describe('expandPathTemplate', () => {
  it('returns paths without placeholders unchanged', () => {
    expect(expandPathTemplate('/api/v3/queue')).toBe('/api/v3/queue');
  });

  it('replaces placeholders with URL-encoded values', () => {
    expect(expandPathTemplate('/api/v1/{kind}/{id}', { kind: 'tv show', id: 42 })).toBe('/api/v1/tv%20show/42');
  });

  it('throws when a placeholder has no value', () => {
    expect(() => expandPathTemplate('/api/v1/movie/{movieId}', {})).toThrow(
      'Missing path parameter "movieId" for /api/v1/movie/{movieId}'
    );
  });
});
