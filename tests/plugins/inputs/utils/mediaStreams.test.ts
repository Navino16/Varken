import { describe, it, expect } from 'vitest';
import { isTranscoding, sourceAudioCodec } from '../../../../src/plugins/inputs/utils/mediaStreams';

const streams = [
  { Type: 'Video', Index: 0, Codec: 'hevc' },
  { Type: 'Audio', Index: 1, Codec: 'eac3' },
  { Type: 'Audio', Index: 2, Codec: 'aac' },
];

describe('sourceAudioCodec', () => {
  it('picks the audio stream being played', () => {
    expect(sourceAudioCodec(streams, 2)).toBe('AAC');
  });

  it('falls back to the first audio stream when the index is missing or unmatched', () => {
    expect(sourceAudioCodec(streams, undefined)).toBe('EAC3');
    expect(sourceAudioCodec(streams, 7)).toBe('EAC3');
  });

  it('falls back to the transcoded codec when no audio stream is known', () => {
    expect(sourceAudioCodec([streams[0]], 1, { AudioCodec: 'aac' })).toBe('AAC');
    expect(sourceAudioCodec(null, null, { AudioCodec: 'opus' })).toBe('OPUS');
  });

  it('returns unknown when nothing describes the audio', () => {
    expect(sourceAudioCodec(undefined, undefined)).toBe('unknown');
    expect(sourceAudioCodec([{ Type: 'Audio', Index: 1, Codec: null }], 1, { AudioCodec: '' })).toBe('unknown');
  });
});

describe('isTranscoding', () => {
  it('is false without transcoding info', () => {
    expect(isTranscoding(undefined)).toBe(false);
    expect(isTranscoding(null)).toBe(false);
  });

  it('is false for a remux that copies both video and audio', () => {
    expect(isTranscoding({ IsVideoDirect: true, IsAudioDirect: true })).toBe(false);
  });

  it('is true when either track is transcoded', () => {
    expect(isTranscoding({ IsVideoDirect: true, IsAudioDirect: false })).toBe(true);
    expect(isTranscoding({ IsVideoDirect: false, IsAudioDirect: true })).toBe(true);
  });

  it('keeps counting transcoding info whose direct flags are unknown', () => {
    expect(isTranscoding({})).toBe(true);
  });
});
