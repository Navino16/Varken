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

/** The version only moves with the content: image rebuilds and releases without API change keep the pin as is. */
function result(entry: ManifestEntry, pinned: PinnedFiles, content: string, version: string): RefreshResult {
  return content === pinned.spec ? { status: 'unchanged', version: entry.version } : { status: 'updated', version, content };
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
      return result(entry, pinned, canonicalJson(extractRedocSpec(await deps.fetchText(source.url))), deps.today());
    }
    case 'runtime': {
      const tag = await latestRelease(source.repo, deps.fetchJson);
      // `servers` names the capture container (Emby uses its random hostname), not the API.
      const { servers: _servers, ...spec } = JSON.parse(await captureRuntimeSpec(source, tag, deps)) as Record<string, unknown>;
      return result(entry, pinned, canonicalJson(spec), tag);
    }
    case 'docstrings': {
      const tag = await latestRelease(source.repo, deps.fetchJson);
      const paths = Object.keys((JSON.parse(pinned.spec) as { paths: Record<string, unknown> }).paths);
      const commands = paths.map((p) => new URLSearchParams(p.slice(p.indexOf('?') + 1)).get('cmd') ?? p);
      const snapshot = canonicalJson(extractDocstrings(await deps.fetchText(source.url.replace('{tag}', tag)), commands));
      return snapshot === pinned.snapshot
        ? { status: 'unchanged', version: entry.version }
        : { status: 'review', version: tag, snapshot };
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

/** File operations of one service's refresh, injected so the transaction is testable. */
export interface FinalizeIo {
  write(files: { spec?: string; snapshot?: string }): void;
  restore(): void;
  check(): void;
  redundant(): OverlayPatch[];
  regenerate(): void;
}

/**
 * Applies a fetched result: writes it, checks the contract still loads, lists redundant overlay patches and
 * regenerates the types. Any failure restores the pinned files so one bad upstream spec never blocks the others.
 */
export function finalizeRefresh(service: string, from: string, result: RefreshResult, io: FinalizeIo): ReportRow {
  if (result.status === 'failed') {
    return { service, status: 'failed', from, to: from, error: result.error };
  }
  try {
    if (result.content !== undefined || result.snapshot !== undefined) {
      io.write({ spec: result.content, snapshot: result.snapshot });
    }
    io.check();
    const redundant = io.redundant();
    io.regenerate();
    return { service, status: result.status, from, to: result.version, redundant };
  } catch (error) {
    let redundant: OverlayPatch[] = [];
    try {
      redundant = io.redundant();
    } catch {
      // The refreshed spec may not even parse; the error below already says why.
    }
    io.restore();
    const message = error instanceof Error ? error.message : String(error);
    return { service, status: 'failed', from, to: from, error: `refresh not applied: ${message}`, redundant };
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
