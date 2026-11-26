import type { ServiceId } from '../../contracts/lib/spec';
import type { ContractHttpClient } from '../../fixtures/contract-http';
import { bazarrVariants } from './bazarr';
import { jellyfinEmbyVariants } from './jellyfinEmby';
import { plexVariants } from './plex';
import { seerrVariants } from './seerr';
import { servarrVariants } from './servarr';
import { tautulliVariants } from './tautulli';

/** Fixture overrides that follow the simulated clock: events inside the window, live data varying with the hour. */
export function applyDemoVariants(service: ServiceId, client: ContractHttpClient): void {
  switch (service) {
    case 'sonarr':
    case 'radarr':
    case 'lidarr':
    case 'readarr':
    case 'prowlarr':
      servarrVariants(service, client);
      break;
    case 'jellyfin':
    case 'emby':
      jellyfinEmbyVariants(service, client);
      break;
    case 'tautulli':
      tautulliVariants(client);
      break;
    case 'plex':
      plexVariants(client);
      break;
    case 'bazarr':
      bazarrVariants(client);
      break;
    case 'seerr':
      seerrVariants(client);
      break;
    default:
      break;
  }
}
