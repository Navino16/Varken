import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import axios from 'axios';
import { PlexPlugin } from '../../../src/plugins/inputs/PlexPlugin';
import { PlexConfigSchema } from '../../../src/config/schemas/config.schema';
import type { PlexConfig } from '../../../src/types/inputs/plex.types';
import { createContractHttpClient, type ContractHttpClient } from '../../fixtures/contract-http';
import type { DataPoint } from '../../../src/types/plugin.types';
import { useEventStateFolder } from '../../../src/utils/EventStateStore';

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
    useEventStateFolder(null);
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

  describe('bandwidth events', () => {
    beforeEach(async () => {
      vi.setSystemTime(new Date('2026-11-25T07:30:00Z'));
      await plugin.initialize(config({ status: true }));
      vi.setSystemTime(NOW);
    });

    const bandwidth = (points: DataPoint[]): DataPoint[] => ofType(points, 'Bandwidth');

    it('emits completed bandwidth hours once', async () => {
      const first = bandwidth(await plugin.collect());

      expect(first.map((p) => [p.timestamp.toISOString(), p.tags.network, p.tags.username, p.fields.bytes])).toEqual([
        ['2026-11-25T08:00:00.000Z', 'lan', 'admin', 1073741824],
        ['2026-11-25T09:00:00.000Z', 'wan', 'alice', 536870912],
        ['2026-11-25T09:00:00.000Z', 'lan', 'admin', 268435456],
      ]);
      expect(first[0].tags).toMatchObject({ account_id: 1, device_id: 11, device_name: 'Living Room TV', platform: 'Android' });

      vi.setSystemTime(new Date('2026-11-25T10:45:00Z'));
      expect(bandwidth(await plugin.collect())).toEqual([]);

      vi.setSystemTime(new Date('2026-11-25T11:05:00Z'));
      expect(bandwidth(await plugin.collect()).map((p) => p.timestamp.toISOString())).toEqual(['2026-11-25T10:00:00.000Z']);
    });

    it('asks hourly bandwidth since the cursor', async () => {
      await plugin.collect();
      vi.setSystemTime(new Date('2026-11-25T10:45:00Z'));
      await plugin.collect();

      const queries = (client.get as Mock).mock.calls.filter(([path]) => path === '/statistics/bandwidth').map(([, options]) => options.params);
      expect(queries).toEqual([
        { timespan: 4, 'at>': Date.parse('2026-11-25T06:30:00Z') / 1000 },
        { timespan: 4, 'at>': Date.parse('2026-11-25T09:00:00Z') / 1000 },
      ]);
    });

    it('emits nothing for hours that completed before plugin start', async () => {
      plugin = new PlexPlugin();
      await plugin.initialize(config({ status: true }));

      expect(bandwidth(await plugin.collect()).map((p) => p.timestamp.toISOString())).toEqual([]);
    });
  });

  describe('history', () => {
    beforeEach(async () => {
      vi.setSystemTime(new Date('2026-11-25T07:30:00Z'));
      await plugin.initialize(config({ history: true }));
      vi.setSystemTime(NOW);
    });

    it('emits one Play point per history row', async () => {
      const plays = ofType(await plugin.collect(), 'Play');

      expect(plays.map((p) => p.timestamp.getTime())).toEqual([1795597954201, 1795597954202, 1795600740203]);
      expect(plays[0]).toMatchObject({
        measurement: 'Plex',
        tags: {
          media_type: 'movie',
          library_section_id: '1',
          rating_key: '501',
          account_id: 1,
          username: 'admin',
          device_id: 11,
          device_name: 'Living Room TV',
          platform: 'Android',
          server: 1,
        },
        fields: { title: 'Arrival', hash: expect.any(String) },
      });
      expect(client.get).toHaveBeenCalledWith('/status/sessions/history/all', { params: { 'viewedAt>': Date.parse('2026-11-25T07:30:00Z') / 1000 } });
    });

    it('does not re-emit plays on the next poll', async () => {
      await plugin.collect();

      expect(ofType(await plugin.collect(), 'Play')).toEqual([]);
    });

    it('tags unknown accounts and devices as unknown', async () => {
      const plays = ofType(await plugin.collect(), 'Play');

      expect(plays[2].tags).toMatchObject({ account_id: 3, username: 'unknown', device_id: 99, device_name: 'unknown', platform: 'unknown' });
    });

    it('schedules history when enabled', () => {
      expect(plugin.getSchedules().map((s) => [s.name, s.intervalSeconds])).toEqual([['Plex_1_history', 300]]);
    });
  });

  describe('inventory', () => {
    beforeEach(async () => {
      await plugin.initialize(config({ inventory: true }));
    });

    it('collects the inventory', async () => {
      const points = await plugin.collect();

      expect(ofType(points, 'Inventory')[0].fields).toEqual({ accounts: 2, devices: 2 });
      expect(ofType(points, 'Device').map((p) => [p.tags.device_id, p.tags.device_name, p.tags.platform, p.fields])).toEqual([
        [11, 'Living Room TV', 'Android', { created_age_days: 5 }],
        [12, "Alice's iPhone", 'iOS', { created_age_days: 370 }],
      ]);
    });

    it('never emits device client identifiers', async () => {
      const values = (await plugin.collect()).flatMap((p) => [...Object.values(p.tags), ...Object.values(p.fields)]);

      expect(values).not.toContain('a1b2c3d4e5f6-living-room');
      expect(values).not.toContain('f6e5d4c3b2a1-alice-phone');
    });

    it('schedules inventory when enabled', () => {
      expect(plugin.getSchedules().map((s) => [s.name, s.intervalSeconds])).toEqual([['Plex_1_inventory', 300]]);
    });
  });

  describe('live TV', () => {
    beforeEach(async () => {
      await plugin.initialize(config({ liveTv: true }));
    });

    it('collects live TV sessions and recordings', async () => {
      const points = await plugin.collect();

      expect(ofType(points, 'LiveTv')[0].fields).toEqual({ sessions: 1, recordings_scheduled: 1, recordings_in_progress: 1, recordings_failed: 1 });
      expect(ofType(points, 'Recording')).toEqual([
        expect.objectContaining({
          tags: { type: 'Recording', grab_id: 'grab-2', provider: 'tv.plex.providers.epg.cloud', server: 1 },
          fields: { percent: 55.5 },
          floatFields: ['percent'],
        }),
      ]);
    });

    it('keeps live TV sessions when the server has no DVR', async () => {
      client.fail('/media/subscriptions/scheduled', Object.assign(new Error('Request failed with status code 403'), { response: { status: 403 } }));

      const points = await plugin.collect();

      expect(ofType(points, 'LiveTv')[0].fields).toEqual({ sessions: 1 });
      expect(ofType(points, 'Recording')).toEqual([]);
    });

    it('fails on any other scheduled recordings error', async () => {
      client.fail('/media/subscriptions/scheduled', Object.assign(new Error('Request failed with status code 500'), { response: { status: 500 } }));

      await expect(plugin.collect()).rejects.toThrow('500');
    });

    it('schedules liveTv when enabled', () => {
      expect(plugin.getSchedules().map((s) => [s.name, s.intervalSeconds])).toEqual([['Plex_1_liveTv', 300]]);
    });
  });
});
