import { describe, it, expect } from 'vitest';
import { qualityOf, sessionEnrichment, streamSummary } from '../../../../src/plugins/inputs/utils/embySessions';

const item = {
  Height: 2160,
  Container: 'mkv',
  RunTimeTicks: 99_600_000_000,
  ProductionYear: 2024,
  Genres: ['Science Fiction', 'Adventure'],
  OfficialRating: 'PG-13',
  CommunityRating: 8.1,
  MediaStreams: [
    { Type: 'Video', Index: 0, Codec: 'hevc' },
    { Type: 'Audio', Index: 1, Codec: 'truehd' },
  ],
};
const directPlay = {
  UserId: 'u1',
  DeviceName: 'Firefox',
  RemoteEndPoint: '203.0.113.27',
  NowPlayingItem: item,
  PlayState: { IsPaused: false, PositionTicks: 24_900_000_000, AudioStreamIndex: 1 },
};
const transcoding = {
  ...directPlay,
  RemoteEndPoint: '192.168.1.42:51234',
  TranscodingInfo: {
    IsVideoDirect: false,
    IsAudioDirect: true,
    VideoCodec: 'h264',
    AudioCodec: 'aac',
    Height: 1080,
    Bitrate: 8_000_000,
    Framerate: 23.976,
    CompletionPercentage: 12.5,
    TranscodeReasons: ['VideoCodecNotSupported', 'ContainerNotSupported'],
  },
};

describe('qualityOf', () => {
  it('uses the height, else the container', () => {
    expect(qualityOf(item)).toBe('2160p');
    expect(qualityOf({ Container: 'mp3' })).toBe('MP3');
    expect(qualityOf(undefined)).toBe('unknown');
  });
});

describe('sessionEnrichment', () => {
  it('describes a direct-play session with the source format', () => {
    expect(sessionEnrichment(directPlay)).toEqual({
      tags: {
        network: 'wan',
        audio_decision: 'direct play',
        transcode_reasons: 'none',
        video_codec: 'HEVC',
        stream_video_codec: 'HEVC',
        stream_audio_codec: 'TRUEHD',
        stream_video_resolution: '2160p',
        device_name: 'Firefox',
        user_id: 'u1',
        year: 2024,
        genre: 'Science Fiction',
        content_rating: 'PG-13',
      },
      fields: { duration_seconds: 9960, view_offset_seconds: 2490, community_rating: 8.1 },
      floatFields: ['stream_framerate', 'transcode_progress', 'community_rating'],
    });
  });

  it('describes a transcoded stream', () => {
    const { tags, fields } = sessionEnrichment(transcoding);

    expect(tags).toMatchObject({
      network: 'lan',
      audio_decision: 'direct stream',
      transcode_reasons: 'ContainerNotSupported,VideoCodecNotSupported',
      video_codec: 'HEVC',
      stream_video_codec: 'H264',
      stream_audio_codec: 'AAC',
      stream_video_resolution: '1080p',
    });
    expect(fields).toMatchObject({ stream_bitrate: 8000, stream_framerate: 23.976, transcode_progress: 12.5 });
  });

  it('marks a transcoded audio track', () => {
    const session = { ...transcoding, TranscodingInfo: { ...transcoding.TranscodingInfo, IsAudioDirect: false } };

    expect(sessionEnrichment(session).tags.audio_decision).toBe('transcode');
  });

  it('labels missing metadata unknown and omits missing numbers', () => {
    expect(sessionEnrichment({})).toEqual({
      tags: {
        network: 'unknown',
        audio_decision: 'direct play',
        transcode_reasons: 'none',
        video_codec: 'unknown',
        stream_video_codec: 'unknown',
        stream_audio_codec: 'unknown',
        stream_video_resolution: 'unknown',
        device_name: 'unknown',
        user_id: 'unknown',
        year: 'unknown',
        genre: 'unknown',
        content_rating: 'unknown',
      },
      fields: {},
      floatFields: ['stream_framerate', 'transcode_progress', 'community_rating'],
    });
  });
});

describe('streamSummary', () => {
  it('counts clients, distinct users and stream kinds', () => {
    const remux = { ...transcoding, UserId: 'u2', TranscodingInfo: { ...transcoding.TranscodingInfo, IsVideoDirect: true, IsAudioDirect: true } };
    const idle = { UserId: 'u1', DeviceName: 'Phone', RemoteEndPoint: '203.0.113.30' };

    expect(streamSummary([directPlay, transcoding, remux, idle])).toEqual({
      connected_clients: 4,
      connected_users: 2,
      streaming_users: 2,
      direct_play_streams: 1,
      direct_streams: 1,
      lan_streams: 2,
      wan_streams: 1,
    });
  });
});
