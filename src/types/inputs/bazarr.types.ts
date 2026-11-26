/**
 * Bazarr input configuration (API response types are generated in src/types/generated/bazarr.ts)
 */

// Configuration
export interface BazarrConfig {
  id: number;
  url: string;
  apiKey: string;
  verifySsl?: boolean;
  wanted: {
    enabled: boolean;
    intervalSeconds: number;
  };
  history: {
    enabled: boolean;
    intervalSeconds: number;
  };
  serverInfo: {
    enabled: boolean;
    intervalSeconds: number;
  };
  status: {
    enabled: boolean;
    intervalSeconds: number;
  };
  stats: {
    enabled: boolean;
    intervalSeconds: number;
  };
  library: {
    enabled: boolean;
    intervalDays: number;
  };
}
