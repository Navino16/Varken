/**
 * InfluxDB 1.x output configuration types
 */

export interface InfluxDB1Config {
  url: string;
  port: number;
  username: string;
  password: string;
  database: string;
  ssl: boolean;
  verifySsl: boolean;
}
