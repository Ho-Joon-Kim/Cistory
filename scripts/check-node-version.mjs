import { readFileSync } from "node:fs";
const required = readFileSync(new URL("../.node-version", import.meta.url), "utf8").trim();
const [major, minor, patch] = process.versions.node.split(".").map(Number);
const [expectedMajor, expectedMinor, expectedPatch] = required.split(".").map(Number);
if (major !== expectedMajor || minor < expectedMinor || (minor === expectedMinor && patch < expectedPatch)) {
  console.error(`Cistory requires Node ${required} or a newer patch/minor of Node ${expectedMajor}; found ${process.versions.node}. Activate the version in .node-version.`);
  process.exit(1);
}
