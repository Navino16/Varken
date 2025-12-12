/**
 * TimescaleDB output configuration types
 */

export interface TimescaleDBConfig {
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
  ssl: boolean;
}
