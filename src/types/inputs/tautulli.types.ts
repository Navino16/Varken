/**
 * Tautulli input configuration types (API response types are generated in src/types/generated/tautulli.ts)
 */

// Local coordinates configuration for LAN streams
export interface LocalCoordinates {
  latitude: number;
  longitude: number;
}

// Configuration
export interface TautulliConfig {
  id: number;
  url: string;
  apiKey: string;
  verifySsl?: boolean;
  /** @deprecated Use geoip.localCoordinates instead */
  fallbackIp?: string;
  activity: {
    enabled: boolean;
    intervalSeconds: number;
  };
  libraries: {
    enabled: boolean;
    intervalDays: number;
  };
  stats: {
    enabled: boolean;
    intervalSeconds: number;
  };
  geoip: {
    enabled: boolean;
    /** @deprecated GeoIP is now handled by Tautulli API, license key is no longer required */
    licenseKey?: string;
    localCoordinates?: LocalCoordinates;
  };
}

// GeoIP information (used internally by Varken)
export interface GeoIPInfo {
  city: string;
  region: string;
  country: string;
  latitude: number;
  longitude: number;
}
