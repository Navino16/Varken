/**
 * Sonarr input configuration (API response types are generated in src/types/generated/sonarr.ts)
 */

// Configuration
export interface SonarrConfig {
  id: number;
  url: string;
  apiKey: string;
  verifySsl?: boolean;
  queue: {
    enabled: boolean;
    intervalSeconds: number;
  };
  calendar: {
    enabled: boolean;
    futureDays: number;
    missingDays: number;
    intervalSeconds: number;
  };
  serverInfo: {
    enabled: boolean;
    intervalSeconds: number;
  };
}
