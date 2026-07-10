// Raw Withings API payload shapes + parsed domain shapes + error classes.
// Withings wraps every response in an envelope: { status, body }. status 0 means
// success; any non-zero status is an error (see withings.ts for the taxonomy).

export interface WithingsEnvelope<T> {
  status: number;
  body?: T;
  error?: string;
}

export interface WithingsTokenBody {
  userid: number | string;
  access_token: string;
  refresh_token: string;
  scope: string;
  expires_in: number;
  token_type: string;
}

export interface WithingsMeasure {
  /** Integer mantissa. Real value = value * 10^unit. */
  value: number;
  /** Measure type code (1 = weight, 6 = fat ratio, …). */
  type: number;
  /** Power-of-ten exponent applied to `value`. */
  unit: number;
}

export interface WithingsMeasureGroup {
  grpid: number;
  /** Measurement time, unix seconds. */
  date: number;
  created?: number;
  /** 1 = real measure, 2 = user objective. We only persist category 1. */
  category: number;
  attrib?: number;
  measures: WithingsMeasure[];
}

export interface WithingsMeasureBody {
  /** New incremental-sync watermark (unix seconds). */
  updatetime: number;
  timezone?: string;
  measuregrps: WithingsMeasureGroup[];
  /** 1 (or true) when more pages remain. */
  more?: number | boolean;
  /** Cursor to pass as `offset` on the next page. */
  offset?: number;
}

/** Typed body-composition columns we persist (subset of all Withings metrics). */
export const BODY_METRIC_COLUMNS = [
  "weightKg",
  "fatMassKg",
  "fatFreeMassKg",
  "muscleMassKg",
  "boneMassKg",
  "hydrationKg",
  "fatRatioPct",
  "heartRateBpm",
  "visceralFat",
  "bmrKcal",
  "metabolicAge",
] as const;

export type BodyMetricColumn = (typeof BODY_METRIC_COLUMNS)[number];

export interface ParsedTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
  scope: string;
  withingsUserId: string;
}

export interface ParsedMeasureGroup {
  groupId: number;
  measuredAt: Date;
  category: number;
  metrics: Partial<Record<BodyMetricColumn, number>>;
  /** Original measure array, stored losslessly in body_measurements.rawMeasures. */
  raw: WithingsMeasure[];
}

/** Auth/token failure — the caller should refresh (or, if from a refresh call, re-link). */
export class WithingsAuthError extends Error {
  constructor(
    message: string,
    public status: number
  ) {
    super(message);
    this.name = "WithingsAuthError";
  }
}

/** Any other non-zero Withings status (invalid params, server error, rate limit exhausted). */
export class WithingsApiError extends Error {
  constructor(
    message: string,
    public status: number
  ) {
    super(message);
    this.name = "WithingsApiError";
  }
}
