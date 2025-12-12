/**
 * Tautulli input configuration and API response types
 */

// Configuration
export interface TautulliConfig {
  id: number;
  url: string;
  apiKey: string;
  ssl?: boolean;
  verifySsl?: boolean;
  fallbackIp?: string;
  activity: {
    enabled: boolean;
    intervalSeconds: number;
  };
  libraries: {
    enabled: boolean;
    intervalDays: number;
  };
  stats: {
    enabled: boolean;
    intervalSeconds: number;
  };
  geoip: {
    enabled: boolean;
    licenseKey?: string;
  };
}

// API Response Types - /api/v2?cmd=get_activity
export interface TautulliActivity {
  stream_count: string;
  sessions: TautulliSession[];
  stream_count_direct_play: number;
  stream_count_direct_stream: number;
  stream_count_transcode: number;
  total_bandwidth: number;
  lan_bandwidth: number;
  wan_bandwidth: number;
}

export interface TautulliSession {
  session_key: string;
  session_id: string;
  state: string;
  progress_percent: string;
  quality_profile: string;
  user: string;
  user_id: number;
  username: string;
  friendly_name: string;
  email: string;
  ip_address: string;
  ip_address_public: string;
  platform: string;
  platform_name: string;
  platform_version: string;
  product: string;
  product_version: string;
  player: string;
  machine_id: string;
  device: string;
  bandwidth: string;
  location: string;
  secure: string;
  relayed: number;
  local: string;
  media_type: string;
  rating_key: string;
  parent_rating_key: string;
  grandparent_rating_key: string;
  title: string;
  parent_title: string;
  grandparent_title: string;
  full_title: string;
  media_index: string;
  parent_media_index: string;
  year: string;
  thumb: string;
  parent_thumb: string;
  grandparent_thumb: string;
  art: string;
  duration: string;
  view_offset: string;
  live: number;
  live_uuid: string;
  transcode_decision: string;
  video_decision: string;
  audio_decision: string;
  subtitle_decision: string;
  container: string;
  bitrate: string;
  video_codec: string;
  video_resolution: string;
  video_full_resolution: string;
  video_dynamic_range: string;
  audio_codec: string;
  audio_channels: string;
  stream_container: string;
  stream_bitrate: string;
  stream_video_codec: string;
  stream_video_resolution: string;
  stream_video_full_resolution: string;
  stream_audio_codec: string;
  stream_audio_channels: string;
  transcode_container?: string;
  transcode_video_codec?: string;
  transcode_audio_codec?: string;
  transcode_hw_decoding: number;
  transcode_hw_encoding: number;
  transcode_speed?: string;
  transcode_progress?: number;
  library_name: string;
  section_id: string;
  originally_available_at?: string;
  added_at: string;
  guid: string;
  channel_stream?: number;
}

// API Response Types - /api/v2?cmd=get_libraries
export interface TautulliLibrary {
  section_id: string;
  section_name: string;
  section_type: string;
  count: string;
  parent_count?: string;
  child_count?: string;
  library_thumb: string;
  library_art: string;
  is_active: number;
}

// GeoIP information (added by Varken)
export interface GeoIPInfo {
  city: string;
  region: string;
  country: string;
  latitude: number;
  longitude: number;
}

// GeoIP lookup function type
export type GeoIPLookupFn = (ip: string) => Promise<GeoIPInfo | null>;

// API Response wrapper
export interface TautulliApiResponse<T> {
  response: {
    result: string;
    message?: string;
    data: T;
  };
}
