import type { ContractHttpClient } from '../../fixtures/contract-http';
import { HOUR, fixtureOf } from './fixtures';

type Item = Record<string, unknown>;

export function seerrVariants(client: ContractHttpClient): void {
  client.override('/api/v1/request', () => {
    const body = fixtureOf<{ results: Item[] }>('seerr', '/api/v1/request');
    const now = Date.now();
    body.results = body.results.map((request, k) => {
      const created = new Date(now - (k + 1) * 7 * HOUR).toISOString();
      return { ...request, createdAt: created, updatedAt: created };
    });
    return body;
  });
}
