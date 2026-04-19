import { withSentryConfig } from "@sentry/nextjs";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
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
