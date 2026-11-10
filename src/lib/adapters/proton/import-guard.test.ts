import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC = fileURLToPath(new URL("../../..", import.meta.url));

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return walk(p);
    return /\.(ts|tsx)$/.test(e.name) ? [p] : [];
  });
}

// Static value imports / re-exports of the crypto package (type-only ones are erased).
const STATIC =
  /(?:^|\n)\s*(?:import|export)\s+(?!type\b)[^;'"]*?from\s*["'](@protontech\/crypto[^"']*)["']|(?:^|\n)\s*import\s*["'](@protontech\/crypto[^"']*)["']/g;

describe("@protontech/crypto import guard", () => {
  it("only runtime.ts statically value-imports @protontech/crypto", () => {
    const offenders: string[] = [];
    for (const file of walk(SRC)) {
      const rel = relative(SRC, file);
      if (rel === "lib/adapters/proton/runtime.ts" || rel.endsWith(".test.ts")) continue;
      const text = readFileSync(file, "utf8");
      for (const m of text.matchAll(STATIC)) {
        const spec = m[1] ?? m[2];
        if (spec === "@protontech/crypto/constants" && rel.endsWith("account/addresses.ts"))
          continue;
        offenders.push(`${rel}: ${spec}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("detects a violation (self-check of the matcher)", () => {
    expect('import { x } from "@protontech/crypto";\n'.match(STATIC)).not.toBeNull();
    expect('import type { x } from "@protontech/crypto";\n'.match(STATIC)).toBeNull();
  });
});
