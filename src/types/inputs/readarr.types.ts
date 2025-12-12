/**
 * Readarr input configuration and API response types
 */

import type { QualityInfo, StatusMessage, Image, Ratings } from '../common.types';

// Configuration
export interface ReadarrConfig {
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

// API Response Types - /api/v1/author
export interface ReadarrAuthor {
  id: number;
  authorMetadataId: number;
  status: string;
  authorName: string;
  authorNameLastFirst: string;
  foreignAuthorId: string;
  titleSlug: string;
  overview: string;
  links: { url: string; name: string }[];
  images: Image[];
  path: string;
  qualityProfileId: number;
  metadataProfileId: number;
  monitored: boolean;
  rootFolderPath: string;
  genres: string[];
  cleanName: string;
  sortName: string;
  sortNameLastFirst: string;
  tags: number[];
  added: string;
  ratings: Ratings;
  statistics?: ReadarrAuthorStatistics;
}

export interface ReadarrAuthorStatistics {
  bookFileCount: number;
  bookCount: number;
  availableBookCount: number;
  totalBookCount: number;
  sizeOnDisk: number;
  percentOfBooks: number;
}

// API Response Types - /api/v1/book
export interface ReadarrBook {
  id: number;
  authorId: number;
  foreignBookId: string;
  titleSlug: string;
  title: string;
  releaseDate: string;
  links: { url: string; name: string }[];
  genres: string[];
  ratings: Ratings;
  cleanTitle: string;
  monitored: boolean;
  anyEditionOk: boolean;
  lastSearchTime?: string;
  added: string;
  images: Image[];
  author: ReadarrAuthor;
  editions: ReadarrEdition[];
  grabbed?: boolean;
}

export interface ReadarrEdition {
  id: number;
  bookId: number;
  foreignEditionId: string;
  titleSlug: string;
  isbn13: string;
  asin: string;
  title: string;
  overview: string;
  format: string;
  isEbook: boolean;
  pageCount: number;
  monitored: boolean;
  manualAdd: boolean;
  images: Image[];
  links: { url: string; name: string }[];
  ratings: Ratings;
}

// API Response Types - /api/v1/queue
export interface ReadarrQueue {
  id: number;
  authorId: number;
  bookId: number;
  author: ReadarrAuthor;
  book: ReadarrBook;
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
}

export interface ReadarrQueueResponse {
  page: number;
  pageSize: number;
  sortKey: string;
  sortDirection: string;
  totalRecords: number;
  records: ReadarrQueue[];
}
