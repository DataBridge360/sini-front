const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
// Timestamps de PostgREST: 2026-06-10T13:00:00.123456+00:00 (sin comas ni paréntesis).
const ISO_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}[T ][0-9:.]+(?:[+-]\d{2}:?\d{2}|Z)?$/;

export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

export function isIsoDate(value: string): boolean {
  return ISO_DATE_PATTERN.test(value);
}

export function isIsoTimestamp(value: string): boolean {
  return ISO_TIMESTAMP_PATTERN.test(value);
}

/**
 * Escapa un valor de texto libre para usarlo dentro de un filtro `.or()` de
 * PostgREST. Sin esto, comas/paréntesis en el valor (p. ej. "Pérez, Juan")
 * rompen el parser del filtro o permiten inyectar condiciones extra.
 */
export function pgrstQuote(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/**
 * Escapa los comodines de LIKE/ILIKE (`%`, `_`) y la barra de escape para que
 * el texto del usuario se busque literal y no como patrón.
 */
export function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}
