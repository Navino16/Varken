import { describe, it, expect } from 'vitest';
import {
  healthPoints,
  historyPoint,
  parseTimeSpan,
  pickNumbers,
  queueEnrichment,
  servarrTime,
  statusPoints,
  taskPoints,
  totalsPoint,
} from '../../../../src/plugins/inputs/utils/servarr';

const now = new Date('2026-11-25T10:00:00Z');
const hash = (s: string): string => `h(${s})`;

describe('queueEnrichment', () => {
  const item = {
    size: 1000.4,
    sizeleft: 250,
    estimatedCompletionTime: '2026-11-25T10:05:00Z',
    status: 'downloading',
    trackedDownloadState: 'downloading',
    trackedDownloadStatus: 'ok',
    downloadClient: 'qBittorrent',
    indexer: 'Nyaa',
  };

  it('tags download state and measures progress', () => {
    expect(queueEnrichment(item, now)).toEqual({
      tags: {
        status: 'downloading',
        tracked_download_state: 'downloading',
        tracked_download_status: 'ok',
        download_client: 'qBittorrent',
        indexer: 'Nyaa',
      },
      fields: { size: 1000, sizeleft: 250, progress: 75.00999600159936, eta_seconds: 300 },
      floatFields: ['progress'],
    });
  });

  it('omits progress when size is 0', () => {
    const { fields } = queueEnrichment({ ...item, size: 0, sizeleft: 0 }, now);

    expect(fields).not.toHaveProperty('progress');
    expect(fields.size).toBe(0);
  });

  it('omits eta when estimatedCompletionTime is absent and clamps a past one to 0', () => {
    expect(queueEnrichment({ ...item, estimatedCompletionTime: null }, now).fields).not.toHaveProperty('eta_seconds');
    expect(queueEnrichment({ ...item, estimatedCompletionTime: '2026-11-25T09:00:00Z' }, now).fields.eta_seconds).toBe(0);
  });

  it('labels missing values unknown', () => {
    expect(queueEnrichment({}, now)).toEqual({
      tags: {
        status: 'unknown',
        tracked_download_state: 'unknown',
        tracked_download_status: 'unknown',
        download_client: 'unknown',
        indexer: 'unknown',
      },
      fields: {},
      floatFields: ['progress'],
    });
  });
});

describe('servarrTime', () => {
  it('parses ISO times and treats DateTime.MinValue and garbage as absent', () => {
    expect(servarrTime('2026-11-25T10:00:00Z')).toBe(now.getTime());
    expect(servarrTime('0001-01-01T00:00:00Z')).toBeUndefined();
    expect(servarrTime('garbage')).toBeUndefined();
    expect(servarrTime(null)).toBeUndefined();
  });
});

describe('parseTimeSpan', () => {
  it.each([
    ['00:00:01.5000000', 1.5],
    ['1.02:03:04', 93784],
    ['00:10:00', 600],
  ])('parses %s', (span, seconds) => {
    expect(parseTimeSpan(span)).toBe(seconds);
  });

  it.each([['garbage'], [''], [null], [undefined]])('returns undefined for %s', (span) => {
    expect(parseTimeSpan(span)).toBeUndefined();
  });
});

describe('pickNumbers', () => {
  it('renames finite numbers and skips the rest', () => {
    expect(pickNumbers({ a: 1, b: Number.NaN, c: '3', d: 2.5 }, { a: 'x', b: 'y', c: 'z', d: 'w', e: 'v' })).toEqual({ x: 1, w: 2.5 });
    expect(pickNumbers(null, { a: 'x' })).toEqual({});
  });
});

describe('healthPoints', () => {
  it('counts issues by level and writes one point per issue', () => {
    const points = healthPoints(
      [
        { source: 'IndexerCheck', type: 'warning', message: 'No indexers' },
        { source: 'DownloadClientCheck', type: 'error', message: 'Unreachable' },
        { source: 'Ok', type: 'ok', message: '' },
      ],
      hash
    );

    expect(points).toEqual([
      { tags: { type: 'Health' }, fields: { errors: 1, warnings: 1, notices: 0 } },
      { tags: { type: 'HealthIssue', source: 'IndexerCheck', level: 'warning' }, fields: { message: 'No indexers', hash: 'h(IndexerCheckNo indexers)' } },
      { tags: { type: 'HealthIssue', source: 'DownloadClientCheck', level: 'error' }, fields: { message: 'Unreachable', hash: 'h(DownloadClientCheckUnreachable)' } },
    ]);
  });
});

describe('taskPoints', () => {
  it('measures task timings', () => {
    const [point] = taskPoints(
      [
        {
          name: 'Refresh Series',
          taskName: 'RefreshSeries',
          interval: 720,
          lastExecution: '2026-11-25T09:00:00Z',
          lastDuration: '00:00:12.5000000',
          nextExecution: '2026-11-25T09:59:00Z',
        },
      ],
      now
    );

    expect(point).toEqual({
      tags: { type: 'Task', task: 'RefreshSeries', name: 'Refresh Series' },
      fields: { interval_minutes: 720, last_execution_age_seconds: 3600, last_duration_seconds: 12.5, next_execution_in_seconds: -60 },
      floatFields: ['last_duration_seconds'],
    });
  });

  it('treats DateTime.MinValue as never executed', () => {
    const [point] = taskPoints(
      [{ taskName: 'Backup', interval: 10080, lastExecution: '0001-01-01T00:00:00Z', lastDuration: '00:00:00', nextExecution: '0001-01-01T00:00:00Z' }],
      now
    );

    expect(point.fields).toEqual({ interval_minutes: 10080, last_duration_seconds: 0 });
  });
});

describe('statusPoints', () => {
  const input = {
    health: [{ source: 'IndexerCheck', type: 'warning' as const, message: 'No indexers' }],
    disks: [{ path: '/data', label: 'data', freeSpace: 250, totalSpace: 1000 }],
    roots: [
      { path: '/tv', accessible: true, freeSpace: 250, unmappedFolders: [{ name: 'Old Show' }] },
      { path: '/gone', accessible: false, freeSpace: null },
    ],
    queue: { totalCount: 5, count: 4, unknownCount: 1, errors: true, warnings: false, unknownErrors: false, unknownWarnings: false },
    tasks: [{ taskName: 'Backup', interval: 10080 }],
  };

  it('writes health, disk, root folder, queue status and task points', () => {
    const points = statusPoints(input, now, hash);

    expect(points.map((p) => p.tags.type)).toEqual(['Health', 'HealthIssue', 'DiskSpace', 'RootFolder', 'RootFolder', 'QueueStatus', 'Task']);
    expect(points[2]).toEqual({
      tags: { type: 'DiskSpace', path: '/data', label: 'data' },
      fields: { free_bytes: 250, total_bytes: 1000, used_percent: 75 },
      floatFields: ['used_percent'],
    });
    expect(points[3]).toEqual({ tags: { type: 'RootFolder', path: '/tv' }, fields: { accessible: 1, free_bytes: 250, unmapped_folders: 1 } });
    expect(points[5]).toEqual({
      tags: { type: 'QueueStatus' },
      fields: { total_count: 5, count: 4, unknown_count: 1, errors: 1, warnings: 0, unknown_errors: 0, unknown_warnings: 0 },
    });
  });

  it('omits free_bytes when freeSpace is null', () => {
    expect(statusPoints(input, now, hash)[4]).toEqual({ tags: { type: 'RootFolder', path: '/gone' }, fields: { accessible: 0 } });
  });

  it('tags the root folder name and total size where the service has them', () => {
    const points = statusPoints({ ...input, roots: [{ name: 'Music', path: '/music', accessible: true, freeSpace: 1, totalSpace: 4 }] }, now, hash);

    expect(points.find((p) => p.tags.type === 'RootFolder')).toEqual({
      tags: { type: 'RootFolder', path: '/music', name: 'Music' },
      fields: { accessible: 1, free_bytes: 1, total_bytes: 4 },
    });
  });

  it('omits used_percent for a disk without total size', () => {
    const points = statusPoints({ ...input, disks: [{ path: '/x', label: '', freeSpace: 0, totalSpace: 0 }] }, now, hash);

    expect(points.find((p) => p.tags.type === 'DiskSpace')).toEqual({
      tags: { type: 'DiskSpace', path: '/x', label: 'unknown' },
      fields: { free_bytes: 0, total_bytes: 0 },
      floatFields: ['used_percent'],
    });
  });
});

describe('totalsPoint', () => {
  it('writes the totals the responses carried', () => {
    expect(totalsPoint({ missing: 12, cutoff_unmet: 3, blocklist: undefined })).toEqual({
      tags: { type: 'Totals' },
      fields: { missing: 12, cutoff_unmet: 3 },
    });
  });
});

describe('historyPoint', () => {
  const record = {
    id: 7,
    date: '2026-11-25T09:30:00Z',
    eventType: 'grabbed',
    quality: { quality: { name: 'WEBDL-1080p' } },
    data: { indexer: 'Nyaa', downloadClient: 'qBit', downloadClientName: 'qBittorrent', size: '1234' },
  };

  it('writes one event point at the event time', () => {
    expect(historyPoint(record, { seriesId: 1, episodeId: 2 }, 'abc')).toEqual({
      tags: {
        type: 'History',
        event_type: 'grabbed',
        quality: 'WEBDL-1080p',
        download_client: 'qBittorrent',
        indexer: 'Nyaa',
        seriesId: 1,
        episodeId: 2,
      },
      fields: { hash: 'abc', size: 1234 },
      timestamp: new Date('2026-11-25T09:30:00Z'),
    });
  });

  it('falls back to the client id and unknown labels', () => {
    const point = historyPoint({ date: record.date, data: { downloadClient: 'qBit', size: 'n/a' } }, {}, 'abc');

    expect(point?.tags).toEqual({ type: 'History', event_type: 'unknown', quality: 'unknown', download_client: 'qBit', indexer: 'unknown' });
    expect(point?.fields).toEqual({ hash: 'abc' });
  });

  it('returns undefined on a bad date', () => {
    expect(historyPoint({ ...record, date: 'garbage' }, {}, 'abc')).toBeUndefined();
  });
});
