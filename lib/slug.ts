// Resolución del slug de la organización a partir del hostname.

// Mientras no usemos subdominios, la organización queda fijada a este slug.
// Para activar la resolución por subdominio más adelante, poné FORCED_ORG_SLUG = null.
export const FORCED_ORG_SLUG: string | null = "lucassegura";

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

  if (parts.length < 3) return null;
  const candidate = parts[0] ?? "";
  if (!candidate || candidate === "www" || candidate === "app" || candidate === "api") return null;
  return /^[a-z0-9-]{2,63}$/.test(candidate) ? candidate : null;
}

export function resolveLoginSlug(hostname: string, search: string) {
  if (FORCED_ORG_SLUG) return FORCED_ORG_SLUG;
  const querySlug = new URLSearchParams(search).get("slug")?.trim().toLowerCase();
  if (querySlug && /^[a-z0-9-]{2,63}$/.test(querySlug)) {
    return querySlug;
  }

  return resolveSubdomainSlug(hostname);
}

