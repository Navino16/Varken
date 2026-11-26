import { describe, it, expect } from 'vitest';
import { normalizeMediaType } from '../../../../src/plugins/inputs/utils/mediaType';

describe('normalizeMediaType', () => {
  it.each([
    ['movie', 'movie'], ['Movie', 'movie'], ['episode', 'episode'], ['Episode', 'episode'],
    ['show', 'show'], ['tv', 'show'], ['series', 'show'], ['Series', 'show'],
    ['season', 'season'], ['Season', 'season'],
    ['artist', 'artist'], ['MusicArtist', 'artist'],
    ['album', 'album'], ['MusicAlbum', 'album'], ['music', 'album'],
    ['track', 'track'], ['Audio', 'track'],
    ['clip', 'clip'], ['MusicVideo', 'clip'], ['Video', 'clip'], ['Trailer', 'clip'],
    ['photo', 'photo'], ['Photo', 'photo'],
    ['TvChannel', 'live'], ['LiveTvChannel', 'live'], ['LiveTvProgram', 'live'], ['Program', 'live'], ['Recording', 'live'],
  ])('maps %s to %s', (raw, expected) => expect(normalizeMediaType(raw)).toBe(expected));

  it('keeps an unmapped value, lowercased', () => expect(normalizeMediaType('AudioBook')).toBe('audiobook'));

  it.each([[''], ['   '], [null], [undefined]])('returns unknown for %j', (raw) => expect(normalizeMediaType(raw)).toBe('unknown'));
});
