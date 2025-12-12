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

export interface InputPlugin<TConfig = unknown> {
  readonly metadata: PluginMetadata;
  initialize(config: TConfig): Promise<void>;
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
