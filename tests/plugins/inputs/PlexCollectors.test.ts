import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import axios from 'axios';
import { PlexPlugin } from '../../../src/plugins/inputs/PlexPlugin';
import { PlexConfigSchema } from '../../../src/config/schemas/config.schema';
import type { PlexConfig } from '../../../src/types/inputs/plex.types';
import { createContractHttpClient, type ContractHttpClient } from '../../fixtures/contract-http';
import type { DataPoint } from '../../../src/types/plugin.types';

vi.mock('../../../src/core/Logger', async () => {
  const { loggerMock } = await import('../../fixtures/logger');
  return loggerMock();
});

vi.mock('axios', () => ({ default: { create: vi.fn() } }));

const NOW = new Date('2026-11-25T10:30:00Z');

function config(keys: Partial<Record<'status' | 'history' | 'inventory' | 'liveTv', boolean>>): PlexConfig {
  const schedule = (enabled = false): { enabled: boolean; intervalSeconds: number } => ({ enabled, intervalSeconds: 300 });
  return PlexConfigSchema.parse({
    id: 1,
    url: 'http://plex.local:32400',
    token: 'test-token',
    status: schedule(keys.status),
    history: schedule(keys.history),
    inventory: schedule(keys.inventory),
    liveTv: schedule(keys.liveTv),
  }) as PlexConfig;
}

const ofType = (points: DataPoint[], type: string): DataPoint[] => points.filter((p) => p.tags.type === type);

describe('PlexPlugin collectors', () => {
  let plugin: PlexPlugin;
  let client: ContractHttpClient;

  beforeEach(() => {
    vi.useFakeTimers({ now: NOW });
    plugin = new PlexPlugin();
    client = createContractHttpClient('plex');
    (axios.create as Mock).mockReturnValue(client);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('status', () => {
    beforeEach(async () => {
      await plugin.initialize(config({ status: true }));
    });

    it('collects activities and background transcodes', async () => {
      const points = await plugin.collect();

      expect(ofType(points, 'Activities')[0].fields).toEqual({ count: 2 });
      expect(ofType(points, 'Activity').map((p) => [p.tags.activity_type, p.fields])).toEqual([
        ['media.generate.intros', { progress: 40, cancellable: 1 }],
        ['library.update.section', { progress: 5, cancellable: 0 }],
      ]);
      expect(ofType(points, 'Activity')[0].floatFields).toContain('progress');
      expect(ofType(points, 'BackgroundTranscodes')[0].fields).toEqual({ count: 1 });
      expect(ofType(points, 'BackgroundTranscode')[0]).toMatchObject({
        tags: { rating_key: '501', server: 1 },
        fields: { progress: 42.5, speed: 2.4, remaining_seconds: 600, size: 524288000 },
      });
    });

    it('collects butler tasks and updater state', async () => {
      const points = await plugin.collect();

      expect(ofType(points, 'ButlerTask').map((p) => [p.tags.task, p.fields])).toEqual([
        ['BackupDatabase', { enabled: 1, randomized: 0, interval_days: 3 }],
        ['OptimizeDatabase', { enabled: 1, randomized: 0, interval_days: 7 }],
        ['GenerateChapterThumbs', { enabled: 0, randomized: 1, interval_days: 1 }],
      ]);
      expect(ofType(points, 'Updater')[0]).toMatchObject({
        tags: { state: 'available', version: '1.42.3.10201-a8f1c2d3e' },
        fields: { can_install: 1, checked_age_seconds: 1795602600 - 1764050000, releases: 1 },
      });
    });

    it('reports no release in the updater point', async () => {
      client.override('/updater/status', { MediaContainer: { canInstall: false, checkedAt: 1795602000 } });

      const [updater] = ofType(await plugin.collect(), 'Updater');

      expect(updater.tags).toMatchObject({ state: 'none', version: 'none' });
      expect(updater.fields).toEqual({ can_install: 0, checked_age_seconds: 600, releases: 0 });
    });

    it('collects the latest resource usage', async () => {
      const [resources] = ofType(await plugin.collect(), 'Resources');

      expect(resources.fields).toEqual({ host_cpu_percent: 20.5, host_memory_percent: 50, process_cpu_percent: 8.25, process_memory_percent: 7.5 });
      expect(resources.timestamp).toEqual(new Date(1795602600 * 1000));
      expect(resources.floatFields).toEqual(['host_cpu_percent', 'host_memory_percent', 'process_cpu_percent', 'process_memory_percent']);
      expect(client.get).toHaveBeenCalledWith('/statistics/resources', { params: { timespan: 6 } });
    });

    it('emits no Resources point without rows', async () => {
      client.override('/statistics/resources', { MediaContainer: { size: 0 } });

      expect(ofType(await plugin.collect(), 'Resources')).toEqual([]);
    });

    it('summarises transcoder sessions', async () => {
      const [summary] = ofType(await plugin.collect(), 'TranscodeSessions');

      expect(summary.fields).toEqual({ count: 2, video_transcodes: 1, audio_transcodes: 1, hw_decoding: 1, hw_encoding: 1, throttled: 1 });
    });

    it('fails the status collector when one endpoint fails', async () => {
      client.fail('/butler', new Error('boom'));

      await expect(plugin.collect()).rejects.toThrow('boom');
    });

    it('schedules status when enabled', () => {
      expect(plugin.getSchedules().map((s) => [s.name, s.intervalSeconds])).toEqual([['Plex_1_status', 300]]);
    });
  });
});
