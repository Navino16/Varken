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
const serverInfoDefault = { enabled: false, intervalSeconds: 300 };
const mediaServerSchedules = {
  status: ScheduleConfigSchema.default({ enabled: false, intervalSeconds: 300 }),
  history: ScheduleConfigSchema.default({ enabled: false, intervalSeconds: 300 }),
  inventory: ScheduleConfigSchema.default({ enabled: false, intervalSeconds: 3600 }),
  liveTv: ScheduleConfigSchema.default({ enabled: false, intervalSeconds: 300 }),
};
const servarrSchedules = {
  status: ScheduleConfigSchema.default({ enabled: false, intervalSeconds: 300 }),
  totals: ScheduleConfigSchema.default({ enabled: false, intervalSeconds: 900 }),
  history: ScheduleConfigSchema.default({ enabled: false, intervalSeconds: 300 }),
  library: ScheduleConfigDaysSchema.default(scheduleDaysDefault),
};

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
  serverInfo: ScheduleConfigSchema.default(serverInfoDefault),
  ...servarrSchedules,
});

export const RadarrConfigSchema = z.object({
  id: z.number(),
  url: z.url(),
  apiKey: z.string(),
  verifySsl: z.boolean().default(false),
  queue: ScheduleConfigSchema.default(scheduleDefault),
  missing: ScheduleConfigSchema.default(scheduleDefault),
  serverInfo: ScheduleConfigSchema.default(serverInfoDefault),
  ...servarrSchedules,
});

export const ReadarrConfigSchema = z.object({
  id: z.number(),
  url: z.url(),
  apiKey: z.string(),
  verifySsl: z.boolean().default(false),
  queue: ScheduleConfigSchema.default(scheduleDefault),
  missing: ScheduleConfigSchema.default(scheduleDefault),
  serverInfo: ScheduleConfigSchema.default(serverInfoDefault),
  ...servarrSchedules,
});

export const LidarrConfigSchema = z.object({
  id: z.number(),
  url: z.url(),
  apiKey: z.string(),
  verifySsl: z.boolean().default(false),
  queue: ScheduleConfigSchema.default(scheduleDefault),
  missing: ScheduleConfigSchema.default(scheduleDefault),
  serverInfo: ScheduleConfigSchema.default(serverInfoDefault),
  ...servarrSchedules,
});

export const ProwlarrConfigSchema = z.object({
  id: z.number(),
  url: z.url(),
  apiKey: z.string(),
  verifySsl: z.boolean().default(false),
  indexerStats: ScheduleConfigSchema.default(scheduleDefault),
  serverInfo: ScheduleConfigSchema.default(serverInfoDefault),
  status: ScheduleConfigSchema.default({ enabled: false, intervalSeconds: 300 }),
  history: ScheduleConfigSchema.default({ enabled: false, intervalSeconds: 300 }),
  inventory: ScheduleConfigSchema.default({ enabled: false, intervalSeconds: 3600 }),
});

export const BazarrConfigSchema = z.object({
  id: z.number(),
  url: z.url(),
  apiKey: z.string(),
  verifySsl: z.boolean().default(false),
  wanted: ScheduleConfigSchema.default(scheduleDefault),
  history: ScheduleConfigSchema.default(scheduleDefault),
  serverInfo: ScheduleConfigSchema.default(serverInfoDefault),
  status: ScheduleConfigSchema.default({ enabled: false, intervalSeconds: 300 }),
  stats: ScheduleConfigSchema.default({ enabled: false, intervalSeconds: 3600 }),
  library: ScheduleConfigDaysSchema.default(scheduleDaysDefault),
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
  serverInfo: ScheduleConfigSchema.default(serverInfoDefault),
  history: ScheduleConfigSchema.default({ enabled: false, intervalSeconds: 300 }),
  users: ScheduleConfigSchema.default({ enabled: false, intervalSeconds: 3600 }),
  libraryMedia: ScheduleConfigDaysSchema.default(scheduleDaysDefault),
});

export const PlexConfigSchema = z.object({
  id: z.number(),
  url: z.url(),
  token: z.string(),
  verifySsl: z.boolean().default(false),
  sessions: ScheduleConfigSchema.default(scheduleDefault),
  libraries: ScheduleConfigSchema.default(scheduleDefault),
  serverInfo: ScheduleConfigSchema.default(serverInfoDefault),
  ...mediaServerSchedules,
});

export const JellyfinConfigSchema = z.object({
  id: z.number(),
  url: z.url(),
  apiKey: z.string(),
  verifySsl: z.boolean().default(false),
  sessions: ScheduleConfigSchema.default(scheduleDefault),
  libraries: ScheduleConfigSchema.default(scheduleDefault),
  serverInfo: ScheduleConfigSchema.default(serverInfoDefault),
  ...mediaServerSchedules,
});

export const EmbyConfigSchema = z.object({
  id: z.number(),
  url: z.url(),
  apiKey: z.string(),
  verifySsl: z.boolean().default(false),
  sessions: ScheduleConfigSchema.default(scheduleDefault),
  libraries: ScheduleConfigSchema.default(scheduleDefault),
  serverInfo: ScheduleConfigSchema.default(serverInfoDefault),
  ...mediaServerSchedules,
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
  serverInfo: ScheduleConfigSchema.default(serverInfoDefault),
  totals: ScheduleConfigSchema.default({ enabled: false, intervalSeconds: 300 }),
  users: ScheduleConfigSchema.default({ enabled: false, intervalSeconds: 3600 }),
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
  serverInfo: ScheduleConfigSchema.default(serverInfoDefault),
  status: ScheduleConfigSchema.default({ enabled: false, intervalSeconds: 300 }),
  totals: ScheduleConfigSchema.default({ enabled: false, intervalSeconds: 300 }),
  users: ScheduleConfigSchema.default({ enabled: false, intervalSeconds: 3600 }),
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
  /** TTL for the generic HTTP GET cache in seconds. 0 or omitted = dedup only, no TTL caching. */
  cacheTtlSeconds: z.number().min(0).optional(),
  /** Varken's own health written to the outputs (measurement `Varken`) */
  selfMetrics: z
    .object({
      enabled: z.boolean().default(true),
      intervalSeconds: z.number().min(10).default(60),
    })
    .default({ enabled: true, intervalSeconds: 60 }),
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
    selfMetrics: { enabled: true, intervalSeconds: 60 },
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
