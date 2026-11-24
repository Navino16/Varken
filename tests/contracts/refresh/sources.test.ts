import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect, vi } from 'vitest';
import {
  canonicalJson,
  captureRuntimeSpec,
  extractDocstrings,
  extractRedocSpec,
  latestRelease,
} from '../../../scripts/contracts/refresh/sources';

const fixture = (name: string): string => fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8');

describe('extractRedocSpec', () => {
  it('returns spec.data of the redoc state, ignoring braces inside strings', () => {
    expect(extractRedocSpec(fixture('redoc-page.html'))).toEqual({
      openapi: '3.1.0',
      info: { title: 'Plex', description: 'Braces { and }; inside "strings" stay text' },
      paths: {},
    });
  });

  it('throws when the page holds no redoc state', () => {
    expect(() => extractRedocSpec('<html></html>')).toThrow('redoc state not found');
  });
});

describe('extractDocstrings', () => {
  it('reads named and plain @addtoapi commands', () => {
    const docs = extractDocstrings(fixture('webserve.py'), ['get_activity', 'get_libraries']);

    expect(docs.get_activity).toBe(' Get the current activity on the PMS. ');
    expect(docs.get_libraries).toContain('Get a list of all libraries on your server.');
    expect(docs.get_libraries).toContain('[{"section_id": "2"}]');
  });

  it('throws for an unknown command', () => {
    expect(() => extractDocstrings(fixture('webserve.py'), ['get_users'])).toThrow('no @addtoapi docstring for get_users');
  });
});

describe('latestRelease', () => {
  it('reads the tag of the latest GitHub release', async () => {
    const fetchJson = vi.fn(async () => ({ tag_name: 'v2.19.1' }));

    await expect(latestRelease('Tautulli/Tautulli', fetchJson)).resolves.toBe('v2.19.1');
    expect(fetchJson).toHaveBeenCalledWith('https://api.github.com/repos/Tautulli/Tautulli/releases/latest');
  });
});

describe('captureRuntimeSpec', () => {
  const source = { kind: 'runtime', repo: 'linuxserver/docker-bazarr', image: 'lscr.io/linuxserver/bazarr:{tag}', port: 6767, path: '/api/swagger.json' } as const;
  const docker = (): { run: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn> } => ({
    run: vi.fn(async () => 'container-1'),
    stop: vi.fn(async () => undefined),
  });

  it('returns the spec once the server answers and stops the container', async () => {
    const runner = docker();
    const fetchText = vi
      .fn()
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))
      .mockResolvedValueOnce('<html>starting</html>')
      .mockResolvedValueOnce('{"swagger":"2.0"}');

    const spec = await captureRuntimeSpec(source, 'v1.6.2-ls373', {
      docker: runner,
      fetchText,
      sleep: async () => undefined,
      timeoutMs: 10_000,
    });

    expect(spec).toBe('{"swagger":"2.0"}');
    expect(runner.run).toHaveBeenCalledWith('lscr.io/linuxserver/bazarr:v1.6.2-ls373', 6767);
    expect(fetchText).toHaveBeenLastCalledWith('http://localhost:6767/api/swagger.json');
    expect(runner.stop).toHaveBeenCalledWith('container-1');
  });

  it('stops the container and throws when the server never answers', async () => {
    const runner = docker();
    let now = 0;
    vi.spyOn(Date, 'now').mockImplementation(() => now);

    await expect(
      captureRuntimeSpec(source, 'v1', {
        docker: runner,
        fetchText: async () => {
          throw new Error('ECONNREFUSED');
        },
        sleep: async (ms) => {
          now += ms;
        },
        timeoutMs: 6_000,
      })
    ).rejects.toThrow('lscr.io/linuxserver/bazarr:v1 not ready after 6 s');
    expect(runner.stop).toHaveBeenCalledWith('container-1');
    vi.restoreAllMocks();
  });
});

describe('canonicalJson', () => {
  it('pretty-prints with two spaces, keeps non-ASCII characters and ends with a newline', () => {
    expect(canonicalJson({ region: 'Île-de-France' })).toBe('{\n  "region": "Île-de-France"\n}\n');
  });

  it('sorts object keys recursively so runtime specs serialized in random order stay stable', () => {
    const a = canonicalJson({ paths: { '/x': { post: {}, get: { b: 1, a: [{ z: 1, y: 2 }, 3] } } } });
    const b = canonicalJson({ paths: { '/x': { get: { a: [{ y: 2, z: 1 }, 3], b: 1 }, post: {} } } });

    expect(a).toBe(b);
    expect(a.indexOf('"get"')).toBeLessThan(a.indexOf('"post"'));
  });
});
