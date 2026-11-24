import type { OverlayPatch } from '../../../tests/contracts/lib/overlay';
import type { ManifestEntry, RefreshSource } from '../../../tests/contracts/lib/spec';
import {
  canonicalJson,
  captureRuntimeSpec,
  extractDocstrings,
  extractRedocSpec,
  latestRelease,
  type DockerRunner,
  type FetchJson,
  type FetchText,
} from './sources';

export type RefreshStatus = 'unchanged' | 'updated' | 'review' | 'failed';

export interface RefreshDeps {
  fetchText: FetchText;
  fetchJson: FetchJson;
  docker: DockerRunner;
  sleep(ms: number): Promise<void>;
  today(): string;
  timeoutMs: number;
}

/** Current content of the pinned files of one service. */
export interface PinnedFiles {
  spec: string;
  snapshot?: string;
}

export interface RefreshResult {
  status: RefreshStatus;
  version: string;
  content?: string;
  snapshot?: string;
  error?: string;
}

export interface ReportRow {
  service: string;
  status: RefreshStatus;
  from: string;
  to: string;
  error?: string;
  redundant?: OverlayPatch[];
}

function result(entry: ManifestEntry, pinned: PinnedFiles, content: string, version: string): RefreshResult {
  const changed = content !== pinned.spec;
  return changed || version !== entry.version
    ? { status: 'updated', version, ...(changed ? { content } : {}) }
    : { status: 'unchanged', version };
}

async function refreshSource(source: RefreshSource, entry: ManifestEntry, pinned: PinnedFiles, deps: RefreshDeps): Promise<RefreshResult> {
  switch (source.kind) {
    case 'github-raw': {
      const tag = await latestRelease(source.repo, deps.fetchJson);
      return result(entry, pinned, await deps.fetchText(entry.source.replace('{tag}', tag)), tag);
    }
    case 'url': {
      const spec = JSON.parse(await deps.fetchText(source.url)) as { info?: { version?: string } };
      return result(entry, pinned, canonicalJson(spec), spec.info?.version ?? entry.version);
    }
    case 'redoc-page': {
      const content = canonicalJson(extractRedocSpec(await deps.fetchText(source.url)));
      return result(entry, pinned, content, content === pinned.spec ? entry.version : deps.today());
    }
    case 'runtime': {
      const tag = await latestRelease(source.repo, deps.fetchJson);
      return result(entry, pinned, canonicalJson(JSON.parse(await captureRuntimeSpec(source, tag, deps))), tag);
    }
    case 'docstrings': {
      const tag = await latestRelease(source.repo, deps.fetchJson);
      const paths = Object.keys((JSON.parse(pinned.spec) as { paths: Record<string, unknown> }).paths);
      const commands = paths.map((p) => new URLSearchParams(p.slice(p.indexOf('?') + 1)).get('cmd') ?? p);
      const snapshot = canonicalJson(extractDocstrings(await deps.fetchText(source.url.replace('{tag}', tag)), commands));
      if (snapshot !== pinned.snapshot) {
        return { status: 'review', version: tag, snapshot };
      }
      return tag === entry.version ? { status: 'unchanged', version: tag } : { status: 'updated', version: tag };
    }
  }
}

/** Fetches one service's upstream spec; never throws, a failing source is reported as `failed`. */
export async function refreshService(entry: ManifestEntry, pinned: PinnedFiles, deps: RefreshDeps): Promise<RefreshResult> {
  if (!entry.refresh) {
    return { status: 'unchanged', version: entry.version };
  }
  try {
    return await refreshSource(entry.refresh, entry, pinned, deps);
  } catch (error) {
    return { status: 'failed', version: entry.version, error: error instanceof Error ? error.message : String(error) };
  }
}

export function parseArgs(args: string[]): { services: string[]; reportFile?: string } {
  const reportIndex = args.indexOf('--report');
  if (reportIndex === -1) {
    return { services: args };
  }
  return {
    services: args.filter((_, i) => i !== reportIndex && i !== reportIndex + 1),
    reportFile: args[reportIndex + 1],
  };
}

export function renderReport(rows: ReportRow[]): string {
  const lines = ['## Pinned API specs', '', '| Service | Status | Version |', '| --- | --- | --- |'];
  for (const row of rows) {
    lines.push(`| ${row.service} | ${row.status} | ${row.from === row.to ? row.to : `${row.from} → ${row.to}`} |`);
  }
  const section = (title: string, items: string[]): void => {
    if (items.length > 0) {
      lines.push('', `## ${title}`, '', ...items);
    }
  };
  section(
    'Manual review',
    rows
      .filter((r) => r.status === 'review')
      .map((r) => `- ${r.service}: documented commands changed upstream, update the hand-written contract before merging`)
  );
  section(
    'Redundant overlay patches',
    rows.flatMap((r) => (r.redundant ?? []).map((p) => `- ${r.service}: \`${p.op} ${p.path}\` (${p.why})`))
  );
  section(
    'Failures',
    rows.filter((r) => r.status === 'failed').map((r) => `- ${r.service}: ${r.error}`)
  );
  return `${lines.join('\n')}\n`;
}
