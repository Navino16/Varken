import { describe, it, expect, vi } from 'vitest';
import { GlobalConfigSchema, type InputsConfig } from '../../src/config/schemas/config.schema';
import { generateDashboard } from '../../src/dashboards';
import { demoInputs } from '../demo/config';
import { seedDemo } from '../demo/seed';
import { ensureDatasource, runTarget } from './grafana';
import { createOutputs, isServiceReachable } from './setup';

vi.mock('../../src/core/Logger', async () => {
  const { loggerMock } = await import('../fixtures/logger');
  return loggerMock();
});

/** Targets the demo data cannot feed, as `<panel title>/<source>`. */
const EMPTY_ON_DEMO: Record<string, string> = {
  'Health alerts/Varken': 'every circuit breaker is closed again at the end of the demo (the Readarr outage ends 26 h before)',
};

const SEEDED_STEP_SECONDS = 3600;

/** Names produced by the transformations themselves, not by the queries. */
const PRODUCED = /^(Field|Total|Last \*|Healthy)$|\(sum\)$/;

interface Transformation {
  id: string;
  options: {
    renameByName?: Record<string, string>;
    fields?: Record<string, unknown>;
    sort?: { field: string }[];
    byField?: string;
    binary?: { left: string; right: string };
  };
}

/** Field names a panel's transformations match: the queries must return them. */
function referencedNames(transformations: Transformation[] = []): string[] {
  const names = transformations.flatMap(({ options }) => [
    ...Object.keys(options.renameByName ?? {}),
    ...Object.keys(options.fields ?? {}),
    ...(options.sort ?? []).map((sort) => sort.field),
    ...(options.byField ? [options.byField] : []),
    ...(options.binary ? [options.binary.left, options.binary.right] : []),
  ]);
  return [...new Set(names)].filter((name) => !PRODUCED.test(name));
}

/** Every collector at the seeded step: one collection per step, as the seeder writes them. */
function seededIntervals(inputs: InputsConfig): InputsConfig {
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(visit);
    } else if (value !== null && typeof value === 'object') {
      const record = value as Record<string, unknown>;
      if (typeof record.intervalSeconds === 'number') {
        record.intervalSeconds = SEEDED_STEP_SECONDS;
      }
      Object.values(record).forEach(visit);
    }
  };
  visit(inputs);
  return inputs;
}

const reachable = (await isServiceReachable('localhost', 8086)) && (await isServiceReachable('localhost', 3000));

describe.skipIf(!reachable)('Overview on InfluxDB 1', () => {
  it('returns data for every generated query through Grafana', async () => {
    const outputs = await createOutputs(['influxdb1']);
    try {
      await seedDemo({ outputs, days: 3, stepSeconds: SEEDED_STEP_SECONDS });
    } finally {
      await Promise.all([...outputs.values()].map((output) => output.shutdown()));
    }
    const global = GlobalConfigSchema.parse({ selfMetrics: { enabled: true, intervalSeconds: SEEDED_STEP_SECONDS } });
    const dashboard = generateDashboard({ kind: 'overview', output: 'influxdb1', config: { inputs: seededIntervals(demoInputs()), global }, pairedPlex: new Map(), version: 'test' });
    const uid = await ensureDatasource('influxdb1');

    const errors: string[] = [];
    const empty: string[] = [];
    const missing: string[] = [];
    for (const panel of dashboard.panels) {
      const returned = new Set<string>();
      for (const target of panel.targets ?? []) {
        const name = `${panel.title}/${/FROM "([^"]+)"/.exec(String(target.query))?.[1]}`;
        const result = await runTarget(target, uid, panel);
        result.names.forEach((n) => returned.add(n));
        if (result.error) {
          errors.push(`${name}: ${result.error}`);
        } else if (result.rows === 0) {
          empty.push(name);
        }
      }
      const referenced = referencedNames(panel.transformations as Transformation[] | undefined);
      missing.push(...referenced.filter((n) => !returned.has(n)).map((n) => `${panel.title}: ${n}`));
    }

    expect(errors).toEqual([]);
    expect(missing).toEqual([]);
    expect(empty.sort()).toEqual(Object.keys(EMPTY_ON_DEMO).sort());
  }, 300_000);
});
