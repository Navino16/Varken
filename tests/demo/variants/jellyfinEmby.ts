import type { JsonResponse } from '../../../src/types/api-contract';
import type { paths } from '../../../src/types/generated/jellyfin';
import type { ContractHttpClient } from '../../fixtures/contract-http';
import { cycle, fixtureOf, liveCount, recentEvents } from './fixtures';

// Jellyfin's schemas stand for Emby's too: the session and activity-log fields rewritten here are common to both.
type Sessions = JsonResponse<paths, '/Sessions'>;
type ActivityLog = JsonResponse<paths, '/System/ActivityLog/Entries'>;

export function jellyfinEmbyVariants(service: 'jellyfin' | 'emby', client: ContractHttpClient): void {
  const prefix = service === 'emby' ? '/emby' : '';
  const sessionsPath = `${prefix}/Sessions`;
  client.override(sessionsPath, () => {
    const sessions = fixtureOf<Sessions>(service, sessionsPath);
    const active = sessions.filter((session) => session.NowPlayingItem);
    const idle = sessions.filter((session) => !session.NowPlayingItem);
    const playing = cycle(active, liveCount(service, 4), (session, k) => {
      session.Id = `${String(session.Id).slice(0, -2)}${k.toString(16).padStart(2, '0')}`;
    });
    return [...playing, ...idle];
  });

  const logPath = `${prefix}/System/ActivityLog/Entries`;
  client.override(logPath, () => {
    const log = fixtureOf<ActivityLog>(service, logPath);
    const items = log.Items ?? [];
    log.Items = recentEvents(`${service}|history`, 2).map((event) => ({
      ...items[event.index % items.length],
      Id: event.id,
      Date: new Date(event.at).toISOString().replace('Z', '0000Z'),
    }));
    log.TotalRecordCount = log.Items.length;
    return log;
  });
}
