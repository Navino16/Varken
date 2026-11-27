import type { VarkenConfig } from '../config/schemas/config.schema';
import { createLogger } from '../core/Logger';
import { PlexPlugin } from '../plugins/inputs/PlexPlugin';
import { TautulliPlugin } from '../plugins/inputs/TautulliPlugin';
import type { InputPlugin } from '../types/plugin.types';

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
 * Ids of the Plex instances a configured Tautulli watches (spec §Source priority): their streams are
 * read from Tautulli only. When a lookup fails, every Plex instance counts as watched.
 */
export async function resolvePairedPlex(config: Pick<VarkenConfig, 'inputs' | 'global'>): Promise<ReadonlySet<number>> {
  const tautullis = config.inputs.tautulli ?? [];
  const plexes = config.inputs.plex ?? [];
  if (tautullis.length === 0 || plexes.length === 0) {
    return new Set();
  }
  try {
    const watched = new Set(
      await Promise.all(tautullis.map((instance) => ask(new TautulliPlugin(), instance, config.global, (plugin) => plugin.pmsIdentifier())))
    );
    const identifiers = await Promise.all(
      plexes.map(async (instance) => ({ id: instance.id, identifier: await ask(new PlexPlugin(), instance, config.global, (plugin) => plugin.machineIdentifier()) }))
    );
    return new Set(identifiers.filter(({ identifier }) => watched.has(identifier)).map(({ id }) => id));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn(`Could not pair Tautulli with Plex (${message}); Tautulli takes priority over every Plex instance`);
    return new Set(plexes.map((instance) => instance.id));
  }
}
