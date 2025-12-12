import type { OutputPluginFactory } from '../../core/PluginManager';

// Plugin imports
import { InfluxDB1Plugin } from './InfluxDB1Plugin';
import { InfluxDB2Plugin } from './InfluxDB2Plugin';

// Re-exports for direct usage
export { BaseOutputPlugin, BaseOutputConfig } from './BaseOutputPlugin';
export { InfluxDB1Plugin, InfluxDB1Config } from './InfluxDB1Plugin';
export { InfluxDB2Plugin, InfluxDB2Config } from './InfluxDB2Plugin';

/**
 * All available output plugin classes
 * The config key is derived from metadata.name.toLowerCase()
 */
const outputPluginClasses: OutputPluginFactory[] = [
  InfluxDB1Plugin,
  InfluxDB2Plugin,
];

/**
 * Build registry automatically from plugin metadata
 */
export function getOutputPluginRegistry(): Map<string, OutputPluginFactory> {
  const registry = new Map<string, OutputPluginFactory>();

  for (const PluginClass of outputPluginClasses) {
    const instance = new PluginClass();
    const configKey = instance.metadata.name.toLowerCase();
    registry.set(configKey, PluginClass);
  }

  return registry;
}
