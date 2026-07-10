/**
 * THROWAWAY U1 spike probe — NOT product code.
 * See docs/plans/2026-07-10-002-feat-fitbit-google-health-integration-plan.md (U1).
 *
 * Confirms, against the real Google account, the things U1 is meant to de-risk
 * before the sync engine (U5) is built:
 *   - Google Health API returns data server-side (REST, not on-device).
 *   - Which candidate metrics are actually populated for this Fitbit Air account.
 *   - Each metric's VALUE SHAPE (scalar float vs structured object) — this decides
 *     `value` vs `valueJson` in the U2 schema.
 *   - Whether a metric is total-shaped (needs `valueSum`) and whether it reports
 *     multiple contributing data sources (drives list-vs-reconcile, Open Questions).
 *   - dailyRollUp span behaviour, intraday pageSize/nextPageToken, retention floor.
 *   - Refresh-token durability under Production-unverified: a single refresh at T+0
 *     canNOT prove the 7-day Testing cap is gone (it succeeds either way), so this
 *     script stores the refresh token and a `--refresh` run at T+8 days proves it.
 *
 * SETUP (all in the GCP console — this is part of U1):
 *   1. Enable health.googleapis.com on the project.
 *   2. Rotate the client_secret (the one committed earlier to the repo) and put the
 *      new value in .env as FITBIT_CLIENT_SECRET. [R11]
 *   3. OAuth consent screen → switch publishing status to "In Production" (leaving
 *      it Unverified is fine for ≤100 users). This is what removes the 7-day cap.
 *   4. On the web OAuth client, add this Authorized redirect URI:
 *          http://localhost:53682/oauth2callback
 *   5. Confirm the exact readonly scope strings under "Data access" and reconcile
 *      them with SCOPES below — the values here are best-known candidates, and
 *      confirming them IS part of the spike. If authorize returns invalid_scope,
 *      fix SCOPES and re-run.
 *
 * RUN:
 *   yarn tsx scripts/probe-google-health.ts            # first connect + probe
 *   yarn tsx scripts/probe-google-health.ts --refresh  # ~8 days later: durability
 *
 * The refresh token is written to .google-health-spike-tokens.json (gitignored).
 * Findings are appended to docs/health/google-health-spike-findings.md.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { Agent, fetch as undiciFetch } from "undici";

// ── Config ────────────────────────────────────────────────────────────────────

const REDIRECT_PORT = 53682;
const REDIRECT_URI = `http://localhost:${REDIRECT_PORT}/oauth2callback`;
const TOKEN_STORE = resolve(process.cwd(), ".google-health-spike-tokens.json");
const FINDINGS_DOC = resolve(process.cwd(), "docs/health/google-health-spike-findings.md");

const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const HEALTH_BASE = "https://health.googleapis.com/v4";

// Google Health API readonly scopes (verified against developers.google.com/health/scopes).
// The API groups data into broad CATEGORY scopes (not per-metric). These three cover
// every dataType below; all Google Health scopes are Restricted. If a dataType 403s,
// it needs a scope not requested here (e.g. ecg / irn) — the probe records that.
const SCOPES = [
  "https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly",
  "https://www.googleapis.com/auth/googlehealth.sleep.readonly",
  "https://www.googleapis.com/auth/googlehealth.health_metrics_and_measurements.readonly",
];

// dataType path segments (users/me/dataTypes/{dataType}/dataPoints) — verified
// against the API dataType list. Which ones actually return data for a Fitbit Air
// is exactly what this probe discovers (404/empty = not produced by this device).
// Note: there is no respiratory-rate dataType, and `readiness` is not a Google
// Health dataType (both dropped from the earlier guess).
const DATA_TYPES = [
  // activity_and_fitness
  "steps",
  "distance",
  "active-zone-minutes",
  "active-energy-burned",
  "total-calories",
  "exercise",
  "vo2-max",
  "run-vo2-max",
  // health_metrics_and_measurements
  "heart-rate",
  "daily-resting-heart-rate",
  "heart-rate-variability",
  "daily-heart-rate-variability",
  "oxygen-saturation",
  "daily-oxygen-saturation",
  "core-body-temperature",
  // sleep
  "sleep",
  "daily-sleep-temperature-derivations",
];

// Force IPv4 — dev host has a dead-IPv6 black hole to dual-stack googleapis hosts
// (see user memory project_dev_host_ipv6_blackhole). Same fix the Withings adapter uses.
const ipv4 = new Agent({ connect: { family: 4 } });

// ── Tiny env loader (.env then .env.local; no dependency on the app) ────────────

function loadEnv(): { clientId: string; clientSecret: string } {
  const merged: Record<string, string> = {};
  for (const file of [".env", ".env.local"]) {
    try {
      const text = readFileSync(resolve(process.cwd(), file), "utf8");
      for (const line of text.split("\n")) {
        const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
        if (m) merged[m[1]] = m[2].replace(/^["']|["']$/g, "");
      }
    } catch {
      // file may not exist; ignore
    }
  }
  const clientId = process.env.FITBIT_CLIENT_ID || merged.FITBIT_CLIENT_ID || "";
  const clientSecret = process.env.FITBIT_CLIENT_SECRET || merged.FITBIT_CLIENT_SECRET || "";
  if (!clientId || !clientSecret) {
    throw new Error("FITBIT_CLIENT_ID / FITBIT_CLIENT_SECRET not found in env / .env / .env.local");
  }
  return { clientId, clientSecret };
}

// ── OAuth ───────────────────────────────────────────────────────────────────

function buildAuthorizeUrl(clientId: string): string {
  const url = new URL(AUTH_ENDPOINT);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", REDIRECT_URI);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", SCOPES.join(" "));
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent"); // force a refresh token every time
  url.searchParams.set("include_granted_scopes", "true");
  return url.toString();
}

/** Wait for Google to redirect to the loopback and hand back `code`. */
function waitForCode(): Promise<string> {
  return new Promise((resolveCode, rejectCode) => {
    const server = createServer((req, res) => {
      const reqUrl = new URL(req.url ?? "/", REDIRECT_URI);
      if (reqUrl.pathname !== "/oauth2callback") {
        res.writeHead(404).end();
        return;
      }
      const code = reqUrl.searchParams.get("code");
      const err = reqUrl.searchParams.get("error");
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(
        `<html><body style="font-family:sans-serif;padding:2rem"><h2>${
          code ? "✅ 코드 수신 완료 — 터미널로 돌아가세요" : `❌ 실패: ${err}`
        }</h2></body></html>`
      );
      server.close();
      if (code) resolveCode(code);
      else rejectCode(new Error(`authorize failed: ${err}`));
    });
    server.listen(REDIRECT_PORT, () => {
      console.log(`\n▶ Listening on ${REDIRECT_URI}`);
    });
  });
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope?: string;
  token_type: string;
}

async function postToken(params: Record<string, string>): Promise<TokenResponse> {
  const res = await undiciFetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params).toString(),
    dispatcher: ipv4,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`token endpoint ${res.status}: ${text}`);
  return JSON.parse(text) as TokenResponse;
}

// ── Health data probe ─────────────────────────────────────────────────────────

interface ProbeResult {
  dataType: string;
  listStatus: number;
  listSnippet: string;
  rollupStatus: number;
  rollupSnippet: string;
}

async function probeDataType(dataType: string, accessToken: string): Promise<ProbeResult> {
  const auth = { authorization: `Bearer ${accessToken}` };
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 3600 * 1000);

  // list (intraday). No startTime/endTime params exist — time filtering is the
  // AIP-160 `filter` param, whose field name is metric-specific. For a presence
  // probe we skip the filter and just pull the most recent points.
  const listUrl = new URL(`${HEALTH_BASE}/users/me/dataTypes/${dataType}/dataPoints`);
  listUrl.searchParams.set("pageSize", "5");
  const listRes = await undiciFetch(listUrl.toString(), { headers: auth, dispatcher: ipv4 });
  const listBody = await listRes.text();

  // dailyRollUp (custom method, POST). Body is `range: { start, end }` (closed-open
  // CivilDate interval) + windowSizeDays — NOT localDateRange.
  const rollupUrl = `${HEALTH_BASE}/users/me/dataTypes/${dataType}/dataPoints:dailyRollUp`;
  const rollupRes = await undiciFetch(rollupUrl, {
    method: "POST",
    headers: { ...auth, "content-type": "application/json" },
    body: JSON.stringify({
      range: { start: toLocalDate(weekAgo), end: toLocalDate(now) },
      windowSizeDays: 1,
    }),
    dispatcher: ipv4,
  });
  const rollupBody = await rollupRes.text();

  return {
    dataType,
    listStatus: listRes.status,
    listSnippet: listBody.slice(0, 600),
    rollupStatus: rollupRes.status,
    rollupSnippet: rollupBody.slice(0, 600),
  };
}

function toLocalDate(d: Date): { year: number; month: number; day: number } {
  return { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate() };
}

// ── Findings output ─────────────────────────────────────────────────────────

function appendFindings(header: string, lines: string[]): void {
  const stamp = new Date().toISOString();
  const block = [`\n---\n\n## Probe run @ ${stamp}\n`, `**${header}**\n`, ...lines, ""].join("\n");
  let existing = "";
  try {
    existing = readFileSync(FINDINGS_DOC, "utf8");
  } catch {
    // scaffold not present yet; the doc is created by U1 setup — create minimal head
    existing = "# Google Health API — U1 spike findings\n";
  }
  writeFileSync(FINDINGS_DOC, existing + block);
  console.log(`\n📝 Findings appended → ${FINDINGS_DOC}`);
}

// ── Modes ─────────────────────────────────────────────────────────────────────

async function runConnect(): Promise<void> {
  const { clientId, clientSecret } = loadEnv();
  const authorizeUrl = buildAuthorizeUrl(clientId);

  console.log(
    `\n1) Open this URL, approve (click through the Unverified-app warning):\n\n${authorizeUrl}\n`
  );

  const code = await waitForCode();
  console.log("2) Code received — exchanging for tokens…");

  const tokens = await postToken({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: REDIRECT_URI,
    grant_type: "authorization_code",
  });

  if (!tokens.refresh_token) {
    throw new Error(
      "No refresh_token in response — ensure access_type=offline + prompt=consent and the account hasn't already granted (revoke at myaccount.google.com and retry)."
    );
  }

  writeFileSync(
    TOKEN_STORE,
    JSON.stringify(
      {
        refresh_token: tokens.refresh_token,
        scope: tokens.scope,
        connectedAt: new Date().toISOString(),
      },
      null,
      2
    )
  );
  console.log(`3) Refresh token stored → ${TOKEN_STORE}\n   Granted scope: ${tokens.scope}\n`);

  console.log("4) Probing metrics…\n");
  const results: ProbeResult[] = [];
  for (const dt of DATA_TYPES) {
    try {
      const r = await probeDataType(dt, tokens.access_token);
      results.push(r);
      console.log(`   ${dt}: list=${r.listStatus} rollup=${r.rollupStatus}`);
    } catch (e) {
      console.log(`   ${dt}: ERROR ${String(e)}`);
    }
  }

  const lines: string[] = [
    "| dataType | list HTTP | dailyRollUp HTTP |",
    "|---|---|---|",
    ...results.map((r) => `| \`${r.dataType}\` | ${r.listStatus} | ${r.rollupStatus} |`),
    "",
    "### Raw snippets (inspect value shape → decide `value` vs `valueJson`, total-vs-avg, multi-source)",
    ...results.flatMap((r) => [
      `\n#### \`${r.dataType}\``,
      "list:",
      "```json",
      r.listSnippet,
      "```",
      "dailyRollUp:",
      "```json",
      r.rollupSnippet,
      "```",
    ]),
  ];
  appendFindings(`Connect + probe. Granted scope: ${tokens.scope ?? "(none reported)"}`, lines);

  console.log(
    "\n✅ Connect probe done. Review the findings doc, fill in the shape/total/source columns,\n" +
      "   then re-run with --refresh in ~8 days to close the durability check."
  );
}

async function runRefresh(): Promise<void> {
  const { clientId, clientSecret } = loadEnv();
  let stored: { refresh_token: string; connectedAt?: string };
  try {
    stored = JSON.parse(readFileSync(TOKEN_STORE, "utf8"));
  } catch {
    throw new Error(
      `No stored token at ${TOKEN_STORE} — run the connect flow first (no --refresh).`
    );
  }

  const ageDays = stored.connectedAt
    ? (Date.now() - new Date(stored.connectedAt).getTime()) / 86_400_000
    : NaN;

  try {
    const tokens = await postToken({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: stored.refresh_token,
      grant_type: "refresh_token",
    });
    const rotated = !!tokens.refresh_token && tokens.refresh_token !== stored.refresh_token;
    const verdict =
      Number.isFinite(ageDays) && ageDays > 7
        ? "DURABLE (survived past day 7 ✅)"
        : "inconclusive (age ≤ 7d)";
    appendFindings(`Refresh recheck @ age ${ageDays.toFixed(1)}d → ${verdict}`, [
      `- refresh succeeded: access token len ${tokens.access_token.length}`,
      `- refresh token rotated: ${rotated} (Google normally does NOT rotate — expected false)`,
      `- token age: ${ageDays.toFixed(1)} days`,
    ]);
    console.log(`\n✅ Refresh OK at age ${ageDays.toFixed(1)}d → ${verdict}. Rotated: ${rotated}`);
  } catch (e) {
    appendFindings(`Refresh recheck @ age ${ageDays.toFixed(1)}d → FAILED`, [
      `- error: ${String(e)}`,
      "- If age > 7d and this is invalid_grant, Production-mode did NOT remove the 7-day cap — reconsider the token path.",
    ]);
    console.log(`\n❌ Refresh FAILED at age ${ageDays.toFixed(1)}d: ${String(e)}`);
    process.exitCode = 1;
  }
}

async function main(): Promise<void> {
  const mode = process.argv.includes("--refresh") ? "refresh" : "connect";
  if (mode === "refresh") await runRefresh();
  else await runConnect();
}

main().catch((e) => {
  console.error(`\n💥 ${e instanceof Error ? e.stack : String(e)}`);
  process.exitCode = 1;
});
