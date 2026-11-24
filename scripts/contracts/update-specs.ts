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
import {
  finalizeRefresh,
  parseArgs,
  refreshService,
  renderReport,
  type FinalizeIo,
  type PinnedFiles,
  type RefreshDeps,
  type ReportRow,
} from './refresh/refresh';
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
    run: async (image, port) => (await run('docker', ['run', '-d', '--rm', '-p', `127.0.0.1:${port}:${port}`, image])).stdout.trim(),
    stop: async (id) => {
      await run('docker', ['stop', id]);
    },
  },
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  today: () => new Date().toISOString().slice(0, 10),
  timeoutMs: 300_000,
};

function snapshotPath(entry: ManifestEntry): string | undefined {
  return entry.refresh && entry.refresh.kind === 'docstrings' ? path.join(specsDir, entry.refresh.snapshot) : undefined;
}

function readIfExists(file: string | undefined): string | undefined {
  return file && fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : undefined;
}

function restoreFile(file: string | undefined, content: string | undefined): void {
  if (!file) {
    return;
  }
  if (content === undefined) {
    fs.rmSync(file, { force: true });
  } else {
    fs.writeFileSync(file, content);
  }
}

/** Real file operations for `finalizeRefresh`, restoring the spec, snapshot and generated types on failure. */
function fileIo(service: ServiceId, entry: ManifestEntry, pinned: PinnedFiles): FinalizeIo {
  const specFile = path.join(specsDir, entry.file);
  const snapshotFile = snapshotPath(entry);
  const generatedFile = path.join(generatedDir, `${service}.ts`);
  const generated = readIfExists(generatedFile);
  const overlayFile = path.join(overlaysDir, `${service}.json`);
  return {
    write: (files) => {
      if (files.spec !== undefined) {
        fs.writeFileSync(specFile, files.spec);
      }
      if (files.snapshot !== undefined && snapshotFile) {
        fs.writeFileSync(snapshotFile, files.snapshot);
      }
    },
    restore: () => {
      fs.writeFileSync(specFile, pinned.spec);
      restoreFile(snapshotFile, pinned.snapshot);
      restoreFile(generatedFile, generated);
      resetContractCache();
    },
    check: () => {
      resetContractCache();
      loadContract(service);
    },
    redundant: () =>
      fs.existsSync(overlayFile)
        ? findRedundantPatches(loadPinnedSpec(entry), JSON.parse(fs.readFileSync(overlayFile, 'utf8')) as Overlay)
        : [],
    regenerate: () => {
      if (generated?.split('\n')[1] !== `// contract-hash: ${contractHash(service)}`) {
        generateTypes(service);
      }
    },
  };
}

async function main(): Promise<void> {
  const { services: requested, reportFile } = parseArgs(process.argv.slice(2)) as { services: ServiceId[]; reportFile?: string };
  const manifest = loadManifest();
  const services = (requested.length > 0 ? requested : (Object.keys(manifest) as ServiceId[])).filter((service) => {
    if (!manifest[service]) {
      throw new Error(`Unknown contract service: ${service}`);
    }
    if (manifest[service].refresh === false) {
      console.warn(`${service} is not refreshed (refresh: false in the manifest)`);
      return false;
    }
    return true;
  });

  const rows: ReportRow[] = [];
  for (const service of services) {
    const entry = manifest[service];
    const pinned: PinnedFiles = {
      spec: fs.readFileSync(path.join(specsDir, entry.file), 'utf8'),
      snapshot: readIfExists(snapshotPath(entry)),
    };
    console.warn(`Refreshing ${service}…`);
    const result = await refreshService(entry, pinned, deps);
    const row = finalizeRefresh(service, entry.version, result, fileIo(service, entry, pinned));
    entry.version = row.to;
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
