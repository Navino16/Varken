/**
 * Overseerr input configuration (API response types are generated in src/types/generated/seerr.ts)
 */

// Configuration
export interface OverseerrConfig {
  id: number;
  url: string;
  apiKey: string;
  verifySsl?: boolean;
  requestCounts: {
    enabled: boolean;
    intervalSeconds: number;
  };
  latestRequests: {
    enabled: boolean;
    count: number;
    intervalSeconds: number;
  };
  serverInfo: {
    enabled: boolean;
    intervalSeconds: number;
  };
}
