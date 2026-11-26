/**
 * Plugin system types
 */

export interface PluginMetadata {
  name: string;
  version: string;
  description: string;
}

export interface DataPoint {
  measurement: string;
  tags: Record<string, string | number>;
  fields: Record<string, string | number | boolean>;
  /** Numeric fields always written as floats, so a whole value does not switch the column to integer. */
  floatFields?: readonly string[];
  timestamp: Date;
}

/** A point before the plugin adds its measurement and `server` tag (see BaseInputPlugin.createPoints). */
export interface PointSpec {
  tags: Record<string, string | number>;
  fields: Record<string, string | number>;
  timestamp?: Date;
  floatFields?: readonly string[];
}

export interface ScheduleTags {
  plugin: string;
  server: number;
  collector: string;
}

export interface ScheduleConfig {
  name: string;
  intervalSeconds: number;
  enabled: boolean;
  collector: () => Promise<DataPoint[]>;
  tags?: ScheduleTags;
}

import type { GlobalConfig } from '../config/schemas/config.schema';

export interface InputPlugin<TConfig = unknown> {
  readonly metadata: PluginMetadata;
  initialize(config: TConfig, globalConfig?: GlobalConfig): Promise<void>;
  collect(): Promise<DataPoint[]>;
  getSchedules(): ScheduleConfig[];
  healthCheck(): Promise<boolean>;
  shutdown(): Promise<void>;
}

export interface OutputPlugin<TConfig = unknown> {
  readonly metadata: PluginMetadata;
  initialize(config: TConfig): Promise<void>;
  write(points: DataPoint[]): Promise<void>;
  healthCheck(): Promise<boolean>;
  shutdown(): Promise<void>;
}
