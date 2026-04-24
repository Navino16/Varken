import { describe, it, expect, beforeEach } from 'vitest';
import { Metrics } from '../../src/core/Metrics';

describe('Metrics', () => {
  let metrics: Metrics;

  beforeEach(() => {
    metrics = new Metrics();
  });

  describe('registry', () => {
    it('should expose Prometheus text format on getMetrics()', async () => {
      const output = await metrics.getMetrics();
      expect(typeof output).toBe('string');
      expect(output).toContain('# HELP');
      expect(output).toContain('# TYPE');
    });

    it('should use the Prometheus content type', () => {
      expect(metrics.getContentType()).toContain('text/plain');
      expect(metrics.getContentType()).toContain('version=0.0.4');
    });

    it('should register default Node.js process metrics', async () => {
      const output = await metrics.getMetrics();
      expect(output).toContain('process_cpu_user_seconds_total');
      expect(output).toContain('nodejs_heap_size_total_bytes');
    });

    it('should label every metric with app=varken', async () => {
      metrics.recordCollection('demo', 0.1, true);
      const output = await metrics.getMetrics();
      expect(output).toMatch(/app="varken"/);
    });
  });

  describe('recordCollection', () => {
    it('should increment success counter and observe duration', async () => {
      metrics.recordCollection('sonarr_queue', 0.42, true);
      const output = await metrics.getMetrics();
      expect(output).toMatch(/varken_collections_total\{.*status="success".*\} 1/);
      expect(output).toMatch(/varken_collection_duration_seconds_sum\{[^}]*scheduler="sonarr_queue"[^}]*\}/);
    });

    it('should increment failure counter and scheduler_errors on failure', async () => {
      metrics.recordCollection('sonarr_queue', 1.2, false);
      const output = await metrics.getMetrics();
      expect(output).toMatch(/varken_collections_total\{.*status="failure".*\} 1/);
      expect(output).toMatch(/varken_scheduler_errors_total\{.*scheduler="sonarr_queue".*\} 1/);
    });
  });

  describe('recordDataPointsCollected', () => {
    it('should add to the counter when count > 0', async () => {
      metrics.recordDataPointsCollected('sonarr_queue', 5);
      const output = await metrics.getMetrics();
      expect(output).toMatch(/varken_data_points_collected_total\{.*scheduler="sonarr_queue".*\} 5/);
    });

    it('should do nothing when count is zero', async () => {
      metrics.recordDataPointsCollected('sonarr_queue', 0);
      const output = await metrics.getMetrics();
      expect(output).not.toMatch(/varken_data_points_collected_total\{[^}]*scheduler="sonarr_queue"/);
    });
  });

  describe('recordWrite', () => {
    it('should increment success counter', async () => {
      metrics.recordWrite('influxdb2', 3, true);
      const output = await metrics.getMetrics();
      expect(output).toMatch(/varken_data_points_written_total\{.*output="influxdb2".*status="success".*\} 3/);
    });

    it('should increment failure counter', async () => {
      metrics.recordWrite('influxdb2', 3, false);
      const output = await metrics.getMetrics();
      expect(output).toMatch(/varken_data_points_written_total\{.*status="failure".*\} 3/);
    });

    it('should skip when count is zero', async () => {
      metrics.recordWrite('influxdb2', 0, true);
      const output = await metrics.getMetrics();
      expect(output).not.toMatch(/varken_data_points_written_total\{[^}]*output="influxdb2"/);
    });
  });

  describe('setCircuitBreakerState', () => {
    it('should map states to numeric values (closed=0, half-open=1, open=2)', async () => {
      metrics.setCircuitBreakerState('a', 'closed');
      metrics.setCircuitBreakerState('b', 'half-open');
      metrics.setCircuitBreakerState('c', 'open');
      const output = await metrics.getMetrics();
      expect(output).toMatch(/varken_circuit_breaker_state\{[^}]*scheduler="a"[^}]*\} 0/);
      expect(output).toMatch(/varken_circuit_breaker_state\{[^}]*scheduler="b"[^}]*\} 1/);
      expect(output).toMatch(/varken_circuit_breaker_state\{[^}]*scheduler="c"[^}]*\} 2/);
    });
  });

  describe('setActivePlugins', () => {
    it('should set input and output plugin gauges', async () => {
      metrics.setActivePlugins(3, 2);
      const output = await metrics.getMetrics();
      expect(output).toMatch(/varken_active_plugins\{[^}]*kind="input"[^}]*\} 3/);
      expect(output).toMatch(/varken_active_plugins\{[^}]*kind="output"[^}]*\} 2/);
    });
  });

  describe('reset', () => {
    it('should zero out recorded counters', async () => {
      metrics.recordCollection('sonarr_queue', 0.1, true);
      metrics.reset();
      const output = await metrics.getMetrics();
      expect(output).not.toMatch(/varken_collections_total\{[^}]*scheduler="sonarr_queue"[^}]*\} 1/);
    });
  });
});
