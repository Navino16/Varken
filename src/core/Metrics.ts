import { Registry, Counter, Histogram, Gauge, collectDefaultMetrics } from 'prom-client';

/**
 * Metrics registry and definitions for Prometheus scraping.
 *
 * Exposes per-scheduler collection metrics (counts, durations, errors),
 * per-output write metrics, and circuit breaker state.
 * Default Node.js process metrics (CPU, memory, event loop) are also registered.
 */
export class Metrics {
  readonly registry: Registry;

  readonly collectionsTotal: Counter<'scheduler' | 'status'>;
  readonly collectionDuration: Histogram<'scheduler'>;
  readonly dataPointsCollected: Counter<'scheduler'>;
  readonly dataPointsWritten: Counter<'output' | 'status'>;
  readonly schedulerErrors: Counter<'scheduler'>;
  readonly circuitBreakerState: Gauge<'scheduler'>;
  readonly activePlugins: Gauge<'kind'>;

  constructor() {
    this.registry = new Registry();
    this.registry.setDefaultLabels({ app: 'varken' });
    collectDefaultMetrics({ register: this.registry });

    this.collectionsTotal = new Counter({
      name: 'varken_collections_total',
      help: 'Total number of scheduled collector runs, labelled by status',
      labelNames: ['scheduler', 'status'] as const,
      registers: [this.registry],
    });

    this.collectionDuration = new Histogram({
      name: 'varken_collection_duration_seconds',
      help: 'Duration of scheduled collector runs in seconds',
      labelNames: ['scheduler'] as const,
      buckets: [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60],
      registers: [this.registry],
    });

    this.dataPointsCollected = new Counter({
      name: 'varken_data_points_collected_total',
      help: 'Total number of data points produced by collectors',
      labelNames: ['scheduler'] as const,
      registers: [this.registry],
    });

    this.dataPointsWritten = new Counter({
      name: 'varken_data_points_written_total',
      help: 'Total number of data points written to outputs, labelled by status',
      labelNames: ['output', 'status'] as const,
      registers: [this.registry],
    });

    this.schedulerErrors = new Counter({
      name: 'varken_scheduler_errors_total',
      help: 'Total number of scheduler errors',
      labelNames: ['scheduler'] as const,
      registers: [this.registry],
    });

    this.circuitBreakerState = new Gauge({
      name: 'varken_circuit_breaker_state',
      help: 'Circuit breaker state per scheduler (0=closed, 1=half-open, 2=open)',
      labelNames: ['scheduler'] as const,
      registers: [this.registry],
    });

    this.activePlugins = new Gauge({
      name: 'varken_active_plugins',
      help: 'Number of active plugins by kind (input/output)',
      labelNames: ['kind'] as const,
      registers: [this.registry],
    });
  }

  recordCollection(scheduler: string, durationSeconds: number, success: boolean): void {
    this.collectionsTotal.inc({ scheduler, status: success ? 'success' : 'failure' });
    this.collectionDuration.observe({ scheduler }, durationSeconds);
    if (!success) {
      this.schedulerErrors.inc({ scheduler });
    }
  }

  recordDataPointsCollected(scheduler: string, count: number): void {
    if (count > 0) {
      this.dataPointsCollected.inc({ scheduler }, count);
    }
  }

  recordWrite(output: string, count: number, success: boolean): void {
    if (count > 0) {
      this.dataPointsWritten.inc({ output, status: success ? 'success' : 'failure' }, count);
    }
  }

  setCircuitBreakerState(scheduler: string, state: 'closed' | 'half-open' | 'open'): void {
    const numeric = state === 'closed' ? 0 : state === 'half-open' ? 1 : 2;
    this.circuitBreakerState.set({ scheduler }, numeric);
  }

  setActivePlugins(inputs: number, outputs: number): void {
    this.activePlugins.set({ kind: 'input' }, inputs);
    this.activePlugins.set({ kind: 'output' }, outputs);
  }

  async getMetrics(): Promise<string> {
    return this.registry.metrics();
  }

  getContentType(): string {
    return this.registry.contentType;
  }

  reset(): void {
    this.registry.resetMetrics();
  }
}
