/**
 * InfluxDB 2.x output configuration types
 */

export interface InfluxDB2Config {
  url: string;
  port: number;
  token: string;
  org: string;
  bucket: string;
  ssl: boolean;
  verifySsl: boolean;
}
