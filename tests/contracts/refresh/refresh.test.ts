import { describe, it, expect, vi } from 'vitest';
import { parseArgs, refreshService, renderReport, type RefreshDeps } from '../../../scripts/contracts/refresh/refresh';
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

  it('github-raw: same tag and same bytes is unchanged', async () => {
    const result = await refreshService({ ...raw, version: 'v2' }, { spec: 'same' }, deps({ [rawUrl]: 'same' }));

    expect(result.status).toBe('unchanged');
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
    const d = deps({ 'http://localhost:6767/api/swagger.json': '{"swagger":"2.0"}' });

    const result = await refreshService(bazarr, { spec: '{}\n' }, d);

    expect(d.docker.run).toHaveBeenCalledWith('lscr.io/linuxserver/bazarr:v2', 6767);
    expect(result).toEqual({ status: 'updated', version: 'v2', content: '{\n  "swagger": "2.0"\n}\n' });
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

    it('only bumps the version when the docstrings are the same', async () => {
      const result = await refreshService(tautulli, { spec, snapshot: '{\n  "get_activity": "same"\n}\n' }, deps(webserve('same')));

      expect(result).toMatchObject({ status: 'updated', version: 'v2' });
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
