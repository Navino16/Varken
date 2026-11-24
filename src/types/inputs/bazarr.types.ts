/**
 * Bazarr input configuration and API response types
 */

// Configuration
export interface BazarrConfig {
  id: number;
  url: string;
  apiKey: string;
  verifySsl?: boolean;
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

export interface BazarrLanguage {
  name: string;
  code2: string;
  code3: string;
  forced: boolean;
  hi: boolean;
}

export type BazarrMissingSubtitle = BazarrLanguage;

// API Response Types - /api/movies/history (Bazarr 1.x): no id nor raw timestamp,
// `timestamp` is humanized ("2 hours ago") and `parsed_timestamp` is strftime('%x %X')
export interface BazarrMovieHistory {
  radarrId: number;
  title: string;
  language: BazarrLanguage;
  provider: string;
  score?: string;
  subs_id?: string;
  description: string;
  timestamp: string;
  parsed_timestamp?: string;
  action: number;
  subtitles_path?: string;
}

// API Response Types - /api/episodes/history
export interface BazarrSeriesHistory {
  sonarrSeriesId: number;
  sonarrEpisodeId: number;
  seriesTitle: string;
  episode_number: string;
  episodeTitle?: string;
  language: BazarrLanguage;
  provider: string;
  score?: string;
  subs_id?: string;
  description: string;
  timestamp: string;
  parsed_timestamp?: string;
  action: number;
  subtitles_path?: string;
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
