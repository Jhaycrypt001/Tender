import path from "node:path";
import type { NextConfig } from "next";

/**
 * Headers sent on every response.
 *
 * `frame-ancestors 'none'` (with X-Frame-Options for old browsers) stops another
 * site from framing the dashboard or the pay pages and tricking someone into
 * clicking through a signing prompt. It only governs who may frame US: the
 * wallet provider's own frames inside our pages are unaffected.
 *
 * A full Content-Security-Policy is deliberately NOT set here. Sign-in and the
 * embedded wallet load scripts and frames from several third-party origins, and
 * a policy that has not been tested against the real sign-in flow in a browser
 * would break it. Adding one is a follow-up, to be done with a browser open.
 */
const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Strict-Transport-Security", value: "max-age=31536000" },
];

const nextConfig: NextConfig = {
  // There is a stray package.json in the home directory above this project.
  // Without pinning the root, Next walks up and adopts C:\Users\USER as the
  // workspace, which breaks module resolution.
  // Lets a verification build write somewhere other than the folder a running
  // local server is serving from. Unset, it is the usual ".next".
  distDir: process.env.NEXT_DIST_DIR || ".next",
  turbopack: {
    root: path.resolve(process.cwd()),
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
