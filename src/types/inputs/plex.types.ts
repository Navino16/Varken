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
  serverInfo: {
    enabled: boolean;
    intervalSeconds: number;
  };
  status: {
    enabled: boolean;
    intervalSeconds: number;
  };
  history: {
    enabled: boolean;
    intervalSeconds: number;
  };
  inventory: {
    enabled: boolean;
    intervalSeconds: number;
  };
  liveTv: {
    enabled: boolean;
    intervalSeconds: number;
  };
}
