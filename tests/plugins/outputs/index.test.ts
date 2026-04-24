import { describe, it, expect } from 'vitest';
import {
  getOutputPluginRegistry,
  BaseOutputPlugin,
  InfluxDB1Plugin,
  InfluxDB2Plugin,
  VictoriaMetricsPlugin,
  QuestDBPlugin,
} from '../../../src/plugins/outputs';

describe('Output Plugins Index', () => {
  describe('getOutputPluginRegistry', () => {
    it('should return a Map of output plugins', () => {
      const registry = getOutputPluginRegistry();
      expect(registry).toBeInstanceOf(Map);
    });

    it('should contain all expected plugins', () => {
      const registry = getOutputPluginRegistry();
      expect(registry.has('influxdb1')).toBe(true);
      expect(registry.has('influxdb2')).toBe(true);
      expect(registry.has('victoriametrics')).toBe(true);
      expect(registry.has('questdb')).toBe(true);
    });

    it('should have correct number of plugins', () => {
      const registry = getOutputPluginRegistry();
      expect(registry.size).toBe(4);
    });

    it('should return plugin classes that can be instantiated', () => {
      const registry = getOutputPluginRegistry();

      for (const [name, PluginClass] of registry) {
        const instance = new PluginClass();
        expect(instance).toBeDefined();
        expect(instance.metadata).toBeDefined();
        expect(instance.metadata.name.toLowerCase()).toBe(name);
      }
    });

    it('should use metadata.name.toLowerCase() as registry key', () => {
      const registry = getOutputPluginRegistry();

      const influx1Plugin = new InfluxDB1Plugin();
      expect(registry.has(influx1Plugin.metadata.name.toLowerCase())).toBe(true);

      const influx2Plugin = new InfluxDB2Plugin();
      expect(registry.has(influx2Plugin.metadata.name.toLowerCase())).toBe(true);

      const vmPlugin = new VictoriaMetricsPlugin();
      expect(registry.has(vmPlugin.metadata.name.toLowerCase())).toBe(true);

      const questdbPlugin = new QuestDBPlugin();
      expect(registry.has(questdbPlugin.metadata.name.toLowerCase())).toBe(true);
    });
  });

  describe('exports', () => {
    it('should export BaseOutputPlugin', () => {
      expect(BaseOutputPlugin).toBeDefined();
    });

    it('should export InfluxDB1Plugin', () => {
      expect(InfluxDB1Plugin).toBeDefined();
    });

    it('should export InfluxDB2Plugin', () => {
      expect(InfluxDB2Plugin).toBeDefined();
    });

    it('should export VictoriaMetricsPlugin', () => {
      expect(VictoriaMetricsPlugin).toBeDefined();
    });

    it('should export QuestDBPlugin', () => {
      expect(QuestDBPlugin).toBeDefined();
    });
  });
});
