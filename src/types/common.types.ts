/**
 * Common/shared types used across multiple plugins
 */

export interface QueuePages {
  page: number;
  pageSize: number;
  sortKey: string;
  sortDirection: string;
  totalRecords: number;
  records: unknown[];
}

export interface QualityInfo {
  quality: {
    id: number;
    name: string;
    source: string;
    resolution: number;
  };
  revision: {
    version: number;
    real: number;
    isRepack: boolean;
  };
}

export interface StatusMessage {
  title: string;
  messages: string[];
}

export interface Image {
  coverType: string;
  url: string;
  remoteUrl?: string;
}

export interface Ratings {
  votes: number;
  value: number;
}
