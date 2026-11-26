import type { JsonResponse } from '../../../src/types/api-contract';
import type { paths } from '../../../src/types/generated/seerr';
import type { ContractHttpClient } from '../../fixtures/contract-http';
import { HOUR, fixtureOf } from './fixtures';

type Requests = JsonResponse<paths, '/request'>;

export function seerrVariants(client: ContractHttpClient): void {
  client.override('/api/v1/request', () => {
    const body = fixtureOf<Requests>('seerr', '/api/v1/request');
    const now = Date.now();
    body.results = (body.results ?? []).map((request, k) => {
      const created = new Date(now - (k + 1) * 7 * HOUR).toISOString();
      return { ...request, createdAt: created, updatedAt: created };
    });
    return body;
  });
}
