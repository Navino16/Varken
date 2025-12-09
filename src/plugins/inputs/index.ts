import { InputPluginFactory } from '../../core/PluginManager';

// Plugin imports
import { SonarrPlugin } from './SonarrPlugin';
import { RadarrPlugin } from './RadarrPlugin';
import { TautulliPlugin } from './TautulliPlugin';
import { OverseerrPlugin } from './OverseerrPlugin';
import { OmbiPlugin } from './OmbiPlugin';

// Re-exports for direct usage
export { BaseInputPlugin, BaseInputConfig } from './BaseInputPlugin';
export { SonarrPlugin } from './SonarrPlugin';
export { RadarrPlugin } from './RadarrPlugin';
export { TautulliPlugin } from './TautulliPlugin';
export { OverseerrPlugin } from './OverseerrPlugin';
export { OmbiPlugin } from './OmbiPlugin';
export type { GeoIPLookupFn } from '../../types/inputs/tautulli.types';

/**
 * All available input plugin classes
 * The config key is derived from metadata.name.toLowerCase()
 */
const inputPluginClasses: InputPluginFactory[] = [
  SonarrPlugin,
  RadarrPlugin,
  TautulliPlugin,
  OverseerrPlugin,
  OmbiPlugin,
];

/**
 * Build registry automatically from plugin metadata
 */
export function getInputPluginRegistry(): Map<string, InputPluginFactory> {
  const registry = new Map<string, InputPluginFactory>();

  for (const PluginClass of inputPluginClasses) {
    const instance = new PluginClass();
    const configKey = instance.metadata.name.toLowerCase();
    registry.set(configKey, PluginClass);
  }

  return registry;
}
