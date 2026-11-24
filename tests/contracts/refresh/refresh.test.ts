import { describe, it, expect, vi } from 'vitest';
import {
  finalizeRefresh,
  parseArgs,
  refreshService,
  renderReport,
  type FinalizeIo,
  type RefreshDeps,
} from '../../../scripts/contracts/refresh/refresh';
import type { ManifestEntry } from '../lib/spec';
import { canonicalJson } from '../../../scripts/contracts/refresh/sources';

const entry = (refresh: ManifestEntry['refresh'], overrides: Partial<ManifestEntry> = {}): ManifestEntry => ({
  file: 'x.json',
  format: 'openapi3.0',
  source: 'https://raw.githubusercontent.com/Radarr/Radarr/{tag}/src/Radarr.Api.V3/openapi.json',
  version: 'v1',
  pathPrefix: '',
  refresh,
  ...overrides,
});

function deps(pages: Record<string, string>, overrides: Partial<RefreshDeps> = {}): RefreshDeps {
  return {
    fetchText: vi.fn(async (url: string) => {
      if (!(url in pages)) {
        throw new Error(`404 ${url}`);
      }
      return pages[url];
    }),
    fetchJson: vi.fn(async () => ({ tag_name: 'v2' })),
    docker: { run: vi.fn(async () => 'c1'), stop: vi.fn(async () => undefined) },
    sleep: async () => undefined,
    today: () => '2026-12-01',
    timeoutMs: 1000,
    ...overrides,
  };
}

const rawUrl = 'https://raw.githubusercontent.com/Radarr/Radarr/v2/src/Radarr.Api.V3/openapi.json';
const raw = entry({ kind: 'github-raw', repo: 'Radarr/Radarr' });

describe('refreshService', () => {
  it('github-raw: keeps the file byte for byte and reports a new tag as updated', async () => {
    const result = await refreshService(raw, { spec: '{"openapi":"3.0.3"}' }, deps({ [rawUrl]: '{"openapi":"3.0.4"}' }));

    expect(result).toEqual({ status: 'updated', version: 'v2', content: '{"openapi":"3.0.4"}' });
  });

  it('github-raw: a new tag with the same bytes is unchanged and keeps the pinned version', async () => {
    const result = await refreshService(raw, { spec: 'same' }, deps({ [rawUrl]: 'same' }));

    expect(result).toEqual({ status: 'unchanged', version: 'v1' });
  });

  it('url: writes canonical JSON versioned by info.version', async () => {
    const jellyfin = entry({ kind: 'url', url: 'https://api.jellyfin.org/spec.json' });
    const upstream = '{"openapi":"3.0.4","info":{"version":"12.5.0"}}';

    const result = await refreshService(jellyfin, { spec: '{}\n' }, deps({ 'https://api.jellyfin.org/spec.json': upstream }));

    expect(result).toEqual({
      status: 'updated',
      version: '12.5.0',
      content: canonicalJson(JSON.parse(upstream)),
    });
  });

  it('redoc-page: keeps its version when the extracted spec did not change', async () => {
    const plex = entry({ kind: 'redoc-page', url: 'https://developer.plex.tv/pms/' }, { version: '2026-11-24' });
    const page = '<script>__redoc_state = {"spec":{"data":{"openapi":"3.1.0"}}};</script>';
    const pinned = `${JSON.stringify({ openapi: '3.1.0' }, null, 2)}\n`;

    const unchanged = await refreshService(plex, { spec: pinned }, deps({ 'https://developer.plex.tv/pms/': page }));
    const changed = await refreshService(plex, { spec: '{}\n' }, deps({ 'https://developer.plex.tv/pms/': page }));

    expect(unchanged).toMatchObject({ status: 'unchanged', version: '2026-11-24' });
    expect(changed).toMatchObject({ status: 'updated', version: '2026-12-01', content: pinned });
  });

  it('runtime: captures the spec from the latest image', async () => {
    const bazarr = entry({
      kind: 'runtime',
      repo: 'linuxserver/docker-bazarr',
      image: 'lscr.io/linuxserver/bazarr:{tag}',
      port: 6767,
      path: '/api/swagger.json',
    });
    const d = deps({ 'http://localhost:6767/api/swagger.json': '{"swagger":"2.0","paths":{}}' });

    const result = await refreshService(bazarr, { spec: '{}\n' }, d);

    expect(d.docker.run).toHaveBeenCalledWith('lscr.io/linuxserver/bazarr:v2', 6767);
    expect(result).toEqual({ status: 'updated', version: 'v2', content: '{\n  "paths": {},\n  "swagger": "2.0"\n}\n' });
  });

  it('runtime: a rebuilt image tag with the same spec is unchanged', async () => {
    const bazarr = entry({ kind: 'runtime', repo: 'linuxserver/docker-bazarr', image: 'lscr.io/linuxserver/bazarr:{tag}', port: 6767, path: '/api/swagger.json' });
    const body = '{"swagger":"2.0","paths":{}}';

    const result = await refreshService(bazarr, { spec: '{\n  "paths": {},\n  "swagger": "2.0"\n}\n' }, deps({ 'http://localhost:6767/api/swagger.json': body }));

    expect(result).toEqual({ status: 'unchanged', version: 'v1' });
  });

  it('runtime: drops servers, which describe the capture container', async () => {
    const emby = entry({ kind: 'runtime', repo: 'MediaBrowser/Emby.Releases', image: 'emby/embyserver:{tag}', port: 8096, path: '/emby/openapi.json' });
    const body = '{"openapi":"3.0.1","paths":{},"servers":[{"url":"http://localhost:8096/emby","description":"f31a67910e59"}]}';

    const result = await refreshService(emby, { spec: '{}\n' }, deps({ 'http://localhost:8096/emby/openapi.json': body }));

    expect(result.content).toBe('{\n  "openapi": "3.0.1",\n  "paths": {}\n}\n');
  });

  describe('docstrings', () => {
    const tautulli = entry({
      kind: 'docstrings',
      repo: 'Tautulli/Tautulli',
      url: 'https://raw.githubusercontent.com/Tautulli/Tautulli/{tag}/plexpy/webserve.py',
      snapshot: 'tautulli.docstrings.json',
    });
    const spec = JSON.stringify({ paths: { '/api/v2?cmd=get_activity': {} } });
    const webserve = (doc: string): Record<string, string> => ({
      'https://raw.githubusercontent.com/Tautulli/Tautulli/v2/plexpy/webserve.py': `    @addtoapi()\n    def get_activity(self):\n        """${doc}"""\n`,
    });

    it('asks for a manual review when a used command docstring changed', async () => {
      const result = await refreshService(tautulli, { spec, snapshot: '{\n  "get_activity": "old"\n}\n' }, deps(webserve('new')));

      expect(result).toEqual({ status: 'review', version: 'v2', snapshot: '{\n  "get_activity": "new"\n}\n' });
    });

    it('keeps the pinned version when the docstrings are the same', async () => {
      const result = await refreshService(tautulli, { spec, snapshot: '{\n  "get_activity": "same"\n}\n' }, deps(webserve('same')));

      expect(result).toEqual({ status: 'unchanged', version: 'v1' });
    });
  });

  it('reports a failing source as failed with its message', async () => {
    const result = await refreshService(raw, { spec: 'x' }, deps({}));

    expect(result).toEqual({ status: 'failed', version: 'v1', error: `404 ${rawUrl}` });
  });
});

describe('renderReport', () => {
  it('lists every service, manual reviews, redundant overlay patches and failures', () => {
    const report = renderReport([
      { service: 'radarr', status: 'updated', from: 'v1', to: 'v2' },
      { service: 'tautulli', status: 'review', from: 'v2.19.1', to: 'v2.20.0' },
      { service: 'plex', status: 'unchanged', from: '2026-11-24', to: '2026-11-24', redundant: [{ op: 'add', path: '/a', value: 1, why: 'gap' }] },
      { service: 'emby', status: 'failed', from: '4.10.2.0', to: '4.10.2.0', error: 'not ready after 300 s' },
    ]);

    expect(report).toContain('| radarr | updated | v1 → v2 |');
    expect(report).toContain('| plex | unchanged | 2026-11-24 |');
    expect(report).toMatch(/## Manual review[\s\S]*tautulli/);
    expect(report).toMatch(/## Redundant overlay patches[\s\S]*plex: `add \/a` \(gap\)/);
    expect(report).toMatch(/## Failures[\s\S]*emby: not ready after 300 s/);
  });

  it('omits empty sections', () => {
    const report = renderReport([{ service: 'radarr', status: 'unchanged', from: 'v1', to: 'v1' }]);

    expect(report).not.toContain('## Failures');
    expect(report).not.toContain('## Manual review');
  });
});

describe('parseArgs', () => {
  it('keeps every service when no report file is given', () => {
    expect(parseArgs(['radarr', 'tautulli'])).toEqual({ services: ['radarr', 'tautulli'] });
  });

  it('reads the report file wherever it appears', () => {
    expect(parseArgs(['radarr', '--report', 'out.md', 'plex'])).toEqual({ services: ['radarr', 'plex'], reportFile: 'out.md' });
  });
});

describe('finalizeRefresh', () => {
  const patch = { op: 'remove' as const, path: '/paths/~1gone', why: 'upstream bug' };

  function io(overrides: Partial<FinalizeIo> = {}): FinalizeIo & Record<keyof FinalizeIo, ReturnType<typeof vi.fn>> {
    return {
      write: vi.fn(),
      restore: vi.fn(),
      check: vi.fn(),
      redundant: vi.fn(() => []),
      regenerate: vi.fn(),
      ...overrides,
    } as never;
  }

  it('writes an update, checks it, reports redundant patches and regenerates the types', () => {
    const files = io({ redundant: vi.fn(() => [patch]) });

    const row = finalizeRefresh('plex', '1', { status: 'updated', version: '2', content: 'new' }, files);

    expect(files.write).toHaveBeenCalledWith({ spec: 'new', snapshot: undefined });
    expect(files.check).toHaveBeenCalled();
    expect(files.regenerate).toHaveBeenCalled();
    expect(files.restore).not.toHaveBeenCalled();
    expect(row).toEqual({ service: 'plex', status: 'updated', from: '1', to: '2', redundant: [patch] });
  });

  it('writes nothing for an unchanged spec', () => {
    const files = io();

    const row = finalizeRefresh('plex', '1', { status: 'unchanged', version: '1' }, files);

    expect(files.write).not.toHaveBeenCalled();
    expect(row.status).toBe('unchanged');
  });

  it('restores the pinned files, keeps the version and names the redundant patch when the refreshed spec breaks the contract', () => {
    const files = io({
      check: vi.fn(() => {
        throw new Error('Overlay pointer not found: /paths/~1gone');
      }),
      redundant: vi.fn(() => [patch]),
    });

    const row = finalizeRefresh('plex', '1', { status: 'updated', version: '2', content: 'new' }, files);

    expect(files.restore).toHaveBeenCalled();
    expect(files.regenerate).not.toHaveBeenCalled();
    expect(row).toEqual({
      service: 'plex',
      status: 'failed',
      from: '1',
      to: '1',
      error: 'refresh not applied: Overlay pointer not found: /paths/~1gone',
      redundant: [patch],
    });
  });

  it('restores the pinned files when type generation fails', () => {
    const files = io({
      regenerate: vi.fn(() => {
        throw new Error('openapi-typescript failed');
      }),
    });

    const row = finalizeRefresh('ombi', 'v1', { status: 'updated', version: 'v2', content: 'new' }, files);

    expect(files.restore).toHaveBeenCalled();
    expect(row).toMatchObject({ status: 'failed', to: 'v1', error: 'refresh not applied: openapi-typescript failed' });
  });

  it('passes a failed fetch through untouched', () => {
    const files = io();

    const row = finalizeRefresh('emby', 'v1', { status: 'failed', version: 'v1', error: 'not ready' }, files);

    expect(files.write).not.toHaveBeenCalled();
    expect(files.check).not.toHaveBeenCalled();
    expect(row).toEqual({ service: 'emby', status: 'failed', from: 'v1', to: 'v1', error: 'not ready' });
  });
});
