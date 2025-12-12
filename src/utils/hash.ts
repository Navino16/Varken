import { createHash } from 'crypto';

/**
 * Generate a SHA-256 hash of the input string
 * @param input - The string to hash
 * @returns The hexadecimal hash string
 */
export function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

/**
 * Generate a deterministic unique ID from multiple values
 * Useful for creating consistent IDs for data points
 * @param values - Values to combine into a unique ID
 * @returns A deterministic hash string
 */
export function generateUniqueId(...values: (string | number | boolean | null | undefined)[]): string {
  const combined = values
    .map((v) => (v === null || v === undefined ? '' : String(v)))
    .join('|');
  return sha256(combined);
}

/**
 * Generate a short unique ID (first 16 characters of SHA-256)
 * @param values - Values to combine into a unique ID
 * @returns A short deterministic hash string
 */
export function generateShortId(...values: (string | number | boolean | null | undefined)[]): string {
  return generateUniqueId(...values).substring(0, 16);
}

/**
 * Hash sensitive data for safe logging
 * @param data - Sensitive data to hash
 * @returns A masked representation with partial hash
 */
export function hashForLogging(data: string): string {
  if (!data || data.length === 0) {
    return '[empty]';
  }
  const hash = sha256(data).substring(0, 8);
  return `***${hash}`;
}
