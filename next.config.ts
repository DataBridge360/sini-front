import type { NextConfig } from "next";

// Los mismos headers que Helmet le ponía a la API en el backend Nest. Solo para
// /api/v1: las páginas de Next no estaban detrás de Helmet y un CSP estricto
// rompe sus scripts inline.
const apiSecurityHeaders = [
  { key: "Content-Security-Policy", value: "default-src 'none'; frame-ancestors 'none'" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
  { key: "Origin-Agent-Cluster", value: "?1" },
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-DNS-Prefetch-Control", value: "off" },
  { key: "X-Download-Options", value: "noopen" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "X-Permitted-Cross-Domain-Policies", value: "none" },
  { key: "X-XSS-Protection", value: "0" },
  { key: "Cache-Control", value: "no-store" }
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  async headers() {
    return [{ source: "/api/v1/:path*", headers: apiSecurityHeaders }];
  }
};

export default nextConfig;
