import { describe, it, expect, vi } from 'vitest';
import type { Contract, OpenApiDocument } from './spec';
import { findOperation, validateAgainstContract, validateResponse } from './validate';

function contract(
  paths: OpenApiDocument['paths'],
  schemas: Record<string, unknown> = {},
  { pathPrefix = '', openapi = '3.0.4' }: { pathPrefix?: string; openapi?: string } = {}
): Contract {
  return {
    service: 'radarr',
    entry: {
      file: 'toy.json',
      format: openapi.startsWith('3.1') ? 'openapi3.1' : 'openapi3.0',
      source: 'toy',
      version: '0',
      pathPrefix,
      refresh: false,
    },
    spec: { openapi, paths, components: { schemas } },
  };
}

function jsonGet(schema: unknown): Record<string, unknown> {
  return { get: { responses: { 200: { content: { 'application/json': { schema } } } } } };
}

const objectWithId = { type: 'object', properties: { id: { type: 'integer' } } };

describe('findOperation', () => {
  it('matches templated paths and ignores query strings', () => {
    const c = contract({ '/api/v1/movie/{movieId}': jsonGet(objectWithId) });

    expect(findOperation(c, 'get', '/api/v1/movie/42?language=en')?.specPath).toBe('/api/v1/movie/{movieId}');
    expect(findOperation(c, 'get', '/api/v1/movie/')).toBeUndefined();
  });

  it('prefers an exact path over a template', () => {
    const c = contract({ '/items/{id}': jsonGet(objectWithId), '/items/count': jsonGet(objectWithId) });

    expect(findOperation(c, 'get', '/items/count')?.specPath).toBe('/items/count');
  });

  it('strips the service path prefix', () => {
    const c = contract({ '/movies/history': jsonGet(objectWithId) }, {}, { pathPrefix: '/api' });

    expect(findOperation(c, 'get', '/api/movies/history')?.specPath).toBe('/movies/history');
  });
});

describe('validateAgainstContract', () => {
  it('reports a missing operation', () => {
    const c = contract({});

    expect(validateAgainstContract(c, 'get', '/nope', {})).toContain('no GET operation for /nope');
  });

  it('reports an operation without a JSON 200 schema', () => {
    const c = contract({
      '/text': { get: { responses: { 200: { content: { 'text/plain': { schema: { type: 'string' } } } } } } },
    });

    expect(validateAgainstContract(c, 'get', '/text', 'x')).toContain(
      'no application/json 200 response schema for GET /text'
    );
  });

  it('rejects undeclared properties', () => {
    const c = contract({ '/a': jsonGet(objectWithId) });

    const errors = validateAgainstContract(c, 'get', '/a', { id: 1, raw_timestamp: 2 });

    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('raw_timestamp');
  });

  it('rejects undeclared properties even when additionalProperties is true', () => {
    const c = contract({ '/a': jsonGet({ ...objectWithId, additionalProperties: true }) });

    expect(validateAgainstContract(c, 'get', '/a', { id: 1, extra: true })[0]).toContain('extra');
  });

  it('keeps map objects whose additionalProperties is a schema', () => {
    const c = contract({ '/a': jsonGet({ type: 'object', additionalProperties: { type: 'string' } }) });

    expect(validateAgainstContract(c, 'get', '/a', { any: 'x' })).toEqual([]);
    expect(validateAgainstContract(c, 'get', '/a', { any: 1 })).not.toEqual([]);
  });

  it('accepts allOf compositions and rejects extra properties on them', () => {
    const c = contract(
      { '/a': jsonGet({ allOf: [{ $ref: '#/components/schemas/Base' }, { properties: { title: { type: 'string' } } }] }) },
      { Base: objectWithId }
    );

    expect(validateAgainstContract(c, 'get', '/a', { id: 1, title: 't' })).toEqual([]);
    expect(validateAgainstContract(c, 'get', '/a', { id: 1, title: 't', extra: 1 })[0]).toContain('extra');
  });

  it('handles nullable', () => {
    const c = contract({
      '/a': jsonGet({
        type: 'object',
        properties: { maybe: { type: 'string', nullable: true }, never: { type: 'string' } },
      }),
    });

    expect(validateAgainstContract(c, 'get', '/a', { maybe: null })).toEqual([]);
    expect(validateAgainstContract(c, 'get', '/a', { never: null })).not.toEqual([]);
  });

  it('resolves component refs', () => {
    const c = contract(
      { '/a': jsonGet({ type: 'array', items: { $ref: '#/components/schemas/Item' } }) },
      { Item: objectWithId }
    );

    expect(validateAgainstContract(c, 'get', '/a', [{ id: 1 }])).toEqual([]);
    expect(validateAgainstContract(c, 'get', '/a', [{ id: 'x' }])).not.toEqual([]);
  });

  it('ignores numeric formats', () => {
    const c = contract({
      '/a': jsonGet({
        type: 'object',
        properties: { i: { type: 'integer', format: 'int32' }, d: { type: 'number', format: 'double' } },
      }),
    });

    expect(validateAgainstContract(c, 'get', '/a', { i: 1, d: 1.5 })).toEqual([]);
  });

  it('knows the Servarr date-span format without warning', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const c = contract({ '/a': jsonGet({ type: 'object', properties: { t: { type: 'string', format: 'date-span' } } }) });

    expect(validateAgainstContract(c, 'get', '/a', { t: '01:30:00' })).toEqual([]);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('uses OpenAPI 3.1 schemas as JSON Schema', () => {
    const c = contract(
      { '/a': jsonGet({ type: 'object', properties: { v: { type: ['string', 'null'] } } }) },
      {},
      { openapi: '3.1.0' }
    );

    expect(validateAgainstContract(c, 'get', '/a', { v: null })).toEqual([]);
    expect(validateAgainstContract(c, 'get', '/a', { v: null, w: 1 })[0]).toContain('w');
  });
});

describe('validateResponse', () => {
  it('validates a Radarr movie list', () => {
    expect(validateResponse('radarr', 'get', '/api/v3/movie', [{ id: 1, title: 'Heat', monitored: true }])).toEqual([]);
  });

  it('rejects an invented field on a real Radarr resource', () => {
    const errors = validateResponse('radarr', 'get', '/api/v3/movie', [{ id: 1, raw_timestamp: 2 }]);

    expect(errors.join()).toContain('raw_timestamp');
  });
});
