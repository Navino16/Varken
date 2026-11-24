/**
 * Ombi input configuration (API response types are generated in src/types/generated/ombi.ts)
 */

// Configuration
export interface OmbiConfig {
  id: number;
  url: string;
  apiKey: string;
  verifySsl?: boolean;
  requestCounts: {
    enabled: boolean;
    intervalSeconds: number;
  };
  issueCounts: {
    enabled: boolean;
    intervalSeconds: number;
  };
}
