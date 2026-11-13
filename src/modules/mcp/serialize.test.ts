import { describe, expect, it } from "vitest";
import {
  type Allowlist,
  accessFromScopes,
  allowlistFields,
  MASK,
  mask,
  sensitiveFields,
  serializeRow,
  serializeRows,
  toJsonValue,
} from "./serialize";

interface Row {
  id: string;
  amount: number;
  merchant: string;
  accountName: string | null;
  rawText: string;
  kind: "card" | "transfer";
  occurredAt: Date;
  appKeyEnc: string;
}

const row: Row = {
  id: "t1",
  amount: 12000,
  merchant: "홍길동",
  accountName: "생활비 통장",
  rawText: "홍길동님에게 12,000원 보냄",
  kind: "transfer",
  occurredAt: new Date("2026-11-13T09:00:00Z"),
  appKeyEnc: "secret",
};

const allowlist: Allowlist<Row> = {
  id: true,
  amount: true,
  at: { from: "occurredAt" },
  merchant: { sensitive: "mask", sensitiveWhen: (r) => r.kind === "transfer" },
  accountName: { sensitive: "mask" },
  rawText: { sensitive: "omit" },
  amountManwon: { from: "amount", map: (v) => (v as number) / 10000 },
};

describe("serializeRow", () => {
  it("emits only declared fields and never undeclared ones", () => {
    const out = serializeRow(row, allowlist, { sensitive: true });
    expect(Object.keys(out).sort()).toEqual(
      ["accountName", "amount", "amountManwon", "at", "id", "merchant", "rawText"].sort()
    );
    expect(out).not.toHaveProperty("appKeyEnc");
    expect(out).not.toHaveProperty("occurredAt");
  });

  it("shows sensitive fields with sensitive-read", () => {
    expect(serializeRow(row, allowlist, { sensitive: true })).toMatchObject({
      merchant: "홍길동",
      accountName: "생활비 통장",
      rawText: row.rawText,
      at: "2026-11-13T18:00:00+09:00",
      amountManwon: 1.2,
    });
  });

  it("masks or omits sensitive fields without it", () => {
    const out = serializeRow(row, allowlist, { sensitive: false });
    expect(out.merchant).toBe(MASK);
    expect(out.accountName).toBe(MASK);
    expect(out).not.toHaveProperty("rawText");
    expect(out.amount).toBe(12000);
  });

  it("applies a sensitive rule only to rows its predicate selects", () => {
    const card = { ...row, kind: "card" as const, merchant: "스타벅스" };
    expect(serializeRow(card, allowlist, { sensitive: false }).merchant).toBe("스타벅스");
  });

  it("keeps null as null when masking (absence is not a secret)", () => {
    const out = serializeRow({ ...row, accountName: null }, allowlist, { sensitive: false });
    expect(out.accountName).toBeNull();
    expect(mask(undefined)).toBeNull();
  });

  it("serializes arrays of rows", () => {
    expect(serializeRows([row, row], { id: true }, { sensitive: false })).toEqual([
      { id: "t1" },
      { id: "t1" },
    ]);
  });
});

describe("helpers", () => {
  it("derives access from scopes", () => {
    expect(accessFromScopes(["read"]).sensitive).toBe(false);
    expect(accessFromScopes(["read", "sensitive-read"]).sensitive).toBe(true);
  });

  it("lists declared and sensitive fields", () => {
    expect(allowlistFields(allowlist)).toContain("amountManwon");
    expect(sensitiveFields(allowlist).sort()).toEqual(["accountName", "merchant", "rawText"]);
  });

  it("toJsonValue renders nested Dates in KST and drops undefined", () => {
    expect(
      toJsonValue({ a: [new Date("2026-11-12T15:00:00Z")], b: undefined, c: { d: 1n } })
    ).toEqual({ a: ["2026-11-13T00:00:00+09:00"], c: { d: "1" } });
  });
});
