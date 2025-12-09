import { createLogger } from './Logger';
import {
  InputPlugin,
  OutputPlugin,
  DataPoint,
  ScheduleConfig,
} from '../types/plugin.types';
import { VarkenConfig } from '../config/schemas/config.schema';
import { GeoIPHandler } from '../utils/geoip';
import { TautulliPlugin } from '../plugins/inputs/TautulliPlugin';

const logger = createLogger('PluginManager');

/**
 * Plugin factory type for creating input plugin instances
 */
export type InputPluginFactory = new () => InputPlugin;

/**
 * Plugin factory type for creating output plugin instances
 */
export type OutputPluginFactory = new () => OutputPlugin;

/**
 * Active scheduler information
 */
interface ActiveScheduler {
  schedule: ScheduleConfig;
  plugin: InputPlugin;
  timer: NodeJS.Timeout;
  isRunning: boolean;
}

/**
 * PluginManager handles plugin registration, instantiation, and scheduling.
 * It coordinates the data flow from input plugins to output plugins.
 */
export class PluginManager {
  private inputFactories: Map<string, InputPluginFactory> = new Map();
  private outputFactories: Map<string, OutputPluginFactory> = new Map();

  private inputPlugins: Map<string, InputPlugin[]> = new Map();
  private outputPlugins: Map<string, OutputPlugin> = new Map();

  private schedulers: Map<string, ActiveScheduler> = new Map();
  private isRunning = false;
  private geoipHandler?: GeoIPHandler;

  constructor(geoipHandler?: GeoIPHandler) {
    this.geoipHandler = geoipHandler;
  }

  /**
   * Register an input plugin factory
   */
  registerInputPlugin(type: string, factory: InputPluginFactory): void {
    logger.debug(`Registering input plugin type: ${type}`);
    this.inputFactories.set(type, factory);
  }

  /**
   * Register an output plugin factory
   */
  registerOutputPlugin(type: string, factory: OutputPluginFactory): void {
    logger.debug(`Registering output plugin type: ${type}`);
    this.outputFactories.set(type, factory);
  }

  /**
   * Initialize all plugins from configuration
   */
  async initializeFromConfig(config: VarkenConfig): Promise<void> {
    logger.info('Initializing plugins from configuration...');

    // Initialize output plugins first
    await this.initializeOutputPlugins(config.outputs);

    // Initialize input plugins
    await this.initializeInputPlugins(config.inputs);

    logger.info('All plugins initialized successfully');
  }

  /**
   * Initialize output plugins from config
   */
  private async initializeOutputPlugins(
    outputs: VarkenConfig['outputs']
  ): Promise<void> {
    for (const [type, outputConfig] of Object.entries(outputs)) {
      if (!outputConfig) continue;

      const factory = this.outputFactories.get(type);
      if (!factory) {
        logger.warn(`No registered factory for output type: ${type}`);
        continue;
      }

      try {
        const plugin = new factory();
        await plugin.initialize(outputConfig);
        this.outputPlugins.set(type, plugin);
        logger.info(`Initialized output plugin: ${type}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        logger.error(`Failed to initialize output plugin ${type}: ${message}`);
        throw error;
      }
    }

    if (this.outputPlugins.size === 0) {
      throw new Error('No output plugins were initialized');
    }
  }

  /**
   * Initialize input plugins from config
   */
  private async initializeInputPlugins(
    inputs: VarkenConfig['inputs']
  ): Promise<void> {
    for (const [type, inputConfigs] of Object.entries(inputs)) {
      if (!inputConfigs || inputConfigs.length === 0) continue;

      const factory = this.inputFactories.get(type);
      if (!factory) {
        logger.warn(`No registered factory for input type: ${type}`);
        continue;
      }

      const plugins: InputPlugin[] = [];

      for (const inputConfig of inputConfigs) {
        try {
          const plugin = new factory();
          await plugin.initialize(inputConfig);

          // Inject GeoIP lookup function for Tautulli plugins
          if (type === 'tautulli' && plugin instanceof TautulliPlugin && this.geoipHandler) {
            const lookupFn = this.geoipHandler.getLookupFunction();
            if (lookupFn) {
              plugin.setGeoIPLookup(lookupFn);
              logger.debug(`Injected GeoIP lookup into Tautulli plugin (id: ${inputConfig.id})`);
            }
          }

          plugins.push(plugin);
          logger.info(`Initialized input plugin: ${type} (id: ${inputConfig.id})`);
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unknown error';
          logger.error(
            `Failed to initialize input plugin ${type} (id: ${inputConfig.id}): ${message}`
          );
          // Continue with other plugins
        }
      }

      if (plugins.length > 0) {
        this.inputPlugins.set(type, plugins);
      }
    }

    if (this.inputPlugins.size === 0) {
      throw new Error('No input plugins were initialized');
    }
  }

  /**
   * Start all schedulers for input plugins
   */
  async startSchedulers(): Promise<void> {
    if (this.isRunning) {
      logger.warn('Schedulers are already running');
      return;
    }

    logger.info('Starting schedulers...');
    this.isRunning = true;

    for (const [_type, plugins] of this.inputPlugins) {
      for (const plugin of plugins) {
        const schedules = plugin.getSchedules();

        for (const schedule of schedules) {
          if (!schedule.enabled) {
            logger.debug(`Schedule ${schedule.name} is disabled, skipping`);
            continue;
          }

          this.startScheduler(schedule, plugin);
        }
      }
    }

    logger.info(`Started ${this.schedulers.size} schedulers`);
  }

  /**
   * Start a single scheduler
   */
  private startScheduler(schedule: ScheduleConfig, plugin: InputPlugin): void {
    const intervalMs = schedule.intervalSeconds * 1000;

    // Run immediately on start
    this.executeSchedule(schedule, plugin);

    // Then run on interval
    const timer = setInterval(() => {
      this.executeSchedule(schedule, plugin);
    }, intervalMs);

    const activeScheduler: ActiveScheduler = {
      schedule,
      plugin,
      timer,
      isRunning: false,
    };

    this.schedulers.set(schedule.name, activeScheduler);
    logger.info(
      `Started scheduler: ${schedule.name} (every ${schedule.intervalSeconds}s)`
    );
  }

  /**
   * Execute a schedule and collect data
   */
  private async executeSchedule(
    schedule: ScheduleConfig,
    _plugin: InputPlugin
  ): Promise<void> {
    const scheduler = this.schedulers.get(schedule.name);

    // Skip if already running (prevent overlap)
    if (scheduler?.isRunning) {
      logger.debug(`Schedule ${schedule.name} is already running, skipping`);
      return;
    }

    if (scheduler) {
      scheduler.isRunning = true;
    }

    try {
      logger.debug(`Executing schedule: ${schedule.name}`);
      const startTime = Date.now();

      // Collect data from the plugin
      const points = await schedule.collector();

      if (points.length > 0) {
        // Write to all output plugins
        await this.writeToOutputs(points);
        const duration = Date.now() - startTime;
        logger.debug(
          `Schedule ${schedule.name} collected ${points.length} points in ${duration}ms`
        );
      } else {
        logger.debug(`Schedule ${schedule.name} collected no data`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error(`Schedule ${schedule.name} failed: ${message}`);
    } finally {
      if (scheduler) {
        scheduler.isRunning = false;
      }
    }
  }

  /**
   * Write data points to all output plugins
   */
  private async writeToOutputs(points: DataPoint[]): Promise<void> {
    const writePromises = Array.from(this.outputPlugins.entries()).map(
      async ([type, plugin]) => {
        try {
          await plugin.write(points);
          logger.debug(`Wrote ${points.length} points to ${type}`);
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unknown error';
          logger.error(`Failed to write to output ${type}: ${message}`);
          // Don't throw - continue with other outputs
        }
      }
    );

    await Promise.all(writePromises);
  }

  /**
   * Stop all schedulers
   */
  async stopSchedulers(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    logger.info('Stopping schedulers...');

    // Clear all timers
    for (const [name, scheduler] of this.schedulers) {
      clearInterval(scheduler.timer);
      logger.debug(`Stopped scheduler: ${name}`);
    }

    // Wait for any running schedules to complete
    const runningSchedulers = Array.from(this.schedulers.values()).filter(
      (s) => s.isRunning
    );

    if (runningSchedulers.length > 0) {
      logger.info(
        `Waiting for ${runningSchedulers.length} running schedules to complete...`
      );

      // Poll until all schedules are done (with timeout)
      const timeout = 30000; // 30 seconds
      const startTime = Date.now();

      while (runningSchedulers.some((s) => s.isRunning)) {
        if (Date.now() - startTime > timeout) {
          logger.warn('Timeout waiting for schedules to complete');
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }

    this.schedulers.clear();
    this.isRunning = false;
    logger.info('All schedulers stopped');
  }

  /**
   * Run health checks on all output plugins
   */
  async healthCheck(): Promise<Map<string, boolean>> {
    const results = new Map<string, boolean>();

    for (const [type, plugin] of this.outputPlugins) {
      try {
        const healthy = await plugin.healthCheck();
        results.set(type, healthy);
      } catch {
        results.set(type, false);
      }
    }

    return results;
  }

  /**
   * Shutdown all plugins
   */
  async shutdown(): Promise<void> {
    logger.info('Shutting down PluginManager...');

    // Stop schedulers first
    await this.stopSchedulers();

    // Shutdown input plugins
    for (const [type, plugins] of this.inputPlugins) {
      for (const plugin of plugins) {
        try {
          await plugin.shutdown();
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unknown error';
          logger.error(`Error shutting down input plugin ${type}: ${message}`);
        }
      }
    }

    // Shutdown output plugins
    for (const [type, plugin] of this.outputPlugins) {
      try {
        await plugin.shutdown();
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        logger.error(`Error shutting down output plugin ${type}: ${message}`);
      }
    }

    this.inputPlugins.clear();
    this.outputPlugins.clear();
    this.inputFactories.clear();
    this.outputFactories.clear();

    logger.info('PluginManager shutdown complete');
  }

  /**
   * Get statistics about registered and active plugins
   */
  getStats(): {
    registeredInputTypes: number;
    registeredOutputTypes: number;
    activeInputPlugins: number;
    activeOutputPlugins: number;
    activeSchedulers: number;
  } {
    let activeInputPlugins = 0;
    for (const plugins of this.inputPlugins.values()) {
      activeInputPlugins += plugins.length;
    }

    return {
      registeredInputTypes: this.inputFactories.size,
      registeredOutputTypes: this.outputFactories.size,
      activeInputPlugins,
      activeOutputPlugins: this.outputPlugins.size,
      activeSchedulers: this.schedulers.size,
    };
  }
}
