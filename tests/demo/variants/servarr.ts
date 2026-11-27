import type { components } from '../../../src/types/generated/sonarr';
import type { ContractHttpClient } from '../../fixtures/contract-http';
import { random } from '../timeline';
import { HOUR, fixtureOf, recentEvents } from './fixtures';

type Servarr = 'sonarr' | 'radarr' | 'lidarr' | 'readarr' | 'prowlarr';
// Sonarr's schemas stand for the five Servarr APIs: the fields rewritten here are common to all of them.
type History = components['schemas']['HistoryResource'];
type QueuePage = components['schemas']['QueueResourcePagingResource'];
type QueueStatus = components['schemas']['QueueStatusResource'];

const API: Record<Servarr, string> = { sonarr: '/api/v3', radarr: '/api/v3', lidarr: '/api/v1', readarr: '/api/v1', prowlarr: '/api/v1' };

/** Downloads in the queue this hour: at least one, at most the fixture's records so clones never share their tags. */
function queueSize(service: Servarr, records: number): number {
  return 1 + Math.floor(random(`${service}|queue|${Math.floor(Date.now() / HOUR)}`) * records);
}

export function servarrVariants(service: Servarr, client: ContractHttpClient): void {
  const api = API[service];
  const history = `${api}/history/since`;
  client.override(history, () => {
    const items = fixtureOf<History[]>(service, history);
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
    const page = fixtureOf<QueuePage>(service, queue);
    const records = page.records ?? [];
    const size = queueSize(service, records.length);
    const now = Date.now();
    const stalled = Math.floor(now / HOUR) % 2 === 0;
    page.records = records.slice(0, size).map((record, k) => ({
      ...record,
      estimatedCompletionTime: new Date(now + (k + 1) * 20 * 60_000).toISOString(),
      ...(stalled && k === 0 ? { trackedDownloadStatus: 'warning' as const } : {}),
    }));
    page.totalRecords = size;
    return page;
  });
  client.override(`${api}/queue/status`, () => {
    const status = fixtureOf<QueueStatus>(service, `${api}/queue/status`);
    const size = queueSize(service, fixtureOf<QueuePage>(service, queue).records?.length ?? 0);
    return { ...status, totalCount: size, count: size, unknownCount: 0 };
  });
}
