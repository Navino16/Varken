/**
 * Readarr input configuration (API response types are generated in src/types/generated/readarr.ts)
 */

// Configuration
export interface ReadarrConfig {
  id: number;
  url: string;
  apiKey: string;
  verifySsl?: boolean;
  queue: {
    enabled: boolean;
    intervalSeconds: number;
  };
  missing: {
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
  totals: {
    enabled: boolean;
    intervalSeconds: number;
  };
  history: {
    enabled: boolean;
    intervalSeconds: number;
  };
  library: {
    enabled: boolean;
    intervalDays: number;
  };
}
