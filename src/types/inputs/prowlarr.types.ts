/**
 * Prowlarr input configuration (API response types are generated in src/types/generated/prowlarr.ts)
 */

// Configuration
export interface ProwlarrConfig {
  id: number;
  url: string;
  apiKey: string;
  verifySsl?: boolean;
  indexerStats: {
    enabled: boolean;
    intervalSeconds: number;
  };
  serverInfo: {
    enabled: boolean;
    intervalSeconds: number;
  };
}
