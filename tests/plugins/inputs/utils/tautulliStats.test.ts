import { describe, it, expect } from 'vitest';
import {
  completedBuckets,
  graphSnapshotPoints,
  homeStatPoints,
  mediaInfoPoints,
  seriesKey,
  watchTimeFields,
} from '../../../../src/plugins/inputs/utils/tautulliStats';
import { numberOf } from '../../../../src/plugins/inputs/utils/numbers';

const now = new Date('2026-11-25T10:30:00Z');
const epoch = (iso: string): number => Date.parse(iso) / 1000;

describe('numberOf', () => {
  it('reads numbers sent as strings and drops empty or non-numeric values', () => {
    expect([numberOf('42'), numberOf(7), numberOf(''), numberOf(null), numberOf(undefined), numberOf('n/a')]).toEqual([
      42,
      7,
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
  });
});

describe('seriesKey', () => {
  it('maps series names to snake_case keys', () => {
    expect(['TV', 'Movies', 'Live TV', 'Direct Play', 'Max. Concurrent Streams', 'Total'].map(seriesKey)).toEqual([
      'tv',
      'movies',
      'live_tv',
      'direct_play',
      'max_concurrent_streams',
      'total',
    ]);
  });
});

describe('graphSnapshotPoints', () => {
  const graph = {
    categories: ['Monday', 'Tuesday'],
    series: [
      { name: 'TV', data: [5, 3] },
      { name: 'Movies', data: [1, 0] },
    ],
  };

  it('emits one snapshot point per category', () => {
    expect(graphSnapshotPoints('PlaysByDayOfWeek', 'day', graph)).toEqual([
      { tags: { type: 'PlaysByDayOfWeek', day: 'Monday' }, fields: { tv: 5, movies: 1 } },
      { tags: { type: 'PlaysByDayOfWeek', day: 'Tuesday' }, fields: { tv: 3, movies: 0 } },
    ]);
  });

  it('omits series the server does not report', () => {
    const [point] = graphSnapshotPoints('PlaysByDayOfWeek', 'day', graph);

    expect(point.fields).not.toHaveProperty('music');
    expect(point.fields).not.toHaveProperty('live_tv');
  });

  it('emits no point for a graph without series', () => {
    expect(graphSnapshotPoints('PlaysByHourOfDay', 'hour', { categories: ['00', '01'] })).toEqual([]);
    expect(graphSnapshotPoints('PlaysByHourOfDay', 'hour', { categories: ['00'], series: [] })).toEqual([]);
  });
});

describe('completedBuckets', () => {
  it('returns every day but the current one', () => {
    const { buckets } = completedBuckets(
      { categories: ['2026-11-23', '2026-11-24', '2026-11-25'], series: [{ name: 'TV', data: [3, 1, 4] }, { name: 'Total', data: [3, 1, 4] }] },
      'day'
    );

    expect(buckets).toEqual([
      { category: '2026-11-23', start: Date.parse('2026-11-23T00:00:00Z'), end: Date.parse('2026-11-24T00:00:00Z'), fields: { tv: 3, total: 3 } },
      { category: '2026-11-24', start: Date.parse('2026-11-24T00:00:00Z'), end: Date.parse('2026-11-25T00:00:00Z'), fields: { tv: 1, total: 1 } },
    ]);
  });

  it('parses month categories', () => {
    const { buckets } = completedBuckets({ categories: ['Nov 2026', 'Dec 2026', 'Jan 2027'], series: [{ name: 'TV', data: [40, 52, 31] }] }, 'month');

    expect(buckets.map((b) => [b.category, new Date(b.start).toISOString(), new Date(b.end).toISOString(), b.fields])).toEqual([
      ['Nov 2026', '2026-11-01T00:00:00.000Z', '2026-12-01T00:00:00.000Z', { tv: 40 }],
      ['Dec 2026', '2026-12-01T00:00:00.000Z', '2027-01-01T00:00:00.000Z', { tv: 52 }],
    ]);
  });

  it('skips unparsable categories', () => {
    const months = completedBuckets({ categories: ['Okt. 2026', 'Oct 2026', 'Nov 2026'], series: [{ name: 'TV', data: [1, 2, 3] }] }, 'month');
    const days = completedBuckets({ categories: ['2026-13-40', '2026-11-24', '2026-11-25'], series: [{ name: 'TV', data: [1, 2, 3] }] }, 'day');

    expect(months.buckets.map((b) => b.category)).toEqual(['Oct 2026']);
    expect(months.skipped).toEqual(['Okt. 2026']);
    expect(days.buckets.map((b) => b.category)).toEqual(['2026-11-24']);
    expect(days.skipped).toEqual(['2026-13-40']);
  });

  it('returns no bucket without series', () => {
    expect(completedBuckets({ categories: ['2026-11-24', '2026-11-25'], series: [] }, 'day')).toEqual({ buckets: [], skipped: [] });
  });
});

describe('homeStatPoints', () => {
  it('maps home stat rows by rank', () => {
    const points = homeStatPoints(
      [
        {
          stat_id: 'top_movies',
          rows: [
            { title: 'Inception', total_plays: 12, total_duration: 86400, users_watched: '', last_play: epoch('2026-11-25T08:30:00Z') },
            { title: 'Arrival', total_plays: 7, total_duration: 50400, users_watched: '', last_play: epoch('2026-11-24T08:30:00Z') },
          ],
        },
        { stat_id: 'popular_tv', rows: [{ title: 'Severance', users_watched: 4, total_plays: 20 }] },
        { stat_id: 'top_users', rows: [{ title: 'Inception', friendly_name: 'Jon Snow', user: 'jon', total_plays: 40, total_duration: 144000 }] },
        { stat_id: 'top_platforms', rows: [{ title: '', platform_name: 'Android', total_plays: 25, total_duration: 90000 }] },
        { stat_id: 'top_libraries', rows: [{ title: 'Inception', section_name: 'Movies', total_plays: 120, total_duration: 864000 }] },
        { stat_id: 'most_concurrent', rows: [{ title: 'Concurrent Streams', count: 3, started: '1795586400' }] },
      ],
      now
    );

    expect(points.map((p) => [p.tags, p.fields])).toEqual([
      [{ type: 'HomeStat', stat_id: 'top_movies', rank: 1 }, { title: 'Inception', plays: 12, duration_seconds: 86400, last_play_age_seconds: 7200 }],
      [{ type: 'HomeStat', stat_id: 'top_movies', rank: 2 }, { title: 'Arrival', plays: 7, duration_seconds: 50400, last_play_age_seconds: 93600 }],
      [{ type: 'HomeStat', stat_id: 'popular_tv', rank: 1 }, { title: 'Severance', plays: 20, users_watched: 4 }],
      [{ type: 'HomeStat', stat_id: 'top_users', rank: 1 }, { title: 'Jon Snow', plays: 40, duration_seconds: 144000 }],
      [{ type: 'HomeStat', stat_id: 'top_platforms', rank: 1 }, { title: 'Android', plays: 25, duration_seconds: 90000 }],
      [{ type: 'HomeStat', stat_id: 'top_libraries', rank: 1 }, { title: 'Movies', plays: 120, duration_seconds: 864000 }],
      [{ type: 'HomeStat', stat_id: 'most_concurrent', rank: 1 }, { title: 'Concurrent Streams', count: 3 }],
    ]);
  });

  it('labels item cards by the item, not the user who watched it', () => {
    const [point] = homeStatPoints([{ stat_id: 'last_watched', rows: [{ title: 'Inception', friendly_name: 'Jon Snow', section_name: 'Movies' }] }], now);

    expect(point.fields.title).toBe('Inception');
  });

  it('reads the last play of the last watched card', () => {
    const [point] = homeStatPoints([{ stat_id: 'last_watched', rows: [{ title: 'Inception', last_watch: epoch('2026-11-25T09:30:00Z') }] }], now);

    expect(point.fields.last_play_age_seconds).toBe(3600);
  });

  it('skips cards without stat id or rows', () => {
    expect(homeStatPoints([{ rows: [{ title: 'x', total_plays: 1 }] }, { stat_id: 'top_tv' }], now)).toEqual([]);
  });
});

describe('watchTimeFields', () => {
  it('names watch time fields by query days', () => {
    expect(
      watchTimeFields([
        { query_days: 1, total_plays: 2, total_time: 7200 },
        { query_days: 7, total_plays: 9, total_time: 30600 },
        { query_days: 0, total_plays: 120, total_time: 864000 },
        { total_plays: 5 },
      ])
    ).toEqual({ plays_1d: 2, watch_seconds_1d: 7200, plays_7d: 9, watch_seconds_7d: 30600, plays_all: 120, watch_seconds_all: 864000 });
  });
});

describe('mediaInfoPoints', () => {
  it('groups media info by resolution and codec', () => {
    const tags = { section_id: 1, section_name: 'Movies', section_type: 'movie' };
    const points = mediaInfoPoints(tags, [
      { video_resolution: '1080', video_codec: 'h264', file_size: 12000000000 },
      { video_resolution: '1080', video_codec: 'h264', file_size: '10000000000' },
      { video_resolution: '4k', video_codec: 'hevc', file_size: 52000000000 },
      { video_resolution: '', video_codec: null, file_size: '' },
    ]);

    expect(points).toEqual([
      { tags: { type: 'MediaInfo', ...tags, video_resolution: '1080', video_codec: 'h264' }, fields: { items: 2, file_size: 22000000000 } },
      { tags: { type: 'MediaInfo', ...tags, video_resolution: '4k', video_codec: 'hevc' }, fields: { items: 1, file_size: 52000000000 } },
      { tags: { type: 'MediaInfo', ...tags, video_resolution: 'unknown', video_codec: 'unknown' }, fields: { items: 1 } },
    ]);
  });
});
