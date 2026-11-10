import { drizzle } from "drizzle-orm/node-postgres";
import { describe, expect, it, vi } from "vitest";
import * as schema from "../src/db/schema";
import {
  ClassifierUnavailableError,
  ClassifyInputError,
  type PhotoClassifier,
} from "../src/modules/proton/nsfw/classifier";
import { PROTON_ERRORS } from "../src/modules/proton/types";
import {
  parseRescreenArgs,
  RESCREEN_BATCH,
  RescreenLockedError,
  rescreenUser,
  withRescreenLock,
} from "./rescreen-photo-thumbnails";

const USER = "00000000-0000-0000-0000-0000000000aa";
const SAFE = { drawing: 0, hentai: 0, neutral: 1, porn: 0, sexy: 0 };
const NSFW = { drawing: 0, hentai: 0.1, neutral: 0.1, porn: 0.8, sexy: 0 };

type Row = [string, string, string | null, Buffer];

/** Serves the keyset select from `rows` (ordered by id) and records everything else. */
function fakeDb(rows: Row[], deleted: string[] = []) {
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
      if (/^delete from "photos"/i.test(text) && /returning/i.test(text)) {
        return { rows: deleted.map((d) => [d]), rowCount: deleted.length, fields: [] };
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
    expect(result).toEqual({ scanned: 3, blocked: 1, hidden: 0 });
    expect(writes(queries)).toEqual([]);
    expect(queries.some((q) => /begin/i.test(q.text))).toBe(false);
  });

  it("--apply blocks via the same delete-row + photo_blocks path and never logs bytes", async () => {
    const logs = [vi.spyOn(console, "log"), vi.spyOn(console, "error"), vi.spyOn(console, "warn")];
    const { db, queries } = fakeDb([row(1, 1), row(2, 0xff)]);
    const result = await rescreenUser(db as never, USER, classifierFor([0xff]), { dryRun: false });
    expect(result).toEqual({ scanned: 2, blocked: 1, hidden: 0 });
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
    expect(result).toEqual({ scanned: RESCREEN_BATCH + 5, blocked: RESCREEN_BATCH + 5, hidden: 0 });
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

describe("rescreenUser undecodable and related photos", () => {
  const undecodable: PhotoClassifier = {
    modelVersion: "m",
    classify: async () => {
      throw new ClassifyInputError();
    },
  };

  it("hides an undecodable thumbnail reversibly and never blocks it", async () => {
    const { db, queries } = fakeDb([row(1, 1)]);
    const result = await rescreenUser(db as never, USER, undecodable, { dryRun: false });
    expect(result).toEqual({ scanned: 1, blocked: 0, hidden: 1 });
    const w = writes(queries).map((q) => q.text);
    expect(w).toHaveLength(2);
    expect(w[0]).toMatch(/^delete from "photo_thumbnails"/i);
    expect(w[1]).toMatch(/^update "photos"/i);
    expect(w[1]).toMatch(/"details_synced_at" = \$/);
    const upd = queries.find((q) => /^update "photos"/i.test(q.text));
    expect(upd?.values).toContain(0);
    expect(upd?.values).toContain(PROTON_ERRORS.thumbnailUnclassifiable);
    expect(upd?.values).toContain("id-0001");
    expect(upd?.values.some((v) => typeof v === "string" && /^\d{4}-/.test(v))).toBe(true);
    expect(queries.some((q) => q.text.includes('"photo_blocks"'))).toBe(false);
  });

  it("dry run counts hidden without writing", async () => {
    const { db, queries } = fakeDb([row(1, 1)]);
    const result = await rescreenUser(db as never, USER, undecodable, { dryRun: true });
    expect(result).toEqual({ scanned: 1, blocked: 0, hidden: 1 });
    expect(writes(queries)).toEqual([]);
  });

  it("a blocked main deletes related rows and records them in photo_blocks", async () => {
    const { db, queries } = fakeDb([row(1, 0xff)], ["rel-1", "rel-2"]);
    const result = await rescreenUser(db as never, USER, classifierFor([0xff]), { dryRun: false });
    expect(result).toEqual({ scanned: 1, blocked: 1, hidden: 0 });
    const del = queries.find((q) => /^delete from "photos"/i.test(q.text));
    expect(del?.text).toMatch(/"main_photo_node_uid"/);
    expect(del?.values).toContain("node-1");
    const block = queries.find((q) => /^insert into "photo_blocks"/i.test(q.text));
    for (const uid of ["node-1", "rel-1", "rel-2"]) expect(block?.values).toContain(uid);
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

describe("withRescreenLock", () => {
  function fakePool(locked: boolean) {
    const queries: { text: string; values: unknown[] }[] = [];
    const release = vi.fn();
    const client = {
      query: vi.fn(async (text: string, values: unknown[] = []) => {
        queries.push({ text, values });
        return { rows: /pg_try_advisory_lock/.test(text) ? [{ locked }] : [] };
      }),
      release,
    };
    const pool = { connect: vi.fn(async () => client) };
    return { pool: pool as never, queries, release };
  }

  it("aborts with a clear message, without running, when a sync holds the user's lock", async () => {
    const { pool, queries, release } = fakePool(false);
    const fn = vi.fn(async () => "ran");

    await expect(withRescreenLock(pool, USER, fn)).rejects.toBeInstanceOf(RescreenLockedError);
    await expect(withRescreenLock(pool, USER, fn)).rejects.toThrow(/sync for this user is running/);
    expect(fn).not.toHaveBeenCalled();
    expect(queries[0].values).toEqual([`proton-sync:${USER}`]);
    expect(queries.some((q) => /pg_advisory_unlock/.test(q.text))).toBe(false);
    // A clean "held" answer returns the client to the pool, not destroyed.
    expect(release).toHaveBeenCalledWith(undefined);
  });

  it("runs under the sync's lock key and unlocks on the same client afterwards", async () => {
    const { pool, queries, release } = fakePool(true);
    const fn = vi.fn(async () => {
      expect(queries.map((q) => q.text)).toHaveLength(1);
      return "ran";
    });

    await expect(withRescreenLock(pool, USER, fn)).resolves.toBe("ran");
    expect(queries.map((q) => q.values[0])).toEqual([`proton-sync:${USER}`, `proton-sync:${USER}`]);
    expect(queries[1].text).toMatch(/pg_advisory_unlock/);
    expect(release).toHaveBeenCalledWith(undefined);
  });

  it("unlocks even when the run fails", async () => {
    const { pool, queries } = fakePool(true);
    await expect(
      withRescreenLock(pool, USER, async () => {
        throw new ClassifierUnavailableError();
      })
    ).rejects.toBeInstanceOf(ClassifierUnavailableError);
    expect(queries[1].text).toMatch(/pg_advisory_unlock/);
  });
});
