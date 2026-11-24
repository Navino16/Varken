/**
 * Lidarr input configuration (API response types are generated in src/types/generated/lidarr.ts)
 */

// Configuration
export interface LidarrConfig {
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
}
