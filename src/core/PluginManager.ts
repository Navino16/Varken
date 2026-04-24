import { createLogger } from './Logger';
import type { Metrics } from './Metrics';
import { withTimeout } from '../utils/http';
import type {
  InputPlugin,
  OutputPlugin,
  DataPoint,
  ScheduleConfig,
} from '../types/plugin.types';
import type {
  SchedulerStatus,
  PluginStatus,
  CircuitBreakerState,
  CircuitBreakerConfig,
} from '../types/health.types';
import type { VarkenConfig } from '../config/schemas/config.schema';

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
 * Default circuit breaker configuration
 */
const DEFAULT_CIRCUIT_BREAKER_CONFIG: CircuitBreakerConfig = {
  maxConsecutiveErrors: 10,
  backoffMultiplier: 2,
  maxIntervalSeconds: 600,
  cooldownSeconds: 300,
  recoverySuccesses: 3,
};

/**
 * Active scheduler information
 */
interface ActiveScheduler {
  schedule: ScheduleConfig;
  plugin: InputPlugin;
  timer: NodeJS.Timeout | null;
  isRunning: boolean;
  lastRunAt?: Date;
  lastError?: string;
  consecutiveErrors: number;
  /** Circuit breaker state */
  circuitState: CircuitBreakerState;
  /** Current interval in milliseconds (may differ from base due to backoff) */
  currentIntervalMs: number;
  /** Base interval in milliseconds */
  baseIntervalMs: number;
  /** When the circuit was opened (disabled) */
  disabledAt?: Date;
  /** When the next recovery attempt will be made */
  nextAttemptAt?: Date;
  /** Number of successful recoveries in half-open state */
  recoverySuccesses: number;
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
  private circuitBreakerConfig: CircuitBreakerConfig = DEFAULT_CIRCUIT_BREAKER_CONFIG;
  private config?: VarkenConfig;
  private dryRun = false;
  private metrics: Metrics | null = null;

  constructor() {
    // No longer needs GeoIP handler - handled by TautulliPlugin via Tautulli API
  }

  /**
   * Enable or disable dry-run mode.
   * In dry-run mode, output plugins are not invoked; data points are logged instead.
   */
  setDryRun(enabled: boolean): void {
    this.dryRun = enabled;
  }

  /**
   * Attach a Metrics registry so plugin activity is recorded for Prometheus scraping.
   * If not set, no metrics are collected (legacy behavior).
   */
  setMetrics(metrics: Metrics | null): void {
    this.metrics = metrics;
  }

  /**
   * Execute every enabled schedule exactly once and return the collected points per schedule.
   * Intended for dry-run mode — does not start any timers or write to outputs.
   */
  async collectAllOnce(): Promise<Map<string, DataPoint[]>> {
    const results = new Map<string, DataPoint[]>();
    const collectorTimeout = this.config?.global?.collectorTimeoutMs ?? 60000;

    for (const plugins of this.inputPlugins.values()) {
      for (const plugin of plugins) {
        for (const schedule of plugin.getSchedules()) {
          if (!schedule.enabled) {
            continue;
          }

          try {
            const points = await withTimeout(
              schedule.collector(),
              collectorTimeout,
              `Collector ${schedule.name} timed out after ${collectorTimeout}ms`
            );
            results.set(schedule.name, this.validateDataPoints(points, schedule.name));
          } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            logger.error(`Schedule ${schedule.name} failed during dry-run: ${message}`);
            results.set(schedule.name, []);
          }
        }
      }
    }

    return results;
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

    // Store config for later use
    this.config = config;

    // Store circuit breaker config with defaults
    if (config.circuitBreaker) {
      this.circuitBreakerConfig = {
        ...DEFAULT_CIRCUIT_BREAKER_CONFIG,
        ...config.circuitBreaker,
      };
    }

    // Initialize output plugins first
    await this.initializeOutputPlugins(config.outputs);

    // Initialize input plugins
    await this.initializeInputPlugins(config.inputs, config.global);

    const stats = this.getStats();
    this.metrics?.setActivePlugins(stats.activeInputPlugins, stats.activeOutputPlugins);

    logger.info('All plugins initialized successfully');
  }

  /**
   * Initialize output plugins from config
   */
  private async initializeOutputPlugins(
    outputs: VarkenConfig['outputs']
  ): Promise<void> {
    for (const [type, outputConfig] of Object.entries(outputs)) {
      if (!outputConfig) {continue;}

      const factory = this.outputFactories.get(type);
      if (!factory) {
        logger.warn(`No registered factory for output type: ${type}`);
        continue;
      }

      const plugin = new factory();
      const initTimeout = this.config?.global?.httpTimeoutMs ?? 30000;
      try {
        await withTimeout(
          plugin.initialize(outputConfig),
          initTimeout,
          `Output plugin ${type} initialization timed out after ${initTimeout}ms`
        );
        this.outputPlugins.set(type, plugin);
        logger.info(`Initialized output plugin: ${type}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        logger.error(
          `Failed to initialize output plugin ${type}: ${message} — skipping (other outputs will continue)`
        );
        try {
          await plugin.shutdown();
        } catch {
          // Best-effort cleanup
        }
      }
    }

    if (this.outputPlugins.size === 0) {
      throw new Error('No output plugins were initialized');
    }

    const configuredCount = Object.values(outputs).filter((v) => v !== undefined).length;
    if (this.outputPlugins.size < configuredCount) {
      logger.warn(
        `Started with ${this.outputPlugins.size}/${configuredCount} output(s) — some failed to initialize but Varken will continue with the available ones`
      );
    }
  }

  /**
   * Initialize input plugins from config
   */
  private async initializeInputPlugins(
    inputs: VarkenConfig['inputs'],
    globalConfig: VarkenConfig['global']
  ): Promise<void> {
    for (const [type, inputConfigs] of Object.entries(inputs)) {
      if (!inputConfigs || inputConfigs.length === 0) {continue;}

      const factory = this.inputFactories.get(type);
      if (!factory) {
        logger.warn(`No registered factory for input type: ${type}`);
        continue;
      }

      const plugins: InputPlugin[] = [];

      for (const inputConfig of inputConfigs) {
        const plugin = new factory();
        try {
          await plugin.initialize(inputConfig, globalConfig);

          plugins.push(plugin);
          logger.info(`Initialized input plugin: ${type} (id: ${inputConfig.id})`);
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unknown error';
          logger.error(
            `Failed to initialize input plugin ${type} (id: ${inputConfig.id}): ${message}`
          );
          try {
            await plugin.shutdown();
          } catch {
            // Best-effort cleanup
          }
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

    for (const [, plugins] of this.inputPlugins) {
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

    const activeScheduler: ActiveScheduler = {
      schedule,
      plugin,
      timer: null,
      isRunning: false,
      consecutiveErrors: 0,
      circuitState: 'closed',
      currentIntervalMs: intervalMs,
      baseIntervalMs: intervalMs,
      recoverySuccesses: 0,
    };

    this.schedulers.set(schedule.name, activeScheduler);
    this.metrics?.setCircuitBreakerState(schedule.name, 'closed');

    // Run immediately on start
    this.executeSchedule(schedule).catch((error) => {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error(`Scheduler ${schedule.name} initial run failed: ${message}`);
      const sched = this.schedulers.get(schedule.name);
      if (sched) {
        this.handleScheduleFailure(sched, message);
      }
    });

    // Then schedule next run
    activeScheduler.timer = this.scheduleNextRun(schedule, plugin, intervalMs);

    logger.info(
      `Started scheduler: ${schedule.name} (every ${schedule.intervalSeconds}s)`
    );
  }

  /**
   * Schedule the next run using setTimeout for dynamic intervals.
   * Chains timeouts when intervalMs exceeds the 32-bit signed integer limit
   * (Node.js setTimeout max delay is 2^31 - 1 ms ≈ 24.8 days).
   */
  private scheduleNextRun(
    schedule: ScheduleConfig,
    plugin: InputPlugin,
    intervalMs: number
  ): NodeJS.Timeout {
    const MAX_TIMEOUT_MS = 2_147_483_647;

    if (intervalMs > MAX_TIMEOUT_MS) {
      return setTimeout(() => {
        const scheduler = this.schedulers.get(schedule.name);
        if (scheduler && this.isRunning) {
          scheduler.timer = this.scheduleNextRun(
            schedule,
            plugin,
            intervalMs - MAX_TIMEOUT_MS
          );
        }
      }, MAX_TIMEOUT_MS);
    }

    return setTimeout(async () => {
      try {
        await this.executeSchedule(schedule);
        const scheduler = this.schedulers.get(schedule.name);
        if (scheduler && this.isRunning) {
          scheduler.timer = this.scheduleNextRun(
            schedule,
            plugin,
            scheduler.currentIntervalMs
          );
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        logger.error(`Scheduler ${schedule.name} unexpected error: ${message}`);
      }
    }, intervalMs);
  }

  /**
   * Execute a schedule and collect data
   */
  private async executeSchedule(
    schedule: ScheduleConfig
  ): Promise<void> {
    const scheduler = this.schedulers.get(schedule.name);
    if (!scheduler) {return;}

    // Skip if already running (prevent overlap)
    if (scheduler.isRunning) {
      logger.debug(`Schedule ${schedule.name} is already running, skipping`);
      return;
    }

    // Handle circuit breaker states
    if (scheduler.circuitState === 'open') {
      const now = Date.now();
      if (scheduler.nextAttemptAt && now < scheduler.nextAttemptAt.getTime()) {
        logger.debug(
          `Schedule ${schedule.name} circuit is open, waiting until ${scheduler.nextAttemptAt.toISOString()}`
        );
        return;
      }
      // Cooldown period has passed, transition to half-open
      this.transitionToHalfOpen(scheduler);
    }

    scheduler.isRunning = true;
    const startTime = Date.now();

    try {
      logger.debug(`Executing schedule: ${schedule.name}`);

      // Collect data from the plugin with configurable timeout
      const collectorTimeout = this.config?.global?.collectorTimeoutMs ?? 60000;
      const points = await withTimeout(
        schedule.collector(),
        collectorTimeout,
        `Collector ${schedule.name} timed out after ${collectorTimeout}ms`
      );

      const validPoints = this.validateDataPoints(points, schedule.name);
      this.metrics?.recordDataPointsCollected(schedule.name, validPoints.length);

      if (validPoints.length > 0) {
        // Write to all output plugins
        await this.writeToOutputs(validPoints);
        const duration = Date.now() - startTime;
        logger.debug(
          `Schedule ${schedule.name} collected ${validPoints.length} points in ${duration}ms`
        );
      } else {
        logger.debug(`Schedule ${schedule.name} collected no data`);
      }

      // Handle success
      this.metrics?.recordCollection(schedule.name, (Date.now() - startTime) / 1000, true);
      this.handleScheduleSuccess(scheduler);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error(`Schedule ${schedule.name} failed: ${message}`);

      // Handle failure
      this.metrics?.recordCollection(schedule.name, (Date.now() - startTime) / 1000, false);
      this.handleScheduleFailure(scheduler, message);
    } finally {
      scheduler.isRunning = false;
    }
  }

  /**
   * Handle successful schedule execution
   */
  private handleScheduleSuccess(scheduler: ActiveScheduler): void {
    scheduler.lastRunAt = new Date();
    scheduler.lastError = undefined;

    if (scheduler.circuitState === 'half-open') {
      scheduler.recoverySuccesses++;
      logger.debug(
        `Schedule ${scheduler.schedule.name} recovery success ${scheduler.recoverySuccesses}/${this.circuitBreakerConfig.recoverySuccesses}`
      );

      if (scheduler.recoverySuccesses >= this.circuitBreakerConfig.recoverySuccesses) {
        // Fully recovered, close the circuit
        this.closeCircuit(scheduler);
      }
    } else {
      // Normal operation, reset everything
      scheduler.consecutiveErrors = 0;
      scheduler.currentIntervalMs = scheduler.baseIntervalMs;
    }
  }

  /**
   * Handle failed schedule execution
   */
  private handleScheduleFailure(scheduler: ActiveScheduler, errorMessage: string): void {
    scheduler.lastRunAt = new Date();
    scheduler.lastError = errorMessage;
    scheduler.consecutiveErrors++;

    if (scheduler.circuitState === 'half-open') {
      // Recovery failed, go back to open state
      logger.warn(
        `Schedule ${scheduler.schedule.name} recovery failed, reopening circuit`
      );
      this.openCircuit(scheduler);
    } else if (scheduler.circuitState === 'closed') {
      // Check if we should open the circuit
      if (scheduler.consecutiveErrors >= this.circuitBreakerConfig.maxConsecutiveErrors) {
        this.openCircuit(scheduler);
      } else {
        // Apply backoff
        this.applyBackoff(scheduler);
      }
    }
  }

  /**
   * Apply exponential backoff to scheduler interval
   */
  private applyBackoff(scheduler: ActiveScheduler): void {
    const maxIntervalMs = this.circuitBreakerConfig.maxIntervalSeconds * 1000;
    const newIntervalMs = Math.min(
      scheduler.currentIntervalMs * this.circuitBreakerConfig.backoffMultiplier,
      maxIntervalMs
    );

    if (newIntervalMs !== scheduler.currentIntervalMs) {
      scheduler.currentIntervalMs = newIntervalMs;
      logger.debug(
        `Schedule ${scheduler.schedule.name} backoff applied, interval now ${newIntervalMs / 1000}s`
      );
    }
  }

  /**
   * Open the circuit (disable scheduler temporarily)
   */
  private openCircuit(scheduler: ActiveScheduler): void {
    scheduler.circuitState = 'open';
    scheduler.disabledAt = new Date();
    scheduler.nextAttemptAt = new Date(
      Date.now() + this.circuitBreakerConfig.cooldownSeconds * 1000
    );
    scheduler.recoverySuccesses = 0;
    this.metrics?.setCircuitBreakerState(scheduler.schedule.name, 'open');

    logger.warn(
      `Schedule ${scheduler.schedule.name} circuit opened after ${scheduler.consecutiveErrors} errors, ` +
      `next attempt at ${scheduler.nextAttemptAt.toISOString()}`
    );
  }

  /**
   * Transition circuit to half-open state for recovery testing
   */
  private transitionToHalfOpen(scheduler: ActiveScheduler): void {
    scheduler.circuitState = 'half-open';
    scheduler.recoverySuccesses = 0;
    // Reset to base interval for recovery testing
    scheduler.currentIntervalMs = scheduler.baseIntervalMs;
    this.metrics?.setCircuitBreakerState(scheduler.schedule.name, 'half-open');

    logger.info(
      `Schedule ${scheduler.schedule.name} circuit transitioning to half-open for recovery testing`
    );
  }

  /**
   * Close the circuit (return to normal operation)
   */
  private closeCircuit(scheduler: ActiveScheduler): void {
    scheduler.circuitState = 'closed';
    scheduler.consecutiveErrors = 0;
    scheduler.lastError = undefined;
    scheduler.currentIntervalMs = scheduler.baseIntervalMs;
    scheduler.disabledAt = undefined;
    scheduler.nextAttemptAt = undefined;
    scheduler.recoverySuccesses = 0;
    this.metrics?.setCircuitBreakerState(scheduler.schedule.name, 'closed');

    logger.info(
      `Schedule ${scheduler.schedule.name} circuit closed, resuming normal operation`
    );
  }

  /**
   * Validate data points and filter out invalid ones
   */
  private validateDataPoints(points: DataPoint[], scheduleName: string): DataPoint[] {
    return points.filter((point) => {
      if (!point.measurement || typeof point.measurement !== 'string') {
        logger.warn(`[${scheduleName}] Filtered out data point with empty or invalid measurement`);
        return false;
      }
      if (!point.fields || Object.keys(point.fields).length === 0) {
        logger.warn(`[${scheduleName}] Filtered out data point "${point.measurement}" with no fields`);
        return false;
      }
      if (!(point.timestamp instanceof Date) || isNaN(point.timestamp.getTime())) {
        logger.warn(`[${scheduleName}] Filtered out data point "${point.measurement}" with invalid timestamp`);
        return false;
      }
      return true;
    });
  }

  /**
   * Write data points to all output plugins
   */
  private async writeToOutputs(points: DataPoint[]): Promise<void> {
    if (this.dryRun) {
      logger.info(
        `[DRY-RUN] Would write ${points.length} point(s) to ${this.outputPlugins.size} output(s): ${Array.from(this.outputPlugins.keys()).join(', ')}`
      );
      return;
    }

    let failureCount = 0;
    const writePromises = Array.from(this.outputPlugins.entries()).map(
      async ([type, plugin]) => {
        try {
          await plugin.write(points);
          this.metrics?.recordWrite(type, points.length, true);
          logger.debug(`Wrote ${points.length} points to ${type}`);
        } catch (error) {
          failureCount++;
          this.metrics?.recordWrite(type, points.length, false);
          const message = error instanceof Error ? error.message : 'Unknown error';
          logger.error(`Failed to write to output ${type}: ${message}`);
          // Don't throw - continue with other outputs
        }
      }
    );

    await Promise.allSettled(writePromises);
    if (failureCount === writePromises.length && writePromises.length > 0) {
      logger.error(`All ${failureCount} output plugins failed — data points may be lost`);
    }
  }

  /**
   * Reload the plugin manager with a new configuration.
   *
   * Performs a full restart: stops schedulers, shuts down all input/output plugins,
   * then re-initializes from the new config and restarts schedulers. Plugin factories
   * (registered types) are preserved.
   *
   * Safe to call while schedulers are running — they will be paused during the swap.
   */
  async reload(newConfig: VarkenConfig): Promise<void> {
    logger.info('Reloading plugin manager with new configuration...');

    await this.stopSchedulers();

    // Shutdown current plugins but keep factories registered
    for (const [type, plugins] of this.inputPlugins) {
      for (const plugin of plugins) {
        try {
          await plugin.shutdown();
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unknown error';
          logger.error(`Error shutting down input plugin ${type} during reload: ${message}`);
        }
      }
    }
    this.inputPlugins.clear();

    for (const [type, plugin] of this.outputPlugins) {
      try {
        await plugin.shutdown();
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        logger.error(`Error shutting down output plugin ${type} during reload: ${message}`);
      }
    }
    this.outputPlugins.clear();

    // Re-initialize with new config
    await this.initializeFromConfig(newConfig);
    await this.startSchedulers();

    logger.info('Plugin manager reload complete');
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
      if (scheduler.timer) {
        clearTimeout(scheduler.timer);
      }
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
    const healthCheckTimeout = this.config?.global?.healthCheckTimeoutMs ?? 5000;

    for (const [type, plugin] of this.outputPlugins) {
      try {
        const healthy = await withTimeout(
          plugin.healthCheck(),
          healthCheckTimeout,
          `Health check for output ${type} timed out`
        );
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

  /**
   * Get scheduler statuses for health checks
   */
  getSchedulerStatuses(): SchedulerStatus[] {
    const statuses: SchedulerStatus[] = [];

    for (const [, scheduler] of this.schedulers) {
      // Calculate next run time
      let nextRunAt: Date | undefined;
      if (scheduler.circuitState === 'open') {
        nextRunAt = scheduler.nextAttemptAt;
      } else if (scheduler.lastRunAt) {
        nextRunAt = new Date(scheduler.lastRunAt.getTime() + scheduler.currentIntervalMs);
      }

      statuses.push({
        name: scheduler.schedule.name,
        pluginName: scheduler.plugin.metadata.name,
        intervalSeconds: scheduler.schedule.intervalSeconds,
        isRunning: scheduler.isRunning,
        lastRunAt: scheduler.lastRunAt,
        lastError: scheduler.lastError,
        consecutiveErrors: scheduler.consecutiveErrors,
        circuitState: scheduler.circuitState,
        currentIntervalSeconds: scheduler.currentIntervalMs / 1000,
        disabledAt: scheduler.disabledAt,
        nextAttemptAt: scheduler.nextAttemptAt,
        recoverySuccesses: scheduler.recoverySuccesses,
        nextRunAt,
      });
    }

    return statuses;
  }

  /**
   * Get input plugin statuses with health check results
   */
  async getInputPluginStatuses(): Promise<PluginStatus[]> {
    const statuses: PluginStatus[] = [];
    const healthCheckTimeout = this.config?.global?.healthCheckTimeoutMs ?? 5000;

    for (const [type, plugins] of this.inputPlugins) {
      for (const plugin of plugins) {
        try {
          const healthy = await withTimeout(
            plugin.healthCheck(),
            healthCheckTimeout,
            `Health check for ${plugin.metadata.name} timed out`
          );
          statuses.push({
            type,
            name: plugin.metadata.name,
            version: plugin.metadata.version,
            healthy,
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unknown error';
          statuses.push({
            type,
            name: plugin.metadata.name,
            version: plugin.metadata.version,
            healthy: false,
            error: message,
          });
        }
      }
    }

    return statuses;
  }

  /**
   * Get output plugin statuses with health check results
   */
  async getOutputPluginStatuses(): Promise<PluginStatus[]> {
    const statuses: PluginStatus[] = [];
    const healthCheckTimeout = this.config?.global?.healthCheckTimeoutMs ?? 5000;

    for (const [type, plugin] of this.outputPlugins) {
      try {
        const healthy = await withTimeout(
          plugin.healthCheck(),
          healthCheckTimeout,
          `Health check for ${plugin.metadata.name} timed out`
        );
        statuses.push({
          type,
          name: plugin.metadata.name,
          version: plugin.metadata.version,
          healthy,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        statuses.push({
          type,
          name: plugin.metadata.name,
          version: plugin.metadata.version,
          healthy: false,
          error: message,
        });
      }
    }

    return statuses;
  }
}
