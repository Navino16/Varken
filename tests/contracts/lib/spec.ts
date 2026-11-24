import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { applyOverlay, type Overlay } from './overlay';

export type ServiceId = 'radarr';

export type SpecFormat = 'openapi3.0' | 'openapi3.1' | 'swagger2';

export interface ManifestEntry {
  file: string;
  format: SpecFormat;
  source: string;
  version: string;
  pathPrefix: string;
  refresh: boolean;
}

export interface OpenApiDocument {
  openapi: string;
  paths: Record<string, Record<string, unknown>>;
  components?: { schemas?: Record<string, unknown> };
}

export interface Contract {
  service: ServiceId;
  entry: ManifestEntry;
  spec: OpenApiDocument;
}

export const OPENAPI_TYPESCRIPT_VERSION = '7.13.0';

const contractsDir = path.resolve(__dirname, '..');
const cache = new Map<ServiceId, Contract>();

function readJson<T>(file: string): T {
  return JSON.parse(fs.readFileSync(file, 'utf8') as string) as T;
}

export function loadManifest(): Record<ServiceId, ManifestEntry> {
  return readJson(path.join(contractsDir, 'specs', 'manifest.json'));
}

export function loadContract(service: ServiceId): Contract {
  const cached = cache.get(service);
  if (cached) {
    return cached;
  }

  const entry = loadManifest()[service];
  if (!entry) {
    throw new Error(`No contract manifest entry for ${service}`);
  }
  if (entry.format === 'swagger2') {
    throw new Error('swagger2 specs are not supported yet (plan 02)');
  }

  let spec = readJson<OpenApiDocument>(path.join(contractsDir, 'specs', entry.file));
  const overlayFile = path.join(contractsDir, 'overlays', `${service}.json`);
  if (fs.existsSync(overlayFile)) {
    spec = applyOverlay(spec, readJson<Overlay>(overlayFile));
  }

  const contract: Contract = { service, entry, spec };
  cache.set(service, contract);
  return contract;
}

export function resetContractCache(): void {
  cache.clear();
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalize((value as Record<string, unknown>)[key])])
    );
  }
  return value;
}

export function contractHash(service: ServiceId): string {
  const canonical = JSON.stringify(canonicalize(loadContract(service).spec));
  return createHash('sha256').update(`${canonical}\n${OPENAPI_TYPESCRIPT_VERSION}`).digest('hex');
}
