import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { contractHash, loadContract, resetContractCache, upgradeSwagger2 } from './spec';

const contractsDir = path.resolve(__dirname, '..');
const overlayPath = path.join(contractsDir, 'overlays', 'radarr.json');
const manifestPath = path.join(contractsDir, 'specs', 'manifest.json');

function serialize(content: unknown): string {
  return typeof content === 'string' ? content : JSON.stringify(content);
}

function fakeFiles(files: Record<string, unknown>): void {
  const realExists = fs.existsSync;
  const realRead = fs.readFileSync;
  vi.spyOn(fs, 'existsSync').mockImplementation((p) => String(p) in files || realExists(p));
  vi.spyOn(fs, 'readFileSync').mockImplementation(((p: fs.PathOrFileDescriptor, options?: unknown) =>
    String(p) in files ? serialize(files[String(p)]) : realRead(p, options as BufferEncoding)) as typeof fs.readFileSync);
}

function fakeFile(target: string, content: unknown): void {
  fakeFiles({ [target]: content });
}

const swaggerDocument = {
  swagger: '2.0',
  basePath: '/api',
  info: { title: 'Toy', version: '1' },
  paths: {
    '/movies/wanted': {
      get: {
        parameters: [{ name: 'length', in: 'query', type: 'integer', default: -1 }],
        responses: { 401: { description: 'Not Authenticated' } },
      },
    },
  },
};

const overlay = {
  patches: [{ op: 'add', path: '/info/x-varken-test', value: true, why: 'test overlay' }],
};

describe('contract loading', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    resetContractCache();
  });

  it('loads the pinned Radarr contract', () => {
    const contract = loadContract('radarr');

    expect(contract.spec.openapi.startsWith('3.0')).toBe(true);
    expect(contract.spec.paths['/api/v3/queue']).toBeDefined();
    expect(contract.entry.pathPrefix).toBe('');
  });

  it('applies the service overlay when present', () => {
    fakeFile(overlayPath, overlay);

    const spec = loadContract('radarr').spec as unknown as { info: Record<string, unknown> };

    expect(spec.info['x-varken-test']).toBe(true);
  });

  it('upgrades swagger2 documents to OpenAPI 3.0', () => {
    const spec = upgradeSwagger2(swaggerDocument, '/api');
    const parameters = spec.paths['/movies/wanted'].get as { parameters: { name: string; schema: { type: string } }[] };

    expect(spec.openapi.startsWith('3.0')).toBe(true);
    expect(parameters.parameters[0]).toMatchObject({ name: 'length', schema: { type: 'integer' } });
  });

  it('rejects a pathPrefix that differs from basePath', () => {
    expect(() => upgradeSwagger2(swaggerDocument, '')).toThrow(/basePath/);
  });

  it('applies the overlay after the upgrade', () => {
    const response = { description: 'OK', content: { 'application/json': { schema: { type: 'object' } } } };
    fakeFiles({
      [manifestPath]: {
        bazarr: { file: 'bazarr.json', format: 'swagger2', source: 'runtime', version: 'v1', pathPrefix: '/api', refresh: false },
      },
      [path.join(contractsDir, 'specs', 'bazarr.json')]: swaggerDocument,
      [path.join(contractsDir, 'overlays', 'bazarr.json')]: {
        patches: [{ op: 'add', path: '/paths/~1movies~1wanted/get/responses/200', value: response, why: 'test overlay' }],
      },
    });

    const operation = loadContract('bazarr').spec.paths['/movies/wanted'].get as { responses: Record<string, unknown> };

    expect(operation.responses['200']).toEqual(response);
  });

  it('loads YAML specs', () => {
    fakeFiles({
      [manifestPath]: {
        radarr: { file: 'toy.yml', format: 'openapi3.0', source: 'test', version: 'v1', pathPrefix: '/api/v1', refresh: false },
      },
      [path.join(contractsDir, 'specs', 'toy.yml')]:
        "openapi: '3.0.2'\npaths:\n  /status:\n    get:\n      responses:\n        '200':\n          description: ok\n",
    });

    const spec = loadContract('radarr').spec;

    expect(spec.openapi).toBe('3.0.2');
    expect(spec.paths['/status']).toBeDefined();
  });

  it('exposes overlay format overrides', () => {
    fakeFile(overlayPath, { patches: [], formats: [{ name: 'uuid', pattern: '^[0-9a-f]{32}$', why: 'N-format GUIDs' }] });

    expect(loadContract('radarr').formats).toEqual([{ name: 'uuid', pattern: '^[0-9a-f]{32}$', why: 'N-format GUIDs' }]);
  });

  it('rejects a format override without a why', () => {
    fakeFile(overlayPath, { patches: [], formats: [{ name: 'uuid', pattern: '^x$', why: ' ' }] });

    expect(() => loadContract('radarr')).toThrow(/format override uuid needs a why/);
  });

  it('hash is stable and changes with the spec', () => {
    const first = contractHash('radarr');
    expect(contractHash('radarr')).toBe(first);
    expect(first).toMatch(/^[0-9a-f]{64}$/);

    resetContractCache();
    fakeFile(overlayPath, overlay);

    expect(contractHash('radarr')).not.toBe(first);
  });
});
