import type { DataPoint, ScheduleTags } from '../types/plugin.types';
import type { CircuitBreakerState } from '../types/health.types';

export interface SchedulerSnapshot {
  name: string;
  tags?: ScheduleTags;
  circuitState: CircuitBreakerState;
  consecutiveErrors: number;
  intervalSeconds: number;
  lastSuccessAt?: Date;
}

interface CollectorDeltas {
  runs: number;
  errors: number;
  points: number;
}

interface OutputDeltas {
  writes: number;
  write_errors: number;
  points: number;
}

const MEASUREMENT = 'Varken';
const CIRCUIT_STATE: Record<CircuitBreakerState, number> = { closed: 0, 'half-open': 1, open: 2 };

/** Counts since the previous snapshot, so each point's fields sum cleanly over any time bucket. */
export class SelfMetrics {
  private collectors = new Map<string, CollectorDeltas>();
  private outputs = new Map<string, OutputDeltas>();
  private lastDurations = new Map<string, number>();

  constructor(
    private readonly version: string,
    private readonly startedAt: Date = new Date()
  ) {}

  recordCollection(scheduler: string, durationSeconds: number, points: number, success: boolean): void {
    const deltas = this.collectors.get(scheduler) ?? { runs: 0, errors: 0, points: 0 };
    deltas.runs++;
    deltas.points += points;
    if (!success) {
      deltas.errors++;
    }
    this.collectors.set(scheduler, deltas);
    this.lastDurations.set(scheduler, durationSeconds);
  }

  recordWrite(output: string, points: number, success: boolean): void {
    const deltas = this.outputs.get(output) ?? { writes: 0, write_errors: 0, points: 0 };
    if (success) {
      deltas.writes++;
      deltas.points += points;
    } else {
      deltas.write_errors++;
    }
    this.outputs.set(output, deltas);
  }

  snapshot(schedulers: SchedulerSnapshot[], outputs: string[], now: Date): DataPoint[] {
    const points: DataPoint[] = [
      ...schedulers.map((scheduler) => this.collectorPoint(scheduler, now)),
      ...outputs.map((output) => ({
        measurement: MEASUREMENT,
        tags: { type: 'Output', output },
        fields: { ...(this.outputs.get(output) ?? { writes: 0, write_errors: 0, points: 0 }) },
        timestamp: now,
      })),
      {
        measurement: MEASUREMENT,
        tags: { type: 'Status', version: this.version },
        fields: {
          uptime_seconds: Math.round((now.getTime() - this.startedAt.getTime()) / 1000),
          collectors: schedulers.length,
          collectors_open: schedulers.filter((s) => s.circuitState === 'open').length,
          outputs: outputs.length,
        },
        timestamp: now,
      },
    ];
    this.collectors.clear();
    this.outputs.clear();
    return points;
  }

  private collectorPoint(scheduler: SchedulerSnapshot, now: Date): DataPoint {
    const duration = this.lastDurations.get(scheduler.name);
    const fields: Record<string, number> = {
      ...(this.collectors.get(scheduler.name) ?? { runs: 0, errors: 0, points: 0 }),
      ...(duration === undefined ? {} : { duration_seconds: duration }),
      circuit_state: CIRCUIT_STATE[scheduler.circuitState],
      consecutive_errors: scheduler.consecutiveErrors,
      interval_seconds: scheduler.intervalSeconds,
    };
    if (scheduler.lastSuccessAt) {
      fields.last_success_age_seconds = Math.round((now.getTime() - scheduler.lastSuccessAt.getTime()) / 1000);
    }
    const { plugin, server, collector } = scheduler.tags ?? { plugin: 'unknown', server: 'unknown', collector: scheduler.name };
    return {
      measurement: MEASUREMENT,
      tags: { type: 'Collector', plugin, server, collector },
      fields,
      floatFields: ['duration_seconds'],
      timestamp: now,
    };
  }
}
