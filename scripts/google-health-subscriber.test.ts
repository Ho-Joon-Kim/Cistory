import { describe, expect, it } from "vitest";
import { SYNCED_METRICS } from "../src/modules/health/service";
import { buildCreateBody, redactBody, WEBHOOK_DATA_TYPES } from "./google-health-subscriber";

describe("google-health-subscriber", () => {
  it("subscribes only to types the consumer can act on", () => {
    const handled = new Set([
      ...SYNCED_METRICS.map((m) => m.dataType),
      "weight", // early Withings sync trigger
    ]);
    for (const t of WEBHOOK_DATA_TYPES) expect(handled.has(t), t).toBe(true);
  });

  it("never subscribes to types Google documents as webhook-unsupported", () => {
    for (const t of [
      "oxygen-saturation",
      "vo2-max",
      "active-energy-burned",
      "daily-vo2-max",
      "core-body-temperature",
    ]) {
      expect(WEBHOOK_DATA_TYPES as readonly string[]).not.toContain(t);
    }
  });

  it("builds one AUTOMATIC config, honoring --exclude, and redacts the secret", () => {
    const body = buildCreateBody({
      endpoint: "https://x/api/fitbit/webhook",
      secret: "Bearer s3cret",
      exclude: ["total-calories"],
    });
    expect(body.subscriberConfigs).toHaveLength(1);
    expect(body.subscriberConfigs[0].subscriptionCreatePolicy).toBe("AUTOMATIC");
    expect(body.subscriberConfigs[0].dataTypes).not.toContain("total-calories");
    expect(body.subscriberConfigs[0].dataTypes).toContain("heart-rate");
    expect(JSON.stringify(redactBody(body))).not.toContain("s3cret");
  });
});
