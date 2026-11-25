import { isTranscoding, sourceAudioCodec, sourceVideoCodec, type StreamLike, type TranscodeLike } from './mediaStreams';
import { networkOf } from './network';
import { isNumber } from './numbers';

export interface EmbyItemLike {
  Height?: number | null;
  Container?: string | null;
  RunTimeTicks?: number | null;
  ProductionYear?: number | null;
  Genres?: readonly string[] | null;
  OfficialRating?: string | null;
  CommunityRating?: number | null;
  MediaStreams?: readonly StreamLike[] | null;
}

export interface EmbyPlayStateLike {
  IsPaused?: boolean | null;
  PositionTicks?: number | null;
  AudioStreamIndex?: number | null;
}

export interface EmbyTranscodeLike extends TranscodeLike {
  VideoCodec?: string | null;
  Height?: number | null;
  Bitrate?: number | null;
  Framerate?: number | null;
  CompletionPercentage?: number | null;
  TranscodeReasons?: readonly string[] | null;
}

/** Fields shared by Jellyfin `SessionInfoDto` and Emby `Session.SessionInfo`. */
export interface EmbySessionLike {
  UserId?: string | null;
  DeviceName?: string | null;
  RemoteEndPoint?: string | null;
  NowPlayingItem?: EmbyItemLike | null;
  PlayState?: EmbyPlayStateLike | null;
  TranscodingInfo?: EmbyTranscodeLike | null;
}

const TICKS_PER_SECOND = 10_000_000;

export function qualityOf(item: EmbyItemLike | null | undefined): string {
  if (item?.Height) {
    return `${item.Height}p`;
  }
  return (item?.Container ?? '').toUpperCase() || 'unknown';
}

export function sessionEnrichment(session: EmbySessionLike): {
  tags: Record<string, string | number>;
  fields: Record<string, number>;
  floatFields: string[];
} {
  const item = session.NowPlayingItem;
  const transcode = session.TranscodingInfo;
  const videoCodec = sourceVideoCodec(item?.MediaStreams);
  const audioCodec = sourceAudioCodec(item?.MediaStreams, session.PlayState?.AudioStreamIndex);
  let audioDecision = 'direct play';
  if (transcode) {
    audioDecision = transcode.IsAudioDirect ? 'direct stream' : 'transcode';
  }

  const fields: Record<string, number> = {};
  if (isNumber(item?.RunTimeTicks)) {
    fields.duration_seconds = Math.floor(item.RunTimeTicks / TICKS_PER_SECOND);
  }
  if (isNumber(session.PlayState?.PositionTicks)) {
    fields.view_offset_seconds = Math.floor(session.PlayState.PositionTicks / TICKS_PER_SECOND);
  }
  if (isNumber(transcode?.Bitrate)) {
    fields.stream_bitrate = Math.round(transcode.Bitrate / 1000);
  }
  if (isNumber(transcode?.Framerate)) {
    fields.stream_framerate = transcode.Framerate;
  }
  if (isNumber(transcode?.CompletionPercentage)) {
    fields.transcode_progress = transcode.CompletionPercentage;
  }
  if (isNumber(item?.CommunityRating)) {
    fields.community_rating = item.CommunityRating;
  }

  return {
    tags: {
      network: networkOf(session.RemoteEndPoint),
      audio_decision: audioDecision,
      transcode_reasons: transcode?.TranscodeReasons?.length ? [...transcode.TranscodeReasons].sort().join(',') : 'none',
      video_codec: videoCodec,
      stream_video_codec: transcode?.VideoCodec ? transcode.VideoCodec.toUpperCase() : videoCodec,
      stream_audio_codec: transcode?.AudioCodec ? transcode.AudioCodec.toUpperCase() : audioCodec,
      stream_video_resolution: transcode?.Height ? `${transcode.Height}p` : qualityOf(item),
      device_name: session.DeviceName || 'unknown',
      user_id: session.UserId || 'unknown',
      year: item?.ProductionYear ?? 'unknown',
      genre: item?.Genres?.[0] || 'unknown',
      content_rating: item?.OfficialRating || 'unknown',
    },
    fields,
    floatFields: ['stream_framerate', 'transcode_progress', 'community_rating'],
  };
}

/** Summary over every connected session; stream counters only cover sessions playing something. */
export function streamSummary(sessions: readonly EmbySessionLike[]): Record<string, number> {
  const active = sessions.filter((s) => s.NowPlayingItem);
  const distinctUsers = (list: readonly EmbySessionLike[]): number => new Set(list.map((s) => s.UserId).filter(Boolean)).size;
  const networks = active.map((s) => networkOf(s.RemoteEndPoint));
  return {
    connected_clients: sessions.length,
    connected_users: distinctUsers(sessions),
    streaming_users: distinctUsers(active),
    direct_play_streams: active.filter((s) => !s.TranscodingInfo).length,
    direct_streams: active.filter((s) => s.TranscodingInfo && !isTranscoding(s.TranscodingInfo)).length,
    lan_streams: networks.filter((n) => n === 'lan').length,
    wan_streams: networks.filter((n) => n === 'wan').length,
  };
}
