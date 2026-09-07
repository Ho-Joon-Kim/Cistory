// Run the real app from a disposable copy: never load local .env files or cron.

import { spawn } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const root = process.cwd();
const runtime = await mkdtemp(path.join(tmpdir(), "cistory-browser-"));
for (const name of [
  "src",
  "public",
  "package.json",
  "tsconfig.json",
  "next.config.ts",
  "postcss.config.mjs",
  "instrumentation.ts",
  "sentry.server.config.ts",
  "sentry.edge.config.ts",
  "sentry.client.config.ts",
]) {
  await cp(path.join(root, name), path.join(runtime, name), { recursive: true });
}
// This fixture server uses next start, not a deployable standalone bundle. Tracing
// an external node_modules symlink into standalone would escape the temp folder.
const configPath = path.join(runtime, "next.config.ts");
const config = await readFile(configPath, "utf8");
if (!config.includes('output: "standalone"'))
  throw new Error("Update browser output override for the new Next config");
await writeFile(configPath, config.replace('output: "standalone"', "output: undefined"));
await symlink(path.join(root, "node_modules"), path.join(runtime, "node_modules"), "dir");
await mkdir(path.join(runtime, "src/app/browser-charts"), { recursive: true });
await cp(
  path.join(root, "tests/browser/chart-page.tsx"),
  path.join(runtime, "src/app/browser-charts/page.tsx")
);
const production = process.env.BROWSER_TEST_PRODUCTION === "true";
const environment = {
  PATH: process.env.PATH,
  HOME: process.env.HOME,
  TMPDIR: process.env.TMPDIR,
  NODE_ENV: production ? "production" : "development",
  DISABLE_CRON: "true",
  NEXT_TELEMETRY_DISABLED: "1",
  DATABASE_URL: "postgresql://browser:browser@127.0.0.1:1/browser",
  BETTER_AUTH_SECRET: "browser-test-placeholder-secret-at-least-32-characters",
  BETTER_AUTH_URL: "http://127.0.0.1:3210",
  NEXT_PUBLIC_APP_URL: "http://127.0.0.1:3210",
  GITHUB_CLIENT_ID: "browser-test",
  GITHUB_CLIENT_SECRET: "browser-test",
};
const next = path.join(root, "node_modules/next/dist/bin/next");
let child;
for (const signal of ["SIGTERM", "SIGINT"]) process.on(signal, () => child?.kill(signal));
function run(args) {
  child = spawn(process.execPath, [next, ...args], {
    cwd: runtime,
    stdio: "inherit",
    env: environment,
  });
  return new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", (code) => resolve(code ?? 1));
  });
}
let exitCode = 1;
try {
  // Webpack supports an external node_modules symlink in this isolated copy.
  // Production mode exercises optimized React/Next output in Linux CI too.
  const built = production ? await run(["build", "--webpack"]) : 0;
  exitCode =
    built ||
    (await run([
      ...(production ? ["start"] : ["dev", "--webpack"]),
      "--hostname",
      "127.0.0.1",
      "--port",
      "3210",
    ]));
} finally {
  await rm(runtime, { recursive: true, force: true });
}
process.exit(exitCode);
