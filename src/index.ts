import { createLogger } from './core/Logger';
import { ConfigLoader } from './config';
import { Orchestrator } from './core/Orchestrator';
import { InputPluginFactory, OutputPluginFactory } from './core/PluginManager';

// Output plugins
import { InfluxDB1Plugin, InfluxDB2Plugin } from './plugins/outputs';

const VERSION = '2.0.0';
const logger = createLogger('Main');

// Plugin registrations
const inputPlugins = new Map<string, InputPluginFactory>();

const outputPlugins = new Map<string, OutputPluginFactory>([
  ['influxdb1', InfluxDB1Plugin],
  ['influxdb2', InfluxDB2Plugin],
]);

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

  // Register plugins
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
