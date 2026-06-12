// Resolución del slug de la organización a partir del hostname.

// Mientras no usemos subdominios, la organización queda fijada a este slug.
// Para activar la resolución por subdominio más adelante, poné FORCED_ORG_SLUG = null.
export const FORCED_ORG_SLUG: string | null = "lucassegura";

// Con NEXT_PUBLIC_BASE_DOMAIN configurado la resolución es exacta y soporta
// dominios multi-nivel (p. ej. sinipro.com.ar); sin él se usa la heurística
// de "subdominio = primera etiqueta cuando hay 3+ partes".
const BASE_DOMAIN = process.env.NEXT_PUBLIC_BASE_DOMAIN?.trim().toLowerCase() || null;

const RESERVED_SUBDOMAINS = new Set(["www", "app", "api"]);

function validSlug(candidate: string) {
  if (!candidate || RESERVED_SUBDOMAINS.has(candidate)) return null;
  return /^[a-z0-9-]{2,63}$/.test(candidate) ? candidate : null;
}

export function resolveSubdomainSlug(hostname: string) {
  const normalized = hostname.toLowerCase();
  if (
    normalized === "localhost" ||
    normalized === "127.0.0.1" ||
    normalized === "::1"
  ) {
    return null;
  }

  const parts = normalized.split(".").filter(Boolean);
  if (normalized.endsWith(".localhost") && parts.length >= 2) {
    const localCandidate = parts[0] ?? "";
    return /^[a-z0-9-]{2,63}$/.test(localCandidate) ? localCandidate : null;
  }

  if (BASE_DOMAIN) {
    if (!normalized.endsWith(`.${BASE_DOMAIN}`)) return null;
    const candidate = normalized.slice(0, -(BASE_DOMAIN.length + 1));
    if (candidate.includes(".")) return null;
    return validSlug(candidate);
  }

  if (parts.length < 3) return null;
  return validSlug(parts[0] ?? "");
}

export function resolveLoginSlug(hostname: string, search: string) {
  if (FORCED_ORG_SLUG) return FORCED_ORG_SLUG;
  const querySlug = new URLSearchParams(search).get("slug")?.trim().toLowerCase();
  if (querySlug && /^[a-z0-9-]{2,63}$/.test(querySlug)) {
    return querySlug;
  }

  return resolveSubdomainSlug(hostname);
}

