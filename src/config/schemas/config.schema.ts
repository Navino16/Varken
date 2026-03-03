import { z } from 'zod';

// =============================================================================
// Output Schemas
// =============================================================================

export const InfluxDB1ConfigSchema = z.object({
  url: z.string(),
  port: z.number().default(8086),
  username: z.string().default('root'),
  password: z.string().default('root'),
  database: z.string().default('varken'),
  ssl: z.boolean().default(false),
  verifySsl: z.boolean().default(false),
});

export const InfluxDB2ConfigSchema = z.object({
  url: z.string(),
  port: z.number().default(8086),
  token: z.string(),
  org: z.string().default('varken'),
  bucket: z.string().default('varken'),
  ssl: z.boolean().default(false),
  verifySsl: z.boolean().default(false),
});

export const VictoriaMetricsConfigSchema = z.object({
  url: z.string(),
  port: z.number().default(8428),
  ssl: z.boolean().default(false),
  verifySsl: z.boolean().default(false),
});

export const QuestDBConfigSchema = z.object({
  url: z.string(),
  port: z.number().default(9000),
  ssl: z.boolean().default(false),
  verifySsl: z.boolean().default(false),
});

export const TimescaleDBConfigSchema = z.object({
  host: z.string(),
  port: z.number().default(5432),
  database: z.string().default('varken'),
  username: z.string(),
  password: z.string(),
  ssl: z.boolean().default(false),
});

// =============================================================================
// Common Input Schemas
// =============================================================================

const ScheduleConfigSchema = z.object({
  enabled: z.boolean().default(false),
  intervalSeconds: z.number().default(30),
});

const ScheduleConfigDaysSchema = z.object({
  enabled: z.boolean().default(false),
  intervalDays: z.number().default(1),
});

// Default values for reuse
const scheduleDefault = { enabled: false, intervalSeconds: 30 };
const scheduleDaysDefault = { enabled: false, intervalDays: 1 };

// =============================================================================
// Input Schemas - Arr Stack
// =============================================================================

export const SonarrConfigSchema = z.object({
  id: z.number(),
  url: z.url(),
  apiKey: z.string(),
  verifySsl: z.boolean().default(false),
  queue: ScheduleConfigSchema.default(scheduleDefault),
  calendar: z.object({
    enabled: z.boolean().default(false),
    futureDays: z.number().default(7),
    missingDays: z.number().default(30),
    intervalSeconds: z.number().default(300),
  }).default({ enabled: false, futureDays: 7, missingDays: 30, intervalSeconds: 300 }),
});

export const RadarrConfigSchema = z.object({
  id: z.number(),
  url: z.url(),
  apiKey: z.string(),
  verifySsl: z.boolean().default(false),
  queue: ScheduleConfigSchema.default(scheduleDefault),
  missing: ScheduleConfigSchema.default(scheduleDefault),
});

export const ReadarrConfigSchema = z.object({
  id: z.number(),
  url: z.url(),
  apiKey: z.string(),
  verifySsl: z.boolean().default(false),
  queue: ScheduleConfigSchema.default(scheduleDefault),
  missing: ScheduleConfigSchema.default(scheduleDefault),
});

export const LidarrConfigSchema = z.object({
  id: z.number(),
  url: z.url(),
  apiKey: z.string(),
  verifySsl: z.boolean().default(false),
  queue: ScheduleConfigSchema.default(scheduleDefault),
  missing: ScheduleConfigSchema.default(scheduleDefault),
});

export const ProwlarrConfigSchema = z.object({
  id: z.number(),
  url: z.url(),
  apiKey: z.string(),
  verifySsl: z.boolean().default(false),
  indexerStats: ScheduleConfigSchema.default(scheduleDefault),
});

export const BazarrConfigSchema = z.object({
  id: z.number(),
  url: z.url(),
  apiKey: z.string(),
  verifySsl: z.boolean().default(false),
  wanted: ScheduleConfigSchema.default(scheduleDefault),
  history: ScheduleConfigSchema.default(scheduleDefault),
});

// =============================================================================
// Input Schemas - Media Servers
// =============================================================================

export const TautulliConfigSchema = z.object({
  id: z.number(),
  url: z.url(),
  apiKey: z.string(),
  verifySsl: z.boolean().default(false),
  /** @deprecated Use geoip.localCoordinates instead */
  fallbackIp: z.string().optional(),
  activity: ScheduleConfigSchema.default(scheduleDefault),
  libraries: ScheduleConfigDaysSchema.default(scheduleDaysDefault),
  stats: ScheduleConfigSchema.default(scheduleDefault),
  geoip: z.object({
    enabled: z.boolean().default(false),
    /** @deprecated GeoIP is now handled by Tautulli API */
    licenseKey: z.string().optional(),
    localCoordinates: z.object({
      latitude: z.number(),
      longitude: z.number(),
    }).optional(),
  }).default({ enabled: false }),
});

export const PlexConfigSchema = z.object({
  id: z.number(),
  url: z.url(),
  token: z.string(),
  verifySsl: z.boolean().default(false),
  sessions: ScheduleConfigSchema.default(scheduleDefault),
  libraries: ScheduleConfigSchema.default(scheduleDefault),
});

export const JellyfinConfigSchema = z.object({
  id: z.number(),
  url: z.url(),
  apiKey: z.string(),
  verifySsl: z.boolean().default(false),
  sessions: ScheduleConfigSchema.default(scheduleDefault),
  libraries: ScheduleConfigSchema.default(scheduleDefault),
});

export const EmbyConfigSchema = z.object({
  id: z.number(),
  url: z.url(),
  apiKey: z.string(),
  verifySsl: z.boolean().default(false),
  sessions: ScheduleConfigSchema.default(scheduleDefault),
  libraries: ScheduleConfigSchema.default(scheduleDefault),
});

// =============================================================================
// Input Schemas - Request Management
// =============================================================================

export const OmbiConfigSchema = z.object({
  id: z.number(),
  url: z.url(),
  apiKey: z.string(),
  verifySsl: z.boolean().default(false),
  requestCounts: ScheduleConfigSchema.default(scheduleDefault),
  issueCounts: ScheduleConfigSchema.default(scheduleDefault),
});

export const OverseerrConfigSchema = z.object({
  id: z.number(),
  url: z.url(),
  apiKey: z.string(),
  verifySsl: z.boolean().default(false),
  requestCounts: ScheduleConfigSchema.default(scheduleDefault),
  latestRequests: z.object({
    enabled: z.boolean().default(false),
    count: z.number().default(10),
    intervalSeconds: z.number().default(300),
  }).default({ enabled: false, count: 10, intervalSeconds: 300 }),
});

// =============================================================================
// Global Configuration Schema
// =============================================================================

export const GlobalConfigSchema = z.object({
  /** HTTP request timeout in milliseconds */
  httpTimeoutMs: z.number().min(1000).default(30000),
  /** Health check timeout in milliseconds */
  healthCheckTimeoutMs: z.number().min(1000).default(5000),
  /** Collector execution timeout in milliseconds */
  collectorTimeoutMs: z.number().min(10000).default(60000),
  /** Page size for paginated API requests */
  paginationPageSize: z.number().min(10).max(1000).default(250),
  /** Maximum records to fetch in pagination (safety limit) */
  maxPaginationRecords: z.number().min(1000).default(10000),
});

// =============================================================================
// Circuit Breaker Schema
// =============================================================================

export const CircuitBreakerConfigSchema = z.object({
  /** Number of consecutive errors before disabling scheduler */
  maxConsecutiveErrors: z.number().min(1).default(10),
  /** Interval multiplier per failure */
  backoffMultiplier: z.number().min(1).default(2),
  /** Maximum interval cap in seconds */
  maxIntervalSeconds: z.number().min(1).default(600),
  /** Wait time before recovery attempt in seconds */
  cooldownSeconds: z.number().min(1).default(300),
  /** Number of successes needed to fully recover */
  recoverySuccesses: z.number().min(1).default(3),
}).refine(
  (data) => data.recoverySuccesses <= data.maxConsecutiveErrors,
  { message: 'recoverySuccesses must be less than or equal to maxConsecutiveErrors' }
);

// =============================================================================
// Main Config Schema
// =============================================================================

export const OutputsConfigSchema = z.object({
  influxdb1: InfluxDB1ConfigSchema.optional(),
  influxdb2: InfluxDB2ConfigSchema.optional(),
  victoriametrics: VictoriaMetricsConfigSchema.optional(),
  questdb: QuestDBConfigSchema.optional(),
  timescaledb: TimescaleDBConfigSchema.optional(),
}).refine(
  (data) => Object.values(data).some((v) => v !== undefined),
  { message: 'At least one output must be configured' }
);

export const InputsConfigSchema = z.object({
  sonarr: z.array(SonarrConfigSchema).optional(),
  radarr: z.array(RadarrConfigSchema).optional(),
  readarr: z.array(ReadarrConfigSchema).optional(),
  lidarr: z.array(LidarrConfigSchema).optional(),
  prowlarr: z.array(ProwlarrConfigSchema).optional(),
  bazarr: z.array(BazarrConfigSchema).optional(),
  tautulli: z.array(TautulliConfigSchema).optional(),
  plex: z.array(PlexConfigSchema).optional(),
  jellyfin: z.array(JellyfinConfigSchema).optional(),
  emby: z.array(EmbyConfigSchema).optional(),
  ombi: z.array(OmbiConfigSchema).optional(),
  overseerr: z.array(OverseerrConfigSchema).optional(),
}).refine(
  (data) => Object.values(data).some((v) => v !== undefined && v.length > 0),
  { message: 'At least one input must be configured' }
);

export const VarkenConfigSchema = z.object({
  global: GlobalConfigSchema.optional().transform((val) => val ?? {
    httpTimeoutMs: 30000,
    healthCheckTimeoutMs: 5000,
    collectorTimeoutMs: 60000,
    paginationPageSize: 250,
    maxPaginationRecords: 10000,
  }),
  outputs: OutputsConfigSchema,
  inputs: InputsConfigSchema,
  circuitBreaker: CircuitBreakerConfigSchema.optional(),
});

// Type exports
export type VarkenConfig = z.infer<typeof VarkenConfigSchema>;
export type GlobalConfig = z.infer<typeof GlobalConfigSchema>;
export type OutputsConfig = z.infer<typeof OutputsConfigSchema>;
export type InputsConfig = z.infer<typeof InputsConfigSchema>;
