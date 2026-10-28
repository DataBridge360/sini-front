import { describe, expect, it } from "vitest";
import nextConfig from "@/next.config";

type HeaderRule = { source: string; headers: Array<{ key: string; value: string }> };

// Conversión mínima de la sintaxis `:path*` de Next a RegExp; alcanza para los
// sources de esta config (`/:path*` y `/api/x/:path*`).
function sourceToRegExp(source: string) {
  const pattern = source.replace(/\/:path\*$/, "(?:/.*)?");
  return new RegExp(`^${pattern}$`);
}

// Headers efectivos de un path: Next aplica todas las reglas que matchean en
// orden y, si una key se repite, gana la última.
async function effectiveHeaders(path: string) {
  const rules = (await nextConfig.headers?.()) as HeaderRule[];
  const effective = new Map<string, string>();
  for (const rule of rules) {
    if (!sourceToRegExp(rule.source).test(path)) continue;
    for (const { key, value } of rule.headers) effective.set(key.toLowerCase(), value);
  }
  return effective;
}

const PAGES = ["/", "/clientes", "/polizas/abc", "/login"];
const API_PATHS = ["/api/v1/clients", "/api/clubplaza/players/lookup", "/api/cron/notices"];

describe("next.config security headers", () => {
  it.each([...PAGES, ...API_PATHS])("%s gets HSTS, nosniff and frame protection", async (path) => {
    const headers = await effectiveHeaders(path);
    expect(headers.get("strict-transport-security")).toBe("max-age=31536000; includeSubDomains");
    expect(headers.get("x-content-type-options")).toBe("nosniff");
    expect(headers.get("x-frame-options")).toBe("SAMEORIGIN");
    expect(headers.get("cross-origin-opener-policy")).toBe("same-origin");
    expect(headers.get("x-dns-prefetch-control")).toBe("off");
    expect(headers.get("permissions-policy")).toBeDefined();
  });

  it.each(PAGES)("%s gets a page CSP without script-src/default-src", async (path) => {
    const csp = (await effectiveHeaders(path)).get("content-security-policy") as string;
    expect(csp).toContain("frame-ancestors 'self'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("form-action 'self'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).not.toContain("script-src");
    expect(csp).not.toContain("default-src");
  });

  it.each(PAGES)("%s keeps the microphone for same origin and disables the rest", async (path) => {
    const policy = (await effectiveHeaders(path)).get("permissions-policy") as string;
    expect(policy).toContain("microphone=(self)");
    for (const feature of ["camera", "geolocation", "payment", "usb"]) {
      expect(policy).toContain(`${feature}=()`);
    }
    expect((await effectiveHeaders(path)).get("referrer-policy")).toBe("strict-origin-when-cross-origin");
  });

  it.each(API_PATHS)("%s keeps the strict API headers", async (path) => {
    const headers = await effectiveHeaders(path);
    expect(headers.get("content-security-policy")).toBe("default-src 'none'; frame-ancestors 'none'");
    expect(headers.get("cache-control")).toBe("no-store");
    expect(headers.get("referrer-policy")).toBe("no-referrer");
    expect(headers.get("cross-origin-resource-policy")).toBe("same-origin");
  });

  it("does not leak the API-only headers into pages", async () => {
    const headers = await effectiveHeaders("/clientes");
    expect(headers.get("cache-control")).toBeUndefined();
    expect(headers.get("cross-origin-resource-policy")).toBeUndefined();
  });
});
