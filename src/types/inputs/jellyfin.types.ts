/**
 * Jellyfin input configuration (API response types are generated in src/types/generated/jellyfin.ts)
 */

// Configuration
export interface JellyfinConfig {
  id: number;
  url: string;
  apiKey: string;
  verifySsl?: boolean;
  sessions: {
    enabled: boolean;
    intervalSeconds: number;
  };
  libraries: {
    enabled: boolean;
    intervalSeconds: number;
  };
  serverInfo: {
    enabled: boolean;
    intervalSeconds: number;
  };
}
