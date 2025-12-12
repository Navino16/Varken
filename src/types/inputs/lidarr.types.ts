/**
 * Lidarr input configuration and API response types
 */

import type { QualityInfo, StatusMessage, Image, Ratings } from '../common.types';

// Configuration
export interface LidarrConfig {
  id: number;
  url: string;
  apiKey: string;
  verifySsl: boolean;
  queue: {
    enabled: boolean;
    intervalSeconds: number;
  };
  missing: {
    enabled: boolean;
    intervalSeconds: number;
  };
}

// API Response Types - /api/v1/artist
export interface LidarrArtist {
  id: number;
  artistMetadataId: number;
  status: string;
  ended: boolean;
  artistName: string;
  foreignArtistId: string;
  tadbId: number;
  discogsId: number;
  overview: string;
  artistType: string;
  disambiguation: string;
  links: { url: string; name: string }[];
  images: Image[];
  path: string;
  qualityProfileId: number;
  metadataProfileId: number;
  monitored: boolean;
  monitorNewItems: string;
  rootFolderPath: string;
  genres: string[];
  cleanName: string;
  sortName: string;
  tags: number[];
  added: string;
  ratings: Ratings;
  statistics?: LidarrArtistStatistics;
}

export interface LidarrArtistStatistics {
  albumCount: number;
  trackFileCount: number;
  trackCount: number;
  totalTrackCount: number;
  sizeOnDisk: number;
  percentOfTracks: number;
}

// API Response Types - /api/v1/album
export interface LidarrAlbum {
  id: number;
  artistId: number;
  foreignAlbumId: string;
  title: string;
  overview: string;
  disambiguation: string;
  releaseDate: string;
  images: Image[];
  links: { url: string; name: string }[];
  genres: string[];
  albumType: string;
  secondaryTypes: string[];
  ratings: Ratings;
  duration: number;
  mediumCount: number;
  media: LidarrMedia[];
  artist: LidarrArtist;
  releases: LidarrRelease[];
  monitored: boolean;
  anyReleaseOk: boolean;
  lastSearchTime?: string;
  grabbed?: boolean;
  statistics?: LidarrAlbumStatistics;
}

export interface LidarrMedia {
  mediumNumber: number;
  mediumName: string;
  mediumFormat: string;
}

export interface LidarrRelease {
  id: number;
  albumId: number;
  foreignReleaseId: string;
  title: string;
  status: string;
  duration: number;
  trackCount: number;
  media: LidarrMedia[];
  monitored: boolean;
}

export interface LidarrAlbumStatistics {
  trackFileCount: number;
  trackCount: number;
  totalTrackCount: number;
  sizeOnDisk: number;
  percentOfTracks: number;
}

// API Response Types - /api/v1/queue
export interface LidarrQueue {
  id: number;
  artistId: number;
  albumId: number;
  artist: LidarrArtist;
  album: LidarrAlbum;
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
  customFormats?: unknown[];
  customFormatScore?: number;
}

export interface LidarrQueueResponse {
  page: number;
  pageSize: number;
  sortKey: string;
  sortDirection: string;
  totalRecords: number;
  records: LidarrQueue[];
}
