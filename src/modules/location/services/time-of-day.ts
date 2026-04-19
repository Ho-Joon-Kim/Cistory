/**
 * Time-of-Day Activity Analysis Service
 *
 * Inspired by Dawarich: app/services/insights/activity_heatmap_calculator.rb
 * Extended to combine location + commits + coding sessions into a unified 7×24 matrix.
 */

import { sql } from "drizzle-orm";
import { getDb } from "@/db";

// ── Types ─────────────────────────────────────────────────────────────────────

/** 7 rows (Sun=0..Sat=6) × 24 columns (0..23h) */
export type ActivityMatrix = number[][];

export interface TimeOfDayResult {
  /** Combined activity matrix [dow][hour] = count */
  activityMatrix: ActivityMatrix;
  /** Period distribution */
  timeOfDay: {
    night: number; // 0-5h
    morning: number; // 6-11h
    afternoon: number; // 12-17h
    evening: number; // 18-23h
  };
  /** Streak stats */
  currentStreak: number;
  longestStreak: number;
}

// ── Queries ───────────────────────────────────────────────────────────────────

interface HourCount extends Record<string, unknown> {
  dow: number;
  hour: number;
  count: number;
}

async function getLocationActivity(
  db: ReturnType<typeof getDb>,
  userId: string,
  from: Date,
  to: Date
): Promise<HourCount[]> {
  const rows = await db.execute<HourCount>(sql`
    SELECT
      EXTRACT(DOW FROM timestamp AT TIME ZONE 'Asia/Seoul')::int AS dow,
      EXTRACT(HOUR FROM timestamp AT TIME ZONE 'Asia/Seoul')::int AS hour,
      COUNT(*)::int AS count
    FROM location_points
    WHERE user_id = ${userId}
      AND timestamp >= ${from} AND timestamp < ${to}
      AND (anomaly IS NOT TRUE)
    GROUP BY dow, hour
  `);
  return rows.rows;
}

async function getCommitActivity(
  db: ReturnType<typeof getDb>,
  userId: string,
  from: Date,
  to: Date
): Promise<HourCount[]> {
  const rows = await db.execute<HourCount>(sql`
    SELECT
      EXTRACT(DOW FROM committed_at AT TIME ZONE 'Asia/Seoul')::int AS dow,
      EXTRACT(HOUR FROM committed_at AT TIME ZONE 'Asia/Seoul')::int AS hour,
      COUNT(*)::int AS count
    FROM commits
    WHERE user_id = ${userId}
      AND committed_at >= ${from} AND committed_at < ${to}
    GROUP BY dow, hour
  `);
  return rows.rows;
}

async function getCodingActivity(
  db: ReturnType<typeof getDb>,
  userId: string,
  from: Date,
  to: Date
): Promise<HourCount[]> {
  const rows = await db.execute<HourCount>(sql`
    SELECT
      EXTRACT(DOW FROM started_at AT TIME ZONE 'Asia/Seoul')::int AS dow,
      EXTRACT(HOUR FROM started_at AT TIME ZONE 'Asia/Seoul')::int AS hour,
      COUNT(*)::int AS count
    FROM coding_sessions
    WHERE user_id = ${userId}
      AND started_at >= ${from} AND started_at < ${to}
    GROUP BY dow, hour
  `);
  return rows.rows;
}

// ── Streak Calculation ────────────────────────────────────────────────────────

async function calculateStreaks(
  db: ReturnType<typeof getDb>,
  userId: string,
  from: Date,
  to: Date
): Promise<{ current: number; longest: number }> {
  // Get distinct active dates from all sources
  const rows = await db.execute<{ active_date: string; [key: string]: unknown }>(sql`
    SELECT DISTINCT active_date FROM (
      SELECT to_char(timestamp AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD') AS active_date
      FROM location_points
      WHERE user_id = ${userId} AND timestamp >= ${from} AND timestamp < ${to}
        AND (anomaly IS NOT TRUE)
      UNION
      SELECT to_char(committed_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD') AS active_date
      FROM commits
      WHERE user_id = ${userId} AND committed_at >= ${from} AND committed_at < ${to}
      UNION
      SELECT to_char(started_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD') AS active_date
      FROM coding_sessions
      WHERE user_id = ${userId} AND started_at >= ${from} AND started_at < ${to}
    ) AS all_dates
    ORDER BY active_date
  `);

  const dates = rows.rows.map((r) => r.active_date);
  if (dates.length === 0) return { current: 0, longest: 0 };

  let longest = 1;
  let current = 1;

  for (let i = 1; i < dates.length; i++) {
    const prev = new Date(dates[i - 1]);
    const curr = new Date(dates[i]);
    const diffDays = (curr.getTime() - prev.getTime()) / (1000 * 60 * 60 * 24);

    if (diffDays === 1) {
      current++;
      if (current > longest) longest = current;
    } else {
      current = 1;
    }
  }

  return { current, longest };
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function getTimeOfDayAnalysis(
  userId: string,
  from: Date,
  to: Date
): Promise<TimeOfDayResult> {
  const db = getDb();

  // Run queries in parallel
  const [locationAct, commitAct, codingAct, streaks] = await Promise.all([
    getLocationActivity(db, userId, from, to),
    getCommitActivity(db, userId, from, to),
    getCodingActivity(db, userId, from, to),
    calculateStreaks(db, userId, from, to),
  ]);

  // Build 7×24 matrix
  const matrix: ActivityMatrix = Array.from({ length: 7 }, () => Array(24).fill(0));

  for (const source of [locationAct, commitAct, codingAct]) {
    for (const { dow, hour, count } of source) {
      matrix[dow][hour] += count;
    }
  }

  // Period distribution
  let night = 0;
  let morning = 0;
  let afternoon = 0;
  let evening = 0;

  for (let dow = 0; dow < 7; dow++) {
    for (let h = 0; h < 24; h++) {
      const v = matrix[dow][h];
      if (h < 6) night += v;
      else if (h < 12) morning += v;
      else if (h < 18) afternoon += v;
      else evening += v;
    }
  }

  const total = night + morning + afternoon + evening || 1;

  return {
    activityMatrix: matrix,
    timeOfDay: {
      night: Math.round((night / total) * 100),
      morning: Math.round((morning / total) * 100),
      afternoon: Math.round((afternoon / total) * 100),
      evening: Math.round((evening / total) * 100),
    },
    currentStreak: streaks.current,
    longestStreak: streaks.longest,
  };
}
