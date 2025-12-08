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

// =============================================================================
// Input Schemas - Arr Stack
// =============================================================================

export const SonarrConfigSchema = z.object({
  id: z.number(),
  url: z.string(),
  apiKey: z.string(),
  verifySsl: z.boolean().default(false),
  queue: ScheduleConfigSchema.default({}),
  calendar: z.object({
    enabled: z.boolean().default(false),
    futureDays: z.number().default(7),
    missingDays: z.number().default(30),
    intervalSeconds: z.number().default(300),
  }).default({}),
});

export const RadarrConfigSchema = z.object({
  id: z.number(),
  url: z.string(),
  apiKey: z.string(),
  verifySsl: z.boolean().default(false),
  queue: ScheduleConfigSchema.default({}),
  missing: ScheduleConfigSchema.default({}),
});

export const ReadarrConfigSchema = z.object({
  id: z.number(),
  url: z.string(),
  apiKey: z.string(),
  verifySsl: z.boolean().default(false),
  queue: ScheduleConfigSchema.default({}),
  missing: ScheduleConfigSchema.default({}),
});

export const LidarrConfigSchema = z.object({
  id: z.number(),
  url: z.string(),
  apiKey: z.string(),
  verifySsl: z.boolean().default(false),
  queue: ScheduleConfigSchema.default({}),
  missing: ScheduleConfigSchema.default({}),
});

export const ProwlarrConfigSchema = z.object({
  id: z.number(),
  url: z.string(),
  apiKey: z.string(),
  verifySsl: z.boolean().default(false),
  indexerStats: ScheduleConfigSchema.default({}),
});

export const BazarrConfigSchema = z.object({
  id: z.number(),
  url: z.string(),
  apiKey: z.string(),
  verifySsl: z.boolean().default(false),
  wanted: ScheduleConfigSchema.default({}),
  history: ScheduleConfigSchema.default({}),
});

// =============================================================================
// Input Schemas - Media Servers
// =============================================================================

export const TautulliConfigSchema = z.object({
  id: z.number(),
  url: z.string(),
  apiKey: z.string(),
  verifySsl: z.boolean().default(false),
  fallbackIp: z.string().optional(),
  activity: ScheduleConfigSchema.default({}),
  libraries: ScheduleConfigDaysSchema.default({}),
  stats: ScheduleConfigSchema.default({}),
  geoip: z.object({
    enabled: z.boolean().default(false),
    licenseKey: z.string().optional(),
  }).default({}),
});

export const PlexConfigSchema = z.object({
  id: z.number(),
  url: z.string(),
  token: z.string(),
  verifySsl: z.boolean().default(false),
  sessions: ScheduleConfigSchema.default({}),
  libraries: ScheduleConfigSchema.default({}),
});

export const JellyfinConfigSchema = z.object({
  id: z.number(),
  url: z.string(),
  apiKey: z.string(),
  verifySsl: z.boolean().default(false),
  sessions: ScheduleConfigSchema.default({}),
  libraries: ScheduleConfigSchema.default({}),
});

export const EmbyConfigSchema = z.object({
  id: z.number(),
  url: z.string(),
  apiKey: z.string(),
  verifySsl: z.boolean().default(false),
  sessions: ScheduleConfigSchema.default({}),
  libraries: ScheduleConfigSchema.default({}),
});

// =============================================================================
// Input Schemas - Request Management
// =============================================================================

export const OmbiConfigSchema = z.object({
  id: z.number(),
  url: z.string(),
  apiKey: z.string(),
  verifySsl: z.boolean().default(false),
  requestCounts: ScheduleConfigSchema.default({}),
  issueCounts: ScheduleConfigSchema.default({}),
});

export const OverseerrConfigSchema = z.object({
  id: z.number(),
  url: z.string(),
  apiKey: z.string(),
  verifySsl: z.boolean().default(false),
  requestCounts: ScheduleConfigSchema.default({}),
  latestRequests: z.object({
    enabled: z.boolean().default(false),
    count: z.number().default(10),
    intervalSeconds: z.number().default(300),
  }).default({}),
});

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
  outputs: OutputsConfigSchema,
  inputs: InputsConfigSchema,
});

// Type exports
export type VarkenConfig = z.infer<typeof VarkenConfigSchema>;
export type OutputsConfig = z.infer<typeof OutputsConfigSchema>;
export type InputsConfig = z.infer<typeof InputsConfigSchema>;
