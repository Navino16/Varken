import fs from 'node:fs';
import path from 'node:path';
import { createLogger } from './Logger';

const logger = createLogger('ConfigWatcher');

export interface ConfigWatcherOptions {
  configFolder: string;
  fileName?: string;
  debounceMs?: number;
  onChange: () => Promise<void>;
}

/**
 * Watches the Varken YAML config file for changes and invokes a reload callback.
 *
 * Behaviors:
 * - Debounces rapid change events (editors often emit 2-3 writes for a single save).
 * - Suppresses overlapping reloads: if a reload is in progress and another change
 *   arrives, it is coalesced into a single follow-up reload after the current one
 *   completes.
 * - Never throws on its own; errors raised by the callback are caught and logged.
 */
export class ConfigWatcher {
  private readonly filePath: string;
  private readonly debounceMs: number;
  private readonly onChange: () => Promise<void>;
  private watcher: fs.FSWatcher | null = null;
  private debounceTimer: NodeJS.Timeout | null = null;
  private reloading = false;
  private pendingReload = false;

  constructor(options: ConfigWatcherOptions) {
    this.filePath = path.resolve(options.configFolder, options.fileName ?? 'varken.yaml');
    this.debounceMs = options.debounceMs ?? 500;
    this.onChange = options.onChange;
  }

  start(): void {
    if (this.watcher) {
      logger.warn('ConfigWatcher is already running');
      return;
    }

    if (!fs.existsSync(this.filePath)) {
      logger.warn(`Cannot watch ${this.filePath}: file does not exist`);
      return;
    }

    this.watcher = fs.watch(this.filePath, (eventType) => {
      if (eventType !== 'change' && eventType !== 'rename') {
        return;
      }
      this.scheduleReload();
    });

    this.watcher.on('error', (error) => {
      logger.error(`ConfigWatcher error: ${error.message}`);
    });

    logger.info(`Watching ${this.filePath} for config changes (debounce: ${this.debounceMs}ms)`);
  }

  stop(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
      logger.info('ConfigWatcher stopped');
    }
  }

  private scheduleReload(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      void this.triggerReload();
    }, this.debounceMs);
  }

  private async triggerReload(): Promise<void> {
    if (this.reloading) {
      // Coalesce: remember that another reload was requested mid-flight
      this.pendingReload = true;
      return;
    }

    this.reloading = true;
    try {
      await this.onChange();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(`Config reload failed: ${message}`);
    } finally {
      this.reloading = false;
    }

    if (this.pendingReload) {
      this.pendingReload = false;
      // Re-run once to pick up the coalesced change
      await this.triggerReload();
    }
  }
}
