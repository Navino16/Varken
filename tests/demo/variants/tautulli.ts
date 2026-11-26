import type { ContractHttpClient } from '../../fixtures/contract-http';
import { utcDays, utcMonths } from '../timeline';
import { around, cycle, epochSeconds, fixtureOf, liveCount, recentEvents } from './fixtures';

type Item = Record<string, unknown>;
interface Envelope<T> {
  response: { data: T };
}
interface Graph {
  categories: string[];
  series: { name: string; data: (number | null)[] }[];
}

const DAILY_GRAPHS = ['get_plays_by_date', 'get_plays_by_stream_type', 'get_concurrent_streams_by_stream_type'];
const TRANSCODE_FIELDS: Record<string, string> = {
  transcode: 'stream_count_transcode',
  'direct play': 'stream_count_direct_play',
  copy: 'stream_count_direct_stream',
};

const path = (cmd: string): string => `/api/v2?cmd=${cmd}`;
const fixture = <T>(cmd: string): Envelope<T> => fixtureOf<Envelope<T>>('tautulli', path(cmd));

function activity(): Envelope<Item> {
  const body = fixture<Item & { sessions: Item[] }>('get_activity');
  const data = body.response.data;
  const sessions = cycle(data.sessions, liveCount('tautulli', 6), (session, k) => {
    session.session_key = `${session.session_key}${k}`;
    session.session_id = `${session.session_id}${k}`;
  });
  const counts: Record<string, number> = { stream_count_transcode: 0, stream_count_direct_play: 0, stream_count_direct_stream: 0 };
  const bandwidth = { lan: 0, wan: 0 };
  for (const session of sessions) {
    const field = TRANSCODE_FIELDS[String(session.transcode_decision)];
    if (field) {
      counts[field]++;
    }
    bandwidth[session.location === 'wan' ? 'wan' : 'lan'] += Number(session.bandwidth) || 0;
  }
  Object.assign(data, counts, {
    sessions,
    stream_count: String(sessions.length),
    lan_bandwidth: bandwidth.lan,
    wan_bandwidth: bandwidth.wan,
    total_bandwidth: bandwidth.lan + bandwidth.wan,
  });
  return body;
}

function history(): Envelope<Item> {
  const body = fixture<Item & { data: Item[] }>('get_history');
  const rows = body.response.data.data;
  body.response.data.data = recentEvents('tautulli|history', 3).map((event) => {
    const row = rows[event.index % rows.length];
    const stopped = epochSeconds(event.at);
    const started = stopped - (Number(row.stopped) - Number(row.started));
    return { ...row, stopped, started, date: started, row_id: event.id, reference_id: event.id, id: event.id, group_ids: String(event.id) };
  });
  body.response.data.recordsTotal = body.response.data.data.length;
  body.response.data.recordsFiltered = body.response.data.data.length;
  return body;
}

function recentlyAdded(): Envelope<Item> {
  const body = fixture<Item & { recently_added: Item[] }>('get_recently_added');
  const items = body.response.data.recently_added;
  body.response.data.recently_added = recentEvents('tautulli|recently_added', 0.5).map((event) => ({
    ...items[event.index % items.length],
    added_at: String(epochSeconds(event.at)),
    rating_key: String(event.id),
  }));
  return body;
}

function graph(cmd: string, categories: (now: number, count: number) => string[]): Envelope<Graph> {
  const body = fixture<Graph>(cmd);
  const data = body.response.data;
  data.categories = categories(Date.now(), data.categories.length);
  for (const series of data.series) {
    const values = series.data.filter((value): value is number => typeof value === 'number');
    const mean = values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
    series.data = data.categories.map((category) => around(mean, `${cmd}|${series.name}|${category}`));
  }
  return body;
}

export function tautulliVariants(client: ContractHttpClient): void {
  client.override(path('get_activity'), activity);
  client.override(path('get_history'), history);
  client.override(path('get_recently_added'), recentlyAdded);
  for (const cmd of DAILY_GRAPHS) {
    client.override(path(cmd), () => graph(cmd, utcDays));
  }
  client.override(path('get_plays_per_month'), () => graph('get_plays_per_month', utcMonths));
}
