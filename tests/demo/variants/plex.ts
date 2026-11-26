import type { JsonResponse } from '../../../src/types/api-contract';
import type { paths } from '../../../src/types/generated/plex';
import type { paths as TautulliPaths } from '../../../src/types/generated/tautulli';
import type { ContractHttpClient } from '../../fixtures/contract-http';
import { loadFixture } from '../../contracts/registry';
import { activity, random } from '../timeline';
import { HOUR, cycle, epochSeconds, fixtureOf, liveCount, recentEvents } from './fixtures';

type Sessions = JsonResponse<paths, '/status/sessions'>;
type History = JsonResponse<paths, '/status/sessions/history/all'>;
type BandwidthStats = JsonResponse<paths, '/statistics/bandwidth'>;
type Bandwidth = NonNullable<NonNullable<BandwidthStats['MediaContainer']>['StatisticsBandwidth']>[number];
type Resources = JsonResponse<paths, '/statistics/resources'>;
type Identity = JsonResponse<paths, '/identity'>;
type ServerInfo = JsonResponse<TautulliPaths, '/api/v2?cmd=get_server_info'>;

function sessions(): Sessions {
  const body = fixtureOf<Sessions>('plex', '/status/sessions');
  const container = body.MediaContainer ?? {};
  const metadata = cycle(container.Metadata ?? [], liveCount('plex', 4), (item, k) => {
    item.sessionKey = `${item.sessionKey}${k}`;
    if (item.Session) {
      item.Session.id = `${item.Session.id}${k}`;
    }
  });
  body.MediaContainer = { ...container, Metadata: metadata, size: metadata.length };
  return body;
}

function history(): History {
  const body = fixtureOf<History>('plex', '/status/sessions/history/all');
  const container = body.MediaContainer ?? {};
  const items = container.Metadata ?? [];
  const metadata = recentEvents('plex|history', 2).map((event) => ({
    ...items[event.index % items.length],
    historyKey: `/status/sessions/history/${event.id}`,
    viewedAt: epochSeconds(event.at),
  }));
  body.MediaContainer = { ...container, Metadata: metadata, size: metadata.length, totalSize: metadata.length };
  return body;
}

/** One row per completed hour of the last day for each account/device/network seen in the fixture. */
function bandwidth(): BandwidthStats {
  const body = fixtureOf<BandwidthStats>('plex', '/statistics/bandwidth');
  const container = body.MediaContainer ?? {};
  const combos = new Map<string, Bandwidth>();
  for (const row of container.StatisticsBandwidth ?? []) {
    const key = `${row.accountID}-${row.deviceID}-${row.lan}`;
    combos.set(key, combos.get(key) ?? row);
  }
  const currentHour = Math.floor(Date.now() / HOUR) * HOUR;
  const rows: Bandwidth[] = [];
  for (let hour = currentHour - 24 * HOUR; hour < currentHour; hour += HOUR) {
    for (const [key, row] of combos) {
      const bytes = Math.round((row.bytes ?? 0) * activity(hour) * (0.5 + random(`plex|bandwidth|${key}|${hour}`)));
      rows.push({ ...row, at: epochSeconds(hour), bytes });
    }
  }
  body.MediaContainer = { ...container, StatisticsBandwidth: rows, size: rows.length };
  return body;
}

const percent = (value: number): number => Math.min(100, Math.round(value * 100) / 100);

/** The fixture's samples moved to the last minutes, CPU following the usage curve, memory steady. */
function resources(): Resources {
  const body = fixtureOf<Resources>('plex', '/statistics/resources');
  const container = body.MediaContainer ?? {};
  const samples = container.StatisticsResources ?? [];
  const now = Date.now();
  const load = 0.5 + activity(now);
  const rows = samples.map((sample, i) => {
    const jitter = (key: string): number => 0.8 + 0.4 * random(`plex|resources|${key}|${now}|${i}`);
    return {
      ...sample,
      at: epochSeconds(now) - (samples.length - 1 - i) * 60,
      hostCpuUtilization: percent((sample.hostCpuUtilization ?? 0) * load * jitter('host-cpu')),
      processCpuUtilization: percent((sample.processCpuUtilization ?? 0) * load * jitter('process-cpu')),
      hostMemoryUtilization: percent((sample.hostMemoryUtilization ?? 0) * jitter('host-memory')),
      processMemoryUtilization: percent((sample.processMemoryUtilization ?? 0) * jitter('process-memory')),
    };
  });
  body.MediaContainer = { ...container, StatisticsResources: rows };
  return body;
}

export function plexVariants(client: ContractHttpClient): void {
  client.override('/statistics/resources', resources);
  client.override('/status/sessions', sessions);
  client.override('/status/sessions/history/all', history);
  client.override('/statistics/bandwidth', bandwidth);
  const serverInfo = loadFixture<ServerInfo>('tautulli/get-server-info');
  const identity = fixtureOf<Identity>('plex', '/identity');
  identity.MediaContainer = { ...identity.MediaContainer, machineIdentifier: serverInfo.response?.data?.pms_identifier };
  client.override('/identity', identity);
}
