/**
 * Tunable knobs for the subway track-matcher.
 *
 * These are SEED values picked by hand. They MUST be calibrated against real
 * labeled data (15-25 confirmed subway trips + ~15 negatives) before exposing
 * the matched mode in the user UI. Run `scripts/calibrate-subway-matcher.ts`
 * to grid-search for better weights/thresholds.
 *
 * Env overrides: any field can be set via `SUBWAY_MATCH_<UPPER_SNAKE>=…` for
 * per-deploy tuning without code changes (handy during calibration).
 */

function envNumber(key: string, fallback: number): number {
  const raw = process.env[key];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export const subwayMatchConfig = {
  /** Buffer (m) around line geometry for coverage/intersection. ~platform width. */
  coverageBufferMeters: envNumber("SUBWAY_MATCH_COVERAGE_BUFFER_M", 40),

  /** Max candidate lines to fully score per segment. */
  candidateLimit: envNumber("SUBWAY_MATCH_CANDIDATE_LIMIT", 5),

  /** Drop segments shorter than this — too little data for a confident match. */
  minSegmentLengthMeters: envNumber("SUBWAY_MATCH_MIN_SEG_M", 500),

  /** Drop segments with fewer points than this. */
  minSegmentPoints: envNumber("SUBWAY_MATCH_MIN_SEG_POINTS", 10),

  /** Below this overlap fraction the line is rejected outright. */
  minCoverageRatio: envNumber("SUBWAY_MATCH_MIN_COVERAGE", 0.5),

  /** Acceptance threshold for total weighted score. */
  minTotalConfidence: envNumber("SUBWAY_MATCH_MIN_TOTAL", 0.55),

  /** Score weights (must conceptually sum to ~1, but we just compute weighted total). */
  weights: {
    coverage: envNumber("SUBWAY_MATCH_W_COVERAGE", 0.45),
    speed: envNumber("SUBWAY_MATCH_W_SPEED", 0.2),
    gap: envNumber("SUBWAY_MATCH_W_GAP", 0.15),
    station: envNumber("SUBWAY_MATCH_W_STATION", 0.2),
  },

  /** Speed profile (km/h). Outside [min, hardMax] → score 0. */
  speed: {
    minKmh: envNumber("SUBWAY_MATCH_SPEED_MIN", 30),
    /** Sweet spot center for subway average speed. */
    sweetMinKmh: envNumber("SUBWAY_MATCH_SPEED_SWEET_MIN", 15),
    sweetMaxKmh: envNumber("SUBWAY_MATCH_SPEED_SWEET_MAX", 55),
    /** Sustained speeds above this incur penalty (look like cars/trains). */
    hardMaxKmh: envNumber("SUBWAY_MATCH_SPEED_HARD_MAX", 90),
  },

  /** GPS gap heuristic: %time-gap > 30s in window for tunneled (subway) ride. */
  gap: {
    /** Per-point gap threshold above which we count it as "underground". */
    thresholdSeconds: envNumber("SUBWAY_MATCH_GAP_THRESH_S", 30),
    /** Sweet spot fraction of points with gap above threshold. */
    sweetMinFrac: envNumber("SUBWAY_MATCH_GAP_FRAC_MIN", 0.15),
    sweetMaxFrac: envNumber("SUBWAY_MATCH_GAP_FRAC_MAX", 0.4),
  },

  /** Station endpoint proximity (m) — segment start/end inside this radius of a line-station counts. */
  stationProximityMeters: envNumber("SUBWAY_MATCH_STATION_RADIUS_M", 150),

  /** Case A: segment-internal transfer detection. */
  splitCase: {
    /** Both top-2 candidates must clear this coverage to even consider splitting. */
    minSecondaryCoverage: envNumber("SUBWAY_MATCH_SPLIT_MIN_COV", 0.35),
    /** Require N consecutive points on the secondary line after switch to commit a split. */
    minRunLength: envNumber("SUBWAY_MATCH_SPLIT_RUN", 5),
  },

  /** Case B: cross-segment session grouping. */
  session: {
    /** Max gap between a session's leg end and next leg start (seconds). */
    maxGapSeconds: envNumber("SUBWAY_MATCH_SESSION_GAP_S", 8 * 60),
    /** Same-station radius for transfer judgement (m). */
    stationClusterRadiusMeters: envNumber("SUBWAY_MATCH_SESSION_STATION_RADIUS_M", 300),
  },
} as const;

export type SubwayMatchConfig = typeof subwayMatchConfig;

/** Modes that are eligible to be re-classified as 'subway'. */
export const ELIGIBLE_MODES_FOR_MATCHING = [
  "driving",
  "train",
  "unknown",
  "cycling",
] as const;
