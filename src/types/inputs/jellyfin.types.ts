/**
 * Jellyfin input configuration and API response types
 */

// Configuration
export interface JellyfinConfig {
  id: number;
  url: string;
  apiKey: string;
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

// API Response Types - /Sessions
export interface JellyfinSession {
  Id: string;
  ServerId: string;
  UserId: string;
  UserName: string;
  Client: string;
  DeviceId: string;
  DeviceName: string;
  DeviceType: string;
  RemoteEndPoint: string;
  ApplicationVersion: string;
  IsActive: boolean;
  SupportsRemoteControl: boolean;
  SupportsMediaControl: boolean;
  PlayState?: JellyfinPlayState;
  NowPlayingItem?: JellyfinNowPlayingItem;
  TranscodingInfo?: JellyfinTranscodingInfo;
  LastActivityDate: string;
  LastPlaybackCheckIn: string;
}

export interface JellyfinPlayState {
  PositionTicks: number;
  CanSeek: boolean;
  IsPaused: boolean;
  IsMuted: boolean;
  VolumeLevel?: number;
  AudioStreamIndex?: number;
  SubtitleStreamIndex?: number;
  MediaSourceId?: string;
  PlayMethod: string;
  RepeatMode: string;
}

export interface JellyfinNowPlayingItem {
  Id: string;
  ServerId: string;
  Name: string;
  Type: string;
  MediaType: string;
  RunTimeTicks: number;
  IndexNumber?: number;
  ParentIndexNumber?: number;
  SeriesName?: string;
  SeriesId?: string;
  SeasonId?: string;
  ProductionYear?: number;
  Overview?: string;
  Container?: string;
  Width?: number;
  Height?: number;
}

export interface JellyfinTranscodingInfo {
  AudioCodec: string;
  VideoCodec: string;
  Container: string;
  IsVideoDirect: boolean;
  IsAudioDirect: boolean;
  Bitrate: number;
  Width: number;
  Height: number;
  AudioChannels: number;
  HardwareAccelerationType?: string;
  TranscodeReasons: string[];
}

// API Response Types - /Library/VirtualFolders
export interface JellyfinLibrary {
  Name: string;
  CollectionType: string;
  LibraryOptions: JellyfinLibraryOptions;
  ItemId: string;
  PrimaryImageItemId?: string;
  RefreshStatus?: string;
  Locations: string[];
}

export interface JellyfinLibraryOptions {
  EnablePhotos: boolean;
  EnableRealtimeMonitor: boolean;
  EnableChapterImageExtraction: boolean;
  ExtractChapterImagesDuringLibraryScan: boolean;
  SaveLocalMetadata: boolean;
  EnableInternetProviders: boolean;
  AutomaticRefreshIntervalDays: number;
}

// API Response Types - /Items/Counts
export interface JellyfinItemCounts {
  MovieCount: number;
  SeriesCount: number;
  EpisodeCount: number;
  ArtistCount: number;
  ProgramCount: number;
  TrailerCount: number;
  SongCount: number;
  AlbumCount: number;
  MusicVideoCount: number;
  BoxSetCount: number;
  BookCount: number;
  ItemCount: number;
}

// API Response Types - /System/Info
export interface JellyfinSystemInfo {
  ServerName: string;
  Version: string;
  Id: string;
  OperatingSystem: string;
  OperatingSystemDisplayName: string;
  HasPendingRestart: boolean;
  IsShuttingDown: boolean;
}
