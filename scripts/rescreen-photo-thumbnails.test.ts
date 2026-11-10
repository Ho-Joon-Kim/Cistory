import { drizzle } from "drizzle-orm/node-postgres";
import { describe, expect, it, vi } from "vitest";
import * as schema from "../src/db/schema";
import {
  ClassifierUnavailableError,
  type PhotoClassifier,
} from "../src/modules/proton/nsfw/classifier";
import { parseRescreenArgs, RESCREEN_BATCH, rescreenUser } from "./rescreen-photo-thumbnails";

const USER = "00000000-0000-0000-0000-0000000000aa";
const SAFE = { drawing: 0, hentai: 0, neutral: 1, porn: 0, sexy: 0 };
const NSFW = { drawing: 0, hentai: 0.1, neutral: 0.1, porn: 0.8, sexy: 0 };

type Row = [string, string, string | null, Buffer];

/** Serves the keyset select from `rows` (ordered by id) and records everything else. */
function fakeDb(rows: Row[]) {
  const queries: { text: string; values: unknown[] }[] = [];
  const client = {
    query: async (config: { text: string } | string, values?: unknown[]) => {
      const text = typeof config === "string" ? config : config.text;
      const params = values ?? [];
      queries.push({ text, values: params });
      if (/^select/i.test(text) && text.includes('"photo_thumbnails"')) {
        const cursor = params.find((v) => typeof v === "string" && v.startsWith("id-")) as
          | string
          | undefined;
        const page = rows.filter((r) => !cursor || r[0] > cursor).slice(0, RESCREEN_BATCH);
        return { rows: page, rowCount: page.length, fields: [] };
      }
      return { rows: [], rowCount: 0, fields: [] };
    },
  };
  return { db: drizzle({ client: client as never, schema }), queries };
}

function classifierFor(
  blockedFirstBytes: number[]
): PhotoClassifier & { classify: ReturnType<typeof vi.fn> } {
  return {
    modelVersion: "test-model",
    classify: vi.fn(async (jpeg: Uint8Array) =>
      blockedFirstBytes.includes(jpeg[0]) ? NSFW : SAFE
    ),
  };
}

const row = (n: number, byte: number): Row => [
  `id-${String(n).padStart(4, "0")}`,
  `node-${n}`,
  null,
  Buffer.from([byte, 1, 2]),
];
const writes = (q: { text: string }[]) => q.filter((x) => /^(insert|delete|update)/i.test(x.text));

describe("rescreenUser", () => {
  it("dry run reports would-block counts without writing", async () => {
    const { db, queries } = fakeDb([row(1, 1), row(2, 0xff), row(3, 1)]);
    const result = await rescreenUser(db as never, USER, classifierFor([0xff]), { dryRun: true });
    expect(result).toEqual({ scanned: 3, blocked: 1 });
    expect(writes(queries)).toEqual([]);
    expect(queries.some((q) => /begin/i.test(q.text))).toBe(false);
  });

  it("--apply blocks via the same delete-row + photo_blocks path and never logs bytes", async () => {
    const logs = [vi.spyOn(console, "log"), vi.spyOn(console, "error"), vi.spyOn(console, "warn")];
    const { db, queries } = fakeDb([row(1, 1), row(2, 0xff)]);
    const result = await rescreenUser(db as never, USER, classifierFor([0xff]), { dryRun: false });
    expect(result).toEqual({ scanned: 2, blocked: 1 });
    const w = writes(queries).map((q) => q.text.split(" ").slice(0, 3).join(" "));
    expect(w).toEqual(['delete from "photos"', 'insert into "photo_blocks"']);
    const block = queries.find((q) => /^insert into "photo_blocks"/i.test(q.text));
    expect(block?.values).toContain("node-2");
    expect(block?.values).toContain("test-model");
    for (const spy of logs) expect(spy).not.toHaveBeenCalled();
    expect(JSON.stringify(queries.flatMap((q) => q.values))).not.toMatch(/255,1,2/);
  });

  it("walks pages by keyset and writes one transaction per batch", async () => {
    const rows = Array.from({ length: RESCREEN_BATCH + 5 }, (_, i) => row(i + 1, 0xff));
    const { db, queries } = fakeDb(rows);
    const result = await rescreenUser(db as never, USER, classifierFor([0xff]), { dryRun: false });
    expect(result).toEqual({ scanned: RESCREEN_BATCH + 5, blocked: RESCREEN_BATCH + 5 });
    expect(queries.filter((q) => /^begin/i.test(q.text))).toHaveLength(2);
  });

  it("aborts without blocking when the classifier is unavailable", async () => {
    const { db, queries } = fakeDb([row(1, 1)]);
    const classifier: PhotoClassifier = {
      modelVersion: "m",
      classify: async () => {
        throw new ClassifierUnavailableError();
      },
    };
    await expect(rescreenUser(db as never, USER, classifier, { dryRun: false })).rejects.toThrow(
      ClassifierUnavailableError
    );
    expect(writes(queries)).toEqual([]);
  });
});

describe("parseRescreenArgs", () => {
  it("defaults to a dry run", () => {
    expect(parseRescreenArgs(["u1"])).toEqual({ userId: "u1", apply: false });
    expect(parseRescreenArgs(["u1", "--apply"])).toEqual({ userId: "u1", apply: true });
  });
  it("rejects typos and missing userId instead of writing", () => {
    for (const bad of [["u1", "--aply"], ["u1", "-apply"], [], ["--apply"], ["a", "b"]]) {
      expect(parseRescreenArgs(bad)).toHaveProperty("error");
    }
  });
});
