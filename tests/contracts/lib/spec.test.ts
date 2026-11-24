import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { contractHash, loadContract, resetContractCache } from './spec';

const contractsDir = path.resolve(__dirname, '..');
const overlayPath = path.join(contractsDir, 'overlays', 'radarr.json');
const manifestPath = path.join(contractsDir, 'specs', 'manifest.json');

function fakeFile(target: string, content: unknown): void {
  const realExists = fs.existsSync;
  const realRead = fs.readFileSync;
  vi.spyOn(fs, 'existsSync').mockImplementation((p) => p === target || realExists(p));
  vi.spyOn(fs, 'readFileSync').mockImplementation(((p: fs.PathOrFileDescriptor, options?: unknown) =>
    p === target ? JSON.stringify(content) : realRead(p, options as BufferEncoding)) as typeof fs.readFileSync);
}

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

  it('rejects unsupported formats', () => {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    fakeFile(manifestPath, { radarr: { ...manifest.radarr, format: 'swagger2' } });

    expect(() => loadContract('radarr')).toThrow(/swagger2/);
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
