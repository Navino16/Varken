import type { JsonResponse } from '../../../src/types/api-contract';
import type { paths } from '../../../src/types/generated/tautulli';
import type { ContractHttpClient } from '../../fixtures/contract-http';
import { utcDays, utcMonths } from '../timeline';
import { around, cycle, epochSeconds, fixtureOf, liveCount, recentEvents } from './fixtures';

type Activity = JsonResponse<paths, '/api/v2?cmd=get_activity'>;
type History = JsonResponse<paths, '/api/v2?cmd=get_history'>;
type RecentlyAdded = JsonResponse<paths, '/api/v2?cmd=get_recently_added'>;
type Graph = JsonResponse<paths, '/api/v2?cmd=get_plays_by_date'>;
type GraphCommand = 'get_plays_by_date' | 'get_plays_by_stream_type' | 'get_concurrent_streams_by_stream_type' | 'get_plays_per_month';

const DAILY_GRAPHS: GraphCommand[] = ['get_plays_by_date', 'get_plays_by_stream_type', 'get_concurrent_streams_by_stream_type'];
const TRANSCODE_FIELDS = {
  transcode: 'stream_count_transcode',
  'direct play': 'stream_count_direct_play',
  copy: 'stream_count_direct_stream',
} as const;

const path = (cmd: string): string => `/api/v2?cmd=${cmd}`;

function activity(): Activity {
  const body = fixtureOf<Activity>('tautulli', path('get_activity'));
  const data = body.response?.data ?? {};
  const sessions = cycle(data.sessions ?? [], liveCount('tautulli', 6), (session, k) => {
    session.session_key = `${session.session_key}${k}`;
    session.session_id = `${session.session_id}${k}`;
  });
  const counts = { stream_count_transcode: 0, stream_count_direct_play: 0, stream_count_direct_stream: 0 };
  const bandwidth = { lan: 0, wan: 0 };
  for (const session of sessions) {
    const field = TRANSCODE_FIELDS[session.transcode_decision as keyof typeof TRANSCODE_FIELDS];
    if (field) {
      counts[field]++;
    }
    bandwidth[session.location === 'wan' ? 'wan' : 'lan'] += Number(session.bandwidth) || 0;
  }
  body.response = {
    ...body.response,
    data: {
      ...data,
      ...counts,
      sessions,
      stream_count: String(sessions.length),
      lan_bandwidth: bandwidth.lan,
      wan_bandwidth: bandwidth.wan,
      total_bandwidth: bandwidth.lan + bandwidth.wan,
    },
  };
  return body;
}

function history(): History {
  const body = fixtureOf<History>('tautulli', path('get_history'));
  const data = body.response?.data ?? {};
  const rows = data.data ?? [];
  const plays = recentEvents('tautulli|history', 3).map((event) => {
    const row = rows[event.index % rows.length];
    const stopped = epochSeconds(event.at);
    const started = stopped - (Number(row.stopped) - Number(row.started));
    return { ...row, stopped, started, date: started, row_id: event.id, reference_id: event.id, id: event.id, group_ids: String(event.id) };
  });
  body.response = { ...body.response, data: { ...data, data: plays, recordsTotal: plays.length, recordsFiltered: plays.length } };
  return body;
}

function recentlyAdded(): RecentlyAdded {
  const body = fixtureOf<RecentlyAdded>('tautulli', path('get_recently_added'));
  const data = body.response?.data ?? {};
  const items = data.recently_added ?? [];
  const added = recentEvents('tautulli|recently_added', 0.5).map((event) => ({
    ...items[event.index % items.length],
    added_at: String(epochSeconds(event.at)),
    rating_key: String(event.id),
  }));
  body.response = { ...body.response, data: { ...data, recently_added: added } };
  return body;
}

function graph(cmd: GraphCommand, categories: (now: number, count: number) => string[]): Graph {
  const body = fixtureOf<Graph>('tautulli', path(cmd));
  const data = body.response?.data ?? {};
  const labels = categories(Date.now(), data.categories?.length ?? 0);
  const series = (data.series ?? []).map((line) => {
    const values = (line.data ?? []).filter((value): value is number => typeof value === 'number');
    const mean = values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
    return { ...line, data: labels.map((label) => around(mean, `${cmd}|${line.name}|${label}`)) };
  });
  body.response = { ...body.response, data: { ...data, categories: labels, series } };
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
