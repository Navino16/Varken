import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import axios from 'axios';
import { EmbyPlugin } from '../../../src/plugins/inputs/EmbyPlugin';
import { EmbyConfigSchema } from '../../../src/config/schemas/config.schema';
import type { EmbyConfig } from '../../../src/types/inputs/emby.types';
import { createContractHttpClient, type ContractHttpClient } from '../../fixtures/contract-http';
import { loadFixture } from '../../contracts/registry';
import type { DataPoint } from '../../../src/types/plugin.types';
import { useEventStateFolder } from '../../../src/utils/EventStateStore';

vi.mock('../../../src/core/Logger', async () => {
  const { loggerMock } = await import('../../fixtures/logger');
  return loggerMock();
});

vi.mock('axios', () => ({ default: { create: vi.fn() } }));

const NOW = new Date('2026-11-25T10:30:00Z');

function config(keys: Partial<Record<'status' | 'history' | 'inventory' | 'liveTv', boolean>>): EmbyConfig {
  const schedule = (enabled = false): { enabled: boolean; intervalSeconds: number } => ({ enabled, intervalSeconds: 300 });
  return EmbyConfigSchema.parse({
    id: 1,
    url: 'http://emby.local:8096',
    apiKey: 'test-key',
    status: schedule(keys.status),
    history: schedule(keys.history),
    inventory: schedule(keys.inventory),
    liveTv: schedule(keys.liveTv),
  }) as EmbyConfig;
}

const ofType = (points: DataPoint[], type: string): DataPoint[] => points.filter((p) => p.tags.type === type);
const values = (points: DataPoint[]): unknown[] => points.flatMap((p) => [...Object.values(p.tags), ...Object.values(p.fields)]);

describe('EmbyPlugin collectors', () => {
  let plugin: EmbyPlugin;
  let client: ContractHttpClient;

  beforeEach(() => {
    vi.useFakeTimers({ now: NOW });
    useEventStateFolder(null);
    plugin = new EmbyPlugin();
    client = createContractHttpClient('emby');
    (axios.create as Mock).mockReturnValue(client);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('status', () => {
    beforeEach(async () => {
      await plugin.initialize(config({ status: true }));
    });

    it('collects status points', async () => {
      const points = await plugin.collect();

      expect(ofType(points, 'Task')[0]).toMatchObject({
        measurement: 'Emby',
        tags: { task: 'RefreshLibrary', state: 'Running', last_status: 'Completed', server: 1 },
        fields: { progress: 42.5, last_execution_age_seconds: 5309, last_duration_seconds: 90.5 },
      });
      expect(ofType(points, 'Task')[2].tags.last_status).toBe('never');
      expect(ofType(points, 'Tasks')[0].fields).toEqual({ running: 1, failed: 1 });
      expect(ofType(points, 'Plugin').map((p) => p.tags)).toEqual([
        { type: 'Plugin', plugin: 'Trakt', version: '3.5.0.0', server: 1 },
        { type: 'Plugin', plugin: 'Open Subtitles', version: '1.0.40.0', server: 1 },
      ]);
      expect(ofType(points, 'Plugins')[0].fields).toEqual({ plugins: 2 });
      expect(ofType(points, 'Storage')).toEqual([]);
      expect(client.get).toHaveBeenCalledWith('/emby/ScheduledTasks', { params: { IsHidden: false } });
    });

    it('fails the status collector when one endpoint fails', async () => {
      client.fail('/emby/Plugins', new Error('boom'));

      await expect(plugin.collect()).rejects.toThrow('boom');
    });

    it('schedules status when enabled', () => {
      expect(plugin.getSchedules().map((s) => [s.name, s.intervalSeconds])).toEqual([['Emby_1_status', 300]]);
    });
  });

  describe('history', () => {
    beforeEach(async () => {
      vi.setSystemTime(new Date('2026-11-25T07:30:00Z'));
      await plugin.initialize(config({ history: true }));
      vi.setSystemTime(NOW);
    });

    it('collects activity points', async () => {
      const activities = ofType(await plugin.collect(), 'Activity');

      expect(activities.map((p) => p.timestamp.getTime())).toEqual([
        Date.parse('2026-11-25T09:12:34Z') + 201,
        Date.parse('2026-11-25T09:12:34Z') + 202,
        Date.parse('2026-11-25T09:59:00Z') + 203,
      ]);
      expect(activities[0]).toMatchObject({
        tags: { activity_type: 'VideoPlayback', severity: 'Info', user_id: 'e1f2a3b4c5d64e7f8a9b0c1d2e3f4a5b', item_id: '501' },
        fields: { name: 'alice is playing Arrival on Living Room TV', hash: expect.any(String) },
      });
      expect(activities[2].tags).toMatchObject({ item_id: 'none', user_id: 'unknown' });
      expect(values(activities)).not.toContain('IP address: 192.168.1.20');
    });

    it('asks the activity log since the cursor', async () => {
      await plugin.collect();

      expect(client.get).toHaveBeenCalledWith('/emby/System/ActivityLog/Entries', { params: { MinDate: '2026-11-25T07:30:00.000Z' } });
    });

    it('emits activity entries once', async () => {
      await plugin.collect();

      expect(ofType(await plugin.collect(), 'Activity')).toEqual([]);
    });

    it('schedules history when enabled', () => {
      expect(plugin.getSchedules().map((s) => s.name)).toEqual(['Emby_1_history']);
    });
  });

  describe('inventory', () => {
    beforeEach(async () => {
      await plugin.initialize(config({ inventory: true }));
    });

    it('collects inventory points', async () => {
      const points = await plugin.collect();

      expect(ofType(points, 'User')[0]).toMatchObject({
        tags: { user_id: 'e1f2a3b4c5d64e7f8a9b0c1d2e3f4a5b', username: 'admin' },
        fields: { is_admin: 1, is_disabled: 0, is_hidden: 1, has_password: 1, last_activity_age_seconds: 3600, last_login_age_seconds: 433800 },
      });
      expect(ofType(points, 'Users')[0].fields).toEqual({ users: 2, admins: 1, disabled: 1, active_24h: 1, active_30d: 2 });
      expect(ofType(points, 'Device')[0]).toMatchObject({
        tags: { device_id: '7', device_name: 'Alice phone', app_name: 'Emby for iOS', app_version: '2.2.30', last_user: 'alice' },
        fields: { last_activity_age_seconds: 1800 },
      });
      expect(ofType(points, 'Devices')[0].fields).toEqual({ devices: 2, active_24h: 1 });
    });

    it('never emits device IP addresses', async () => {
      const emitted = values(await plugin.collect());

      expect(emitted).not.toContain('192.168.1.42');
      expect(emitted).not.toContain('203.0.113.50');
    });

    it('schedules inventory when enabled', () => {
      expect(plugin.getSchedules().map((s) => s.name)).toEqual(['Emby_1_inventory']);
    });
  });

  describe('live TV', () => {
    beforeEach(async () => {
      await plugin.initialize(config({ liveTv: true }));
    });

    it('collects live TV points', async () => {
      const recordings = loadFixture<{ Items: unknown[] }>('emby/livetv-recordings');
      client.override('/emby/LiveTv/Recordings', (params) => (params?.IsInProgress ? { ...recordings, TotalRecordCount: 1 } : recordings));

      const [liveTv] = ofType(await plugin.collect(), 'LiveTv');

      expect(liveTv.fields).toEqual({
        recordings: 12,
        recordings_in_progress: 1,
        timers: 2,
        recordings_scheduled: 1,
        recordings_failed: 1,
        next_recording_in_seconds: 5400,
      });
      expect(client.get).toHaveBeenCalledWith('/emby/LiveTv/Recordings', { params: { Limit: 1 } });
      expect(client.get).toHaveBeenCalledWith('/emby/LiveTv/Recordings', { params: { IsInProgress: true, Limit: 1 } });
    });

    it('schedules liveTv when enabled', () => {
      expect(plugin.getSchedules().map((s) => s.name)).toEqual(['Emby_1_liveTv']);
    });
  });
});
