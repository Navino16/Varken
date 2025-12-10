import type { ReaderModel, City } from '@maxmind/geoip2-node';
import { Reader } from '@maxmind/geoip2-node';
import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';
import * as zlib from 'zlib';
import { createLogger } from '../core/Logger';
import type { GeoIPInfo } from '../types/inputs/tautulli.types';
import type { GeoIPConfig } from '../types/geoip.types';

const logger = createLogger('GeoIP');

const MAXMIND_DB_URL = 'https://download.maxmind.com/app/geoip_download';
const DB_FILENAME = 'GeoLite2-City.mmdb';
const DB_UPDATE_INTERVAL_DAYS = 7;

export class GeoIPHandler {
  private reader: ReaderModel | null = null;
  private config: GeoIPConfig;
  private dbPath: string;

  constructor(config: GeoIPConfig) {
    this.config = config;
    this.dbPath = path.join(config.dataFolder, DB_FILENAME);
  }

  /**
   * Initialize the GeoIP handler
   * Downloads/updates the database if needed
   */
  async initialize(): Promise<void> {
    if (!this.config.enabled) {
      logger.info('GeoIP is disabled');
      return;
    }

    if (!this.config.licenseKey) {
      logger.warn('GeoIP enabled but no license key provided - skipping');
      return;
    }

    // Ensure data folder exists
    if (!fs.existsSync(this.config.dataFolder)) {
      fs.mkdirSync(this.config.dataFolder, { recursive: true });
    }

    // Check if database needs update
    const needsUpdate = await this.checkNeedsUpdate();
    if (needsUpdate) {
      await this.downloadDatabase();
    }

    // Load the database
    await this.loadDatabase();
  }

  /**
   * Check if the database needs to be downloaded/updated
   */
  private async checkNeedsUpdate(): Promise<boolean> {
    if (!fs.existsSync(this.dbPath)) {
      logger.info('GeoIP database not found, will download');
      return true;
    }

    const stats = fs.statSync(this.dbPath);
    const ageInDays = (Date.now() - stats.mtime.getTime()) / (1000 * 60 * 60 * 24);

    if (ageInDays > DB_UPDATE_INTERVAL_DAYS) {
      logger.info(`GeoIP database is ${Math.floor(ageInDays)} days old, will update`);
      return true;
    }

    logger.debug(`GeoIP database is ${Math.floor(ageInDays)} days old, no update needed`);
    return false;
  }

  /**
   * Download the GeoLite2-City database from MaxMind
   */
  private async downloadDatabase(): Promise<void> {
    logger.info('Downloading GeoIP database from MaxMind...');

    const url = new URL(MAXMIND_DB_URL);
    url.searchParams.set('edition_id', 'GeoLite2-City');
    url.searchParams.set('license_key', this.config.licenseKey!);
    url.searchParams.set('suffix', 'tar.gz');

    const tempPath = `${this.dbPath}.tmp.tar.gz`;

    try {
      await this.downloadFile(url.toString(), tempPath);
      await this.extractDatabase(tempPath);
      logger.info('GeoIP database downloaded and extracted successfully');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error(`Failed to download GeoIP database: ${message}`);
      // Clean up temp file if it exists
      if (fs.existsSync(tempPath)) {
        fs.unlinkSync(tempPath);
      }
      throw error;
    }
  }

  /**
   * Download a file from a URL
   */
  private downloadFile(url: string, destPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const file = fs.createWriteStream(destPath);

      const request = https.get(url, (response) => {
        // Handle redirects
        if (response.statusCode === 301 || response.statusCode === 302) {
          const redirectUrl = response.headers.location;
          if (redirectUrl) {
            file.close();
            fs.unlinkSync(destPath);
            this.downloadFile(redirectUrl, destPath).then(resolve).catch(reject);
            return;
          }
        }

        if (response.statusCode !== 200) {
          file.close();
          fs.unlinkSync(destPath);
          reject(new Error(`HTTP ${response.statusCode}: ${response.statusMessage}`));
          return;
        }

        response.pipe(file);

        file.on('finish', () => {
          file.close();
          resolve();
        });
      });

      request.on('error', (err) => {
        file.close();
        if (fs.existsSync(destPath)) {
          fs.unlinkSync(destPath);
        }
        reject(err);
      });

      file.on('error', (err) => {
        file.close();
        if (fs.existsSync(destPath)) {
          fs.unlinkSync(destPath);
        }
        reject(err);
      });
    });
  }

  /**
   * Extract the .mmdb file from the downloaded tar.gz
   */
  private extractDatabase(tarGzPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const gunzip = zlib.createGunzip();
      const input = fs.createReadStream(tarGzPath);

      // Simple tar extraction - we only need the .mmdb file
      const chunks: Buffer[] = [];

      input
        .pipe(gunzip)
        .on('data', (chunk: Buffer) => {
          chunks.push(chunk);
        })
        .on('end', () => {
          try {
            const tarData = Buffer.concat(chunks);
            const mmdbData = this.extractMmdbFromTar(tarData);

            if (mmdbData) {
              fs.writeFileSync(this.dbPath, mmdbData);
              fs.unlinkSync(tarGzPath);
              resolve();
            } else {
              reject(new Error('Could not find .mmdb file in archive'));
            }
          } catch (error) {
            reject(error);
          }
        })
        .on('error', reject);
    });
  }

  /**
   * Extract the .mmdb file from raw tar data
   * Tar format: 512-byte header blocks followed by file content
   */
  private extractMmdbFromTar(tarData: Buffer): Buffer | null {
    let offset = 0;

    while (offset < tarData.length - 512) {
      // Read header
      const header = tarData.subarray(offset, offset + 512);

      // Check for empty block (end of archive)
      if (header.every((b) => b === 0)) {
        break;
      }

      // Get filename (first 100 bytes, null-terminated)
      const filenameEnd = header.indexOf(0);
      const filename = header.subarray(0, filenameEnd > 0 ? filenameEnd : 100).toString('utf8');

      // Get file size (bytes 124-135, octal)
      const sizeStr = header.subarray(124, 136).toString('utf8').trim();
      const size = parseInt(sizeStr, 8) || 0;

      // Move past header
      offset += 512;

      // Check if this is our .mmdb file
      if (filename.endsWith('.mmdb')) {
        return tarData.subarray(offset, offset + size);
      }

      // Move to next file (size rounded up to 512-byte boundary)
      offset += Math.ceil(size / 512) * 512;
    }

    return null;
  }

  /**
   * Load the database into memory
   */
  private async loadDatabase(): Promise<void> {
    if (!fs.existsSync(this.dbPath)) {
      logger.warn('GeoIP database file not found');
      return;
    }

    try {
      this.reader = await Reader.open(this.dbPath);
      logger.info('GeoIP database loaded successfully');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error(`Failed to load GeoIP database: ${message}`);
      this.reader = null;
    }
  }

  /**
   * Lookup an IP address and return GeoIP information
   */
  async lookup(ip: string): Promise<GeoIPInfo | null> {
    if (!this.reader) {
      return null;
    }

    // Skip private/local IPs
    if (this.isPrivateIP(ip)) {
      logger.debug(`Skipping private IP: ${ip}`);
      return null;
    }

    try {
      const response: City = this.reader.city(ip);

      return {
        country: response.country?.names?.en || 'Unknown',
        region: response.subdivisions?.[0]?.names?.en || 'Unknown',
        city: response.city?.names?.en || 'Unknown',
        latitude: response.location?.latitude || 0,
        longitude: response.location?.longitude || 0,
      };
    } catch (error) {
      // AddressNotFoundError is expected for some IPs
      const message = error instanceof Error ? error.message : 'Unknown error';
      if (!message.includes('AddressNotFoundError') && !message.includes('not found')) {
        logger.debug(`GeoIP lookup failed for ${ip}: ${message}`);
      }
      return null;
    }
  }

  /**
   * Check if an IP address is private/local
   */
  private isPrivateIP(ip: string): boolean {
    // IPv4 private ranges
    const privateRanges = [
      /^10\./,
      /^172\.(1[6-9]|2[0-9]|3[0-1])\./,
      /^192\.168\./,
      /^127\./,
      /^0\./,
      /^169\.254\./, // Link-local
      /^224\./, // Multicast
      /^255\./, // Broadcast
    ];

    // IPv6 private ranges
    const privateIPv6Ranges = [
      /^::1$/, // Loopback
      /^fe80:/i, // Link-local
      /^fc00:/i, // Unique local
      /^fd00:/i, // Unique local
    ];

    for (const range of privateRanges) {
      if (range.test(ip)) {
        return true;
      }
    }

    for (const range of privateIPv6Ranges) {
      if (range.test(ip)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Get a lookup function that can be passed to plugins
   */
  getLookupFunction(): ((ip: string) => Promise<GeoIPInfo | null>) | undefined {
    if (!this.config.enabled || !this.reader) {
      return undefined;
    }
    return this.lookup.bind(this);
  }

  /**
   * Check if the handler is ready for lookups
   */
  isReady(): boolean {
    return this.reader !== null;
  }

  /**
   * Shutdown and release resources
   */
  async shutdown(): Promise<void> {
    this.reader = null;
    logger.info('GeoIP handler shutdown');
  }
}

// Factory function for creating a GeoIP handler
export function createGeoIPHandler(config: GeoIPConfig): GeoIPHandler {
  return new GeoIPHandler(config);
}
