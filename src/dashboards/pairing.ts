import type { VarkenConfig } from '../config/schemas/config.schema';
import { createLogger } from '../core/Logger';
import { PlexPlugin } from '../plugins/inputs/PlexPlugin';
import { TautulliPlugin } from '../plugins/inputs/TautulliPlugin';
import type { InputPlugin } from '../types/plugin.types';
import type { PlexPairing } from './model';

const logger = createLogger('Dashboards');

async function ask<P extends InputPlugin, T>(plugin: P, config: unknown, global: VarkenConfig['global'], read: (plugin: P) => Promise<T>): Promise<T> {
  await plugin.initialize(config, global);
  try {
    return await read(plugin);
  } finally {
    await plugin.shutdown();
  }
}

/**
 * The Tautulli instances watching each Plex instance (spec §Source priority): what they collect is read
 * from Tautulli only. When a lookup fails, every Tautulli watches every Plex instance.
 */
export async function resolvePairedPlex(config: Pick<VarkenConfig, 'inputs' | 'global'>): Promise<PlexPairing> {
  const tautullis = config.inputs.tautulli ?? [];
  const plexes = config.inputs.plex ?? [];
  if (tautullis.length === 0 || plexes.length === 0) {
    return new Map();
  }
  try {
    const watched = await Promise.all(
      tautullis.map(async (instance) => ({ id: instance.id, identifier: await ask(new TautulliPlugin(), instance, config.global, (plugin) => plugin.pmsIdentifier()) }))
    );
    const pairs = await Promise.all(
      plexes.map(async (instance): Promise<[number, number[]]> => {
        const identifier = await ask(new PlexPlugin(), instance, config.global, (plugin) => plugin.machineIdentifier());
        return [instance.id, watched.filter((tautulli) => tautulli.identifier === identifier).map((tautulli) => tautulli.id)];
      })
    );
    return new Map(pairs.filter(([, watchers]) => watchers.length > 0));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn(`Could not pair Tautulli with Plex (${message}); Tautulli takes priority over every Plex instance`);
    const all = tautullis.map((instance) => instance.id);
    return new Map(plexes.map((instance) => [instance.id, all]));
  }
}
