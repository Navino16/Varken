import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { upgradeFromTwoToThree } from '@scalar/openapi-upgrader/2.0-to-3.0';
import { parse as parseYaml } from 'yaml';
import { applyOverlay, type FormatOverride, type Overlay } from './overlay';

export type ServiceId = 'radarr' | 'bazarr' | 'sonarr' | 'lidarr' | 'readarr' | 'prowlarr' | 'seerr' | 'ombi' | 'plex' | 'jellyfin' | 'emby';

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
  components?: { schemas?: Record<string, unknown>; parameters?: Record<string, unknown> };
}

export interface Contract {
  service: ServiceId;
  entry: ManifestEntry;
  spec: OpenApiDocument;
  formats?: FormatOverride[];
}

export const OPENAPI_TYPESCRIPT_VERSION = '7.13.0';

const contractsDir = path.resolve(__dirname, '..');
const cache = new Map<ServiceId, Contract>();

function readJson<T>(file: string): T {
  return JSON.parse(fs.readFileSync(file, 'utf8') as string) as T;
}

function readSpec(file: string): unknown {
  return /\.ya?ml$/.test(file) ? parseYaml(fs.readFileSync(file, 'utf8') as string) : readJson<unknown>(file);
}

export function loadManifest(): Record<ServiceId, ManifestEntry> {
  return readJson(path.join(contractsDir, 'specs', 'manifest.json'));
}

/** Upgrades a Swagger 2.0 document to OpenAPI 3.0; its basePath must be the manifest's pathPrefix. */
export function upgradeSwagger2(document: unknown, pathPrefix: string): OpenApiDocument {
  const basePath = (document as { basePath?: string }).basePath ?? '';
  if (basePath !== pathPrefix) {
    throw new Error(`swagger2 basePath "${basePath}" differs from manifest pathPrefix "${pathPrefix}"`);
  }
  return upgradeFromTwoToThree(structuredClone(document) as Record<string, unknown>) as unknown as OpenApiDocument;
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
  const pinned = readSpec(path.join(contractsDir, 'specs', entry.file));
  let spec = entry.format === 'swagger2' ? upgradeSwagger2(pinned, entry.pathPrefix) : (pinned as OpenApiDocument);
  const overlayFile = path.join(contractsDir, 'overlays', `${service}.json`);
  let formats: FormatOverride[] = [];
  if (fs.existsSync(overlayFile)) {
    const overlay = readJson<Overlay>(overlayFile);
    spec = applyOverlay(spec, overlay);
    formats = overlay.formats ?? [];
    const unjustified = formats.find((format) => !format.why?.trim());
    if (unjustified) {
      throw new Error(`Overlay format override ${unjustified.name} needs a why`);
    }
  }

  const contract: Contract = { service, entry, spec, formats };
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
