import { describe, it, expect } from 'vitest';
import { isPrivateIp, networkOf, normalizeIp } from '../../../../src/plugins/inputs/utils/network';

describe('isPrivateIp', () => {
  it.each(['10.1.2.3', '172.16.0.1', '172.31.255.254', '192.168.1.42', '127.0.0.1', '0.1.2.3', '169.254.1.1', '224.0.0.1', '255.255.255.255', '::1', 'fe80::1', 'fc00::1', 'fd00::1', 'fd12:3456::1', 'fc12::1', 'fe9a::1', 'febf::1'])(
    'treats %s as private',
    (ip) => {
      expect(isPrivateIp(ip)).toBe(true);
    }
  );

  it.each(['8.8.8.8', '172.32.0.1', '203.0.113.27', '2001:db8::1', 'fec0::1', 'fe00::1'])('treats %s as public', (ip) => {
    expect(isPrivateIp(ip)).toBe(false);
  });

  it('normalizes the address before matching', () => {
    expect(isPrivateIp('::ffff:192.168.1.5')).toBe(true);
    expect(isPrivateIp('192.168.1.5:51234')).toBe(true);
  });
});

describe('normalizeIp', () => {
  it.each([
    ['::ffff:192.168.1.5', '192.168.1.5'],
    ['192.168.1.5:51234', '192.168.1.5'],
    ['[fe80::1]:8096', 'fe80::1'],
    ['[::ffff:192.168.1.5]:51234', '192.168.1.5'],
    ['fe80::1', 'fe80::1'],
    [' 203.0.113.27 ', '203.0.113.27'],
  ])('normalizes %s', (address, ip) => {
    expect(normalizeIp(address)).toBe(ip);
  });
});

describe('networkOf', () => {
  it('classifies private addresses as lan and the rest as wan', () => {
    expect(networkOf('192.168.1.5:51234')).toBe('lan');
    expect(networkOf('::ffff:10.0.0.2')).toBe('lan');
    expect(networkOf('203.0.113.27')).toBe('wan');
  });

  it.each([[''], [null], [undefined]])('is unknown for %s', (address) => {
    expect(networkOf(address)).toBe('unknown');
  });
});
