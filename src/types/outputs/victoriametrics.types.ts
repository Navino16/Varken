/**
 * VictoriaMetrics output configuration types
 */

export interface VictoriaMetricsConfig {
  url: string;
  port: number;
  ssl: boolean;
  verifySsl: boolean;
}
