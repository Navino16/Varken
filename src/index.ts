import { createLogger } from './core/Logger';
import { ConfigLoader } from './config';
import { Orchestrator } from './core/Orchestrator';
import { getInputPluginRegistry } from './plugins/inputs';
import { getOutputPluginRegistry } from './plugins/outputs';
import type { HealthServerConfig } from './core/HealthServer';

const VERSION = '2.0.0';
const DEFAULT_HEALTH_PORT = 9090;
const logger = createLogger('Main');

async function main(): Promise<void> {
  const configFolder = process.env.CONFIG_FOLDER || './config';
  const dataFolder = process.env.DATA_FOLDER || './data';
  const healthPort = parseInt(process.env.HEALTH_PORT || String(DEFAULT_HEALTH_PORT), 10);
  const healthEnabled = process.env.HEALTH_ENABLED !== 'false';

  logger.info(`Varken v${VERSION} starting...`);
  logger.info(`Config folder: ${configFolder}`);
  logger.info(`Data folder: ${dataFolder}`);
  if (healthEnabled) {
    logger.info(`Health endpoint: http://0.0.0.0:${healthPort}/health`);
  }

  // Load and validate configuration
  const configLoader = new ConfigLoader(configFolder);
  const config = configLoader.load();

  logger.debug('Configuration loaded');

  // Create health server configuration
  const healthConfig: HealthServerConfig | undefined = healthEnabled
    ? { port: healthPort, version: VERSION }
    : undefined;

  // Create and configure orchestrator
  // Note: GeoIP is now handled directly by TautulliPlugin via Tautulli API
  const orchestrator = new Orchestrator(config, healthConfig);

  // Register plugins automatically from registries
  const inputPlugins = getInputPluginRegistry();
  const outputPlugins = getOutputPluginRegistry();

  logger.info(`Discovered ${inputPlugins.size} input plugins: ${[...inputPlugins.keys()].join(', ')}`);
  logger.info(`Discovered ${outputPlugins.size} output plugins: ${[...outputPlugins.keys()].join(', ')}`);

  orchestrator.registerPlugins({
    inputPlugins,
    outputPlugins,
  });

  // Start orchestrator
  await orchestrator.start();

  // Keep process running
  logger.info('Varken is running. Press Ctrl+C to stop.');
}

main().catch((error) => {
  logger.error('Fatal error:', error);
  process.exit(1);
});
