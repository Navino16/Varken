import { describe, it, expect } from 'vitest';
import {
  getInputPluginRegistry,
  BaseInputPlugin,
  SonarrPlugin,
  RadarrPlugin,
  TautulliPlugin,
  OverseerrPlugin,
} from '../../../src/plugins/inputs';

describe('Input Plugins Index', () => {
  describe('getInputPluginRegistry', () => {
    it('should return a Map of input plugins', () => {
      const registry = getInputPluginRegistry();
      expect(registry).toBeInstanceOf(Map);
    });

    it('should contain all expected plugins', () => {
      const registry = getInputPluginRegistry();
      expect(registry.has('sonarr')).toBe(true);
      expect(registry.has('radarr')).toBe(true);
      expect(registry.has('tautulli')).toBe(true);
      expect(registry.has('overseerr')).toBe(true);
    });

    it('should have correct number of plugins', () => {
      const registry = getInputPluginRegistry();
      expect(registry.size).toBe(4);
    });

    it('should return plugin classes that can be instantiated', () => {
      const registry = getInputPluginRegistry();

      for (const [name, PluginClass] of registry) {
        const instance = new PluginClass();
        expect(instance).toBeDefined();
        expect(instance.metadata).toBeDefined();
        expect(instance.metadata.name.toLowerCase()).toBe(name);
      }
    });

    it('should use metadata.name.toLowerCase() as registry key', () => {
      const registry = getInputPluginRegistry();

      const sonarrPlugin = new SonarrPlugin();
      expect(registry.has(sonarrPlugin.metadata.name.toLowerCase())).toBe(true);

      const radarrPlugin = new RadarrPlugin();
      expect(registry.has(radarrPlugin.metadata.name.toLowerCase())).toBe(true);
    });
  });

  describe('exports', () => {
    it('should export BaseInputPlugin', () => {
      expect(BaseInputPlugin).toBeDefined();
    });

    it('should export SonarrPlugin', () => {
      expect(SonarrPlugin).toBeDefined();
    });

    it('should export RadarrPlugin', () => {
      expect(RadarrPlugin).toBeDefined();
    });

    it('should export TautulliPlugin', () => {
      expect(TautulliPlugin).toBeDefined();
    });

    it('should export OverseerrPlugin', () => {
      expect(OverseerrPlugin).toBeDefined();
    });
  });
});
