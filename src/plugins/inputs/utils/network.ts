const PRIVATE_RANGES = [
  /^10\./, // 10.0.0.0/8
  /^172\.(1[6-9]|2[0-9]|3[0-1])\./, // 172.16.0.0/12
  /^192\.168\./,
  /^127\./, // loopback
  /^0\./,
  /^169\.254\./, // link-local
  /^224\./, // multicast
  /^255\./, // broadcast
  /^::1$/,
  /^fe[89ab][0-9a-f]:/i, // fe80::/10 link-local
  /^f[cd][0-9a-f]{2}:/i, // fc00::/7 unique local
];

/** Bare IP of an endpoint as servers report it: IPv4-mapped IPv6, `ip:port` and `[v6]:port` forms. */
export function normalizeIp(address: string): string {
  const trimmed = address.trim();
  const bracketed = /^\[([^\]]+)\](?::\d+)?$/.exec(trimmed);
  if (bracketed) {
    return normalizeIp(bracketed[1]);
  }
  const ipv4WithPort = /^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/.exec(trimmed);
  if (ipv4WithPort) {
    return ipv4WithPort[1];
  }
  return trimmed.replace(/^::ffff:(?=\d{1,3}(?:\.\d{1,3}){3}$)/i, '');
}

export function isPrivateIp(ip: string): boolean {
  const normalized = normalizeIp(ip);
  return PRIVATE_RANGES.some((range) => range.test(normalized));
}

export function networkOf(address: string | null | undefined): 'lan' | 'wan' | 'unknown' {
  if (!address?.trim()) {
    return 'unknown';
  }
  return isPrivateIp(address) ? 'lan' : 'wan';
}
