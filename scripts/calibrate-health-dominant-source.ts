/**
 * READ-ONLY calibration of the health daily-summary dominant-source rule.
 *
 * `recomputeDailySummaries` (src/modules/health/service.ts) picks ONE source per
 * KST day (largest daily sum for steps) instead of summing overlapping sources.
 * This compares those stored daily step totals with Google's own
 * `dailyRollUp(steps, dataSourceFamily=google-wearables)` — the Fitbit-tracker-only
 * rollup — and prints the agreement rate plus every disagreeing day with a likely
 * cause. Use it to decide, from data, whether the dominant-source rule needs to
 * change (design: docs/superpowers/specs/2026-11-09-google-health-new-features-design.md §3).
 *
 * Expected shape (2026-11-09 spike): most days ours/wearables = 1.000; a day the
 * band wasn't worn shows ours >> wearables (the phone pedometer correctly won),
 * and a day with a late tracker upload shows ours < wearables.
 *
 * Guarantees: the DB session is `default_transaction_read_only = on`; the refresh
 * token is decrypted and exchanged IN MEMORY only (no token is printed or
 * written back); only the read-only `dailyRollUp` endpoint is called.
 *
 * RUN:
 *   DATABASE_URL=postgresql://… KIS_ENCRYPTION_KEY=… FITBIT_CLIENT_ID=… FITBIT_CLIENT_SECRET=… \
 *     npx tsx scripts/calibrate-health-dominant-source.ts [--days 30] [--user <uuid>]
 */

import { Client } from "pg";
import { createGoogleHealthAdapter } from "../src/lib/adapters/google-health/google-health";
import { decryptSecret } from "../src/lib/crypto";
import { shiftDateKey, toKstCalendarDate } from "../src/lib/date-key";

const MATCH_TOLERANCE = 0.01;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

function civil(key: string) {
  const [year, month, day] = key.split("-").map(Number);
  return { year, month, day };
}

export function classifyDay(ours: number | null, wearables: number | null): string {
  if (ours == null && wearables == null) return "no data";
  if (wearables == null || wearables === 0) return "no tracker data (band not worn?)";
  if (ours == null) return "missing in our summaries (sync gap)";
  const ratio = ours / wearables;
  if (Math.abs(ratio - 1) <= MATCH_TOLERANCE) return "match";
  return ratio > 1
    ? "ours higher (dominant source ≠ tracker — band off part of the day?)"
    : "ours lower (late tracker upload / stale summary?)";
}

async function main() {
  const days = Number(arg("days") ?? 30);
  const userArg = arg("user");
  const clientId = process.env.FITBIT_CLIENT_ID;
  const clientSecret = process.env.FITBIT_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("FITBIT_CLIENT_ID / FITBIT_CLIENT_SECRET unset");

  const db = new Client({
    connectionString:
      process.env.DATABASE_URL || "postgresql://cistory:cistory@localhost:5432/cistory",
  });
  await db.connect();
  try {
    await db.query("SET default_transaction_read_only = on");
    const { rows: conns } = await db.query<{ user_id: string; refresh_token_enc: string }>(
      `SELECT user_id, refresh_token_enc FROM health_connections
        WHERE status = 'active' ${userArg ? "AND user_id = $1" : ""} LIMIT 1`,
      userArg ? [userArg] : []
    );
    if (!conns[0]) throw new Error("no active health connection");
    const { user_id: userId } = conns[0];

    const adapter = createGoogleHealthAdapter(clientId, clientSecret);
    const { accessToken } = await adapter.refreshToken(decryptSecret(conns[0].refresh_token_enc));

    const today = toKstCalendarDate(new Date());
    const from = shiftDateKey(today, -days);
    const wearables = await fetchWearableSteps(adapter, accessToken, from, today);

    const { rows: ours } = await db.query<{ day: string; value_sum: number | null }>(
      `SELECT day, value_sum FROM health_daily_summaries
        WHERE user_id = $1 AND metric = 'steps' AND day >= $2 AND day < $3`,
      [userId, from, today]
    );
    report(days, from, today, new Map(ours.map((r) => [r.day, r.value_sum])), wearables);
  } finally {
    await db.end();
  }
}

type Adapter = ReturnType<typeof createGoogleHealthAdapter>;

/** Google's tracker-only daily steps over [from, to), keyed by civil day. */
async function fetchWearableSteps(
  adapter: Adapter,
  accessToken: string,
  from: string,
  to: string
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  let pageToken: string | undefined;
  do {
    const page = await adapter.dailyRollUp({
      accessToken,
      dataType: "steps",
      range: { start: civil(from), end: civil(to) },
      windowSizeDays: 1,
      dataSourceFamily: "google-wearables",
      pageToken,
    });
    for (const p of page.rollupDataPoints) {
      const d = (p.civilStartTime as { date?: { year: number; month: number; day: number } })?.date;
      const sum = Number((p.steps as { countSum?: unknown } | undefined)?.countSum);
      if (!d || !Number.isFinite(sum)) continue;
      out.set(
        `${d.year}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}`,
        sum
      );
    }
    pageToken = page.nextPageToken;
  } while (pageToken);
  return out;
}

/** Print the agreement rate and each disagreeing day — ratios only, never values. */
function report(
  days: number,
  from: string,
  to: string,
  ours: Map<string, number | null>,
  wearables: Map<string, number>
): void {
  let matched = 0;
  let compared = 0;
  const mismatches: string[] = [];
  for (let key = from; key < to; key = shiftDateKey(key, 1)) {
    const o = ours.get(key) ?? null;
    const w = wearables.get(key) ?? null;
    const verdict = classifyDay(o, w);
    if (verdict === "no data") continue;
    compared++;
    if (verdict === "match") {
      matched++;
      continue;
    }
    const ratio = o != null && w ? (o / w).toFixed(3) : "—";
    mismatches.push(`  ${key}  ours/wearables=${ratio}  ${verdict}`);
  }
  console.log(`steps, last ${days} KST days: ${matched}/${compared} days match (±1%)`);
  if (mismatches.length) console.log(`disagreeing days:\n${mismatches.join("\n")}`);
}

if (process.argv[1]?.endsWith("calibrate-health-dominant-source.ts")) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
