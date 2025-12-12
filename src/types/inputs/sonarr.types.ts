/**
 * Sonarr input configuration and API response types
 */

import type { QualityInfo, StatusMessage, Image, Ratings } from '../common.types';

// Configuration
export interface SonarrConfig {
  id: number;
  url: string;
  apiKey: string;
  ssl?: boolean;
  verifySsl?: boolean;
  queue: {
    enabled: boolean;
    intervalSeconds: number;
  };
  calendar: {
    enabled: boolean;
    futureDays: number;
    missingDays: number;
    intervalSeconds: number;
  };
}

// API Response Types - /api/v3/series
export interface SonarrTVShow {
  id: number;
  title: string;
  sortTitle: string;
  status: string;
  ended: boolean;
  overview: string;
  network: string;
  airTime: string;
  images: Image[];
  seasons: SonarrSeason[];
  year: number;
  path: string;
  qualityProfileId: number;
  seasonFolder: boolean;
  monitored: boolean;
  useSceneNumbering: boolean;
  runtime: number;
  tvdbId: number;
  tvRageId: number;
  tvMazeId: number;
  firstAired: string;
  seriesType: string;
  cleanTitle: string;
  imdbId: string;
  titleSlug: string;
  rootFolderPath: string;
  certification: string;
  genres: string[];
  tags: number[];
  added: string;
  ratings: Ratings;
  statistics: SonarrStatistics;
  languageProfileId?: number;
  originalLanguage?: { id: number; name: string };
}

export interface SonarrSeason {
  seasonNumber: number;
  monitored: boolean;
  statistics?: SonarrSeasonStatistics;
}

export interface SonarrSeasonStatistics {
  episodeFileCount: number;
  episodeCount: number;
  totalEpisodeCount: number;
  sizeOnDisk: number;
  percentOfEpisodes: number;
}

export interface SonarrStatistics {
  seasonCount: number;
  episodeFileCount: number;
  episodeCount: number;
  totalEpisodeCount: number;
  sizeOnDisk: number;
  percentOfEpisodes: number;
}

// API Response Types - /api/v3/episode
export interface SonarrEpisode {
  id: number;
  seriesId: number;
  tvdbId: number;
  episodeFileId: number;
  seasonNumber: number;
  episodeNumber: number;
  title: string;
  airDate: string;
  airDateUtc: string;
  overview: string;
  hasFile: boolean;
  monitored: boolean;
  absoluteEpisodeNumber?: number;
  sceneAbsoluteEpisodeNumber?: number;
  sceneEpisodeNumber?: number;
  sceneSeasonNumber?: number;
  unverifiedSceneNumbering: boolean;
  series?: SonarrTVShow;
  images: Image[];
  grabbed?: boolean;
  lastSearchTime?: string;
}

// API Response Types - /api/v3/queue
export interface SonarrQueue {
  id: number;
  seriesId: number;
  episodeId: number;
  seasonNumber: number;
  series: SonarrTVShow;
  episode: SonarrEpisode;
  quality: QualityInfo;
  size: number;
  sizeleft: number;
  timeleft: string;
  estimatedCompletionTime: string;
  status: string;
  trackedDownloadStatus: string;
  trackedDownloadState: string;
  statusMessages: StatusMessage[];
  errorMessage?: string;
  downloadId: string;
  protocol: string;
  downloadClient: string;
  indexer: string;
  outputPath?: string;
  added: string;
  languages?: { id: number; name: string }[];
  customFormats?: unknown[];
  customFormatScore?: number;
}

export interface SonarrQueueResponse {
  page: number;
  pageSize: number;
  sortKey: string;
  sortDirection: string;
  totalRecords: number;
  records: SonarrQueue[];
}
