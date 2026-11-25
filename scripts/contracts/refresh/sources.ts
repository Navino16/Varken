import type { RefreshSource } from '../../../tests/contracts/lib/spec';

export type FetchText = (url: string) => Promise<string>;
export type FetchJson = (url: string) => Promise<unknown>;
export type RuntimeSource = Extract<RefreshSource, { kind: 'runtime' }>;

export interface DockerRunner {
  run(image: string, port: number): Promise<string>;
  stop(id: string): Promise<void>;
}

export interface CaptureDeps {
  docker: DockerRunner;
  fetchText: FetchText;
  sleep(ms: number): Promise<void>;
  timeoutMs: number;
}

const POLL_INTERVAL_MS = 3000;

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeys);
  }
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, sortKeys((value as Record<string, unknown>)[key])])
    );
  }
  return value;
}

/**
 * The format every non-raw pinned spec is written in, so an unchanged upstream yields no diff.
 * Keys are sorted: runtime specs (Bazarr) serialize methods in a different order on each start.
 */
export function canonicalJson(value: unknown): string {
  return `${JSON.stringify(sortKeys(value), null, 2)}\n`;
}

/** End index (exclusive) of the JSON object starting at `start`, skipping braces inside strings. */
function objectEnd(text: string, start: number): number {
  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i++) {
    const char = text[i];
    if (inString) {
      if (char === '\\') {
        i++;
      } else if (char === '"') {
        inString = false;
      }
    } else if (char === '"') {
      inString = true;
    } else if (char === '{') {
      depth++;
    } else if (char === '}') {
      depth--;
      if (depth === 0) {
        return i + 1;
      }
    }
  }
  throw new Error('redoc state not found');
}

/** Plex embeds its OpenAPI document in developer.plex.tv/pms/ as `__redoc_state = {...}`. */
export function extractRedocSpec(html: string): unknown {
  const marker = html.indexOf('__redoc_state = ');
  const start = marker === -1 ? -1 : html.indexOf('{', marker);
  if (start === -1) {
    throw new Error('redoc state not found');
  }
  const state = JSON.parse(html.slice(start, objectEnd(html, start))) as { spec?: { data?: unknown } };
  if (!state.spec?.data) {
    throw new Error('redoc state not found');
  }
  return state.spec.data;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** A Python argument list, possibly over several lines, that never runs into the next `def`. */
const SIGNATURE = String.raw`(?:(?!\bdef )[\s\S])*?`;

/** Docstrings of Tautulli API commands: `@addtoapi("<cmd>")` or `@addtoapi()` on `def <cmd>(`. */
export function extractDocstrings(source: string, commands: string[]): Record<string, string> {
  const docs: Record<string, string> = {};
  for (const command of commands) {
    const name = escapeRegExp(command);
    const match =
      new RegExp(`@addtoapi\\("${name}"\\)\\s*\\n\\s*def \\w+\\(${SIGNATURE}\\):\\s*\\n\\s*"""([\\s\\S]*?)"""`).exec(source) ??
      new RegExp(`@addtoapi\\(\\)\\s*\\n\\s*def ${name}\\(${SIGNATURE}\\):\\s*\\n\\s*"""([\\s\\S]*?)"""`).exec(source);
    if (!match) {
      throw new Error(`no @addtoapi docstring for ${command}`);
    }
    docs[command] = match[1];
  }
  return docs;
}

export async function latestRelease(repo: string, fetchJson: FetchJson): Promise<string> {
  const release = (await fetchJson(`https://api.github.com/repos/${repo}/releases/latest`)) as { tag_name?: string };
  if (!release.tag_name) {
    throw new Error(`no latest release for ${repo}`);
  }
  return release.tag_name;
}

function isSpec(value: unknown): boolean {
  const document = value as { openapi?: unknown; swagger?: unknown; paths?: unknown };
  return (typeof document.openapi === 'string' || typeof document.swagger === 'string') && typeof document.paths === 'object';
}

/** Starts the service's image, polls its spec URL until it serves JSON, and always stops the container. */
export async function captureRuntimeSpec(source: RuntimeSource, tag: string, deps: CaptureDeps): Promise<string> {
  const image = source.image.replace('{tag}', tag);
  const url = `http://localhost:${source.port}${source.path}`;
  const id = await deps.docker.run(image, source.port);
  try {
    const deadline = Date.now() + deps.timeoutMs;
    while (Date.now() < deadline) {
      try {
        const body = await deps.fetchText(url);
        if (isSpec(JSON.parse(body))) {
          return body;
        }
      } catch {
        // Not up yet: connection refused, HTML splash page or partial body.
      }
      await deps.sleep(POLL_INTERVAL_MS);
    }
    throw new Error(`${image} not ready after ${Math.round(deps.timeoutMs / 1000)} s`);
  } finally {
    // `--rm` may already have removed a crashed container; the capture outcome matters more.
    await deps.docker.stop(id).catch(() => undefined);
  }
}
