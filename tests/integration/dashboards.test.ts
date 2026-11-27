import axios from 'axios';
import { describe, it, expect, vi } from 'vitest';
import { GlobalConfigSchema, type InputsConfig } from '../../src/config/schemas/config.schema';
import { generateDashboard } from '../../src/dashboards';
import type { GrafanaTarget } from '../../src/dashboards/translators';
import { demoInputs } from '../demo/config';
import { seedDemo } from '../demo/seed';
import { ensureDatasource, runTarget } from './grafana';
import { createOutputs, isServiceReachable, reachableOutputs, testOutputConfigs, type OutputType } from './setup';

vi.mock('../../src/core/Logger', async () => {
  const { loggerMock } = await import('../fixtures/logger');
  return loggerMock();
});

const CIRCUITS_CLOSED = 'every circuit breaker is closed again at the end of the demo (the Readarr outage ends 26 h before)';

/** Targets the demo data cannot feed, per output, as `<panel title>/<measurement>`. */
const EMPTY_ON_DEMO: Record<OutputType, Record<string, string>> = {
  influxdb1: { 'Health alerts/Varken': CIRCUITS_CLOSED },
  influxdb2: { 'Health alerts/Varken': CIRCUITS_CLOSED },
  victoriametrics: { 'Health alerts/Varken': CIRCUITS_CLOSED },
  questdb: { 'Health alerts/Varken': CIRCUITS_CLOSED },
  timescaledb: { 'Health alerts/Varken': CIRCUITS_CLOSED },
};

const SEEDED_STEP_SECONDS = 3600;

/** Names produced by the transformations themselves, not by the queries. */
const PRODUCED = /^(Field|Total|Last \*|Healthy)$|\(sum\)$|\\/;

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

/** A second instance (id 2) of every service, never seeded: its queries match nothing. */
function withIdleInstances(inputs: InputsConfig): InputsConfig {
  const record = inputs as Record<string, { id: number }[] | undefined>;
  for (const instances of Object.values(record)) {
    if (instances?.[0]) {
      instances.push({ ...structuredClone(instances[0]), id: 2 });
    }
  }
  return inputs;
}

/** Measurement a target reads, whatever its dialect. */
function measurement(target: GrafanaTarget): string | undefined {
  const text = String(target.query ?? target.expr ?? target.rawSql);
  const patterns = [/FROM "([^"]+)"/, /r\._measurement == "([^"]+)"/, /measurement = '([^']+)'/, /([A-Z]\w*?)_\w+\{/];
  return patterns.map((pattern) => pattern.exec(text)?.[1]).find((name) => name !== undefined);
}

/** QuestDB applies its write-ahead log asynchronously: wait until the last seeded table stops growing. */
async function questDbSettled(): Promise<void> {
  const { url, port } = testOutputConfigs().questdb;
  const count = async (): Promise<number> => {
    const response = await axios.get<{ dataset: number[][] }>(`http://${url}:${port}/exec`, { params: { query: 'SELECT count() FROM "Varken"' } });
    return response.data.dataset[0][0];
  };
  let previous = -1;
  for (let attempt = 0; attempt < 30; attempt++) {
    const current = await count();
    if (current === previous) {
      return;
    }
    previous = current;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

const outputs = (await isServiceReachable('localhost', 3000)) ? await reachableOutputs() : [];

describe.skipIf(outputs.length === 0)('Overview through Grafana', () => {
  it('seeds the demo data into every reachable output', async () => {
    const plugins = await createOutputs(outputs);
    try {
      await seedDemo({ outputs: plugins, days: 3, stepSeconds: SEEDED_STEP_SECONDS });
    } finally {
      await Promise.all([...plugins.values()].map((output) => output.shutdown()));
    }
    if (outputs.includes('questdb')) {
      await questDbSettled();
    }
  }, 600_000);

  it.each(outputs)('returns data for every generated query on %s', async (output) => {
    const global = GlobalConfigSchema.parse({ selfMetrics: { enabled: true, intervalSeconds: SEEDED_STEP_SECONDS } });
    const config = { inputs: seededIntervals(demoInputs()), global };
    const dashboard = generateDashboard({ kind: 'overview', output, config, pairedPlex: new Map(), version: 'test', timezone: 'Europe/Paris' });
    const uid = await ensureDatasource(output);

    const errors: string[] = [];
    const empty: string[] = [];
    const missing: string[] = [];
    for (const panel of dashboard.panels) {
      const returned = new Set<string>();
      for (const target of panel.targets ?? []) {
        const name = `${panel.title}/${measurement(target)}`;
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
    expect(empty.sort()).toEqual(Object.keys(EMPTY_ON_DEMO[output]).sort());
  }, 300_000);

  it.each(outputs)('returns no error for an instance without data on %s', async (output) => {
    const global = GlobalConfigSchema.parse({ selfMetrics: { enabled: true, intervalSeconds: SEEDED_STEP_SECONDS } });
    const config = { inputs: withIdleInstances(seededIntervals(demoInputs())), global };
    const dashboard = generateDashboard({ kind: 'overview', output, config, pairedPlex: new Map(), version: 'test', timezone: 'Europe/Paris' });
    const uid = await ensureDatasource(output);

    const errors: string[] = [];
    for (const panel of dashboard.panels) {
      for (const target of panel.targets ?? []) {
        const result = await runTarget(target, uid, panel);
        if (result.error) {
          errors.push(`${panel.title}/${measurement(target)}: ${result.error}`);
        }
      }
    }

    expect(errors).toEqual([]);
  }, 300_000);
});
