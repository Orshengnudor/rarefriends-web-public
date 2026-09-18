import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Vercel packages deployments; standalone output supports self-hosting.
  output: process.env.VERCEL === "1" ? undefined : "standalone",
  reactStrictMode: true,
  poweredByHeader: false,
  productionBrowserSourceMaps: false,
  supportsImmutableAssets: false,
  allowedDevOrigins: ["localhost", "127.0.0.1", "[::1]",
    ...(process.env.DEV_ALLOWED_ORIGINS ?? "").split(",").map(origin => origin.trim()).filter(Boolean)],
};

export default nextConfig;
