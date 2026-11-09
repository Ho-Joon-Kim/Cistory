/**
 * Operator tool for the Google Health API webhook SUBSCRIBER (project-level, one-off).
 * Runs on an operator machine — never in a container. Credentials are the
 * operator's own gcloud login (cloud-platform scope); no service-account key is
 * stored anywhere (design decision 2).
 *
 *   npx tsx scripts/google-health-subscriber.ts list
 *   npx tsx scripts/google-health-subscriber.ts get    [--id cistory-prod]
 *   npx tsx scripts/google-health-subscriber.ts create [--id cistory-prod] [--exclude a,b] [--dry-run]
 *   npx tsx scripts/google-health-subscriber.ts delete [--id cistory-prod] --yes
 *
 * Env:
 *   GOOGLE_HEALTH_PROJECT_NUMBER   default 794779085130. Must be the project NUMBER —
 *                                  the project id (cistory-fitbit-track) answers 403.
 *   GOOGLE_HEALTH_ACCESS_TOKEN     optional; otherwise `gcloud auth print-access-token`
 *                                  (~/google-cloud-sdk/bin/gcloud or gcloud on PATH)
 *   GOOGLE_HEALTH_WEBHOOK_URL      create only; default https://cistory.hojoon.dev/api/fitbit/webhook
 *   GOOGLE_HEALTH_WEBHOOK_SECRET   create only; the exact Authorization value Google
 *                                  will send (e.g. "Bearer <32+ random bytes>"). Must
 *                                  match the web container's value. Never printed.
 *
 * `create` makes Google run the endpoint verification handshake synchronously
 * (authorized POST → 200, anonymous POST → 401), so the route must already be
 * deployed with the same secret, or the call fails with FAILED_PRECONDITION.
 */

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const API_BASE = "https://health.googleapis.com/v4";
export const DEFAULT_PROJECT_NUMBER = "794779085130";
export const DEFAULT_SUBSCRIBER_ID = "cistory-prod";
export const DEFAULT_ENDPOINT = "https://cistory.hojoon.dev/api/fitbit/webhook";

/**
 * Types we sync that the webhook table lists as supported (design §4a), plus
 * `heart-rate` (decision 4: subscribed despite the volume) and `weight` (decision
 * 4: an early-Withings-sync trigger). `total-calories` is listed inconsistently
 * by Google (release note yes, type table no) — if create rejects it, rerun with
 * `--exclude total-calories`. Not supported, hence absent: oxygen-saturation,
 * vo2-max, active-energy-burned, daily-vo2-max, core-body-temperature.
 */
export const WEBHOOK_DATA_TYPES = [
  "steps",
  "distance",
  "heart-rate",
  "active-zone-minutes",
  "heart-rate-variability",
  "daily-resting-heart-rate",
  "daily-heart-rate-variability",
  "daily-oxygen-saturation",
  "daily-respiratory-rate",
  "daily-sleep-temperature-derivations",
  "sleep",
  "exercise",
  "run-vo2-max",
  "blood-glucose",
  "floors",
  "total-calories",
  "weight",
] as const;

export function arg(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? undefined : argv[i + 1];
}

export function buildCreateBody(opts: { endpoint: string; secret: string; exclude: string[] }) {
  const dataTypes = WEBHOOK_DATA_TYPES.filter((t) => !opts.exclude.includes(t));
  return {
    endpointUri: opts.endpoint,
    subscriberConfigs: [{ dataTypes, subscriptionCreatePolicy: "AUTOMATIC" }],
    endpointAuthorization: { secret: opts.secret },
  };
}

/** Same body with the secret masked — for --dry-run and logs. */
export function redactBody(body: ReturnType<typeof buildCreateBody>) {
  return { ...body, endpointAuthorization: { secret: "<redacted>" } };
}

function accessToken(): string {
  if (process.env.GOOGLE_HEALTH_ACCESS_TOKEN) return process.env.GOOGLE_HEALTH_ACCESS_TOKEN;
  const bundled = join(homedir(), "google-cloud-sdk/bin/gcloud");
  const gcloud = existsSync(bundled) ? bundled : "gcloud";
  return execFileSync(gcloud, ["auth", "print-access-token"], { encoding: "utf8" }).trim();
}

async function call(method: string, url: string, project: string, body?: unknown) {
  const res = await fetch(url, {
    method,
    headers: {
      authorization: `Bearer ${accessToken()}`,
      "x-goog-user-project": project,
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(60_000),
  });
  const text = await res.text();
  let json: unknown = text;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    // leave as text
  }
  console.log(`HTTP ${res.status}`);
  console.log(JSON.stringify(json, null, 2));
  if (!res.ok) process.exitCode = 1;
}

async function main(argv: string[]) {
  const command = argv[0];
  const project = process.env.GOOGLE_HEALTH_PROJECT_NUMBER || DEFAULT_PROJECT_NUMBER;
  if (!/^\d+$/.test(project)) {
    throw new Error("GOOGLE_HEALTH_PROJECT_NUMBER must be the numeric project NUMBER");
  }
  const id = arg(argv, "id") ?? DEFAULT_SUBSCRIBER_ID;
  if (!/^[a-z]([a-z0-9-]{2,34}[a-z0-9])$/.test(id)) throw new Error(`invalid subscriber id ${id}`);
  const base = `${API_BASE}/projects/${project}/subscribers`;

  switch (command) {
    case "list":
      return call("GET", base, project);
    case "get":
      return call("GET", `${base}/${id}`, project);
    case "create": {
      const secret = process.env.GOOGLE_HEALTH_WEBHOOK_SECRET ?? "";
      const body = buildCreateBody({
        endpoint: process.env.GOOGLE_HEALTH_WEBHOOK_URL || DEFAULT_ENDPOINT,
        secret,
        exclude: (arg(argv, "exclude") ?? "").split(",").filter(Boolean),
      });
      if (argv.includes("--dry-run")) {
        console.log(`POST ${base}?subscriberId=${id}`);
        console.log(JSON.stringify(redactBody(body), null, 2));
        return;
      }
      if (secret.length < 32) {
        throw new Error("GOOGLE_HEALTH_WEBHOOK_SECRET must be set (≥ 32 chars, e.g. 'Bearer …')");
      }
      return call("POST", `${base}?subscriberId=${encodeURIComponent(id)}`, project, body);
    }
    case "delete":
      if (!argv.includes("--yes")) throw new Error("delete requires --yes");
      return call("DELETE", `${base}/${id}`, project);
    default:
      throw new Error("usage: google-health-subscriber.ts list|get|create|delete [--id <id>]");
  }
}

if (process.argv[1]?.endsWith("google-health-subscriber.ts")) {
  main(process.argv.slice(2)).catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
