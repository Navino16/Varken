export interface StreamLike {
  Type?: string | null;
  Index?: number | null;
  Codec?: string | null;
}

export interface TranscodeLike {
  IsVideoDirect?: boolean | null;
  IsAudioDirect?: boolean | null;
  AudioCodec?: string | null;
}

/**
 * Codec of the audio track being played (Jellyfin/Emby): the stream at `audioStreamIndex`,
 * else the first audio stream, else the transcoder's output codec.
 */
export function sourceAudioCodec(
  streams: readonly StreamLike[] | null | undefined,
  audioStreamIndex: number | null | undefined,
  transcode?: TranscodeLike | null
): string {
  const audio = (streams ?? []).filter((s) => s.Type === 'Audio');
  const played = audio.find((s) => s.Index === audioStreamIndex) ?? audio[0];
  const codec = played?.Codec || transcode?.AudioCodec || '';
  return codec.toUpperCase() || 'unknown';
}

/** Codec of the first video stream (Jellyfin/Emby), upper-cased. */
export function sourceVideoCodec(streams: readonly StreamLike[] | null | undefined): string {
  return ((streams ?? []).find((s) => s.Type === 'Video')?.Codec || '').toUpperCase() || 'unknown';
}

/** A session is transcoding unless both tracks are known to be copied (remux). */
export function isTranscoding(transcode: TranscodeLike | null | undefined): boolean {
  if (!transcode) {
    return false;
  }
  return !(transcode.IsVideoDirect === true && transcode.IsAudioDirect === true);
}

/** `1080` → `1080p`; labels such as `4k` or `sd` are upper-cased. */
export function resolutionLabel(resolution: string | null | undefined): string {
  if (!resolution) {
    return 'unknown';
  }
  return /^\d+$/.test(resolution) ? `${resolution}p` : resolution.toUpperCase();
}
