import { withSentryConfig } from "@sentry/nextjs/config";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // @protontech/crypto ships TypeScript source; it must be compiled by Next, never
  // externalized (Node refuses to type-strip files under node_modules).
  transpilePackages: ["@protontech/crypto"],
  // The local NSFW classifier (src/modules/proton/nsfw) loads TensorFlow.js and
  // its wasm binaries at runtime in the cron process; bundling them breaks the
  // wasm backend's file lookup, so they stay plain node_modules requires.
  serverExternalPackages: [
    "nsfwjs",
    "@tensorflow/tfjs",
    "@tensorflow/tfjs-core",
    "@tensorflow/tfjs-backend-cpu",
    "@tensorflow/tfjs-backend-wasm",
    // Native libvips binding that decodes thumbnails for the classifier. Standalone
    // tracing copies it with the build platform's @img/* package (linuxmusl in Docker).
    "sharp",
  ],
  outputFileTracingIncludes: {
    // The .wasm binaries are read with fs at runtime, which file tracing can't see.
    "/*": ["./prompts/*.txt", "./node_modules/@tensorflow/tfjs-backend-wasm/dist/*.wasm"],
  },
  // Next 16.3 added `agentRules`, default true: when `next dev` detects an AI
  // coding agent it injects a managed `<!-- BEGIN:nextjs-agent-rules -->` block
  // into `AGENTS.md` and `CLAUDE.md` at the project root and re-adds it on every
  // run. Both files here are hand-maintained project docs, so that turns every
  // `yarn dev` into a dirty working tree. Verified against 16.3.1: one dev boot
  // appended 10 lines to `AGENTS.md`. Off restores the 16.1.4 behaviour.
  agentRules: false,
};

export default withSentryConfig(nextConfig, {
  silent: true,
  org: "",
  project: "",
  sourcemaps: {
    disable: true,
  },
  tunnelRoute: undefined,
});
