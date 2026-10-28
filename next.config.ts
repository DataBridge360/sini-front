import type { NextConfig } from "next";

// Headers para todas las rutas (páginas incluidas). El CSP de páginas NO lleva
// default-src ni script-src: Next inyecta scripts inline, Supabase realtime abre
// wss y las imágenes vienen de varios orígenes, así que una política de fuentes
// los rompería. Solo se restringe lo que no afecta el render (embebido, base,
// formularios y plugins). El micrófono queda en mismo origen por el dictado
// (Web Speech API).
const baseSecurityHeaders = [
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "microphone=(self), camera=(), geolocation=(), payment=(), usb=()"
  },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "X-DNS-Prefetch-Control", value: "off" },
  {
    key: "Content-Security-Policy",
    value: "frame-ancestors 'self'; base-uri 'self'; form-action 'self'; object-src 'none'"
  }
];

// Los mismos headers que Helmet le ponía a la API en el backend Nest. Van en las
// rutas que devuelven JSON (/api/v1, /api/clubplaza, /api/cron): ahí sí cabe un
// CSP estricto y no-store porque contienen datos personales.
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
    // Next aplica todas las reglas que matchean y, si una key se repite, gana la
    // última: las de API van después de la base para conservar su CSP estricto y
    // Referrer-Policy no-referrer.
    return [
      { source: "/:path*", headers: baseSecurityHeaders },
      { source: "/api/v1/:path*", headers: apiSecurityHeaders },
      { source: "/api/clubplaza/:path*", headers: apiSecurityHeaders },
      { source: "/api/cron/:path*", headers: apiSecurityHeaders }
    ];
  }
};

export default nextConfig;
