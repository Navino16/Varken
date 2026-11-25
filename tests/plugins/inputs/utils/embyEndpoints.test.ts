import { describe, it, expect } from 'vitest';
import {
  activityPoint,
  devicePoints,
  liveTvPoint,
  pluginPoints,
  storagePoints,
  taskPoints,
  userPoints,
} from '../../../../src/plugins/inputs/utils/embyEndpoints';

const now = new Date('2026-11-25T10:00:00Z');

describe('taskPoints', () => {
  const tasks = [
    {
      Key: 'RefreshLibrary',
      Name: 'Scan Media Library',
      Category: 'Library',
      State: 'Running',
      CurrentProgressPercentage: 42.5,
      LastExecutionResult: { Status: 'Completed', StartTimeUtc: '2026-11-25T09:00:00Z', EndTimeUtc: '2026-11-25T09:01:30.5Z' },
    },
    {
      Key: 'CleanCache',
      Name: 'Clean Cache Directory',
      Category: 'Maintenance',
      State: 'Idle',
      LastExecutionResult: { Status: 'Failed', StartTimeUtc: '2026-11-24T10:00:00Z', EndTimeUtc: '2026-11-24T10:00:10Z' },
    },
    { Key: 'Backup', Name: 'Backup', Category: 'Maintenance', State: 'Idle', CurrentProgressPercentage: null },
  ];

  it('maps every task and the summary', () => {
    const points = taskPoints(tasks, now);

    expect(points[0]).toEqual({
      tags: { type: 'Task', task: 'RefreshLibrary', name: 'Scan Media Library', category: 'Library', state: 'Running', last_status: 'Completed' },
      fields: { progress: 42.5, last_execution_age_seconds: 3509, last_duration_seconds: 90.5 },
      floatFields: ['progress', 'last_duration_seconds'],
    });
    expect(points.at(-1)).toEqual({ tags: { type: 'Tasks' }, fields: { running: 1, failed: 1 } });
  });

  it('omits progress of an idle task', () => {
    expect(taskPoints(tasks, now)[1].fields).not.toHaveProperty('progress');
  });

  it('marks a task that never ran as never', () => {
    const minValue = { Key: 'X', LastExecutionResult: { StartTimeUtc: '0001-01-01T00:00:00Z', EndTimeUtc: '0001-01-01T00:00:00Z' } };

    expect(taskPoints([tasks[2]], now)[0]).toMatchObject({ tags: { last_status: 'never' }, fields: {} });
    expect(taskPoints([minValue], now)[0].fields).toEqual({});
  });
});

describe('pluginPoints', () => {
  it('tags the status when the service reports it', () => {
    const points = pluginPoints([
      { Name: 'Trakt', Version: '25.0.0.0', Status: 'Active' },
      { Name: 'Old', Version: '1.0.0.0', Status: 'Malfunctioned' },
      { Name: 'Gone', Version: '2.0.0.0', Status: 'NotSupported' },
    ]);

    expect(points[0]).toEqual({ tags: { type: 'Plugin', plugin: 'Trakt', version: '25.0.0.0', status: 'Active' }, fields: { installed: 1 } });
    expect(points.at(-1)).toEqual({ tags: { type: 'Plugins' }, fields: { plugins: 3, plugins_active: 1, plugins_failing: 2 } });
  });

  it('emits plugins without a status tag', () => {
    const points = pluginPoints([{ Name: 'Trakt', Version: '3.5.0.0' }]);

    expect(points[0].tags).toEqual({ type: 'Plugin', plugin: 'Trakt', version: '3.5.0.0' });
    expect(points.at(-1)?.fields).toEqual({ plugins: 1 });
  });
});

describe('activityPoint', () => {
  it('maps an activity log entry', () => {
    expect(
      activityPoint(
        { Id: 1234, Type: 'VideoPlayback', Severity: 'Information', UserId: 'u1', ItemId: 'i1', Name: 'alice is playing Arrival', Overview: 'IP address: 10.0.0.2', Date: '2026-11-25T09:00:00Z' },
        'h'
      )
    ).toEqual({
      tags: { type: 'Activity', activity_type: 'VideoPlayback', severity: 'Information', user_id: 'u1', item_id: 'i1' },
      fields: { hash: 'h', name: 'alice is playing Arrival' },
      timestamp: new Date(Date.parse('2026-11-25T09:00:00Z') + 234),
    });
  });

  it('tags a missing item as none', () => {
    expect(activityPoint({ Id: 1, Date: '2026-11-25T09:00:00Z' }, 'h')?.tags).toMatchObject({ item_id: 'none', user_id: 'unknown', activity_type: 'unknown' });
  });

  it('returns no activity point for an unparsable date', () => {
    expect(activityPoint({ Id: 1, Date: 'garbage' }, 'h')).toBeUndefined();
  });
});

describe('userPoints', () => {
  const users = [
    { Id: 'a', Name: 'admin', HasPassword: true, LastActivityDate: '2026-11-25T09:00:00Z', LastLoginDate: '2026-11-20T10:00:00Z', Policy: { IsAdministrator: true, IsDisabled: false, IsHidden: true } },
    { Id: 'b', Name: 'bob', HasPassword: false, LastActivityDate: '2026-11-10T10:00:00Z', Policy: { IsAdministrator: false, IsDisabled: true, IsHidden: false } },
    { Id: 'c', Name: 'carol', LastActivityDate: '0001-01-01T00:00:00Z' },
  ];

  it('maps each user', () => {
    expect(userPoints(users, now)[0]).toEqual({
      tags: { type: 'User', user_id: 'a', username: 'admin' },
      fields: { is_admin: 1, is_disabled: 0, is_hidden: 1, has_password: 1, last_activity_age_seconds: 3600, last_login_age_seconds: 432000 },
    });
    expect(userPoints(users, now)[2].fields).toEqual({});
  });

  it('counts users active within 24 hours and 30 days', () => {
    expect(userPoints(users, now).at(-1)).toEqual({
      tags: { type: 'Users' },
      fields: { users: 3, admins: 1, disabled: 1, active_24h: 1, active_30d: 2 },
    });
  });
});

describe('devicePoints', () => {
  it('maps each device and the summary', () => {
    const points = devicePoints(
      [
        { Id: 'd1', Name: 'iPhone', CustomName: 'Alice phone', AppName: 'Swiftfin', AppVersion: '1.2', LastUserName: 'alice', DateLastActivity: '2026-11-25T09:30:00Z' },
        { Id: 'd2', Name: 'TV', AppName: 'Jellyfin Android TV', AppVersion: '0.18', LastUserName: 'bob', DateLastActivity: '2026-11-01T00:00:00Z' },
      ],
      now
    );

    expect(points[0]).toEqual({
      tags: { type: 'Device', device_id: 'd1', device_name: 'Alice phone', app_name: 'Swiftfin', app_version: '1.2', last_user: 'alice' },
      fields: { last_activity_age_seconds: 1800 },
    });
    expect(points[1].tags.device_name).toBe('TV');
    expect(points.at(-1)).toEqual({ tags: { type: 'Devices' }, fields: { devices: 2, active_24h: 1 } });
  });
});

describe('liveTvPoint', () => {
  it('counts recordings and timers', () => {
    expect(
      liveTvPoint(
        {
          recordings: 12,
          recordingsInProgress: 1,
          timers: [
            { Status: 'New', StartDate: '2026-11-25T12:00:00Z' },
            { Status: 'New', StartDate: '2026-11-25T11:00:00Z' },
            { Status: 'Error', StartDate: '2026-11-25T08:00:00Z' },
            { Status: 'ConflictedNotOk', StartDate: '2026-11-25T13:00:00Z' },
          ],
        },
        now
      )
    ).toEqual({
      tags: { type: 'LiveTv' },
      fields: { recordings: 12, recordings_in_progress: 1, timers: 4, recordings_scheduled: 2, recordings_failed: 2, next_recording_in_seconds: 3600 },
    });
  });

  it('omits next_recording_in_seconds without future timers', () => {
    expect(liveTvPoint({ timers: [] }, now).fields).toEqual({ timers: 0, recordings_scheduled: 0, recordings_failed: 0 });
  });
});

describe('storagePoints', () => {
  const folder = (path: string, free: number, used: number): { Path: string; FreeSpace: number; UsedSpace: number; StorageType: string } => ({
    Path: path,
    FreeSpace: free,
    UsedSpace: used,
    StorageType: 'ext4',
  });
  const storage = {
    ProgramDataFolder: folder('/config', 750, 250),
    WebFolder: folder('/web', 750, 250),
    ImageCacheFolder: folder('/cache/images', 750, 250),
    CacheFolder: folder('/cache', 750, 250),
    LogFolder: folder('/config/log', 750, 250),
    InternalMetadataFolder: folder('/config/metadata', 750, 250),
    TranscodingTempFolder: folder('/transcodes', 0, 0),
    Libraries: [{ Id: 'l1', Name: 'Movies', Folders: [folder('/data/movies', 100, 300), folder('/data/movies2', 50, 50)] }],
  };

  it('maps system and library folders', () => {
    const points = storagePoints(storage);

    expect(points.map((p) => [p.tags.folder, p.tags.library, p.tags.path])).toEqual([
      ['program_data', 'none', '/config'],
      ['web', 'none', '/web'],
      ['image_cache', 'none', '/cache/images'],
      ['cache', 'none', '/cache'],
      ['log', 'none', '/config/log'],
      ['internal_metadata', 'none', '/config/metadata'],
      ['transcoding_temp', 'none', '/transcodes'],
      ['library', 'Movies', '/data/movies'],
      ['library', 'Movies', '/data/movies2'],
    ]);
    expect(points[7]).toEqual({
      tags: { type: 'Storage', folder: 'library', library: 'Movies', path: '/data/movies', storage_type: 'ext4' },
      fields: { free_bytes: 100, used_bytes: 300, used_percent: 75 },
      floatFields: ['used_percent'],
    });
  });

  it('omits used_percent on an empty device', () => {
    expect(storagePoints(storage)[6].fields).toEqual({ free_bytes: 0, used_bytes: 0 });
  });

  it('treats -1 (device not readable) as absent', () => {
    expect(storagePoints({ ...storage, Libraries: [{ Id: 'l1', Name: 'Movies', Folders: [folder('/data/movies', -1, -1)] }] })[7].fields).toEqual({});
  });
});
