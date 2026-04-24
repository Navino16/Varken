import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ConfigWatcher } from '../../src/core/ConfigWatcher';

vi.mock('../../src/core/Logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
  withContext: (logger: unknown) => logger,
}));

describe('ConfigWatcher', () => {
  let tmpDir: string;
  let filePath: string;
  let watcher: ConfigWatcher | null = null;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'varken-watcher-'));
    filePath = path.join(tmpDir, 'varken.yaml');
    fs.writeFileSync(filePath, 'outputs: {}\ninputs: {}\n', 'utf-8');
  });

  afterEach(() => {
    watcher?.stop();
    watcher = null;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('invokes the callback when the watched file changes (after debounce)', async () => {
    const onChange = vi.fn().mockResolvedValue(undefined);
    watcher = new ConfigWatcher({
      configFolder: tmpDir,
      debounceMs: 50,
      onChange,
    });
    watcher.start();

    fs.writeFileSync(filePath, 'outputs: {}\ninputs:\n  sonarr: []\n', 'utf-8');

    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('debounces rapid successive changes into a single callback', async () => {
    const onChange = vi.fn().mockResolvedValue(undefined);
    watcher = new ConfigWatcher({
      configFolder: tmpDir,
      debounceMs: 100,
      onChange,
    });
    watcher.start();

    for (let i = 0; i < 5; i++) {
      fs.writeFileSync(filePath, `# change ${i}\n`, 'utf-8');
      await new Promise((resolve) => setTimeout(resolve, 20));
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('catches callback errors and keeps watching', async () => {
    const onChange = vi
      .fn()
      .mockRejectedValueOnce(new Error('reload failed'))
      .mockResolvedValue(undefined);

    watcher = new ConfigWatcher({
      configFolder: tmpDir,
      debounceMs: 50,
      onChange,
    });
    watcher.start();

    fs.writeFileSync(filePath, '# first\n', 'utf-8');
    await new Promise((resolve) => setTimeout(resolve, 120));

    fs.writeFileSync(filePath, '# second\n', 'utf-8');
    await new Promise((resolve) => setTimeout(resolve, 120));

    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it('does not start when the file does not exist', () => {
    const missingPath = path.join(tmpDir, 'does-not-exist.yaml');
    fs.rmSync(filePath);
    const onChange = vi.fn().mockResolvedValue(undefined);

    watcher = new ConfigWatcher({
      configFolder: tmpDir,
      onChange,
    });
    watcher.start();

    expect(fs.existsSync(missingPath)).toBe(false);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('stop() is safe to call when never started', () => {
    watcher = new ConfigWatcher({
      configFolder: tmpDir,
      onChange: async () => {},
    });
    expect(() => watcher?.stop()).not.toThrow();
  });

  it('stop() cancels a pending debounced reload', async () => {
    const onChange = vi.fn().mockResolvedValue(undefined);
    watcher = new ConfigWatcher({
      configFolder: tmpDir,
      debounceMs: 200,
      onChange,
    });
    watcher.start();

    fs.writeFileSync(filePath, '# change\n', 'utf-8');
    await new Promise((resolve) => setTimeout(resolve, 50));
    watcher.stop();
    watcher = null;

    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('warns and does nothing when start is called twice', () => {
    const onChange = vi.fn().mockResolvedValue(undefined);
    watcher = new ConfigWatcher({ configFolder: tmpDir, onChange });
    watcher.start();
    expect(() => watcher!.start()).not.toThrow();
  });
});
