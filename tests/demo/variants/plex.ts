import type { ContractHttpClient } from '../../fixtures/contract-http';
import { loadFixture } from '../../contracts/registry';
import { activity, random } from '../timeline';
import { HOUR, cycle, epochSeconds, fixtureOf, liveCount, recentEvents } from './fixtures';

type Item = Record<string, unknown>;
interface Container<T> {
  MediaContainer: T;
}
interface Bandwidth {
  accountID: number;
  deviceID: number;
  lan: boolean;
  at: number;
  bytes: number;
}

function sessions(): Container<Item> {
  const body = fixtureOf<Container<Item & { Metadata: Item[] }>>('plex', '/status/sessions');
  const metadata = cycle(body.MediaContainer.Metadata, liveCount('plex', 4), (item, k) => {
    item.sessionKey = `${item.sessionKey}${k}`;
    const session = item.Session as Item | undefined;
    if (session) {
      session.id = `${session.id}${k}`;
    }
  });
  Object.assign(body.MediaContainer, { Metadata: metadata, size: metadata.length });
  return body;
}

function history(): Container<Item> {
  const body = fixtureOf<Container<Item & { Metadata: Item[] }>>('plex', '/status/sessions/history/all');
  const items = body.MediaContainer.Metadata;
  const metadata = recentEvents('plex|history', 2).map((event) => ({
    ...items[event.index % items.length],
    historyKey: `/status/sessions/history/${event.id}`,
    viewedAt: epochSeconds(event.at),
  }));
  Object.assign(body.MediaContainer, { Metadata: metadata, size: metadata.length, totalSize: metadata.length });
  return body;
}

/** One row per completed hour of the last day for each account/device/network seen in the fixture. */
function bandwidth(): Container<Item> {
  const body = fixtureOf<Container<Item & { StatisticsBandwidth: Bandwidth[] }>>('plex', '/statistics/bandwidth');
  const combos = new Map<string, Bandwidth>();
  for (const row of body.MediaContainer.StatisticsBandwidth) {
    combos.set(`${row.accountID}-${row.deviceID}-${row.lan}`, combos.get(`${row.accountID}-${row.deviceID}-${row.lan}`) ?? row);
  }
  const currentHour = Math.floor(Date.now() / HOUR) * HOUR;
  const rows: Bandwidth[] = [];
  for (let hour = currentHour - 24 * HOUR; hour < currentHour; hour += HOUR) {
    for (const [key, row] of combos) {
      rows.push({ ...row, at: epochSeconds(hour), bytes: Math.round(row.bytes * activity(hour) * (0.5 + random(`plex|bandwidth|${key}|${hour}`))) });
    }
  }
  Object.assign(body.MediaContainer, { StatisticsBandwidth: rows, size: rows.length });
  return body;
}

export function plexVariants(client: ContractHttpClient): void {
  client.override('/status/sessions', sessions);
  client.override('/status/sessions/history/all', history);
  client.override('/statistics/bandwidth', bandwidth);
  const serverInfo = loadFixture<{ response: { data: { pms_identifier: string } } }>('tautulli/get-server-info');
  const identity = fixtureOf<Container<Item>>('plex', '/identity');
  identity.MediaContainer.machineIdentifier = serverInfo.response.data.pms_identifier;
  client.override('/identity', identity);
}
