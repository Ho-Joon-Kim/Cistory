/**
 * Workaround for Next.js 16 standalone build silently dropping the compiled
 * instrumentation hook. Without this fix, register() never fires in production
 * and the cron service stays dead (caused the 3/5 → 4/25 outage).
 *
 * Reads .next/server/instrumentation.js.nft.json and copies every traced
 * dependency into .next/standalone/, mirroring the path structure the
 * standalone server expects. Also parses chunk require()s out of the
 * compiled instrumentation.js itself in case the NFT trace misses them.
 *
 * Run from the project root, AFTER `next build`.
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, normalize, relative } from "node:path";

const SERVER_DIR = ".next/server";
const STANDALONE_DIR = ".next/standalone";
const NFT_FILE = `${SERVER_DIR}/instrumentation.js.nft.json`;
const INSTR_FILE = `${SERVER_DIR}/instrumentation.js`;

if (!existsSync(NFT_FILE)) {
  console.error(`fix-standalone-instrumentation: ${NFT_FILE} not found — did you run \`next build\` first?`);
  process.exit(1);
}

function copyIfMissing(src, dest) {
  if (!existsSync(src)) return false;
  const stat = statSync(src);
  if (stat.isDirectory()) return false;
  if (existsSync(dest)) return false;
  mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(src, dest);
  return true;
}

let copied = 0;

// 1. Copy the entry hook + its NFT manifest
for (const file of [INSTR_FILE, NFT_FILE]) {
  const dest = join(STANDALONE_DIR, file);
  if (copyIfMissing(file, dest)) copied++;
}

// 2. Copy every dependency the NFT trace lists
const nft = JSON.parse(readFileSync(NFT_FILE, "utf8"));
for (const rel of nft.files) {
  const src = normalize(join(SERVER_DIR, rel));
  const projRel = relative(".", src);
  // skip files outside the project (shouldn't normally happen but stay safe)
  if (projRel.startsWith("..")) continue;
  const dest = join(STANDALONE_DIR, projRel);
  if (copyIfMissing(src, dest)) copied++;
}

// 3. Parse chunk requires from the compiled hook — turbopack emits these as
//    bare strings and they aren't always in the NFT list.
const content = readFileSync(INSTR_FILE, "utf8");
const chunkRefs = content.matchAll(/"(server\/chunks\/[^"]+\.js)"/g);
for (const m of chunkRefs) {
  const src = join(".next", m[1]);
  const dest = join(STANDALONE_DIR, ".next", m[1]);
  if (copyIfMissing(src, dest)) copied++;
}

console.log(`fix-standalone-instrumentation: copied ${copied} files into ${STANDALONE_DIR}`);
