import { createLogger } from './core/Logger';
import { ConfigLoader, ConfigurationMissingError } from './config';
import { Orchestrator } from './core/Orchestrator';
import { getInputPluginRegistry } from './plugins/inputs';
import { getOutputPluginRegistry } from './plugins/outputs';
import type { HealthServerConfig } from './core/HealthServer';
import { validateEnvironment } from './utils/env';
import { version as VERSION } from '../package.json';

export { VERSION };
export const DEFAULT_HEALTH_PORT = 9090;

export interface MainDependencies {
  createLogger: typeof createLogger;
  ConfigLoader: typeof ConfigLoader;
  Orchestrator: typeof Orchestrator;
  getInputPluginRegistry: typeof getInputPluginRegistry;
  getOutputPluginRegistry: typeof getOutputPluginRegistry;
  validateEnvironment: typeof validateEnvironment;
}

const defaultDependencies: MainDependencies = {
  createLogger,
  ConfigLoader,
  Orchestrator,
  getInputPluginRegistry,
  getOutputPluginRegistry,
  validateEnvironment,
};

export function isDryRun(argv: string[] = process.argv, env: NodeJS.ProcessEnv = process.env): boolean {
  return argv.includes('--dry-run') || env.DRY_RUN === 'true';
}

export async function main(deps: MainDependencies = defaultDependencies): Promise<void> {
  const logger = deps.createLogger('Main');
  const configFolder = process.env.CONFIG_FOLDER || './config';
  const dataFolder = process.env.DATA_FOLDER || './data';
  const healthPort = parseInt(process.env.HEALTH_PORT || String(DEFAULT_HEALTH_PORT), 10);
  const healthEnabled = process.env.HEALTH_ENABLED !== 'false';
  const dryRun = isDryRun();

  logger.info(`Varken v${VERSION} starting...`);

  const { errors, warnings } = deps.validateEnvironment();
  for (const warning of warnings) {
    logger.warn(warning);
  }
  if (errors.length > 0) {
    for (const error of errors) {
      logger.error(error);
    }
    throw new Error(`Environment validation failed with ${errors.length} error(s)`);
  }

  logger.info(`Config folder: ${configFolder}`);
  logger.info(`Data folder: ${dataFolder}`);
  if (dryRun) {
    logger.info('Mode: dry-run (no data will be written)');
  } else if (healthEnabled) {
    logger.info(`Health endpoint: http://0.0.0.0:${healthPort}/health`);
  }

  // Load and validate configuration
  const configLoader = new deps.ConfigLoader(configFolder);
  let config;
  try {
    config = configLoader.load();
  } catch (error) {
    if (error instanceof ConfigurationMissingError) {
      logger.info(
        `Configuration ${error.action === 'migrated' ? 'migrated' : 'template created'}. ` +
        `Please edit ${error.configPath} and restart.`
      );
      process.exit(0);
    }
    throw error;
  }

  logger.debug('Configuration loaded');

  // Create health server configuration (disabled in dry-run mode)
  const healthConfig: HealthServerConfig | undefined = healthEnabled && !dryRun
    ? { port: healthPort, version: VERSION }
    : undefined;

  // Create and configure orchestrator
  // Note: GeoIP is now handled directly by TautulliPlugin via Tautulli API
  const orchestrator = new deps.Orchestrator(config, healthConfig);

  // Register plugins automatically from registries
  const inputPlugins = deps.getInputPluginRegistry();
  const outputPlugins = deps.getOutputPluginRegistry();

  logger.info(`Discovered ${inputPlugins.size} input plugins: ${[...inputPlugins.keys()].join(', ')}`);
  logger.info(`Discovered ${outputPlugins.size} output plugins: ${[...outputPlugins.keys()].join(', ')}`);

  orchestrator.registerPlugins({
    inputPlugins,
    outputPlugins,
  });

  if (dryRun) {
    await orchestrator.dryRun();
    return;
  }

  // Start orchestrator
  await orchestrator.start();

  // Keep process running
  logger.info('Varken is running. Press Ctrl+C to stop.');
}

// Only run main() when executed directly (not when imported for testing)
/* c8 ignore start */
if (process.env.NODE_ENV !== 'test') {
  const logger = createLogger('Main');
  main().catch((error) => {
    logger.error('Fatal error:', error);
    process.exit(1);
  });
}
/* c8 ignore stop */
