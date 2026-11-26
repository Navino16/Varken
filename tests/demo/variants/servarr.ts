import type { ContractHttpClient } from '../../fixtures/contract-http';
import { random } from '../timeline';
import { HOUR, fixtureOf, recentEvents } from './fixtures';

type Servarr = 'sonarr' | 'radarr' | 'lidarr' | 'readarr' | 'prowlarr';
type Item = Record<string, unknown>;

const API: Record<Servarr, string> = { sonarr: '/api/v3', radarr: '/api/v3', lidarr: '/api/v1', readarr: '/api/v1', prowlarr: '/api/v1' };

/** Downloads in the queue this hour, at most the fixture's records so clones never share their tags. */
function queueSize(service: Servarr, records: number): number {
  return Math.floor(random(`${service}|queue|${Math.floor(Date.now() / HOUR)}`) * (records + 1));
}

export function servarrVariants(service: Servarr, client: ContractHttpClient): void {
  const api = API[service];
  const history = `${api}/history/since`;
  client.override(history, () => {
    const items = fixtureOf<Item[]>(service, history);
    return recentEvents(`${service}|history`, service === 'prowlarr' ? 4 : 2).map((event) => ({
      ...items[event.index % items.length],
      id: event.id,
      date: new Date(event.at).toISOString(),
    }));
  });
  if (service === 'prowlarr') {
    return;
  }

  const queue = `${api}/queue`;
  client.override(queue, () => {
    const page = fixtureOf<{ records: Item[]; totalRecords: number }>(service, queue);
    const size = queueSize(service, page.records.length);
    const now = Date.now();
    page.records = page.records.slice(0, size).map((record, k) => ({
      ...record,
      estimatedCompletionTime: new Date(now + (k + 1) * 20 * 60_000).toISOString(),
    }));
    page.totalRecords = size;
    return page;
  });
  client.override(`${api}/queue/status`, () => {
    const status = fixtureOf<Item>(service, `${api}/queue/status`);
    const size = queueSize(service, fixtureOf<{ records: Item[] }>(service, queue).records.length);
    return { ...status, totalCount: size, count: size, unknownCount: 0 };
  });
}
