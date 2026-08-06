/**
 * Calibrate the stay thresholds that drive track splitting.
 *
 * Usage:
 *   npx tsx scripts/calibrate-track-splitting.ts <userId> [fromDate] [toDate]
 *   npx tsx scripts/calibrate-track-splitting.ts d3f1... 2026-02-01 2026-08-06
 *
 * The script does NOT modify any config — it prints a grid so the winning
 * values can be written into DEFAULT_STAY_OPTIONS in
 * src/modules/location/services/stay-detector.ts by hand. Re-run the location
 * backfill afterwards to relabel historical tracks.
 *
 * Headline metric is stationaryShare: before this change, `stationary`
 * accounted for 190 of 487 transportation segments (39%). Tracks are supposed
 * to be movement, so a correct configuration drives that share down.
 */

import { argv, exit } from "node:process";
import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.local" });

// Scripts use relative imports, not the "@/" alias — match the existing
// scripts/calibrate-subway-matcher.ts and scripts/backfill-location-heatmaps.ts.
import { and, asc, eq, gte, isNull, lt, lte, or } from "drizzle-orm";
import { getDb, getPool, locationPoints } from "../src/db";
import { endOfLocalDay, startOfLocalDay } from "../src/lib/utils";
import { buildTracks, type TrackPoint } from "../src/modules/location/services/track-builder";
import { detectTransportModes } from "../src/modules/location/services/transportation/detector";

const RADII_M = [30, 40, 50, 60, 80, 100];
const MIN_DURATIONS_SEC = [300, 450, 600, 900, 1200];

function dateRange(from: string, to: string): string[] {
  const dates: string[] = [];
  const cursor = new Date(`${from}T00:00:00`);
  const end = new Date(`${to}T00:00:00`);
  while (cursor <= end) {
    dates.push(
      `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}-${String(
        cursor.getDate()
      ).padStart(2, "0")}`
    );
    cursor.setDate(cursor.getDate() + 1);
  }
  return dates;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

async function main() {
  const [userId, from = "2026-02-01", to = "2026-08-06"] = argv.slice(2);
  if (!userId) {
    console.error("usage: npx tsx scripts/calibrate-track-splitting.ts <userId> [from] [to]");
    exit(1);
  }

  const db = getDb();
  const dates = dateRange(from, to);

  // Load every day's points once; the grid search is pure computation on top.
  const pointsByDate = new Map<string, TrackPoint[]>();
  for (const date of dates) {
    const rows = await db
      .select({
        lat: locationPoints.lat,
        lon: locationPoints.lon,
        altitude: locationPoints.altitude,
        velocity: locationPoints.velocity,
        timestamp: locationPoints.timestamp,
      })
      .from(locationPoints)
      .where(
        and(
          eq(locationPoints.userId, userId),
          gte(locationPoints.timestamp, startOfLocalDay(date)),
          lt(locationPoints.timestamp, endOfLocalDay(date)),
          or(isNull(locationPoints.accuracy), lte(locationPoints.accuracy, 200)),
          or(isNull(locationPoints.anomaly), eq(locationPoints.anomaly, false))
        )
      )
      .orderBy(asc(locationPoints.timestamp));

    if (rows.length > 0) pointsByDate.set(date, rows);
  }

  console.log(`days with points: ${pointsByDate.size} (${from} … ${to})\n`);
  console.log(
    ["radiusM", "minDurSec", "medTracks/day", "medTrackMin", "maxTrackH", "stationary%"].join("\t")
  );

  for (const radiusM of RADII_M) {
    for (const minDurationSec of MIN_DURATIONS_SEC) {
      const perDayCounts: number[] = [];
      const trackMinutes: number[] = [];
      let maxTrackHours = 0;
      let stationarySec = 0;
      let totalSegmentSec = 0;

      for (const dayPoints of pointsByDate.values()) {
        const tracks = buildTracks(dayPoints, { stay: { radiusM, minDurationSec } });
        perDayCounts.push(tracks.length);

        for (const track of tracks) {
          trackMinutes.push(track.durationSeconds / 60);
          maxTrackHours = Math.max(maxTrackHours, track.durationSeconds / 3600);

          for (const segment of detectTransportModes(track.points)) {
            totalSegmentSec += segment.durationSeconds;
            if (segment.mode === "stationary") stationarySec += segment.durationSeconds;
          }
        }
      }

      const stationaryPct = totalSegmentSec === 0 ? 0 : (stationarySec / totalSegmentSec) * 100;
      console.log(
        [
          radiusM,
          minDurationSec,
          median(perDayCounts),
          median(trackMinutes).toFixed(1),
          maxTrackHours.toFixed(1),
          stationaryPct.toFixed(1),
        ].join("\t")
      );
    }
  }

  await getPool().end();
}

main().catch(async (error) => {
  console.error(error);
  try {
    await getPool().end();
  } catch {}
  exit(1);
});
