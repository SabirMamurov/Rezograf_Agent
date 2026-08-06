import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: false,
  allowedDevOrigins: ["192.168.242.112", "127.0.0.1", "localhost"],
  // Next 16 ships `Cache-Control: s-maxage=31536000` for SSG pages, so
  // operator browsers reuse last week's HTML across deploys — when the
  // server bundle changes, the cached HTML still references the old
  // build-id chunks and operators see stale UI (e.g. v1.1.7 behavior
  // after v1.2.2 deploy) or "blank page" on chunk 404. Force HTML
  // responses to revalidate so a deploy is immediately visible without
  // requiring operators to hard-refresh. _next/static/* assets keep
  // their long-cache headers because Next fingerprints them by hash.
  async headers() {
    return [
      {
        source: "/:path((?!_next/static/).*)",
        headers: [
          { key: "Cache-Control", value: "no-cache, must-revalidate" },
        ],
      },
    ];
  },
};

export default nextConfig;
