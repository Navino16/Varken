/**
 * Error thrown when configuration is missing or needs migration.
 * This allows callers to handle the missing config gracefully
 * instead of having process.exit() called deep in the code.
 */
export class ConfigurationMissingError extends Error {
  constructor(
    message: string,
    public readonly action: 'migrated' | 'template_created',
    public readonly configPath: string
  ) {
    super(message);
    this.name = 'ConfigurationMissingError';
  }
}
