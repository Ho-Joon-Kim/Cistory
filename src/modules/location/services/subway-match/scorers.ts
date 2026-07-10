import { subwayMatchConfig } from "./config";

export interface ScorerPoint {
  lat: number;
  lon: number;
  velocity: number | null; // km/h
  timestamp: Date;
}

/**
 * Score the speed profile of a candidate subway segment.
 * Returns 0..1: 1 = textbook subway pace, 0 = clearly not.
 *
 * Heuristics:
 *  - Average speed in [sweetMin, sweetMax] km/h → 1.0
 *  - Outside [min, hardMax] → 0
 *  - Sustained >hardMax → penalty (cars / express trains)
 */
export function scoreSpeedProfile(points: ScorerPoint[]): number {
  if (points.length < 2) return 0;

  const speedsKmh = points
    .map((p) => p.velocity)
    .filter((v): v is number => v !== null && Number.isFinite(v));

  // If GPS hardly reported velocity (underground), fall back to neutral.
  if (speedsKmh.length < 3) return 0.5;

  const max = Math.max(...speedsKmh);
  const avg = speedsKmh.reduce((acc, v) => acc + v, 0) / speedsKmh.length;
  const cfg = subwayMatchConfig.speed;

  if (max < cfg.minKmh) return 0;

  // Sustained-fast penalty: fraction of samples above hardMaxKmh.
  const fastFrac = speedsKmh.filter((v) => v > cfg.hardMaxKmh).length / speedsKmh.length;
  const penalty = Math.min(1, fastFrac * 4); // 25% over → max penalty
  if (penalty >= 1) return 0;

  // Sweet-spot triangular score.
  let coreScore: number;
  if (avg >= cfg.sweetMinKmh && avg <= cfg.sweetMaxKmh) {
    coreScore = 1;
  } else if (avg < cfg.sweetMinKmh) {
    coreScore = Math.max(0, avg / cfg.sweetMinKmh);
  } else {
    // avg > sweetMax
    const span = cfg.hardMaxKmh - cfg.sweetMaxKmh;
    coreScore = span <= 0 ? 0 : Math.max(0, 1 - (avg - cfg.sweetMaxKmh) / span);
  }

  return Math.max(0, coreScore - penalty);
}

/**
 * Fraction of consecutive-point time gaps above the threshold (seconds).
 * Underground subway segments typically have 15-40% gap rate (signal loss in tunnels).
 *
 * Returns 0..1:
 *  - sweetMin..sweetMax fraction → 1.0 (looks like subway)
 *  - Almost no gaps → 0.3 (looks like surface ride)
 *  - Mostly gaps → 0.5 (data sparse, neutral)
 */
export function scoreGpsGaps(points: ScorerPoint[]): number {
  if (points.length < 3) return 0.5;

  const cfg = subwayMatchConfig.gap;
  let gapCount = 0;
  let totalIntervals = 0;
  for (let i = 1; i < points.length; i++) {
    const ms = points[i].timestamp.getTime() - points[i - 1].timestamp.getTime();
    if (ms <= 0) continue;
    totalIntervals++;
    if (ms / 1000 > cfg.thresholdSeconds) gapCount++;
  }
  if (totalIntervals === 0) return 0.5;

  const frac = gapCount / totalIntervals;

  if (frac >= cfg.sweetMinFrac && frac <= cfg.sweetMaxFrac) return 1;
  if (frac < cfg.sweetMinFrac) {
    // Near-zero gaps → surface mode.
    return 0.3 + 0.7 * (frac / cfg.sweetMinFrac);
  }
  // frac > sweetMaxFrac: very sparse, ambiguous.
  if (frac >= 0.7) return 0.5;
  // Decay between sweetMaxFrac and 0.7.
  return Math.max(0.5, 1 - (frac - cfg.sweetMaxFrac) / (0.7 - cfg.sweetMaxFrac));
}
