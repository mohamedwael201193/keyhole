import type { NextConfig } from "next";
const isolatedSandbox=process.env.NEXT_PUBLIC_PLEDGE_SANDBOX==="1";
const sandboxRpc=process.env.NEXT_PUBLIC_PLEDGE_SANDBOX_RPC??"";
const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  `connect-src 'self' https: wss:${isolatedSandbox?` ${sandboxRpc}`:""}`,
  "frame-src https:",
  "media-src 'self'",
  "frame-ancestors 'none'",
].join("; ");
const config: NextConfig = {
  // Explicit local worktree root containing both checkout and linked dependencies.
  // CI/deployments omit this env and retain the normal hermetic project root.
  ...(process.env.KEYHOLE_TURBOPACK_ROOT ? { turbopack: {root:process.env.KEYHOLE_TURBOPACK_ROOT} } : {}),
  ...(isolatedSandbox?{distDir:".next-pledge-sandbox"}:{}),
  poweredByHeader: false,
  reactStrictMode: true,
  outputFileTracingIncludes: {
    "/*": ["./node_modules/@near-wallet-selector/modal-ui/styles.css"],
  },
  async redirects() {
    return [
      { source: "/ar", destination: "/", permanent: true },
      { source: "/ar/:path*", destination: "/:path*", permanent: true },
      // The verification path moved from /judge. /verify itself stays the proof desk (?call= links point there).
      { source: "/judge", destination: "/verify/path", permanent: true },
    ];
  },
  async headers() {
    return [{ source: "/(.*)", headers: [
      { key: "Content-Security-Policy", value: csp },
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
      { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
    ]}];
  },
};
export default config;
