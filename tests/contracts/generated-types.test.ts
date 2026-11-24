import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { contractHash, loadManifest, type ServiceId } from './lib/spec';

const generatedDir = path.resolve(__dirname, '../../src/types/generated');

describe.each(Object.keys(loadManifest()) as ServiceId[])('generated types for %s', (service) => {
  const file = path.join(generatedDir, `${service}.ts`);

  it('exist', () => {
    expect(fs.existsSync(file), `missing ${file}: run npm run contracts:types ${service}`).toBe(true);
  });

  it('are up to date with the pinned spec', () => {
    const hashLine = fs.readFileSync(file, 'utf8').split('\n')[1];

    expect(hashLine, `stale generated types: run npm run contracts:types ${service}`).toBe(
      `// contract-hash: ${contractHash(service)}`
    );
  });
});
