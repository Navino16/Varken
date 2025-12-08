import { createLogger } from './core/Logger';
import { ConfigLoader } from './config';

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

  logger.debug('Configuration loaded:', config);

  // dataFolder will be used for GeoIP database

  // TODO: Initialize plugin manager
  // TODO: Start orchestrator
}

main().catch((error) => {
  logger.error('Fatal error:', error);
  process.exit(1);
});
