import { withSentryConfig } from "@sentry/nextjs";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingIncludes: {
    "/*": ["./prompts/*.txt"],
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
