import { describe, it, expect } from 'vitest';
import { SelfMetrics } from '../../src/core/SelfMetrics';
import type { SchedulerSnapshot } from '../../src/core/SelfMetrics';

const now = new Date('2026-11-26T12:00:00Z');
const startedAt = new Date('2026-11-26T11:00:00Z');

const queue: SchedulerSnapshot = {
  name: 'Sonarr_1_queue',
  tags: { plugin: 'Sonarr', server: 1, collector: 'queue' },
  circuitState: 'half-open',
  consecutiveErrors: 1,
  intervalSeconds: 60,
  lastSuccessAt: new Date('2026-11-26T11:59:00Z'),
};
const calendar: SchedulerSnapshot = {
  name: 'Sonarr_1_calendar',
  tags: { plugin: 'Sonarr', server: 1, collector: 'calendar' },
  circuitState: 'closed',
  consecutiveErrors: 0,
  intervalSeconds: 30,
};

const ofType = (points: ReturnType<SelfMetrics['snapshot']>, type: string) => points.filter((p) => p.tags.type === type);

describe('SelfMetrics', () => {
  it('emits one Collector point per scheduler with deltas and state', () => {
    const metrics = new SelfMetrics('2.5.0', startedAt);
    metrics.recordCollection('Sonarr_1_queue', 0.25, 12, true);
    metrics.recordCollection('Sonarr_1_queue', 0.5, 0, false);

    const [point] = ofType(metrics.snapshot([queue], [], now), 'Collector');

    expect(point).toEqual({
      measurement: 'Varken',
      tags: { type: 'Collector', plugin: 'Sonarr', server: 1, collector: 'queue' },
      fields: {
        runs: 2,
        errors: 1,
        points: 12,
        duration_seconds: 0.5,
        circuit_state: 1,
        consecutive_errors: 1,
        interval_seconds: 60,
        last_success_age_seconds: 60,
      },
      floatFields: ['duration_seconds', 'interval_seconds'],
      timestamp: now,
    });
  });

  it('omits duration and success age for a collector that never ran', () => {
    const [point] = ofType(new SelfMetrics('2.5.0', startedAt).snapshot([calendar], [], now), 'Collector');

    expect(point.fields).toEqual({ runs: 0, errors: 0, points: 0, circuit_state: 0, consecutive_errors: 0, interval_seconds: 30 });
  });

  it('falls back to the schedule name without tags', () => {
    const { tags: _tags, ...untagged } = calendar;
    const [point] = ofType(new SelfMetrics('2.5.0', startedAt).snapshot([{ ...untagged, name: 'Custom_job' }], [], now), 'Collector');

    expect(point.tags).toEqual({ type: 'Collector', plugin: 'unknown', collector: 'Custom_job' });
  });

  it('emits one Output point per output with write deltas', () => {
    const metrics = new SelfMetrics('2.5.0', startedAt);
    metrics.recordWrite('influxdb2', 10, true);
    metrics.recordWrite('influxdb2', 5, false);

    const outputs = ofType(metrics.snapshot([], ['influxdb2', 'questdb'], now), 'Output');

    expect(outputs.map((p) => [p.tags, p.fields])).toEqual([
      [{ type: 'Output', output: 'influxdb2' }, { writes: 1, write_errors: 1, points: 10 }],
      [{ type: 'Output', output: 'questdb' }, { writes: 0, write_errors: 0, points: 0 }],
    ]);
  });

  it('emits a Status point', () => {
    const open: SchedulerSnapshot = { ...queue, circuitState: 'open' };
    const [status] = ofType(new SelfMetrics('2.5.0', startedAt).snapshot([open, calendar], ['influxdb2'], now), 'Status');

    expect([status.tags, status.fields]).toEqual([
      { type: 'Status', version: '2.5.0' },
      { uptime_seconds: 3600, collectors: 2, collectors_open: 1, outputs: 1 },
    ]);
  });

  it('resets deltas after each snapshot', () => {
    const metrics = new SelfMetrics('2.5.0', startedAt);
    metrics.recordCollection('Sonarr_1_queue', 0.25, 12, true);
    metrics.recordWrite('influxdb2', 12, true);
    metrics.snapshot([queue], ['influxdb2'], now);

    const second = metrics.snapshot([queue], ['influxdb2'], now);

    expect(ofType(second, 'Collector')[0].fields).toMatchObject({ runs: 0, errors: 0, points: 0, duration_seconds: 0.25, circuit_state: 1 });
    expect(ofType(second, 'Output')[0].fields).toEqual({ writes: 0, write_errors: 0, points: 0 });
  });
});
