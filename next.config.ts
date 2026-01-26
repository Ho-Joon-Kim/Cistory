import type { NextConfig } from "next";
import { setupDevPlatform } from "@cloudflare/next-on-pages/next-dev";

// 로컬 개발 환경에서 Cloudflare 바인딩 시뮬레이션
if (process.env.NODE_ENV === "development") {
  setupDevPlatform();
}

const nextConfig: NextConfig = {};

export default nextConfig;
