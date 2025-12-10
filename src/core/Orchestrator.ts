import { createLogger } from './Logger';
import type { InputPluginFactory, OutputPluginFactory } from './PluginManager';
import { PluginManager } from './PluginManager';
import type { VarkenConfig } from '../config/schemas/config.schema';
import type { GeoIPHandler } from '../utils/geoip';

const logger = createLogger('Orchestrator');

/**
 * Plugin registration entry
 */
interface PluginRegistration {
  inputPlugins: Map<string, InputPluginFactory>;
  outputPlugins: Map<string, OutputPluginFactory>;
}

/**
 * Orchestrator is the main coordinator that ties everything together.
 * It manages the lifecycle of the application and handles graceful shutdown.
 */
export class Orchestrator {
  private pluginManager: PluginManager;
  private config: VarkenConfig;
  private geoipHandler?: GeoIPHandler;
  private isRunning = false;
  private shutdownPromise: Promise<void> | null = null;

  constructor(config: VarkenConfig, geoipHandler?: GeoIPHandler) {
    this.config = config;
    this.geoipHandler = geoipHandler;
    this.pluginManager = new PluginManager(geoipHandler);
  }

  /**
   * Register plugins before starting
   */
  registerPlugins(registration: PluginRegistration): void {
    // Register input plugins
    for (const [type, factory] of registration.inputPlugins) {
      this.pluginManager.registerInputPlugin(type, factory);
    }

    // Register output plugins
    for (const [type, factory] of registration.outputPlugins) {
      this.pluginManager.registerOutputPlugin(type, factory);
    }
  }

  /**
   * Start the orchestrator and all plugins
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('Orchestrator is already running');
      return;
    }

    logger.info('Starting Varken orchestrator...');

    // Setup signal handlers for graceful shutdown
    this.setupSignalHandlers();

    try {
      // Initialize plugins from config
      await this.pluginManager.initializeFromConfig(this.config);

      // Run initial health check
      const healthResults = await this.pluginManager.healthCheck();
      for (const [type, healthy] of healthResults) {
        if (healthy) {
          logger.info(`Output ${type}: healthy`);
        } else {
          logger.warn(`Output ${type}: unhealthy`);
        }
      }

      // Start schedulers
      await this.pluginManager.startSchedulers();

      this.isRunning = true;
      const stats = this.pluginManager.getStats();
      logger.info(
        `Varken started successfully with ${stats.activeInputPlugins} input(s) and ${stats.activeOutputPlugins} output(s)`
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error(`Failed to start Varken: ${message}`);
      throw error;
    }
  }

  /**
   * Stop the orchestrator gracefully
   */
  async stop(): Promise<void> {
    // If already shutting down, wait for that to complete
    if (this.shutdownPromise) {
      return this.shutdownPromise;
    }

    if (!this.isRunning) {
      return;
    }

    this.shutdownPromise = this.performShutdown();
    return this.shutdownPromise;
  }

  /**
   * Perform the actual shutdown
   */
  private async performShutdown(): Promise<void> {
    logger.info('Stopping Varken orchestrator...');
    this.isRunning = false;

    try {
      await this.pluginManager.shutdown();

      // Shutdown GeoIP handler if initialized
      if (this.geoipHandler) {
        await this.geoipHandler.shutdown();
      }

      logger.info('Varken stopped successfully');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error(`Error during shutdown: ${message}`);
      throw error;
    }
  }

  /**
   * Setup signal handlers for graceful shutdown
   */
  private setupSignalHandlers(): void {
    const signals: NodeJS.Signals[] = ['SIGTERM', 'SIGINT'];

    for (const signal of signals) {
      process.on(signal, async () => {
        logger.info(`Received ${signal}, initiating graceful shutdown...`);

        try {
          await this.stop();
          process.exit(0);
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unknown error';
          logger.error(`Shutdown failed: ${message}`);
          process.exit(1);
        }
      });
    }

    // Handle uncaught exceptions
    process.on('uncaughtException', async (error) => {
      logger.error(`Uncaught exception: ${error.message}`);
      logger.error(error.stack || '');

      try {
        await this.stop();
      } catch {
        // Ignore shutdown errors
      }

      process.exit(1);
    });

    // Handle unhandled promise rejections
    process.on('unhandledRejection', async (reason) => {
      const message = reason instanceof Error ? reason.message : String(reason);
      logger.error(`Unhandled rejection: ${message}`);

      try {
        await this.stop();
      } catch {
        // Ignore shutdown errors
      }

      process.exit(1);
    });
  }

  /**
   * Check if the orchestrator is running
   */
  isActive(): boolean {
    return this.isRunning;
  }

  /**
   * Get the plugin manager for external access
   */
  getPluginManager(): PluginManager {
    return this.pluginManager;
  }
}
