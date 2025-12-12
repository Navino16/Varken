/**
 * Bazarr input configuration and API response types
 */

// Configuration
export interface BazarrConfig {
  id: number;
  url: string;
  apiKey: string;
  verifySsl: boolean;
  wanted: {
    enabled: boolean;
    intervalSeconds: number;
  };
  history: {
    enabled: boolean;
    intervalSeconds: number;
  };
}

// API Response Types - /api/movies/wanted
export interface BazarrWantedMovie {
  radarrId: number;
  title: string;
  monitored: boolean;
  missing_subtitles: BazarrMissingSubtitle[];
  sceneName?: string;
  failedAttempts?: string;
}

// API Response Types - /api/episodes/wanted
export interface BazarrWantedEpisode {
  sonarrSeriesId: number;
  sonarrEpisodeId: number;
  seriesTitle: string;
  episode_number: string;
  monitored: boolean;
  missing_subtitles: BazarrMissingSubtitle[];
  sceneName?: string;
  failedAttempts?: string;
}

export interface BazarrMissingSubtitle {
  name: string;
  code2: string;
  code3: string;
  forced: boolean;
  hi: boolean;
}

// API Response Types - /api/history/movies
export interface BazarrMovieHistory {
  id: number;
  radarrId: number;
  title: string;
  language: { name: string; code2: string; code3: string };
  provider: string;
  score?: string;
  subs_id?: string;
  description: string;
  timestamp: string;
  action: number;
  video_path?: string;
  subtitles_path?: string;
  raw_timestamp: number;
}

// API Response Types - /api/history/series
export interface BazarrSeriesHistory {
  id: number;
  sonarrSeriesId: number;
  sonarrEpisodeId: number;
  seriesTitle: string;
  episode_number: string;
  language: { name: string; code2: string; code3: string };
  provider: string;
  score?: string;
  subs_id?: string;
  description: string;
  timestamp: string;
  action: number;
  video_path?: string;
  subtitles_path?: string;
  raw_timestamp: number;
}

// API Response Types - /api/system/health
export interface BazarrHealthStatus {
  object: string;
  issue: string;
}

// Paginated response wrapper
export interface BazarrPaginatedResponse<T> {
  data: T[];
  total: number;
}

// Type aliases for specific responses
export type BazarrWantedMoviesResponse = BazarrPaginatedResponse<BazarrWantedMovie>;
export type BazarrWantedEpisodesResponse = BazarrPaginatedResponse<BazarrWantedEpisode>;
export type BazarrMovieHistoryResponse = BazarrPaginatedResponse<BazarrMovieHistory>;
export type BazarrSeriesHistoryResponse = BazarrPaginatedResponse<BazarrSeriesHistory>;
