import { createLogger, setLogLevel } from './core/Logger';

const VERSION = '2.0.0';
const logger = createLogger('Main');

async function main(): Promise<void> {
  const debug = process.env.DEBUG === 'true';
  const dataFolder = process.env.DATA_FOLDER || './config';

  if (debug) {
    setLogLevel('debug');
  }

  logger.info(`Varken v${VERSION} starting...`);
  logger.info(`Data folder: ${dataFolder}`);
  logger.debug('Debug mode enabled');

  // TODO: Initialize config loader
  // TODO: Initialize plugin manager
  // TODO: Start orchestrator
}

main().catch((error) => {
  logger.error('Fatal error:', error);
  process.exit(1);
});
