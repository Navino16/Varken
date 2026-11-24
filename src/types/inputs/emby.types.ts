/**
 * Emby input configuration (API response types are generated in src/types/generated/emby.ts)
 * Note: Emby API is very similar to Jellyfin
 */

// Configuration
export interface EmbyConfig {
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
}
