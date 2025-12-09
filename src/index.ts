import { createLogger } from './core/Logger';
import { ConfigLoader } from './config';
import { Orchestrator } from './core/Orchestrator';
import { getInputPluginRegistry } from './plugins/inputs';
import { getOutputPluginRegistry } from './plugins/outputs';

const VERSION = '2.0.0';
const logger = createLogger('Main');

async function main(): Promise<void> {
  const configFolder = process.env.CONFIG_FOLDER || './config';
  const dataFolder = process.env.DATA_FOLDER || './data';

  logger.info(`Varken v${VERSION} starting...`);
  logger.info(`Config folder: ${configFolder}`);
  logger.info(`Data folder: ${dataFolder}`);

  // Load and validate configuration
  const configLoader = new ConfigLoader(configFolder);
  const config = configLoader.load();

  logger.debug('Configuration loaded');

  // dataFolder will be used for GeoIP database

  // Create and configure orchestrator
  const orchestrator = new Orchestrator(config);

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
