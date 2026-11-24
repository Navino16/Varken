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
  { service: 'bazarr', method: 'get', path: '/api/movies/wanted', fixture: 'bazarr/movies-wanted' },
  { service: 'bazarr', method: 'get', path: '/api/episodes/wanted', fixture: 'bazarr/episodes-wanted' },
  { service: 'bazarr', method: 'get', path: '/api/movies/history', fixture: 'bazarr/movies-history' },
  { service: 'bazarr', method: 'get', path: '/api/episodes/history', fixture: 'bazarr/episodes-history' },
  { service: 'bazarr', method: 'get', path: '/api/system/health', fixture: 'bazarr/system-health' },
  { service: 'sonarr', method: 'get', path: '/api/v3/queue', fixture: 'sonarr/queue' },
  { service: 'sonarr', method: 'get', path: '/api/v3/calendar', fixture: 'sonarr/calendar' },
  { service: 'sonarr', method: 'get', path: '/api/v3/system/status', fixture: 'sonarr/system-status' },
  { service: 'lidarr', method: 'get', path: '/api/v1/queue', fixture: 'lidarr/queue' },
  { service: 'lidarr', method: 'get', path: '/api/v1/wanted/missing', fixture: 'lidarr/wanted-missing' },
  { service: 'lidarr', method: 'get', path: '/api/v1/system/status', fixture: 'lidarr/system-status' },
  { service: 'readarr', method: 'get', path: '/api/v1/queue', fixture: 'readarr/queue' },
  { service: 'readarr', method: 'get', path: '/api/v1/wanted/missing', fixture: 'readarr/wanted-missing' },
  { service: 'readarr', method: 'get', path: '/api/v1/system/status', fixture: 'readarr/system-status' },
  { service: 'prowlarr', method: 'get', path: '/api/v1/indexerstats', fixture: 'prowlarr/indexerstats' },
  { service: 'prowlarr', method: 'get', path: '/api/v1/system/status', fixture: 'prowlarr/system-status' },
  { service: 'seerr', method: 'get', path: '/api/v1/request/count', fixture: 'seerr/request-count' },
  { service: 'seerr', method: 'get', path: '/api/v1/issue/count', fixture: 'seerr/issue-count' },
  { service: 'seerr', method: 'get', path: '/api/v1/request', fixture: 'seerr/request' },
  { service: 'seerr', method: 'get', path: '/api/v1/movie/{movieId}', fixture: 'seerr/movie' },
  { service: 'seerr', method: 'get', path: '/api/v1/tv/{tvId}', fixture: 'seerr/tv' },
  { service: 'seerr', method: 'get', path: '/api/v1/status', fixture: 'seerr/status' },
  { service: 'ombi', method: 'get', path: '/api/v1/Request/count', fixture: 'ombi/request-count' },
  { service: 'ombi', method: 'get', path: '/api/v1/Issues/count', fixture: 'ombi/issues-count' },
  { service: 'ombi', method: 'get', path: '/api/v1/Identity/Users', fixture: 'ombi/identity-users' },
  { service: 'ombi', method: 'get', path: '/api/v1/Request/tv', fixture: 'ombi/request-tv' },
  { service: 'ombi', method: 'get', path: '/api/v1/Request/movie', fixture: 'ombi/request-movie' },
  { service: 'ombi', method: 'get', path: '/api/v1/Status', fixture: 'ombi/status' },
];

const fixturesDir = path.resolve(__dirname, '../fixtures/api');

export function findRoute(service: ServiceId, method: 'get', calledPath: string): ContractRoute | undefined {
  const path = stripQuery(calledPath);
  const candidates = contractRoutes.filter((r) => r.service === service && r.method === method);
  return candidates.find((r) => r.path === path) ?? candidates.find((r) => matchPathTemplate(r.path, path));
}

export function loadFixture<T = unknown>(fixture: string): T {
  return JSON.parse(fs.readFileSync(path.join(fixturesDir, `${fixture}.json`), 'utf8')) as T;
}
