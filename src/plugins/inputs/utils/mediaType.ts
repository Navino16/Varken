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

/** Unmapped values are kept so new upstream types stay visible. */
export function normalizeMediaType(value: string | null | undefined): string {
  const key = value?.trim().toLowerCase();
  if (!key) {
    return 'unknown';
  }
  return VOCABULARY[key] ?? key;
}

/** Jellyfin/Emby: the item type tells movie from episode; the media kind alone (`Video`) does not. */
export function itemMediaType(item: { Type?: string | null; MediaType?: string | null } | null | undefined): string {
  if (item?.Type) {
    return normalizeMediaType(item.Type);
  }
  return item?.MediaType?.toLowerCase() === 'video' ? 'unknown' : normalizeMediaType(item?.MediaType);
}
