import { performance } from 'node:perf_hooks';
import type { AxiosInstance } from 'axios';
import { vi } from 'vitest';
import { version } from '../../package.json';
import { GlobalConfigSchema } from '../../src/config/schemas/config.schema';
import { validDataPoints } from '../../src/core/dataPoints';
import { SelfMetrics, type SchedulerSnapshot } from '../../src/core/SelfMetrics';
import { getInputPluginRegistry } from '../../src/plugins/inputs';
import type { DataPoint, InputPlugin, OutputPlugin, ScheduleConfig } from '../../src/types/plugin.types';
import { useEventStateFolder } from '../../src/utils/EventStateStore';
import type { ServiceId } from '../contracts/lib/spec';
import { createContractHttpClient, type ContractHttpClient } from '../fixtures/contract-http';
import { demoInputs } from './config';
import { applyDemoVariants } from './variants';

const DAY_MS = 86_400_000;
/** Consecutive errors after which a demo schedule reports an open circuit (simplified PluginManager breaker). */
const DEMO_CIRCUIT_ERRORS = 3;
const HOUR_MS = 3_600_000;
/** Fewer, larger writes ride out the database fsync stalls; also under PostgreSQL's 65535 parameters (4 per point). */
const WRITE_BATCH_POINTS = 5000;

export interface SeedOptions {
  outputs: ReadonlyMap<string, OutputPlugin>;
  end?: Date;
  days?: number;
  stepSeconds?: number;
  onStep?: (step: number, steps: number) => void;
}

export interface SeedSummary {
  start: Date;
  end: Date;
  steps: number;
  points: number;
  measurements: string[];
  /** Measurements with at least one numeric or boolean field: what VictoriaMetrics keeps. */
  numericMeasurements: string[];
}

interface DemoSchedule {
  schedule: ScheduleConfig;
  lastRun?: number;
  lastSuccessAt?: Date;
  consecutiveErrors: number;
}

const serviceOf = (key: string): ServiceId => (key === 'overseerr' ? 'seerr' : (key as ServiceId));

function stepTimes(start: number, end: number, stepMs: number): number[] {
  const times: number[] = [];
  for (let t = start; t < end; t += stepMs) {
    times.push(t);
  }
  times.push(end);
  return times;
}

/** Readarr is unreachable from `end - 30 h` to `end - 26 h`, so health panels have an incident to show. */
function simulateReadarrOutage(client: ContractHttpClient, end: number): void {
  const get = client.get.getMockImplementation();
  client.get.mockImplementation(async (...args: Parameters<typeof client.get>) => {
    const now = Date.now();
    if (now >= end - 30 * HOUR_MS && now < end - 26 * HOUR_MS) {
      throw Object.assign(new Error('connect ECONNREFUSED readarr.demo:80'), { code: 'ECONNREFUSED' });
    }
    return get?.(...args);
  });
}

/** Fills `plugins` and `clients` as it goes, so the caller can shut down those started before a failure. */
async function startPlugins(end: number, plugins: InputPlugin[], clients: ContractHttpClient[]): Promise<void> {
  const registry = getInputPluginRegistry();
  const globalConfig = GlobalConfigSchema.parse({});
  for (const [key, configs] of Object.entries(demoInputs())) {
    const Plugin = registry.get(key);
    if (!Plugin || !configs) {
      continue;
    }
    for (const config of configs) {
      const plugin = new Plugin();
      const client = createContractHttpClient(serviceOf(key));
      clients.push(client);
      applyDemoVariants(serviceOf(key), client);
      if (key === 'readarr') {
        simulateReadarrOutage(client, end);
      }
      vi.spyOn(plugin as unknown as { createHttpClient(): AxiosInstance }, 'createHttpClient').mockReturnValue(client as unknown as AxiosInstance);
      plugins.push(plugin);
      await plugin.initialize(config, globalConfig);
    }
  }
}

async function runSchedule(entry: DemoSchedule, now: number, selfMetrics: SelfMetrics): Promise<DataPoint[]> {
  const started = performance.now();
  try {
    const points = validDataPoints(await entry.schedule.collector(), entry.schedule.name, () => undefined);
    selfMetrics.recordCollection(entry.schedule.name, (performance.now() - started) / 1000, points.length, true);
    entry.consecutiveErrors = 0;
    entry.lastSuccessAt = new Date(now);
    return points;
  } catch {
    selfMetrics.recordCollection(entry.schedule.name, (performance.now() - started) / 1000, 0, false);
    entry.consecutiveErrors++;
    return [];
  }
}

function snapshotOf(entry: DemoSchedule): SchedulerSnapshot {
  return {
    name: entry.schedule.name,
    tags: entry.schedule.tags,
    circuitState: entry.consecutiveErrors >= DEMO_CIRCUIT_ERRORS ? 'open' : 'closed',
    consecutiveErrors: entry.consecutiveErrors,
    intervalSeconds: entry.schedule.intervalSeconds,
    lastSuccessAt: entry.lastSuccessAt,
  };
}

async function writeAll(outputs: ReadonlyMap<string, OutputPlugin>, points: DataPoint[]): Promise<void> {
  if (points.length > 0) {
    await Promise.all([...outputs.values()].map((output) => output.write(points)));
  }
}

/**
 * Runs every input plugin on its contract fixtures over a simulated window and writes what they collect
 * to `outputs` (spec §Demo dataset). Must run inside a Vitest test: the contract client reports through it.
 */
export async function seedDemo(options: SeedOptions): Promise<SeedSummary> {
  const end = (options.end ?? new Date()).getTime();
  const days = options.days ?? 30;
  const stepMs = (options.stepSeconds ?? 600) * 1000;
  const start = end - days * DAY_MS;
  const snapshotEveryMs = Math.max(60_000, stepMs);
  const times = stepTimes(start, end, stepMs);

  const timezone = process.env.TZ;
  process.env.TZ = 'UTC';
  useEventStateFolder(null);
  vi.useFakeTimers({ toFake: ['Date'] });
  const measurements = new Set<string>();
  const numericMeasurements = new Set<string>();
  let written = 0;
  const plugins: InputPlugin[] = [];
  const clients: ContractHttpClient[] = [];
  try {
    vi.setSystemTime(start);
    await startPlugins(end, plugins, clients);
    const schedules: DemoSchedule[] = plugins.flatMap((plugin) =>
      plugin.getSchedules().filter((schedule) => schedule.enabled).map((schedule) => ({ schedule, consecutiveErrors: 0 }))
    );
    const selfMetrics = new SelfMetrics(version, new Date(start));
    let lastSnapshot = start;
    const pending: DataPoint[] = [];

    for (const [step, now] of times.entries()) {
      vi.setSystemTime(now);
      const points: DataPoint[] = [];
      for (const entry of schedules) {
        if (entry.lastRun === undefined || now - entry.lastRun >= entry.schedule.intervalSeconds * 1000) {
          entry.lastRun = now;
          const collected = await runSchedule(entry, now, selfMetrics);
          // Logical writes as PluginManager records them (one per run with points); physical writes are batched below.
          for (const name of collected.length > 0 ? options.outputs.keys() : []) {
            selfMetrics.recordWrite(name, collected.length, true);
          }
          points.push(...collected);
        }
      }
      // The spies keep every call; cleared each step or a month-long seed holds gigabytes of responses.
      for (const client of clients) {
        client.get.mockClear();
      }
      if (now - lastSnapshot >= snapshotEveryMs || now === end) {
        lastSnapshot = now;
        points.push(...selfMetrics.snapshot(schedules.map(snapshotOf), [...options.outputs.keys()], new Date(now)));
      }
      for (const point of points) {
        if (point.timestamp.getTime() > now) {
          throw new Error(`${point.measurement} ${String(point.tags.type)} point dated after the simulated time: a variant returns a future event`);
        }
        measurements.add(point.measurement);
        if (Object.values(point.fields).some((value) => typeof value !== 'string')) {
          numericMeasurements.add(point.measurement);
        }
      }
      // A failed batch rejects the whole seed: a partial demo is useless.
      pending.push(...points);
      while (pending.length >= WRITE_BATCH_POINTS || (now === end && pending.length > 0)) {
        await writeAll(options.outputs, pending.splice(0, WRITE_BATCH_POINTS));
      }
      written += points.length;
      options.onStep?.(step + 1, times.length);
    }
  } finally {
    vi.useRealTimers();
    if (timezone === undefined) {
      delete process.env.TZ;
    } else {
      process.env.TZ = timezone;
    }
    await Promise.all(plugins.map((plugin) => plugin.shutdown()));
  }

  return {
    start: new Date(start),
    end: new Date(end),
    steps: times.length,
    points: written,
    measurements: [...measurements].sort(),
    numericMeasurements: [...numericMeasurements].sort(),
  };
}
