import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const { warn } = vi.hoisted(() => ({ warn: vi.fn() }));
vi.mock('../../src/core/Logger', () => ({
  createLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn, error: vi.fn() }),
  withContext: (logger: unknown) => logger,
}));

import { EventStateStore, getEventStateStore, useEventStateFolder } from '../../src/utils/EventStateStore';

describe('EventStateStore', () => {
  let folder: string;

  beforeEach(async () => {
    warn.mockClear();
    folder = await fs.mkdtemp(path.join(os.tmpdir(), 'varken-events-'));
  });

  afterEach(async () => {
    await fs.rm(folder, { recursive: true, force: true });
    useEventStateFolder(null);
  });

  const stateFile = (key: string): string => path.join(folder, 'event-state', `${key}.json`);

  it('round-trips a mark through the state file', async () => {
    const time = Date.parse('2026-11-25T10:00:00.123Z');
    await new EventStateStore(folder).set('Sonarr_1_history', { time, ids: ['12', '13'] });

    await expect(new EventStateStore(folder).get('Sonarr_1_history')).resolves.toEqual({ time, ids: ['12', '13'] });
    expect(JSON.parse(await fs.readFile(stateFile('Sonarr_1_history'), 'utf8'))).toEqual({
      time: '2026-11-25T10:00:00.123Z',
      ids: ['12', '13'],
    });
  });

  it('writes atomically', async () => {
    await new EventStateStore(folder).set('Radarr_2_history', { time: 0, ids: [] });

    expect(await fs.readdir(path.join(folder, 'event-state'))).toEqual(['Radarr_2_history.json']);
  });

  it('replaces characters that are unsafe in a file name', async () => {
    await new EventStateStore(folder).set('My Plugin/1_history', { time: 0, ids: [] });

    expect(await fs.readdir(path.join(folder, 'event-state'))).toEqual(['My_Plugin_1_history.json']);
  });

  it.each([
    ['invalid JSON', 'not json'],
    ['a bad time', '{"time":"x","ids":[]}'],
    ['missing ids', '{"time":"2026-11-25T10:00:00Z"}'],
    ['an empty object', '{}'],
  ])('treats a state file with %s as missing', async (_label, content) => {
    await fs.mkdir(path.join(folder, 'event-state'), { recursive: true });
    await fs.writeFile(stateFile('Sonarr_1_history'), content);

    await expect(new EventStateStore(folder).get('Sonarr_1_history')).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('treats an unreadable state file as missing', async () => {
    await fs.mkdir(stateFile('Sonarr_1_history'), { recursive: true });

    await expect(new EventStateStore(folder).get('Sonarr_1_history')).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('returns undefined without warning when no state file exists', async () => {
    await expect(new EventStateStore(folder).get('Sonarr_1_history')).resolves.toBeUndefined();
    expect(warn).not.toHaveBeenCalled();
  });

  it('keeps the mark in memory when the state file cannot be written', async () => {
    const notAFolder = path.join(folder, 'file');
    await fs.writeFile(notAFolder, '');
    const store = new EventStateStore(notAFolder);

    await expect(store.set('Sonarr_1_history', { time: 5, ids: ['1'] })).resolves.toBeUndefined();

    await expect(store.get('Sonarr_1_history')).resolves.toEqual({ time: 5, ids: ['1'] });
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('keeps marks in memory when folder is null', async () => {
    const store = new EventStateStore(null);
    await store.set('Sonarr_1_history', { time: 5, ids: ['1'] });

    await expect(store.get('Sonarr_1_history')).resolves.toEqual({ time: 5, ids: ['1'] });
    expect(await fs.readdir(folder)).toEqual([]);
  });

  it('shares one store that useEventStateFolder replaces', () => {
    expect(getEventStateStore().folder).toBeNull();
    useEventStateFolder(folder);
    expect(getEventStateStore().folder).toBe(folder);
  });
});
