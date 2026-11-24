import { describe, it, expect, vi } from 'vitest';
import type { Contract, OpenApiDocument } from './spec';
import { findOperation, validateAgainstContract, validateRequestParams, validateResponse } from './validate';

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

  it('only strips the path prefix on a segment boundary', () => {
    const c = contract({ '/apikey/x': jsonGet(objectWithId), '/key/x': jsonGet(objectWithId) }, {}, { pathPrefix: '/api' });

    expect(findOperation(c, 'get', '/apikey/x')).toBeUndefined();
    expect(findOperation(c, 'get', '/api/key/x')?.specPath).toBe('/key/x');
  });

  it('rejects a path missing the service path prefix', () => {
    const c = contract({ '/movies/history': jsonGet(objectWithId) }, {}, { pathPrefix: '/api' });

    expect(findOperation(c, 'get', '/movies/history')).toBeUndefined();
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

  it('rejects unknown properties on a component used both in allOf and directly', () => {
    const c = contract(
      {
        '/a': jsonGet({ type: 'array', items: { $ref: '#/components/schemas/Item' } }),
        '/b': jsonGet({ allOf: [{ $ref: '#/components/schemas/Item' }], nullable: true }),
        '/c': jsonGet({ $ref: '#/components/schemas/Item' }),
      },
      { Item: objectWithId }
    );

    expect(validateAgainstContract(c, 'get', '/a', [{ id: 1, extra: 2 }]).join()).toContain('extra');
    expect(validateAgainstContract(c, 'get', '/c', { id: 1, extra: 2 }).join()).toContain('extra');
    expect(validateAgainstContract(c, 'get', '/b', { id: 1, extra: 2 }).join()).toContain('extra');
  });

  it('accepts null for a nullable allOf reference wrapper', () => {
    const c = contract(
      {
        '/a': jsonGet({
          type: 'object',
          properties: { x: { allOf: [{ $ref: '#/components/schemas/Item' }], nullable: true } },
        }),
      },
      { Item: objectWithId }
    );

    expect(validateAgainstContract(c, 'get', '/a', { x: null })).toEqual([]);
    expect(validateAgainstContract(c, 'get', '/a', { x: { id: 1 } })).toEqual([]);
    expect(validateAgainstContract(c, 'get', '/a', { x: { id: 1, extra: 1 } }).join()).toContain('extra');
  });

  it('rejects keys on additionalProperties false objects without properties', () => {
    const c = contract({ '/a': jsonGet({ type: 'object', additionalProperties: false }) });

    expect(validateAgainstContract(c, 'get', '/a', {})).toEqual([]);
    expect(validateAgainstContract(c, 'get', '/a', { z: 1 }).join()).toContain('z');
  });

  it('accepts parent properties combined with oneOf branches and rejects extras', () => {
    const c = contract(
      {
        '/a': jsonGet({
          type: 'object',
          properties: { kind: { type: 'string' } },
          oneOf: [{ $ref: '#/components/schemas/B' }, { properties: { c: { type: 'integer' } }, required: ['c'] }],
        }),
      },
      { B: { type: 'object', properties: { b: { type: 'integer' } }, required: ['b'] } }
    );

    expect(validateAgainstContract(c, 'get', '/a', { kind: 'x', b: 1 })).toEqual([]);
    expect(validateAgainstContract(c, 'get', '/a', { kind: 'x', c: 1 })).toEqual([]);
    expect(validateAgainstContract(c, 'get', '/a', { kind: 'x', b: 1, extra: 1 }).join()).toContain('extra');
  });

  it('rejects keys on free-form objects without declared properties', () => {
    const c = contract({ '/a': jsonGet({ type: 'object' }) });

    expect(validateAgainstContract(c, 'get', '/a', {})).toEqual([]);
    expect(validateAgainstContract(c, 'get', '/a', { z: 1 }).join()).toContain('z');
  });

  it('strictifies objects nested under patternProperties and conditional keywords', () => {
    const c = contract(
      {
        '/a': jsonGet({
          type: 'object',
          patternProperties: { '^x-': objectWithId },
          if: { properties: { kind: { const: 'movie' } }, required: ['kind'] },
          then: { properties: { kind: { type: 'string' }, tmdbId: { type: 'integer' } } },
          else: { properties: { kind: { type: 'string' } } },
        }),
      },
      {},
      { openapi: '3.1.0' }
    );

    expect(validateAgainstContract(c, 'get', '/a', { kind: 'movie', tmdbId: 1, 'x-a': { id: 1 } })).toEqual([]);
    expect(validateAgainstContract(c, 'get', '/a', { kind: 'movie', 'x-a': { id: 1, extra: 1 } }).join()).toContain('extra');
    expect(validateAgainstContract(c, 'get', '/a', { kind: 'show', tmdbId: 1 }).join()).toContain('tmdbId');
  });

  it('falls back to the default response and accepts JSON media types with parameters', () => {
    const c = contract({
      '/default': { get: { responses: { default: { content: { 'application/json': { schema: objectWithId } } } } } },
      '/profile': {
        get: {
          responses: { 200: { content: { 'application/json; profile="CamelCase"': { schema: objectWithId } } } },
        },
      },
    });

    expect(validateAgainstContract(c, 'get', '/default', { id: 1 })).toEqual([]);
    expect(validateAgainstContract(c, 'get', '/profile', { id: 1 })).toEqual([]);
    expect(validateAgainstContract(c, 'get', '/profile', { id: 1, extra: 1 }).join()).toContain('extra');
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

describe('format overrides', () => {
  it('validates a format with the contract override instead of the standard one', () => {
    const c = contract({ '/a': jsonGet({ type: 'string', format: 'uuid' }) });
    c.formats = [{ name: 'uuid', pattern: '^[0-9a-f]{32}$', why: 'N-format GUIDs' }];

    expect(validateAgainstContract(c, 'get', '/a', '4f2c8e1a9b3d4c7e8f0a1b2c3d4e5f60')).toEqual([]);
    expect(validateAgainstContract(c, 'get', '/a', '4f2c8e1a-9b3d-4c7e-8f0a-1b2c3d4e5f60')).toEqual([
      '/ must match format "uuid"',
    ]);
  });
});

describe('validateRequestParams', () => {
  const c = contract(
    {
      '/a': {
        parameters: [{ $ref: '#/components/parameters/Lang' }],
        get: {
          parameters: [
            { name: 'page', in: 'query', schema: { type: 'integer' } },
            { name: 'ids', in: 'query', schema: { type: 'array', items: { type: 'integer' } } },
            { name: 'kind', in: 'query', required: true, schema: { type: 'string', enum: ['movie', 'show'] } },
            { name: 'X-Trace', in: 'header', schema: { type: 'string' } },
          ],
          responses: { 200: { content: { 'application/json': { schema: objectWithId } } } },
        },
      },
    },
    {}
  );
  c.spec.components = { ...c.spec.components, parameters: { Lang: { name: 'lang', in: 'query', schema: { type: 'string' } } } } as never;

  it('accepts declared query parameters with valid values', () => {
    expect(validateRequestParams(c, 'get', '/a', { kind: 'movie', page: 2, ids: [1, 2], lang: 'en' })).toEqual([]);
  });

  it('ignores parameters whose value is undefined', () => {
    expect(validateRequestParams(c, 'get', '/a', { kind: 'movie', page: undefined })).toEqual([]);
  });

  it('rejects unknown query parameters', () => {
    expect(validateRequestParams(c, 'get', '/a', { kind: 'movie', pages: 2 })).toEqual([
      'unknown query parameter "pages" for GET /a',
    ]);
  });

  it('rejects query parameter values of the wrong type', () => {
    expect(validateRequestParams(c, 'get', '/a', { kind: 'film', page: 'two' }).join()).toMatch(/kind.*page|page.*kind/s);
  });

  it('reports missing required query parameters', () => {
    expect(validateRequestParams(c, 'get', '/a', {})).toEqual(['missing required query parameter "kind" for GET /a']);
  });

  it('checks parameters embedded in the path', () => {
    expect(validateRequestParams(c, 'get', '/a?kind=movie&bogus=1', undefined)).toEqual([
      'unknown query parameter "bogus" for GET /a',
    ]);
  });

  it('reports a missing operation', () => {
    expect(validateRequestParams(c, 'get', '/nope', {})).toEqual(['no GET operation for /nope']);
  });

  it('accepts declared header parameters, whatever their case', () => {
    expect(validateRequestParams(c, 'get', '/a', { 'x-trace': 'abc' }, 'header')).toEqual([]);
  });

  it('rejects undeclared header parameters', () => {
    expect(validateRequestParams(c, 'get', '/a', { 'X-Other': '1' }, 'header')).toEqual([
      'unknown header parameter "X-Other" for GET /a',
    ]);
  });

  it('rejects header values of the wrong type', () => {
    expect(validateRequestParams(c, 'get', '/a', { 'X-Trace': 3 }, 'header')).toEqual([
      'header parameter "X-Trace" must be string',
    ]);
  });
});
