import path from "node:path";
import type { NextConfig } from "next";

const dev = process.env.NODE_ENV !== "production";

/** The sign-in form posts a server action whose 303 goes to the realm, so form-action must name it. */
const AUTH_ORIGIN = "https://auth.qavrensolutions.com";

const directives = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "frame-src 'none'",
  `form-action 'self' ${AUTH_ORIGIN}`,
  // Next's own inline bootstrap needs 'unsafe-inline' until a nonce is wired through the proxy.
  `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "manifest-src 'self'"
];

const securityHeaders = [
  // A year plus subdomains; no `preload` (one-way list).
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Same intent as frame-ancestors, for browsers that never learned the directive.
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "Content-Security-Policy", value: directives.join("; ") }
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  output: "standalone",
  outputFileTracingRoot: path.join(__dirname),
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  }
};

export default nextConfig;
