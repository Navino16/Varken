import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'yaml';
import { createLogger } from '../core/Logger';

const logger = createLogger('ConfigMigrator');

interface LegacyGlobalConfig {
  sonarrServerIds: number[];
  radarrServerIds: number[];
  lidarrServerIds: number[];
  tautulliServerIds: number[];
  ombiServerIds: number[];
  overseerrServerIds: number[];
  maxmindLicenseKey?: string;
}

interface ParsedIniSection {
  [key: string]: string;
}

interface ParsedIni {
  [section: string]: ParsedIniSection;
}

/**
 * ConfigMigrator handles migration from legacy INI + VRKN_* environment variables
 * to the new YAML configuration format.
 */
export class ConfigMigrator {
  private configFolder: string;

  constructor(configFolder: string) {
    this.configFolder = configFolder;
  }

  /**
   * Check if migration is needed (INI exists or VRKN_* env vars present)
   */
  needsMigration(): boolean {
    const iniPath = path.join(this.configFolder, 'varken.ini');
    const hasIniFile = fs.existsSync(iniPath);
    const hasLegacyEnvVars = this.hasLegacyEnvVars();

    return hasIniFile || hasLegacyEnvVars;
  }

  /**
   * Check for legacy VRKN_* environment variables
   */
  private hasLegacyEnvVars(): boolean {
    return Object.keys(process.env).some((key) => key.startsWith('VRKN_'));
  }

  /**
   * Perform migration from INI + env vars to YAML
   * @returns Path to the generated YAML file
   */
  migrate(): string {
    const iniPath = path.join(this.configFolder, 'varken.ini');
    let iniConfig: ParsedIni = {};

    // Parse INI file if exists
    if (fs.existsSync(iniPath)) {
      logger.debug(`Parsing legacy INI file: ${iniPath}`);
      iniConfig = this.parseIniFile(iniPath);
    }

    // Apply VRKN_* environment variable overrides
    iniConfig = this.applyLegacyEnvOverrides(iniConfig);

    // Convert to new YAML structure
    const yamlConfig = this.convertToYamlConfig(iniConfig);

    // Write YAML file
    const yamlPath = path.join(this.configFolder, 'varken.yaml');
    const yamlContent = yaml.stringify(yamlConfig, {
      indent: 2,
      lineWidth: 0,
    });

    // Add header comment
    const headerComment = `# Varken Configuration
# Migrated from legacy INI format on ${new Date().toISOString()}
# Review and adjust settings as needed

`;

    fs.writeFileSync(yamlPath, headerComment + yamlContent, 'utf-8');
    return yamlPath;
  }

  /**
   * Parse legacy INI file
   */
  private parseIniFile(filePath: string): ParsedIni {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');
    const result: ParsedIni = {};
    let currentSection = '';

    for (const line of lines) {
      const trimmed = line.trim();

      // Skip empty lines and comments
      if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith(';')) {
        continue;
      }

      // Section header
      const sectionMatch = trimmed.match(/^\[([^\]]+)\]$/);
      if (sectionMatch) {
        currentSection = sectionMatch[1].toLowerCase();
        result[currentSection] = {};
        continue;
      }

      // Key-value pair
      const kvMatch = trimmed.match(/^([^=]+)=(.*)$/);
      if (kvMatch && currentSection) {
        const key = kvMatch[1].trim();
        const value = kvMatch[2].trim();
        result[currentSection][key] = value;
      }
    }

    return result;
  }

  /**
   * Apply legacy VRKN_* environment variable overrides
   * Handles formats:
   * - VRKN_GLOBAL_KEY -> [global].key
   * - VRKN_INFLUXDB_KEY -> [influxdb].key
   * - VRKN_SONARR_1_KEY -> [sonarr-1].key
   */
  private applyLegacyEnvOverrides(config: ParsedIni): ParsedIni {
    const envVars = Object.entries(process.env).filter(([key]) => key.startsWith('VRKN_'));

    for (const [key, value] of envVars) {
      if (!value) continue;

      // Parse VRKN_SECTION_KEY or VRKN_SECTION_ID_KEY format
      const parts = key.substring(5).toLowerCase().split('_');

      if (parts.length >= 2) {
        let section: string;
        let configKey: string;

        // Check if second part is a number (server ID)
        if (parts.length >= 3 && /^\d+$/.test(parts[1])) {
          // Format: VRKN_SONARR_1_URL -> [sonarr-1].url
          section = `${parts[0]}-${parts[1]}`;
          configKey = parts.slice(2).join('_');
        } else {
          // Format: VRKN_INFLUXDB_URL -> [influxdb].url
          section = parts[0];
          configKey = parts.slice(1).join('_');
        }

        if (!configKey) continue;

        if (!config[section]) {
          config[section] = {};
        }
        config[section][configKey] = value;
        logger.debug(`Applied env override: ${key} -> [${section}].${configKey}`);
      }
    }

    return config;
  }

  /**
   * Convert parsed INI config to new YAML structure
   */
  private convertToYamlConfig(ini: ParsedIni): Record<string, unknown> {
    const config: Record<string, unknown> = {
      outputs: {},
      inputs: {},
    };

    // Parse global section
    const globalConfig = this.parseGlobalSection(ini['global'] || {});

    // Convert InfluxDB config - detect v1 vs v2 based on 'org' field
    if (ini['influxdb']) {
      const influxSection = ini['influxdb'];
      const isInfluxDB2 = !!influxSection['org'] && influxSection['org'] !== '-';

      if (isInfluxDB2) {
        const influxConfig = this.convertInfluxDB2Config(influxSection);
        (config.outputs as Record<string, unknown>)['influxdb2'] = influxConfig;
      } else {
        const influxConfig = this.convertInfluxDB1Config(influxSection);
        (config.outputs as Record<string, unknown>)['influxdb1'] = influxConfig;
      }
    }

    // Convert input plugins based on enabled IDs from global section
    const inputs = config.inputs as Record<string, unknown[]>;

    // Sonarr
    if (globalConfig.sonarrServerIds.length > 0) {
      inputs['sonarr'] = globalConfig.sonarrServerIds
        .map((id) => this.convertSonarrConfig(ini[`sonarr-${id}`], id))
        .filter(Boolean);
    }

    // Radarr
    if (globalConfig.radarrServerIds.length > 0) {
      inputs['radarr'] = globalConfig.radarrServerIds
        .map((id) => this.convertRadarrConfig(ini[`radarr-${id}`], id))
        .filter(Boolean);
    }

    // Lidarr
    if (globalConfig.lidarrServerIds.length > 0) {
      inputs['lidarr'] = globalConfig.lidarrServerIds
        .map((id) => this.convertLidarrConfig(ini[`lidarr-${id}`], id))
        .filter(Boolean);
    }

    // Tautulli
    if (globalConfig.tautulliServerIds.length > 0) {
      inputs['tautulli'] = globalConfig.tautulliServerIds
        .map((id) =>
          this.convertTautulliConfig(ini[`tautulli-${id}`], id, globalConfig.maxmindLicenseKey)
        )
        .filter(Boolean);
    }

    // Ombi
    if (globalConfig.ombiServerIds.length > 0) {
      inputs['ombi'] = globalConfig.ombiServerIds
        .map((id) => this.convertOmbiConfig(ini[`ombi-${id}`], id))
        .filter(Boolean);
    }

    // Overseerr
    if (globalConfig.overseerrServerIds.length > 0) {
      inputs['overseerr'] = globalConfig.overseerrServerIds
        .map((id) => this.convertOverseerrConfig(ini[`overseerr-${id}`], id))
        .filter(Boolean);
    }

    return config;
  }

  /**
   * Parse global section to get enabled server IDs
   */
  private parseGlobalSection(section: ParsedIniSection): LegacyGlobalConfig {
    return {
      sonarrServerIds: this.parseServerIds(section['sonarr_server_ids']),
      radarrServerIds: this.parseServerIds(section['radarr_server_ids']),
      lidarrServerIds: this.parseServerIds(section['lidarr_server_ids']),
      tautulliServerIds: this.parseServerIds(section['tautulli_server_ids']),
      ombiServerIds: this.parseServerIds(section['ombi_server_ids']),
      overseerrServerIds: this.parseServerIds(section['overseerr_server_ids']),
      maxmindLicenseKey: section['maxmind_license_key'],
    };
  }

  /**
   * Parse server IDs from comma-separated string or 'false'
   */
  private parseServerIds(value: string | undefined): number[] {
    if (!value || value.toLowerCase() === 'false') {
      return [];
    }
    return value
      .split(',')
      .map((s) => parseInt(s.trim(), 10))
      .filter((n) => !isNaN(n));
  }

  /**
   * Parse boolean from INI value
   */
  private parseBool(value: string | undefined): boolean {
    if (!value) return false;
    return value.toLowerCase() === 'true' || value === '1';
  }

  /**
   * Parse number from INI value
   */
  private parseInt(value: string | undefined, defaultValue: number): number {
    if (!value) return defaultValue;
    const parsed = parseInt(value, 10);
    return isNaN(parsed) ? defaultValue : parsed;
  }

  /**
   * Build URL from INI config (host + ssl)
   */
  private buildUrl(host: string, ssl: boolean): string {
    const protocol = ssl ? 'https' : 'http';
    // Remove protocol if already present
    const cleanHost = host.replace(/^https?:\/\//, '');
    return `${protocol}://${cleanHost}`;
  }

  /**
   * Convert InfluxDB 1.x config
   */
  private convertInfluxDB1Config(section: ParsedIniSection): Record<string, unknown> {
    return {
      url: section['url'] || 'localhost',
      port: this.parseInt(section['port'], 8086),
      username: section['username'] || 'root',
      password: section['password'] || 'root',
      database: 'varken',
      ssl: this.parseBool(section['ssl']),
      verifySsl: this.parseBool(section['verify_ssl']),
    };
  }

  /**
   * Convert InfluxDB 2.x config
   */
  private convertInfluxDB2Config(section: ParsedIniSection): Record<string, unknown> {
    // In legacy format, password is used as token for InfluxDB 2.x
    return {
      url: section['url'] || 'localhost',
      port: this.parseInt(section['port'], 8086),
      token: section['password'] || '',
      org: section['org'] || 'varken',
      bucket: 'varken',
      ssl: this.parseBool(section['ssl']),
      verifySsl: this.parseBool(section['verify_ssl']),
    };
  }

  /**
   * Convert Sonarr config
   */
  private convertSonarrConfig(
    section: ParsedIniSection | undefined,
    id: number
  ): Record<string, unknown> | null {
    if (!section) {
      logger.warn(`Sonarr server ${id} referenced in global but section not found`);
      return null;
    }

    return {
      id,
      url: this.buildUrl(section['url'], this.parseBool(section['ssl'])),
      apiKey: section['apikey'] || '',
      verifySsl: this.parseBool(section['verify_ssl']),
      queue: {
        enabled: this.parseBool(section['queue']),
        intervalSeconds: this.parseInt(section['queue_run_seconds'], 300),
      },
      calendar: {
        enabled:
          this.parseInt(section['missing_days'], 0) > 0 ||
          this.parseInt(section['future_days'], 0) > 0,
        futureDays: this.parseInt(section['future_days'], 7),
        missingDays: this.parseInt(section['missing_days'], 30),
        intervalSeconds: this.parseInt(section['missing_days_run_seconds'], 300),
      },
    };
  }

  /**
   * Convert Radarr config
   */
  private convertRadarrConfig(
    section: ParsedIniSection | undefined,
    id: number
  ): Record<string, unknown> | null {
    if (!section) {
      logger.warn(`Radarr server ${id} referenced in global but section not found`);
      return null;
    }

    return {
      id,
      url: this.buildUrl(section['url'], this.parseBool(section['ssl'])),
      apiKey: section['apikey'] || '',
      verifySsl: this.parseBool(section['verify_ssl']),
      queue: {
        enabled: this.parseBool(section['queue']),
        intervalSeconds: this.parseInt(section['queue_run_seconds'], 300),
      },
      missing: {
        enabled: this.parseBool(section['get_missing']),
        intervalSeconds: this.parseInt(section['get_missing_run_seconds'], 300),
      },
    };
  }

  /**
   * Convert Lidarr config
   */
  private convertLidarrConfig(
    section: ParsedIniSection | undefined,
    id: number
  ): Record<string, unknown> | null {
    if (!section) {
      logger.warn(`Lidarr server ${id} referenced in global but section not found`);
      return null;
    }

    return {
      id,
      url: this.buildUrl(section['url'], this.parseBool(section['ssl'])),
      apiKey: section['apikey'] || '',
      verifySsl: this.parseBool(section['verify_ssl']),
      queue: {
        enabled: this.parseBool(section['queue']),
        intervalSeconds: this.parseInt(section['queue_run_seconds'], 300),
      },
      missing: {
        enabled:
          this.parseInt(section['missing_days'], 0) > 0 ||
          this.parseInt(section['future_days'], 0) > 0,
        intervalSeconds: this.parseInt(section['missing_days_run_seconds'], 300),
      },
    };
  }

  /**
   * Convert Tautulli config
   */
  private convertTautulliConfig(
    section: ParsedIniSection | undefined,
    id: number,
    maxmindLicenseKey?: string
  ): Record<string, unknown> | null {
    if (!section) {
      logger.warn(`Tautulli server ${id} referenced in global but section not found`);
      return null;
    }

    const config: Record<string, unknown> = {
      id,
      url: this.buildUrl(section['url'], this.parseBool(section['ssl'])),
      apiKey: section['apikey'] || '',
      verifySsl: this.parseBool(section['verify_ssl']),
      activity: {
        enabled: this.parseBool(section['get_activity']),
        intervalSeconds: this.parseInt(section['get_activity_run_seconds'], 30),
      },
      libraries: {
        enabled: this.parseBool(section['get_libraries']),
        intervalDays: this.parseInt(section['get_libraries_run_days'], 1),
      },
      stats: {
        enabled: this.parseBool(section['get_stats']),
        intervalSeconds: this.parseInt(section['get_stats_run_seconds'], 3600),
      },
      geoip: {
        enabled: !!maxmindLicenseKey,
        licenseKey: maxmindLicenseKey,
      },
    };

    if (section['fallback_ip']) {
      config['fallbackIp'] = section['fallback_ip'];
    }

    return config;
  }

  /**
   * Convert Ombi config
   */
  private convertOmbiConfig(
    section: ParsedIniSection | undefined,
    id: number
  ): Record<string, unknown> | null {
    if (!section) {
      logger.warn(`Ombi server ${id} referenced in global but section not found`);
      return null;
    }

    return {
      id,
      url: this.buildUrl(section['url'], this.parseBool(section['ssl'])),
      apiKey: section['apikey'] || '',
      verifySsl: this.parseBool(section['verify_ssl']),
      requestCounts: {
        enabled:
          this.parseBool(section['get_request_type_counts']) ||
          this.parseBool(section['get_request_total_counts']),
        intervalSeconds: this.parseInt(section['request_type_run_seconds'], 300),
      },
      issueCounts: {
        enabled: this.parseBool(section['get_issue_status_counts']),
        intervalSeconds: this.parseInt(section['issue_status_run_seconds'], 300),
      },
    };
  }

  /**
   * Convert Overseerr config
   */
  private convertOverseerrConfig(
    section: ParsedIniSection | undefined,
    id: number
  ): Record<string, unknown> | null {
    if (!section) {
      logger.warn(`Overseerr server ${id} referenced in global but section not found`);
      return null;
    }

    return {
      id,
      url: this.buildUrl(section['url'], this.parseBool(section['ssl'])),
      apiKey: section['apikey'] || '',
      verifySsl: this.parseBool(section['verify_ssl']),
      requestCounts: {
        enabled: this.parseBool(section['get_request_total_counts']),
        intervalSeconds: this.parseInt(section['request_total_run_seconds'], 300),
      },
      latestRequests: {
        enabled: this.parseBool(section['get_latest_requests']),
        count: this.parseInt(section['num_latest_requests_to_fetch'], 10),
        intervalSeconds: this.parseInt(section['num_latest_requests_seconds'], 300),
      },
    };
  }
}
