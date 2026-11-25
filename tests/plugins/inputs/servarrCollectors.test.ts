import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import axios from 'axios';
import { SonarrPlugin } from '../../../src/plugins/inputs/SonarrPlugin';
import { RadarrPlugin } from '../../../src/plugins/inputs/RadarrPlugin';
import { LidarrPlugin } from '../../../src/plugins/inputs/LidarrPlugin';
import { ReadarrPlugin } from '../../../src/plugins/inputs/ReadarrPlugin';
import {
  LidarrConfigSchema,
  RadarrConfigSchema,
  ReadarrConfigSchema,
  SonarrConfigSchema,
} from '../../../src/config/schemas/config.schema';
import type { DataPoint } from '../../../src/types/plugin.types';
import { createContractHttpClient, type ContractHttpClient } from '../../fixtures/contract-http';
import { useEventStateFolder } from '../../../src/utils/EventStateStore';

vi.mock('../../../src/core/Logger', async () => {
  const { loggerMock } = await import('../../fixtures/logger');
  return loggerMock();
});

vi.mock('axios', () => ({ default: { create: vi.fn() } }));

/** Collectors whose behaviour is identical across Sonarr, Radarr, Lidarr and Readarr. */
const services = [
  { name: 'Sonarr', service: 'sonarr', prefix: '/api/v3', create: () => new SonarrPlugin(), schema: SonarrConfigSchema },
  { name: 'Radarr', service: 'radarr', prefix: '/api/v3', create: () => new RadarrPlugin(), schema: RadarrConfigSchema },
  { name: 'Lidarr', service: 'lidarr', prefix: '/api/v1', create: () => new LidarrPlugin(), schema: LidarrConfigSchema },
  { name: 'Readarr', service: 'readarr', prefix: '/api/v1', create: () => new ReadarrPlugin(), schema: ReadarrConfigSchema },
] as const;

type Service = (typeof services)[number];
type Plugin = ReturnType<Service['create']>;

const NOW = new Date('2026-11-24T12:00:00Z');

describe.each(services)('$name shared Servarr collectors', (svc) => {
  let plugin: Plugin;
  let client: ContractHttpClient;

  const init = async (keys: Record<string, unknown>): Promise<void> => {
    await (plugin.initialize as (config: unknown) => Promise<void>)(
      svc.schema.parse({ id: 1, url: 'http://localhost:8989', apiKey: 'key', ...keys })
    );
  };
  const ofType = (points: DataPoint[], type: string): DataPoint[] => points.filter((p) => p.tags.type === type);

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    useEventStateFolder(null);
    plugin = svc.create();
    client = createContractHttpClient(svc.service);
    (axios.create as Mock).mockReturnValue(client);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('status', () => {
    beforeEach(async () => {
      await init({ status: { enabled: true, intervalSeconds: 300 } });
    });

    it('collects status points', async () => {
      const points = await plugin.collect();

      expect(points.every((p) => p.measurement === svc.name && p.tags.server === 1)).toBe(true);
      expect(ofType(points, 'Health')[0].fields).toEqual({ errors: 1, warnings: 1, notices: 0 });
      expect(ofType(points, 'HealthIssue').map((p) => [p.tags.source, p.tags.level])).toEqual([
        ['IndexerStatusCheck', 'warning'],
        ['RootFolderCheck', 'error'],
      ]);
      expect(ofType(points, 'DiskSpace').map((p) => [p.tags.path, p.fields.free_bytes, p.fields.total_bytes, p.fields.used_percent])).toEqual([
        ['/data/media', 250000000000, 1000000000000, 75],
        ['/config', 50000000000, 100000000000, 50],
      ]);
      expect(ofType(points, 'QueueStatus')[0].fields).toEqual({
        total_count: 5,
        count: 4,
        unknown_count: 1,
        errors: 1,
        warnings: 0,
        unknown_errors: 0,
        unknown_warnings: 0,
      });
      expect(ofType(points, 'Task').map((p) => [p.tags.task, p.fields])).toEqual([
        [
          'RefreshMonitoredDownloads',
          { interval_minutes: 1, last_execution_age_seconds: 60, last_duration_seconds: 0.25, next_execution_in_seconds: 30 },
        ],
        ['RssSync', { interval_minutes: 15, last_execution_age_seconds: 3600, last_duration_seconds: 12.5, next_execution_in_seconds: -2700 }],
        ['Backup', { interval_minutes: 10080, last_duration_seconds: 0, next_execution_in_seconds: 43200 }],
      ]);
    });

    it('collects root folders', async () => {
      const roots = ofType(await plugin.collect(), 'RootFolder');

      expect(roots).toHaveLength(2);
      expect(roots[0].fields).toMatchObject({ accessible: 1, free_bytes: 250000000000 });
      if (svc.name === 'Sonarr' || svc.name === 'Radarr') {
        expect(roots[0].fields.unmapped_folders).toBe(1);
        expect(roots[1].fields).toEqual({ accessible: 0 });
      } else {
        expect(roots[0].tags.name).toBeDefined();
        expect(roots[0].fields.total_bytes).toBe(1000000000000);
      }
    });

    it('schedules status when enabled', () => {
      const schedule = plugin.getSchedules().find((s) => s.name === `${svc.name}_1_status`);

      expect(schedule?.intervalSeconds).toBe(300);
    });

    it('fails the status collector when one endpoint fails', async () => {
      client.fail(`${svc.prefix}/diskspace`, new Error('boom'));

      await expect(plugin.collect()).rejects.toThrow('boom');
    });
  });
});

describe('Readarr root folders', () => {
  it('never emits Calibre credentials', async () => {
    const client = createContractHttpClient('readarr');
    (axios.create as Mock).mockReturnValue(client);
    const plugin = new ReadarrPlugin();
    await plugin.initialize(ReadarrConfigSchema.parse({ id: 1, url: 'http://localhost:8787', apiKey: 'key', status: { enabled: true, intervalSeconds: 300 } }));

    const points = await plugin.collect();
    const values = points.flatMap((p) => [...Object.values(p.tags), ...Object.values(p.fields)]);

    expect(points.filter((p) => p.tags.type === 'RootFolder')).toHaveLength(2);

    expect(values).not.toContain('calibre.local');
    expect(values).not.toContain('calibre-user');
    expect(values).not.toContain('calibre-secret');
    expect(values).not.toContain(8081);
  });
});
