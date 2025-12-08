/**
 * Ombi input configuration and API response types
 */

// Configuration
export interface OmbiConfig {
  id: number;
  url: string;
  apiKey: string;
  verifySsl: boolean;
  requestCounts: {
    enabled: boolean;
    intervalSeconds: number;
  };
  issueCounts: {
    enabled: boolean;
    intervalSeconds: number;
  };
}

// API Response Types - /api/v1/Request/count
export interface OmbiRequestCounts {
  approved: number;
  available: number;
  pending: number;
}

// API Response Types - /api/v1/Issues/count
export interface OmbiIssuesCounts {
  inProgress: number;
  pending: number;
  resolved: number;
}

// API Response Types - /api/v1/Request/tv
export interface OmbiTVRequest {
  id: number;
  tvDbId: number;
  imdbId?: string;
  title: string;
  overview?: string;
  status: string;
  requestStatus: string;
  posterPath?: string;
  background?: string;
  releaseDate?: string;
  totalSeasons: number;
  childRequests: OmbiChildRequest[];
  denied?: boolean;
  deniedReason?: string;
  markedAsDenied?: string;
  requestedByAlias?: string;
  languageProfile?: string;
  qualityOverride?: number;
  rootFolder?: string;
  externalProviderId?: string;
}

export interface OmbiChildRequest {
  id: number;
  parentRequestId: number;
  issueId?: number;
  seasonRequests: OmbiSeasonRequest[];
  title: string;
  approved: boolean;
  markedAsApproved?: string;
  requestedDate: string;
  available: boolean;
  markedAsAvailable?: string;
  requestedUserId: string;
  denied?: boolean;
  deniedReason?: string;
  markedAsDenied?: string;
  requestType: number;
  requestStatus: string;
  requestedByAlias?: string;
}

export interface OmbiSeasonRequest {
  id: number;
  seasonNumber: number;
  episodes: OmbiEpisodeRequest[];
}

export interface OmbiEpisodeRequest {
  id: number;
  episodeNumber: number;
  title: string;
  airDate: string;
  url: string;
  available: boolean;
  approved: boolean;
  requested: boolean;
}

// API Response Types - /api/v1/Request/movie
export interface OmbiMovieRequest {
  id: number;
  theMovieDbId: number;
  imdbId?: string;
  title: string;
  overview?: string;
  status: string;
  requestStatus: string;
  posterPath?: string;
  background?: string;
  releaseDate?: string;
  digitalReleaseDate?: string;
  approved: boolean;
  approved4K?: boolean;
  markedAsApproved?: string;
  markedAsApproved4K?: string;
  requestedDate: string;
  requestedDate4k?: string;
  available: boolean;
  available4K?: boolean;
  markedAsAvailable?: string;
  markedAsAvailable4K?: string;
  requestedUserId: string;
  denied?: boolean;
  denied4K?: boolean;
  deniedReason?: string;
  deniedReason4K?: string;
  markedAsDenied?: string;
  markedAsDenied4K?: string;
  requestType: number;
  requestedByAlias?: string;
  qualityOverride?: number;
  rootPathOverride?: number;
  langCode?: string;
  digitalRelease?: boolean;
  released?: boolean;
  is4kRequest?: boolean;
  has4KRequest?: boolean;
  canApprove?: boolean;
  source?: number;
  subscribed?: boolean;
  showSubscribe?: boolean;
}
