export type MediaType =
  | 'movie'
  | 'show'
  | 'season'
  | 'episode'
  | 'artist'
  | 'album'
  | 'track'
  | 'clip'
  | 'photo'
  | 'live'
  | 'unknown';

const VOCABULARY: Record<string, MediaType> = {
  movie: 'movie',
  episode: 'episode',
  show: 'show',
  tv: 'show',
  series: 'show',
  season: 'season',
  artist: 'artist',
  musicartist: 'artist',
  album: 'album',
  musicalbum: 'album',
  music: 'album',
  track: 'track',
  audio: 'track',
  clip: 'clip',
  musicvideo: 'clip',
  video: 'clip',
  trailer: 'clip',
  photo: 'photo',
  tvchannel: 'live',
  livetvchannel: 'live',
  livetvprogram: 'live',
  program: 'live',
  recording: 'live',
};

/** Maps a source's media or item type to the shared vocabulary; unmapped values are kept, lowercased. */
export function normalizeMediaType(value: string | null | undefined): string {
  const key = value?.trim().toLowerCase();
  if (!key) {
    return 'unknown';
  }
  return VOCABULARY[key] ?? key;
}
