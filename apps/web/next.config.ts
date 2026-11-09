import type { NextConfig } from "next";

const svc = {
  media: process.env.MEDIA_WORKER_URL ?? "http://localhost:4002",
  link: process.env.LINK_SCRAPER_URL ?? "http://localhost:4003",
  calls: process.env.CALL_SIGNALING_URL ?? "http://localhost:4005",
};

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  devIndicators: false,
  allowedDevOrigins: ["chat.xivago.com"],
  // Dev only: a new id per server start adds ?dpl=<id> to every chunk URL, so phones that
  // cached old chunks fetch fresh ones instead of running stale code.
  ...(process.env.NODE_ENV !== "production" ? { deploymentId: `dev-${Date.now().toString(36)}` } : {}),
  transpilePackages: ["@veil/ui", "@veil/shared", "@veil/crypto", "@veil/api-client", "@veil/database"],
  serverExternalPackages: ["postgres", "ioredis", "nodemailer"],
  async rewrites() {
    return [
      { source: "/svc/media/:path*", destination: `${svc.media}/:path*` },
      { source: "/svc/link/:path*", destination: `${svc.link}/:path*` },
      { source: "/svc/calls/:path*", destination: `${svc.calls}/:path*` },
    ];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "Permissions-Policy", value: "camera=(self), microphone=(self), geolocation=(self), display-capture=(self)" },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
        ],
      },
      {
        source: "/api/:path*",
        headers: [{ key: "Cache-Control", value: "no-store" }],
      },
      // Dev only: chunk names don't change when their code does, and Cloudflare otherwise
      // tells browsers to keep them for 4 hours, so phones kept running stale code.
      ...(process.env.NODE_ENV !== "production"
        ? [{ source: "/_next/:path*", headers: [{ key: "Cache-Control", value: "no-store, max-age=0" }] }]
        : []),
    ];
  },
};

export default config;
