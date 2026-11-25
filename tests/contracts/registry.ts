import fs from 'node:fs';
import path from 'node:path';
import { matchPathTemplate, stripQuery } from './lib/paths';
import type { ServiceId } from './lib/spec';

export interface ContractRoute {
  service: ServiceId;
  method: 'get';
  path: string;
  fixture: string;
}

export const contractRoutes: ContractRoute[] = [
  { service: 'radarr', method: 'get', path: '/api/v3/queue', fixture: 'radarr/queue' },
  { service: 'radarr', method: 'get', path: '/api/v3/movie', fixture: 'radarr/movie' },
  { service: 'radarr', method: 'get', path: '/api/v3/system/status', fixture: 'radarr/system-status' },
  { service: 'radarr', method: 'get', path: '/api/v3/update', fixture: 'radarr/update' },
  { service: 'radarr', method: 'get', path: '/api/v3/health', fixture: 'radarr/health' },
  { service: 'bazarr', method: 'get', path: '/api/movies/wanted', fixture: 'bazarr/movies-wanted' },
  { service: 'bazarr', method: 'get', path: '/api/episodes/wanted', fixture: 'bazarr/episodes-wanted' },
  { service: 'bazarr', method: 'get', path: '/api/movies/history', fixture: 'bazarr/movies-history' },
  { service: 'bazarr', method: 'get', path: '/api/episodes/history', fixture: 'bazarr/episodes-history' },
  { service: 'bazarr', method: 'get', path: '/api/system/health', fixture: 'bazarr/system-health' },
  { service: 'bazarr', method: 'get', path: '/api/system/status', fixture: 'bazarr/system-status' },
  { service: 'sonarr', method: 'get', path: '/api/v3/queue', fixture: 'sonarr/queue' },
  { service: 'sonarr', method: 'get', path: '/api/v3/calendar', fixture: 'sonarr/calendar' },
  { service: 'sonarr', method: 'get', path: '/api/v3/system/status', fixture: 'sonarr/system-status' },
  { service: 'sonarr', method: 'get', path: '/api/v3/update', fixture: 'sonarr/update' },
  { service: 'sonarr', method: 'get', path: '/api/v3/health', fixture: 'sonarr/health' },
  { service: 'lidarr', method: 'get', path: '/api/v1/queue', fixture: 'lidarr/queue' },
  { service: 'lidarr', method: 'get', path: '/api/v1/wanted/missing', fixture: 'lidarr/wanted-missing' },
  { service: 'lidarr', method: 'get', path: '/api/v1/system/status', fixture: 'lidarr/system-status' },
  { service: 'lidarr', method: 'get', path: '/api/v1/update', fixture: 'lidarr/update' },
  { service: 'lidarr', method: 'get', path: '/api/v1/health', fixture: 'lidarr/health' },
  { service: 'readarr', method: 'get', path: '/api/v1/queue', fixture: 'readarr/queue' },
  { service: 'readarr', method: 'get', path: '/api/v1/wanted/missing', fixture: 'readarr/wanted-missing' },
  { service: 'readarr', method: 'get', path: '/api/v1/system/status', fixture: 'readarr/system-status' },
  { service: 'readarr', method: 'get', path: '/api/v1/update', fixture: 'readarr/update' },
  { service: 'readarr', method: 'get', path: '/api/v1/health', fixture: 'readarr/health' },
  { service: 'prowlarr', method: 'get', path: '/api/v1/indexerstats', fixture: 'prowlarr/indexerstats' },
  { service: 'prowlarr', method: 'get', path: '/api/v1/system/status', fixture: 'prowlarr/system-status' },
  { service: 'prowlarr', method: 'get', path: '/api/v1/update', fixture: 'prowlarr/update' },
  { service: 'prowlarr', method: 'get', path: '/api/v1/health', fixture: 'prowlarr/health' },
  { service: 'seerr', method: 'get', path: '/api/v1/request/count', fixture: 'seerr/request-count' },
  { service: 'seerr', method: 'get', path: '/api/v1/issue/count', fixture: 'seerr/issue-count' },
  { service: 'seerr', method: 'get', path: '/api/v1/request', fixture: 'seerr/request' },
  { service: 'seerr', method: 'get', path: '/api/v1/movie/{movieId}', fixture: 'seerr/movie' },
  { service: 'seerr', method: 'get', path: '/api/v1/tv/{tvId}', fixture: 'seerr/tv' },
  { service: 'seerr', method: 'get', path: '/api/v1/status', fixture: 'seerr/status' },
  { service: 'ombi', method: 'get', path: '/api/v1/Request/count', fixture: 'ombi/request-count' },
  { service: 'ombi', method: 'get', path: '/api/v1/Issues/count', fixture: 'ombi/issues-count' },
  { service: 'ombi', method: 'get', path: '/api/v1/Identity/Users', fixture: 'ombi/identity-users' },
  { service: 'ombi', method: 'get', path: '/api/v1/Settings/about', fixture: 'ombi/settings-about' },
  { service: 'ombi', method: 'get', path: '/api/v1/Update', fixture: 'ombi/update' },
  { service: 'ombi', method: 'get', path: '/api/v1/Request/tv', fixture: 'ombi/request-tv' },
  { service: 'ombi', method: 'get', path: '/api/v1/Request/movie', fixture: 'ombi/request-movie' },
  { service: 'ombi', method: 'get', path: '/api/v1/Status', fixture: 'ombi/status' },
  { service: 'plex', method: 'get', path: '/identity', fixture: 'plex/identity' },
  { service: 'plex', method: 'get', path: '/', fixture: 'plex/root' },
  { service: 'plex', method: 'get', path: '/updater/status', fixture: 'plex/updater-status' },
  { service: 'plex', method: 'get', path: '/status/sessions', fixture: 'plex/status-sessions' },
  { service: 'plex', method: 'get', path: '/library/sections/all', fixture: 'plex/library-sections' },
  { service: 'plex', method: 'get', path: '/library/sections/{sectionId}/all', fixture: 'plex/library-section-all' },
  { service: 'jellyfin', method: 'get', path: '/System/Info', fixture: 'jellyfin/system-info' },
  { service: 'jellyfin', method: 'get', path: '/Sessions', fixture: 'jellyfin/sessions' },
  { service: 'jellyfin', method: 'get', path: '/Library/VirtualFolders', fixture: 'jellyfin/virtual-folders' },
  { service: 'jellyfin', method: 'get', path: '/Items/Counts', fixture: 'jellyfin/items-counts' },
  { service: 'emby', method: 'get', path: '/emby/System/Info', fixture: 'emby/system-info' },
  { service: 'emby', method: 'get', path: '/emby/Sessions', fixture: 'emby/sessions' },
  { service: 'emby', method: 'get', path: '/emby/Library/VirtualFolders', fixture: 'emby/virtual-folders' },
  { service: 'emby', method: 'get', path: '/emby/Items/Counts', fixture: 'emby/items-counts' },
  { service: 'tautulli', method: 'get', path: '/api/v2?cmd=get_activity', fixture: 'tautulli/get-activity' },
  { service: 'tautulli', method: 'get', path: '/api/v2?cmd=get_libraries', fixture: 'tautulli/get-libraries' },
  { service: 'tautulli', method: 'get', path: '/api/v2?cmd=get_geoip_lookup', fixture: 'tautulli/get-geoip-lookup' },
  { service: 'tautulli', method: 'get', path: '/api/v2?cmd=get_server_info', fixture: 'tautulli/get-server-info' },
  { service: 'tautulli', method: 'get', path: '/api/v2?cmd=get_tautulli_info', fixture: 'tautulli/get-tautulli-info' },
  { service: 'tautulli', method: 'get', path: '/api/v2?cmd=update_check', fixture: 'tautulli/update-check' },
  { service: 'tautulli', method: 'get', path: '/api/v2?cmd=get_pms_update', fixture: 'tautulli/get-pms-update' },
  { service: 'sonarr', method: 'get', path: '/api/v3/diskspace', fixture: 'sonarr/diskspace' },
  { service: 'sonarr', method: 'get', path: '/api/v3/rootfolder', fixture: 'sonarr/rootfolder' },
  { service: 'sonarr', method: 'get', path: '/api/v3/queue/status', fixture: 'sonarr/queue-status' },
  { service: 'sonarr', method: 'get', path: '/api/v3/system/task', fixture: 'sonarr/system-task' },
  { service: 'radarr', method: 'get', path: '/api/v3/diskspace', fixture: 'radarr/diskspace' },
  { service: 'radarr', method: 'get', path: '/api/v3/rootfolder', fixture: 'radarr/rootfolder' },
  { service: 'radarr', method: 'get', path: '/api/v3/queue/status', fixture: 'radarr/queue-status' },
  { service: 'radarr', method: 'get', path: '/api/v3/system/task', fixture: 'radarr/system-task' },
  { service: 'lidarr', method: 'get', path: '/api/v1/diskspace', fixture: 'lidarr/diskspace' },
  { service: 'lidarr', method: 'get', path: '/api/v1/rootfolder', fixture: 'lidarr/rootfolder' },
  { service: 'lidarr', method: 'get', path: '/api/v1/queue/status', fixture: 'lidarr/queue-status' },
  { service: 'lidarr', method: 'get', path: '/api/v1/system/task', fixture: 'lidarr/system-task' },
  { service: 'readarr', method: 'get', path: '/api/v1/diskspace', fixture: 'readarr/diskspace' },
  { service: 'readarr', method: 'get', path: '/api/v1/rootfolder', fixture: 'readarr/rootfolder' },
  { service: 'readarr', method: 'get', path: '/api/v1/queue/status', fixture: 'readarr/queue-status' },
  { service: 'readarr', method: 'get', path: '/api/v1/system/task', fixture: 'readarr/system-task' },
  { service: 'sonarr', method: 'get', path: '/api/v3/wanted/missing', fixture: 'sonarr/wanted-missing' },
  { service: 'sonarr', method: 'get', path: '/api/v3/wanted/cutoff', fixture: 'sonarr/wanted-cutoff' },
  { service: 'sonarr', method: 'get', path: '/api/v3/blocklist', fixture: 'sonarr/blocklist' },
  { service: 'radarr', method: 'get', path: '/api/v3/wanted/missing', fixture: 'radarr/wanted-missing' },
  { service: 'radarr', method: 'get', path: '/api/v3/wanted/cutoff', fixture: 'radarr/wanted-cutoff' },
  { service: 'radarr', method: 'get', path: '/api/v3/blocklist', fixture: 'radarr/blocklist' },
  { service: 'lidarr', method: 'get', path: '/api/v1/wanted/cutoff', fixture: 'lidarr/wanted-cutoff' },
  { service: 'lidarr', method: 'get', path: '/api/v1/blocklist', fixture: 'lidarr/blocklist' },
  { service: 'readarr', method: 'get', path: '/api/v1/wanted/cutoff', fixture: 'readarr/wanted-cutoff' },
  { service: 'readarr', method: 'get', path: '/api/v1/blocklist', fixture: 'readarr/blocklist' },
  { service: 'sonarr', method: 'get', path: '/api/v3/history/since', fixture: 'sonarr/history-since' },
  { service: 'radarr', method: 'get', path: '/api/v3/history/since', fixture: 'radarr/history-since' },
  { service: 'lidarr', method: 'get', path: '/api/v1/history/since', fixture: 'lidarr/history-since' },
  { service: 'readarr', method: 'get', path: '/api/v1/history/since', fixture: 'readarr/history-since' },
  { service: 'sonarr', method: 'get', path: '/api/v3/series', fixture: 'sonarr/series' },
  { service: 'radarr', method: 'get', path: '/api/v3/collection', fixture: 'radarr/collection' },
  { service: 'lidarr', method: 'get', path: '/api/v1/artist', fixture: 'lidarr/artist' },
  { service: 'readarr', method: 'get', path: '/api/v1/author', fixture: 'readarr/author' },
];

const fixturesDir = path.resolve(__dirname, '../fixtures/api');

export function findRoute(service: ServiceId, method: 'get', calledPath: string): ContractRoute | undefined {
  const path = stripQuery(calledPath);
  const candidates = contractRoutes.filter((r) => r.service === service && r.method === method);
  return (
    candidates.find((r) => r.path === calledPath) ??
    candidates.find((r) => r.path === path) ??
    candidates.find((r) => matchPathTemplate(r.path, path))
  );
}

export function loadFixture<T = unknown>(fixture: string): T {
  return JSON.parse(fs.readFileSync(path.join(fixturesDir, `${fixture}.json`), 'utf8')) as T;
}
