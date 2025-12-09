/**
 * Radarr input configuration and API response types
 */

import type { QualityInfo, StatusMessage, Image, Ratings } from '../common.types';

// Configuration
export interface RadarrConfig {
  id: number;
  url: string;
  apiKey: string;
  ssl?: boolean;
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

// API Response Types - /api/v3/movie
export interface RadarrMovie {
  id: number;
  title: string;
  originalTitle: string;
  sortTitle: string;
  sizeOnDisk: number;
  status: string;
  overview: string;
  inCinemas: string;
  physicalRelease?: string;
  digitalRelease?: string;
  images: Image[];
  website: string;
  year: number;
  hasFile: boolean;
  youTubeTrailerId?: string;
  studio: string;
  path: string;
  qualityProfileId: number;
  monitored: boolean;
  minimumAvailability: string;
  isAvailable: boolean;
  folderName: string;
  runtime: number;
  cleanTitle: string;
  imdbId: string;
  tmdbId: number;
  titleSlug: string;
  certification: string;
  genres: string[];
  tags: number[];
  added: string;
  ratings: Ratings;
  movieFile?: RadarrMovieFile;
  collection?: RadarrCollection;
  popularity?: number;
}

export interface RadarrMovieFile {
  id: number;
  movieId: number;
  relativePath: string;
  path: string;
  size: number;
  dateAdded: string;
  quality: QualityInfo;
  mediaInfo?: RadarrMediaInfo;
}

export interface RadarrMediaInfo {
  audioBitrate: number;
  audioChannels: number;
  audioCodec: string;
  audioLanguages: string;
  audioStreamCount: number;
  videoBitDepth: number;
  videoBitrate: number;
  videoCodec: string;
  videoFps: number;
  resolution: string;
  runTime: string;
  scanType: string;
  subtitles: string;
}

export interface RadarrCollection {
  name: string;
  tmdbId: number;
  images: Image[];
}

// API Response Types - /api/v3/queue
export interface RadarrQueue {
  id: number;
  movieId: number;
  movie: RadarrMovie;
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

export interface RadarrQueueResponse {
  page: number;
  pageSize: number;
  sortKey: string;
  sortDirection: string;
  totalRecords: number;
  records: RadarrQueue[];
}
