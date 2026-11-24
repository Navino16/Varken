import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { findRedundantPatches, type Overlay } from '../../tests/contracts/lib/overlay';
import {
  contractHash,
  loadContract,
  loadManifest,
  loadPinnedSpec,
  resetContractCache,
  type ManifestEntry,
  type ServiceId,
} from '../../tests/contracts/lib/spec';
import { generateTypes } from './generate-types';
import { parseArgs, refreshService, renderReport, type PinnedFiles, type RefreshDeps, type ReportRow } from './refresh/refresh';
import { canonicalJson } from './refresh/sources';

const run = promisify(execFile);
const specsDir = path.resolve(__dirname, '../../tests/contracts/specs');
const overlaysDir = path.resolve(__dirname, '../../tests/contracts/overlays');
const generatedDir = path.resolve(__dirname, '../../src/types/generated');

async function fetchText(url: string): Promise<string> {
  const token = process.env.GITHUB_TOKEN;
  const headers: Record<string, string> =
    token && url.startsWith('https://api.github.com/') ? { Authorization: `Bearer ${token}` } : {};
  const response = await fetch(url, { headers });
  if (!response.ok) {
    throw new Error(`GET ${url} answered ${response.status}`);
  }
  return response.text();
}

const deps: RefreshDeps = {
  fetchText,
  fetchJson: async (url) => JSON.parse(await fetchText(url)),
  docker: {
    run: async (image, port) => (await run('docker', ['run', '-d', '--rm', '-p', `${port}:${port}`, image])).stdout.trim(),
    stop: async (id) => {
      await run('docker', ['stop', id]);
    },
  },
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  today: () => new Date().toISOString().slice(0, 10),
  timeoutMs: 300_000,
};

function readPinned(entry: ManifestEntry): PinnedFiles {
  const snapshot = entry.refresh && entry.refresh.kind === 'docstrings' ? path.join(specsDir, entry.refresh.snapshot) : undefined;
  return {
    spec: fs.readFileSync(path.join(specsDir, entry.file), 'utf8'),
    ...(snapshot && fs.existsSync(snapshot) ? { snapshot: fs.readFileSync(snapshot, 'utf8') } : {}),
  };
}

function writePinned(entry: ManifestEntry, files: PinnedFiles): void {
  fs.writeFileSync(path.join(specsDir, entry.file), files.spec);
  if (files.snapshot !== undefined && entry.refresh && entry.refresh.kind === 'docstrings') {
    fs.writeFileSync(path.join(specsDir, entry.refresh.snapshot), files.snapshot);
  }
}

function redundantPatches(entry: ManifestEntry, service: ServiceId): ReportRow['redundant'] {
  const file = path.join(overlaysDir, `${service}.json`);
  if (!fs.existsSync(file)) {
    return [];
  }
  return findRedundantPatches(loadPinnedSpec(entry), JSON.parse(fs.readFileSync(file, 'utf8')) as Overlay);
}

function generatedHash(service: ServiceId): string | undefined {
  const file = path.join(generatedDir, `${service}.ts`);
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n')[1] : undefined;
}

async function main(): Promise<void> {
  const { services: requested, reportFile } = parseArgs(process.argv.slice(2)) as { services: ServiceId[]; reportFile?: string };
  const manifest = loadManifest();
  const services = (requested.length > 0 ? requested : (Object.keys(manifest) as ServiceId[])).filter((service) => {
    if (!manifest[service]) {
      throw new Error(`Unknown contract service: ${service}`);
    }
    return manifest[service].refresh !== false;
  });

  const rows: ReportRow[] = [];
  for (const service of services) {
    const entry = manifest[service];
    const pinned = readPinned(entry);
    console.warn(`Refreshing ${service}…`);
    const result = await refreshService(entry, pinned, deps);
    const row: ReportRow = { service, status: result.status, from: entry.version, to: result.version, error: result.error };

    if (result.status !== 'failed' && result.status !== 'unchanged') {
      writePinned(entry, { spec: result.content ?? pinned.spec, snapshot: result.snapshot });
      resetContractCache();
      try {
        loadContract(service);
        entry.version = result.version;
      } catch (error) {
        writePinned(entry, pinned);
        Object.assign(row, { status: 'failed', to: entry.version, error: `overlay no longer applies: ${(error as Error).message}` });
      }
      resetContractCache();
    }
    if (row.status !== 'failed') {
      row.redundant = redundantPatches(entry, service);
      if (generatedHash(service) !== `// contract-hash: ${contractHash(service)}`) {
        generateTypes(service);
      }
    }
    rows.push(row);
  }

  fs.writeFileSync(path.join(specsDir, 'manifest.json'), canonicalJson(manifest));
  const report = renderReport(rows);
  console.log(report);
  if (reportFile) {
    fs.writeFileSync(reportFile, report);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
