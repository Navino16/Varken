import { createLogger } from './Logger';
import type { InputPluginFactory, OutputPluginFactory } from './PluginManager';
import { PluginManager } from './PluginManager';
import { HealthServer, type HealthServerConfig } from './HealthServer';
import { Metrics } from './Metrics';
import type { VarkenConfig } from '../config/schemas/config.schema';

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
  private healthServer: HealthServer | null = null;
  private config: VarkenConfig;
  private healthConfig?: HealthServerConfig;
  private metrics: Metrics | null = null;
  private isRunning = false;
  private shutdownPromise: Promise<void> | null = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private signalHandlers: Array<{ event: string; handler: (...args: any[]) => void }> = [];

  constructor(config: VarkenConfig, healthConfig?: HealthServerConfig, metricsEnabled = true) {
    this.config = config;
    this.healthConfig = healthConfig;
    this.pluginManager = new PluginManager();
    if (metricsEnabled) {
      this.metrics = new Metrics();
      this.pluginManager.setMetrics(this.metrics);
    }
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

      // Start health server if configured
      if (this.healthConfig) {
        this.healthServer = new HealthServer(this.healthConfig);
        this.healthServer.setPluginManager(this.pluginManager);
        this.healthServer.setMetrics(this.metrics);
        await this.healthServer.start();
      }

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
   * Run all enabled schedules once without writing to outputs.
   * Used to validate config, test connectivity, and preview what would be collected.
   */
  async dryRun(): Promise<void> {
    logger.info('Starting Varken in dry-run mode — no data will be written to outputs');

    this.pluginManager.setDryRun(true);

    try {
      await this.pluginManager.initializeFromConfig(this.config);

      logger.info('Checking output connectivity...');
      const healthResults = await this.pluginManager.healthCheck();
      for (const [type, healthy] of healthResults) {
        if (healthy) {
          logger.info(`Output ${type}: healthy`);
        } else {
          logger.warn(`Output ${type}: unhealthy (would fail in production)`);
        }
      }

      logger.info('Running each enabled schedule once...');
      const collected = await this.pluginManager.collectAllOnce();

      let totalPoints = 0;
      for (const [scheduleName, points] of collected) {
        totalPoints += points.length;
        logger.info(`[DRY-RUN] ${scheduleName}: ${points.length} point(s) collected`);
      }

      const outputNames = Array.from(
        (await this.pluginManager.getOutputPluginStatuses()).map((s) => s.type)
      );
      logger.info(
        `[DRY-RUN] Summary: ${totalPoints} point(s) across ${collected.size} schedule(s) would be written to ${outputNames.length} output(s): ${outputNames.join(', ') || 'none'}`
      );
      logger.info('Dry-run complete — configuration is valid');
    } finally {
      await this.pluginManager.shutdown();
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

    // If not running, create resolved promise to prevent race conditions
    if (!this.isRunning) {
      this.shutdownPromise = Promise.resolve();
      return this.shutdownPromise;
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
    this.removeSignalHandlers();

    try {
      // Stop health server first
      if (this.healthServer) {
        await this.healthServer.stop();
        this.healthServer = null;
      }

      await this.pluginManager.shutdown();

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
      const handler = async (): Promise<void> => {
        logger.info(`Received ${signal}, initiating graceful shutdown...`);

        try {
          await this.stop();
          process.exit(0);
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unknown error';
          logger.error(`Shutdown failed: ${message}`);
          process.exit(1);
        }
      };
      this.signalHandlers.push({ event: signal, handler });
      process.on(signal, handler);
    }

    // Handle uncaught exceptions
    const uncaughtHandler = async (error: Error): Promise<void> => {
      logger.error(`Uncaught exception: ${error.message}`);
      logger.error(error.stack || '');

      try {
        await this.stop();
      } catch (shutdownError) {
        logger.error(`Shutdown error: ${shutdownError instanceof Error ? shutdownError.message : String(shutdownError)}`);
      }

      process.exit(1);
    };
    this.signalHandlers.push({ event: 'uncaughtException', handler: uncaughtHandler });
    process.on('uncaughtException', uncaughtHandler);

    // Handle unhandled promise rejections
    const rejectionHandler = async (reason: unknown): Promise<void> => {
      const message = reason instanceof Error ? reason.message : String(reason);
      logger.error(`Unhandled rejection: ${message}`);

      try {
        await this.stop();
      } catch (shutdownError) {
        logger.error(`Shutdown error: ${shutdownError instanceof Error ? shutdownError.message : String(shutdownError)}`);
      }

      process.exit(1);
    };
    this.signalHandlers.push({ event: 'unhandledRejection', handler: rejectionHandler });
    process.on('unhandledRejection', rejectionHandler);
  }

  /**
   * Remove all registered signal handlers
   */
  private removeSignalHandlers(): void {
    for (const { event, handler } of this.signalHandlers) {
      process.removeListener(event, handler);
    }
    this.signalHandlers = [];
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
