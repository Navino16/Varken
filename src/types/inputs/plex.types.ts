/**
 * Plex input configuration (API response types are generated in src/types/generated/plex.ts)
 */

// Configuration
export interface PlexConfig {
  id: number;
  url: string;
  token: string;
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
