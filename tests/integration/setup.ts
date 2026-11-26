import net from 'node:net';
import {
  getOutputPluginRegistry,
  type InfluxDB1Config,
  type InfluxDB2Config,
  type QuestDBConfig,
  type TimescaleDBConfig,
  type VictoriaMetricsConfig,
} from '../../src/plugins/outputs';
import type { OutputPlugin } from '../../src/types/plugin.types';

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

export type OutputType = 'influxdb1' | 'influxdb2' | 'victoriametrics' | 'questdb' | 'timescaledb';

export const OUTPUT_TYPES: readonly OutputType[] = ['influxdb1', 'influxdb2', 'victoriametrics', 'questdb', 'timescaledb'];

export interface TestOutputConfigs {
  influxdb1: InfluxDB1Config;
  influxdb2: InfluxDB2Config;
  victoriametrics: VictoriaMetricsConfig;
  questdb: QuestDBConfig;
  timescaledb: TimescaleDBConfig;
}

/** Endpoints of the databases in `docker-compose.test.yaml`. */
export function testOutputConfigs(): TestOutputConfigs {
  const influx2 = getInfluxDB2Endpoint();
  return {
    influxdb1: { url: 'localhost', port: 8086, username: 'varken', password: 'varkenpassword', database: 'varken', ssl: false, verifySsl: false },
    influxdb2: { url: influx2.url, port: influx2.port, token: influx2.token, org: influx2.org, bucket: influx2.bucket, ssl: false, verifySsl: false },
    victoriametrics: { url: 'localhost', port: 8428, ssl: false, verifySsl: false },
    questdb: { url: 'localhost', port: 9000, ssl: false, verifySsl: false },
    timescaledb: { host: 'localhost', port: 5433, database: 'varken', username: 'varken', password: 'varken', ssl: false },
  };
}

function portOf(type: OutputType): { host: string; port: number } {
  const config = testOutputConfigs()[type];
  return 'host' in config ? { host: config.host, port: config.port } : { host: config.url, port: config.port };
}

export async function reachableOutputs(): Promise<OutputType[]> {
  const probes = await Promise.all(OUTPUT_TYPES.map(async (type) => ((await isServiceReachable(portOf(type).host, portOf(type).port)) ? type : undefined)));
  return probes.filter((type): type is OutputType => type !== undefined);
}

/** Initialized output plugins; throws before any write when one of them is not healthy. */
export async function createOutputs(types: readonly OutputType[]): Promise<Map<OutputType, OutputPlugin>> {
  const registry = getOutputPluginRegistry();
  const configs = testOutputConfigs();
  const outputs = new Map<OutputType, OutputPlugin>();
  const down: OutputType[] = [];
  for (const type of types) {
    const Factory = registry.get(type);
    if (!Factory) {
      throw new Error(`Unknown output type ${type}`);
    }
    const plugin = new Factory();
    try {
      await plugin.initialize(configs[type]);
      if (await plugin.healthCheck()) {
        outputs.set(type, plugin);
        continue;
      }
    } catch {
      // Reported with the other unhealthy outputs below.
    }
    down.push(type);
    await plugin.shutdown().catch(() => undefined);
  }
  if (down.length > 0) {
    await Promise.all([...outputs.values()].map((plugin) => plugin.shutdown()));
    throw new Error(`Outputs not ready: ${down.join(', ')}. Start them with: docker compose -f docker-compose.test.yaml --profile databases up -d`);
  }
  return outputs;
}
