/**
 * Emby input configuration and API response types
 * Note: Emby API is very similar to Jellyfin
 */

// Configuration
export interface EmbyConfig {
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
export interface EmbySession {
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
  PlayState?: EmbyPlayState;
  NowPlayingItem?: EmbyNowPlayingItem;
  TranscodingInfo?: EmbyTranscodingInfo;
  LastActivityDate: string;
  LastPlaybackCheckIn: string;
}

export interface EmbyPlayState {
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

export interface EmbyNowPlayingItem {
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

export interface EmbyTranscodingInfo {
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
export interface EmbyLibrary {
  Name: string;
  CollectionType: string;
  LibraryOptions: EmbyLibraryOptions;
  ItemId: string;
  PrimaryImageItemId?: string;
  RefreshStatus?: string;
  Locations: string[];
}

export interface EmbyLibraryOptions {
  EnablePhotos: boolean;
  EnableRealtimeMonitor: boolean;
  EnableChapterImageExtraction: boolean;
  ExtractChapterImagesDuringLibraryScan: boolean;
  SaveLocalMetadata: boolean;
  EnableInternetProviders: boolean;
  AutomaticRefreshIntervalDays: number;
}

// API Response Types - /Items/Counts
export interface EmbyItemCounts {
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
export interface EmbySystemInfo {
  ServerName: string;
  Version: string;
  Id: string;
  OperatingSystem: string;
  OperatingSystemDisplayName: string;
  HasPendingRestart: boolean;
  IsShuttingDown: boolean;
}
