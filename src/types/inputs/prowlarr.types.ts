/**
 * Prowlarr input configuration and API response types
 */

// Configuration
export interface ProwlarrConfig {
  id: number;
  url: string;
  apiKey: string;
  verifySsl: boolean;
  indexerStats: {
    enabled: boolean;
    intervalSeconds: number;
  };
}

// API Response Types - /api/v1/indexer
export interface ProwlarrIndexer {
  id: number;
  name: string;
  enable: boolean;
  redirect: boolean;
  supportsRss: boolean;
  supportsSearch: boolean;
  protocol: string;
  priority: number;
  privacy: string;
  definitionName: string;
  added: string;
  tags: number[];
}

// API Response Types - /api/v1/indexerstats
export interface ProwlarrIndexerStats {
  indexerId: number;
  indexerName: string;
  averageResponseTime: number;
  numberOfQueries: number;
  numberOfGrabs: number;
  numberOfRssQueries: number;
  numberOfAuthQueries: number;
  numberOfFailedQueries: number;
  numberOfFailedGrabs: number;
  numberOfFailedRssQueries: number;
  numberOfFailedAuthQueries: number;
}

// API Response Types - /api/v1/search
export interface ProwlarrSearchResult {
  guid: string;
  indexerId: number;
  indexer: string;
  title: string;
  sortTitle: string;
  size: number;
  protocol: string;
  publishDate: string;
  downloadUrl: string;
  infoUrl: string;
  categories: { id: number; name: string }[];
  seeders?: number;
  leechers?: number;
}
