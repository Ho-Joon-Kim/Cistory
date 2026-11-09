import { describe, expect, it } from "vitest";
import {
  buildHealthScope,
  GOOGLE_HEALTH_DEFAULT_SCOPE,
  GOOGLE_HEALTH_OPTIONAL_SCOPES,
  hasHealthScope,
} from "@/lib/adapters/google-health/google-health";
import { ecgClassificationLabel, parseEcg, parseIrn, RHYTHM_CONFIGS } from "./rhythm";

const ecg = RHYTHM_CONFIGS.find((c) => c.key === "ecg")!;
const irn = RHYTHM_CONFIGS.find((c) => c.key === "irn")!;

describe("optional scopes", () => {
  it("adds only known optional scopes on top of the default set", () => {
    expect(buildHealthScope()).toBe(GOOGLE_HEALTH_DEFAULT_SCOPE);
    const scope = buildHealthScope(["ecg", "irn", "bogus"]);
    expect(scope.startsWith(GOOGLE_HEALTH_DEFAULT_SCOPE)).toBe(true);
    expect(scope).toContain(GOOGLE_HEALTH_OPTIONAL_SCOPES.ecg);
    expect(scope).toContain(GOOGLE_HEALTH_OPTIONAL_SCOPES.irn);
    expect(scope).not.toContain("bogus");
  });

  it("the default connect set never includes ECG/IRN", () => {
    expect(GOOGLE_HEALTH_DEFAULT_SCOPE).not.toContain("ecg");
    expect(GOOGLE_HEALTH_DEFAULT_SCOPE).not.toContain("irn");
  });

  it("reads grants from the stored scope string exactly (granular consent)", () => {
    const stored = `openid ${GOOGLE_HEALTH_OPTIONAL_SCOPES.irn}`;
    expect(hasHealthScope(stored, "irn")).toBe(true);
    expect(hasHealthScope(stored, "ecg")).toBe(false);
    expect(hasHealthScope(null, "ecg")).toBe(false);
    // A prefix of the scope must not count.
    expect(hasHealthScope("https://www.googleapis.com/auth/googlehealth.ecg", "ecg")).toBe(false);
  });
});

describe("parseEcg", () => {
  const point = {
    dataSource: { platform: "FITBIT" },
    electrocardiogram: {
      interval: { startTime: "2026-11-10T01:00:00Z", endTime: "2026-11-10T01:00:30Z" },
      resultClassification: "NORMAL_SINUS_RHYTHM",
      waveformSamples: [1, 2, 3, 4],
      beatsPerMinuteAvg: "72",
      samplingFrequencyHertz: 250,
      millivoltsScalingFactor: 0.001,
      leadNumber: 1,
      medicalDeviceInfo: { name: "x" },
    },
  };

  it("keeps the summary (bpm from the int64 string) and drops the waveform", () => {
    const s = parseEcg(ecg, point);
    expect(s?.value).toBe(72);
    expect(s?.sampleAt.toISOString()).toBe("2026-11-10T01:00:00.000Z");
    expect(s?.valueJson).toMatchObject({
      resultClassification: "NORMAL_SINUS_RHYTHM",
      samplingFrequencyHertz: 250,
      leadNumber: 1,
    });
    expect(JSON.stringify(s?.valueJson)).not.toContain("waveform");
  });

  it("tolerates a missing bpm and rejects a point without an interval", () => {
    expect(
      parseEcg(ecg, { electrocardiogram: { interval: { startTime: "2026-11-10T01:00:00Z" } } })
        ?.value
    ).toBeNull();
    expect(parseEcg(ecg, { electrocardiogram: { resultClassification: "UNREADABLE" } })).toBeNull();
    expect(parseEcg(ecg, {})).toBeNull();
  });
});

describe("parseIrn", () => {
  it("counts positive windows and never stores heartBeats", () => {
    const s = parseIrn(irn, {
      irregularRhythmNotification: {
        interval: { startTime: "2026-11-10T00:00:00Z", endTime: "2026-11-10T06:00:00Z" },
        alertWindows: [
          {
            startTime: "2026-11-10T01:00:00Z",
            endTime: "2026-11-10T01:30:00Z",
            positive: true,
            heartBeats: [{ physicalTime: "2026-11-10T01:00:01Z", beatsPerMinute: 130 }],
          },
          { startTime: "2026-11-10T02:00:00Z", endTime: "2026-11-10T02:30:00Z", positive: false },
        ],
      },
    });
    expect(s?.value).toBe(1);
    expect(s?.valueJson.alertWindows).toHaveLength(2);
    expect(JSON.stringify(s?.valueJson)).not.toContain("heartBeats");
    expect(JSON.stringify(s?.valueJson)).not.toContain("130");
  });

  it("accepts the alternate wrapper key and a missing window list", () => {
    const s = parseIrn(irn, {
      irregularRhythm: { interval: { startTime: "2026-11-10T00:00:00Z" } },
    });
    expect(s?.value).toBe(0);
  });
});

describe("ecgClassificationLabel", () => {
  it("relays the device classification in Korean, unknown values as 알 수 없음", () => {
    expect(ecgClassificationLabel("ATRIAL_FIBRILLATION")).toBe("심방세동 징후");
    expect(ecgClassificationLabel("SOMETHING_NEW")).toBe("알 수 없음");
    expect(ecgClassificationLabel(null)).toBe("알 수 없음");
  });
});
