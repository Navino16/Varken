/**
 * Overseerr input configuration and API response types
 */

// Configuration
export interface OverseerrConfig {
  id: number;
  url: string;
  apiKey: string;
  ssl?: boolean;
  verifySsl?: boolean;
  requestCounts: {
    enabled: boolean;
    intervalSeconds: number;
  };
  latestRequests: {
    enabled: boolean;
    count: number;
    intervalSeconds: number;
  };
}

// API Response Types - /api/v1/request/count
export interface OverseerrRequestCounts {
  total: number;
  movie: number;
  tv: number;
  pending: number;
  approved: number;
  processing: number;
  available: number;
  declined: number;
}

// API Response Types - /api/v1/issue/count
export interface OverseerrIssuesCounts {
  total: number;
  video: number;
  audio: number;
  subtitles: number;
  others: number;
  open: number;
  closed: number;
}

// API Response Types - /api/v1/request
export interface OverseerrRequestsResponse {
  pageInfo: {
    pages: number;
    pageSize: number;
    results: number;
    page: number;
  };
  results: OverseerrRequest[];
}

export interface OverseerrRequest {
  id: number;
  status: number;
  createdAt: string;
  updatedAt: string;
  type: 'movie' | 'tv';
  is4k: boolean;
  serverId?: number;
  profileId?: number;
  rootFolder?: string;
  languageProfileId?: number;
  tags?: number[];
  media: OverseerrMedia;
  requestedBy: OverseerrUser;
  modifiedBy?: OverseerrUser;
  seasons?: OverseerrSeasonRequest[];
}

export interface OverseerrMedia {
  id: number;
  mediaType: 'movie' | 'tv';
  tmdbId: number;
  tvdbId?: number;
  imdbId?: string;
  status: number;
  status4k?: number;
  createdAt: string;
  updatedAt: string;
  lastSeasonChange?: string;
  mediaAddedAt?: string;
  serviceId?: number;
  serviceId4k?: number;
  externalServiceId?: number;
  externalServiceId4k?: number;
  externalServiceSlug?: string;
  externalServiceSlug4k?: string;
  ratingKey?: string;
  ratingKey4k?: string;
  plexUrl?: string;
  plexUrl4k?: string;
}

export interface OverseerrUser {
  id: number;
  email: string;
  plexUsername?: string;
  jellyfinUsername?: string;
  username?: string;
  recoveryLinkExpirationDate?: string;
  userType: number;
  plexId?: number;
  jellyfinUserId?: string;
  avatar: string;
  movieQuotaLimit?: number;
  movieQuotaDays?: number;
  tvQuotaLimit?: number;
  tvQuotaDays?: number;
  createdAt: string;
  updatedAt: string;
  requestCount: number;
  displayName: string;
}

export interface OverseerrSeasonRequest {
  id: number;
  seasonNumber: number;
  status: number;
  createdAt: string;
  updatedAt: string;
}

// API Response Types - /api/v1/movie/{id} and /api/v1/tv/{id}
export interface OverseerrMediaDetails {
  id: number;
  title?: string; // For movies
  name?: string; // For TV shows
  mediaInfo?: {
    status: number;
    requests?: Array<{
      requestedBy: {
        displayName: string;
      };
      createdAt: string;
    }>;
  };
}
