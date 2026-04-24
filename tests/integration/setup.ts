import net from 'node:net';

/**
 * Probe a TCP port to see if a service is reachable.
 * Used to gate integration tests so they skip cleanly when dependencies aren't up.
 */
export async function isServiceReachable(host: string, port: number, timeoutMs = 1000): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;
    const finish = (ok: boolean): void => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
    socket.connect(port, host);
  });
}

export interface InfluxDB2Endpoint {
  url: string;
  port: number;
  token: string;
  org: string;
  bucket: string;
}

/**
 * Default endpoint for the `influxdb2` service in `docker-compose.test.yaml`.
 * Override with INFLUX_TEST_URL / INFLUX_TEST_TOKEN etc. if running against
 * a different instance.
 */
export function getInfluxDB2Endpoint(): InfluxDB2Endpoint {
  return {
    url: process.env.INFLUX_TEST_URL ?? 'localhost',
    port: Number(process.env.INFLUX_TEST_PORT ?? 8087),
    token: process.env.INFLUX_TEST_TOKEN ?? 'varken-test-token',
    org: process.env.INFLUX_TEST_ORG ?? 'varken',
    bucket: process.env.INFLUX_TEST_BUCKET ?? 'varken',
  };
}
