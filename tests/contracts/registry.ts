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
