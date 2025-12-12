/**
 * Plex input configuration and API response types
 */

// Configuration
export interface PlexConfig {
  id: number;
  url: string;
  token: string;
  verifySsl: boolean;
  sessions: {
    enabled: boolean;
    intervalSeconds: number;
  };
  libraries: {
    enabled: boolean;
    intervalSeconds: number;
  };
}

// API Response Types - /status/sessions
export interface PlexSessionsResponse {
  MediaContainer: {
    size: number;
    Metadata?: PlexSession[];
  };
}

export interface PlexSession {
  sessionKey: string;
  guid: string;
  ratingKey: string;
  key: string;
  type: string;
  title: string;
  grandparentTitle?: string;
  parentTitle?: string;
  parentIndex?: number;
  index?: number;
  thumb?: string;
  art?: string;
  parentThumb?: string;
  grandparentThumb?: string;
  grandparentArt?: string;
  duration: number;
  viewOffset: number;
  addedAt: number;
  updatedAt: number;
  Media: PlexMedia[];
  User: PlexUser;
  Player: PlexPlayer;
  Session: PlexSessionInfo;
  TranscodeSession?: PlexTranscodeSession;
}

export interface PlexMedia {
  id: number;
  duration: number;
  bitrate: number;
  width: number;
  height: number;
  aspectRatio: number;
  audioChannels: number;
  audioCodec: string;
  videoCodec: string;
  videoResolution: string;
  container: string;
  videoFrameRate: string;
  videoProfile: string;
  Part: PlexPart[];
}

export interface PlexPart {
  id: number;
  key: string;
  duration: number;
  file: string;
  size: number;
  container: string;
  videoProfile: string;
  Stream: PlexStream[];
}

export interface PlexStream {
  id: number;
  streamType: number;
  codec: string;
  index: number;
  bitrate?: number;
  height?: number;
  width?: number;
  displayTitle: string;
  selected?: boolean;
}

export interface PlexUser {
  id: string;
  thumb: string;
  title: string;
}

export interface PlexPlayer {
  address: string;
  device: string;
  machineIdentifier: string;
  model: string;
  platform: string;
  platformVersion: string;
  product: string;
  profile: string;
  state: string;
  title: string;
  version: string;
  local: boolean;
  relayed: boolean;
  secure: boolean;
  userID: number;
}

export interface PlexSessionInfo {
  id: string;
  bandwidth: number;
  location: string;
}

export interface PlexTranscodeSession {
  key: string;
  throttled: boolean;
  complete: boolean;
  progress: number;
  size: number;
  speed: number;
  duration: number;
  remaining: number;
  context: string;
  sourceVideoCodec: string;
  sourceAudioCodec: string;
  videoDecision: string;
  audioDecision: string;
  protocol: string;
  container: string;
  videoCodec: string;
  audioCodec: string;
  audioChannels: number;
  transcodeHwRequested: boolean;
  transcodeHwDecoding?: string;
  transcodeHwEncoding?: string;
}

// API Response Types - /library/sections
export interface PlexLibrariesResponse {
  MediaContainer: {
    size: number;
    Directory: PlexLibrary[];
  };
}

export interface PlexLibrary {
  key: string;
  type: string;
  title: string;
  agent: string;
  scanner: string;
  language: string;
  uuid: string;
  updatedAt: number;
  createdAt: number;
  scannedAt: number;
  content: boolean;
  directory: boolean;
  contentChangedAt: number;
  hidden: number;
  Location: { id: number; path: string }[];
}
