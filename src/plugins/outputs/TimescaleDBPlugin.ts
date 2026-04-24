import { Pool, type PoolConfig } from 'pg';
import type { z } from 'zod';
import { createLogger } from '../../core/Logger';
import type { OutputPlugin, PluginMetadata, DataPoint } from '../../types/plugin.types';
import type { TimescaleDBConfigSchema } from '../../config/schemas/config.schema';

export type TimescaleDBConfig = z.infer<typeof TimescaleDBConfigSchema>;

/**
 * Table layout used by the plugin. Single wide table keyed by `measurement`
 * with JSONB tags/fields — this avoids schema evolution pain (new tags/fields
 * appear over time as plugins are added or updated) and keeps Grafana queries
 * possible via `tags->>'server'` / `(fields->>'queue_size')::int` etc.
 */
const TABLE_NAME = 'varken_events';

/**
 * TimescaleDB output plugin.
 *
 * Writes data points as rows in a single hypertable (`varken_events`) with
 * JSONB columns for tags and fields. On first initialization the plugin:
 *
 * 1. creates the table if it doesn't exist
 * 2. upgrades it to a hypertable (skipped with a warning if the TimescaleDB
 *    extension isn't installed — the plugin still works as plain PostgreSQL)
 * 3. adds a `(measurement, time DESC)` index for typical Grafana queries
 *
 * Writes are bulk-inserted via a single parameterized `INSERT`; the connection
 * pool is held open for the lifetime of the plugin and closed on shutdown.
 */
export class TimescaleDBPlugin implements OutputPlugin<TimescaleDBConfig> {
  readonly metadata: PluginMetadata = {
    name: 'TimescaleDB',
    version: '1.0.0',
    description: 'TimescaleDB output plugin using a hypertable with JSONB tags/fields',
  };

  protected logger = createLogger(this.constructor.name);
  private pool!: Pool;

  async initialize(config: TimescaleDBConfig): Promise<void> {
    const poolConfig: PoolConfig = {
      host: config.host,
      port: config.port,
      database: config.database,
      user: config.username,
      password: config.password,
    };
    if (config.ssl) {
      poolConfig.ssl = { rejectUnauthorized: false };
    }

    this.pool = new Pool(poolConfig);
    await this.ensureSchema();

    this.logger.info(
      `Connected to TimescaleDB at ${config.host}:${config.port}/${config.database}`
    );
  }

  async write(points: DataPoint[]): Promise<void> {
    if (points.length === 0) {
      return;
    }

    // Build a single bulk INSERT with parameterized rows to avoid SQL injection
    // and get atomic batch semantics.
    const values: unknown[] = [];
    const placeholders: string[] = [];
    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      const base = i * 4;
      placeholders.push(`($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4})`);
      values.push(
        p.timestamp,
        p.measurement,
        JSON.stringify(p.tags ?? {}),
        JSON.stringify(p.fields ?? {})
      );
    }

    const sql = `INSERT INTO ${TABLE_NAME} (time, measurement, tags, fields) VALUES ${placeholders.join(', ')}`;

    try {
      await this.pool.query(sql, values);
      this.logger.debug(`Wrote ${points.length} points to TimescaleDB`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Failed to write to TimescaleDB: ${message}`);
      throw error;
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      await this.pool.query('SELECT 1');
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.debug(`TimescaleDB health check failed: ${message}`);
      return false;
    }
  }

  async shutdown(): Promise<void> {
    this.logger.info('Shutting down TimescaleDB plugin');
    if (this.pool) {
      try {
        await this.pool.end();
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        this.logger.error(`Error closing TimescaleDB pool: ${message}`);
      }
    }
  }

  private async ensureSchema(): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query(`
        CREATE TABLE IF NOT EXISTS ${TABLE_NAME} (
          time TIMESTAMPTZ NOT NULL,
          measurement TEXT NOT NULL,
          tags JSONB NOT NULL DEFAULT '{}',
          fields JSONB NOT NULL DEFAULT '{}'
        )
      `);

      try {
        await client.query(
          `SELECT create_hypertable('${TABLE_NAME}', 'time', if_not_exists => TRUE)`
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        this.logger.warn(
          `create_hypertable failed — is the TimescaleDB extension installed? Falling back to a plain table. (${message})`
        );
      }

      await client.query(
        `CREATE INDEX IF NOT EXISTS idx_${TABLE_NAME}_measurement ON ${TABLE_NAME} (measurement, time DESC)`
      );
    } finally {
      client.release();
    }
  }
}
