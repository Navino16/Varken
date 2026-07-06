import { describe, it, expect } from 'vitest';
import { InfluxDB } from '@influxdata/influxdb-client';
import { InfluxDB2Plugin } from '../../src/plugins/outputs/InfluxDB2Plugin';
import type { DataPoint } from '../../src/types/plugin.types';
import { getInfluxDB2Endpoint, isServiceReachable } from './setup';

const endpoint = getInfluxDB2Endpoint();
const available = await isServiceReachable(endpoint.url, endpoint.port);

if (!available) {
  // eslint-disable-next-line no-console
  console.warn(
    `[integration] InfluxDB 2.x not reachable at ${endpoint.url}:${endpoint.port} — ` +
      'run `docker compose -f docker-compose.test.yaml --profile influxdb2 up -d` to enable.'
  );
}

/**
 * End-to-end test: Varken writes a point via InfluxDB2Plugin, then we query it
 * back via the InfluxDB client to verify the full wire format + authentication
 * + bucket routing works.
 *
 * The whole describe is skipped when InfluxDB 2.x isn't reachable, so
 * `npm run test:integration` is safe to run without docker-compose up.
 */
describe.skipIf(!available)('InfluxDB2Plugin — round-trip', () => {
  it('writes a point that can be read back via Flux', async () => {
    const plugin = new InfluxDB2Plugin();
    await plugin.initialize({
      url: endpoint.url,
      port: endpoint.port,
      token: endpoint.token,
      org: endpoint.org,
      bucket: endpoint.bucket,
      ssl: false,
      verifySsl: false,
    });

    const marker = `integration-${Date.now()}`;
    const now = new Date();
    const point: DataPoint = {
      measurement: 'varken_integration_test',
      tags: { marker, suite: 'round-trip' },
      fields: { value: 42 },
      timestamp: now,
    };

    await plugin.write([point]);
    await plugin.shutdown();

    // Query back
    const client = new InfluxDB({ url: `http://${endpoint.url}:${endpoint.port}`, token: endpoint.token });
    const queryApi = client.getQueryApi(endpoint.org);
    const flux = `
      from(bucket: "${endpoint.bucket}")
        |> range(start: -5m)
        |> filter(fn: (r) => r._measurement == "varken_integration_test")
        |> filter(fn: (r) => r.marker == "${marker}")
        |> last()
    `;

    const rows: Record<string, unknown>[] = [];
    await new Promise<void>((resolve, reject) => {
      queryApi.queryRows(flux, {
        next: (_row, tableMeta) => {
          rows.push(tableMeta.toObject(_row));
        },
        error: reject,
        complete: () => resolve(),
      });
    });

    expect(rows.length).toBeGreaterThan(0);
    const row = rows[0];
    expect(row._value).toBe(42);
    expect(row.suite).toBe('round-trip');
  });
});
