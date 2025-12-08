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
  timestamp: Date;
}

export interface ScheduleConfig {
  name: string;
  intervalSeconds: number;
  enabled: boolean;
  collector: () => Promise<DataPoint[]>;
}

export interface InputPlugin {
  readonly metadata: PluginMetadata;
  initialize(config: unknown): Promise<void>;
  collect(): Promise<DataPoint[]>;
  getSchedules(): ScheduleConfig[];
  shutdown(): Promise<void>;
}

export interface OutputPlugin {
  readonly metadata: PluginMetadata;
  initialize(config: unknown): Promise<void>;
  write(points: DataPoint[]): Promise<void>;
  healthCheck(): Promise<boolean>;
  shutdown(): Promise<void>;
}
